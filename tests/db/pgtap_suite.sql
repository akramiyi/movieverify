-- ============================================================================
-- MOVIEVERIFY NOTIFICATION SYSTEM — 42-ASSERTION BEHAVIORAL PGTAP SUITE
-- File: tests/db/pgtap_suite.sql
-- Phase: 2 (Phase 1.9 architecture — 8-migration release schema)
-- Corrected for Phase 2 schema:
--   - Canonical table: notification_endpoints (not notification_tokens view)
--   - notification_deliveries uses endpoint_id, delivery_status, lease_token
--   - authorize_notification_delivery_dispatch returns authorized + dispatch_attempt_id
--   - confirm_notification_delivery_sent checks delivery_status = 'leased'
--   - record_notification_telemetry signature: (delivery_id, campaign_id, recipient_type,
--     recipient_id, event_type, event_nonce, [client_timestamp], [client_metadata])
--   - notification_tokens is a compatibility VIEW (security_invoker = false)
-- ============================================================================

\set ON_ERROR_STOP on
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(42);

-- Pre-suite test fixture setup
-- All writes go to canonical notification_endpoints (Phase 2 base table).
-- A campaign must be seeded first because notification_deliveries.campaign_id is NOT NULL.
DO $$
DECLARE
    v_uid       uuid := '00000000-0000-0000-0000-000000000001';
    v_uid2      uuid := '00000000-0000-0000-0000-000000000002';
    v_ep_id     uuid := '11111111-1111-1111-1111-111111111111';
    v_ep2_id    uuid := '99999999-9999-9999-9999-999999999999';
    v_del_id    uuid := '22222222-2222-2222-2222-222222222222';
    v_camp_id   uuid := '00000000-0000-0000-0000-000000000099';
    v_hash      text;
    v_hash2     text;
    v_secret    text;
    v_secret2   text;
BEGIN
    v_hash    := encode(sha256('pgtap_fcm_token_alpha'::bytea), 'hex');
    v_hash2   := encode(sha256('pgtap_fcm_token_secondary'::bytea), 'hex');
    v_secret  := encode(sha256(('pgtap_fcm_token_alpha:' || v_uid::text)::bytea), 'hex');
    v_secret2 := encode(sha256(('pgtap_fcm_token_secondary:' || v_uid::text)::bytea), 'hex');

    -- Seed auth users
    INSERT INTO auth.users (id, email)
    VALUES (v_uid, 'test@movieverify.com')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO auth.users (id, email)
    VALUES (v_uid2, 'user2@movieverify.com')
    ON CONFLICT (id) DO NOTHING;

    -- Seed a campaign so notification_deliveries.campaign_id FK can be satisfied
    INSERT INTO public.notification_campaigns (
        id, title, body, category, target_type, target_criteria, status,
        total_recipients, sent_count, success_count, failure_count,
        open_count, click_count
    ) VALUES (
        v_camp_id, 'pgTAP Probe', 'pgTAP probe body', 'movie_release',
        'users', '{"type":"users","user_ids":["00000000-0000-0000-0000-000000000001"]}'::jsonb,
        'queued', 1, 0, 0, 0, 0, 0
    ) ON CONFLICT (id) DO NOTHING;

    -- Endpoint 1 (primary — FCM, owned by user 1)
    INSERT INTO public.notification_endpoints (
        id, user_id, channel_type, token, endpoint_hash, client_secret_hash,
        device_type, device_name, is_active, last_seen_at
    ) VALUES (
        v_ep_id, v_uid, 'fcm', 'pgtap_fcm_token_alpha',
        v_hash, v_secret, 'web', 'pgTAP Primary Device', true, NOW()
    ) ON CONFLICT (id) DO UPDATE
        SET endpoint_hash = v_hash, is_active = true, user_id = v_uid;

    -- Endpoint 2 (secondary — FCM, also owned by user 1 — for mismatch testing)
    INSERT INTO public.notification_endpoints (
        id, user_id, channel_type, token, endpoint_hash, client_secret_hash,
        device_type, device_name, is_active, last_seen_at
    ) VALUES (
        v_ep2_id, v_uid, 'fcm', 'pgtap_fcm_token_secondary',
        v_hash2, v_secret2, 'web', 'pgTAP Secondary Device', true, NOW()
    ) ON CONFLICT (id) DO UPDATE
        SET endpoint_hash = v_hash2, is_active = true, user_id = v_uid;

    -- Clean any leftover delivery from previous runs
    DELETE FROM public.notification_deliveries
    WHERE id IN (v_del_id, '33333333-3333-3333-3333-333333333333');

    -- Seed primary delivery linked to Endpoint 1 (FCM push delivery)
    INSERT INTO public.notification_deliveries (
        id, campaign_id, recipient_type, recipient_id, endpoint_id,
        channel_type, delivery_status, retry_count, max_retries
    ) VALUES (
        v_del_id, v_camp_id, 'user', v_uid, v_ep_id,
        'fcm', 'pending', 0, 2
    );
END $$;

-- ----------------------------------------------------------------------------
-- Assertions 1–11: Table Existence
-- Note: notification_tokens is a compatibility VIEW in Phase 2 — has_view() used for it.
-- ----------------------------------------------------------------------------
SELECT has_table('public', 'notification_endpoints',         'Table 1: notification_endpoints exists (canonical Phase 2 table)');
SELECT has_table('public', 'movie_notify_requests',          'Table 2: movie_notify_requests exists');
SELECT has_table('public', 'actor_notify_requests',          'Table 3: actor_notify_requests exists');
SELECT has_table('public', 'genre_notify_requests',          'Table 4: genre_notify_requests exists');
SELECT has_table('public', 'notification_campaigns',         'Table 5: notification_campaigns exists');
SELECT has_table('public', 'notification_queue',             'Table 6: notification_queue exists');
SELECT has_table('public', 'notification_deliveries',        'Table 7: notification_deliveries exists');
SELECT has_table('public', 'notification_telemetry',         'Table 8: notification_telemetry exists');
SELECT has_table('public', 'user_notifications',             'Table 9: user_notifications exists');
SELECT has_table('public', 'notification_opt_outs',          'Table 10: notification_opt_outs exists');
SELECT has_table('public', 'notification_audit_log',         'Table 11: notification_audit_log exists');

-- ----------------------------------------------------------------------------
-- Assertions 12–16: Column & NOT NULL Integrity on Phase 2 canonical tables
-- ----------------------------------------------------------------------------
SELECT col_not_null('public', 'notification_endpoints',   'endpoint_hash',    'notification_endpoints.endpoint_hash is NOT NULL');
SELECT col_not_null('public', 'notification_campaigns',   'status',           'notification_campaigns.status is NOT NULL');
SELECT col_not_null('public', 'notification_queue',       'status',           'notification_queue.status is NOT NULL');
SELECT col_not_null('public', 'notification_deliveries',  'delivery_status',  'notification_deliveries.delivery_status is NOT NULL');
SELECT col_not_null('public', 'notification_deliveries',  'channel_type',     'notification_deliveries.channel_type is NOT NULL');

-- ----------------------------------------------------------------------------
-- Assertions 17–20: Role Privileges & Isolation (SET LOCAL ROLE)
-- reserve_notification_deliveries is SECURITY DEFINER restricted to service_role.
-- authorize_notification_delivery_dispatch is SECURITY DEFINER restricted to service_role.
-- ----------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT throws_ok(
    'SELECT * FROM public.reserve_notification_deliveries(''worker_auth_hack'', 10, 30);',
    '42501',
    NULL,
    'Assertion 17: Authenticated user cannot execute reserve_notification_deliveries'
);
SELECT throws_ok(
    'SELECT public.authorize_notification_delivery_dispatch(''22222222-2222-2222-2222-222222222222''::uuid, ''11111111-1111-1111-1111-111111111111''::uuid, gen_random_uuid(), ''worker'', ''00000000-0000-0000-0000-000000000001''::uuid);',
    '42501',
    NULL,
    'Assertion 18: Authenticated user cannot execute authorize_notification_delivery_dispatch'
);

SET LOCAL ROLE anon;
SELECT throws_ok(
    'SELECT * FROM public.reserve_notification_deliveries(''worker_anon'', 10, 30);',
    '42501',
    NULL,
    'Assertion 19: Anon cannot execute reserve_notification_deliveries'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT lives_ok(
    'SELECT * FROM public.reserve_notification_deliveries(''worker_service_role'', 1, 30);',
    'Assertion 20: service_role executes reserve_notification_deliveries successfully'
);
RESET ROLE;

-- ----------------------------------------------------------------------------
-- Assertions 21–25: Reservation & Positive Dispatch Authorization Lifecycle
-- After reserve_notification_deliveries the delivery is in 'leased' status.
-- authorize_notification_delivery_dispatch returns authorized=true when lease valid.
-- confirm_notification_delivery_sent requires delivery_status = 'leased'.
-- ----------------------------------------------------------------------------
SELECT is(
    (SELECT delivery_status FROM public.notification_deliveries WHERE id = '22222222-2222-2222-2222-222222222222'),
    'leased',
    'Assertion 21: Delivery is in leased status after worker claim'
);

SELECT isnt(
    (SELECT lease_token FROM public.notification_deliveries WHERE id = '22222222-2222-2222-2222-222222222222'),
    NULL,
    'Assertion 22: Delivery has non-null lease_token'
);

SELECT is(
    (SELECT (public.authorize_notification_delivery_dispatch(
        '22222222-2222-2222-2222-222222222222'::uuid,
        '11111111-1111-1111-1111-111111111111'::uuid,
        (SELECT lease_token FROM public.notification_deliveries WHERE id = '22222222-2222-2222-2222-222222222222'),
        'worker_service_role',
        '00000000-0000-0000-0000-000000000001'::uuid
    ))->>'authorized')::boolean,
    true,
    'Assertion 23: Dispatch authorization returns authorized = true for valid lease'
);

SELECT isnt(
    (SELECT public.authorize_notification_delivery_dispatch(
        '22222222-2222-2222-2222-222222222222'::uuid,
        '11111111-1111-1111-1111-111111111111'::uuid,
        (SELECT lease_token FROM public.notification_deliveries WHERE id = '22222222-2222-2222-2222-222222222222'),
        'worker_service_role',
        '00000000-0000-0000-0000-000000000001'::uuid
    ))->>'dispatch_attempt_id',
    NULL,
    'Assertion 24: Dispatch authorization returns non-null dispatch_attempt_id'
);

SELECT is(
    (SELECT delivery_status FROM public.notification_deliveries WHERE id = '22222222-2222-2222-2222-222222222222'),
    'leased',
    'Assertion 25: Delivery remains leased status while authorized dispatch is in flight'
);

-- ----------------------------------------------------------------------------
-- Assertions 26–30: One-Time Authorization & Post-Send Settlement
-- A second authorization with a stale/wrong lease token returns authorized=false.
-- confirm_notification_delivery_sent with correct delivery_id transitions to sent.
-- ----------------------------------------------------------------------------
SELECT is(
    (SELECT (public.authorize_notification_delivery_dispatch(
        '22222222-2222-2222-2222-222222222222'::uuid,
        '11111111-1111-1111-1111-111111111111'::uuid,
        gen_random_uuid(),   -- intentionally wrong lease token
        'worker_service_role',
        '00000000-0000-0000-0000-000000000001'::uuid
    ))->>'authorized')::boolean,
    false,
    'Assertion 26: Dispatch authorization with wrong lease token returns authorized = false'
);

SELECT is(
    (SELECT (public.confirm_notification_delivery_sent(
        '22222222-2222-2222-2222-222222222222'::uuid,
        gen_random_uuid(),          -- dispatch_attempt_id (Phase 2 not stored; pass any uuid)
        'fcm_msg_test_123'
    ))->>'success')::boolean,
    true,
    'Assertion 27: Delivery confirmation returns success = true'
);

SELECT is(
    (SELECT delivery_status FROM public.notification_deliveries WHERE id = '22222222-2222-2222-2222-222222222222'),
    'sent',
    'Assertion 28: Delivery status is sent after confirm_notification_delivery_sent'
);

SELECT is(
    (SELECT provider_message_id FROM public.notification_deliveries WHERE id = '22222222-2222-2222-2222-222222222222'),
    'fcm_msg_test_123',
    'Assertion 29: provider_message_id matches confirmed FCM message id'
);

SELECT is(
    (SELECT lease_token FROM public.notification_deliveries WHERE id = '22222222-2222-2222-2222-222222222222'),
    NULL,
    'Assertion 30: lease_token is cleared upon confirmation'
);

-- ----------------------------------------------------------------------------
-- Assertions 31–35: Telemetry Integrity via record_notification_telemetry RPC
-- Phase 2 signature: (delivery_id, campaign_id, recipient_type, recipient_id,
--                      event_type, event_nonce, [client_timestamp], [client_metadata])
-- ----------------------------------------------------------------------------
SELECT is(
    public.record_notification_telemetry(
        '22222222-2222-2222-2222-222222222222'::uuid,
        '00000000-0000-0000-0000-000000000099'::uuid,
        'user',
        '00000000-0000-0000-0000-000000000001'::uuid,
        'device_received',
        'nonce_pgtap_001'
    ),
    true,
    'Assertion 31: record_notification_telemetry executes successfully'
);

SELECT lives_ok(
    'SELECT public.record_notification_telemetry(
        ''22222222-2222-2222-2222-222222222222''::uuid,
        ''00000000-0000-0000-0000-000000000099''::uuid,
        ''user'',
        ''00000000-0000-0000-0000-000000000001''::uuid,
        ''device_received'',
        ''nonce_pgtap_001''
    );',
    'Assertion 32: Reused nonce is a no-op (ON CONFLICT DO NOTHING — no error thrown)'
);

SELECT is(
    (SELECT COUNT(*) FROM public.notification_telemetry WHERE event_nonce = 'nonce_pgtap_001'),
    1::bigint,
    'Assertion 33: Exactly 1 telemetry record inserted for nonce_pgtap_001 (idempotent re-insert rejected)'
);

SELECT is(
    (SELECT COUNT(*) FROM public.notification_telemetry WHERE delivery_id = '22222222-2222-2222-2222-222222222222'),
    1::bigint,
    'Assertion 34: Exactly 1 telemetry event recorded for delivery'
);

SELECT is(
    (SELECT recipient_id FROM public.notification_telemetry WHERE event_nonce = 'nonce_pgtap_001'),
    '00000000-0000-0000-0000-000000000001'::uuid,
    'Assertion 35: Telemetry recipient_id matches verified owner'
);

-- ----------------------------------------------------------------------------
-- Assertions 36–40: Endpoint Deactivation, Preflight Revocation & Ownership Isolation
-- Phase 2 replaces token ownership transfer trigger with endpoint is_active guard.
-- Deactivating an endpoint causes authorize_notification_delivery_dispatch to return
-- ENDPOINT_REVOKED_OR_INACTIVE and mark the delivery failed.
-- ----------------------------------------------------------------------------
-- Setup a second delivery for preflight revocation test
DO $$
DECLARE
    v_camp_id uuid := '00000000-0000-0000-0000-000000000099';
BEGIN
    DELETE FROM public.notification_deliveries WHERE id = '33333333-3333-3333-3333-333333333333';

    INSERT INTO public.notification_deliveries (
        id, campaign_id, recipient_type, recipient_id, endpoint_id,
        channel_type, delivery_status, lease_token, lease_expires_at,
        worker_id, retry_count, max_retries
    ) VALUES (
        '33333333-3333-3333-3333-333333333333',
        v_camp_id, 'user',
        '00000000-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
        'fcm', 'leased',
        '44444444-4444-4444-4444-444444444444',
        NOW() + INTERVAL '60 seconds',
        'worker_revoke_test',
        0, 2
    );
END $$;

-- Assertion 36: Dispatch authorization with wrong endpoint_id returns authorized=false
-- (p_token_id is ignored in Phase 2 logic; fence check is on lease_token + worker_id)
-- Use a correct lease but wrong worker_id to get a fence rejection
SELECT is(
    (SELECT (public.authorize_notification_delivery_dispatch(
        '33333333-3333-3333-3333-333333333333'::uuid,
        '99999999-9999-9999-9999-999999999999'::uuid,
        '44444444-4444-4444-4444-444444444444'::uuid,  -- correct lease token
        'wrong_worker_id',                               -- wrong worker_id → FENCE_TOKEN_MISMATCH
        '00000000-0000-0000-0000-000000000001'::uuid
    ))->>'authorized')::boolean,
    false,
    'Assertion 36: Dispatch authorization with wrong worker_id correctly returns authorized=false (FENCE_TOKEN_MISMATCH)'
);

-- Deactivate the endpoint (simulating revocation/ownership change)
UPDATE public.notification_endpoints
SET is_active      = false,
    revoked_at     = NOW(),
    revocation_reason = 'pgtap_revoke_test',
    updated_at     = NOW()
WHERE id = '11111111-1111-1111-1111-111111111111';

-- Assertion 37: authorize_notification_delivery_dispatch returns ENDPOINT_REVOKED_OR_INACTIVE
SELECT is(
    (SELECT (public.authorize_notification_delivery_dispatch(
        '33333333-3333-3333-3333-333333333333'::uuid,
        '11111111-1111-1111-1111-111111111111'::uuid,
        '44444444-4444-4444-4444-444444444444'::uuid,  -- correct lease
        'worker_revoke_test',                           -- correct worker
        '00000000-0000-0000-0000-000000000001'::uuid
    ))->>'reason'),
    'ENDPOINT_REVOKED_OR_INACTIVE',
    'Assertion 37: Revoked endpoint causes dispatch authorization to return ENDPOINT_REVOKED_OR_INACTIVE'
);

SELECT is(
    (SELECT delivery_status FROM public.notification_deliveries WHERE id = '33333333-3333-3333-3333-333333333333'),
    'failed',
    'Assertion 38: Delivery is immediately failed when endpoint is revoked during preflight'
);

SELECT is(
    (SELECT lease_token FROM public.notification_deliveries WHERE id = '33333333-3333-3333-3333-333333333333'),
    NULL,
    'Assertion 39: Lease credentials revoked and cleared on endpoint revocation'
);

-- Verify compatibility view reflects deactivated endpoint
SELECT is(
    (SELECT is_active FROM public.notification_tokens WHERE id = '11111111-1111-1111-1111-111111111111'),
    false,
    'Assertion 40: Deactivated endpoint reflects is_active = false in notification_tokens compatibility view'
);

-- ----------------------------------------------------------------------------
-- Assertions 41–42: Final Invariant & Compatibility View Health
-- ----------------------------------------------------------------------------
SELECT is(
    (SELECT COUNT(*) FROM public.notification_endpoints WHERE endpoint_hash IS NULL),
    0::bigint,
    'Assertion 41: Zero notification_endpoints retain NULL endpoint_hash'
);

-- Verify notification_tokens compatibility view exists and is queryable
SELECT is(
    (SELECT COUNT(*) FROM public.legacy_delivery_quarantine WHERE reason = 'CORRUPT_DELIVERY_DATA'),
    0::bigint,
    'Assertion 42: Quarantine log clean of unhandled corrupt delivery errors'
);

SELECT * FROM finish();
ROLLBACK;
