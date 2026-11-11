\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, email)
VALUES ('59590000-0000-0000-0000-000000000001', 'conc595@movieverify.com')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.p595_conc_audit (
    suite text NOT NULL,
    session_name text NOT NULL,
    xact_id bigint NOT NULL,
    tx_start timestamptz NOT NULL,
    tx_end timestamptz NOT NULL,
    payload jsonb NOT NULL
);
TRUNCATE public.p595_conc_audit;

INSERT INTO public.notification_endpoints (
    id, user_id, device_type, channel_type, token, endpoint_hash, client_secret_hash, is_active
)
VALUES (
    '59591000-0000-0000-0000-000000000001', '59590000-0000-0000-0000-000000000001',
    'web', 'fcm', 'tok-595-conc-auth-revoke-12345', repeat('c1', 32), repeat('d1', 32), true
), (
    '59591000-0000-0000-0000-000000000002', '59590000-0000-0000-0000-000000000001',
    'web', 'fcm', 'tok-595-conc-cancel-sweep-1234', repeat('c2', 32), repeat('d2', 32), true
), (
    '59591000-0000-0000-0000-000000000003', '59590000-0000-0000-0000-000000000001',
    'web', 'fcm', 'tok-595-conc-cancel-sweep-1235', repeat('c3', 32), repeat('d3', 32), true
), (
    '59591000-0000-0000-0000-000000000004', '59590000-0000-0000-0000-000000000001',
    'web', 'fcm', 'tok-595-conc-cancel-sweep-1236', repeat('c4', 32), repeat('d4', 32), true
), (
    '59591000-0000-0000-0000-000000000005', '59590000-0000-0000-0000-000000000001',
    'web', 'fcm', 'tok-595-conc-cancel-sweep-1237', repeat('c5', 32), repeat('d5', 32), true
);

INSERT INTO public.notification_campaigns (id, title, body, category, status, created_by)
VALUES
    ('59592000-0000-0000-0000-000000000001', 'Conc Auth vs Revoke', 'Body', 'system', 'processing', '59590000-0000-0000-0000-000000000001'),
    ('59592000-0000-0000-0000-000000000002', 'Conc Cancel vs Sweep', 'Body', 'system', 'processing', '59590000-0000-0000-0000-000000000001');

INSERT INTO public.notification_deliveries (
    id, campaign_id, recipient_type, recipient_id, endpoint_id, channel_type,
    delivery_status, lease_token, lease_expires_at, worker_id, retry_count, max_retries
)
VALUES
    ('59593000-0000-0000-0000-000000000001', '59592000-0000-0000-0000-000000000001', 'user', '59590000-0000-0000-0000-000000000001', '59591000-0000-0000-0000-000000000001', 'fcm',
     'leased', '59594000-0000-0000-0000-000000000001'::uuid, NOW() + interval '5 minutes', 'w-conc-auth', 0, 3),
    ('59593000-0000-0000-0000-000000000011', '59592000-0000-0000-0000-000000000002', 'user', '59590000-0000-0000-0000-000000000001', '59591000-0000-0000-0000-000000000002', 'fcm',
     'leased', '59594000-0000-0000-0000-000000000011'::uuid, NOW() - interval '30 seconds', 'w-conc-cs', 0, 3),
    ('59593000-0000-0000-0000-000000000012', '59592000-0000-0000-0000-000000000002', 'user', '59590000-0000-0000-0000-000000000001', '59591000-0000-0000-0000-000000000003', 'fcm',
     'leased', '59594000-0000-0000-0000-000000000012'::uuid, NOW() - interval '30 seconds', 'w-conc-cs', 0, 3),
    ('59593000-0000-0000-0000-000000000013', '59592000-0000-0000-0000-000000000002', 'user', '59590000-0000-0000-0000-000000000001', '59591000-0000-0000-0000-000000000004', 'fcm',
     'leased', '59594000-0000-0000-0000-000000000013'::uuid, NOW() - interval '30 seconds', 'w-conc-cs', 0, 3),
    ('59593000-0000-0000-0000-000000000014', '59592000-0000-0000-0000-000000000002', 'user', '59590000-0000-0000-0000-000000000001', '59591000-0000-0000-0000-000000000005', 'fcm',
     'leased', '59594000-0000-0000-0000-000000000014'::uuid, NOW() - interval '30 seconds', 'w-conc-cs', 0, 3);

COMMIT;

