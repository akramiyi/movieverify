-- ============================================================================
-- CONCURRENCY WORKER 2: Deterministic Two-Way Handshake Reservation (R3.1)
-- File: tests/db/session2_reservation.sql
-- ============================================================================

\set ON_ERROR_STOP on

-- Ensure clean session state
SELECT pg_advisory_unlock_all();

-- 1. Explicit Handshake: Await Worker 1's signal that it has locked its rows (lock 77001)
DO $$
DECLARE
    v_waited interval := '0 seconds'::interval;
BEGIN
    WHILE NOT EXISTS (
        SELECT 1 FROM pg_locks 
        WHERE locktype = 'advisory' AND objid = 77001 AND granted = true
    ) LOOP
        PERFORM pg_sleep(0.02);
        v_waited := v_waited + '0.02 seconds'::interval;
        IF v_waited >= '10 seconds'::interval THEN
            RAISE EXCEPTION 'Worker 2 timeout (10s) waiting for Worker 1 row-lock signal (77001)!';
        END IF;
    END LOOP;
END $$;

-- 2. Worker 2 starts its overlapping reservation transaction
BEGIN;

DO $$
DECLARE
    v_start timestamptz := clock_timestamp();
    v_xact bigint := txid_current();
    v_claimed_cnt integer := 0;
    v_waited interval := '0 seconds'::interval;
BEGIN
    -- Claim batch: SKIP LOCKED skips Worker 1's locked rows and claims the remaining 3
    INSERT INTO public.concurrency_test_claims (worker_id, delivery_id, xact_id, tx_start, claimed_at)
    SELECT 'worker_2', delivery_id, v_xact, v_start, clock_timestamp()
    FROM public.reserve_notification_deliveries('worker_2', 3, 60);

    GET DIAGNOSTICS v_claimed_cnt = ROW_COUNT;
    IF v_claimed_cnt <> 3 THEN
        RAISE EXCEPTION 'Worker 2 expected to claim 3 deliveries, got %', v_claimed_cnt;
    END IF;

    -- Signal Worker 1: Worker 2 has executed its claim concurrently (Signal 77002)
    PERFORM pg_advisory_lock(77002);

    -- Reliable Two-Way Handshake: Worker 2 MUST NOT release 77002 until Worker 1 acknowledges (lock 77003)
    WHILE NOT EXISTS (
        SELECT 1 FROM pg_locks 
        WHERE locktype = 'advisory' AND objid = 77003 AND granted = true
    ) LOOP
        PERFORM pg_sleep(0.02);
        v_waited := v_waited + '0.02 seconds'::interval;
        IF v_waited >= '10 seconds'::interval THEN
            RAISE EXCEPTION 'Worker 2 timeout (10s) waiting for Worker 1 ACK signal (77003)!';
        END IF;
    END LOOP;

    -- Record transaction end timestamp prior to commit
    UPDATE public.concurrency_test_claims
    SET tx_end = clock_timestamp()
    WHERE worker_id = 'worker_2';
END $$;

COMMIT;

-- Release session lock held by Worker 2
SELECT pg_advisory_unlock(77002);
