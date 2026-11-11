\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
    v_s1 record;
    v_s2 record;
    v_status text;
    v_cs_ok integer;
BEGIN
    -- 1. Verify FOR UPDATE revoke vs FOR SHARE authorize
    SELECT * INTO v_s1 FROM public.p595_conc_audit WHERE suite = 'auth_vs_revoke' AND session_name = 's1_revoke';
    SELECT * INTO v_s2 FROM public.p595_conc_audit WHERE suite = 'auth_vs_revoke' AND session_name = 's2_authorize';

    IF v_s1.xact_id IS NULL OR v_s2.xact_id IS NULL OR v_s1.xact_id = v_s2.xact_id THEN
        RAISE EXCEPTION 'Expected two distinct transactions for auth_vs_revoke';
    END IF;
    IF COALESCE((v_s2.payload->>'authorized')::boolean, true) OR (v_s2.payload->>'reason') <> 'ENDPOINT_REVOKED_OR_INACTIVE' THEN
        RAISE EXCEPTION 'Expected FOR SHARE authorize to reject revoked endpoint, got %', v_s2.payload;
    END IF;
    IF v_s2.payload ? 'provider_token' THEN
        RAISE EXCEPTION 'provider_token must never be returned on rejected authorization';
    END IF;

    SELECT delivery_status INTO v_status FROM public.notification_deliveries WHERE id = '59593000-0000-0000-0000-000000000001';
    IF v_status <> 'failed' THEN
        RAISE EXCEPTION 'Expected delivery 0001 status=failed, got %', v_status;
    END IF;
    RAISE NOTICE '[PASS] 595-Conc-1: FOR UPDATE revoke (xid=%) serialized before FOR SHARE authorize (xid=%) -> % (status=failed, no token leak)',
        v_s1.xact_id, v_s2.xact_id, v_s2.payload->>'reason';

    -- 2. Verify Cancel vs Sweep completed with 0 deadlocks
    SELECT * INTO v_s1 FROM public.p595_conc_audit WHERE suite = 'cancel_vs_sweep' AND session_name = 's1_cancel';
    SELECT * INTO v_s2 FROM public.p595_conc_audit WHERE suite = 'cancel_vs_sweep' AND session_name = 's2_sweep';

    IF v_s1.xact_id IS NULL OR v_s2.xact_id IS NULL OR v_s1.xact_id = v_s2.xact_id THEN
        RAISE EXCEPTION 'Expected two distinct transactions for cancel_vs_sweep';
    END IF;
    IF NOT COALESCE((v_s1.payload->>'success')::boolean, false) THEN
        RAISE EXCEPTION 'Expected cancel_notification_campaign to succeed, got %', v_s1.payload;
    END IF;

    SELECT count(*)::integer INTO v_cs_ok
    FROM public.notification_deliveries
    WHERE campaign_id = '59592000-0000-0000-0000-000000000002'
      AND delivery_status IN ('cancelled', 'pending');
    IF v_cs_ok <> 4 THEN
        RAISE EXCEPTION 'Expected all 4 cancel_vs_sweep deliveries in clean valid status, found %', v_cs_ok;
    END IF;

    RAISE NOTICE '[PASS] 595-Conc-2: cancel_notification_campaign (xid=%) vs sweep_expired (xid=%, swept=%) completed with 0 deadlocks',
        v_s1.xact_id, v_s2.xact_id, v_s2.payload->>'swept';
END $$;
COMMIT;

