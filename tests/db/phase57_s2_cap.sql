\set ON_ERROR_STOP on
SELECT pg_advisory_unlock_all();
SELECT pg_advisory_lock(88012);

DO $$
DECLARE v_waited interval := '0 seconds';
BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 88011 AND granted = true) LOOP
        PERFORM pg_sleep(0.02);
        v_waited := v_waited + '0.02 seconds'::interval;
        IF v_waited >= '15 seconds'::interval THEN RAISE EXCEPTION 'S2 Cap timeout waiting for S1'; END IF;
    END LOOP;
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 88013 AND granted = true) LOOP
        PERFORM pg_sleep(0.01);
        v_waited := v_waited + '0.01 seconds'::interval;
        IF v_waited >= '15 seconds'::interval THEN RAISE EXCEPTION 'S2 Cap timeout waiting for S1 tx'; END IF;
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
    v_res := public.ingest_notification_campaign(
        'Cap Race S2', 'Testing lock 1001 S2', 'system', '/', NULL,
        '{"type":"users","user_ids":["57200000-0000-0000-0000-000000000001"],"idempotency_key":"p57_cap_race_2"}'::jsonb
    );
    INSERT INTO public.p57_conc_audit(suite, session_name, xact_id, tx_start, tx_end, payload)
    VALUES ('cap_1001', 'session_2', v_xact, v_start, clock_timestamp(), v_res);
END $$;
COMMIT;

SELECT pg_advisory_lock(88015);
DO $$
DECLARE v_waited interval := '0 seconds';
BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 88014 AND granted = true) LOOP
        PERFORM pg_sleep(0.02);
        v_waited := v_waited + '0.02 seconds'::interval;
        IF v_waited >= '15 seconds'::interval THEN EXIT; END IF;
    END LOOP;
END $$;
SELECT pg_advisory_unlock_all();

