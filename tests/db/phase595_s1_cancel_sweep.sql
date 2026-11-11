\set ON_ERROR_STOP on
SELECT pg_advisory_unlock_all();
SELECT pg_advisory_lock(95021);

DO $$
DECLARE v_w interval := '0 seconds';
BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 95022 AND granted = true) LOOP
        PERFORM pg_sleep(0.02);
        v_w := v_w + '0.02 seconds'::interval;
        IF v_w >= '15 seconds'::interval THEN RAISE EXCEPTION 'S1 cancel timeout'; END IF;
    END LOOP;
END $$;
SELECT pg_advisory_lock(95023);

BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $$
DECLARE
    v_start timestamptz := clock_timestamp();
    v_xact bigint := txid_current();
    v_res jsonb;
BEGIN
    v_res := public.cancel_notification_campaign('59592000-0000-0000-0000-000000000002'::uuid);
    INSERT INTO public.p595_conc_audit(suite, session_name, xact_id, tx_start, tx_end, payload)
    VALUES ('cancel_vs_sweep', 's1_cancel', v_xact, v_start, clock_timestamp(), v_res);
END $$;
COMMIT;
SELECT pg_advisory_unlock_all();

