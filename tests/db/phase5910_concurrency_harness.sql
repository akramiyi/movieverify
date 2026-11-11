\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, email)
VALUES ('595a0000-0000-0000-0000-000000000001', 'conc5910@movieverify.com')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.p5910_conc_audit (
    suite text NOT NULL,
    session_name text NOT NULL,
    xact_id bigint NOT NULL,
    backend_pid integer NOT NULL,
    tx_start timestamptz NOT NULL,
    tx_end timestamptz NOT NULL,
    sqlstate text NOT NULL DEFAULT '00000',
    deadlock_detected boolean NOT NULL DEFAULT false,
    metrics jsonb NOT NULL DEFAULT '{}'::jsonb
);
TRUNCATE public.p5910_conc_audit;

-- Neutralize any prior test suite expired leased deliveries so A1 sweep counts are exact
UPDATE public.notification_deliveries
SET delivery_status = 'cancelled',
    lease_token = NULL,
    lease_expires_at = NULL,
    worker_id = NULL,
    dispatch_attempt_id = NULL,
    updated_at = NOW()
WHERE delivery_status = 'leased'
  AND lease_expires_at <= NOW();

-- 6 distinct active endpoints (e1..e4 for Test A1, e5..e6 for Test A2)
INSERT INTO public.notification_endpoints (
    id, user_id, device_type, channel_type, token, endpoint_hash, client_secret_hash, is_active
)
VALUES
    ('595a1000-0000-0000-0000-000000000001', '595a0000-0000-0000-0000-000000000001',
     'web', 'fcm', 'tok-5910-a1-e1-00000000000001', repeat('e1', 32), repeat('f1', 32), true),
    ('595a1000-0000-0000-0000-000000000002', '595a0000-0000-0000-0000-000000000001',
     'web', 'fcm', 'tok-5910-a1-e2-00000000000002', repeat('e2', 32), repeat('f2', 32), true),
    ('595a1000-0000-0000-0000-000000000003', '595a0000-0000-0000-0000-000000000001',
     'web', 'fcm', 'tok-5910-a1-e3-00000000000003', repeat('e3', 32), repeat('f3', 32), true),
    ('595a1000-0000-0000-0000-000000000004', '595a0000-0000-0000-0000-000000000001',
     'web', 'fcm', 'tok-5910-a1-e4-00000000000004', repeat('e4', 32), repeat('f4', 32), true),
    ('595a1000-0000-0000-0000-000000000005', '595a0000-0000-0000-0000-000000000001',
     'web', 'fcm', 'tok-5910-a2-e5-00000000000005', repeat('e5', 32), repeat('f5', 32), true),
    ('595a1000-0000-0000-0000-000000000006', '595a0000-0000-0000-0000-000000000001',
     'web', 'fcm', 'tok-5910-a2-e6-00000000000006', repeat('e6', 32), repeat('f6', 32), true);

-- Two independent campaigns for A1 (campA, campB) + one campaign for A2 (campC)
INSERT INTO public.notification_campaigns (id, title, body, category, status, created_by)
VALUES
    ('595a2000-0000-0000-0000-000000000001', '5910 A1 CampA (Cancel Target)', 'Body A', 'system', 'processing', '595a0000-0000-0000-0000-000000000001'),
    ('595a2000-0000-0000-0000-000000000002', '5910 A1 CampB (Sweep Target)', 'Body B', 'system', 'processing', '595a0000-0000-0000-0000-000000000001'),
    ('595a2000-0000-0000-0000-000000000003', '5910 A2 CampC (Reverse Lock Target)', 'Body C', 'system', 'processing', '595a0000-0000-0000-0000-000000000001');

-- A1 deliveries with deterministic UUID order d1 < d2 < d3 < d4:
--   d1, d3 -> campA
--   d2, d4 -> campB
-- A2 deliveries d5, d6 -> campC (non-expired lease until A2, so A1 sweep counts only d1..d4)
INSERT INTO public.notification_deliveries (
    id, campaign_id, recipient_type, recipient_id, endpoint_id, channel_type,
    delivery_status, lease_token, lease_expires_at, worker_id, retry_count, max_retries
)
VALUES
    ('595a3000-0000-0000-0000-000000000001', '595a2000-0000-0000-0000-000000000001', 'user', '595a0000-0000-0000-0000-000000000001', '595a1000-0000-0000-0000-000000000001', 'fcm',
     'leased', '595a4000-0000-0000-0000-000000000001'::uuid, NOW() - interval '30 seconds', 'w-5910-a1', 0, 3),
    ('595a3000-0000-0000-0000-000000000002', '595a2000-0000-0000-0000-000000000002', 'user', '595a0000-0000-0000-0000-000000000001', '595a1000-0000-0000-0000-000000000002', 'fcm',
     'leased', '595a4000-0000-0000-0000-000000000002'::uuid, NOW() - interval '30 seconds', 'w-5910-a1', 0, 3),
    ('595a3000-0000-0000-0000-000000000003', '595a2000-0000-0000-0000-000000000001', 'user', '595a0000-0000-0000-0000-000000000001', '595a1000-0000-0000-0000-000000000003', 'fcm',
     'leased', '595a4000-0000-0000-0000-000000000003'::uuid, NOW() - interval '30 seconds', 'w-5910-a1', 0, 3),
    ('595a3000-0000-0000-0000-000000000004', '595a2000-0000-0000-0000-000000000002', 'user', '595a0000-0000-0000-0000-000000000001', '595a1000-0000-0000-0000-000000000004', 'fcm',
     'leased', '595a4000-0000-0000-0000-000000000004'::uuid, NOW() - interval '30 seconds', 'w-5910-a1', 0, 3),
    ('595a3000-0000-0000-0000-000000000005', '595a2000-0000-0000-0000-000000000003', 'user', '595a0000-0000-0000-0000-000000000001', '595a1000-0000-0000-0000-000000000005', 'fcm',
     'leased', '595a4000-0000-0000-0000-000000000005'::uuid, NOW() + interval '10 minutes', 'w-5910-a2', 0, 3),
    ('595a3000-0000-0000-0000-000000000006', '595a2000-0000-0000-0000-000000000003', 'user', '595a0000-0000-0000-0000-000000000001', '595a1000-0000-0000-0000-000000000006', 'fcm',
     'leased', '595a4000-0000-0000-0000-000000000006'::uuid, NOW() + interval '10 minutes', 'w-5910-a2', 0, 3);

COMMIT;

