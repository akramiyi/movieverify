\set ON_ERROR_STOP on
SELECT pg_advisory_unlock_all();
SELECT pg_advisory_lock(95202);

DO $$
DECLARE v_w interval := '0 seconds';
BEGIN
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 95201 AND granted = true) LOOP
        PERFORM pg_sleep(0.02);
        v_w := v_w + '0.02 seconds'::interval;
        IF v_w >= '15 seconds'::interval THEN RAISE EXCEPTION 'A2 S2 timeout awaiting S1'; END IF;
    END LOOP;
    WHILE NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 95203 AND granted = true) LOOP
        PERFORM pg_sleep(0.01);
        v_w := v_w + '0.01 seconds'::interval;
        IF v_w >= '15 seconds'::interval THEN RAISE EXCEPTION 'A2 S2 timeout awaiting S1 lock barrier (95203)'; END IF;
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
    v_cancel_res jsonb;
    v_sqlstate text := '00000';
    v_deadlock boolean := false;
BEGIN
    BEGIN
        -- Blocks on d5 until S1 commits, then resolves cleanly and cancels both d5 & d6
        v_cancel_res := public.cancel_notification_campaign('595a2000-0000-0000-0000-000000000003'::uuid);
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
        v_deadlock := (v_sqlstate = '40P01');
        v_cancel_res := jsonb_build_object('error', SQLERRM, 'sqlstate', v_sqlstate);
    END;

    INSERT INTO public.p5910_conc_audit (
        suite, session_name, xact_id, backend_pid, tx_start, tx_end, sqlstate, deadlock_detected, metrics
    )
    VALUES (
        'a2_reverse_lock', 's2_cancel_waiter', v_xact, v_pid, v_start, clock_timestamp(), v_sqlstate, v_deadlock,
        jsonb_build_object('cancel_result', v_cancel_res)
    );
END $$;
COMMIT;
SELECT pg_advisory_unlock_all();

