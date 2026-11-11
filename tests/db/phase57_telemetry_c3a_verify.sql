\set ON_ERROR_STOP on
DO $$
DECLARE
    v_del_cnt integer;
    v_tel_cnt integer;
    v_all_keep boolean;
BEGIN
    SELECT count(*) INTO v_del_cnt FROM public.notification_deliveries WHERE endpoint_id = '57510000-0000-0000-0000-000000000002'::uuid;
    SELECT count(*), bool_and(delivery_id = '57530000-0000-0000-0000-000000000011'::uuid)
    INTO v_tel_cnt, v_all_keep
    FROM public.notification_telemetry;

    IF v_del_cnt <> 1 THEN
        RAISE EXCEPTION 'C3A expected 1 remaining delivery, found %', v_del_cnt;
    END IF;
    IF v_tel_cnt <> 3 OR NOT v_all_keep THEN
        RAISE EXCEPTION 'C3A telemetry preservation failed! count=%, all_pointed_to_keep=%', v_tel_cnt, v_all_keep;
    END IF;
    RAISE NOTICE '[PASS] Stage 5 Case 3A: Clean duplicate telemetry re-pointed to keep_id (3/3 historical rows preserved).';
END $$;

