\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
    v_s1 record;
    v_s2 record;
    v_push_count integer;
    v_camp_count integer;
    v_overlap integer;
    v_total_claimed integer;
    v_rev_claimed integer;
    v_first_claim jsonb;
    v_worker_name varchar(64);
    v_auth1 jsonb;
    v_auth2 jsonb;
    v_conf_bad jsonb;
    v_conf_good jsonb;
BEGIN
    -- 1. Verify Advisory Lock 1001: Concurrent max_daily_push = 1 Enforcement
    SELECT * INTO v_s1 FROM public.p57_conc_audit WHERE suite = 'cap_1001' AND session_name = 'session_1';
    SELECT * INTO v_s2 FROM public.p57_conc_audit WHERE suite = 'cap_1001' AND session_name = 'session_2';
    IF v_s1.xact_id IS NULL OR v_s2.xact_id IS NULL OR v_s1.xact_id = v_s2.xact_id THEN
        RAISE EXCEPTION 'Cap 1001 race failed to record two distinct transactions';
    END IF;
    SELECT count(*)::integer INTO v_push_count
    FROM public.notification_deliveries
    WHERE recipient_id = '57200000-0000-0000-0000-000000000001'::uuid
      AND channel_type IN ('fcm', 'web_push')
      AND delivery_status IN ('pending', 'leased', 'sent', 'delivered');
    IF v_push_count <> 1 THEN
        RAISE EXCEPTION 'Lock 1001 violation: expected exactly 1 push delivery under max_daily_push=1, got %', v_push_count;
    END IF;
    RAISE NOTICE '[PASS] 4A Advisory lock 1001 (max_daily_push=1): 2 parallel txs (xid=% vs xid=%) queued strictly % push delivery.',
        v_s1.xact_id, v_s2.xact_id, v_push_count;

    -- 2. Verify Advisory Lock 1002: Concurrent campaign idempotency
    SELECT * INTO v_s1 FROM public.p57_conc_audit WHERE suite = 'idemp_1002' AND session_name = 'session_1';
    SELECT * INTO v_s2 FROM public.p57_conc_audit WHERE suite = 'idemp_1002' AND session_name = 'session_2';
    IF v_s1.xact_id = v_s2.xact_id THEN
        RAISE EXCEPTION 'Idemp 1002 expected distinct txids';
    END IF;
    IF (v_s1.payload->>'campaign_id') IS DISTINCT FROM (v_s2.payload->>'campaign_id') THEN
        RAISE EXCEPTION 'Idemp 1002 mismatch: % vs %', v_s1.payload, v_s2.payload;
    END IF;
    IF ((v_s1.payload->>'already_exists')::boolean = (v_s2.payload->>'already_exists')::boolean) THEN
        RAISE EXCEPTION 'Idemp 1002 expected one creator and one replay: % vs %', v_s1.payload, v_s2.payload;
    END IF;
    SELECT count(*)::integer INTO v_camp_count
    FROM public.notification_campaigns
    WHERE target_criteria->>'idempotency_key' = 'p57_idemp_race_1002';
    IF v_camp_count <> 1 THEN
        RAISE EXCEPTION 'Idemp 1002 expected 1 campaign row, found %', v_camp_count;
    END IF;
    RAISE NOTICE '[PASS] 4B Advisory lock 1002 (campaign idempotency): 2 parallel txs (xid=% vs xid=%) converged on 1 campaign %.',
        v_s1.xact_id, v_s2.xact_id, v_s1.payload->>'campaign_id';

    -- 3. Verify H-4 Campaign-First, Delivery-Second Lock Order (0 deadlocks)
    SELECT * INTO v_s1 FROM public.p57_conc_audit WHERE suite = 'lock_h4' AND session_name = 'session_1_telemetry';
    SELECT * INTO v_s2 FROM public.p57_conc_audit WHERE suite = 'lock_h4' AND session_name = 'session_2_cancel';
    IF v_s1.xact_id IS NULL OR v_s2.xact_id IS NULL OR v_s1.xact_id = v_s2.xact_id THEN
        RAISE EXCEPTION 'Lock H-4 missing parallel audit entries';
    END IF;
    IF NOT COALESCE((v_s1.payload->>'success')::boolean, false) OR NOT COALESCE((v_s2.payload->>'success')::boolean, false) THEN
        RAISE EXCEPTION 'Lock H-4 failed: telemetry=%, cancel=%', v_s1.payload, v_s2.payload;
    END IF;
    RAISE NOTICE '[PASS] 4C H-4 lock order contention (telemetry vs cancel): 0 deadlocks across parallel txs (xid=% vs xid=%).',
        v_s1.xact_id, v_s2.xact_id;

    -- 4. Verify B5E Concurrent Reservation & Dispatch-Attempt Fencing
    SELECT * INTO v_s1 FROM public.p57_conc_audit WHERE suite = 'b5e_reserve' AND session_name = 'worker_1';
    SELECT * INTO v_s2 FROM public.p57_conc_audit WHERE suite = 'b5e_reserve' AND session_name = 'worker_2';

    WITH c1 AS (SELECT elem->>'delivery_id' AS did, elem->>'token_id' AS tid FROM jsonb_array_elements(v_s1.payload) elem),
         c2 AS (SELECT elem->>'delivery_id' AS did, elem->>'token_id' AS tid FROM jsonb_array_elements(v_s2.payload) elem)
    SELECT count(*)::integer INTO v_overlap FROM (SELECT did FROM c1 INTERSECT SELECT did FROM c2) i;

    IF v_overlap <> 0 THEN
        RAISE EXCEPTION 'B5E duplicate reservation detected! Overlap count=%', v_overlap;
    END IF;

    v_total_claimed := jsonb_array_length(v_s1.payload) + jsonb_array_length(v_s2.payload);
    SELECT count(*)::integer INTO v_rev_claimed
    FROM (
        SELECT elem->>'token_id' AS tid FROM jsonb_array_elements(v_s1.payload) elem
        UNION ALL
        SELECT elem->>'token_id' AS tid FROM jsonb_array_elements(v_s2.payload) elem
    ) allc
    WHERE tid = '57210000-0000-0000-0000-000000000003';

    IF v_rev_claimed <> 0 THEN
        RAISE EXCEPTION 'B5E leased revoked endpoint (% times)!', v_rev_claimed;
    END IF;
    IF v_total_claimed < 2 THEN
        RAISE EXCEPTION 'Expected parallel B5E workers to claim >= 2 deliveries, got %', v_total_claimed;
    END IF;

    IF jsonb_array_length(v_s1.payload) > 0 THEN
        v_first_claim := v_s1.payload->0;
        v_worker_name := 'p57_worker_1';
    ELSE
        v_first_claim := v_s2.payload->0;
        v_worker_name := 'p57_worker_2';
    END IF;
    v_auth1 := public.authorize_notification_delivery_dispatch(
        (v_first_claim->>'delivery_id')::uuid,
        (v_first_claim->>'token_id')::uuid,
        (v_first_claim->>'reservation_token')::uuid,
        v_worker_name,
        (v_first_claim->>'recipient_id')::uuid
    );
    IF NOT COALESCE((v_auth1->>'authorized')::boolean, false) THEN
        RAISE EXCEPTION 'Expected first B5E authorization to succeed, got %', v_auth1;
    END IF;

    v_auth2 := public.authorize_notification_delivery_dispatch(
        (v_first_claim->>'delivery_id')::uuid,
        (v_first_claim->>'token_id')::uuid,
        (v_first_claim->>'reservation_token')::uuid,
        v_worker_name,
        (v_first_claim->>'recipient_id')::uuid
    );
    IF COALESCE((v_auth2->>'authorized')::boolean, true) OR v_auth2->>'reason' <> 'ALREADY_AUTHORIZED_FOR_DISPATCH' THEN
        RAISE EXCEPTION 'Expected replay B5E authorization rejection, got %', v_auth2;
    END IF;

    v_conf_bad := public.confirm_notification_delivery_sent(
        (v_first_claim->>'delivery_id')::uuid,
        gen_random_uuid(),
        'fcm-msg-stale'
    );
    IF COALESCE((v_conf_bad->>'success')::boolean, true) OR v_conf_bad->>'reason' <> 'CAS_FAILED_OR_LEASE_LOST' THEN
        RAISE EXCEPTION 'Expected stale dispatch_attempt_id to fail CAS, got %', v_conf_bad;
    END IF;

    v_conf_good := public.confirm_notification_delivery_sent(
        (v_first_claim->>'delivery_id')::uuid,
        (v_auth1->>'dispatch_attempt_id')::uuid,
        'fcm-msg-p57-verified'
    );
    IF NOT COALESCE((v_conf_good->>'success')::boolean, false) THEN
        RAISE EXCEPTION 'Expected valid dispatch_attempt_id confirm to succeed, got %', v_conf_good;
    END IF;

    RAISE NOTICE '[PASS] 4D B5E reservation (overlap=0, total_claimed=%, revoked_claimed=0) & dispatch_attempt_id fencing verified.',
        v_total_claimed;
END $$;

COMMIT;
