\set ON_ERROR_STOP on
SELECT pg_advisory_unlock_all();
SELECT pg_advisory_lock(95022);

DO $$
DECLARE v_w interval := '0 seconds';
BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 95021 AND granted = true) LOOP
        PERFORM pg_sleep(0.02);
        v_w := v_w + '0.02 seconds'::interval;
        IF v_w >= '15 seconds'::interval THEN RAISE EXCEPTION 'S2 sweep timeout'; END IF;
    END LOOP;
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 95023 AND granted = true) LOOP
        PERFORM pg_sleep(0.01);
        v_w := v_w + '0.01 seconds'::interval;
        IF v_w >= '15 seconds'::interval THEN RAISE EXCEPTION 'S2 timeout waiting for S1 barrier ack'; END IF;
    END LOOP;
END $$;

BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $$
DECLARE
    v_start timestamptz := clock_timestamp();
    v_xact bigint := txid_current();
    v_swept integer;
BEGIN
    v_swept := public.sweep_expired_delivery_reservations();
    INSERT INTO public.p595_conc_audit(suite, session_name, xact_id, tx_start, tx_end, payload)
    VALUES ('cancel_vs_sweep', 's2_sweep', v_xact, v_start, clock_timestamp(), jsonb_build_object('swept', v_swept));
END $$;
COMMIT;
SELECT pg_advisory_unlock_all();

