-- ============================================================================
-- Migration: 20261108000002_notification_subscriptions_and_inbox.sql
-- Description: Creates notification_subscriptions and user_notifications (in-app inbox)
-- Target: PostgreSQL 17 / Supabase
-- Architecture Baseline: Phase 1.9, v1.9.0
-- ============================================================================

-- Table 3: public.notification_subscriptions
-- Polymorphic registry for user alert subscriptions (movies, actors, genres).
CREATE TABLE IF NOT EXISTS public.notification_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    entity_type varchar(16) NOT NULL CHECK (entity_type IN ('movie', 'actor', 'genre')),
    entity_id varchar(64) NOT NULL,
    entity_title varchar(255),
    status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'notified', 'paused')),
    last_notified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_sub_user_entity UNIQUE (user_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_entity
ON public.notification_subscriptions (entity_type, entity_id)
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_subscriptions_user
ON public.notification_subscriptions (user_id);

-- Table 4: public.user_notifications
-- In-app notification center inbox with read-state consistency and campaign deduplication.
CREATE TABLE IF NOT EXISTS public.user_notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    campaign_id uuid, -- FK will be added in migration 3 after notification_campaigns is created
    delivery_id uuid, -- FK will be added in migration 4 after notification_deliveries is created
    category varchar(32) NOT NULL DEFAULT 'system',
    title varchar(255) NOT NULL,
    body text NOT NULL,
    action_url text,
    image_url text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_read boolean NOT NULL DEFAULT false,
    read_at timestamptz,
    is_deleted boolean NOT NULL DEFAULT false,
    expires_at timestamptz NOT NULL DEFAULT (NOW() + interval '90 days'),
    created_at timestamptz NOT NULL DEFAULT NOW(),

    -- Read state consistency constraint
    CONSTRAINT chk_inbox_read_state CHECK (
        (is_read = false AND read_at IS NULL) OR
        (is_read = true AND read_at IS NOT NULL)
    )
);

-- Partial unique index ensuring single inbox entry per campaign while allowing multiple transactional notifications
CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_user_campaign
ON public.user_notifications (user_id, campaign_id)
WHERE campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inbox_user_unread
ON public.user_notifications (user_id, created_at DESC)
WHERE is_read = false AND is_deleted = false;

