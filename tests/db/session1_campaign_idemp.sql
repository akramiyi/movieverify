-- ============================================================================
-- CAMPAIGN IDEMPOTENCY CONCURRENCY RACE: SESSION 1
-- File: tests/db/session1_campaign_idemp.sql
-- ============================================================================

\set ON_ERROR_STOP on

SELECT pg_advisory_unlock_all();

-- 1. Session 1 signals it is ready (Signal 77011)
SELECT pg_advisory_lock(77011);

-- 2. Await Session 2 signal (Signal 77012) proving Session 2 is executing concurrently
DO $$
DECLARE
    v_waited interval := '0 seconds'::interval;
BEGIN
    WHILE NOT EXISTS (
        SELECT 1 FROM pg_locks 
        WHERE locktype = 'advisory' AND objid = 77012 AND granted = true
    ) LOOP
        PERFORM pg_sleep(0.02);
        v_waited := v_waited + '0.02 seconds'::interval;
        IF v_waited >= '10 seconds'::interval THEN
            RAISE EXCEPTION 'Session 1 timeout (10s) waiting for Session 2 ready signal (77012)!';
        END IF;
    END LOOP;
END $$;

-- 3. Enter transaction and ingest campaign with idempotency key
BEGIN;

DO $$
DECLARE
    v_start timestamptz := clock_timestamp();
    v_xact bigint := txid_current();
    v_res jsonb;
BEGIN
    -- Signal Session 2 that Session 1 has started its transaction (Signal 77013)
    PERFORM pg_advisory_lock(77013);

    -- Call ingest_notification_campaign with idempotency key
    v_res := public.ingest_notification_campaign(
        'Concurrent Race Campaign S1',
        'Ingestion by session 1 in race',
        'movie_release',
        '/movies/concurrency-race',
        NULL,
        '{"type": "all", "idempotency_key": "concurrency_race_idemp_key_1"}'::jsonb,
        NULL,
        '00000000-0000-0000-0000-000000000001'::uuid
    );

    -- Record Session 1 audit row
    INSERT INTO public.campaign_idemp_race_audit (
        session_name, campaign_id, already_exists, total_recipients, total_deliveries, xact_id, tx_start, tx_end
    ) VALUES (
        'session_1',
        (v_res->>'campaign_id')::uuid,
        (v_res->>'already_exists')::boolean,
        (v_res->>'total_recipients')::integer,
        (v_res->>'total_deliveries')::integer,
        v_xact,
        v_start,
        clock_timestamp()
    );

    -- Sleep briefly so Session 2 invokes its call and queues behind the xact advisory lock
    PERFORM pg_sleep(0.3);
END $$;

COMMIT;

-- Release session-level advisory locks
SELECT pg_advisory_unlock_all();

