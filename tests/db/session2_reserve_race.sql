-- ============================================================================
-- TRANSFER RACE: Session 2 Two-Way Handshake Reservation Under Race (R3.1)
-- File: tests/db/session2_reserve_race.sql
-- ============================================================================

\set ON_ERROR_STOP on

-- Ensure clean session state
SELECT pg_advisory_unlock_all();

-- 1. Explicit Handshake: Await Session 1's signal that transfer is in progress (Signal 88001)
DO $$
DECLARE
    v_waited interval := '0 seconds'::interval;
BEGIN
    WHILE NOT EXISTS (
        SELECT 1 FROM pg_locks 
        WHERE locktype = 'advisory' AND objid = 88001 AND granted = true
    ) LOOP
        PERFORM pg_sleep(0.02);
        v_waited := v_waited + '0.02 seconds'::interval;
        IF v_waited >= '10 seconds'::interval THEN
            RAISE EXCEPTION 'Reserve Session 2 timeout (10s) waiting for Session 1 transfer signal (88001)!';
        END IF;
    END LOOP;
END $$;

-- 2. Signal Session 1: Session 2 is actively attempting reservation
SELECT pg_advisory_lock(88002);

-- 3. Reliable Two-Way Handshake: Wait for Session 1 ACK (Signal 88003)
DO $$
DECLARE
    v_waited interval := '0 seconds'::interval;
BEGIN
    WHILE NOT EXISTS (
        SELECT 1 FROM pg_locks 
        WHERE locktype = 'advisory' AND objid = 88003 AND granted = true
    ) LOOP
        PERFORM pg_sleep(0.02);
        v_waited := v_waited + '0.02 seconds'::interval;
        IF v_waited >= '10 seconds'::interval THEN
            RAISE EXCEPTION 'Reserve Session 2 timeout (10s) waiting for Session 1 ACK signal (88003)!';
        END IF;
    END LOOP;
END $$;

-- 4. Session 2 begins its reservation transaction
BEGIN;

DO $$
DECLARE
    v_start timestamptz := clock_timestamp();
    v_xact bigint := txid_current();
    v_ret_cnt integer := 0;
    v_has_raw boolean := false;
BEGIN
    -- Attempt reservation on the transferred token
    WITH claimed AS (
        SELECT * FROM public.reserve_notification_deliveries('worker_transfer_session2', 10, 30)
        WHERE token_id IN (SELECT id FROM public.notification_tokens WHERE device_name = 'transfer_seed_device')
    )
    SELECT COUNT(*)::integer, COALESCE(bool_or(raw_token IS NOT NULL), false)
    INTO v_ret_cnt, v_has_raw
    FROM claimed;

    -- Record audit result
    INSERT INTO public.transfer_race_audit (
        session_name, deliveries_returned, raw_token_returned, xact_id, tx_start, tx_end
    ) VALUES (
        'session_2', v_ret_cnt, v_has_raw, v_xact, v_start, clock_timestamp()
    );
END $$;

COMMIT;

-- Release session lock held by Session 2
SELECT pg_advisory_unlock(88002);
