\set ON_ERROR_STOP on
SELECT pg_advisory_unlock_all();
SELECT pg_advisory_lock(95102);

DO $$
DECLARE v_w interval := '0 seconds';
BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 95101 AND granted = true) LOOP
        PERFORM pg_sleep(0.02);
        v_w := v_w + '0.02 seconds'::interval;
        IF v_w >= '15 seconds'::interval THEN RAISE EXCEPTION 'A1 S2 timeout awaiting S1'; END IF;
    END LOOP;
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 95103 AND granted = true) LOOP
        PERFORM pg_sleep(0.01);
        v_w := v_w + '0.01 seconds'::interval;
        IF v_w >= '15 seconds'::interval THEN RAISE EXCEPTION 'A1 S2 timeout awaiting S1 FOR UPDATE lock barrier (95103)'; END IF;
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
    v_eligible_total integer := 0;
    v_s1_row_lock_active boolean := false;
    v_swept integer := 0;
    v_skipped integer := 0;
    v_sqlstate text := '00000';
    v_deadlock boolean := false;
BEGIN
    -- Observe eligible expired rows and S1's active RowExclusiveLock on notification_deliveries
    SELECT count(*)::integer INTO v_eligible_total
    FROM public.notification_deliveries
    WHERE delivery_status = 'leased'
      AND lease_expires_at <= NOW();

    SELECT EXISTS (
        SELECT 1
        FROM pg_locks
        WHERE relation = 'public.notification_deliveries'::regclass
          AND mode IN ('RowShareLock', 'RowExclusiveLock')
          AND granted = true
          AND pid <> pg_backend_pid()
    ) INTO v_s1_row_lock_active;

    BEGIN
        v_swept := public.sweep_expired_delivery_reservations();
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
        v_deadlock := (v_sqlstate = '40P01');
    END;

    v_skipped := GREATEST(v_eligible_total - v_swept, 0);

    -- Signal S1 that sweep finished while S1 still holds d1, d3 uncommitted
    PERFORM pg_advisory_lock(95104);
    PERFORM pg_sleep(0.10);

    INSERT INTO public.p5910_conc_audit (
        suite, session_name, xact_id, backend_pid, tx_start, tx_end, sqlstate, deadlock_detected, metrics
    )
    VALUES (
        'a1_cancel_sweep', 's2_sweep', v_xact, v_pid, v_start, clock_timestamp(), v_sqlstate, v_deadlock,
        jsonb_build_object(
            'eligible_before', v_eligible_total,
            'swept', v_swept,
            'skipped_by_skip_locked', v_skipped,
            's1_row_lock_active', v_s1_row_lock_active
        )
    );
END $$;
COMMIT;
SELECT pg_advisory_unlock_all();

