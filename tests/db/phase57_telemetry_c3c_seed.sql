-- Stage 5 Case 3C: Duplicate deliveries WITH recipient attribution mismatch
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users (id, email) VALUES
    ('57500000-0000-0000-0000-000000000004', 'p57_t3c_u1@movieverify.test'),
    ('57500000-0000-0000-0000-000000000005', 'p57_t3c_u2@movieverify.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.notification_endpoints (
    id, user_id, channel_type, token, endpoint_hash, client_secret_hash, device_type, device_name, is_active, last_seen_at
) VALUES (
    '57510000-0000-0000-0000-000000000004', '57500000-0000-0000-0000-000000000004', 'fcm', 'p57_t3c_tok',
    encode(sha256('p57_t3c_tok'::bytea), 'hex'),
    encode(sha256(('p57_t3c_tok:' || '57500000-0000-0000-0000-000000000004')::bytea), 'hex'),
    'web', 'T3C Shared Device', true, NOW()
);

INSERT INTO public.notification_campaigns (id, title, body, category, target_type, target_criteria, status, total_recipients)
VALUES ('57520000-0000-0000-0000-000000000004', 'T3C Camp', 'Body', 'system', 'all', '{"type":"all"}'::jsonb, 'queued', 2);

-- Delivery 1 for User 1
INSERT INTO public.notification_deliveries (id, campaign_id, recipient_type, recipient_id, endpoint_id, channel_type, delivery_status, created_at) VALUES
    ('57530000-0000-0000-0000-000000000031', '57520000-0000-0000-0000-000000000004', 'user', '57500000-0000-0000-0000-000000000004', '57510000-0000-0000-0000-000000000004', 'fcm', 'delivered', NOW() - interval '5 minutes');

INSERT INTO public.notification_telemetry (id, delivery_id, campaign_id, recipient_type, recipient_id, event_type, event_nonce) VALUES
    ('57550000-0000-0000-0000-000000000021', '57530000-0000-0000-0000-000000000031', '57520000-0000-0000-0000-000000000004', 'user', '57500000-0000-0000-0000-000000000004', 'displayed', 't3c_u1_n1');

-- Simulate endpoint transfer to User 2 on shared browser before Phase 5.4, then Delivery 2 in same campaign
UPDATE public.notification_endpoints
SET user_id = '57500000-0000-0000-0000-000000000005',
    client_secret_hash = encode(sha256(('p57_t3c_tok:' || '57500000-0000-0000-0000-000000000005')::bytea), 'hex')
WHERE id = '57510000-0000-0000-0000-000000000004';

INSERT INTO public.notification_deliveries (id, campaign_id, recipient_type, recipient_id, endpoint_id, channel_type, delivery_status, created_at) VALUES
    ('57530000-0000-0000-0000-000000000032', '57520000-0000-0000-0000-000000000004', 'user', '57500000-0000-0000-0000-000000000005', '57510000-0000-0000-0000-000000000004', 'fcm', 'sent', NOW() - interval '1 minute');

INSERT INTO public.notification_telemetry (id, delivery_id, campaign_id, recipient_type, recipient_id, event_type, event_nonce) VALUES
    ('57550000-0000-0000-0000-000000000022', '57530000-0000-0000-0000-000000000032', '57520000-0000-0000-0000-000000000004', 'user', '57500000-0000-0000-0000-000000000005', 'opened', 't3c_u2_n1');
COMMIT;

