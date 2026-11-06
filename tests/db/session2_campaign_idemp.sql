-- ============================================================================
-- CAMPAIGN IDEMPOTENCY CONCURRENCY RACE: SESSION 2
-- File: tests/db/session2_campaign_idemp.sql
-- ============================================================================

\set ON_ERROR_STOP on

SELECT pg_advisory_unlock_all();

-- 1. Await Session 1's ready signal (77011)
DO $$
DECLARE
    v_waited interval := '0 seconds'::interval;
BEGIN
    WHILE NOT EXISTS (
        SELECT 1 FROM pg_locks 
        WHERE locktype = 'advisory' AND objid = 77011 AND granted = true
    ) LOOP
        PERFORM pg_sleep(0.02);
        v_waited := v_waited + '0.02 seconds'::interval;
        IF v_waited >= '10 seconds'::interval THEN
            RAISE EXCEPTION 'Session 2 timeout (10s) waiting for Session 1 ready signal (77011)!';
        END IF;
    END LOOP;
END $$;

-- 2. Signal Session 1 that Session 2 is ready (77012)
SELECT pg_advisory_lock(77012);

-- 3. Await Session 1 entering transaction and acquiring xact lock (77013)
DO $$
DECLARE
    v_waited interval := '0 seconds'::interval;
BEGIN
    WHILE NOT EXISTS (
        SELECT 1 FROM pg_locks 
        WHERE locktype = 'advisory' AND objid = 77013 AND granted = true
    ) LOOP
        PERFORM pg_sleep(0.02);
        v_waited := v_waited + '0.02 seconds'::interval;
        IF v_waited >= '10 seconds'::interval THEN
            RAISE EXCEPTION 'Session 2 timeout (10s) waiting for Session 1 in-flight signal (77013)!';
        END IF;
    END LOOP;
END $$;

-- 4. Session 2 enters transaction and attempts to ingest with the EXACT same idempotency key
BEGIN;

DO $$
DECLARE
    v_start timestamptz := clock_timestamp();
    v_xact bigint := txid_current();
    v_res jsonb;
BEGIN
    -- This call blocks on pg_advisory_xact_lock until Session 1 commits!
    v_res := public.ingest_notification_campaign(
        'Concurrent Race Campaign S2 (Attempt)',
        'Ingestion by session 2 in race',
        'movie_release',
        '/movies/concurrency-race',
        NULL,
        '{"type": "all", "idempotency_key": "concurrency_race_idemp_key_1"}'::jsonb,
        NULL,
        '00000000-0000-0000-0000-000000000001'::uuid
    );

    -- Record Session 2 audit row
    INSERT INTO public.campaign_idemp_race_audit (
        session_name, campaign_id, already_exists, total_recipients, total_deliveries, xact_id, tx_start, tx_end
    ) VALUES (
        'session_2',
        (v_res->>'campaign_id')::uuid,
        (v_res->>'already_exists')::boolean,
        (v_res->>'total_recipients')::integer,
        (v_res->>'total_deliveries')::integer,
        v_xact,
        v_start,
        clock_timestamp()
    );
END $$;

COMMIT;

-- Release session-level advisory locks
SELECT pg_advisory_unlock_all();

