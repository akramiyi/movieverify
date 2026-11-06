-- ============================================================================
-- STATE 2: Historical Tokens + Subscriptions Database Snapshot (Independent)
-- File: tests/db/fixture_state2_subscriptions_only.sql
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
('00000000-0000-0000-0000-000000000001', 'user1@movieverify.com')
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
('tok-1', '00000000-0000-0000-0000-000000000001', 'token_alpha', 'ACTIVE', NOW());

-- Legacy subscriptions: equal timestamp collision, NULL actor_id
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
('movie_100', '00000000-0000-0000-0000-000000000001', '2026-11-01 10:00:00+00'); -- Exact timestamp tie

INSERT INTO public.actor_notify_requests (actor_id, user_id, created_at) VALUES
(NULL, '00000000-0000-0000-0000-000000000001', NOW()), -- Corrupt NULL actor_id to quarantine
('actor_200', '00000000-0000-0000-0000-000000000001', NOW());

INSERT INTO public.genre_notify_requests (genre_id, user_id, created_at) VALUES
('genre_action', '00000000-0000-0000-0000-000000000001', NOW());

