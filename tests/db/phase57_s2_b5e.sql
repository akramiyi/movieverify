\set ON_ERROR_STOP on
SELECT pg_advisory_unlock_all();
SELECT pg_advisory_lock(88042);

DO $$
DECLARE v_waited interval := '0 seconds';
BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 88041 AND granted = true) LOOP
        PERFORM pg_sleep(0.02);
        v_waited := v_waited + '0.02 seconds'::interval;
        IF v_waited >= '15 seconds'::interval THEN RAISE EXCEPTION 'S2 B5E timeout waiting for S1'; END IF;
    END LOOP;
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 88043 AND granted = true) LOOP
        PERFORM pg_sleep(0.01);
        v_waited := v_waited + '0.01 seconds'::interval;
        IF v_waited >= '15 seconds'::interval THEN RAISE EXCEPTION 'S2 B5E timeout waiting for S1 tx'; END IF;
    END LOOP;
END $$;

BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $$
DECLARE
    v_start timestamptz := clock_timestamp();
    v_xact bigint := txid_current();
    v_claims jsonb;
BEGIN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'delivery_id', delivery_id,
        'token_id', token_id,
        'recipient_id', recipient_id,
        'reservation_token', reservation_token,
        'campaign_id', campaign_id
    )), '[]'::jsonb) INTO v_claims
    FROM public.reserve_notification_deliveries('p57_worker_2', 2, 60);

    INSERT INTO public.p57_conc_audit(suite, session_name, xact_id, tx_start, tx_end, payload)
    VALUES ('b5e_reserve', 'worker_2', v_xact, v_start, clock_timestamp(), v_claims);
END $$;
COMMIT;

SELECT pg_advisory_lock(88045);
DO $$
DECLARE v_waited interval := '0 seconds';
BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 88044 AND granted = true) LOOP
        PERFORM pg_sleep(0.02);
        v_waited := v_waited + '0.02 seconds'::interval;
        IF v_waited >= '15 seconds'::interval THEN EXIT; END IF;
    END LOOP;
END $$;
SELECT pg_advisory_unlock_all();

