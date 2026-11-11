-- Stage 5 Case 3A: Duplicate deliveries WITH clean non-colliding telemetry
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users (id, email) VALUES ('57500000-0000-0000-0000-000000000002', 'p57_t3a@movieverify.test') ON CONFLICT (id) DO NOTHING;

INSERT INTO public.notification_endpoints (
    id, user_id, channel_type, token, endpoint_hash, client_secret_hash, device_type, device_name, is_active, last_seen_at
) VALUES (
    '57510000-0000-0000-0000-000000000002', '57500000-0000-0000-0000-000000000002', 'fcm', 'p57_t3a_tok',
    encode(sha256('p57_t3a_tok'::bytea), 'hex'),
    encode(sha256(('p57_t3a_tok:' || '57500000-0000-0000-0000-000000000002')::bytea), 'hex'),
    'web', 'T3A Device', true, NOW()
);

INSERT INTO public.notification_campaigns (id, title, body, category, target_type, target_criteria, status, total_recipients)
VALUES ('57520000-0000-0000-0000-000000000002', 'T3A Camp', 'Body', 'system', 'all', '{"type":"all"}'::jsonb, 'queued', 1);

INSERT INTO public.notification_deliveries (id, campaign_id, recipient_type, recipient_id, endpoint_id, channel_type, delivery_status, created_at) VALUES
    ('57530000-0000-0000-0000-000000000011', '57520000-0000-0000-0000-000000000002', 'user', '57500000-0000-0000-0000-000000000002', '57510000-0000-0000-0000-000000000002', 'fcm', 'delivered', NOW() - interval '3 minutes'),
    ('57530000-0000-0000-0000-000000000012', '57520000-0000-0000-0000-000000000002', 'user', '57500000-0000-0000-0000-000000000002', '57510000-0000-0000-0000-000000000002', 'fcm', 'sent',      NOW() - interval '1 minute');

INSERT INTO public.notification_telemetry (id, delivery_id, campaign_id, recipient_type, recipient_id, event_type, event_nonce) VALUES
    ('57550000-0000-0000-0000-000000000001', '57530000-0000-0000-0000-000000000011', '57520000-0000-0000-0000-000000000002', 'user', '57500000-0000-0000-0000-000000000002', 'displayed', 'nonce_keep_1'),
    ('57550000-0000-0000-0000-000000000002', '57530000-0000-0000-0000-000000000012', '57520000-0000-0000-0000-000000000002', 'user', '57500000-0000-0000-0000-000000000002', 'opened',    'nonce_drop_2'),
    ('57550000-0000-0000-0000-000000000003', '57530000-0000-0000-0000-000000000012', '57520000-0000-0000-0000-000000000002', 'user', '57500000-0000-0000-0000-000000000002', 'clicked',   'nonce_drop_3');
COMMIT;

