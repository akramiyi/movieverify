\set ON_ERROR_STOP on
DO $$
DECLARE
    v_del_cnt integer;
    v_tel_cnt integer;
BEGIN
    SELECT count(*) INTO v_del_cnt
    FROM public.notification_deliveries
    WHERE campaign_id IN (
        '57520000-0000-0000-0000-000000000003'::uuid,
        '57520000-0000-0000-0000-000000000004'::uuid
    );
    SELECT count(*) INTO v_tel_cnt FROM public.notification_telemetry;
    IF v_del_cnt <> 2 OR v_tel_cnt <> 2 THEN
        RAISE EXCEPTION 'Rollback integrity failure: expected deliveries=2, telemetry=2 intact after MV409 abort; got deliveries=%, telemetry=%',
            v_del_cnt, v_tel_cnt;
    END IF;
    RAISE NOTICE '[PASS] Fail-closed atomic rollback verified: deliveries=%, telemetry=% 100%% preserved.', v_del_cnt, v_tel_cnt;
END $$;

