-- ============================================================================
-- MOVIEVERIFY PHASE 5.7: SCHEMA, INDEX, ACL, TRIGGER & LIFECYCLE VERIFICATION
-- File: tests/db/phase57_schema_acl_verify.sql
-- Executed inside isolated disposable PostgreSQL 17 (--network none)
-- ============================================================================

\set ON_ERROR_STOP on
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(36);

-- ----------------------------------------------------------------------------
-- Seed Isolated Users & Fixtures (runs as superuser postgres)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_admin   uuid := '00000000-0000-0000-0000-000000000001';
    v_user_a  uuid := '57000000-0000-0000-0000-000000000001';
    v_user_b  uuid := '57000000-0000-0000-0000-000000000002';
    v_ep_a    uuid := '57100000-0000-0000-0000-000000000001';
    v_ep_rev  uuid := '57100000-0000-0000-0000-000000000002';
BEGIN
    INSERT INTO auth.users (id, email) VALUES
        (v_user_a, 'p57_user_a@movieverify.test'),
        (v_user_b, 'p57_user_b@movieverify.test')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.notification_endpoints (
        id, user_id, channel_type, token, endpoint_hash, client_secret_hash,
        device_type, device_name, is_active, revoked_at, revocation_reason, last_seen_at
    ) VALUES (
        v_ep_a, v_user_a, 'fcm', 'p57_tok_active_a',
        encode(sha256('p57_tok_active_a'::bytea), 'hex'),
        encode(sha256(('p57_tok_active_a:' || v_user_a::text)::bytea), 'hex'),
        'web', 'P57 Active A', true, NULL, NULL, NOW()
    ), (
        v_ep_rev, v_user_b, 'fcm', 'p57_tok_rev_b',
        encode(sha256('p57_tok_rev_b'::bytea), 'hex'),
        encode(sha256(('p57_tok_rev_b:' || v_user_b::text)::bytea), 'hex'),
        'web', 'P57 RevokedReasonOnly B', true, NULL, 'SECURITY_HOLD', NOW()
    )
    ON CONFLICT (id) DO NOTHING;
END $$;

-- ----------------------------------------------------------------------------
-- Assertions 1-8: Schema, Columns, Partial Unique Indexes, Constraints & Trigger
-- ----------------------------------------------------------------------------
SELECT has_table('public', 'user_welcome_dispatches', '1. user_welcome_dispatches table exists');
SELECT has_column('public', 'notification_deliveries', 'delivered_at', '2. notification_deliveries.delivered_at column exists (C-3)');
SELECT col_type_is('public', 'notification_deliveries', 'delivered_at', 'timestamp with time zone', '3. delivered_at is timestamptz');
SELECT has_column('public', 'movie_notify_requests', 'season_scope', '4. movie_notify_requests.season_scope column exists');

SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'notification_deliveries'
          AND indexname = 'uq_deliveries_campaign_endpoint'
          AND indexdef ILIKE '%WHERE (endpoint_id IS NOT NULL)%'
    ),
    '5. Partial unique index uq_deliveries_campaign_endpoint exists with WHERE endpoint_id IS NOT NULL'
);

SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'notification_deliveries'
          AND indexname = 'uq_deliveries_campaign_user_in_app'
          AND indexdef ILIKE '%in_app%' AND indexdef ILIKE '%recipient_id IS NOT NULL%'
    ),
    '6. Partial unique index uq_deliveries_campaign_user_in_app exists'
);

SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'notification_campaigns'
          AND indexname = 'uq_campaigns_active_idempotency_key'
          AND indexdef ILIKE '%cancelled%'
    ),
    '7. Partial unique index uq_campaigns_active_idempotency_key excludes cancelled'
);

SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'auth' AND c.relname = 'users'
          AND t.tgname = 'trg_movieverify_welcome_on_signup'
          AND t.tgenabled = 'O'
    ),
    '8. auth.users trigger trg_movieverify_welcome_on_signup is attached and enabled'
);

-- ----------------------------------------------------------------------------
-- Assertions 9-11: SECURITY DEFINER, search_path, Ownership & Privileged ACLs
-- ----------------------------------------------------------------------------
SELECT ok(
    NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'reserve_notification_deliveries',
              'authorize_notification_delivery_dispatch',
              'confirm_notification_delivery_sent',
              'fail_or_retry_notification_delivery',
              'sweep_expired_delivery_reservations',
              'cancel_notification_campaign',
              'ingest_notification_campaign',
              'promote_due_scheduled_campaigns',
              '_materialize_notification_campaign',
              '_issue_welcome_notification_internal',
              'issue_welcome_notification',
              'trg_auth_user_welcome_notification',
              'record_notification_telemetry',
              'notifications_is_admin'
          )
          AND (
              NOT p.prosecdef
              OR pg_get_userbyid(p.proowner) <> 'postgres'
              OR NOT ('search_path=pg_catalog, public' = ANY(p.proconfig))
          )
    ),
    '9. All notification RPCs/helpers are postgres-owned SECURITY DEFINER with search_path=pg_catalog, public'
);

SELECT ok(
    NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'reserve_notification_deliveries',
              'authorize_notification_delivery_dispatch',
              'confirm_notification_delivery_sent',
              'fail_or_retry_notification_delivery',
              'sweep_expired_delivery_reservations',
              'promote_due_scheduled_campaigns',
              '_materialize_notification_campaign',
              '_issue_welcome_notification_internal',
              'issue_welcome_notification',
              'trg_auth_user_welcome_notification',
              'record_notification_telemetry'
          )
          AND (
              has_function_privilege('anon', p.oid, 'EXECUTE')
              OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
          )
    ),
    '10. Worker & internal RPCs grant zero EXECUTE to anon or authenticated'
);

SELECT ok(
    NOT has_function_privilege('service_role', 'public._issue_welcome_notification_internal(uuid, text)'::regprocedure, 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.trg_auth_user_welcome_notification()'::regprocedure, 'EXECUTE')
    AND has_function_privilege('service_role', 'public._materialize_notification_campaign(uuid)'::regprocedure, 'EXECUTE'),
    '11. Private _issue_welcome_notification_internal and trigger fn deny service_role; internal materializer is service_role-only'
);

-- ----------------------------------------------------------------------------
-- Assertions 12-20: Live Role Execution & Rejection (anon, non-admin, service_role, admin)
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;

SELECT throws_ok(
    'SELECT public.ingest_notification_campaign(''T'', ''B'', ''movie_release'')',
    '42501', NULL, '12. anon rejected on ingest_notification_campaign'
);
SELECT throws_ok(
    'SELECT public.cancel_notification_campaign(''00000000-0000-0000-0000-000000000099''::uuid)',
    '42501', NULL, '13. anon rejected on cancel_notification_campaign'
);
SELECT throws_ok(
    'SELECT public.issue_welcome_notification(''57000000-0000-0000-0000-000000000001''::uuid, ''api'')',
    '42501', NULL, '14. anon rejected on issue_welcome_notification'
);
SELECT throws_ok(
    'SELECT public.record_notification_telemetry(''00000000-0000-0000-0000-000000000001''::uuid, NULL, ''user'', ''57000000-0000-0000-0000-000000000001''::uuid, ''opened'', ''n1'')',
    '42501', NULL, '15. anon rejected on record_notification_telemetry'
);

RESET ROLE;

-- Non-admin authenticated JWT
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"57000000-0000-0000-0000-000000000001"}', true);
SELECT set_config('request.jwt.claim.sub', '57000000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
    'SELECT public.ingest_notification_campaign(''Spoof'', ''Body'', ''movie_release'', NULL, NULL, ''{"type":"all"}''::jsonb, NULL, ''00000000-0000-0000-0000-000000000001''::uuid)',
    'MV403', NULL, '16. Non-admin authenticated rejected (MV403) even with p_created_by spoof'
);
SELECT throws_ok(
    'SELECT public.cancel_notification_campaign(''00000000-0000-0000-0000-000000000099''::uuid)',
    'MV403', NULL, '17. Non-admin authenticated rejected on cancel_notification_campaign (MV403)'
);
SELECT throws_ok(
    'SELECT public.promote_due_scheduled_campaigns()',
    '42501', NULL, '18. Non-admin authenticated rejected on promote_due_scheduled_campaigns'
);
SELECT throws_ok(
    'SELECT public._issue_welcome_notification_internal(''57000000-0000-0000-0000-000000000001''::uuid, ''api'')',
    '42501', NULL, '19. Non-admin authenticated rejected on _issue_welcome_notification_internal'
);
SELECT throws_ok(
    'SELECT public.issue_welcome_notification(''57000000-0000-0000-0000-000000000001''::uuid, ''api'')',
    '42501', NULL, '20. Non-admin authenticated rejected on issue_welcome_notification'
);

RESET ROLE;

-- service_role still blocked from _issue_welcome_notification_internal
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SET LOCAL ROLE service_role;

SELECT throws_ok(
    'SELECT public._issue_welcome_notification_internal(''57000000-0000-0000-0000-000000000001''::uuid, ''api'')',
    '42501', NULL, '21. service_role cannot directly call private _issue_welcome_notification_internal'
);

RESET ROLE;

-- Admin authenticated JWT: p_created_by spoof is ignored and auth.uid() is stored
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
    $$SELECT public.ingest_notification_campaign(
        'Admin Spoof Check',
        'Verify created_by comes from auth.uid()',
        'system',
        '/',
        NULL,
        '{"type":"users","user_ids":["57000000-0000-0000-0000-000000000001","57000000-0000-0000-0000-000000000002"],"idempotency_key":"p57_admin_spoof_check"}'::jsonb,
        NULL,
        '57000000-0000-0000-0000-000000000001'::uuid
    )$$,
    '22. Verified admin executes ingest_notification_campaign cleanly'
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);

SELECT ok(
    (
        SELECT created_by = '00000000-0000-0000-0000-000000000001'::uuid
        FROM public.notification_campaigns
        WHERE target_criteria->>'idempotency_key' = 'p57_admin_spoof_check'
    ),
    '23. Admin ingestion enforces created_by = auth.uid() and ignores spoofed p_created_by'
);

-- ----------------------------------------------------------------------------
-- Assertions 24-27: Multi-user NULL endpoint_id in_app ON CONFLICT & revocation_reason exclusion
-- ----------------------------------------------------------------------------
SELECT is(
    (
        SELECT count(*)::integer
        FROM public.notification_deliveries d
        JOIN public.notification_campaigns c ON c.id = d.campaign_id
        WHERE c.target_criteria->>'idempotency_key' = 'p57_admin_spoof_check'
          AND d.channel_type = 'in_app'
          AND d.endpoint_id IS NULL
    ),
    2,
    '24. Multiple in_app deliveries with endpoint_id IS NULL preserved in single campaign (C-1)'
);

SELECT is(
    (
        SELECT count(*)::integer
        FROM public.notification_deliveries d
        JOIN public.notification_campaigns c ON c.id = d.campaign_id
        WHERE c.target_criteria->>'idempotency_key' = 'p57_admin_spoof_check'
          AND d.endpoint_id = '57100000-0000-0000-0000-000000000002'::uuid
    ),
    0,
    '25. Endpoint with revocation_reason IS NOT NULL excluded even if is_active=true (H-5)'
);

-- B5E reserve skips revocation_reason IS NOT NULL endpoints
SELECT is(
    (
        SELECT count(*)::integer
        FROM public.reserve_notification_deliveries('p57-rev-check', 20, 60) r
        WHERE r.token_id = '57100000-0000-0000-0000-000000000002'::uuid
    ),
    0,
    '26. B5E reserve_notification_deliveries excludes revocation_reason IS NOT NULL endpoints'
);

-- ----------------------------------------------------------------------------
-- Assertions 27-30: Welcome auth.users Trigger Execution & Idempotency & H-1
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_new_u uuid := '57000000-0000-0000-0000-000000000099';
    v_ep_w  uuid := '57100000-0000-0000-0000-000000000099';
BEGIN
    INSERT INTO auth.users (id, email) VALUES (v_new_u, 'p57_signup@movieverify.test');
END $$;

SELECT is(
    (SELECT status FROM public.user_welcome_dispatches WHERE user_id = '57000000-0000-0000-0000-000000000099'::uuid),
    'created',
    '27. auth.users INSERT triggers _issue_welcome_notification_internal and creates welcome dispatch'
);

SELECT is(
    (SELECT count(*)::integer FROM public.user_notifications WHERE user_id = '57000000-0000-0000-0000-000000000099'::uuid),
    1,
    '28. auth.users signup trigger creates exactly 1 welcome inbox notification'
);

SELECT is(
    (public.issue_welcome_notification('57000000-0000-0000-0000-000000000099'::uuid, 'signin')->>'already_processed')::boolean,
    true,
    '29. Subsequent issue_welcome_notification call returns already_processed=true without duplicate'
);

SELECT is(
    (SELECT status FROM public.notification_campaigns WHERE id = '00000000-0000-4000-8000-000000000001'::uuid),
    'queued',
    '30. Shared welcome campaign starts with status=queued compatible with B5E (H-1)'
);

-- ----------------------------------------------------------------------------
-- Assertions 31-33: C-3 Telemetry delivered_at Update & Recipient Mismatch Guard
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_inapp_del uuid;
    v_camp uuid;
BEGIN
    SELECT d.id, d.campaign_id INTO v_inapp_del, v_camp
    FROM public.notification_deliveries d
    WHERE d.recipient_id = '57000000-0000-0000-0000-000000000099'::uuid
      AND d.channel_type = 'in_app'
    LIMIT 1;

    PERFORM public.record_notification_telemetry(
        v_inapp_del,
        v_camp,
        'user',
        '57000000-0000-0000-0000-000000000099'::uuid,
        'displayed',
        'p57_nonce_1'
    );
END $$;

SELECT ok(
    EXISTS (
        SELECT 1 FROM public.notification_deliveries
        WHERE recipient_id = '57000000-0000-0000-0000-000000000099'::uuid
          AND channel_type = 'in_app'
          AND delivery_status = 'delivered'
          AND delivered_at IS NOT NULL
    ),
    '31. Telemetry updates delivery_status=delivered and populates delivered_at (C-3)'
);

SELECT throws_ok(
    $$SELECT public.record_notification_telemetry(
        (SELECT id FROM public.notification_deliveries WHERE recipient_id = '57000000-0000-0000-0000-000000000099'::uuid AND channel_type = 'in_app' LIMIT 1),
        NULL,
        'user',
        '57000000-0000-0000-0000-000000000001'::uuid,
        'opened',
        'p57_bad_recipient'
    )$$,
    'MV403',
    NULL,
    '32. Telemetry rejects mismatched recipient_id with MV403'
);

-- ----------------------------------------------------------------------------
-- Assertions 33-36: Multi-Season Coexistence & Legacy TV Season Matching
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_u uuid := '57000000-0000-0000-0000-000000000001';
BEGIN
    INSERT INTO public.movie_notify_requests (user_id, movie_id, movie_title, media_type, target_season, season_scope)
    VALUES
        (v_u, '71446', 'Money Heist', 'tv', NULL, 0),
        (v_u, '71446', 'Money Heist', 'tv', 2, 2),
        (v_u, '71446', 'Money Heist', 'tv', 3, 3);
END $$;

SELECT is(
    (SELECT count(*)::integer FROM public.movie_notify_requests WHERE user_id = '57000000-0000-0000-0000-000000000001'::uuid AND movie_id = '71446'),
    3,
    '33. Multi-season subscriptions coexist cleanly (Series + Season 2 + Season 3)'
);

SELECT is(
    (SELECT count(*)::integer FROM public.notification_subscriptions WHERE user_id = '57000000-0000-0000-0000-000000000001'::uuid AND entity_id IN ('71446', '71446:s2', '71446:s3')),
    3,
    '34. Sync trigger populates canonical notification_subscriptions for series and each season'
);

DELETE FROM public.movie_notify_requests
WHERE user_id = '57000000-0000-0000-0000-000000000001'::uuid AND movie_id = '71446' AND season_scope = 2;

SELECT is(
    (SELECT count(*)::integer FROM public.notification_subscriptions WHERE user_id = '57000000-0000-0000-0000-000000000001'::uuid AND entity_id IN ('71446', '71446:s2', '71446:s3')),
    2,
    '35. Deleting Season 2 cleans only 71446:s2 while preserving Series and Season 3'
);

-- In-app-only campaign completion check (execute ingest in prior statement so outer snapshot sees inserted row)
SELECT public.ingest_notification_campaign(
    'In-App Only Test',
    'User B has revoked push endpoint so in_app only',
    'system',
    '/',
    NULL,
    '{"type":"users","user_ids":["57000000-0000-0000-0000-000000000002"],"idempotency_key":"p57_in_app_only_check"}'::jsonb
) AS inapp_ingest_res;

SELECT is(
    (
        SELECT c.status
        FROM public.notification_campaigns c
        WHERE c.target_criteria->>'idempotency_key' = 'p57_in_app_only_check'
    ),
    'completed',
    '36. In-app-only campaign transitions immediately to status=completed'
);

SELECT * FROM finish();
ROLLBACK;

