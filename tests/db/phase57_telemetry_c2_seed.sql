-- Stage 5 Case 2: Duplicate deliveries WITHOUT telemetry
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users (id, email) VALUES ('57500000-0000-0000-0000-000000000001', 'p57_t2@movieverify.test') ON CONFLICT (id) DO NOTHING;

INSERT INTO public.notification_endpoints (
    id, user_id, channel_type, token, endpoint_hash, client_secret_hash, device_type, device_name, is_active, last_seen_at
) VALUES (
    '57510000-0000-0000-0000-000000000001', '57500000-0000-0000-0000-000000000001', 'fcm', 'p57_t2_tok',
    encode(sha256('p57_t2_tok'::bytea), 'hex'),
    encode(sha256(('p57_t2_tok:' || '57500000-0000-0000-0000-000000000001')::bytea), 'hex'),
    'web', 'T2 Device', true, NOW()
);

INSERT INTO public.notification_campaigns (id, title, body, category, target_type, target_criteria, status, total_recipients)
VALUES ('57520000-0000-0000-0000-000000000001', 'T2 Camp', 'Body', 'system', 'all', '{"type":"all"}'::jsonb, 'queued', 1);

-- Duplicate push deliveries (same campaign_id, endpoint_id) + duplicate in_app deliveries
INSERT INTO public.notification_deliveries (id, campaign_id, recipient_type, recipient_id, endpoint_id, channel_type, delivery_status, created_at) VALUES
    ('57530000-0000-0000-0000-000000000001', '57520000-0000-0000-0000-000000000001', 'user', '57500000-0000-0000-0000-000000000001', '57510000-0000-0000-0000-000000000001', 'fcm', 'sent', NOW() - interval '2 minutes'),
    ('57530000-0000-0000-0000-000000000002', '57520000-0000-0000-0000-000000000001', 'user', '57500000-0000-0000-0000-000000000001', '57510000-0000-0000-0000-000000000001', 'fcm', 'pending', NOW() - interval '1 minute'),
    ('57530000-0000-0000-0000-000000000003', '57520000-0000-0000-0000-000000000001', 'user', '57500000-0000-0000-0000-000000000001', NULL, 'in_app', 'delivered', NOW() - interval '2 minutes'),
    ('57530000-0000-0000-0000-000000000004', '57520000-0000-0000-0000-000000000001', 'user', '57500000-0000-0000-0000-000000000001', NULL, 'in_app', 'pending', NOW() - interval '1 minute');

INSERT INTO public.user_notifications (id, user_id, campaign_id, delivery_id, category, title, body) VALUES
    ('57540000-0000-0000-0000-000000000001', '57500000-0000-0000-0000-000000000001', '57520000-0000-0000-0000-000000000001', '57530000-0000-0000-0000-000000000004', 'system', 'T2', 'Body');

INSERT INTO public.user_welcome_dispatches (user_id, notification_id, delivery_id, status, source) VALUES
    ('57500000-0000-0000-0000-000000000001', '57540000-0000-0000-0000-000000000001', '57530000-0000-0000-0000-000000000004', 'created', 'api')
ON CONFLICT (user_id) DO UPDATE
SET notification_id = EXCLUDED.notification_id,
    delivery_id = EXCLUDED.delivery_id;
COMMIT;

