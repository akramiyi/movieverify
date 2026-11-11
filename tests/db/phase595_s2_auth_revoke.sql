\set ON_ERROR_STOP on
SELECT pg_advisory_unlock_all();
SELECT pg_advisory_lock(95012);

DO $$
DECLARE v_w interval := '0 seconds';
BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 95011 AND granted = true) LOOP
        PERFORM pg_sleep(0.02);
        v_w := v_w + '0.02 seconds'::interval;
        IF v_w >= '15 seconds'::interval THEN RAISE EXCEPTION 'S2 timeout waiting for S1'; END IF;
    END LOOP;
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 95013 AND granted = true) LOOP
        PERFORM pg_sleep(0.01);
        v_w := v_w + '0.01 seconds'::interval;
        IF v_w >= '15 seconds'::interval THEN RAISE EXCEPTION 'S2 timeout waiting for S1 FOR UPDATE'; END IF;
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
    -- Blocks on notification_endpoints FOR SHARE until S1 commits, then rejects ENDPOINT_REVOKED_OR_INACTIVE
    v_res := public.authorize_notification_delivery_dispatch(
        '59593000-0000-0000-0000-000000000001'::uuid,
        '59591000-0000-0000-0000-000000000001'::uuid,
        '59594000-0000-0000-0000-000000000001'::uuid,
        'w-conc-auth',
        '59590000-0000-0000-0000-000000000001'::uuid
    );

    INSERT INTO public.p595_conc_audit(suite, session_name, xact_id, tx_start, tx_end, payload)
    VALUES ('auth_vs_revoke', 's2_authorize', v_xact, v_start, clock_timestamp(), v_res);
END $$;
COMMIT;
SELECT pg_advisory_unlock_all();

