-- ============================================================================
-- Phase 5.9.7 Combined Production Sequence Verification (PostgreSQL 17)
-- Exact Sequence: 8 Baselines -> Phase 5.2 -> Phase 5.4 -> Unified (20261111180000)
-- (Excludes B5D 20261110150000 and B5E 20261111000000)
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(50);

-- ----------------------------------------------------------------------------
-- Seed isolated test accounts, endpoints, campaigns, and deliveries
-- ----------------------------------------------------------------------------
INSERT INTO auth.users (id, email)
VALUES
    ('59700000-0000-0000-0000-000000000001', 'admin597@movieverify.test'),
    ('59700000-0000-0000-0000-000000000002', 'alice597@movieverify.test'),
    ('59700000-0000-0000-0000-000000000003', 'bob597@movieverify.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.admin_users (user_id)
VALUES ('59700000-0000-0000-0000-000000000001')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.notification_endpoints (
    id, user_id, device_type, channel_type, token, endpoint_hash, client_secret_hash, is_active, revoked_at, revocation_reason
)
VALUES
    ('59710000-0000-0000-0000-000000000001', '59700000-0000-0000-0000-000000000002', 'web', 'fcm', 'tok-597-active-alice-123456', repeat('e1', 32), repeat('f1', 32), true, NULL, NULL),
    ('59710000-0000-0000-0000-000000000002', '59700000-0000-0000-0000-000000000002', 'web', 'fcm', 'tok-597-revoked-alice-12345', repeat('e2', 32), repeat('f2', 32), true, NULL, NULL),
    ('59710000-0000-0000-0000-000000000003', '59700000-0000-0000-0000-000000000002', 'web', 'fcm', 'tok-597-xfer-alice-1234567', repeat('e3', 32), repeat('f3', 32), true, NULL, NULL),
    ('59710000-0000-0000-0000-000000000004', NULL, 'web', 'fcm', 'tok-597-guest-valid-123456', repeat('e4', 32), repeat('f4', 32), true, NULL, NULL),
    ('59710000-0000-0000-0000-000000000005', '59700000-0000-0000-0000-000000000002', 'web', 'fcm', 'tok-597-retry-alice-123456', repeat('e5', 32), repeat('f5', 32), true, NULL, NULL),
    ('59710000-0000-0000-0000-000000000006', '59700000-0000-0000-0000-000000000002', 'web', 'fcm', 'tok-597-unreg-alice-123456', repeat('e6', 32), repeat('f6', 32), true, NULL, NULL);

INSERT INTO public.notification_campaigns (id, title, body, category, status, created_by)
VALUES
    ('59720000-0000-0000-0000-000000000001', '597 Cancel Target', 'Body', 'system', 'processing', '59700000-0000-0000-0000-000000000001'),
    ('59720000-0000-0000-0000-000000000002', '597 Active Dispatch', 'Body', 'movie_release', 'processing', '59700000-0000-0000-0000-000000000001');

INSERT INTO public.notification_deliveries (
    id, campaign_id, recipient_type, recipient_id, endpoint_id, channel_type, delivery_status, max_retries
)
VALUES
    ('59730000-0000-0000-0000-000000000001', '59720000-0000-0000-0000-000000000001', 'user', '59700000-0000-0000-0000-000000000002', '59710000-0000-0000-0000-000000000001', 'fcm', 'pending', 3),
    ('59730000-0000-0000-0000-000000000002', '59720000-0000-0000-0000-000000000002', 'user', '59700000-0000-0000-0000-000000000002', '59710000-0000-0000-0000-000000000002', 'fcm', 'pending', 3),
    ('59730000-0000-0000-0000-000000000003', '59720000-0000-0000-0000-000000000002', 'user', '59700000-0000-0000-0000-000000000002', '59710000-0000-0000-0000-000000000003', 'fcm', 'pending', 3),
    ('59730000-0000-0000-0000-000000000004', '59720000-0000-0000-0000-000000000002', 'guest', NULL, '59710000-0000-0000-0000-000000000004', 'fcm', 'pending', 3);

UPDATE public.notification_endpoints
SET is_active = false, revoked_at = NOW(), revocation_reason = 'user_revoked'
WHERE id = '59710000-0000-0000-0000-000000000002';

-- ----------------------------------------------------------------------------
-- Assertions 1-10: Combined Schema, Partial Indexes, Trigger & pg_proc Security/ACLs
-- ----------------------------------------------------------------------------
SELECT has_table('public', 'user_welcome_dispatches', '1. user_welcome_dispatches exists');
SELECT has_column('public', 'notification_deliveries', 'dispatch_attempt_id', '2. dispatch_attempt_id exists (Unified)');
SELECT has_column('public', 'notification_deliveries', 'delivered_at', '3. delivered_at exists (Phase 5.4)');
SELECT has_column('public', 'movie_notify_requests', 'season_scope', '4. movie_notify_requests.season_scope exists');
SELECT has_index('public', 'notification_deliveries', 'idx_notification_deliveries_attempt', '5. Partial dispatch attempt index exists');
SELECT has_index('public', 'notification_deliveries', 'uq_deliveries_campaign_endpoint', '6. Partial unique push delivery index exists');
SELECT has_index('public', 'notification_deliveries', 'uq_deliveries_campaign_user_in_app', '7. Partial unique in-app delivery index exists');

SELECT ok(
    EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'auth' AND c.relname = 'users'
          AND t.tgname = 'trg_movieverify_welcome_on_signup'
          AND t.tgenabled = 'O'
    ),
    '8. auth.users trigger trg_movieverify_welcome_on_signup attached and enabled'
);

SELECT ok(
    NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'notifications_is_admin',
              'cancel_notification_campaign',
              'reserve_notification_deliveries',
              'authorize_notification_delivery_dispatch',
              'confirm_notification_delivery_sent',
              'fail_or_retry_notification_delivery',
              'record_notification_delivery_failure',
              'sweep_expired_delivery_reservations',
              'record_notification_telemetry',
              'ingest_notification_campaign',
              '_materialize_notification_campaign',
              'promote_due_scheduled_campaigns',
              'issue_welcome_notification',
              '_issue_welcome_notification_internal',
              'trg_auth_user_welcome_notification',
              'is_category_allowed_by_preferences',
              'trg_compat_notification_tokens_update',
              'trg_validate_delivery_ownership',
              'trg_enforce_delivery_identity_immutability'
          )
          AND (
              NOT p.prosecdef
              OR pg_get_userbyid(p.proowner) <> 'postgres'
              OR NOT ('search_path=pg_catalog, public' = ANY(p.proconfig))
          )
    ),
    '9. All Smart Notification RPCs and triggers are postgres-owned SECURITY DEFINER with safe search_path'
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
              'record_notification_delivery_failure',
              'sweep_expired_delivery_reservations',
              'record_notification_telemetry',
              '_materialize_notification_campaign',
              'promote_due_scheduled_campaigns',
              'issue_welcome_notification',
              '_issue_welcome_notification_internal',
              'trg_auth_user_welcome_notification'
          )
          AND (
              has_function_privilege('anon', p.oid, 'EXECUTE')
              OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
          )
    )
    AND NOT has_function_privilege('anon', 'public.cancel_notification_campaign(uuid)'::regprocedure, 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.cancel_notification_campaign(uuid)'::regprocedure, 'EXECUTE')
    AND has_function_privilege('service_role', 'public.reserve_notification_deliveries(varchar,integer,integer)'::regprocedure, 'EXECUTE')
    AND has_function_privilege('service_role', 'public.promote_due_scheduled_campaigns(integer)'::regprocedure, 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public._issue_welcome_notification_internal(uuid,text)'::regprocedure, 'EXECUTE'),
    '10. Exact least-privilege ACL matrix verified across anon, authenticated, and service_role'
);

-- ----------------------------------------------------------------------------
-- Assertions 11-16: Preservation of Pre-Seeded Data & Role Authorization
-- ----------------------------------------------------------------------------
SELECT is(
    (SELECT count(*)::integer FROM public.notification_endpoints WHERE is_active = true AND (revoked_at IS NOT NULL OR revocation_reason IS NOT NULL)),
    0,
    '11. Zero inconsistent active endpoints remain after Unified reconciliation'
);
SELECT is(
    (SELECT count(*)::integer FROM public.notification_telemetry WHERE event_nonce = 'seed_rec_597_1'),
    1,
    '12. Pre-existing historical telemetry preserved across 5.2 -> 5.4 -> Unified'
);
SELECT is(
    (SELECT count(*)::integer FROM public.user_notifications WHERE delivery_id = '59783000-0000-0000-0000-000000000001'),
    1,
    '13. Pre-existing inbox row preserved across 5.2 -> 5.4 -> Unified'
);

SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT throws_ok(
    'SELECT public.cancel_notification_campaign(''59720000-0000-0000-0000-000000000001''::uuid)',
    '42501', NULL, '14. anon denied on cancel_notification_campaign'
);
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"59700000-0000-0000-0000-000000000002"}', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '59700000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
    'SELECT public.cancel_notification_campaign(''59720000-0000-0000-0000-000000000001''::uuid)',
    'MV403', NULL, '15. Non-admin authenticated user denied MV403 on cancel_notification_campaign'
);
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"59700000-0000-0000-0000-000000000001"}', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '59700000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT ok(
    ((public.cancel_notification_campaign('59720000-0000-0000-0000-000000000001'::uuid))->>'success')::boolean,
    '16. Verified admin successfully executes unified cancel_notification_campaign'
);
RESET ROLE;

-- ----------------------------------------------------------------------------
-- Assertions 17-22: Welcome Signup Trigger, Idempotency & Scheduled Campaign Promotion
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);

INSERT INTO auth.users (id, email)
VALUES ('59700000-0000-0000-0000-000000000099', 'welcome597@movieverify.test');

SELECT is(
    (SELECT status FROM public.user_welcome_dispatches WHERE user_id = '59700000-0000-0000-0000-000000000099'::uuid),
    'created',
    '17. auth.users INSERT fires welcome trigger cleanly'
);
SELECT is(
    (public.issue_welcome_notification('59700000-0000-0000-0000-000000000099'::uuid, 'api_signin')->>'already_processed')::boolean,
    true,
    '18. Subsequent issue_welcome_notification RPC is idempotent'
);

-- Create scheduled campaign targeted to Alice (active endpoint 0001), age scheduled_for, and promote it
SELECT public.ingest_notification_campaign(
    '597 Due Scheduled Movie Release',
    'Premiere now live',
    'movie_release',
    '/movie/597',
    NULL,
    '{"type":"users","user_ids":["59700000-0000-0000-0000-000000000002"],"idempotency_key":"p597_sched_due_1"}'::jsonb,
    NOW() + interval '5 minutes',
    NULL
) AS sched_ingest_res;

SELECT is(
    (SELECT status FROM public.notification_campaigns WHERE target_criteria->>'idempotency_key' = 'p597_sched_due_1'),
    'scheduled',
    '19. Future scheduled ingest starts in status=scheduled before promotion'
);

UPDATE public.notification_campaigns
SET scheduled_for = NOW() - interval '1 minute'
WHERE target_criteria->>'idempotency_key' = 'p597_sched_due_1';

SELECT is(
    ((public.promote_due_scheduled_campaigns(10))->>'promoted_count')::integer,
    1,
    '20. promote_due_scheduled_campaigns promotes due scheduled campaign'
);

SELECT is(
    (SELECT status FROM public.notification_campaigns WHERE target_criteria->>'idempotency_key' = 'p597_sched_due_1'),
    'queued',
    '21. Promoted scheduled campaign transitions to queued and materializes deliveries'
);

SELECT is(
    (SELECT count(*)::integer FROM public.user_notifications u JOIN public.notification_campaigns c ON c.id = u.campaign_id WHERE c.target_criteria->>'idempotency_key' = 'p597_sched_due_1'),
    1,
    '22. Promoted scheduled campaign creates user inbox notification'
);

-- ----------------------------------------------------------------------------
-- Assertions 23-26: Phase 5.4 C-1 Dedup & C-3 Telemetry delivered_at Transition
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_camp_id uuid;
    v_inapp_id uuid;
BEGIN
    SELECT id INTO v_camp_id FROM public.notification_campaigns WHERE target_criteria->>'idempotency_key' = 'p597_sched_due_1';

    -- Conflict on duplicate push (campaign_id, endpoint_id) is silently ignored without failing
    INSERT INTO public.notification_deliveries (
        campaign_id, recipient_type, recipient_id, endpoint_id, channel_type, delivery_status
    ) VALUES (
        v_camp_id, 'user', '59700000-0000-0000-0000-000000000002', '59710000-0000-0000-0000-000000000001', 'fcm', 'pending'
    ) ON CONFLICT DO NOTHING;

    -- Record telemetry on Alice's welcome in_app delivery
    SELECT id INTO v_inapp_id
    FROM public.notification_deliveries
    WHERE recipient_id = '59700000-0000-0000-0000-000000000099'::uuid
      AND channel_type = 'in_app'
    LIMIT 1;

    PERFORM public.record_notification_telemetry(
        v_inapp_id,
        '00000000-0000-4000-8000-000000000001'::uuid,
        'user',
        '59700000-0000-0000-0000-000000000099'::uuid,
        'displayed',
        'p597_tel_nonce_1'
    );
END $$;

SELECT is(
    (SELECT count(*)::integer FROM public.notification_deliveries d JOIN public.notification_campaigns c ON c.id = d.campaign_id WHERE c.target_criteria->>'idempotency_key' = 'p597_sched_due_1' AND d.endpoint_id = '59710000-0000-0000-0000-000000000001'::uuid),
    1,
    '23. Partial unique push index prevents duplicate (campaign_id, endpoint_id)'
);

SELECT ok(
    EXISTS (
        SELECT 1 FROM public.notification_deliveries
        WHERE recipient_id = '59700000-0000-0000-0000-000000000099'::uuid
          AND channel_type = 'in_app'
          AND delivery_status = 'delivered'
          AND delivered_at IS NOT NULL
    ),
    '24. Phase 5.4 telemetry updates delivery_status=delivered and populates delivered_at'
);

-- Cancel scheduled campaign now or keep active? Keep active so reserve claims both 5972...0002 & promoted campaign;
-- check MV403 mismatch on telemetry and multi-season sync in Assertions 25-26
SELECT throws_ok(
    $$SELECT public.record_notification_telemetry(
        (SELECT id FROM public.notification_deliveries WHERE recipient_id = '59700000-0000-0000-0000-000000000099'::uuid AND channel_type = 'in_app' LIMIT 1),
        NULL, 'user', '59700000-0000-0000-0000-000000000002'::uuid, 'opened', 'p597_bad_rec'
    )$$,
    'MV403', NULL, '25. Telemetry rejects mismatched recipient_id with MV403'
);

SELECT is(
    (SELECT count(*)::integer FROM public.movie_notify_requests WHERE movie_id = '597999'),
    0,
    '26. Multi-season legacy request baseline check clean before insert'
);

-- ----------------------------------------------------------------------------
-- Assertions 27-32: Revocation & Explicit Reauthorization Lifecycle
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"59700000-0000-0000-0000-000000000002"}', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '59700000-0000-0000-0000-000000000002', true);

UPDATE public.notification_tokens
SET is_active = true, revoked_at = NULL, user_id = '59700000-0000-0000-0000-000000000003'
WHERE id = '59710000-0000-0000-0000-000000000002';

SELECT is((SELECT is_active FROM public.notification_endpoints WHERE id = '59710000-0000-0000-0000-000000000002'), false, '27. Untrusted caller cannot reactivate revoked endpoint');
SELECT is((SELECT user_id FROM public.notification_endpoints WHERE id = '59710000-0000-0000-0000-000000000002'), '59700000-0000-0000-0000-000000000002'::uuid, '28. Untrusted caller cannot transfer endpoint user_id');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);

UPDATE public.notification_tokens SET is_active = true WHERE id = '59710000-0000-0000-0000-000000000002';
SELECT is((SELECT is_active FROM public.notification_endpoints WHERE id = '59710000-0000-0000-0000-000000000002'), false, '29. Passive service_role update cannot silently reactivate');

UPDATE public.notification_tokens SET is_active = true, revoked_at = NULL WHERE id = '59710000-0000-0000-0000-000000000002';
SELECT ok((SELECT is_active = true AND revoked_at IS NULL AND revocation_reason IS NULL FROM public.notification_endpoints WHERE id = '59710000-0000-0000-0000-000000000002'), '30. Explicit service_role reauthorization clears revoked_at & revocation_reason');

-- Re-revoke 0002 so dispatch tests verify exclusion
UPDATE public.notification_tokens SET is_active = false, revoked_at = NOW() WHERE id = '59710000-0000-0000-0000-000000000002';
SELECT ok((SELECT is_active = false AND revoked_at IS NOT NULL AND revocation_reason = 'user_revoked' FROM public.notification_endpoints WHERE id = '59710000-0000-0000-0000-000000000002'), '31. View revocation sets revoked_at and default revocation_reason=user_revoked');

-- Multi-season coexistence test
INSERT INTO public.movie_notify_requests (user_id, movie_id, movie_title, media_type, target_season)
VALUES ('59700000-0000-0000-0000-000000000002', '597999', 'Combined Show', 'tv', NULL),
       ('59700000-0000-0000-0000-000000000002', '597999', 'Combined Show', 'tv', 1),
       ('59700000-0000-0000-0000-000000000002', '597999', 'Combined Show', 'tv', 2);
SELECT is((SELECT count(*)::integer FROM public.notification_subscriptions WHERE user_id = '59700000-0000-0000-0000-000000000002'::uuid AND entity_id IN ('597999', '597999:s1', '597999:s2')), 3, '32. Multi-season subscriptions sync to canonical notification_subscriptions');

-- ----------------------------------------------------------------------------
-- Assertions 33-42: Reserve, Dispatch Fencing, Provider Token Validation, Ownership Trigger
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_claims_cnt integer;
    v_revoked_cnt integer;
    v_del3_lease uuid;
    v_del4_lease uuid;
    v_auth_mismatch jsonb;
    v_auth_guest jsonb;
    v_auth_replay jsonb;
    v_conf_bad jsonb;
    v_conf_good jsonb;
BEGIN
    CREATE TEMP TABLE tmp_597_claims ON COMMIT DROP AS
    SELECT * FROM public.reserve_notification_deliveries('w-597-main', 20, 60);

    SELECT count(*)::integer INTO v_claims_cnt FROM tmp_597_claims;
    IF v_claims_cnt <> 5 THEN
        RAISE EXCEPTION 'Expected 5 claimable deliveries (del3, guest del4, 3 promoted sched fan-out), got %', v_claims_cnt;
    END IF;

    SELECT count(*)::integer INTO v_revoked_cnt FROM tmp_597_claims WHERE delivery_id = '59730000-0000-0000-0000-000000000002';
    IF v_revoked_cnt <> 0 THEN
        RAISE EXCEPTION 'Revoked endpoint delivery was unexpectedly reserved';
    END IF;

    -- Mutate ownership of endpoint 0003 from Alice to Bob after lease
    UPDATE public.notification_endpoints SET user_id = '59700000-0000-0000-0000-000000000003' WHERE id = '59710000-0000-0000-0000-000000000003';

    SELECT reservation_token INTO v_del3_lease FROM tmp_597_claims WHERE delivery_id = '59730000-0000-0000-0000-000000000003';
    SELECT reservation_token INTO v_del4_lease FROM tmp_597_claims WHERE delivery_id = '59730000-0000-0000-0000-000000000004';

    v_auth_mismatch := public.authorize_notification_delivery_dispatch(
        '59730000-0000-0000-0000-000000000003'::uuid, '59710000-0000-0000-0000-000000000003'::uuid,
        v_del3_lease, 'w-597-main', '59700000-0000-0000-0000-000000000002'::uuid
    );
    IF (v_auth_mismatch->>'authorized')::boolean OR (v_auth_mismatch->>'reason') <> 'RECIPIENT_OWNERSHIP_MISMATCH' OR (v_auth_mismatch ? 'provider_token') THEN
        RAISE EXCEPTION 'Ownership mismatch failed or leaked provider_token: %', v_auth_mismatch;
    END IF;

    v_auth_guest := public.authorize_notification_delivery_dispatch(
        '59730000-0000-0000-0000-000000000004'::uuid, '59710000-0000-0000-0000-000000000004'::uuid,
        v_del4_lease, 'w-597-main', NULL
    );
    IF NOT COALESCE((v_auth_guest->>'authorized')::boolean, false) OR (v_auth_guest->>'provider_token') <> 'tok-597-guest-valid-123456' THEN
        RAISE EXCEPTION 'Guest dispatch auth failed: %', v_auth_guest;
    END IF;

    v_auth_replay := public.authorize_notification_delivery_dispatch(
        '59730000-0000-0000-0000-000000000004'::uuid, '59710000-0000-0000-0000-000000000004'::uuid,
        v_del4_lease, 'w-597-main', NULL
    );
    IF (v_auth_replay->>'reason') <> 'ALREADY_AUTHORIZED_FOR_DISPATCH' OR (v_auth_replay ? 'provider_token') THEN
        RAISE EXCEPTION 'Expected ALREADY_AUTHORIZED_FOR_DISPATCH, got %', v_auth_replay;
    END IF;

    v_conf_bad := public.confirm_notification_delivery_sent('59730000-0000-0000-0000-000000000004'::uuid, gen_random_uuid(), 'msg-bad');
    IF (v_conf_bad->>'reason') <> 'CAS_FAILED_OR_LEASE_LOST' THEN
        RAISE EXCEPTION 'Expected CAS_FAILED_OR_LEASE_LOST, got %', v_conf_bad;
    END IF;

    v_conf_good := public.confirm_notification_delivery_sent('59730000-0000-0000-0000-000000000004'::uuid, (v_auth_guest->>'dispatch_attempt_id')::uuid, 'msg-guest-597');
    IF NOT COALESCE((v_conf_good->>'success')::boolean, false) THEN
        RAISE EXCEPTION 'Expected confirm success, got %', v_conf_good;
    END IF;
END $$;

SELECT is((SELECT delivery_status FROM public.notification_deliveries WHERE id = '59730000-0000-0000-0000-000000000003'), 'failed', '33. Ownership mismatch transitions delivery to failed without MV403');
SELECT is((SELECT delivery_status FROM public.notification_deliveries WHERE id = '59730000-0000-0000-0000-000000000004'), 'sent', '34. Valid provider_token & dispatch_attempt_id confirm delivery sent');
SELECT is((SELECT dispatch_attempt_id FROM public.notification_deliveries WHERE id = '59730000-0000-0000-0000-000000000004'), NULL, '35. dispatch_attempt_id cleared after confirm');

-- Ownership trigger blocks terminal identity mutations while permitting valid terminal transitions
SELECT throws_ok(
    $$UPDATE public.notification_deliveries SET endpoint_id = '59710000-0000-0000-0000-000000000004', delivery_status = 'failed' WHERE id = '59730000-0000-0000-0000-000000000001'$$,
    'MV403', NULL, '36. trg_validate_delivery_ownership blocks terminal endpoint mutation (MV403)'
);
SELECT throws_ok(
    $$UPDATE public.notification_deliveries SET recipient_id = '59700000-0000-0000-0000-000000000003', delivery_status = 'cancelled' WHERE id = '59730000-0000-0000-0000-000000000001'$$,
    'MV409', NULL, '37. trg_delivery_identity_immutable blocks terminal identity change (MV409)'
);
SELECT throws_ok(
    $$INSERT INTO public.notification_deliveries (campaign_id, recipient_type, recipient_id, endpoint_id, channel_type, delivery_status) VALUES ('59720000-0000-0000-0000-000000000002', 'user', '59700000-0000-0000-0000-000000000002', '59710000-0000-0000-0000-000000000002', 'fcm', 'pending')$$,
    'MV410', NULL, '38. Delivery INSERT to revoked endpoint rejected (MV410)'
);

-- Provider token mismatch rejection & recipient/token parameter checks on authorize
INSERT INTO public.notification_campaigns (id, title, body, category, status, created_by)
VALUES ('59720000-0000-0000-0000-000000000003', '597 Sweep Target', 'Body', 'movie_release', 'processing', '59700000-0000-0000-0000-000000000001');

INSERT INTO public.notification_deliveries (
    id, campaign_id, recipient_type, recipient_id, endpoint_id, channel_type,
    delivery_status, lease_token, lease_expires_at, worker_id, retry_count, max_retries
)
VALUES
    ('59730000-0000-0000-0000-000000000005', '59720000-0000-0000-0000-000000000002', 'user', '59700000-0000-0000-0000-000000000002', '59710000-0000-0000-0000-000000000005', 'fcm',
     'leased', '59740000-0000-0000-0000-000000000005'::uuid, NOW() + interval '60 seconds', 'w-597', 0, 2),
    ('59730000-0000-0000-0000-000000000006', '59720000-0000-0000-0000-000000000002', 'user', '59700000-0000-0000-0000-000000000002', '59710000-0000-0000-0000-000000000006', 'fcm',
     'leased', '59740000-0000-0000-0000-000000000006'::uuid, NOW() + interval '60 seconds', 'w-597', 0, 2),
    ('59730000-0000-0000-0000-000000000007', '59720000-0000-0000-0000-000000000003', 'user', '59700000-0000-0000-0000-000000000002', '59710000-0000-0000-0000-000000000005', 'fcm',
     'leased', '59740000-0000-0000-0000-000000000007'::uuid, NOW() - interval '10 seconds', 'w-dead', 0, 2),
    ('59730000-0000-0000-0000-000000000008', '59720000-0000-0000-0000-000000000002', 'user', '59700000-0000-0000-0000-000000000002', '59710000-0000-0000-0000-000000000001', 'fcm',
     'leased', '59740000-0000-0000-0000-000000000008'::uuid, NOW() + interval '60 seconds', 'w-tok', 0, 2);

SELECT is(
    (public.authorize_notification_delivery_dispatch(
        '59730000-0000-0000-0000-000000000008'::uuid, '59710000-0000-0000-0000-000000000099'::uuid,
        '59740000-0000-0000-0000-000000000008'::uuid, 'w-tok', '59700000-0000-0000-0000-000000000002'::uuid
    ))->>'reason',
    'TOKEN_MISMATCH', '39. p_token_id mismatch rejected with TOKEN_MISMATCH'
);
SELECT is(
    (public.authorize_notification_delivery_dispatch(
        '59730000-0000-0000-0000-000000000008'::uuid, '59710000-0000-0000-0000-000000000001'::uuid,
        '59740000-0000-0000-0000-000000000008'::uuid, 'w-tok', '59700000-0000-0000-0000-000000000003'::uuid
    ))->>'reason',
    'RECIPIENT_MISMATCH', '40. p_recipient_id mismatch rejected with RECIPIENT_MISMATCH'
);
SELECT is(
    public.fail_or_retry_notification_delivery(
        '59730000-0000-0000-0000-000000000008'::uuid, 'w-tok',
        '59740000-0000-0000-0000-000000000008'::uuid, 'PROVIDER_TOKEN_MISMATCH', 'Provider token diverged', NULL
    ),
    'failed', '41. PROVIDER_TOKEN_MISMATCH fails permanently without retry'
);
SELECT is(
    (public.authorize_notification_delivery_dispatch(
        '59730000-0000-0000-0000-000000000008'::uuid, '59710000-0000-0000-0000-000000000001'::uuid,
        '59740000-0000-0000-0000-000000000008'::uuid, 'w-tok', '59700000-0000-0000-0000-000000000002'::uuid
    ))->>'authorized',
    'false', '42. Failed delivery cannot be authorized for dispatch'
);

-- ----------------------------------------------------------------------------
-- Assertions 43-50: Retry, UNREGISTERED, Expired Sweep & Service Cancel Audit
-- ----------------------------------------------------------------------------
SELECT is(
    public.fail_or_retry_notification_delivery('59730000-0000-0000-0000-000000000005'::uuid, 'w-597', '59740000-0000-0000-0000-000000000005'::uuid, 'UNAVAILABLE', 'Transient error', NULL),
    'pending', '43. Transient failure resets leased delivery to pending'
);
SELECT ok((SELECT retry_count = 1 AND next_retry_at > NOW() FROM public.notification_deliveries WHERE id = '59730000-0000-0000-0000-000000000005'), '44. Transient failure increments retry_count and backoff');
SELECT is(
    public.fail_or_retry_notification_delivery('59730000-0000-0000-0000-000000000006'::uuid, 'w-597', '59740000-0000-0000-0000-000000000006'::uuid, 'UNREGISTERED', 'Token invalid', NULL),
    'failed', '45. UNREGISTERED permanent failure marks delivery failed'
);
SELECT ok((SELECT is_active = false AND revoked_at IS NOT NULL AND revocation_reason = 'fcm_unregistered' FROM public.notification_endpoints WHERE id = '59710000-0000-0000-0000-000000000006'), '46. UNREGISTERED atomically revokes endpoint');

SELECT is(public.sweep_expired_delivery_reservations(), 1, '47. sweep_expired_delivery_reservations sweeps expired lease cleanly');
SELECT is((SELECT delivery_status FROM public.notification_deliveries WHERE id = '59730000-0000-0000-0000-000000000007'), 'pending', '48. Swept valid retryable delivery returns to pending');

SELECT ok(((public.cancel_notification_campaign('59720000-0000-0000-0000-000000000002'::uuid))->>'success')::boolean, '49. service_role cancel_notification_campaign succeeds cleanly');
SELECT is((SELECT actor_role FROM public.notification_audit_log WHERE entity_id = '59720000-0000-0000-0000-000000000002' ORDER BY created_at DESC LIMIT 1), 'service_role', '50. Unified cancel audit log attributes service_role correctly');

SELECT * FROM finish();
ROLLBACK;
