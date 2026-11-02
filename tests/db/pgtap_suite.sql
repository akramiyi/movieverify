-- ============================================================================
-- MOVIEVERIFY NOTIFICATION SYSTEM — 42-ASSERTION BEHAVIORAL PGTAP SUITE
-- File: tests/db/pgtap_suite.sql
-- ============================================================================

\set ON_ERROR_STOP on
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(42);

-- Pre-suite test fixture setup
DO $$
DECLARE
    v_uid uuid := '00000000-0000-0000-0000-000000000001';
    v_tok_id uuid := '11111111-1111-1111-1111-111111111111';
    v_second_tok_id uuid := '99999999-9999-9999-9999-999999999999';
    v_del_id uuid := '22222222-2222-2222-2222-222222222222';
    v_hash text;
    v_hash2 text;
BEGIN
    v_hash := encode(digest('pgtap_token_alpha', 'sha256'), 'hex');
    v_hash2 := encode(digest('pgtap_token_secondary', 'sha256'), 'hex');

    -- Insert mock auth user if not exists
    INSERT INTO auth.users (id, email) VALUES (v_uid, 'test@movieverify.com') ON CONFLICT (id) DO NOTHING;
    INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-000000000002', 'user2@movieverify.com') ON CONFLICT (id) DO NOTHING;

    -- Token 1 (primary)
    INSERT INTO public.notification_tokens (id, user_id, token, token_hash, is_active)
    VALUES (v_tok_id, v_uid, 'pgtap_token_alpha', v_hash, true)
    ON CONFLICT (id) DO UPDATE SET token_hash = v_hash, is_active = true, user_id = v_uid;

    -- Token 2 (secondary valid token belonging to same user for mismatch testing)
    INSERT INTO public.notification_tokens (id, user_id, token, token_hash, is_active)
    VALUES (v_second_tok_id, v_uid, 'pgtap_token_secondary', v_hash2, true)
    ON CONFLICT (id) DO UPDATE SET token_hash = v_hash2, is_active = true, user_id = v_uid;

    -- Clean any leftover delivery from previous runs
    DELETE FROM public.notification_deliveries WHERE id IN (v_del_id, '33333333-3333-3333-3333-333333333333');

    -- Seed primary delivery linked to Token 1
    INSERT INTO public.notification_deliveries (
        id, recipient_id, token_id, token_snapshot_hash, delivery_status, attempt_count, max_attempts
    ) VALUES (
        v_del_id, v_uid, v_tok_id, v_hash, 'pending', 0, 3
    );
END $$;

-- ----------------------------------------------------------------------------
-- Assertions 1–11: Table Existence
-- ----------------------------------------------------------------------------
SELECT has_table('public', 'notification_tokens', 'Table 1: notification_tokens exists');
SELECT has_table('public', 'movie_notify_requests', 'Table 2: movie_notify_requests exists');
SELECT has_table('public', 'actor_notify_requests', 'Table 3: actor_notify_requests exists');
SELECT has_table('public', 'genre_notify_requests', 'Table 4: genre_notify_requests exists');
SELECT has_table('public', 'notification_campaigns', 'Table 5: notification_campaigns exists');
SELECT has_table('public', 'notification_queue', 'Table 6: notification_queue exists');
SELECT has_table('public', 'notification_deliveries', 'Table 7: notification_deliveries exists');
SELECT has_table('public', 'notification_telemetry', 'Table 8: notification_telemetry exists');
SELECT has_table('public', 'user_notifications', 'Table 9: user_notifications exists');
SELECT has_table('public', 'notification_opt_outs', 'Table 10: notification_opt_outs exists');
SELECT has_table('public', 'notification_audit_log', 'Table 11: notification_audit_log exists');

-- ----------------------------------------------------------------------------
-- Assertions 12–16: Column & NOT NULL Integrity
-- ----------------------------------------------------------------------------
SELECT col_not_null('public', 'notification_tokens', 'token_hash', 'notification_tokens.token_hash is NOT NULL');
SELECT col_not_null('public', 'notification_campaigns', 'status', 'notification_campaigns.status is NOT NULL');
SELECT col_not_null('public', 'notification_queue', 'status', 'notification_queue.status is NOT NULL');
SELECT col_not_null('public', 'notification_deliveries', 'token_snapshot_hash', 'notification_deliveries.token_snapshot_hash is NOT NULL');
SELECT col_not_null('public', 'notification_deliveries', 'delivery_status', 'notification_deliveries.delivery_status is NOT NULL');

-- ----------------------------------------------------------------------------
-- Assertions 17–20: Role Privileges & Isolation (SET LOCAL ROLE)
-- ----------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT throws_ok(
    'SELECT * FROM public.reserve_notification_deliveries(''worker_auth_hack'', 10, 30);',
    '42501',
    NULL,
    'Assertion 17: Authenticated user cannot execute reserve_notification_deliveries'
);
SELECT throws_ok(
    'SELECT public.authorize_notification_delivery_dispatch(''22222222-2222-2222-2222-222222222222''::uuid, ''11111111-1111-1111-1111-111111111111''::uuid, gen_random_uuid(), ''worker'', gen_random_uuid());',
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
-- ----------------------------------------------------------------------------
SELECT is(
    (SELECT delivery_status FROM public.notification_deliveries WHERE id = '22222222-2222-2222-2222-222222222222'),
    'reserved',
    'Assertion 21: Delivery is in reserved status after worker claim'
);

SELECT isnt(
    (SELECT reservation_token FROM public.notification_deliveries WHERE id = '22222222-2222-2222-2222-222222222222'),
    NULL,
    'Assertion 22: Delivery has non-null reservation token'
);

SELECT is(
    (SELECT (public.authorize_notification_delivery_dispatch(
        '22222222-2222-2222-2222-222222222222'::uuid,
        '11111111-1111-1111-1111-111111111111'::uuid,
        (SELECT reservation_token FROM public.notification_deliveries WHERE id = '22222222-2222-2222-2222-222222222222'),
        'worker_service_role',
        '00000000-0000-0000-0000-000000000001'::uuid
    )->>'authorized')::boolean),
    true,
    'Assertion 23: Dispatch authorization returns authorized = true'
);

SELECT is(
    (SELECT delivery_status FROM public.notification_deliveries WHERE id = '22222222-2222-2222-2222-222222222222'),
    'dispatching',
    'Assertion 24: Delivery status transitioned to dispatching upon authorization'
);

SELECT isnt(
    (SELECT current_dispatch_attempt_id FROM public.notification_deliveries WHERE id = '22222222-2222-2222-2222-222222222222'),
    NULL,
    'Assertion 25: Delivery has non-null current_dispatch_attempt_id'
);

-- ----------------------------------------------------------------------------
-- Assertions 26–30: One-Time Authorization & Post-Send Settlement
-- ----------------------------------------------------------------------------
SELECT is(
    (SELECT (public.authorize_notification_delivery_dispatch(
        '22222222-2222-2222-2222-222222222222'::uuid,
        '11111111-1111-1111-1111-111111111111'::uuid,
        (SELECT reservation_token FROM public.notification_deliveries WHERE id = '22222222-2222-2222-2222-222222222222'),
        'worker_service_role',
        '00000000-0000-0000-0000-000000000001'::uuid
    )->>'reason')),
    'DISPATCH_REJECTED_ALREADY_DISPATCHING',
    'Assertion 26: Duplicate authorization rejected with DISPATCH_REJECTED_ALREADY_DISPATCHING'
);

SELECT is(
    (SELECT (public.confirm_notification_delivery_sent(
        '22222222-2222-2222-2222-222222222222'::uuid,
        (SELECT current_dispatch_attempt_id FROM public.notification_deliveries WHERE id = '22222222-2222-2222-2222-222222222222'),
        'fcm_msg_test_123'
    )->>'status')),
    'SENT',
    'Assertion 27: Delivery confirmation returns status SENT'
);

SELECT is(
    (SELECT delivery_status FROM public.notification_deliveries WHERE id = '22222222-2222-2222-2222-222222222222'),
    'sent',
    'Assertion 28: Delivery status is sent'
);

SELECT is(
    (SELECT fcm_message_id FROM public.notification_deliveries WHERE id = '22222222-2222-2222-2222-222222222222'),
    'fcm_msg_test_123',
    'Assertion 29: FCM message ID matches confirmed value'
);

SELECT is(
    (SELECT current_dispatch_attempt_id FROM public.notification_deliveries WHERE id = '22222222-2222-2222-2222-222222222222'),
    NULL,
    'Assertion 30: current_dispatch_attempt_id is cleared upon confirmation'
);

-- ----------------------------------------------------------------------------
-- Assertions 31–35: Telemetry Integrity via record_notification_telemetry RPC
-- ----------------------------------------------------------------------------
SELECT is(
    public.record_notification_telemetry(
        '22222222-2222-2222-2222-222222222222'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid,
        'delivered',
        'nonce_pgtap_001'
    ),
    true,
    'Assertion 31: record_notification_telemetry executes successfully'
);

SELECT throws_ok(
    'SELECT public.record_notification_telemetry(''22222222-2222-2222-2222-222222222222''::uuid, ''00000000-0000-0000-0000-000000000001''::uuid, ''opened'', ''nonce_pgtap_001'');',
    '23505',
    NULL,
    'Assertion 32: Reused nonce rejected by unique constraint uq_telemetry_nonce'
);

SELECT throws_ok(
    'SELECT public.record_notification_telemetry(''22222222-2222-2222-2222-222222222222''::uuid, ''00000000-0000-0000-0000-000000000001''::uuid, ''delivered'', ''nonce_pgtap_002'');',
    '23505',
    NULL,
    'Assertion 33: Duplicate delivered event rejected by uq_telemetry_delivery_event'
);

SELECT is(
    (SELECT COUNT(*) FROM public.notification_telemetry WHERE delivery_id = '22222222-2222-2222-2222-222222222222'),
    1::bigint,
    'Assertion 34: Exactly 1 telemetry event recorded for delivery'
);

SELECT is(
    (SELECT recipient_id FROM public.notification_telemetry WHERE nonce = 'nonce_pgtap_001'),
    '00000000-0000-0000-0000-000000000001'::uuid,
    'Assertion 35: Telemetry recipient_id matches verified owner'
);

-- ----------------------------------------------------------------------------
-- Assertions 36–40: Token Ownership Transfer & Race Invariants
-- ----------------------------------------------------------------------------
-- Setup a second delivery for ownership transfer & parameter mismatch test
DO $$
BEGIN
    INSERT INTO public.notification_deliveries (
        id, recipient_id, token_id, token_snapshot_hash, delivery_status, attempt_count, max_attempts,
        worker_id, reservation_token, reservation_expires_at
    ) VALUES (
        '33333333-3333-3333-3333-333333333333',
        '00000000-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
        encode(digest('pgtap_token_alpha', 'sha256'), 'hex'),
        'reserved',
        1,
        3,
        'worker_transfer_test',
        '44444444-4444-4444-4444-444444444444',
        NOW() + INTERVAL '60 seconds'
    );
END $$;

-- Assertion 36 (CORRECTED): Genuine Parameter Mismatch Test with existing secondary token
SELECT is(
    (SELECT (public.authorize_notification_delivery_dispatch(
        '33333333-3333-3333-3333-333333333333'::uuid,
        '99999999-9999-9999-9999-999999999999'::uuid, -- Real secondary token that does NOT match delivery.token_id!
        '44444444-4444-4444-4444-444444444444'::uuid,
        'worker_transfer_test',
        '00000000-0000-0000-0000-000000000001'::uuid
    )->>'reason')),
    'DISPATCH_REJECTED_TOKEN_MISMATCH',
    'Assertion 36: Dispatch authorization with mismatched token correctly returns DISPATCH_REJECTED_TOKEN_MISMATCH'
);

-- Transfer token ownership of primary token
UPDATE public.notification_tokens
SET user_id = '00000000-0000-0000-0000-000000000002',
    updated_at = NOW()
WHERE id = '11111111-1111-1111-1111-111111111111';

SELECT is(
    (SELECT delivery_status FROM public.notification_deliveries WHERE id = '33333333-3333-3333-3333-333333333333'),
    'cancelled',
    'Assertion 37: Token ownership transfer trigger immediately cancelled active delivery'
);

SELECT is(
    (SELECT failure_reason FROM public.notification_deliveries WHERE id = '33333333-3333-3333-3333-333333333333'),
    'OWNERSHIP_TRANSFERRED',
    'Assertion 38: Delivery failure reason is OWNERSHIP_TRANSFERRED'
);

SELECT is(
    (SELECT action FROM public.notification_audit_log ORDER BY id DESC LIMIT 1),
    'TOKEN_OWNERSHIP_TRANSFER',
    'Assertion 39: TOKEN_OWNERSHIP_TRANSFER action logged in notification_audit_log'
);

SELECT is(
    (SELECT reservation_token FROM public.notification_deliveries WHERE id = '33333333-3333-3333-3333-333333333333'),
    NULL,
    'Assertion 40: Reservation credentials revoked and cleared upon ownership transfer'
);

-- ----------------------------------------------------------------------------
-- Assertions 41–42: Final Invariant & Quarantine Health
-- ----------------------------------------------------------------------------
SELECT is(
    (SELECT COUNT(*) FROM public.notification_tokens WHERE token_hash IS NULL),
    0::bigint,
    'Assertion 41: Zero notification tokens retain NULL token_hash'
);

SELECT is(
    (SELECT COUNT(*) FROM public.legacy_delivery_quarantine WHERE reason = 'CORRUPT_DELIVERY_DATA'),
    0::bigint,
    'Assertion 42: Quarantine log clean of unhandled corrupt delivery errors'
);

SELECT * FROM finish();
ROLLBACK;

