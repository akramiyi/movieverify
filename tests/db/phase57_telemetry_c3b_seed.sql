-- Stage 5 Case 3B: Duplicate deliveries WITH (event_type, event_nonce) collision
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users (id, email) VALUES ('57500000-0000-0000-0000-000000000003', 'p57_t3b@movieverify.test') ON CONFLICT (id) DO NOTHING;

INSERT INTO public.notification_endpoints (
    id, user_id, channel_type, token, endpoint_hash, client_secret_hash, device_type, device_name, is_active, last_seen_at
) VALUES (
    '57510000-0000-0000-0000-000000000003', '57500000-0000-0000-0000-000000000003', 'fcm', 'p57_t3b_tok',
    encode(sha256('p57_t3b_tok'::bytea), 'hex'),
    encode(sha256(('p57_t3b_tok:' || '57500000-0000-0000-0000-000000000003')::bytea), 'hex'),
    'web', 'T3B Device', true, NOW()
);

INSERT INTO public.notification_campaigns (id, title, body, category, target_type, target_criteria, status, total_recipients)
VALUES ('57520000-0000-0000-0000-000000000003', 'T3B Camp', 'Body', 'system', 'all', '{"type":"all"}'::jsonb, 'queued', 1);

INSERT INTO public.notification_deliveries (id, campaign_id, recipient_type, recipient_id, endpoint_id, channel_type, delivery_status, created_at) VALUES
    ('57530000-0000-0000-0000-000000000021', '57520000-0000-0000-0000-000000000003', 'user', '57500000-0000-0000-0000-000000000003', '57510000-0000-0000-0000-000000000003', 'fcm', 'delivered', NOW() - interval '3 minutes'),
    ('57530000-0000-0000-0000-000000000022', '57520000-0000-0000-0000-000000000003', 'user', '57500000-0000-0000-0000-000000000003', '57510000-0000-0000-0000-000000000003', 'fcm', 'sent',      NOW() - interval '1 minute');

-- Identical (event_type, event_nonce) across keep & drop deliveries -> would lose data if cascade-deleted
INSERT INTO public.notification_telemetry (id, delivery_id, campaign_id, recipient_type, recipient_id, event_type, event_nonce) VALUES
    ('57550000-0000-0000-0000-000000000011', '57530000-0000-0000-0000-000000000021', '57520000-0000-0000-0000-000000000003', 'user', '57500000-0000-0000-0000-000000000003', 'opened', 'colliding_nonce_x'),
    ('57550000-0000-0000-0000-000000000012', '57530000-0000-0000-0000-000000000022', '57520000-0000-0000-0000-000000000003', 'user', '57500000-0000-0000-0000-000000000003', 'opened', 'colliding_nonce_x');
COMMIT;

