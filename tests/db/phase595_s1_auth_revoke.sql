\set ON_ERROR_STOP on
SELECT pg_advisory_unlock_all();
SELECT pg_advisory_lock(95011);

DO $$
DECLARE v_w interval := '0 seconds';
BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 95012 AND granted = true) LOOP
        PERFORM pg_sleep(0.02);
        v_w := v_w + '0.02 seconds'::interval;
        IF v_w >= '15 seconds'::interval THEN RAISE EXCEPTION 'S1 timeout waiting for S2'; END IF;
    END LOOP;
END $$;

BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $$
DECLARE
    v_start timestamptz := clock_timestamp();
    v_xact bigint := txid_current();
BEGIN
    -- Acquires FOR UPDATE lock inside trg_compat_notification_tokens_update
    UPDATE public.notification_tokens
    SET is_active = false,
        revoked_at = NOW()
    WHERE id = '59591000-0000-0000-0000-000000000001';

    -- Signal S2 to call authorize_notification_delivery_dispatch (which will block on FOR SHARE!)
    PERFORM pg_advisory_lock(95013);
    -- Hold FOR UPDATE lock long enough for S2 to enter FOR SHARE wait queue
    PERFORM pg_sleep(0.35);

    INSERT INTO public.p595_conc_audit(suite, session_name, xact_id, tx_start, tx_end, payload)
    VALUES ('auth_vs_revoke', 's1_revoke', v_xact, v_start, clock_timestamp(), jsonb_build_object('revoked', true));
END $$;
COMMIT;
SELECT pg_advisory_unlock_all();

