-- ============================================================================
-- STATE 3: Historical Campaigns & Queue Database Snapshot (Independent)
-- File: tests/db/fixture_state3_campaigns_queue.sql
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

-- Legacy campaigns & queue: NULL statuses and NULL leases
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
('Summer Blockbusters', 'Watch now', 'movie_release', NULL), -- NULL status
('Action Hits', 'Explosive action', 'movie_release', 'PROCESSING');

INSERT INTO public.notification_queue (payload, status, lease_expires_at) VALUES
('{"title":"test"}'::jsonb, NULL, NULL), -- NULL status
('{"title":"test2"}'::jsonb, 'processing', NULL); -- Processing with NULL lease

