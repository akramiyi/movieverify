\set ON_ERROR_STOP on
SELECT pg_advisory_unlock_all();
SELECT pg_advisory_lock(95201);

DO $$
DECLARE v_w interval := '0 seconds';
BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 95202 AND granted = true) LOOP
        PERFORM pg_sleep(0.02);
        v_w := v_w + '0.02 seconds'::interval;
        IF v_w >= '15 seconds'::interval THEN RAISE EXCEPTION 'A2 S1 timeout awaiting S2'; END IF;
    END LOOP;
END $$;

BEGIN;
DO $$
DECLARE
    v_start timestamptz := clock_timestamp();
    v_xact bigint := txid_current();
    v_pid integer := pg_backend_pid();
    v_locked_id uuid;
    v_blocked_pid integer := NULL;
    v_w interval := '0 seconds';
    v_sqlstate text := '00000';
    v_deadlock boolean := false;
BEGIN
    -- Hold row lock on delivery d5 (campC)
    SELECT id INTO v_locked_id
    FROM public.notification_deliveries
    WHERE id = '595a3000-0000-0000-0000-000000000005'::uuid
    FOR UPDATE;

    -- Signal S2 to call cancel_notification_campaign(campC), which will block on d5
    PERFORM pg_advisory_lock(95203);

    -- Wait until PostgreSQL proves S2 is blocked specifically by our PID on a Lock
    WHILE v_blocked_pid IS NULL LOOP
        SELECT a.pid INTO v_blocked_pid
        FROM pg_stat_activity a
        WHERE a.pid <> pg_backend_pid()
          AND a.wait_event_type = 'Lock'
          AND pg_backend_pid() = ANY(pg_blocking_pids(a.pid))
        LIMIT 1;

        EXIT WHEN v_blocked_pid IS NOT NULL;
        PERFORM pg_sleep(0.02);
        v_w := v_w + '0.02 seconds'::interval;
        IF v_w >= '15 seconds'::interval THEN
            RAISE EXCEPTION 'A2 S1 did not observe S2 blocking on delivery row lock';
        END IF;
    END LOOP;

    -- Hold lock visibly for 300ms while S2 is in Lock wait state
    PERFORM pg_sleep(0.30);

    -- Simulate sweep release of d5 to 'pending' (incrementing retry_count) before S1 commits
    UPDATE public.notification_deliveries
    SET delivery_status = 'pending',
        retry_count = retry_count + 1,
        lease_token = NULL,
        lease_expires_at = NULL,
        worker_id = NULL,
        dispatch_attempt_id = NULL,
        updated_at = NOW()
    WHERE id = v_locked_id;

    INSERT INTO public.p5910_conc_audit (
        suite, session_name, xact_id, backend_pid, tx_start, tx_end, sqlstate, deadlock_detected, metrics
    )
    VALUES (
        'a2_reverse_lock', 's1_delivery_lock_holder', v_xact, v_pid, v_start, clock_timestamp(), v_sqlstate, v_deadlock,
        jsonb_build_object('locked_delivery_id', v_locked_id, 'blocked_s2_pid', v_blocked_pid, 'lock_wait_observed', true)
    );
END $$;
COMMIT;
SELECT pg_advisory_unlock_all();

