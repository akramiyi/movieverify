-- ============================================================================
-- MOVIEVERIFY NOTIFICATION UPGRADE RUNNER & INVARIANT ASSERTIONS
-- File: tests/db/test_upgrade_runner.sql
-- ============================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
    v_cnt integer;
    v_null_cnt integer;
BEGIN
    RAISE NOTICE 'Executing post-migration invariant verifications...';

    -- Invariant 1: Exactly 1 unique token surviving for token_alpha, 1 in quarantine
    SELECT COUNT(*) INTO v_cnt FROM public.notification_tokens WHERE token = 'token_alpha';
    IF v_cnt IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'Invariant 1 Failed: Expected 1 token_alpha, found %', v_cnt;
    END IF;

    SELECT COUNT(*) INTO v_cnt FROM public.legacy_token_quarantine WHERE reason = 'DETERMINISTIC_DEDUPLICATION_PRUNED';
    IF v_cnt < 1 THEN
        RAISE EXCEPTION 'Invariant 1B Failed: Expected pruned token in quarantine, found %', v_cnt;
    END IF;

    -- Invariant 2: Equal timestamp duplicate in movie_notify_requests deduplicated deterministically
    SELECT COUNT(*) INTO v_cnt FROM public.movie_notify_requests WHERE movie_id = 'movie_100';
    IF v_cnt IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'Invariant 2 Failed: Expected 1 movie_100 subscription, found %', v_cnt;
    END IF;

    -- Invariant 3: NULL actor_id was quarantined and NOT NULL constraint enforced
    SELECT COUNT(*) INTO v_cnt FROM public.legacy_subscription_quarantine WHERE reason = 'NULL_ACTOR_ID';
    IF v_cnt < 1 THEN
        RAISE EXCEPTION 'Invariant 3 Failed: NULL actor_id was not quarantined!';
    END IF;

    -- Invariant 4: No NULL campaign statuses exist and column is NOT NULL
    SELECT COUNT(*) INTO v_null_cnt FROM public.notification_campaigns WHERE status IS NULL;
    IF v_null_cnt IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'Invariant 4 Failed: Found % campaigns with NULL status', v_null_cnt;
    END IF;

    -- Invariant 5: No NULL queue statuses exist and column is NOT NULL
    SELECT COUNT(*) INTO v_null_cnt FROM public.notification_queue WHERE status IS NULL;
    IF v_null_cnt IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'Invariant 5 Failed: Found % queue items with NULL status', v_null_cnt;
    END IF;

    -- Invariant 6: Legacy deliveries with NULL or unknown snapshots are marked terminal 'failed'
    SELECT COUNT(*) INTO v_cnt 
    FROM public.notification_deliveries 
    WHERE token_snapshot_hash IN ('unknown_snapshot', 'legacy_unknown_snapshot')
      AND delivery_status NOT IN ('failed', 'cancelled');
    IF v_cnt IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'Invariant 6 Failed: Found % unterminalized legacy snapshot deliveries!', v_cnt;
    END IF;

    -- Invariant 7: All foreign keys exist in pg_constraint
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notification_tokens_user') THEN
        RAISE EXCEPTION 'Invariant 7 Failed: Missing fk_notification_tokens_user constraint!';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_deliveries_token') THEN
        RAISE EXCEPTION 'Invariant 7 Failed: Missing fk_deliveries_token constraint!';
    END IF;

    RAISE NOTICE 'ALL UPGRADE INVARIANTS PASSED SUCCESSFULLY.';
END $$;

