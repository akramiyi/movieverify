-- ============================================================================
-- STATE 1: Historical Tokens-Only Database Snapshot (Independent)
-- File: tests/db/fixture_state1_tokens_only.sql
-- ============================================================================

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT NOW()
);

INSERT INTO auth.users (id, email) VALUES 
('00000000-0000-0000-0000-000000000001', 'user1@movieverify.com'),
('00000000-0000-0000-0000-000000000002', 'user2@movieverify.com')
ON CONFLICT (id) DO NOTHING;

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA public;

-- Legacy tokens table: text ID, dirty casing, missing token_hash
CREATE TABLE public.notification_tokens (
    id text PRIMARY KEY,
    user_id uuid,
    token text NOT NULL,
    status text,
    created_at timestamptz
);

INSERT INTO public.notification_tokens (id, user_id, token, status, created_at) VALUES
('tok-1', '00000000-0000-0000-0000-000000000001', 'token_alpha', 'ACTIVE', NOW() - INTERVAL '2 days'),
('tok-2', '00000000-0000-0000-0000-000000000001', 'token_alpha', 'ACTIVE', NOW() - INTERVAL '1 day'), -- Duplicate token
('tok-3', '00000000-0000-0000-0000-000000000002', 'token_beta', NULL, NULL); -- NULL status & timestamp

