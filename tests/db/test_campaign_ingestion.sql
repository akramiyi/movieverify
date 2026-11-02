-- ============================================================================
-- MOVIEVERIFY PHASE 15.2.4: CAMPAIGN INGESTION & CANCELLATION PGTAP SUITE
-- File: tests/db/test_campaign_ingestion.sql
-- ============================================================================

\set ON_ERROR_STOP on
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(28);

-- ----------------------------------------------------------------------------
-- Test Fixtures Setup
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_u1 uuid := '10000000-0000-0000-0000-000000000001';
    v_u2 uuid := '10000000-0000-0000-0000-000000000002';
    v_u3 uuid := '10000000-0000-0000-0000-000000000003';
    v_u4 uuid := '10000000-0000-0000-0000-000000000004';
    v_u5 uuid := '10000000-0000-0000-0000-000000000005';
    v_u6 uuid := '10000000-0000-0000-0000-000000000006';

    v_t1 uuid := '20000000-0000-0000-0000-000000000001';
    v_t2 uuid := '20000000-0000-0000-0000-000000000002';
    v_t3 uuid := '20000000-0000-0000-0000-000000000003';
    v_t4 uuid := '20000000-0000-0000-0000-000000000004';
    v_t5 uuid := '20000000-0000-0000-0000-000000000005';
    v_t6 uuid := '20000000-0000-0000-0000-000000000006';
    v_t7 uuid := '20000000-0000-0000-0000-000000000007';
BEGIN
    TRUNCATE public.notification_audit_log;
    -- Auth Users
    INSERT INTO auth.users (id, email) VALUES
    (v_u1, 'test_user1@movieverify.com'),
    (v_u2, 'test_user2@movieverify.com'),
    (v_u3, 'test_user3@movieverify.com'),
    (v_u4, 'test_user4@movieverify.com'),
    (v_u5, 'test_user5@movieverify.com'),
    (v_u6, 'test_user6@movieverify.com')
    ON CONFLICT (id) DO NOTHING;

    -- User 1: 2 Active Tokens (Desktop & Mobile)
    INSERT INTO public.notification_tokens (id, user_id, token, is_active, device_name) VALUES
    (v_t1, v_u1, 'token_u1_desktop', true, 'Desktop Chrome'),
    (v_t2, v_u1, 'token_u1_mobile', true, 'Mobile Chrome')
    ON CONFLICT (id) DO NOTHING;

    -- User 2: Active Token, but Opted Out of 'movie_release'
    INSERT INTO public.notification_tokens (id, user_id, token, is_active, device_name) VALUES
    (v_t3, v_u2, 'token_u2_optout', true, 'User2 Device')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.notification_opt_outs (user_id, category) VALUES
    (v_u2, 'movie_release')
    ON CONFLICT (user_id, category) DO NOTHING;

    -- User 3: Inactive Token
    INSERT INTO public.notification_tokens (id, user_id, token, is_active, device_name) VALUES
    (v_t4, v_u3, 'token_u3_inactive', false, 'Old Phone')
    ON CONFLICT (id) DO NOTHING;

    -- User 4: Subscribed to movie 'movie_99'
    INSERT INTO public.notification_tokens (id, user_id, token, is_active, device_name) VALUES
    (v_t5, v_u4, 'token_u4_movie', true, 'User4 Device')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.movie_notify_requests (movie_id, user_id) VALUES
    ('movie_99', v_u4)
    ON CONFLICT DO NOTHING;

    -- User 5: Subscribed to actor 'actor_88'
    INSERT INTO public.notification_tokens (id, user_id, token, is_active, device_name) VALUES
    (v_t6, v_u5, 'token_u5_actor', true, 'User5 Device')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.actor_notify_requests (actor_id, user_id) VALUES
    ('actor_88', v_u5)
    ON CONFLICT DO NOTHING;

    -- User 6: Subscribed to genre 'genre_77'
    INSERT INTO public.notification_tokens (id, user_id, token, is_active, device_name) VALUES
    (v_t7, v_u6, 'token_u6_genre', true, 'User6 Device')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.genre_notify_requests (genre_id, user_id) VALUES
    ('genre_77', v_u6)
    ON CONFLICT DO NOTHING;
END $$;

-- ----------------------------------------------------------------------------
-- Assertions 1-6: Security & Role Privileges
-- ----------------------------------------------------------------------------
SET LOCAL ROLE anon;
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

SET LOCAL ROLE authenticated;
SELECT throws_ok(
    'SELECT public.ingest_notification_campaign(''T'', ''B'', ''movie_release'')',
    '42501',
    NULL,
    'Assertion 3: authenticated cannot execute ingest_notification_campaign'
);
SELECT throws_ok(
    'SELECT public.cancel_notification_campaign(''10000000-0000-0000-0000-000000000001''::uuid)',
    '42501',
    NULL,
    'Assertion 4: authenticated cannot execute cancel_notification_campaign'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT lives_ok(
    'SELECT public.ingest_notification_campaign(''Privilege Probe'', ''Body'', ''movie_release'', NULL, NULL, ''{"type":"users","user_ids":["10000000-0000-0000-0000-000000000001"]}''::jsonb)',
    'Assertion 5: service_role can execute ingest_notification_campaign'
);
SELECT lives_ok(
    'SELECT public.cancel_notification_campaign(''10000000-0000-0000-0000-000000000001''::uuid)',
    'Assertion 6: service_role can execute cancel_notification_campaign'
);
RESET ROLE;

-- ----------------------------------------------------------------------------
-- Assertions 7-12: Input Validation Guards
-- ----------------------------------------------------------------------------
SELECT throws_matching(
    'SELECT public.ingest_notification_campaign(''T'', ''B'', ''invalid_category'')',
    'INVALID_CATEGORY',
    'Assertion 7: Invalid notification category is rejected'
);

SELECT throws_matching(
    'SELECT public.ingest_notification_campaign('''', ''B'', ''movie_release'')',
    'INVALID_TITLE',
    'Assertion 8: Empty title is rejected'
);

SELECT throws_matching(
    'SELECT public.ingest_notification_campaign(''T'', '''', ''movie_release'')',
    'INVALID_BODY',
    'Assertion 9: Empty body is rejected'
);

SELECT throws_matching(
    'SELECT public.ingest_notification_campaign(''T'', ''B'', ''movie_release'', ''https://external-domain.com'')',
    'INVALID_URL',
    'Assertion 10: Non-internal URL is rejected'
);

SELECT throws_matching(
    'SELECT public.ingest_notification_campaign(''T'', ''B'', ''movie_release'', NULL, NULL, ''{"type":"invalid_target"}''::jsonb)',
    'INVALID_TARGET_TYPE',
    'Assertion 11: Unsupported target type is rejected'
);

SELECT throws_matching(
    'SELECT public.ingest_notification_campaign(''T'', ''B'', ''movie_release'', NULL, NULL, ''{"type":"movie"}''::jsonb)',
    'INVALID_TARGET_CRITERIA',
    'Assertion 12: Missing movie_id for movie targeting is rejected'
);

-- ----------------------------------------------------------------------------
-- Assertions 13-16: Broadcast Targeting, Token Snapshot Integrity & Suppression
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
    'Assertion 16: Inactive token user (u3) received 0 deliveries'
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
    (SELECT count(*)::integer FROM public.reserve_notification_deliveries('worker_sch_probe', 10, 60) r
     JOIN public.notification_deliveries d ON r.delivery_id = d.id
     JOIN public.notification_campaigns c ON d.campaign_id = c.id
     WHERE (c.target_criteria->>'idempotency_key') = 'test_future_camp'),
    0,
    'Assertion 24: Dispatch worker cannot reserve future-scheduled deliveries (retry_after fencing)'
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

SELECT is(
    (SELECT count(*)::integer FROM public.notification_audit_log
     WHERE action IN ('CAMPAIGN_INGESTED', 'CAMPAIGN_CANCELLED')),
    -- We have 7 ingested campaigns and 2 cancellations in this test run
    9,
    'Assertion 28: Audit log contains records for all campaign ingestions and cancellations'
);

SELECT * FROM finish();
ROLLBACK;
