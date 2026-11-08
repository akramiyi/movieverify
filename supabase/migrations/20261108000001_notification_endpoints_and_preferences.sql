-- ============================================================================
-- Migration: 20261108000001_notification_endpoints_and_preferences.sql
-- Description: Creates canonical notification_endpoints and user_notification_preferences
-- Target: PostgreSQL 17 / Supabase
-- Architecture Baseline: Phase 1.9, v1.9.0
-- ============================================================================

-- Table 1: public.notification_endpoints
-- Stores physical push device endpoints (FCM & Web Push VAPID) for authenticated users and anonymous guests.
CREATE TABLE IF NOT EXISTS public.notification_endpoints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    channel_type varchar(16) NOT NULL CHECK (channel_type IN ('fcm', 'web_push')),
    token text,
    endpoint_url text,
    p256dh_key text,
    auth_secret text,
    endpoint_hash text NOT NULL,
    client_secret_hash text NOT NULL,
    device_type varchar(16) NOT NULL DEFAULT 'web' CHECK (device_type IN ('android', 'ios', 'web', 'desktop')),
    device_name varchar(128),
    browser varchar(64),
    os varchar(64),
    is_active boolean NOT NULL DEFAULT true,
    last_seen_at timestamptz NOT NULL DEFAULT NOW(),
    revoked_at timestamptz,
    revocation_reason varchar(64),
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),

    -- Transport integrity constraint: FCM requires token; Web Push requires URL + p256dh + auth
    CONSTRAINT chk_endpoint_transport_fields CHECK (
        (channel_type = 'fcm' AND token IS NOT NULL AND endpoint_url IS NULL AND p256dh_key IS NULL AND auth_secret IS NULL) OR
        (channel_type = 'web_push' AND endpoint_url IS NOT NULL AND p256dh_key IS NOT NULL AND auth_secret IS NOT NULL AND token IS NULL)
    ),

    -- Composite unique constraint to support recipient matching in deliveries
    CONSTRAINT uq_endpoints_id_user UNIQUE (id, user_id)
);

-- Active endpoint hash uniqueness (Permits multiple inactive/revoked historic records)
CREATE UNIQUE INDEX IF NOT EXISTS uq_endpoints_active_hash
ON public.notification_endpoints (endpoint_hash)
WHERE is_active = true;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_endpoints_user_id
ON public.notification_endpoints (user_id);

CREATE INDEX IF NOT EXISTS idx_endpoints_active
ON public.notification_endpoints (is_active)
WHERE is_active = true;

-- Table 2: public.user_notification_preferences
-- Centralized user notification preferences, categories, channel switches, and quiet hours.
CREATE TABLE IF NOT EXISTS public.user_notification_preferences (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    opt_in_all boolean NOT NULL DEFAULT true,
    notify_new_movies boolean NOT NULL DEFAULT true,
    notify_new_series boolean NOT NULL DEFAULT true,
    notify_movie_updates boolean NOT NULL DEFAULT true,
    notify_promotions boolean NOT NULL DEFAULT false,
    notify_system boolean NOT NULL DEFAULT true,
    channel_in_app boolean NOT NULL DEFAULT true,
    channel_push boolean NOT NULL DEFAULT true,
    channel_email boolean NOT NULL DEFAULT false,
    quiet_hours_enabled boolean NOT NULL DEFAULT false,
    quiet_hours_start time,
    quiet_hours_end time,
    quiet_hours_tz varchar(64) NOT NULL DEFAULT 'UTC',
    max_daily_push smallint NOT NULL DEFAULT 5 CHECK (max_daily_push >= 1 AND max_daily_push <= 50),
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),

    -- Quiet hours integrity: enabled requires valid start and end times
    CONSTRAINT chk_quiet_hours_integrity CHECK (
        (quiet_hours_enabled = false) OR
        (quiet_hours_enabled = true AND quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL)
    )
);

-- Safe Authenticated View (Omits raw tokens, p256dh/auth keys, and client_secret_hash)
CREATE OR REPLACE VIEW public.user_notification_endpoints AS
SELECT
    id,
    user_id,
    channel_type,
    device_type,
    device_name,
    browser,
    os,
    is_active,
    last_seen_at,
    created_at,
    updated_at
FROM public.notification_endpoints
WHERE is_active = true;

