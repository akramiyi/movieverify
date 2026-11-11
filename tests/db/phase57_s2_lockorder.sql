\set ON_ERROR_STOP on
SELECT pg_advisory_unlock_all();
SELECT pg_advisory_lock(88032);

DO $$
DECLARE v_waited interval := '0 seconds';
BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 88031 AND granted = true) LOOP
        PERFORM pg_sleep(0.02);
        v_waited := v_waited + '0.02 seconds'::interval;
        IF v_waited >= '15 seconds'::interval THEN RAISE EXCEPTION 'S2 LockOrder timeout waiting for S1'; END IF;
    END LOOP;
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 88033 AND granted = true) LOOP
        PERFORM pg_sleep(0.01);
        v_waited := v_waited + '0.01 seconds'::interval;
        IF v_waited >= '15 seconds'::interval THEN RAISE EXCEPTION 'S2 LockOrder timeout waiting for S1 tx'; END IF;
    END LOOP;
END $$;

BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $$
DECLARE
    v_start timestamptz := clock_timestamp();
    v_xact bigint := txid_current();
    v_res jsonb;
BEGIN
    v_res := public.cancel_notification_campaign('57220000-0000-0000-0000-000000000001'::uuid);
    INSERT INTO public.p57_conc_audit(suite, session_name, xact_id, tx_start, tx_end, payload)
    VALUES ('lock_h4', 'session_2_cancel', v_xact, v_start, clock_timestamp(), v_res);
END $$;
COMMIT;

SELECT pg_advisory_lock(88035);
DO $$
DECLARE v_waited interval := '0 seconds';
BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 88034 AND granted = true) LOOP
        PERFORM pg_sleep(0.02);
        v_waited := v_waited + '0.02 seconds'::interval;
        IF v_waited >= '15 seconds'::interval THEN EXIT; END IF;
    END LOOP;
END $$;
SELECT pg_advisory_unlock_all();

