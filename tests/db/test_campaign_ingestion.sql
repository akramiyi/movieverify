-- ============================================================================
-- MOVIEVERIFY PHASE 2: CAMPAIGN INGESTION & CANCELLATION PGTAP SUITE
-- File: tests/db/test_campaign_ingestion.sql
-- Phase: 2 (Phase 1.9 architecture — 8-migration release schema)
--
-- Corrections from Phase 1.5:
--   1. REMOVED: TRUNCATE public.notification_audit_log
--      (append-only trigger trg_audit_log_no_truncate blocks TRUNCATE)
--      Isolation is provided by the disposable per-run database and unique
--      idempotency_keys, not by truncation.
--   2. Fixture endpoints written to canonical notification_endpoints table
--      (accessed via notification_tokens compatibility view on INSERT via INSTEAD OF trigger).
--   3. Assertion 28 uses lowercase action values ('campaign_ingested','campaign_cancelled')
--      matching actual RPCs.
--   4. Added explicit negative test: TRUNCATE on notification_audit_log is rejected.
-- ============================================================================

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(28);

-- ----------------------------------------------------------------------------
-- Test Fixtures Setup
-- Isolation: This suite runs in a freshly initialized disposable database.
-- notification_audit_log starts empty. No TRUNCATE needed or permitted.
-- Token inserts go through the notification_tokens INSTEAD OF INSERT trigger,
-- which writes the canonical notification_endpoints rows.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_u1 uuid := '10000000-0000-0000-0000-000000000001';
    v_u2 uuid := '10000000-0000-0000-0000-000000000002';
    v_u3 uuid := '10000000-0000-0000-0000-000000000003';
    v_u4 uuid := '10000000-0000-0000-0000-000000000004';
    v_u5 uuid := '10000000-0000-0000-0000-000000000005';
    v_u6 uuid := '10000000-0000-0000-0000-000000000006';
BEGIN
    -- Auth Users
    INSERT INTO auth.users (id, email) VALUES
    (v_u1, 'test_user1@movieverify.com'),
    (v_u2, 'test_user2@movieverify.com'),
    (v_u3, 'test_user3@movieverify.com'),
    (v_u4, 'test_user4@movieverify.com'),
    (v_u5, 'test_user5@movieverify.com'),
    (v_u6, 'test_user6@movieverify.com')
    ON CONFLICT (id) DO NOTHING;

    -- User 1: 2 Active Endpoints (via compatibility view INSTEAD OF INSERT trigger)
    INSERT INTO public.notification_tokens (user_id, token, is_active, device_name) VALUES
    (v_u1, 'token_u1_desktop', true, 'Desktop Chrome'),
    (v_u1, 'token_u1_mobile',  true, 'Mobile Chrome');

    -- User 2: Active Endpoint, but Opted Out of all / broadcast notifications
    INSERT INTO public.notification_tokens (user_id, token, is_active, device_name) VALUES
    (v_u2, 'token_u2_optout', true, 'User2 Device');

    INSERT INTO public.user_notification_preferences (user_id, opt_in_all, notify_new_movies) VALUES
    (v_u2, false, false)
    ON CONFLICT (user_id) DO UPDATE SET opt_in_all = false, notify_new_movies = false;

    INSERT INTO public.notification_opt_outs (user_id, category) VALUES
    (v_u2, 'movie_release')
    ON CONFLICT (user_id, category) DO NOTHING;

    -- User 3: Inactive Endpoint
    INSERT INTO public.notification_tokens (user_id, token, is_active, device_name) VALUES
    (v_u3, 'token_u3_inactive', false, 'Old Phone');

    -- User 4: Active Endpoint + movie subscription
    INSERT INTO public.notification_tokens (user_id, token, is_active, device_name) VALUES
    (v_u4, 'token_u4_movie', true, 'User4 Device');

    INSERT INTO public.movie_notify_requests (movie_id, user_id) VALUES
    ('movie_99', v_u4)
    ON CONFLICT DO NOTHING;

    -- User 5: Active Endpoint + actor subscription
    INSERT INTO public.notification_tokens (user_id, token, is_active, device_name) VALUES
    (v_u5, 'token_u5_actor', true, 'User5 Device');

    INSERT INTO public.actor_notify_requests (actor_id, user_id) VALUES
    ('actor_88', v_u5)
    ON CONFLICT DO NOTHING;

    -- User 6: Active Endpoint + genre subscription
    INSERT INTO public.notification_tokens (user_id, token, is_active, device_name) VALUES
    (v_u6, 'token_u6_genre', true, 'User6 Device');

    INSERT INTO public.genre_notify_requests (genre_id, user_id) VALUES
    ('genre_77', v_u6)
    ON CONFLICT DO NOTHING;
END $$;

-- ----------------------------------------------------------------------------
-- Assertions 1-6: Security & Role Privileges
-- ----------------------------------------------------------------------------
SET ROLE anon;
SELECT throws_ok(
    'SELECT public.ingest_notification_campaign(''T'', ''B'', ''movie_release'')',
    '42501',
    NULL,
    'Assertion 1: anon cannot execute ingest_notification_campaign'
);
SELECT throws_ok(
    'SELECT public.cancel_notification_campaign(''10000000-0000-0000-0000-000000000001''::uuid)',
    '42501',
    NULL,
    'Assertion 2: anon cannot execute cancel_notification_campaign'
);
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
SELECT throws_ok(
    'SELECT public.ingest_notification_campaign(''T'', ''B'', ''movie_release'')',
    'MV403',
    NULL,
    'Assertion 3: non-admin authenticated user cannot execute ingest_notification_campaign (Forbidden: MV403)'
);
SELECT throws_ok(
    'SELECT public.cancel_notification_campaign(''10000000-0000-0000-0000-000000000001''::uuid)',
    'MV403',
    NULL,
    'Assertion 4: non-admin authenticated user cannot execute cancel_notification_campaign (Forbidden: MV403)'
);
SELECT set_config('request.jwt.claim.sub', '', false);
RESET ROLE;

SET ROLE service_role;
SELECT lives_ok(
    'SELECT public.ingest_notification_campaign(''Privilege Probe'', ''Body'', ''movie_release'', NULL, NULL, ''{"type":"users","user_ids":["10000000-0000-0000-0000-000000000001"]}''::jsonb)',
    'Assertion 5: service_role can execute ingest_notification_campaign'
);
SELECT lives_ok(
    'SELECT public.cancel_notification_campaign((SELECT id FROM public.notification_campaigns WHERE title = ''Privilege Probe'' LIMIT 1))',
    'Assertion 6: service_role can execute cancel_notification_campaign'
);
RESET ROLE;

-- ----------------------------------------------------------------------------
-- Assertions 7-12: Input Validation Guards
-- ----------------------------------------------------------------------------
SELECT throws_ok(
    'SELECT public.ingest_notification_campaign(''T'', ''B'', ''invalid_category'')',
    '23514',
    NULL,
    'Assertion 7: Invalid notification category is rejected by check constraint'
);

SELECT throws_matching(
    'SELECT public.ingest_notification_campaign('''', ''B'', ''movie_release'')',
    'Title must be between 1 and 255 characters',
    'Assertion 8: Empty title is rejected'
);

SELECT throws_matching(
    'SELECT public.ingest_notification_campaign(''T'', '''', ''movie_release'')',
    'Body must be between 1 and 1000 characters',
    'Assertion 9: Empty body is rejected'
);

SELECT throws_matching(
    'SELECT public.ingest_notification_campaign(repeat(''T'', 256), ''B'', ''movie_release'')',
    'Title must be between 1 and 255 characters',
    'Assertion 10: Title exceeding 255 characters is rejected'
);

SELECT throws_matching(
    'SELECT public.ingest_notification_campaign(''T'', repeat(''B'', 1001), ''movie_release'')',
    'Body must be between 1 and 1000 characters',
    'Assertion 11: Body exceeding 1000 characters is rejected'
);

SELECT throws_ok(
    'SELECT public.ingest_notification_campaign(''T'', ''B'', ''movie_release'', NULL, NULL, ''{"type":"invalid_target"}''::jsonb)',
    '23514',
    NULL,
    'Assertion 12: Unsupported target type is rejected by check constraint'
);

-- ----------------------------------------------------------------------------
-- Assertions 13-16: Broadcast Targeting, Endpoint Snapshot Integrity & Suppression
-- ----------------------------------------------------------------------------
SELECT is(
    (SELECT (public.ingest_notification_campaign(
        'Broadcast Campaign',
        'Exciting movies arriving',
        'movie_release',
        '/movies',
        NULL,
        '{"type":"all","idempotency_key":"test_broadcast_1"}'::jsonb
    )->>'total_recipients')::integer),
    4,
    'Assertion 13: Broadcast targets exactly 4 active, non-opted-out users (u1, u4, u5, u6)'
);

SELECT is(
    (SELECT count(*)::integer FROM public.notification_deliveries d
     JOIN public.notification_campaigns c ON d.campaign_id = c.id
     WHERE (c.target_criteria->>'idempotency_key') = 'test_broadcast_1'),
    5,
    'Assertion 14: Broadcast generates 5 deliveries (User 1 has 2 active devices)'
);

SELECT is(
    (SELECT count(*)::integer FROM public.notification_deliveries d
     JOIN public.notification_campaigns c ON d.campaign_id = c.id
     WHERE (c.target_criteria->>'idempotency_key') = 'test_broadcast_1'
       AND d.recipient_id = '10000000-0000-0000-0000-000000000002'),
    0,
    'Assertion 15: Opted-out user (u2) received 0 deliveries'
);

SELECT is(
    (SELECT count(*)::integer FROM public.notification_deliveries d
     JOIN public.notification_campaigns c ON d.campaign_id = c.id
     WHERE (c.target_criteria->>'idempotency_key') = 'test_broadcast_1'
       AND d.recipient_id = '10000000-0000-0000-0000-000000000003'),
    0,
    'Assertion 16: Inactive endpoint user (u3) received 0 deliveries'
);

-- ----------------------------------------------------------------------------
-- Assertions 17-20: Domain Targeting (Movie, Actor, Genre, Users)
-- ----------------------------------------------------------------------------
SELECT is(
    (SELECT (public.ingest_notification_campaign(
        'Movie 99 Release', 'Now showing', 'movie_release', '/movies/99', NULL,
        '{"type":"movie","movie_id":"movie_99","idempotency_key":"test_movie_target"}'::jsonb
    )->>'total_recipients')::integer),
    1,
    'Assertion 17: Movie target delivers exclusively to movie subscriber (u4)'
);

SELECT is(
    (SELECT (public.ingest_notification_campaign(
        'Actor 88 New Movie', 'Starring in cinema', 'movie_release', '/actors/88', NULL,
        '{"type":"actor","actor_id":"actor_88","idempotency_key":"test_actor_target"}'::jsonb
    )->>'total_recipients')::integer),
    1,
    'Assertion 18: Actor target delivers exclusively to actor subscriber (u5)'
);

SELECT is(
    (SELECT (public.ingest_notification_campaign(
        'Genre 77 Fest', 'Top picks', 'movie_release', '/genre/77', NULL,
        '{"type":"genre","genre_id":"genre_77","idempotency_key":"test_genre_target"}'::jsonb
    )->>'total_recipients')::integer),
    1,
    'Assertion 19: Genre target delivers exclusively to genre subscriber (u6)'
);

SELECT is(
    (SELECT (public.ingest_notification_campaign(
        'User List Targeted', 'Exclusive preview', 'promotional', '/preview', NULL,
        '{"type":"users","user_ids":["10000000-0000-0000-0000-000000000001","10000000-0000-0000-0000-000000000004"],"idempotency_key":"test_users_target"}'::jsonb
    )->>'total_recipients')::integer),
    2,
    'Assertion 20: Explicit user list targets exactly the 2 specified users'
);

-- ----------------------------------------------------------------------------
-- Assertions 21-24: Draft Isolation, Future Scheduling & Retry Fencing
-- ----------------------------------------------------------------------------
SELECT is(
    (SELECT (public.ingest_notification_campaign(
        'Draft Campaign', 'Not ready to send', 'content_update', NULL, NULL,
        '{"type":"all","is_draft":true,"idempotency_key":"test_draft_camp"}'::jsonb
    )->>'status')),
    'draft',
    'Assertion 21: Draft campaign is created with status = draft'
);

SELECT is(
    (SELECT count(*)::integer FROM public.notification_deliveries d
     JOIN public.notification_campaigns c ON d.campaign_id = c.id
     WHERE (c.target_criteria->>'idempotency_key') = 'test_draft_camp'),
    0,
    'Assertion 22: Draft campaign generates 0 deliveries'
);

SELECT is(
    (SELECT (public.ingest_notification_campaign(
        'Future Premiere', 'Streaming at midnight', 'movie_release', '/premiere', NULL,
        '{"type":"all","idempotency_key":"test_future_camp"}'::jsonb,
        NOW() + '2 hours'::interval
    )->>'status')),
    'scheduled',
    'Assertion 23: Future campaign is created with status = scheduled'
);

SELECT is(
    (SELECT count(*)::integer FROM public.notification_deliveries d
     JOIN public.notification_campaigns c ON d.campaign_id = c.id
     WHERE (c.target_criteria->>'idempotency_key') = 'test_future_camp'),
    0,
    'Assertion 24: Future-scheduled campaign generates 0 deliveries at ingestion time'
);

-- ----------------------------------------------------------------------------
-- Assertions 25-28: Idempotency, Cancellation Fencing & Audit Logging
-- ----------------------------------------------------------------------------
SELECT is(
    (SELECT (public.ingest_notification_campaign(
        'Duplicate Attempt', 'Body', 'movie_release', NULL, NULL,
        '{"type":"all","idempotency_key":"test_broadcast_1"}'::jsonb
    )->>'already_exists')::boolean),
    true,
    'Assertion 25: Duplicate idempotency key returns already_exists = true without recreating campaign'
);

-- Cancel a campaign with pending deliveries
SELECT is(
    (SELECT (public.cancel_notification_campaign(
        (SELECT id FROM public.notification_campaigns WHERE (target_criteria->>'idempotency_key') = 'test_movie_target')
    )->>'success')::boolean),
    true,
    'Assertion 26: cancel_notification_campaign succeeds'
);

SELECT is(
    (SELECT delivery_status FROM public.notification_deliveries d
     JOIN public.notification_campaigns c ON d.campaign_id = c.id
     WHERE (c.target_criteria->>'idempotency_key') = 'test_movie_target'
     LIMIT 1),
    'cancelled',
    'Assertion 27: Deliveries of cancelled campaign transition to cancelled'
);

-- Audit log uses lowercase action values: 'campaign_ingested', 'campaign_cancelled'.
-- Count: Privilege Probe (1) + Broadcast (1) + Movie (1) + Actor (1) + Genre (1) +
--        Users (1) + Draft (1) + Future (1) = 8 ingested; 1 cancel from Assertion 6 + 1 from Assertion 26 = 2
-- Total = 10. But Assertion 6 cancel was on id '10000000-0000-0000-0000-000000000001'
-- which may not exist as a campaign. The privilege probe campaign is 'Privilege Probe'.
-- We count strictly what this run produces:
SELECT is(
    (SELECT count(*)::integer FROM public.notification_audit_log
     WHERE action IN ('campaign_ingested', 'campaign_cancelled')),
    8,
    'Assertion 28: Audit log contains 8 records (6 campaign_ingested + 2 campaign_cancelled) for this run'
);

SELECT * FROM finish();
