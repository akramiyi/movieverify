-- ============================================================================
-- STATE 4: Historical Full Schema with Legacy Deliveries (Independent)
-- File: tests/db/fixture_state4_legacy_deliveries.sql
-- ============================================================================

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text,
    created_at timestamptz DEFAULT NOW()
);

INSERT INTO auth.users (id, email) VALUES 
('00000000-0000-0000-0000-000000000001', 'user1@movieverify.com'),
('00000000-0000-0000-0000-000000000002', 'user2@movieverify.com')
ON CONFLICT (id) DO NOTHING;

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA public;

-- Legacy tokens
CREATE TABLE public.notification_tokens (
    id text PRIMARY KEY,
    user_id uuid,
    token text NOT NULL,
    status text,
    created_at timestamptz
);

INSERT INTO public.notification_tokens (id, user_id, token, status, created_at) VALUES
('tok-1', '00000000-0000-0000-0000-000000000001', 'token_alpha', 'ACTIVE', NOW() - INTERVAL '2 days'),
('tok-2', '00000000-0000-0000-0000-000000000001', 'token_alpha', 'ACTIVE', NOW() - INTERVAL '1 day'),
('tok-3', '00000000-0000-0000-0000-000000000002', 'token_beta', NULL, NULL);

-- Legacy subscriptions
CREATE TABLE public.movie_notify_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    movie_id text NOT NULL,
    user_id uuid,
    created_at timestamptz
);

CREATE TABLE public.actor_notify_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id text,
    user_id uuid,
    created_at timestamptz
);

CREATE TABLE public.genre_notify_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    genre_id text,
    user_id uuid,
    created_at timestamptz
);

INSERT INTO public.movie_notify_requests (movie_id, user_id, created_at) VALUES
('movie_100', '00000000-0000-0000-0000-000000000001', '2026-11-01 10:00:00+00'),
('movie_100', '00000000-0000-0000-0000-000000000001', '2026-11-01 10:00:00+00');

INSERT INTO public.actor_notify_requests (actor_id, user_id, created_at) VALUES
(NULL, '00000000-0000-0000-0000-000000000001', NOW()),
('actor_200', '00000000-0000-0000-0000-000000000001', NOW());

INSERT INTO public.genre_notify_requests (genre_id, user_id, created_at) VALUES
('genre_action', '00000000-0000-0000-0000-000000000001', NOW());

-- Legacy campaigns & queue
CREATE TABLE public.notification_campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    body text NOT NULL,
    category text NOT NULL,
    status text
);

CREATE TABLE public.notification_queue (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid,
    payload jsonb NOT NULL,
    status text,
    lease_expires_at timestamptz
);

INSERT INTO public.notification_campaigns (title, body, category, status) VALUES
('Summer Blockbusters', 'Watch now', 'movie_release', NULL),
('Action Hits', 'Explosive action', 'movie_release', 'PROCESSING');

INSERT INTO public.notification_queue (payload, status, lease_expires_at) VALUES
('{"title":"test"}'::jsonb, NULL, NULL),
('{"title":"test2"}'::jsonb, 'processing', NULL);

-- Legacy deliveries: NULL snapshots, NULL statuses
CREATE TABLE public.notification_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid,
    recipient_id uuid,
    token_id text,
    token_snapshot_hash text,
    delivery_status text,
    created_at timestamptz
);

INSERT INTO public.notification_deliveries (recipient_id, token_snapshot_hash, delivery_status, created_at) VALUES
('00000000-0000-0000-0000-000000000001', NULL, 'pending', NOW()),
('00000000-0000-0000-0000-000000000001', 'unknown_snapshot', 'reserved', NOW()),
('00000000-0000-0000-0000-000000000002', 'legacy_hash_abc', NULL, NOW());

