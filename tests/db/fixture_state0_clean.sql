-- ============================================================================
-- STATE 0: Clean Database Snapshot (Independent)
-- File: tests/db/fixture_state0_clean.sql
-- ============================================================================

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;

-- Setup mock auth schema if not present
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

-- Mock Supabase jwt() and uid() helpers if not present
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
    SELECT '00000000-0000-0000-0000-000000000001'::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb AS $$
    SELECT '{"role": "authenticated", "email": "test@movieverify.com"}'::jsonb;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
    SELECT coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        'authenticated'
    );
$$ LANGUAGE sql STABLE;

-- Create roles if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
    END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA public;

