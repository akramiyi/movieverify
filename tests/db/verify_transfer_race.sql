-- ============================================================================
-- TRANSFER RACE AUDIT VERIFICATION (Phase 2 — R4.0)
-- File: tests/db/verify_transfer_race.sql
--
-- Phase 2 change: Session 1 deactivates the endpoint instead of transferring
-- user_id ownership. reserve_notification_deliveries joins notification_endpoints
-- on is_active=true, so Session 2 gets 0 deliveries after deactivation.
-- There is no OWNERSHIP_TRANSFERRED failure_reason column in Phase 2.
-- Instead we verify:
--   1. Session 2 obtained 0 deliveries and no raw_token.
--   2. All 4 transfer_seed_device deliveries remain in 'pending' status
--      (not leased — their endpoint is inactive so they cannot be claimed).
--   3. The endpoint is_active=false confirmed.
--   4. Two distinct transaction IDs were recorded.
-- ============================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
    v_recs         integer;
    v_has_raw      boolean;
    v_s1_xact      bigint;
    v_s2_xact      bigint;
    v_s1_start     timestamptz;
    v_s1_end       timestamptz;
    v_s2_start     timestamptz;
    v_s2_end       timestamptz;
    v_unclaimed    integer;
    v_ep_active    boolean;
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

    -- 4. Assert the deactivated endpoint is_active = false
    SELECT is_active INTO v_ep_active
    FROM public.notification_endpoints
    WHERE device_name = 'transfer_seed_device';

    IF v_ep_active IS TRUE THEN
        RAISE EXCEPTION 'Transfer race failed: transfer_seed_device endpoint is still active!';
    END IF;

    -- 5. Assert transfer seed deliveries were NOT claimed (endpoint inactive → reserve skips them)
    SELECT COUNT(*) INTO v_unclaimed
    FROM public.notification_deliveries d
    JOIN public.notification_endpoints e ON e.id = d.endpoint_id
    WHERE e.device_name = 'transfer_seed_device'
      AND d.delivery_status IN ('pending', 'failed');

    IF v_unclaimed < 4 THEN
        RAISE EXCEPTION 'Transfer race failed: Expected at least 4 unclaimed/failed deliveries for deactivated endpoint, found %', v_unclaimed;
    END IF;

    -- 6. Assert distinct transactions
    IF v_s1_xact IS NULL OR v_s2_xact IS NULL OR v_s1_xact = v_s2_xact THEN
        RAISE EXCEPTION 'Transfer race failed: Expected two distinct transactions, found s1=%, s2=%', v_s1_xact, v_s2_xact;
    END IF;

    RAISE NOTICE 'TRANSFER-RACE DETERMINISTIC AUDIT PROVEN:';
    RAISE NOTICE '  Session 1 (Deactivate): xact=%, tx=[% -> %]', v_s1_xact, v_s1_start, v_s1_end;
    RAISE NOTICE '  Session 2 (Reserve):    xact=%, tx=[% -> %]', v_s2_xact, v_s2_start, v_s2_end;
    RAISE NOTICE '  Session 2 obtained: % deliveries, raw_token=%', v_recs, v_has_raw;
    RAISE NOTICE '  Unclaimed/failed deliveries to deactivated endpoint: % (zero leakage).', v_unclaimed;
END $$;
