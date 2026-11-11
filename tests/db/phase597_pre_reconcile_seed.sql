-- ============================================================================
-- Phase 5.9.7 Pre-Reconciliation Seed (Disposable Container ONLY)
-- Applied after 8 baseline migrations and BEFORE Phase 5.2 -> 5.4 -> Unified.
-- Seeds inconsistent legacy endpoints and historical delivery/telemetry/inbox rows.
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, email)
VALUES ('59780000-0000-0000-0000-000000000001', 'legacy-rec-597@movieverify.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.notification_endpoints (
    id, user_id, device_type, channel_type, token, endpoint_hash, client_secret_hash,
    is_active, revoked_at, revocation_reason
)
VALUES
    ('faa972b2-3cd7-4ed9-bb67-f931ca6a0601', '59780000-0000-0000-0000-000000000001', 'web', 'fcm', 'tok-597-legacy-corrupt-123456', repeat('c1', 32), repeat('d1', 32), true, NOW() - interval '2 days', NULL),
    ('59781000-0000-0000-0000-000000000002', '59780000-0000-0000-0000-000000000001', 'web', 'fcm', 'tok-597-legacy-reason-123456',  repeat('c2', 32), repeat('d2', 32), true, NULL, 'legacy_security_hold')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.notification_campaigns (id, title, body, category, status)
VALUES ('59782000-0000-0000-0000-000000000001', 'Legacy Preserved Campaign 597', 'History', 'system', 'completed')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.notification_deliveries (
    id, campaign_id, recipient_type, recipient_id, endpoint_id, channel_type, delivery_status, sent_at
)
VALUES (
    '59783000-0000-0000-0000-000000000001', '59782000-0000-0000-0000-000000000001',
    'user', '59780000-0000-0000-0000-000000000001', 'faa972b2-3cd7-4ed9-bb67-f931ca6a0601',
    'fcm', 'sent', NOW() - interval '1 day'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.notification_telemetry (
    delivery_id, campaign_id, recipient_type, recipient_id, event_type, event_nonce
)
VALUES (
    '59783000-0000-0000-0000-000000000001', '59782000-0000-0000-0000-000000000001',
    'user', '59780000-0000-0000-0000-000000000001', 'opened', 'seed_rec_597_1'
);

INSERT INTO public.user_notifications (
    user_id, campaign_id, delivery_id, category, title, body
)
VALUES (
    '59780000-0000-0000-0000-000000000001', '59782000-0000-0000-0000-000000000001',
    '59783000-0000-0000-0000-000000000001', 'system', 'Legacy Preserved Inbox 597', 'Must never be deleted'
);

COMMIT;

