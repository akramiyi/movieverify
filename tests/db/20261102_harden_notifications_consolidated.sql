-- ============================================================================
-- MOVIEVERIFY NOTIFICATION ARCHITECTURE CONSOLIDATED MIGRATION
-- File: tests/db/20261102_harden_notifications_consolidated.sql
-- Baseline: akramiyi/movieverify @ main (1cb7fd17e2631d0e75ea32208caf2eeeaff47943)
-- Scope: 11 Tables, 14 Database Functions, 5 Triggers, Full RLS, Strict Grants
-- ============================================================================

-- \set ON_ERROR_STOP on
-- NOTE FOR SUPABASE SQL EDITOR & CLI USAGE:
-- The '\set' psql meta-command is commented out above because the Supabase Studio SQL Editor
-- communicates directly via PostgreSQL server APIs and rejects backslash client commands.
-- Transactional atomicity is fully guaranteed by the enclosing BEGIN ... COMMIT block.
-- If executing via the psql command-line client, run with: psql -v ON_ERROR_STOP=1 -f <file>

BEGIN;

-- Production environment prerequisites
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA public;

-- Ensure public.admin_users exists for administrative authorization checks
CREATE TABLE IF NOT EXISTS public.admin_users (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- SECTION 1: Quarantine Tables for Dirty Legacy Data
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- SECTION 2: Table 1 - notification_tokens
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    token text NOT NULL,
    token_hash text NOT NULL,
    device_type text NOT NULL DEFAULT 'web',
    device_name text,
    browser text,
    os text,
    is_active boolean NOT NULL DEFAULT true,
    last_seen_at timestamptz NOT NULL DEFAULT NOW(),
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Alter existing columns safely
DO $$
BEGIN
    ALTER TABLE public.notification_tokens ADD COLUMN IF NOT EXISTS user_id uuid;
    ALTER TABLE public.notification_tokens ADD COLUMN IF NOT EXISTS token_hash text;
    ALTER TABLE public.notification_tokens ADD COLUMN IF NOT EXISTS device_type text DEFAULT 'web';
    ALTER TABLE public.notification_tokens ADD COLUMN IF NOT EXISTS device_name text;
    ALTER TABLE public.notification_tokens ADD COLUMN IF NOT EXISTS browser text;
    ALTER TABLE public.notification_tokens ADD COLUMN IF NOT EXISTS os text;
    ALTER TABLE public.notification_tokens ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
    ALTER TABLE public.notification_tokens ADD COLUMN IF NOT EXISTS last_seen_at timestamptz DEFAULT NOW();
    ALTER TABLE public.notification_tokens ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT NOW();
    ALTER TABLE public.notification_tokens ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();
END $$;

-- Quarantine orphaned user_ids and add foreign key safely
DO $$
BEGIN
    INSERT INTO public.legacy_token_quarantine (token_id, user_id, raw_token, reason)
    SELECT t.id::text, t.user_id::text, t.token, 'ORPHAN_USER_ID'
    FROM public.notification_tokens t
    WHERE t.user_id IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.user_id);

    UPDATE public.notification_tokens t
    SET user_id = NULL
    WHERE t.user_id IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.user_id);

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_notification_tokens_user'
    ) THEN
        ALTER TABLE public.notification_tokens
            ADD CONSTRAINT fk_notification_tokens_user
            FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Backfill token_hash using SHA-256
UPDATE public.notification_tokens
SET token_hash = encode(digest(token, 'sha256'), 'hex')
WHERE token_hash IS NULL OR token_hash = '';

-- Deterministic deduplication with tie-breakers
WITH ranked_tokens AS (
    SELECT id, token_hash,
           ROW_NUMBER() OVER (
               PARTITION BY token_hash 
               ORDER BY created_at DESC NULLS LAST, id ASC
           ) AS rnk
    FROM public.notification_tokens
)
INSERT INTO public.legacy_token_quarantine (token_id, raw_token, reason)
SELECT t.id::text, t.token, 'DETERMINISTIC_DEDUPLICATION_PRUNED'
FROM public.notification_tokens t
JOIN ranked_tokens r ON t.id = r.id
WHERE r.rnk > 1;

WITH ranked_tokens AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY token_hash 
               ORDER BY created_at DESC NULLS LAST, id ASC
           ) AS rnk
    FROM public.notification_tokens
)
DELETE FROM public.notification_tokens
WHERE id IN (SELECT id FROM ranked_tokens WHERE rnk > 1);

-- Enforce constraints
ALTER TABLE public.notification_tokens ALTER COLUMN token_hash SET NOT NULL;
ALTER TABLE public.notification_tokens ALTER COLUMN is_active SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_tokens_hash 
ON public.notification_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_notification_tokens_user_active 
ON public.notification_tokens (user_id, is_active);

-- ----------------------------------------------------------------------------
-- SECTION 3: Tables 2, 3, 4 - Subscription Tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.movie_notify_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    movie_id text NOT NULL,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    email text,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.actor_notify_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id text NOT NULL,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    email text,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.genre_notify_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    genre_id text NOT NULL,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    email text,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Ensure all subscription columns exist on legacy tables
DO $$
BEGIN
    ALTER TABLE public.movie_notify_requests ADD COLUMN IF NOT EXISTS email text;
    ALTER TABLE public.movie_notify_requests ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';
    ALTER TABLE public.movie_notify_requests ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT NOW();

    ALTER TABLE public.actor_notify_requests ADD COLUMN IF NOT EXISTS email text;
    ALTER TABLE public.actor_notify_requests ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';
    ALTER TABLE public.actor_notify_requests ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT NOW();

    ALTER TABLE public.genre_notify_requests ADD COLUMN IF NOT EXISTS email text;
    ALTER TABLE public.genre_notify_requests ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';
    ALTER TABLE public.genre_notify_requests ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT NOW();
END $$;

-- Foreign key retrofit & orphan cleanup for subscription tables
DO $$
BEGIN
    -- Movie subscriptions FK
    INSERT INTO public.legacy_subscription_quarantine (table_source, record_id, user_id, reason)
    SELECT 'movie_notify_requests', m.id::text, m.user_id::text, 'ORPHAN_USER_ID'
    FROM public.movie_notify_requests m
    WHERE m.user_id IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.user_id);

    UPDATE public.movie_notify_requests m
    SET user_id = NULL
    WHERE m.user_id IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.user_id);

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_movie_notify_user') THEN
        ALTER TABLE public.movie_notify_requests
            ADD CONSTRAINT fk_movie_notify_user
            FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;

    -- Actor subscriptions FK
    INSERT INTO public.legacy_subscription_quarantine (table_source, record_id, user_id, reason)
    SELECT 'actor_notify_requests', a.id::text, a.user_id::text, 'ORPHAN_USER_ID'
    FROM public.actor_notify_requests a
    WHERE a.user_id IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a.user_id);

    UPDATE public.actor_notify_requests a
    SET user_id = NULL
    WHERE a.user_id IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a.user_id);

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_actor_notify_user') THEN
        ALTER TABLE public.actor_notify_requests
            ADD CONSTRAINT fk_actor_notify_user
            FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;

    -- Genre subscriptions FK
    INSERT INTO public.legacy_subscription_quarantine (table_source, record_id, user_id, reason)
    SELECT 'genre_notify_requests', g.id::text, g.user_id::text, 'ORPHAN_USER_ID'
    FROM public.genre_notify_requests g
    WHERE g.user_id IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = g.user_id);

    UPDATE public.genre_notify_requests g
    SET user_id = NULL
    WHERE g.user_id IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = g.user_id);

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_genre_notify_user') THEN
        ALTER TABLE public.genre_notify_requests
            ADD CONSTRAINT fk_genre_notify_user
            FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Quarantine NULL IDs before NOT NULL enforcement
INSERT INTO public.legacy_subscription_quarantine (table_source, record_id, reason)
SELECT 'actor_notify_requests', id::text, 'NULL_ACTOR_ID'
FROM public.actor_notify_requests WHERE actor_id IS NULL;
DELETE FROM public.actor_notify_requests WHERE actor_id IS NULL;
ALTER TABLE public.actor_notify_requests ALTER COLUMN actor_id SET NOT NULL;

INSERT INTO public.legacy_subscription_quarantine (table_source, record_id, reason)
SELECT 'genre_notify_requests', id::text, 'NULL_GENRE_ID'
FROM public.genre_notify_requests WHERE genre_id IS NULL;
DELETE FROM public.genre_notify_requests WHERE genre_id IS NULL;
ALTER TABLE public.genre_notify_requests ALTER COLUMN genre_id SET NOT NULL;

-- Deterministic deduplication with tie-breakers for subscriptions
WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
        PARTITION BY movie_id, user_id 
        ORDER BY created_at DESC NULLS LAST, id ASC
    ) AS rnk
    FROM public.movie_notify_requests
    WHERE user_id IS NOT NULL
)
DELETE FROM public.movie_notify_requests
WHERE id IN (SELECT id FROM ranked WHERE rnk > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_movie_notify_user 
ON public.movie_notify_requests (movie_id, user_id) 
WHERE user_id IS NOT NULL;

WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
        PARTITION BY actor_id, user_id 
        ORDER BY created_at DESC NULLS LAST, id ASC
    ) AS rnk
    FROM public.actor_notify_requests
    WHERE user_id IS NOT NULL
)
DELETE FROM public.actor_notify_requests
WHERE id IN (SELECT id FROM ranked WHERE rnk > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_actor_notify_user 
ON public.actor_notify_requests (actor_id, user_id) 
WHERE user_id IS NOT NULL;

WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
        PARTITION BY genre_id, user_id 
        ORDER BY created_at DESC NULLS LAST, id ASC
    ) AS rnk
    FROM public.genre_notify_requests
    WHERE user_id IS NOT NULL
)
DELETE FROM public.genre_notify_requests
WHERE id IN (SELECT id FROM ranked WHERE rnk > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_genre_notify_user 
ON public.genre_notify_requests (genre_id, user_id) 
WHERE user_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- SECTION 4: Tables 5, 6 - Campaigns and Queue
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    body text NOT NULL,
    category text NOT NULL,
    url text,
    image_url text,
    target_criteria jsonb DEFAULT '{}'::jsonb,
    status varchar(32) NOT NULL DEFAULT 'draft',
    total_recipients integer NOT NULL DEFAULT 0,
    successful_deliveries integer NOT NULL DEFAULT 0,
    failed_deliveries integer NOT NULL DEFAULT 0,
    scheduled_for timestamptz,
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Ensure all campaign columns exist on legacy tables
DO $$
BEGIN
    ALTER TABLE public.notification_campaigns ADD COLUMN IF NOT EXISTS url text;
    ALTER TABLE public.notification_campaigns ADD COLUMN IF NOT EXISTS image_url text;
    ALTER TABLE public.notification_campaigns ADD COLUMN IF NOT EXISTS target_criteria jsonb DEFAULT '{}'::jsonb;
    ALTER TABLE public.notification_campaigns ADD COLUMN IF NOT EXISTS status varchar(32) DEFAULT 'draft';
    ALTER TABLE public.notification_campaigns ADD COLUMN IF NOT EXISTS total_recipients integer DEFAULT 0;
    ALTER TABLE public.notification_campaigns ADD COLUMN IF NOT EXISTS successful_deliveries integer DEFAULT 0;
    ALTER TABLE public.notification_campaigns ADD COLUMN IF NOT EXISTS failed_deliveries integer DEFAULT 0;
    ALTER TABLE public.notification_campaigns ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
    ALTER TABLE public.notification_campaigns ADD COLUMN IF NOT EXISTS created_by uuid;
    ALTER TABLE public.notification_campaigns ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT NOW();
    ALTER TABLE public.notification_campaigns ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();
END $$;

-- Backfill NULL campaign statuses and set NOT NULL
UPDATE public.notification_campaigns
SET status = 'draft'
WHERE status IS NULL;

UPDATE public.notification_campaigns
SET status = lower(trim(status))
WHERE status IS NOT NULL;

ALTER TABLE public.notification_campaigns ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
    ALTER TABLE public.notification_campaigns DROP CONSTRAINT IF EXISTS chk_campaigns_status;
    ALTER TABLE public.notification_campaigns
        ADD CONSTRAINT chk_campaigns_status
        CHECK (status IN ('draft', 'scheduled', 'processing', 'completed', 'failed', 'cancelled'));
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaigns_idempotency_key 
ON public.notification_campaigns ((target_criteria->>'idempotency_key')) 
WHERE (target_criteria->>'idempotency_key') IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.notification_queue (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid REFERENCES public.notification_campaigns(id) ON DELETE CASCADE,
    payload jsonb NOT NULL,
    status varchar(32) NOT NULL DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    run_at timestamptz NOT NULL DEFAULT NOW(),
    lease_expires_at timestamptz,
    worker_id text,
    failure_reason text,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Ensure all queue columns exist on legacy tables before backfill
DO $$
BEGIN
    ALTER TABLE public.notification_queue ADD COLUMN IF NOT EXISTS campaign_id uuid;
    ALTER TABLE public.notification_queue ADD COLUMN IF NOT EXISTS status varchar(32) DEFAULT 'pending';
    ALTER TABLE public.notification_queue ADD COLUMN IF NOT EXISTS attempts integer DEFAULT 0;
    ALTER TABLE public.notification_queue ADD COLUMN IF NOT EXISTS max_attempts integer DEFAULT 3;
    ALTER TABLE public.notification_queue ADD COLUMN IF NOT EXISTS run_at timestamptz DEFAULT NOW();
    ALTER TABLE public.notification_queue ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
    ALTER TABLE public.notification_queue ADD COLUMN IF NOT EXISTS worker_id text;
    ALTER TABLE public.notification_queue ADD COLUMN IF NOT EXISTS failure_reason text;
    ALTER TABLE public.notification_queue ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT NOW();
    ALTER TABLE public.notification_queue ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();
END $$;

-- Backfill queue NULL statuses and leases, then set NOT NULL
UPDATE public.notification_queue
SET status = 'failed', failure_reason = 'LEGACY_NULL_STATUS'
WHERE status IS NULL;

UPDATE public.notification_queue
SET status = lower(trim(status))
WHERE status IS NOT NULL;

UPDATE public.notification_queue
SET lease_expires_at = NOW()
WHERE status = 'processing' AND lease_expires_at IS NULL;

ALTER TABLE public.notification_queue ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
    ALTER TABLE public.notification_queue DROP CONSTRAINT IF EXISTS chk_queue_status;
    ALTER TABLE public.notification_queue
        ADD CONSTRAINT chk_queue_status
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'));
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 5: Table 7 - notification_deliveries (Enhanced with Provider Fencing)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid REFERENCES public.notification_campaigns(id) ON DELETE CASCADE,
    recipient_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    token_id uuid REFERENCES public.notification_tokens(id) ON DELETE CASCADE,
    token_snapshot_hash text NOT NULL,
    delivery_status varchar(32) NOT NULL DEFAULT 'pending',
    worker_id text,
    reservation_token uuid,
    reservation_expires_at timestamptz,
    current_dispatch_attempt_id uuid,
    dispatch_expires_at timestamptz,
    retry_after timestamptz,
    fcm_message_id text,
    failure_reason text,
    attempt_count integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Ensure columns exist
DO $$
BEGIN
    ALTER TABLE public.notification_deliveries ADD COLUMN IF NOT EXISTS campaign_id uuid;
    ALTER TABLE public.notification_deliveries ADD COLUMN IF NOT EXISTS recipient_id uuid;
    ALTER TABLE public.notification_deliveries ADD COLUMN IF NOT EXISTS token_id uuid;
    ALTER TABLE public.notification_deliveries ADD COLUMN IF NOT EXISTS token_snapshot_hash text;
    ALTER TABLE public.notification_deliveries ADD COLUMN IF NOT EXISTS delivery_status varchar(32) DEFAULT 'pending';
    ALTER TABLE public.notification_deliveries ADD COLUMN IF NOT EXISTS worker_id text;
    ALTER TABLE public.notification_deliveries ADD COLUMN IF NOT EXISTS reservation_token uuid;
    ALTER TABLE public.notification_deliveries ADD COLUMN IF NOT EXISTS reservation_expires_at timestamptz;
    ALTER TABLE public.notification_deliveries ADD COLUMN IF NOT EXISTS current_dispatch_attempt_id uuid;
    ALTER TABLE public.notification_deliveries ADD COLUMN IF NOT EXISTS dispatch_expires_at timestamptz;
    ALTER TABLE public.notification_deliveries ADD COLUMN IF NOT EXISTS retry_after timestamptz;
    ALTER TABLE public.notification_deliveries ADD COLUMN IF NOT EXISTS fcm_message_id text;
    ALTER TABLE public.notification_deliveries ADD COLUMN IF NOT EXISTS failure_reason text;
    ALTER TABLE public.notification_deliveries ADD COLUMN IF NOT EXISTS attempt_count integer DEFAULT 0;
    ALTER TABLE public.notification_deliveries ADD COLUMN IF NOT EXISTS max_attempts integer DEFAULT 3;
    ALTER TABLE public.notification_deliveries ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT NOW();
    ALTER TABLE public.notification_deliveries ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();
END $$;

-- Retrofit Foreign Keys with orphan quarantine
DO $$
BEGIN
    -- Campaign FK
    INSERT INTO public.legacy_delivery_quarantine (delivery_id, campaign_id, reason)
    SELECT d.id::text, d.campaign_id::text, 'ORPHAN_CAMPAIGN_ID'
    FROM public.notification_deliveries d
    WHERE d.campaign_id IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM public.notification_campaigns c WHERE c.id = d.campaign_id);

    UPDATE public.notification_deliveries d
    SET campaign_id = NULL
    WHERE d.campaign_id IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM public.notification_campaigns c WHERE c.id = d.campaign_id);

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_deliveries_campaign') THEN
        ALTER TABLE public.notification_deliveries
            ADD CONSTRAINT fk_deliveries_campaign
            FOREIGN KEY (campaign_id) REFERENCES public.notification_campaigns(id) ON DELETE CASCADE;
    END IF;

    -- Recipient FK
    INSERT INTO public.legacy_delivery_quarantine (delivery_id, recipient_id, reason)
    SELECT d.id::text, d.recipient_id::text, 'ORPHAN_RECIPIENT_ID'
    FROM public.notification_deliveries d
    WHERE d.recipient_id IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = d.recipient_id);

    UPDATE public.notification_deliveries d
    SET recipient_id = NULL
    WHERE d.recipient_id IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = d.recipient_id);

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_deliveries_recipient') THEN
        ALTER TABLE public.notification_deliveries
            ADD CONSTRAINT fk_deliveries_recipient
            FOREIGN KEY (recipient_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;

    -- Token FK
    INSERT INTO public.legacy_delivery_quarantine (delivery_id, token_id, reason)
    SELECT d.id::text, d.token_id::text, 'ORPHAN_TOKEN_ID'
    FROM public.notification_deliveries d
    WHERE d.token_id IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM public.notification_tokens t WHERE t.id::text = d.token_id::text);

    UPDATE public.notification_deliveries d
    SET token_id = NULL
    WHERE d.token_id IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM public.notification_tokens t WHERE t.id::text = d.token_id::text);

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_deliveries_token') THEN
        ALTER TABLE public.notification_deliveries
            ADD CONSTRAINT fk_deliveries_token
            FOREIGN KEY (token_id) REFERENCES public.notification_tokens(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Two-Phase Snapshot Remediation (Backfill First, Then Terminalize)
UPDATE public.notification_deliveries
SET token_snapshot_hash = 'legacy_unknown_snapshot'
WHERE token_snapshot_hash IS NULL;

UPDATE public.notification_deliveries
SET delivery_status = 'failed',
    failure_reason = 'LEGACY_UNKNOWN_TOKEN_SNAPSHOT',
    updated_at = NOW()
WHERE token_snapshot_hash IN ('unknown_snapshot', 'legacy_unknown_snapshot')
  AND delivery_status NOT IN ('sent', 'delivered', 'opened', 'failed', 'cancelled');

-- Backfill NULL delivery_status and set NOT NULL
UPDATE public.notification_deliveries
SET delivery_status = 'failed', failure_reason = 'LEGACY_NULL_DELIVERY_STATUS'
WHERE delivery_status IS NULL;

UPDATE public.notification_deliveries
SET delivery_status = lower(trim(delivery_status))
WHERE delivery_status IS NOT NULL;

ALTER TABLE public.notification_deliveries ALTER COLUMN token_snapshot_hash SET NOT NULL;
ALTER TABLE public.notification_deliveries ALTER COLUMN delivery_status SET NOT NULL;

-- Delivery status check constraint including 'dispatching'
DO $$
BEGIN
    ALTER TABLE public.notification_deliveries DROP CONSTRAINT IF EXISTS chk_deliveries_status;
    ALTER TABLE public.notification_deliveries
        ADD CONSTRAINT chk_deliveries_status
        CHECK (delivery_status IN ('pending', 'reserved', 'dispatching', 'sent', 'delivered', 'opened', 'failed', 'cancelled'));
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 6: Remaining Notification Tables (8 to 11)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_telemetry (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id uuid REFERENCES public.notification_deliveries(id) ON DELETE CASCADE,
    recipient_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    event_type varchar(32) NOT NULL,
    nonce text NOT NULL,
    device_info jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_telemetry_delivery_event 
ON public.notification_telemetry (delivery_id, event_type);

CREATE UNIQUE INDEX IF NOT EXISTS uq_telemetry_nonce 
ON public.notification_telemetry (nonce);

CREATE TABLE IF NOT EXISTS public.user_notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    delivery_id uuid REFERENCES public.notification_deliveries(id) ON DELETE SET NULL,
    title text NOT NULL,
    body text NOT NULL,
    url text,
    image_url text,
    is_read boolean NOT NULL DEFAULT false,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notification_opt_outs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    category text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_opt_out_user_cat UNIQUE (user_id, category)
);

CREATE TABLE IF NOT EXISTS public.notification_audit_log (
    id serial PRIMARY KEY,
    action text NOT NULL,
    details jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- SECTION 7: Security Helpers, Status Validator & Triggers
-- ----------------------------------------------------------------------------

-- Helper: Admin Check (Symmetrical with Node.js isServerSideAdmin)
CREATE OR REPLACE FUNCTION public.notifications_is_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid uuid;
    v_role text;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RETURN false;
    END IF;

    -- 1. Check JWT app_metadata role
    BEGIN
        v_role := (auth.jwt() -> 'app_metadata' ->> 'role');
        IF v_role = 'admin' THEN
            RETURN true;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- 2. Check public.admin_users table membership (Fail-closed on error)
    BEGIN
        RETURN EXISTS (
            SELECT 1 FROM public.admin_users au WHERE au.user_id = v_uid
        );
    EXCEPTION WHEN OTHERS THEN
        RETURN false;
    END;
END;
$$;

-- Trigger: Status Transition State Machine
CREATE OR REPLACE FUNCTION public.trg_validate_delivery_status_transition()
RETURNS trigger AS $$
BEGIN
    IF OLD.delivery_status = NEW.delivery_status THEN
        RETURN NEW;
    END IF;

    -- Valid state transition graph
    IF OLD.delivery_status = 'pending' AND NEW.delivery_status IN ('reserved', 'failed', 'cancelled') THEN
        RETURN NEW;
    ELSIF OLD.delivery_status = 'reserved' AND NEW.delivery_status IN ('dispatching', 'pending', 'failed', 'cancelled') THEN
        RETURN NEW;
    ELSIF OLD.delivery_status = 'dispatching' AND NEW.delivery_status IN ('sent', 'failed', 'cancelled', 'pending') THEN
        RETURN NEW;
    ELSIF OLD.delivery_status = 'sent' AND NEW.delivery_status IN ('delivered', 'opened', 'failed') THEN
        RETURN NEW;
    ELSIF OLD.delivery_status = 'delivered' AND NEW.delivery_status = 'opened' THEN
        RETURN NEW;
    ELSIF OLD.delivery_status IN ('failed', 'cancelled', 'opened') THEN
        RAISE EXCEPTION 'Illegal state transition: % is terminal and cannot transition to %', OLD.delivery_status, NEW.delivery_status;
    ELSE
        RAISE EXCEPTION 'Illegal state transition from % to %', OLD.delivery_status, NEW.delivery_status;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_validate_delivery_status ON public.notification_deliveries;
CREATE TRIGGER trg_validate_delivery_status
BEFORE UPDATE OF delivery_status ON public.notification_deliveries
FOR EACH ROW
EXECUTE FUNCTION public.trg_validate_delivery_status_transition();

-- Trigger: SHA-256 Token Hash Sync
CREATE OR REPLACE FUNCTION public.trg_sync_notification_token_hash()
RETURNS trigger AS $$
BEGIN
    IF NEW.token IS NOT NULL THEN
        NEW.token_hash := encode(digest(NEW.token, 'sha256'), 'hex');
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_sync_token_hash ON public.notification_tokens;
CREATE TRIGGER trg_sync_token_hash
BEFORE INSERT OR UPDATE OF token ON public.notification_tokens
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_notification_token_hash();

-- Trigger: Token Ownership Transfer Cancellation
CREATE OR REPLACE FUNCTION public.trg_sync_notification_token_ownership()
RETURNS trigger AS $$
BEGIN
    IF (OLD.user_id IS DISTINCT FROM NEW.user_id) AND (OLD.user_id IS NOT NULL) THEN
        UPDATE public.notification_deliveries
        SET delivery_status = 'cancelled',
            failure_reason = 'OWNERSHIP_TRANSFERRED',
            current_dispatch_attempt_id = NULL,
            reservation_token = NULL,
            reservation_expires_at = NULL,
            dispatch_expires_at = NULL,
            updated_at = NOW()
        WHERE token_id = OLD.id
          AND delivery_status IN ('pending', 'reserved', 'dispatching');

        INSERT INTO public.notification_audit_log (action, details)
        VALUES (
            'TOKEN_OWNERSHIP_TRANSFER',
            jsonb_build_object(
                'token_id', OLD.id,
                'token_hash', OLD.token_hash,
                'previous_user_id', OLD.user_id,
                'new_user_id', NEW.user_id,
                'timestamp', NOW()
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_token_ownership_change ON public.notification_tokens;
CREATE TRIGGER trg_token_ownership_change
AFTER UPDATE OF user_id ON public.notification_tokens
FOR EACH ROW
WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)
EXECUTE FUNCTION public.trg_sync_notification_token_ownership();

-- Trigger: Protect User Notifications Updates
CREATE OR REPLACE FUNCTION public.trg_protect_user_notifications_update()
RETURNS trigger AS $$
BEGIN
    IF NOT public.notifications_is_admin() THEN
        IF (OLD.user_id IS DISTINCT FROM NEW.user_id) OR
           (OLD.delivery_id IS DISTINCT FROM NEW.delivery_id) OR
           (OLD.title IS DISTINCT FROM NEW.title) OR
           (OLD.body IS DISTINCT FROM NEW.body) OR
           (OLD.url IS DISTINCT FROM NEW.url) OR
           (OLD.created_at IS DISTINCT FROM NEW.created_at) THEN
            RAISE EXCEPTION 'Users can only update is_read and read_at attributes.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_protect_user_notifications ON public.user_notifications;
CREATE TRIGGER trg_protect_user_notifications
BEFORE UPDATE ON public.user_notifications
FOR EACH ROW
EXECUTE FUNCTION public.trg_protect_user_notifications_update();

-- Trigger: Campaign Cancellation Cascading Sync
CREATE OR REPLACE FUNCTION public.trg_sync_campaign_cancellation()
RETURNS trigger AS $$
BEGIN
    IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
        -- Cancel pending and reserved deliveries belonging to this campaign
        UPDATE public.notification_deliveries
        SET delivery_status = 'cancelled',
            failure_reason = 'CAMPAIGN_CANCELLED',
            reservation_token = NULL,
            reservation_expires_at = NULL,
            current_dispatch_attempt_id = NULL,
            dispatch_expires_at = NULL,
            updated_at = NOW()
        WHERE campaign_id = NEW.id
          AND delivery_status IN ('pending', 'reserved');

        -- Cancel any uncompleted queue jobs belonging to this campaign
        UPDATE public.notification_queue
        SET status = 'cancelled',
            failure_reason = 'CAMPAIGN_CANCELLED',
            lease_expires_at = NULL,
            updated_at = NOW()
        WHERE campaign_id = NEW.id
          AND status IN ('pending', 'processing');

        INSERT INTO public.notification_audit_log (action, details)
        VALUES (
            'CAMPAIGN_CANCELLED',
            jsonb_build_object(
                'campaign_id', NEW.id,
                'previous_status', OLD.status,
                'timestamp', NOW()
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_campaign_cancellation_sync ON public.notification_campaigns;
CREATE TRIGGER trg_campaign_cancellation_sync
AFTER UPDATE OF status ON public.notification_campaigns
FOR EACH ROW
WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
EXECUTE FUNCTION public.trg_sync_campaign_cancellation();

-- ----------------------------------------------------------------------------
-- SECTION 8: 14 Canonical Database Functions (Queue, Dispatch, Telemetry, Sweepers)
-- ----------------------------------------------------------------------------

-- 1. Claim Queue Batch
CREATE OR REPLACE FUNCTION public.claim_notification_queue_batch(
    p_worker_id text,
    p_batch_size integer DEFAULT 10,
    p_lease_seconds integer DEFAULT 60
)
RETURNS TABLE (
    job_id uuid,
    campaign_id uuid,
    payload jsonb,
    attempts integer
) AS $$
DECLARE
    v_lease interval;
BEGIN
    v_lease := (GREATEST(p_lease_seconds, 15) || ' seconds')::interval;

    RETURN QUERY
    WITH candidate_jobs AS (
        SELECT q.id
        FROM public.notification_queue q
        WHERE (q.status = 'pending' AND q.run_at <= NOW())
           OR (q.status = 'processing' AND q.lease_expires_at < NOW() AND q.attempts < q.max_attempts)
        ORDER BY q.run_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT GREATEST(p_batch_size, 1)
    )
    UPDATE public.notification_queue q
    SET status = 'processing',
        worker_id = p_worker_id,
        lease_expires_at = NOW() + v_lease,
        attempts = q.attempts + 1,
        updated_at = NOW()
    FROM candidate_jobs c
    WHERE q.id = c.id
    RETURNING q.id, q.campaign_id, q.payload, q.attempts;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 2. Renew Queue Lease
CREATE OR REPLACE FUNCTION public.renew_notification_queue_lease(
    p_job_id uuid,
    p_worker_id text,
    p_extension_seconds integer DEFAULT 60
)
RETURNS boolean AS $$
DECLARE
    v_updated boolean := false;
BEGIN
    UPDATE public.notification_queue
    SET lease_expires_at = NOW() + (GREATEST(p_extension_seconds, 15) || ' seconds')::interval,
        updated_at = NOW()
    WHERE id = p_job_id
      AND worker_id = p_worker_id
      AND status = 'processing'
      AND lease_expires_at >= NOW();
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 3. Fail or Retry Queue Job
CREATE OR REPLACE FUNCTION public.fail_or_retry_notification_job(
    p_job_id uuid,
    p_worker_id text,
    p_error_code text,
    p_error_message text
)
RETURNS text AS $$
DECLARE
    v_job RECORD;
    v_backoff interval;
    v_new_status text;
BEGIN
    SELECT id, attempts, max_attempts INTO v_job
    FROM public.notification_queue
    WHERE id = p_job_id AND worker_id = p_worker_id AND status = 'processing'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN 'JOB_NOT_FOUND_OR_NOT_PROCESSING';
    END IF;

    IF v_job.attempts >= v_job.max_attempts THEN
        v_new_status := 'failed';
        UPDATE public.notification_queue
        SET status = 'failed',
            failure_reason = p_error_code || ': ' || p_error_message,
            lease_expires_at = NULL,
            updated_at = NOW()
        WHERE id = p_job_id;
    ELSE
        v_new_status := 'pending';
        v_backoff := (power(2, v_job.attempts) * 30 || ' seconds')::interval;
        UPDATE public.notification_queue
        SET status = 'pending',
            run_at = NOW() + v_backoff,
            failure_reason = p_error_code || ': ' || p_error_message,
            lease_expires_at = NULL,
            worker_id = NULL,
            updated_at = NOW()
        WHERE id = p_job_id;
    END IF;

    RETURN v_new_status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4. Complete Queue Job
CREATE OR REPLACE FUNCTION public.complete_notification_queue_job(
    p_job_id uuid,
    p_worker_id text
)
RETURNS boolean AS $$
BEGIN
    UPDATE public.notification_queue
    SET status = 'completed',
        lease_expires_at = NULL,
        updated_at = NOW()
    WHERE id = p_job_id
      AND worker_id = p_worker_id
      AND status = 'processing';
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 5. Sweep Expired Queue Jobs
CREATE OR REPLACE FUNCTION public.sweep_expired_notification_queue_jobs()
RETURNS integer AS $$
DECLARE
    v_count integer := 0;
BEGIN
    -- Mark jobs that exceeded max_attempts as failed
    WITH expired_final AS (
        UPDATE public.notification_queue
        SET status = 'failed',
            failure_reason = 'EXPIRED_FINAL_ATTEMPT_LEASE',
            lease_expires_at = NULL,
            updated_at = NOW()
        WHERE status = 'processing'
          AND lease_expires_at < NOW()
          AND attempts >= max_attempts
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM expired_final;

    -- Return recoverable jobs back to pending
    UPDATE public.notification_queue
    SET status = 'pending',
        lease_expires_at = NULL,
        worker_id = NULL,
        updated_at = NOW()
    WHERE status = 'processing'
      AND lease_expires_at < NOW()
      AND attempts < max_attempts;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 6. Reserve Notification Deliveries
CREATE OR REPLACE FUNCTION public.reserve_notification_deliveries(
    p_worker_id text,
    p_batch_size integer DEFAULT 50,
    p_lease_seconds integer DEFAULT 60
)
RETURNS TABLE (
    delivery_id uuid,
    campaign_id uuid,
    recipient_id uuid,
    token_id uuid,
    raw_token text,
    attempt_count integer,
    reservation_token uuid
) AS $$
DECLARE
    v_lease_interval interval;
    v_res_token uuid;
BEGIN
    v_lease_interval := (GREATEST(p_lease_seconds, 15) || ' seconds')::interval;
    v_res_token := gen_random_uuid();

    RETURN QUERY
    WITH candidate_deliveries AS (
        SELECT d.id AS cand_del_id, d.token_id AS cand_tok_id
        FROM public.notification_deliveries d
        JOIN public.notification_tokens t ON d.token_id = t.id
        WHERE (
            d.delivery_status = 'pending'
            OR (
                d.delivery_status = 'reserved'
                AND d.reservation_expires_at < NOW()
                AND d.attempt_count < d.max_attempts
            )
            OR (
                d.delivery_status = 'dispatching'
                AND d.dispatch_expires_at < NOW()
                AND d.attempt_count < d.max_attempts
            )
        )
        AND (d.retry_after IS NULL OR d.retry_after <= NOW())
        AND t.is_active = true
        ORDER BY t.id, d.id
        FOR UPDATE OF t, d SKIP LOCKED
        LIMIT GREATEST(p_batch_size, 1)
    ),
    reserved_batch AS (
        UPDATE public.notification_deliveries d
        SET delivery_status = 'reserved',
            worker_id = p_worker_id,
            reservation_token = v_res_token,
            reservation_expires_at = NOW() + v_lease_interval,
            current_dispatch_attempt_id = NULL,
            dispatch_expires_at = NULL,
            attempt_count = d.attempt_count + 1,
            updated_at = NOW()
        FROM candidate_deliveries c
        WHERE d.id = c.cand_del_id
        RETURNING d.id, d.campaign_id, d.recipient_id, d.token_id, d.attempt_count, d.reservation_token
    )
    SELECT 
        rb.id,
        rb.campaign_id,
        rb.recipient_id,
        rb.token_id,
        t.token AS raw_token,
        rb.attempt_count,
        rb.reservation_token
    FROM reserved_batch rb
    JOIN public.notification_tokens t ON rb.token_id = t.id
    WHERE t.user_id = rb.recipient_id
      AND t.is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 7. Authorize Notification Delivery Dispatch (Provider Boundary Fence)
CREATE OR REPLACE FUNCTION public.authorize_notification_delivery_dispatch(
    p_delivery_id uuid,
    p_token_id uuid,
    p_reservation_token uuid,
    p_worker_id text,
    p_recipient_id uuid
)
RETURNS jsonb AS $$
DECLARE
    v_tok RECORD;
    v_del RECORD;
    v_attempt_id uuid;
    v_dispatch_lease timestamptz;
BEGIN
    -- 1. Deterministic Lock: Token first
    SELECT id, user_id, is_active, token_hash 
    INTO v_tok
    FROM public.notification_tokens
    WHERE id = p_token_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'DISPATCH_REJECTED_TOKEN_NOT_FOUND');
    END IF;

    -- 2. Deterministic Lock: Delivery second
    SELECT id, token_id, recipient_id, delivery_status, worker_id, 
           reservation_token, reservation_expires_at, token_snapshot_hash,
           attempt_count, max_attempts
    INTO v_del
    FROM public.notification_deliveries
    WHERE id = p_delivery_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'DISPATCH_REJECTED_DELIVERY_NOT_FOUND');
    END IF;

    -- 3. Strict Parameter & Relationship Binding
    IF v_del.token_id IS DISTINCT FROM p_token_id THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'DISPATCH_REJECTED_TOKEN_MISMATCH');
    END IF;

    -- 4. Status Check: Must be in 'reserved' status
    IF v_del.delivery_status = 'dispatching' THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'DISPATCH_REJECTED_ALREADY_DISPATCHING');
    ELSIF v_del.delivery_status != 'reserved' THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'DISPATCH_REJECTED_INVALID_STATUS');
    END IF;

    -- 5. Lease Check
    IF v_del.reservation_expires_at <= NOW() THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'DISPATCH_REJECTED_LEASE_EXPIRED');
    END IF;

    -- 6. Worker Credentials Verification
    IF v_del.worker_id IS DISTINCT FROM p_worker_id OR v_del.reservation_token IS DISTINCT FROM p_reservation_token THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'DISPATCH_REJECTED_CREDENTIALS_MISMATCH');
    END IF;

    -- 7. Recipient Binding Check
    IF v_del.recipient_id IS DISTINCT FROM p_recipient_id THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'DISPATCH_REJECTED_RECIPIENT_MISMATCH');
    END IF;

    -- 8. Live Token Ownership & Snapshot Integrity Check
    IF v_tok.user_id IS DISTINCT FROM p_recipient_id THEN
        UPDATE public.notification_deliveries
        SET delivery_status = 'cancelled',
            failure_reason = 'OWNERSHIP_TRANSFERRED',
            current_dispatch_attempt_id = NULL,
            reservation_token = NULL,
            updated_at = NOW()
        WHERE id = p_delivery_id;

        RETURN jsonb_build_object('authorized', false, 'reason', 'DISPATCH_REJECTED_OWNERSHIP_MISMATCH');
    END IF;

    IF NOT v_tok.is_active THEN
        UPDATE public.notification_deliveries
        SET delivery_status = 'failed',
            failure_reason = 'TOKEN_INACTIVE',
            current_dispatch_attempt_id = NULL,
            reservation_token = NULL,
            updated_at = NOW()
        WHERE id = p_delivery_id;

        RETURN jsonb_build_object('authorized', false, 'reason', 'DISPATCH_REJECTED_TOKEN_INACTIVE');
    END IF;

    IF v_del.token_snapshot_hash IS DISTINCT FROM v_tok.token_hash THEN
        UPDATE public.notification_deliveries
        SET delivery_status = 'failed',
            failure_reason = 'TOKEN_SNAPSHOT_MISMATCH',
            current_dispatch_attempt_id = NULL,
            reservation_token = NULL,
            updated_at = NOW()
        WHERE id = p_delivery_id;

        RETURN jsonb_build_object('authorized', false, 'reason', 'DISPATCH_REJECTED_SNAPSHOT_MISMATCH');
    END IF;

    -- 9. Atomic One-Time Transition to 'dispatching' with 15s Provider Lease
    v_attempt_id := gen_random_uuid();
    v_dispatch_lease := NOW() + INTERVAL '15 seconds';

    UPDATE public.notification_deliveries
    SET delivery_status = 'dispatching',
        current_dispatch_attempt_id = v_attempt_id,
        dispatch_expires_at = v_dispatch_lease,
        updated_at = NOW()
    WHERE id = p_delivery_id;

    RETURN jsonb_build_object(
        'authorized', true,
        'status', 'DISPATCH_AUTHORIZED',
        'dispatch_attempt_id', v_attempt_id,
        'dispatch_expires_at', v_dispatch_lease
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 8. Renew Notification Delivery Leases
CREATE OR REPLACE FUNCTION public.renew_notification_delivery_leases(
    p_worker_id text,
    p_reservation_tokens uuid[],
    p_extension_seconds integer DEFAULT 60
)
RETURNS integer AS $$
DECLARE
    v_count integer;
BEGIN
    UPDATE public.notification_deliveries
    SET reservation_expires_at = NOW() + (GREATEST(p_extension_seconds, 15) || ' seconds')::interval,
        updated_at = NOW()
    WHERE worker_id = p_worker_id
      AND reservation_token = ANY(p_reservation_tokens)
      AND delivery_status = 'reserved'
      AND reservation_expires_at >= NOW();
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 9. Confirm Notification Delivery Sent
CREATE OR REPLACE FUNCTION public.confirm_notification_delivery_sent(
    p_delivery_id uuid,
    p_dispatch_attempt_id uuid,
    p_fcm_message_id text
)
RETURNS jsonb AS $$
DECLARE
    v_del RECORD;
BEGIN
    SELECT id, delivery_status, current_dispatch_attempt_id, campaign_id
    INTO v_del
    FROM public.notification_deliveries
    WHERE id = p_delivery_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'reason', 'DELIVERY_NOT_FOUND');
    END IF;

    -- Must be actively in 'dispatching' with matching attempt ID
    IF v_del.delivery_status != 'dispatching' OR v_del.current_dispatch_attempt_id IS DISTINCT FROM p_dispatch_attempt_id THEN
        RETURN jsonb_build_object('success', false, 'reason', 'CONFIRMATION_REJECTED_ALREADY_TERMINAL_OR_TRANSFER');
    END IF;

    UPDATE public.notification_deliveries
    SET delivery_status = 'sent',
        fcm_message_id = p_fcm_message_id,
        current_dispatch_attempt_id = NULL,
        reservation_token = NULL,
        reservation_expires_at = NULL,
        dispatch_expires_at = NULL,
        updated_at = NOW()
    WHERE id = p_delivery_id;

    IF v_del.campaign_id IS NOT NULL THEN
        UPDATE public.notification_campaigns
        SET successful_deliveries = successful_deliveries + 1,
            updated_at = NOW()
        WHERE id = v_del.campaign_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'SENT');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 10. Fail or Retry Notification Delivery
CREATE OR REPLACE FUNCTION public.fail_or_retry_notification_delivery(
    p_delivery_id uuid,
    p_worker_id text,
    p_reservation_token uuid,
    p_error_code text,
    p_error_message text,
    p_retry_after_seconds integer DEFAULT NULL
)
RETURNS text AS $$
DECLARE
    v_del RECORD;
    v_backoff interval;
    v_new_status text;
    v_permanent boolean := false;
BEGIN
    SELECT id, attempt_count, max_attempts, campaign_id, token_id INTO v_del
    FROM public.notification_deliveries
    WHERE id = p_delivery_id 
      AND worker_id = p_worker_id 
      AND (reservation_token = p_reservation_token OR current_dispatch_attempt_id IS NOT NULL)
      AND delivery_status IN ('reserved', 'dispatching')
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN 'DELIVERY_NOT_FOUND_OR_NOT_ACTIVE';
    END IF;

    -- Determine permanent failure
    IF p_error_code IN ('UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH') THEN
        v_permanent := true;
        IF p_error_code = 'UNREGISTERED' AND v_del.token_id IS NOT NULL THEN
            UPDATE public.notification_tokens SET is_active = false, updated_at = NOW() WHERE id = v_del.token_id;
        END IF;
    END IF;

    IF v_permanent OR v_del.attempt_count >= v_del.max_attempts THEN
        v_new_status := 'failed';
        UPDATE public.notification_deliveries
        SET delivery_status = 'failed',
            failure_reason = p_error_code || ': ' || p_error_message,
            reservation_token = NULL,
            reservation_expires_at = NULL,
            current_dispatch_attempt_id = NULL,
            dispatch_expires_at = NULL,
            updated_at = NOW()
        WHERE id = p_delivery_id;

        IF v_del.campaign_id IS NOT NULL THEN
            UPDATE public.notification_campaigns
            SET failed_deliveries = failed_deliveries + 1,
                updated_at = NOW()
            WHERE id = v_del.campaign_id;
        END IF;
    ELSE
        v_new_status := 'pending';
        IF p_retry_after_seconds IS NOT NULL AND p_retry_after_seconds > 0 THEN
            v_backoff := (p_retry_after_seconds || ' seconds')::interval;
        ELSE
            v_backoff := (power(2, v_del.attempt_count) * 15 || ' seconds')::interval;
        END IF;

        UPDATE public.notification_deliveries
        SET delivery_status = 'pending',
            retry_after = NOW() + v_backoff,
            failure_reason = p_error_code || ': ' || p_error_message,
            worker_id = NULL,
            reservation_token = NULL,
            reservation_expires_at = NULL,
            current_dispatch_attempt_id = NULL,
            dispatch_expires_at = NULL,
            updated_at = NOW()
        WHERE id = p_delivery_id;
    END IF;

    RETURN v_new_status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 11. Record Notification Telemetry
CREATE OR REPLACE FUNCTION public.record_notification_telemetry(
    p_delivery_id uuid,
    p_recipient_id uuid,
    p_event_type text,
    p_nonce text,
    p_device_info jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean AS $$
DECLARE
    v_del RECORD;
    v_caller_role text;
BEGIN
    -- Validate parameters
    IF p_event_type IS NULL OR p_event_type NOT IN ('delivered', 'opened') THEN
        RAISE EXCEPTION 'Invalid telemetry event type';
    END IF;

    IF p_nonce IS NULL 
       OR length(regexp_replace(p_nonce, '\s+', '', 'g')) = 0 
       OR length(p_nonce) > 128 THEN
        RAISE EXCEPTION 'Invalid telemetry nonce: must be non-empty, non-whitespace, and at most 128 characters';
    END IF;

    -- Input-size validation on device_info payload: explicit 4096-byte limit
    IF p_device_info IS NOT NULL AND octet_length(p_device_info::text) > 4096 THEN
        RAISE EXCEPTION 'Invalid telemetry device_info: payload exceeds 4096 bytes';
    END IF;

    -- Resolve caller role securely from Supabase JWT auth context.
    -- Inside a SECURITY DEFINER function owned by postgres, current_user evaluates to 'postgres'
    -- (the function owner) and NOT the invoking client! Relying on current_user would allow any
    -- client calling this function to bypass identity checks as postgres.
    -- We inspect auth.role() or current_setting('request.jwt.claim.role', true).
    v_caller_role := coalesce(
        nullif(auth.role(), ''),
        nullif(current_setting('request.jwt.claim.role', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    );

    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'Authentication required: caller role is missing or unverified';
    END IF;

    -- 1. Trusted backend service role execution
    IF v_caller_role = 'service_role' THEN
        -- Trusted service execution: allowed
        NULL;
    -- 2. Authenticated client caller: auth.uid() must be non-NULL and match p_recipient_id
    ELSIF v_caller_role = 'authenticated' THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Authentication required: auth.uid() is NULL';
        END IF;
        IF auth.uid() IS DISTINCT FROM p_recipient_id THEN
            RAISE EXCEPTION 'Caller auth.uid() % does not match telemetry recipient_id %', auth.uid(), p_recipient_id;
        END IF;
    -- 3. Explicitly reject anon, public, postgres (when spoofed via JWT), and any unexpected roles
    ELSE
        RAISE EXCEPTION 'Unauthorized caller role: %', v_caller_role;
    END IF;

    -- Verify delivery exists and belongs to p_recipient_id
    SELECT id, recipient_id, delivery_status INTO v_del
    FROM public.notification_deliveries
    WHERE id = p_delivery_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery % not found', p_delivery_id;
    END IF;

    IF v_del.recipient_id IS DISTINCT FROM p_recipient_id THEN
        RAISE EXCEPTION 'Recipient mismatch for delivery %', p_delivery_id;
    END IF;

    -- Insert telemetry record (unique constraints uq_telemetry_nonce and uq_telemetry_delivery_event enforce deduplication)
    INSERT INTO public.notification_telemetry (
        delivery_id, recipient_id, event_type, nonce, device_info
    ) VALUES (
        p_delivery_id, p_recipient_id, p_event_type, p_nonce, COALESCE(p_device_info, '{}'::jsonb)
    );

    IF p_event_type = 'delivered' AND v_del.delivery_status = 'sent' THEN
        UPDATE public.notification_deliveries SET delivery_status = 'delivered', updated_at = NOW() WHERE id = p_delivery_id;
    ELSIF p_event_type = 'opened' AND v_del.delivery_status IN ('sent', 'delivered') THEN
        UPDATE public.notification_deliveries SET delivery_status = 'opened', updated_at = NOW() WHERE id = p_delivery_id;
    END IF;

    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 12. Sweep Expired Delivery Reservations
CREATE OR REPLACE FUNCTION public.sweep_expired_delivery_reservations()
RETURNS integer AS $$
DECLARE
    v_count integer := 0;
BEGIN
    WITH expired_final AS (
        UPDATE public.notification_deliveries
        SET delivery_status = 'failed',
            failure_reason = 'EXPIRED_FINAL_ATTEMPT_RESERVATION',
            reservation_token = NULL,
            reservation_expires_at = NULL,
            current_dispatch_attempt_id = NULL,
            dispatch_expires_at = NULL,
            updated_at = NOW()
        WHERE (
            (delivery_status = 'reserved' AND reservation_expires_at < NOW()) OR
            (delivery_status = 'dispatching' AND dispatch_expires_at < NOW())
        )
        AND attempt_count >= max_attempts
        RETURNING id
    )
    SELECT COUNT(*) INTO v_count FROM expired_final;

    UPDATE public.notification_deliveries
    SET delivery_status = 'pending',
        worker_id = NULL,
        reservation_token = NULL,
        reservation_expires_at = NULL,
        current_dispatch_attempt_id = NULL,
        dispatch_expires_at = NULL,
        updated_at = NOW()
    WHERE (
        (delivery_status = 'reserved' AND reservation_expires_at < NOW()) OR
        (delivery_status = 'dispatching' AND dispatch_expires_at < NOW())
    )
    AND attempt_count < max_attempts;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 13. Sweep Stale Notification Deliveries
CREATE OR REPLACE FUNCTION public.sweep_stale_notification_deliveries(
    p_stale_hours integer DEFAULT 168
)
RETURNS integer AS $$
DECLARE
    v_count integer;
BEGIN
    DELETE FROM public.notification_deliveries
    WHERE delivery_status IN ('failed', 'cancelled', 'opened')
      AND updated_at < NOW() - (GREATEST(p_stale_hours, 24) || ' hours')::interval;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 14. Admin helper function (defined above in Section 7)

-- 15. Ingest Notification Campaign (Atomic Campaign & Delivery Ingestion)
CREATE OR REPLACE FUNCTION public.ingest_notification_campaign(
    p_title text,
    p_body text,
    p_category text,
    p_url text DEFAULT NULL,
    p_image_url text DEFAULT NULL,
    p_target_criteria jsonb DEFAULT '{}'::jsonb,
    p_scheduled_for timestamptz DEFAULT NULL,
    p_created_by uuid DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
    v_clean_title text;
    v_clean_body text;
    v_clean_category text;
    v_idempotency_key text;
    v_target_type text;
    v_campaign_status varchar(32);
    v_retry_after timestamptz;
    v_campaign_id uuid;
    v_existing_camp RECORD;
    v_existing_delivery_count integer;
    v_recipient_count integer := 0;
    v_delivery_count integer := 0;
    v_movie_id text;
    v_actor_id text;
    v_genre_id text;
    v_user_ids jsonb;
    v_is_draft boolean := false;
BEGIN
    -- 1. Input Sanitization & Validation
    v_clean_title := trim(p_title);
    IF v_clean_title IS NULL OR length(v_clean_title) = 0 OR length(v_clean_title) > 150 THEN
        RAISE EXCEPTION 'INVALID_TITLE: Title must be between 1 and 150 characters';
    END IF;

    v_clean_body := trim(p_body);
    IF v_clean_body IS NULL OR length(v_clean_body) = 0 OR length(v_clean_body) > 1000 THEN
        RAISE EXCEPTION 'INVALID_BODY: Body must be between 1 and 1000 characters';
    END IF;

    v_clean_category := lower(trim(p_category));
    IF v_clean_category NOT IN ('movie_release', 'content_update', 'user_alert', 'admin_announcement', 'promotional') THEN
        RAISE EXCEPTION 'INVALID_CATEGORY: Invalid notification category "%"', p_category;
    END IF;

    IF p_url IS NOT NULL AND trim(p_url) <> '' THEN
        IF trim(p_url) !~ '^/.*' THEN
            RAISE EXCEPTION 'INVALID_URL: Target URL must be an internal path starting with /';
        END IF;
    END IF;

    -- 2. Concurrency-Safe Idempotency Check
    v_idempotency_key := NULLIF(trim(p_target_criteria->>'idempotency_key'), '');
    IF v_idempotency_key IS NOT NULL THEN
        -- Transaction-level advisory lock on idempotency key to prevent TOCTOU race conditions
        PERFORM pg_advisory_xact_lock(hashtext('campaign_idemp:' || v_idempotency_key));

        SELECT id, status, total_recipients, created_at
        INTO v_existing_camp
        FROM public.notification_campaigns
        WHERE (target_criteria->>'idempotency_key') = v_idempotency_key;

        IF FOUND THEN
            SELECT count(*) INTO v_existing_delivery_count
            FROM public.notification_deliveries
            WHERE campaign_id = v_existing_camp.id;

            RETURN jsonb_build_object(
                'success', true,
                'already_exists', true,
                'campaign_id', v_existing_camp.id,
                'status', v_existing_camp.status,
                'total_recipients', v_existing_camp.total_recipients,
                'total_deliveries', v_existing_delivery_count,
                'message', 'Campaign with idempotency key already exists'
            );
        END IF;
    END IF;

    -- 3. Determine Draft / Scheduled Status & Delivery Retry Fencing
    IF COALESCE((p_target_criteria->>'is_draft')::boolean, false) OR lower(COALESCE(p_target_criteria->>'status', '')) = 'draft' THEN
        v_is_draft := true;
        v_campaign_status := 'draft';
        v_retry_after := NULL;
    ELSIF p_scheduled_for IS NOT NULL AND p_scheduled_for > NOW() THEN
        v_campaign_status := 'scheduled';
        v_retry_after := p_scheduled_for;
    ELSE
        v_campaign_status := 'processing';
        v_retry_after := NULL;
    END IF;

    -- 4. Target Criteria Validation & Target Evaluation
    v_target_type := lower(COALESCE(p_target_criteria->>'type', 'all'));
    IF v_target_type NOT IN ('all', 'movie', 'actor', 'genre', 'users') THEN
        RAISE EXCEPTION 'INVALID_TARGET_TYPE: Unsupported target type "%"', v_target_type;
    END IF;

    -- Create temporary table to stage candidate tokens
    CREATE TEMP TABLE IF NOT EXISTS tmp_campaign_candidates (
        user_id uuid NOT NULL,
        token_id uuid NOT NULL,
        token_snapshot_hash text NOT NULL
    );
    TRUNCATE tmp_campaign_candidates;

    IF v_target_type = 'all' THEN
        INSERT INTO tmp_campaign_candidates (user_id, token_id, token_snapshot_hash)
        SELECT DISTINCT ON (t.id) t.user_id, t.id, t.token_hash
        FROM public.notification_tokens t
        WHERE t.is_active = true
          AND NOT EXISTS (
              SELECT 1 FROM public.notification_opt_outs o
              WHERE o.user_id = t.user_id AND o.category = v_clean_category
          );

    ELSIF v_target_type = 'movie' THEN
        v_movie_id := NULLIF(trim(p_target_criteria->>'movie_id'), '');
        IF v_movie_id IS NULL THEN
            RAISE EXCEPTION 'INVALID_TARGET_CRITERIA: movie_id is required for target type movie';
        END IF;

        INSERT INTO tmp_campaign_candidates (user_id, token_id, token_snapshot_hash)
        SELECT DISTINCT ON (t.id) t.user_id, t.id, t.token_hash
        FROM public.movie_notify_requests r
        JOIN public.notification_tokens t ON t.user_id = r.user_id
        WHERE r.movie_id = v_movie_id
          AND t.is_active = true
          AND NOT EXISTS (
              SELECT 1 FROM public.notification_opt_outs o
              WHERE o.user_id = t.user_id AND o.category = v_clean_category
          );

    ELSIF v_target_type = 'actor' THEN
        v_actor_id := NULLIF(trim(p_target_criteria->>'actor_id'), '');
        IF v_actor_id IS NULL THEN
            RAISE EXCEPTION 'INVALID_TARGET_CRITERIA: actor_id is required for target type actor';
        END IF;

        INSERT INTO tmp_campaign_candidates (user_id, token_id, token_snapshot_hash)
        SELECT DISTINCT ON (t.id) t.user_id, t.id, t.token_hash
        FROM public.actor_notify_requests r
        JOIN public.notification_tokens t ON t.user_id = r.user_id
        WHERE r.actor_id = v_actor_id
          AND t.is_active = true
          AND NOT EXISTS (
              SELECT 1 FROM public.notification_opt_outs o
              WHERE o.user_id = t.user_id AND o.category = v_clean_category
          );

    ELSIF v_target_type = 'genre' THEN
        v_genre_id := NULLIF(trim(p_target_criteria->>'genre_id'), '');
        IF v_genre_id IS NULL THEN
            RAISE EXCEPTION 'INVALID_TARGET_CRITERIA: genre_id is required for target type genre';
        END IF;

        INSERT INTO tmp_campaign_candidates (user_id, token_id, token_snapshot_hash)
        SELECT DISTINCT ON (t.id) t.user_id, t.id, t.token_hash
        FROM public.genre_notify_requests r
        JOIN public.notification_tokens t ON t.user_id = r.user_id
        WHERE r.genre_id = v_genre_id
          AND t.is_active = true
          AND NOT EXISTS (
              SELECT 1 FROM public.notification_opt_outs o
              WHERE o.user_id = t.user_id AND o.category = v_clean_category
          );

    ELSIF v_target_type = 'users' THEN
        v_user_ids := p_target_criteria->'user_ids';
        IF v_user_ids IS NULL OR jsonb_typeof(v_user_ids) <> 'array' OR jsonb_array_length(v_user_ids) = 0 THEN
            RAISE EXCEPTION 'INVALID_TARGET_CRITERIA: user_ids array is required for target type users';
        END IF;

        INSERT INTO tmp_campaign_candidates (user_id, token_id, token_snapshot_hash)
        SELECT DISTINCT ON (t.id) t.user_id, t.id, t.token_hash
        FROM jsonb_array_elements_text(v_user_ids) u(uid)
        JOIN public.notification_tokens t ON t.user_id = u.uid::uuid
        WHERE t.is_active = true
          AND NOT EXISTS (
              SELECT 1 FROM public.notification_opt_outs o
              WHERE o.user_id = t.user_id AND o.category = v_clean_category
          );
    END IF;

    -- 5. Separate Recipient and Delivery Counts
    SELECT count(DISTINCT user_id), count(*)
    INTO v_recipient_count, v_delivery_count
    FROM tmp_campaign_candidates;

    -- 6. Insert Campaign Record
    INSERT INTO public.notification_campaigns (
        title,
        body,
        category,
        url,
        image_url,
        target_criteria,
        status,
        total_recipients,
        scheduled_for,
        created_by,
        created_at,
        updated_at
    ) VALUES (
        v_clean_title,
        v_clean_body,
        v_clean_category,
        p_url,
        p_image_url,
        p_target_criteria,
        v_campaign_status,
        v_recipient_count,
        p_scheduled_for,
        p_created_by,
        NOW(),
        NOW()
    )
    RETURNING id INTO v_campaign_id;

    -- 7. Insert Notification Deliveries (Atomic Batch, unless Draft)
    IF NOT v_is_draft AND v_delivery_count > 0 THEN
        INSERT INTO public.notification_deliveries (
            campaign_id,
            recipient_id,
            token_id,
            token_snapshot_hash,
            delivery_status,
            retry_after,
            attempt_count,
            max_attempts,
            created_at,
            updated_at
        )
        SELECT
            v_campaign_id,
            c.user_id,
            c.token_id,
            c.token_snapshot_hash,
            'pending',
            v_retry_after,
            0,
            3,
            NOW(),
            NOW()
        FROM tmp_campaign_candidates c;
    END IF;

    -- 8. Audit Log Recording
    INSERT INTO public.notification_audit_log (action, details)
    VALUES (
        'CAMPAIGN_INGESTED',
        jsonb_build_object(
            'campaign_id', v_campaign_id,
            'target_type', v_target_type,
            'category', v_clean_category,
            'status', v_campaign_status,
            'total_recipients', v_recipient_count,
            'total_deliveries', CASE WHEN v_is_draft THEN 0 ELSE v_delivery_count END,
            'scheduled_for', p_scheduled_for,
            'created_by', p_created_by,
            'timestamp', NOW()
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'already_exists', false,
        'campaign_id', v_campaign_id,
        'status', v_campaign_status,
        'total_recipients', v_recipient_count,
        'total_deliveries', CASE WHEN v_is_draft THEN 0 ELSE v_delivery_count END,
        'scheduled_for', p_scheduled_for
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 16. Cancel Notification Campaign (Fenced Delivery Cancellation)
CREATE OR REPLACE FUNCTION public.cancel_notification_campaign(
    p_campaign_id uuid
)
RETURNS jsonb AS $$
DECLARE
    v_camp RECORD;
    v_cancelled_deliveries integer := 0;
BEGIN
    SELECT id, status INTO v_camp
    FROM public.notification_campaigns
    WHERE id = p_campaign_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'CAMPAIGN_NOT_FOUND',
            'message', 'Campaign ' || p_campaign_id || ' does not exist'
        );
    END IF;

    IF v_camp.status IN ('completed', 'failed', 'cancelled') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'INVALID_CAMPAIGN_STATE',
            'message', 'Campaign ' || p_campaign_id || ' is already in terminal state: ' || v_camp.status,
            'status', v_camp.status
        );
    END IF;

    UPDATE public.notification_campaigns
    SET status = 'cancelled',
        updated_at = NOW()
    WHERE id = p_campaign_id;

    -- Update deliveries in non-terminal states
    WITH cancelled_dels AS (
        UPDATE public.notification_deliveries
        SET delivery_status = 'cancelled',
            failure_reason = 'CAMPAIGN_CANCELLED',
            reservation_token = NULL,
            reservation_expires_at = NULL,
            current_dispatch_attempt_id = NULL,
            dispatch_expires_at = NULL,
            updated_at = NOW()
        WHERE campaign_id = p_campaign_id
          AND delivery_status IN ('pending', 'reserved')
        RETURNING id
    )
    SELECT count(*) INTO v_cancelled_deliveries FROM cancelled_dels;

    -- Also cancel queue jobs
    UPDATE public.notification_queue
    SET status = 'cancelled',
        failure_reason = 'CAMPAIGN_CANCELLED',
        lease_expires_at = NULL,
        updated_at = NOW()
    WHERE campaign_id = p_campaign_id
      AND status IN ('pending', 'processing');

    RETURN jsonb_build_object(
        'success', true,
        'campaign_id', p_campaign_id,
        'status', 'cancelled',
        'cancelled_deliveries', v_cancelled_deliveries
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ----------------------------------------------------------------------------
-- SECTION 9: Row Level Security (RLS) on All 11 Notification Tables
-- ----------------------------------------------------------------------------
ALTER TABLE public.notification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movie_notify_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actor_notify_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.genre_notify_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_opt_outs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_audit_log ENABLE ROW LEVEL SECURITY;

-- Tokens: users read/manage their own tokens
DROP POLICY IF EXISTS p_tokens_user_all ON public.notification_tokens;
CREATE POLICY p_tokens_user_all ON public.notification_tokens
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Subscriptions: users read/manage their own requests
DROP POLICY IF EXISTS p_movie_notify_user_all ON public.movie_notify_requests;
CREATE POLICY p_movie_notify_user_all ON public.movie_notify_requests
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS p_actor_notify_user_all ON public.actor_notify_requests;
CREATE POLICY p_actor_notify_user_all ON public.actor_notify_requests
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS p_genre_notify_user_all ON public.genre_notify_requests;
CREATE POLICY p_genre_notify_user_all ON public.genre_notify_requests
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- User Notifications: users read their notifications, update read state
DROP POLICY IF EXISTS p_user_notif_select ON public.user_notifications;
CREATE POLICY p_user_notif_select ON public.user_notifications
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS p_user_notif_update ON public.user_notifications;
CREATE POLICY p_user_notif_update ON public.user_notifications
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Opt-Outs: users manage their preferences
DROP POLICY IF EXISTS p_opt_outs_user_all ON public.notification_opt_outs;
CREATE POLICY p_opt_outs_user_all ON public.notification_opt_outs
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Campaigns: admins manage campaigns; authenticated read published/scheduled
DROP POLICY IF EXISTS p_campaigns_admin ON public.notification_campaigns;
CREATE POLICY p_campaigns_admin ON public.notification_campaigns
    FOR ALL TO authenticated
    USING (public.notifications_is_admin())
    WITH CHECK (public.notifications_is_admin());

-- Queue: admins only
DROP POLICY IF EXISTS p_queue_admin ON public.notification_queue;
CREATE POLICY p_queue_admin ON public.notification_queue
    FOR ALL TO authenticated
    USING (public.notifications_is_admin())
    WITH CHECK (public.notifications_is_admin());

-- Deliveries: users see deliveries for their recipient_id; admins all
DROP POLICY IF EXISTS p_deliveries_user_select ON public.notification_deliveries;
CREATE POLICY p_deliveries_user_select ON public.notification_deliveries
    FOR SELECT TO authenticated
    USING (auth.uid() = recipient_id OR public.notifications_is_admin());

-- Telemetry: users select own; admins all
DROP POLICY IF EXISTS p_telemetry_user_select ON public.notification_telemetry;
CREATE POLICY p_telemetry_user_select ON public.notification_telemetry
    FOR SELECT TO authenticated
    USING (auth.uid() = recipient_id OR public.notifications_is_admin());

-- Audit Log: admins read only
DROP POLICY IF EXISTS p_audit_log_admin ON public.notification_audit_log;
CREATE POLICY p_audit_log_admin ON public.notification_audit_log
    FOR SELECT TO authenticated
    USING (public.notifications_is_admin());

-- ----------------------------------------------------------------------------
-- SECTION 10: Strict Role Privileges & Grants (Targeted Scoping)
-- ----------------------------------------------------------------------------
-- ============================================================================
-- Explicit Table Privilege Lockdown (Remediates Inherited Default Privileges)
-- ============================================================================
-- Supabase / PostgreSQL default privileges for postgres in schema public grant
-- In production Supabase, postgres default privileges in public include MAINTAIN, REFERENCES, TRIGGER, TRUNCATE
-- to anon, authenticated, and service_role.
-- Explicitly revoke all privileges from PUBLIC, anon, and authenticated across all
-- 15 notification and quarantine tables before granting strictly required minimums.

REVOKE ALL ON TABLE 
    public.admin_users,
    public.notification_tokens,
    public.movie_notify_requests,
    public.actor_notify_requests,
    public.genre_notify_requests,
    public.notification_campaigns,
    public.notification_queue,
    public.notification_deliveries,
    public.notification_telemetry,
    public.user_notifications,
    public.notification_opt_outs,
    public.notification_audit_log,
    public.legacy_token_quarantine,
    public.legacy_subscription_quarantine,
    public.legacy_delivery_quarantine
FROM PUBLIC, anon, authenticated;

-- Minimum Required Table Grants for Authenticated Users (Governed by RLS Policies)
-- Tokens: users insert, select, update, delete own tokens
-- notification_tokens: Device registration, token refresh, and revocation are handled
-- EXCLUSIVELY through backend serverless endpoints (/api/notifications/register and /api/notifications/revoke)
-- operating under service_role. No direct client SQL access is required or permitted.
-- STRICT ZERO GRANTS: Authenticated and anon client roles possess ZERO SELECT, INSERT, UPDATE, or DELETE privileges.

-- Subscriptions: users insert, select, update, delete own requests
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.movie_notify_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.actor_notify_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.genre_notify_requests TO authenticated;

-- User Notifications: users read their notifications and mark read/unread
GRANT SELECT, UPDATE ON TABLE public.user_notifications TO authenticated;

-- Opt-outs / Preferences: users manage own preferences
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_opt_outs TO authenticated;

-- Admin-managed tables (authenticated users with admin role manage via RLS notifications_is_admin())
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_campaigns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_queue TO authenticated;
GRANT SELECT ON TABLE public.notification_audit_log TO authenticated;

-- Read-only delivery & telemetry queries for recipient / admin inspection
-- notification_deliveries: Strictly restrict client SELECT to user-facing notification delivery metadata.
-- Excludes all internal dispatch fields (worker_id, reservation_token, reservation_expires_at,
-- current_dispatch_attempt_id, dispatch_expires_at, token_snapshot_hash, fcm_message_id, failure_reason)
-- as well as internal retry fields (token_id, retry_after, attempt_count, max_attempts).
GRANT SELECT (id, campaign_id, recipient_id, delivery_status, created_at, updated_at) 
    ON TABLE public.notification_deliveries TO authenticated;
-- notification_telemetry: Telemetry is recorded via SECURITY DEFINER function record_notification_telemetry().
-- Authenticated users do not require direct SQL SELECT or DML on notification_telemetry table.
-- Zero client table grants; telemetry table is reserved for service_role and admin queries.

-- admin_users: authenticated users self-row check
GRANT SELECT ON TABLE public.admin_users TO authenticated;

-- Quarantine tables: STRICTLY ZERO GRANTS to PUBLIC, anon, or authenticated.
-- (legacy_token_quarantine, legacy_subscription_quarantine, legacy_delivery_quarantine)

-- Full administrative access for backend service_role
GRANT ALL ON TABLE 
    public.admin_users,
    public.notification_tokens,
    public.movie_notify_requests,
    public.actor_notify_requests,
    public.genre_notify_requests,
    public.notification_campaigns,
    public.notification_queue,
    public.notification_deliveries,
    public.notification_telemetry,
    public.user_notifications,
    public.notification_opt_outs,
    public.notification_audit_log,
    public.legacy_token_quarantine,
    public.legacy_subscription_quarantine,
    public.legacy_delivery_quarantine
TO service_role;


-- 1. Targeted revocations on notification functions (no blanket schema-wide revokes)
REVOKE ALL ON FUNCTION public.notifications_is_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_notification_queue_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_notification_queue_lease(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_or_retry_notification_job(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_notification_queue_job(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_expired_notification_queue_jobs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_notification_deliveries(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authorize_notification_delivery_dispatch(uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_notification_delivery_leases(text, uuid[], integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_notification_delivery_sent(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_or_retry_notification_delivery(uuid, text, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_notification_telemetry(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_expired_delivery_reservations() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_stale_notification_deliveries(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ingest_notification_campaign(text, text, text, text, text, jsonb, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_notification_campaign(uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.trg_validate_delivery_status_transition() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_notification_token_hash() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_notification_token_ownership() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_protect_user_notifications_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_campaign_cancellation() FROM PUBLIC, anon, authenticated;

-- 2. Service role grants for worker RPCs and trigger creation
GRANT EXECUTE ON FUNCTION public.claim_notification_queue_batch(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_notification_queue_lease(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_or_retry_notification_job(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_notification_queue_job(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_expired_notification_queue_jobs() TO service_role;

GRANT EXECUTE ON FUNCTION public.reserve_notification_deliveries(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.authorize_notification_delivery_dispatch(uuid, uuid, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_notification_delivery_leases(text, uuid[], integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_notification_delivery_sent(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_or_retry_notification_delivery(uuid, text, uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_notification_telemetry(uuid, uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_expired_delivery_reservations() TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_stale_notification_deliveries(integer) TO service_role;

GRANT EXECUTE ON FUNCTION public.ingest_notification_campaign(text, text, text, text, text, jsonb, timestamptz, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_notification_campaign(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.notifications_is_admin() TO service_role;

GRANT EXECUTE ON FUNCTION public.trg_validate_delivery_status_transition() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_sync_notification_token_hash() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_sync_notification_token_ownership() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_protect_user_notifications_update() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_sync_campaign_cancellation() TO service_role;

-- 3. Authenticated user grants (strictly limited to client RPCs)
GRANT EXECUTE ON FUNCTION public.record_notification_telemetry(uuid, uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notifications_is_admin() TO authenticated;
-- Note: Trigger functions do not require authenticated EXECUTE per PostgreSQL trigger semantics

COMMIT;

