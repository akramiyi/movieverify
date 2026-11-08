-- ============================================================================
-- Migration: 20261108000003_notification_campaigns_and_queue.sql
-- Description: Creates notification_campaigns, notification_audit_log, and notification_queue
-- Target: PostgreSQL 17 / Supabase
-- Architecture Baseline: Phase 1.9, v1.9.0
-- ============================================================================

-- Table 5: public.notification_campaigns
-- Administrative and automated broadcast campaigns.
CREATE TABLE IF NOT EXISTS public.notification_campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title varchar(255) NOT NULL,
    body text NOT NULL,
    category varchar(32) NOT NULL CHECK (category IN (
        'movie_release', 'content_update', 'user_alert', 'admin_announcement',
        'promotional', 'new_release', 'system', 'editorial', 'security'
    )),
    action_url text,
    image_url text,
    target_type varchar(32) NOT NULL DEFAULT 'all' CHECK (target_type IN (
        'all', 'subscribers', 'segment', 'individual', 'movie', 'actor', 'genre', 'users'
    )),
    target_criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
    status varchar(24) NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'scheduled', 'queued', 'processing', 'completed', 'paused', 'cancelled', 'failed'
    )),
    priority smallint NOT NULL DEFAULT 0 CHECK (priority >= -100 AND priority <= 100),
    total_recipients integer NOT NULL DEFAULT 0,
    sent_count integer NOT NULL DEFAULT 0,
    success_count integer NOT NULL DEFAULT 0,
    failure_count integer NOT NULL DEFAULT 0,
    open_count integer NOT NULL DEFAULT 0,
    click_count integer NOT NULL DEFAULT 0,
    scheduled_for timestamptz,
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    sent_at timestamptz,
    completed_at timestamptz,
    cancelled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status
ON public.notification_campaigns (status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_campaigns_created_at
ON public.notification_campaigns (created_at DESC);

-- Wire foreign key from user_notifications to notification_campaigns
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_user_notif_campaign' AND table_name = 'user_notifications'
    ) THEN
        ALTER TABLE public.user_notifications
        ADD CONSTRAINT fk_user_notif_campaign
        FOREIGN KEY (campaign_id) REFERENCES public.notification_campaigns(id) ON DELETE SET NULL;
    END IF;
END;
$$;

-- Table 6: public.notification_audit_log
-- Immutable security audit log. Append-only protections are wired in migration 4.
CREATE TABLE IF NOT EXISTS public.notification_audit_log (
    id bigserial PRIMARY KEY,
    actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_role varchar(32) NOT NULL DEFAULT 'service_role',
    action varchar(64) NOT NULL,
    entity_type varchar(32) NOT NULL,
    entity_id varchar(64) NOT NULL,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity
ON public.notification_audit_log (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
ON public.notification_audit_log (created_at DESC);

-- Table 7: public.notification_queue
-- Batch job queue for concurrent background workers with cryptographic lease fencing.
CREATE TABLE IF NOT EXISTS public.notification_queue (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES public.notification_campaigns(id) ON DELETE CASCADE,
    idempotency_key varchar(128) NOT NULL UNIQUE,
    batch_index integer NOT NULL DEFAULT 0,
    payload jsonb NOT NULL,
    priority smallint NOT NULL DEFAULT 0 CHECK (priority >= -100 AND priority <= 100),
    status varchar(24) NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'leased', 'completed', 'failed', 'dead_letter', 'cancelled'
    )),
    attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts smallint NOT NULL DEFAULT 3 CHECK (max_attempts >= 1 AND max_attempts <= 10),
    run_at timestamptz NOT NULL DEFAULT NOW(),
    lease_token uuid,
    lease_expires_at timestamptz,
    worker_id varchar(64),
    failure_reason text,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),

    -- Lease consistency constraint: leased status strictly requires token, expiry, and worker identity
    CONSTRAINT chk_queue_lease_integrity CHECK (
        (status = 'leased' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND worker_id IS NOT NULL) OR
        (status != 'leased' AND lease_token IS NULL AND lease_expires_at IS NULL)
    ),

    -- Attempts boundary check
    CONSTRAINT chk_queue_attempts_limit CHECK (attempts <= max_attempts)
);

CREATE INDEX IF NOT EXISTS idx_notification_queue_claim
ON public.notification_queue (priority DESC, run_at ASC, id)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_notification_queue_leased
ON public.notification_queue (lease_expires_at)
WHERE status = 'leased';

