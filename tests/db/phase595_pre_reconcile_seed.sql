-- Seed pre-existing inconsistent production-shaped rows BEFORE 20261111180000 executes
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, email)
VALUES ('59580000-0000-0000-0000-000000000001', 'reconcile595@movieverify.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.notification_endpoints (
    id, user_id, device_type, channel_type, token, endpoint_hash, client_secret_hash, is_active, revoked_at, revocation_reason
)
VALUES
    -- Production-shaped State 2: is_active=true with revoked_at IS NOT NULL and reason NULL
    ('faa972b2-3cd7-4ed9-bb67-f931ca6a0601', '59580000-0000-0000-0000-000000000001', 'web', 'fcm', 'tok-faa972b2-reconcile-seed', repeat('e1', 32), repeat('f1', 32), true, NOW() - interval '2 days', NULL),
    -- Production-shaped State 3: is_active=true with revocation_reason IS NOT NULL and revoked_at NULL
    ('59581000-0000-0000-0000-000000000002', '59580000-0000-0000-0000-000000000001', 'web', 'fcm', 'tok-reason-only-reconcile', repeat('e2', 32), repeat('f2', 32), true, NULL, 'legacy_admin_revoked');

INSERT INTO public.notification_campaigns (id, title, body, category, status, created_by)
VALUES ('59582000-0000-0000-0000-000000000001', 'Reconcile Preserve', 'Body', 'system', 'processing', '59580000-0000-0000-0000-000000000001');

INSERT INTO public.notification_deliveries (
    id, campaign_id, recipient_type, recipient_id, endpoint_id, channel_type, delivery_status
)
VALUES ('59583000-0000-0000-0000-000000000001', '59582000-0000-0000-0000-000000000001', 'user', '59580000-0000-0000-0000-000000000001', 'faa972b2-3cd7-4ed9-bb67-f931ca6a0601', 'fcm', 'pending');

INSERT INTO public.notification_telemetry (delivery_id, campaign_id, recipient_type, recipient_id, event_type, event_nonce)
VALUES ('59583000-0000-0000-0000-000000000001', '59582000-0000-0000-0000-000000000001', 'user', '59580000-0000-0000-0000-000000000001', 'displayed', 'seed_rec_1');

INSERT INTO public.user_notifications (user_id, campaign_id, delivery_id, title, body, category)
VALUES ('59580000-0000-0000-0000-000000000001', '59582000-0000-0000-0000-000000000001', '59583000-0000-0000-0000-000000000001', 'Seed Inbox', 'Keep', 'system');

COMMIT;

