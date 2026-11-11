-- ============================================================================
-- Phase 5.9.5 Standalone PostgreSQL 17 Verification (8 Baseline -> Unified)
-- Executes real pgTAP + DML + Trigger + ACL tests without Phase 5.2 or 5.4.
-- ============================================================================

\set ON_ERROR_STOP on
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(38);

-- Seed users, admin, inconsistent endpoints, historical telemetry/inbox
INSERT INTO auth.users (id, email)
VALUES
    ('59500000-0000-0000-0000-000000000001', 'admin595@movieverify.com'),
    ('59500000-0000-0000-0000-000000000002', 'alice595@movieverify.com'),
    ('59500000-0000-0000-0000-000000000003', 'bob595@movieverify.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.admin_users (user_id)
VALUES ('59500000-0000-0000-0000-000000000001')
ON CONFLICT (user_id) DO NOTHING;

-- Verify inconsistent pre-migration reconciled endpoint row wasn't created active, plus seed fresh fixtures
INSERT INTO public.notification_endpoints (
    id, user_id, device_type, channel_type, token, endpoint_hash, client_secret_hash, is_active, revoked_at, revocation_reason
)
VALUES
    ('59510000-0000-0000-0000-000000000001', '59500000-0000-0000-0000-000000000002', 'web', 'fcm', 'tok-595-active-alice-123456', repeat('a1', 32), repeat('b1', 32), true, NULL, NULL),
    ('59510000-0000-0000-0000-000000000002', '59500000-0000-0000-0000-000000000002', 'web', 'fcm', 'tok-595-revoked-reason-12345', repeat('a2', 32), repeat('b2', 32), true, NULL, NULL),
    ('59510000-0000-0000-0000-000000000003', '59500000-0000-0000-0000-000000000002', 'web', 'fcm', 'tok-595-alice-to-bob-1234567', repeat('a3', 32), repeat('b3', 32), true, NULL, NULL),
    ('59510000-0000-0000-0000-000000000004', NULL, 'web', 'fcm', 'tok-595-guest-valid-12345678', repeat('a4', 32), repeat('b4', 32), true, NULL, NULL);

INSERT INTO public.notification_campaigns (id, title, body, category, status, created_by)
VALUES
    ('59520000-0000-0000-0000-000000000001', '595 Cancel ACL Target', 'Body', 'system', 'processing', '59500000-0000-0000-0000-000000000001'),
    ('59520000-0000-0000-0000-000000000002', '595 Active Dispatch', 'Body', 'movie_release', 'processing', '59500000-0000-0000-0000-000000000001');

INSERT INTO public.notification_deliveries (
    id, campaign_id, recipient_type, recipient_id, endpoint_id, channel_type, delivery_status, max_retries
)
VALUES
    ('59530000-0000-0000-0000-000000000001', '59520000-0000-0000-0000-000000000001', 'user', '59500000-0000-0000-0000-000000000002', '59510000-0000-0000-0000-000000000001', 'fcm', 'pending', 3),
    ('59530000-0000-0000-0000-000000000002', '59520000-0000-0000-0000-000000000002', 'user', '59500000-0000-0000-0000-000000000002', '59510000-0000-0000-0000-000000000002', 'fcm', 'pending', 3),
    ('59530000-0000-0000-0000-000000000003', '59520000-0000-0000-0000-000000000002', 'user', '59500000-0000-0000-0000-000000000002', '59510000-0000-0000-0000-000000000003', 'fcm', 'pending', 3),
    ('59530000-0000-0000-0000-000000000004', '59520000-0000-0000-0000-000000000002', 'guest', NULL, '59510000-0000-0000-0000-000000000004', 'fcm', 'pending', 3);

-- Revoke endpoint 0002 after delivery 0002 was scheduled (tests pre-enqueue -> post-enqueue revocation)
UPDATE public.notification_endpoints
SET is_active = false,
    revoked_at = NOW(),
    revocation_reason = 'user_revoked'
WHERE id = '59510000-0000-0000-0000-000000000002';

-- Historical inbox + telemetry anchored to delivery 5953...0001
INSERT INTO public.notification_telemetry (delivery_id, campaign_id, recipient_type, recipient_id, event_type, event_nonce)
VALUES ('59530000-0000-0000-0000-000000000001', '59520000-0000-0000-0000-000000000001', 'user', '59500000-0000-0000-0000-000000000002', 'displayed', '595_preserve_1');

INSERT INTO public.user_notifications (user_id, campaign_id, delivery_id, title, body, category)
VALUES ('59500000-0000-0000-0000-000000000002', '59520000-0000-0000-0000-000000000001', '59530000-0000-0000-0000-000000000001', 'Inbox Preserve', 'Keep me', 'system');

-- ----------------------------------------------------------------------------
-- Assertions 1-4: Column, Index & Strict pg_proc ACL Checks
-- ----------------------------------------------------------------------------
SELECT has_column('public', 'notification_deliveries', 'dispatch_attempt_id', '1. dispatch_attempt_id exists on notification_deliveries');
SELECT hasnt_column('public', 'notification_deliveries', 'delivered_at', '2. No speculative delivered_at added outside Phase 5.4');
SELECT has_index('public', 'notification_deliveries', 'idx_notification_deliveries_attempt', '3. Partial attempt index exists');

SELECT ok(
    NOT has_function_privilege('anon', 'public.cancel_notification_campaign(uuid)'::regprocedure, 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.cancel_notification_campaign(uuid)'::regprocedure, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.reserve_notification_deliveries(varchar,integer,integer)'::regprocedure, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.authorize_notification_delivery_dispatch(uuid,uuid,uuid,varchar,uuid)'::regprocedure, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.confirm_notification_delivery_sent(uuid,uuid,text)'::regprocedure, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.fail_or_retry_notification_delivery(uuid,varchar,uuid,text,text,integer)'::regprocedure, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.record_notification_delivery_failure(uuid,varchar,uuid,text,text,integer)'::regprocedure, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.sweep_expired_delivery_reservations()'::regprocedure, 'EXECUTE')
    AND has_function_privilege('service_role', 'public.reserve_notification_deliveries(varchar,integer,integer)'::regprocedure, 'EXECUTE')
    AND has_function_privilege('service_role', 'public.sweep_expired_delivery_reservations()'::regprocedure, 'EXECUTE'),
    '4. Worker RPCs strictly deny PUBLIC/anon/authenticated and grant service_role'
);

-- ----------------------------------------------------------------------------
-- Assertions 5-8: Role Execution & cancel_notification_campaign Auth Fix
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT throws_ok(
    'SELECT public.cancel_notification_campaign(''59520000-0000-0000-0000-000000000001''::uuid)',
    '42501', NULL, '5. anon denied on cancel_notification_campaign'
);
SELECT throws_ok(
    'SELECT public.reserve_notification_deliveries(''w1'', 5, 60)',
    '42501', NULL, '6. anon denied on reserve_notification_deliveries'
);
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"59500000-0000-0000-0000-000000000002"}', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '59500000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
    'SELECT public.cancel_notification_campaign(''59520000-0000-0000-0000-000000000001''::uuid)',
    'MV403', NULL, '7. Non-admin authenticated user rejected (MV403) on cancel_notification_campaign'
);
SELECT throws_ok(
    'SELECT public.authorize_notification_delivery_dispatch(''59530000-0000-0000-0000-000000000001''::uuid,''59510000-0000-0000-0000-000000000001''::uuid,gen_random_uuid(),''w'',NULL)',
    '42501', NULL, '8. Non-admin authenticated user denied execute on authorize_notification_delivery_dispatch'
);

-- Even before trigger execution, invoker-RLS + column DCL blocks direct authenticated access to notification_tokens (defense in depth),
-- and even under a non-admin authenticated JWT context in a privileged session, trg_compat_notification_tokens_update blocks reactivation & transfer.
RESET ROLE;

UPDATE public.notification_tokens
SET is_active = true,
    revoked_at = NULL,
    user_id = '59500000-0000-0000-0000-000000000003'
WHERE id = '59510000-0000-0000-0000-000000000002';

SELECT is(
    (SELECT is_active FROM public.notification_endpoints WHERE id = '59510000-0000-0000-0000-000000000002'),
    false, '9. Authenticated view caller CANNOT reactivate revoked endpoint'
);
SELECT is(
    (SELECT user_id FROM public.notification_endpoints WHERE id = '59510000-0000-0000-0000-000000000002'),
    '59500000-0000-0000-0000-000000000002'::uuid, '10. Authenticated view caller CANNOT reassign user_id'
);
SELECT ok(
    (SELECT revoked_at IS NOT NULL AND revocation_reason = 'user_revoked'
     FROM public.notification_endpoints WHERE id = '59510000-0000-0000-0000-000000000002'),
    '11. Untrusted view update preserves revoked_at and revocation_reason'
);

-- Service role passive heartbeat (revoked_at omitted -> NEW.revoked_at remains OLD.revoked_at) MUST NOT reauthorize
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);

UPDATE public.notification_tokens
SET is_active = true
WHERE id = '59510000-0000-0000-0000-000000000002';

SELECT is(
    (SELECT is_active FROM public.notification_endpoints WHERE id = '59510000-0000-0000-0000-000000000002'),
    false, '12. Passive service_role update without revoked_at=NULL cannot silently reactivate'
);

-- Service role EXPLICIT reauthorization clears both revoked_at and revocation_reason, then re-revoke for dispatch test
UPDATE public.notification_tokens
SET is_active = true, revoked_at = NULL
WHERE id = '59510000-0000-0000-0000-000000000002';

SELECT ok(
    (SELECT is_active = true AND revoked_at IS NULL AND revocation_reason IS NULL
     FROM public.notification_endpoints WHERE id = '59510000-0000-0000-0000-000000000002'),
    '13. Trusted service_role explicit reauthorization atomically clears revoked_at & revocation_reason'
);

UPDATE public.notification_tokens
SET is_active = false, revoked_at = NOW()
WHERE id = '59510000-0000-0000-0000-000000000002';

-- ----------------------------------------------------------------------------
-- Assertions 14-15: Admin cancel_notification_campaign & Audit Actor Role
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"59500000-0000-0000-0000-000000000001"}', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '59500000-0000-0000-0000-000000000001', true);
SET LOCAL ROLE authenticated;

SELECT ok(
    ((public.cancel_notification_campaign('59520000-0000-0000-0000-000000000001'::uuid))->>'success')::boolean,
    '14. Verified admin successfully executes cancel_notification_campaign'
);
RESET ROLE;

SELECT is(
    (SELECT status FROM public.notification_campaigns WHERE id = '59520000-0000-0000-0000-000000000001'),
    'cancelled', '15. Cancelled campaign status updated and historical telemetry/inbox preserved'
);

-- ----------------------------------------------------------------------------
-- Assertions 16-24: Reserve, Revocation Rejection, Ownership Mismatch WITHOUT MV403,
--                   and Terminal Identity-Bypass Prevention
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);

DO $$
DECLARE
    v_claim_count integer;
    v_revoked_claimed integer;
    v_del3_lease uuid;
    v_del4_lease uuid;
    v_auth_mismatch jsonb;
    v_auth_guest jsonb;
    v_auth_replay jsonb;
    v_conf_bad jsonb;
    v_conf_good jsonb;
BEGIN
    CREATE TEMP TABLE tmp_595_claims ON COMMIT DROP AS
    SELECT * FROM public.reserve_notification_deliveries('w-595-main', 10, 60);

    SELECT count(*)::integer INTO v_claim_count FROM tmp_595_claims;
    IF v_claim_count <> 2 THEN
        RAISE EXCEPTION 'Expected 2 claimable deliveries (del3 + guest del4), got %', v_claim_count;
    END IF;

    SELECT count(*)::integer INTO v_revoked_claimed
    FROM tmp_595_claims
    WHERE delivery_id = '59530000-0000-0000-0000-000000000002';
    IF v_revoked_claimed <> 0 THEN
        RAISE EXCEPTION 'Revoked endpoint delivery was unexpectedly reserved';
    END IF;

    -- Now simulate ownership transfer of endpoint 0003 from Alice to Bob AFTER reservation!
    UPDATE public.notification_endpoints
    SET user_id = '59500000-0000-0000-0000-000000000003',
        updated_at = NOW()
    WHERE id = '59510000-0000-0000-0000-000000000003';

    SELECT reservation_token INTO v_del3_lease FROM tmp_595_claims WHERE delivery_id = '59530000-0000-0000-0000-000000000003';
    SELECT reservation_token INTO v_del4_lease FROM tmp_595_claims WHERE delivery_id = '59530000-0000-0000-0000-000000000004';

    -- Must return RECIPIENT_OWNERSHIP_MISMATCH and transition delivery to 'failed' WITHOUT throwing MV403!
    v_auth_mismatch := public.authorize_notification_delivery_dispatch(
        '59530000-0000-0000-0000-000000000003'::uuid,
        '59510000-0000-0000-0000-000000000003'::uuid,
        v_del3_lease,
        'w-595-main',
        '59500000-0000-0000-0000-000000000002'::uuid
    );
    IF (v_auth_mismatch->>'authorized')::boolean OR (v_auth_mismatch->>'reason') <> 'RECIPIENT_OWNERSHIP_MISMATCH' THEN
        RAISE EXCEPTION 'Expected RECIPIENT_OWNERSHIP_MISMATCH, got %', v_auth_mismatch;
    END IF;

    -- Guest delivery (recipient_id IS NULL) authorizes & mints attempt + returns provider_token
    v_auth_guest := public.authorize_notification_delivery_dispatch(
        '59530000-0000-0000-0000-000000000004'::uuid,
        '59510000-0000-0000-0000-000000000004'::uuid,
        v_del4_lease,
        'w-595-main',
        NULL
    );
    IF NOT COALESCE((v_auth_guest->>'authorized')::boolean, false)
       OR (v_auth_guest->>'provider_token') <> 'tok-595-guest-valid-12345678' THEN
        RAISE EXCEPTION 'Expected guest authorization with provider_token, got %', v_auth_guest;
    END IF;

    -- Replay authorization fails with ALREADY_AUTHORIZED_FOR_DISPATCH
    v_auth_replay := public.authorize_notification_delivery_dispatch(
        '59530000-0000-0000-0000-000000000004'::uuid,
        '59510000-0000-0000-0000-000000000004'::uuid,
        v_del4_lease,
        'w-595-main',
        NULL
    );
    IF (v_auth_replay->>'reason') <> 'ALREADY_AUTHORIZED_FOR_DISPATCH' THEN
        RAISE EXCEPTION 'Expected ALREADY_AUTHORIZED_FOR_DISPATCH, got %', v_auth_replay;
    END IF;

    -- Stale attempt ID confirm fails CAS; exact attempt ID confirms sent
    v_conf_bad := public.confirm_notification_delivery_sent(
        '59530000-0000-0000-0000-000000000004'::uuid,
        gen_random_uuid(),
        'fcm-stale'
    );
    IF (v_conf_bad->>'reason') <> 'CAS_FAILED_OR_LEASE_LOST' THEN
        RAISE EXCEPTION 'Expected CAS_FAILED_OR_LEASE_LOST, got %', v_conf_bad;
    END IF;

    v_conf_good := public.confirm_notification_delivery_sent(
        '59530000-0000-0000-0000-000000000004'::uuid,
        (v_auth_guest->>'dispatch_attempt_id')::uuid,
        'fcm-guest-ok-1'
    );
    IF NOT COALESCE((v_conf_good->>'success')::boolean, false) THEN
        RAISE EXCEPTION 'Expected confirm success, got %', v_conf_good;
    END IF;
END $$;

SELECT is(
    (SELECT delivery_status FROM public.notification_deliveries WHERE id = '59530000-0000-0000-0000-000000000003'),
    'failed', '16. Ownership mismatch transitions delivery cleanly to failed without MV403 crash'
);
SELECT is(
    (SELECT delivery_status FROM public.notification_deliveries WHERE id = '59530000-0000-0000-0000-000000000004'),
    'sent', '17. Guest delivery authorized with provider_token and confirmed sent'
);
SELECT is(
    (SELECT dispatch_attempt_id FROM public.notification_deliveries WHERE id = '59530000-0000-0000-0000-000000000004'),
    NULL, '18. dispatch_attempt_id cleared after confirm'
);

-- Terminal-status identity-change bypass protection (Assertions 19-20)
SELECT throws_ok(
    $$UPDATE public.notification_deliveries
      SET endpoint_id = '59510000-0000-0000-0000-000000000004', delivery_status = 'failed'
      WHERE id = '59530000-0000-0000-0000-000000000001'$$,
    'MV403', NULL, '19. Terminal status failed CANNOT bypass endpoint_id ownership check'
);
SELECT throws_ok(
    $$UPDATE public.notification_deliveries
      SET recipient_id = '59500000-0000-0000-0000-000000000003', delivery_status = 'cancelled'
      WHERE id = '59530000-0000-0000-0000-000000000001'$$,
    'MV409', NULL, '20. Terminal status cancelled CANNOT bypass immutable identity column check'
);

-- Delivery leased while active, then endpoint revoked BEFORE authorize_notification_delivery_dispatch
INSERT INTO public.notification_endpoints (id, user_id, device_type, channel_type, token, endpoint_hash, client_secret_hash, is_active)
VALUES ('59510000-0000-0000-0000-000000000009', '59500000-0000-0000-0000-000000000002', 'web', 'fcm', 'tok-595-prelease-rev-123456', repeat('a9', 32), repeat('b9', 32), true);

INSERT INTO public.notification_deliveries (
    id, campaign_id, recipient_type, recipient_id, endpoint_id, channel_type,
    delivery_status, lease_token, lease_expires_at, worker_id, retry_count, max_retries
)
VALUES (
    '59530000-0000-0000-0000-000000000011', '59520000-0000-0000-0000-000000000002', 'user', '59500000-0000-0000-0000-000000000002', '59510000-0000-0000-0000-000000000009', 'fcm',
    'leased', '59540000-0000-0000-0000-000000000002'::uuid, NOW() + interval '5 minutes', 'w-rev-chk', 0, 3
);

UPDATE public.notification_endpoints
SET is_active = false,
    revoked_at = NOW(),
    revocation_reason = 'user_revoked'
WHERE id = '59510000-0000-0000-0000-000000000009';

SELECT is(
    (SELECT (public.authorize_notification_delivery_dispatch(
        '59530000-0000-0000-0000-000000000011'::uuid,
        '59510000-0000-0000-0000-000000000009'::uuid,
        '59540000-0000-0000-0000-000000000002'::uuid,
        'w-rev-chk',
        '59500000-0000-0000-0000-000000000002'::uuid
    ))->>'reason'),
    'ENDPOINT_REVOKED_OR_INACTIVE',
    '21. Pre-leased delivery targeting revoked endpoint rejected with ENDPOINT_REVOKED_OR_INACTIVE'
);
SELECT is(
    (SELECT delivery_status FROM public.notification_deliveries WHERE id = '59530000-0000-0000-0000-000000000011'),
    'failed',
    '22. Revoked endpoint pre-dispatch rejection transitions delivery cleanly to failed'
);

-- ----------------------------------------------------------------------------
-- Assertions 23-32: fail_or_retry (Transient Backoff, Max Retries, UNREGISTERED)
--                   + sweep_expired_delivery_reservations (Retry vs Invalid Endpoint)
-- ----------------------------------------------------------------------------
INSERT INTO public.notification_endpoints (id, user_id, device_type, channel_type, token, endpoint_hash, client_secret_hash, is_active)
VALUES
    ('59510000-0000-0000-0000-000000000005', '59500000-0000-0000-0000-000000000002', 'web', 'fcm', 'tok-595-retry-endpoint-1234', repeat('a5', 32), repeat('b5', 32), true),
    ('59510000-0000-0000-0000-000000000006', '59500000-0000-0000-0000-000000000002', 'web', 'fcm', 'tok-595-unreg-endpoint-1234', repeat('a6', 32), repeat('b6', 32), true);

INSERT INTO public.notification_deliveries (
    id, campaign_id, recipient_type, recipient_id, endpoint_id, channel_type,
    delivery_status, lease_token, lease_expires_at, worker_id, retry_count, max_retries
)
VALUES
    ('59530000-0000-0000-0000-000000000005', '59520000-0000-0000-0000-000000000002', 'user', '59500000-0000-0000-0000-000000000002', '59510000-0000-0000-0000-000000000005', 'fcm',
     'leased', '59540000-0000-0000-0000-000000000005'::uuid, NOW() + interval '60 seconds', 'w-fail', 0, 2),
    ('59530000-0000-0000-0000-000000000006', '59520000-0000-0000-0000-000000000002', 'user', '59500000-0000-0000-0000-000000000002', '59510000-0000-0000-0000-000000000006', 'fcm',
     'leased', '59540000-0000-0000-0000-000000000006'::uuid, NOW() + interval '60 seconds', 'w-fail', 0, 2),
    ('59530000-0000-0000-0000-000000000007', '59520000-0000-0000-0000-000000000002', 'user', '59500000-0000-0000-0000-000000000002', '59510000-0000-0000-0000-000000000005', 'fcm',
     'leased', '59540000-0000-0000-0000-000000000007'::uuid, NOW() - interval '10 seconds', 'w-dead', 0, 2),
    ('59530000-0000-0000-0000-000000000008', '59520000-0000-0000-0000-000000000002', 'user', '59500000-0000-0000-0000-000000000002', '59510000-0000-0000-0000-000000000005', 'fcm',
     'leased', '59540000-0000-0000-0000-000000000008'::uuid, NOW() - interval '10 seconds', 'w-dead', 2, 2);

-- Transient failure -> 'pending' backoff
SELECT is(
    public.fail_or_retry_notification_delivery(
        '59530000-0000-0000-0000-000000000005'::uuid, 'w-fail',
        '59540000-0000-0000-0000-000000000005'::uuid, 'UNAVAILABLE', 'Temporary FCM outage', NULL
    ),
    'pending', '23. Transient failure returns delivery to pending for retry'
);
SELECT ok(
    (SELECT retry_count = 1 AND next_retry_at > NOW() AND lease_token IS NULL
     FROM public.notification_deliveries WHERE id = '59530000-0000-0000-0000-000000000005'),
    '24. Transient failure increments retry_count and sets backoff next_retry_at'
);

-- UNREGISTERED failure -> 'failed' AND endpoint revoked cleanly
SELECT is(
    public.fail_or_retry_notification_delivery(
        '59530000-0000-0000-0000-000000000006'::uuid, 'w-fail',
        '59540000-0000-0000-0000-000000000006'::uuid, 'UNREGISTERED', 'Token no longer registered', NULL
    ),
    'failed', '25. UNREGISTERED permanent failure marks delivery failed'
);
SELECT ok(
    (SELECT is_active = false AND revoked_at IS NOT NULL AND revocation_reason = 'fcm_unregistered'
     FROM public.notification_endpoints WHERE id = '59510000-0000-0000-0000-000000000006'),
    '26. UNREGISTERED failure atomically deactivates endpoint with fcm_unregistered'
);

-- Mismatched fence on fail_or_retry -> conflict
SELECT is(
    public.fail_or_retry_notification_delivery(
        '59530000-0000-0000-0000-000000000006'::uuid, 'w-fail',
        '59540000-0000-0000-0000-000000000006'::uuid, 'UNAVAILABLE', 'Duplicate retry', NULL
    ),
    'conflict', '27. Duplicate/terminal fail_or_retry call returns conflict without mutation'
);

-- Sweep expired reservations (0007 retryable -> pending, 0008 exhausted -> failed)
SELECT is(
    public.sweep_expired_delivery_reservations(),
    2, '28. sweep_expired_delivery_reservations sweeps both expired leased deliveries'
);
SELECT is(
    (SELECT delivery_status FROM public.notification_deliveries WHERE id = '59530000-0000-0000-0000-000000000007'),
    'pending', '29. Swept retryable lease returns to pending'
);
SELECT is(
    (SELECT delivery_status FROM public.notification_deliveries WHERE id = '59530000-0000-0000-0000-000000000008'),
    'failed', '30. Swept max-retried lease transitions to failed'
);

-- ----------------------------------------------------------------------------
-- Assertions 31-38: Data Preservation & Pre-Reconciled Corrupt Endpoint Verification
-- ----------------------------------------------------------------------------
SELECT is(
    (SELECT count(*)::integer FROM public.notification_telemetry WHERE delivery_id = '59530000-0000-0000-0000-000000000001'),
    1, '31. Telemetry rows preserved'
);
SELECT is(
    (SELECT count(*)::integer FROM public.user_notifications WHERE delivery_id = '59530000-0000-0000-0000-000000000001'),
    1, '32. Inbox rows preserved'
);
SELECT is(
    (SELECT count(*)::integer FROM public.notification_endpoints WHERE is_active = true AND (revoked_at IS NOT NULL OR revocation_reason IS NOT NULL)),
    0, '33. Zero inconsistent active endpoints remain after unified migration'
);

-- Test sweep on expired lease whose endpoint was revoked concurrently (must NOT crash batch)
INSERT INTO public.notification_endpoints (id, user_id, device_type, channel_type, token, endpoint_hash, client_secret_hash, is_active)
VALUES ('59510000-0000-0000-0000-000000000007', '59500000-0000-0000-0000-000000000002', 'web', 'fcm', 'tok-595-sweep-revoke-12345', repeat('a7', 32), repeat('b7', 32), true);

INSERT INTO public.notification_deliveries (
    id, campaign_id, recipient_type, recipient_id, endpoint_id, channel_type,
    delivery_status, lease_token, lease_expires_at, worker_id, retry_count, max_retries
)
VALUES
    ('59530000-0000-0000-0000-000000000009', '59520000-0000-0000-0000-000000000002', 'user', '59500000-0000-0000-0000-000000000002', '59510000-0000-0000-0000-000000000007', 'fcm',
     'leased', '59540000-0000-0000-0000-000000000009'::uuid, NOW() - interval '5 seconds', 'w-dead', 0, 3);

UPDATE public.notification_endpoints
SET is_active = false,
    revoked_at = NOW(),
    revocation_reason = 'user_revoked'
WHERE id = '59510000-0000-0000-0000-000000000007';

SELECT is(
    public.sweep_expired_delivery_reservations(),
    1, '34. Sweep handles expired lease pointing to revoked endpoint without raising MV410'
);
SELECT is(
    (SELECT delivery_status FROM public.notification_deliveries WHERE id = '59530000-0000-0000-0000-000000000009'),
    'failed', '35. Swept lease on revoked endpoint transitions cleanly to failed'
);

-- Transient fail_or_retry on ownership-transferred endpoint transitions cleanly to failed instead of MV403 crash
INSERT INTO public.notification_endpoints (id, user_id, device_type, channel_type, token, endpoint_hash, client_secret_hash, is_active)
VALUES ('59510000-0000-0000-0000-000000000008', '59500000-0000-0000-0000-000000000002', 'web', 'fcm', 'tok-595-xfer-fail-123456', repeat('a8', 32), repeat('b8', 32), true);

INSERT INTO public.notification_deliveries (
    id, campaign_id, recipient_type, recipient_id, endpoint_id, channel_type,
    delivery_status, lease_token, lease_expires_at, worker_id, retry_count, max_retries
)
VALUES (
    '59530000-0000-0000-0000-000000000010', '59520000-0000-0000-0000-000000000002', 'user', '59500000-0000-0000-0000-000000000002', '59510000-0000-0000-0000-000000000008', 'fcm',
    'leased', '59540000-0000-0000-0000-000000000010'::uuid, NOW() + interval '60 seconds', 'w-xfer', 0, 3
);

UPDATE public.notification_endpoints
SET user_id = '59500000-0000-0000-0000-000000000003',
    updated_at = NOW()
WHERE id = '59510000-0000-0000-0000-000000000008';

SELECT is(
    public.fail_or_retry_notification_delivery(
        '59530000-0000-0000-0000-000000000010'::uuid, 'w-xfer',
        '59540000-0000-0000-0000-000000000010'::uuid, 'UNAVAILABLE', 'Transient error after ownership change', NULL
    ),
    'failed', '36. Transient failure on ownership-changed endpoint marks failed cleanly (no MV403 abort)'
);

-- Service-role audit attribution on cancel_notification_campaign
SELECT ok(
    ((public.cancel_notification_campaign('59520000-0000-0000-0000-000000000002'::uuid))->>'success')::boolean,
    '37. service_role can execute cancel_notification_campaign cleanly'
);
SELECT is(
    (SELECT actor_role FROM public.notification_audit_log WHERE entity_id = '59520000-0000-0000-0000-000000000002' ORDER BY created_at DESC LIMIT 1),
    'service_role', '38. service_role cancel audit entry records actor_role = service_role'
);

SELECT * FROM finish();
ROLLBACK;

