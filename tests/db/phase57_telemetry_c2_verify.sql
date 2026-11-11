\set ON_ERROR_STOP on
DO $$
DECLARE
    v_push_cnt integer;
    v_inapp_cnt integer;
    v_notif_del uuid;
    v_welcome_del uuid;
BEGIN
    SELECT count(*) INTO v_push_cnt
    FROM public.notification_deliveries
    WHERE campaign_id = '57520000-0000-0000-0000-000000000001'::uuid AND endpoint_id IS NOT NULL;
    SELECT count(*) INTO v_inapp_cnt
    FROM public.notification_deliveries
    WHERE campaign_id = '57520000-0000-0000-0000-000000000001'::uuid AND channel_type = 'in_app';
    IF v_push_cnt <> 1 OR v_inapp_cnt <> 1 THEN
        RAISE EXCEPTION 'C2 dedup failed: push=%, in_app=%', v_push_cnt, v_inapp_cnt;
    END IF;
    SELECT delivery_id INTO v_notif_del FROM public.user_notifications WHERE id = '57540000-0000-0000-0000-000000000001';
    SELECT delivery_id INTO v_welcome_del FROM public.user_welcome_dispatches WHERE user_id = '57500000-0000-0000-0000-000000000001';
    IF v_notif_del <> '57530000-0000-0000-0000-000000000003'::uuid OR v_welcome_del <> '57530000-0000-0000-0000-000000000003'::uuid THEN
        RAISE EXCEPTION 'C2 FK re-point failed: notif=%, welcome=%', v_notif_del, v_welcome_del;
    END IF;
    RAISE NOTICE '[PASS] Stage 5 Case 2: Duplicate deliveries without telemetry cleanly deduplicated; FKs preserved to keep_id.';
END $$;

