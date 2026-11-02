-- ============================================================================
-- TRANSFER RACE: Session 1 Two-Way Handshake Token Transfer (R3.1)
-- File: tests/db/session1_transfer_race.sql
-- ============================================================================

\set ON_ERROR_STOP on

-- Ensure clean session state
SELECT pg_advisory_unlock_all();

-- 1. Start Transfer Transaction
BEGIN;

DO $$
DECLARE
    v_start timestamptz := clock_timestamp();
    v_xact bigint := txid_current();
    v_waited interval := '0 seconds'::interval;
BEGIN
    -- Record transfer session start
    INSERT INTO public.transfer_race_audit (
        session_name, deliveries_returned, raw_token_returned, xact_id, tx_start
    ) VALUES (
        'session_1_transfer', 0, false, v_xact, v_start
    );

    -- Execute ownership transfer (triggers cancellation of in-flight deliveries)
    UPDATE public.notification_tokens
    SET user_id = '00000000-0000-0000-0000-000000000002',
        updated_at = NOW()
    WHERE device_name = 'transfer_seed_device';

    -- Signal Session 2: Transfer ownership update is in progress (Signal 88001)
    PERFORM pg_advisory_lock(88001);

    -- Await Session 2's concurrent arrival signal (Signal 88002)
    WHILE NOT EXISTS (
        SELECT 1 FROM pg_locks 
        WHERE locktype = 'advisory' AND objid = 88002 AND granted = true
    ) LOOP
        PERFORM pg_sleep(0.02);
        v_waited := v_waited + '0.02 seconds'::interval;
        IF v_waited >= '10 seconds'::interval THEN
            RAISE EXCEPTION 'Transfer Session 1 timeout (10s) waiting for Session 2 signal (88002)!';
        END IF;
    END LOOP;

    -- Send Two-Way Acknowledgment: Session 1 acquires ACK lock 88003
    PERFORM pg_advisory_lock(88003);

    -- Record transaction end timestamp prior to commit
    UPDATE public.transfer_race_audit
    SET tx_end = clock_timestamp()
    WHERE session_name = 'session_1_transfer';
END $$;

COMMIT;

-- Closed-loop handshake: Session 1 holds ACK (88003) until Session 2 has confirmed receipt and released 88002
DO $$
DECLARE
    v_waited interval := '0 seconds'::interval;
BEGIN
    WHILE EXISTS (
        SELECT 1 FROM pg_locks 
        WHERE locktype = 'advisory' AND objid = 88002 AND granted = true
    ) LOOP
        PERFORM pg_sleep(0.02);
        v_waited := v_waited + '0.02 seconds'::interval;
        IF v_waited >= '10 seconds'::interval THEN
            EXIT;
        END IF;
    END LOOP;
END $$;

-- Release session locks held by Session 1
SELECT pg_advisory_unlock(88001);
SELECT pg_advisory_unlock(88003);
