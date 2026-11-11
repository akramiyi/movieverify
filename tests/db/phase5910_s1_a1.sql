\set ON_ERROR_STOP on
SELECT pg_advisory_unlock_all();
SELECT pg_advisory_lock(95101);

DO $$
DECLARE v_w interval := '0 seconds';
BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 95102 AND granted = true) LOOP
        PERFORM pg_sleep(0.02);
        v_w := v_w + '0.02 seconds'::interval;
        IF v_w >= '15 seconds'::interval THEN RAISE EXCEPTION 'A1 S1 timeout awaiting S2'; END IF;
    END LOOP;
END $$;

BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
    v_start timestamptz := clock_timestamp();
    v_xact bigint := txid_current();
    v_pid integer := pg_backend_pid();
    v_locked_count integer := 0;
    v_w interval := '0 seconds';
    v_cancel_res jsonb;
    v_sqlstate text := '00000';
    v_deadlock boolean := false;
BEGIN
    -- Lock d1 and d3 explicitly FOR UPDATE while S2 waits for advisory lock 95103
    SELECT count(*)::integer INTO v_locked_count
    FROM (
        SELECT id
        FROM public.notification_deliveries
        WHERE id IN (
            '595a3000-0000-0000-0000-000000000001'::uuid,
            '595a3000-0000-0000-0000-000000000003'::uuid
        )
        ORDER BY id ASC
        FOR UPDATE
    ) locked;

    -- Signal S2 that d1 and d3 are locked inside S1's uncommitted transaction
    PERFORM pg_advisory_lock(95103);

    -- Hold row locks until S2 has called sweep_expired_delivery_reservations() and set ack 95104
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 95104 AND granted = true) LOOP
        PERFORM pg_sleep(0.02);
        v_w := v_w + '0.02 seconds'::interval;
        IF v_w >= '15 seconds'::interval THEN RAISE EXCEPTION 'A1 S1 timeout awaiting S2 sweep ack (95104)'; END IF;
    END LOOP;

    -- Minimum hold to guarantee unmistakable overlap window
    PERFORM pg_sleep(0.15);

    BEGIN
        v_cancel_res := public.cancel_notification_campaign('595a2000-0000-0000-0000-000000000001'::uuid);
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
        v_deadlock := (v_sqlstate = '40P01');
        v_cancel_res := jsonb_build_object('error', SQLERRM, 'sqlstate', v_sqlstate);
    END;

    INSERT INTO public.p5910_conc_audit (
        suite, session_name, xact_id, backend_pid, tx_start, tx_end, sqlstate, deadlock_detected, metrics
    )
    VALUES (
        'a1_cancel_sweep', 's1_cancel_holder', v_xact, v_pid, v_start, clock_timestamp(), v_sqlstate, v_deadlock,
        jsonb_build_object('locked_rows', v_locked_count, 'cancel_result', v_cancel_res)
    );
END $$;
COMMIT;
SELECT pg_advisory_unlock_all();

