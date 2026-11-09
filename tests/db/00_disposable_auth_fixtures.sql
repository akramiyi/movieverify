-- ============================================================================
-- DISPOSABLE POSTGRESQL TEST FIXTURE ONLY
-- File: tests/db/00_disposable_auth_fixtures.sql
-- TARGET: Isolated local Docker test container runner ONLY
-- NEVER execute against production Supabase or remote environments
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- 1. Create Mock Supabase Roles for Local Testing
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

-- 2. Create Mock Supabase Auth Schema & Users Table
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text,
    raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
    raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT NOW()
);

-- 3. Create Mock Supabase Auth Helper Functions
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
    SELECT coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'),
        '00000000-0000-0000-0000-000000000001'
    )::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb AS $$
    SELECT coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb,
        '{"role": "authenticated", "email": "test@movieverify.com"}'::jsonb
    );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
    SELECT coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
        'authenticated'
    );
$$ LANGUAGE sql STABLE;

-- 4. Create Mock Table public.admin_users and core application tables for Local Tests
CREATE TABLE IF NOT EXISTS public.admin_users (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT NOW()
);

-- Seed default admin user (matches default auth.uid() = 00000000-0000-0000-0000-000000000001)
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-000000000001', 'admin@movieverify.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.admin_users (user_id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.download_links (id serial PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.movie_reports (id serial PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.movie_reviews (id serial PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.site_settings (id serial PRIMARY KEY);

-- 5. Mock Legacy Quarantine Tables (historical tables matching pre-Phase 2 schema)
CREATE TABLE IF NOT EXISTS public.legacy_token_quarantine (
    quarantine_id serial PRIMARY KEY,
    token_id text,
    user_id text,
    raw_token text,
    reason text NOT NULL,
    quarantined_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.legacy_subscription_quarantine (
    quarantine_id serial PRIMARY KEY,
    table_source text NOT NULL,
    record_id text,
    user_id text,
    target_id text,
    reason text NOT NULL,
    quarantined_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.legacy_delivery_quarantine (
    quarantine_id serial PRIMARY KEY,
    delivery_id text,
    campaign_id text,
    recipient_id text,
    token_id text,
    reason text NOT NULL,
    quarantined_at timestamptz NOT NULL DEFAULT NOW()
);

COMMIT;

