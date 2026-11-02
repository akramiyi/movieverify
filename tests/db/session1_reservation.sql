-- ============================================================================
-- CONCURRENCY WORKER 1: Deterministic Two-Way Handshake Reservation (R3.1)
-- File: tests/db/session1_reservation.sql
-- ============================================================================

\set ON_ERROR_STOP on

-- Ensure clean session state
SELECT pg_advisory_unlock_all();

-- 1. Start Worker 1 Reservation Transaction
BEGIN;

DO $$
DECLARE
    v_start timestamptz := clock_timestamp();
    v_xact bigint := txid_current();
    v_claimed_cnt integer := 0;
    v_waited interval := '0 seconds'::interval;
BEGIN
    -- Claim batch of 3 deliveries
    INSERT INTO public.concurrency_test_claims (worker_id, delivery_id, xact_id, tx_start, claimed_at)
    SELECT 'worker_1', delivery_id, v_xact, v_start, clock_timestamp()
    FROM public.reserve_notification_deliveries('worker_1', 3, 60);

    GET DIAGNOSTICS v_claimed_cnt = ROW_COUNT;
    IF v_claimed_cnt <> 3 THEN
        RAISE EXCEPTION 'Worker 1 expected to claim 3 deliveries, got %', v_claimed_cnt;
    END IF;

    -- Signal Worker 2: Worker 1 has locked its rows (Signal 77001)
    PERFORM pg_advisory_lock(77001);

    -- Await Worker 2's signal (lock 77002) proving Worker 2 is executing concurrently
    WHILE NOT EXISTS (
        SELECT 1 FROM pg_locks 
        WHERE locktype = 'advisory' AND objid = 77002 AND granted = true
    ) LOOP
        PERFORM pg_sleep(0.02);
        v_waited := v_waited + '0.02 seconds'::interval;
        IF v_waited >= '10 seconds'::interval THEN
            RAISE EXCEPTION 'Worker 1 timeout (10s) waiting for Worker 2 concurrent execution signal (77002)!';
        END IF;
    END LOOP;

    -- Send Two-Way Acknowledgment: Worker 1 acquires ACK lock 77003
    PERFORM pg_advisory_lock(77003);

    -- Record transaction end timestamp prior to commit
    UPDATE public.concurrency_test_claims
    SET tx_end = clock_timestamp()
    WHERE worker_id = 'worker_1';
END $$;

COMMIT;

-- Closed-loop handshake: Worker 1 holds ACK (77003) until Worker 2 has confirmed receipt and released 77002
DO $$
DECLARE
    v_waited interval := '0 seconds'::interval;
BEGIN
    WHILE EXISTS (
        SELECT 1 FROM pg_locks 
        WHERE locktype = 'advisory' AND objid = 77002 AND granted = true
    ) LOOP
        PERFORM pg_sleep(0.02);
        v_waited := v_waited + '0.02 seconds'::interval;
        IF v_waited >= '10 seconds'::interval THEN
            EXIT;
        END IF;
    END LOOP;
END $$;

-- Release session locks held by Worker 1
SELECT pg_advisory_unlock(77001);
SELECT pg_advisory_unlock(77003);
