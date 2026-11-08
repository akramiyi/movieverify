-- ============================================================================
-- TRANSFER RACE AUDIT VERIFICATION (R3.1)
-- File: tests/db/verify_transfer_race.sql
-- ============================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
    v_recs integer;
    v_has_raw boolean;
    v_cancelled_cnt integer;
    v_s1_xact bigint;
    v_s2_xact bigint;
    v_s1_start timestamptz;
    v_s1_end timestamptz;
    v_s2_start timestamptz;
    v_s2_end timestamptz;
BEGIN
    -- 1. Verify Session 2 audit record exists
    SELECT deliveries_returned, raw_token_returned, xact_id, tx_start, tx_end
    INTO v_recs, v_has_raw, v_s2_xact, v_s2_start, v_s2_end
    FROM public.transfer_race_audit
    WHERE session_name = 'session_2';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transfer race audit record for session_2 was not found!';
    END IF;

    -- 2. Verify Session 1 audit record exists
    SELECT xact_id, tx_start, tx_end
    INTO v_s1_xact, v_s1_start, v_s1_end
    FROM public.transfer_race_audit
    WHERE session_name = 'session_1_transfer';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transfer race audit record for session_1_transfer was not found!';
    END IF;

    -- 3. Assert Session 2 obtained ZERO deliveries and NO raw token
    IF v_recs IS DISTINCT FROM 0 OR v_has_raw IS TRUE THEN
        RAISE EXCEPTION 'Transfer race failed: Session 2 obtained % deliveries (raw_token = %)!', v_recs, v_has_raw;
    END IF;

    -- 4. Assert that all seed deliveries were cancelled by the trigger
    SELECT COUNT(*) INTO v_cancelled_cnt
    FROM public.notification_deliveries
    WHERE failure_reason = 'OWNERSHIP_TRANSFERRED';

    IF v_cancelled_cnt < 4 THEN
        RAISE EXCEPTION 'Transfer race trigger failed: Expected at least 4 cancelled deliveries, found %', v_cancelled_cnt;
    END IF;

    -- 5. Assert distinct transactions
    IF v_s1_xact IS NULL OR v_s2_xact IS NULL OR v_s1_xact = v_s2_xact THEN
        RAISE EXCEPTION 'Transfer race failed: Expected two distinct transactions, found s1=%, s2=%', v_s1_xact, v_s2_xact;
    END IF;

    RAISE NOTICE 'TRANSFER-RACE DETERMINISTIC AUDIT PROVEN:';
    RAISE NOTICE '  Session 1 (Transfer): xact=%, tx=[% -> %]', v_s1_xact, v_s1_start, v_s1_end;
    RAISE NOTICE '  Session 2 (Reserve):  xact=%, tx=[% -> %]', v_s2_xact, v_s2_start, v_s2_end;
    RAISE NOTICE '  Cancelled Deliveries: % (zero leakage across transfer boundary).', v_cancelled_cnt;
END $$;
