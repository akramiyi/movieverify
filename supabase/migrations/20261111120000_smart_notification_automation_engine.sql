-- ============================================================================
-- Migration: 20261111120000_smart_notification_automation_engine.sql
-- Description: Phase 5.2 Smart Notification Automation Engine (Forward-Only)
--   - First-time welcome notification idempotency & preferences gating
--   - Movie, TV series, and season subscription targeting + compatibility sync
--   - Full preference enforcement (opt_in_all, notify_*, channels, quiet hours
--     with timezone awareness, max_daily_push caps, email non-support visibility)
--   - Scheduled campaign promotion RPC (promote_due_scheduled_campaigns)
--   - Explicit notification_queue polling retirement (retained as audit ledger;
--     notification_deliveries remains the sole worker dispatch queue preserving B5E)
--   - Independent in-app inbox materialization (user_notifications without push)
--   - Hardened telemetry state transitions & 'client_failed' event support
-- Target: PostgreSQL 17 / Supabase
-- Security Baseline: Preserves Phase 4 / B5D / B5E invariants intact
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema Extensions (Forward-Only, Idempotent)
-- ----------------------------------------------------------------------------

-- 1A. Extend notification_subscriptions for 'series' and 'season' entities + metadata
ALTER TABLE public.notification_subscriptions
ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
DECLARE
    v_con record;
BEGIN
    FOR v_con IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'notification_subscriptions'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%entity_type%'
    LOOP
        EXECUTE format('ALTER TABLE public.notification_subscriptions DROP CONSTRAINT IF EXISTS %I', v_con.conname);
    END LOOP;

    ALTER TABLE public.notification_subscriptions
    ADD CONSTRAINT chk_subscriptions_entity_type
    CHECK (entity_type IN ('movie', 'series', 'season', 'actor', 'genre'));
END;
$$;

-- 1B. Extend movie_notify_requests with media_type + target_season for TV series compatibility
ALTER TABLE public.movie_notify_requests
ADD COLUMN IF NOT EXISTS media_type varchar(16) NOT NULL DEFAULT 'movie',
ADD COLUMN IF NOT EXISTS target_season integer;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_movie_notify_media_type'
          AND conrelid = 'public.movie_notify_requests'::regclass
    ) THEN
        ALTER TABLE public.movie_notify_requests
        ADD CONSTRAINT chk_movie_notify_media_type
        CHECK (media_type IN ('movie', 'tv', 'series'));
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_movie_to_canonical()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_entity_type varchar(16);
    v_entity_id varchar(64);
    v_metadata jsonb;
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        IF NEW.target_season IS NOT NULL AND NEW.target_season > 0 THEN
            v_entity_type := 'season';
            v_entity_id := NEW.movie_id || ':s' || NEW.target_season::text;
        ELSIF LOWER(COALESCE(NEW.media_type, 'movie')) IN ('tv', 'series') THEN
            v_entity_type := 'series';
            v_entity_id := NEW.movie_id;
        ELSE
            v_entity_type := 'movie';
            v_entity_id := NEW.movie_id;
        END IF;

        v_metadata := jsonb_build_object(
            'media_type', COALESCE(NEW.media_type, 'movie'),
            'target_season', NEW.target_season,
            'series_id', NEW.movie_id
        );

        -- Ensure switching between movie/series/season for the same item stays clean
        IF TG_OP = 'UPDATE' THEN
            DELETE FROM public.notification_subscriptions
            WHERE user_id = OLD.user_id
              AND (
                  (entity_id = OLD.movie_id AND entity_type IN ('movie', 'series') AND (entity_type != v_entity_type OR entity_id != v_entity_id))
                  OR (entity_type = 'season' AND entity_id LIKE (OLD.movie_id || ':s%') AND entity_id != v_entity_id)
              );
        END IF;

        INSERT INTO public.notification_subscriptions (
            user_id, entity_type, entity_id, entity_title, status, metadata, created_at, updated_at
        )
        VALUES (
            NEW.user_id, v_entity_type, v_entity_id, NEW.movie_title, 'active', v_metadata, NEW.created_at, NOW()
        )
        ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE
        SET entity_title = EXCLUDED.entity_title,
            status = 'active',
            metadata = EXCLUDED.metadata,
            updated_at = NOW();

        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        DELETE FROM public.notification_subscriptions
        WHERE user_id = OLD.user_id
          AND (
              (entity_id = OLD.movie_id AND entity_type IN ('movie', 'series'))
              OR (entity_type = 'season' AND entity_id = (OLD.movie_id || ':s' || COALESCE(OLD.target_season::text, '')))
          );
        RETURN OLD;
    END IF;
END;
$$;

-- 1C. Extend notification_campaigns.target_type check constraint for 'series' and 'season'
DO $$
DECLARE
    v_con record;
BEGIN
    FOR v_con IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'notification_campaigns'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%target_type%'
    LOOP
        EXECUTE format('ALTER TABLE public.notification_campaigns DROP CONSTRAINT IF EXISTS %I', v_con.conname);
    END LOOP;

    ALTER TABLE public.notification_campaigns
    ADD CONSTRAINT chk_campaigns_target_type
    CHECK (target_type IN (
        'all', 'subscribers', 'segment', 'individual',
        'movie', 'series', 'season', 'actor', 'genre', 'users'
    ));
END;
$$;

-- 1D. Extend notification_telemetry.event_type check constraint to support 'client_failed'
DO $$
DECLARE
    v_con record;
BEGIN
    FOR v_con IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'notification_telemetry'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%event_type%'
    LOOP
        EXECUTE format('ALTER TABLE public.notification_telemetry DROP CONSTRAINT IF EXISTS %I', v_con.conname);
    END LOOP;

    ALTER TABLE public.notification_telemetry
    ADD CONSTRAINT chk_telemetry_event_type
    CHECK (event_type IN (
        'dispatched', 'provider_accepted', 'provider_rejected', 'provider_unregistered',
        'device_received', 'displayed', 'opened', 'clicked', 'dismissed', 'client_failed'
    ));
END;
$$;

-- 1E. One-time Welcome Notification Registry (strictly 1 dispatch decision per account)
CREATE TABLE IF NOT EXISTS public.user_welcome_dispatches (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    notification_id uuid REFERENCES public.user_notifications(id) ON DELETE SET NULL,
    delivery_id uuid REFERENCES public.notification_deliveries(id) ON DELETE SET NULL,
    status varchar(32) NOT NULL CHECK (status IN (
        'created', 'suppressed_preferences', 'suppressed_channel', 'not_new_registration'
    )),
    suppressed_reason text,
    source varchar(32) NOT NULL DEFAULT 'api',
    created_at timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_welcome_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_welcome_dispatches FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_welcome_dispatches FROM PUBLIC, anon;
GRANT SELECT ON public.user_welcome_dispatches TO authenticated;
GRANT ALL ON public.user_welcome_dispatches TO service_role;

DROP POLICY IF EXISTS p_welcome_dispatches_user_select ON public.user_welcome_dispatches;
CREATE POLICY p_welcome_dispatches_user_select ON public.user_welcome_dispatches
FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS p_welcome_dispatches_service ON public.user_welcome_dispatches;
CREATE POLICY p_welcome_dispatches_service ON public.user_welcome_dispatches
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

-- Explicit documentation of notification_queue architectural role:
COMMENT ON TABLE public.notification_queue IS
'Audit/idempotency job ledger populated on campaign ingestion and cancellation. Explicitly retired from worker polling as of Phase 5.2; public.notification_deliveries (reserved and fenced via B5E reserve_notification_deliveries / authorize_notification_delivery_dispatch) is the sole worker dispatch queue.';

-- ----------------------------------------------------------------------------
-- 2. Preference, Quiet Hours & Daily Push Cap Helpers
-- ----------------------------------------------------------------------------

-- Resolve a timezone string cleanly against pg_timezone_names, falling back to UTC.
CREATE OR REPLACE FUNCTION public.resolve_valid_timezone(p_tz text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_name text;
BEGIN
    IF p_tz IS NULL OR length(trim(p_tz)) = 0 THEN
        RETURN 'UTC';
    END IF;

    SELECT name INTO v_name
    FROM pg_catalog.pg_timezone_names
    WHERE name = trim(p_tz)
    LIMIT 1;

    RETURN COALESCE(v_name, 'UTC');
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_valid_timezone(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_valid_timezone(text) TO service_role;

-- Computes the exact UTC instant when quiet hours end if p_now falls inside the user's
-- configured local quiet-hours window; returns NULL when immediate push dispatch is permitted.
CREATE OR REPLACE FUNCTION public.compute_quiet_hours_resume_at(
    p_enabled boolean,
    p_start time,
    p_end time,
    p_tz text DEFAULT 'UTC',
    p_now timestamptz DEFAULT NOW()
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_tz text;
    v_local_ts timestamp;
    v_local_date date;
    v_local_time time;
BEGIN
    IF NOT COALESCE(p_enabled, false) OR p_start IS NULL OR p_end IS NULL OR p_start = p_end THEN
        RETURN NULL;
    END IF;

    v_tz := public.resolve_valid_timezone(p_tz);
    v_local_ts := p_now AT TIME ZONE v_tz;
    v_local_date := v_local_ts::date;
    v_local_time := v_local_ts::time;

    IF p_start < p_end THEN
        -- Daytime window (e.g., 13:00 -> 17:00 local)
        IF v_local_time >= p_start AND v_local_time < p_end THEN
            RETURN (v_local_date + p_end) AT TIME ZONE v_tz;
        END IF;
    ELSE
        -- Overnight wrap window (e.g., 22:00 -> 07:00 local)
        IF v_local_time >= p_start THEN
            RETURN ((v_local_date + 1) + p_end) AT TIME ZONE v_tz;
        ELSIF v_local_time < p_end THEN
            RETURN (v_local_date + p_end) AT TIME ZONE v_tz;
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_quiet_hours_resume_at(boolean, time, time, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_quiet_hours_resume_at(boolean, time, time, text, timestamptz) TO service_role;

-- Evaluates canonical user_notification_preferences + legacy notification_opt_outs.
CREATE OR REPLACE FUNCTION public.is_category_allowed_by_preferences(
    p_user_id uuid,
    p_category text,
    p_target_type text DEFAULT 'all',
    p_media_type text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_pref record;
    v_has_pref boolean := false;
    v_is_series boolean := false;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN false;
    END IF;

    -- Legacy per-category opt-out table always takes precedence
    IF EXISTS (
        SELECT 1
        FROM public.notification_opt_outs o
        WHERE o.user_id = p_user_id
          AND o.category = p_category
    ) THEN
        RETURN false;
    END IF;

    SELECT * INTO v_pref
    FROM public.user_notification_preferences
    WHERE user_id = p_user_id
    LIMIT 1;

    v_has_pref := FOUND;

    IF v_has_pref AND NOT COALESCE(v_pref.opt_in_all, true) THEN
        RETURN false;
    END IF;

    v_is_series := (
        p_target_type IN ('series', 'season')
        OR LOWER(COALESCE(p_media_type, '')) IN ('tv', 'series')
    );

    IF p_category IN ('movie_release', 'new_release') THEN
        IF v_is_series THEN
            RETURN COALESCE(v_pref.notify_new_series, true);
        END IF;
        RETURN COALESCE(v_pref.notify_new_movies, true);
    ELSIF p_category = 'content_update' THEN
        RETURN COALESCE(v_pref.notify_movie_updates, true);
    ELSIF p_category IN ('user_alert', 'admin_announcement', 'system', 'editorial', 'security') THEN
        RETURN COALESCE(v_pref.notify_system, true);
    ELSIF p_category = 'promotional' THEN
        IF p_target_type = 'all' THEN
            -- Broadcast promotions require explicit opt-in
            RETURN v_has_pref AND COALESCE(v_pref.notify_promotions, false);
        ELSIF v_has_pref THEN
            -- Targeted notifications still honor explicit opt-out in canonical preferences
            RETURN COALESCE(v_pref.notify_promotions, true);
        END IF;
        RETURN true;
    END IF;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.is_category_allowed_by_preferences(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_category_allowed_by_preferences(uuid, text, text, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Internal Campaign Materializer (Shared by Immediate Ingestion & Scheduled Promotion)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._materialize_notification_campaign(
    p_campaign_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_camp record;
    v_target_type text;
    v_media_type text;
    v_movie_id text;
    v_series_id text;
    v_season_number integer;
    v_idempotency_key text;
    v_recipient record;
    v_endpoint record;
    v_valid_tz text;
    v_resume_at timestamptz;
    v_daily_push_count integer;
    v_remaining_push_budget integer;
    v_allow_in_app boolean;
    v_allow_push boolean;
    v_first_delivery_id uuid;
    v_delivery_id uuid;
    v_user_push_queued integer;
    v_total_recipients integer := 0;
    v_push_deliveries integer := 0;
    v_in_app_deliveries integer := 0;
    v_deferred_quiet_hours integer := 0;
    v_suppressed_daily_cap integer := 0;
    v_final_status text;
    v_queue_key text;
BEGIN
    SELECT * INTO v_camp
    FROM public.notification_campaigns
    WHERE id = p_campaign_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Campaign % not found', p_campaign_id USING ERRCODE = 'MV404';
    END IF;

    v_target_type := v_camp.target_type;
    v_media_type := NULLIF(trim(COALESCE(v_camp.target_criteria->>'media_type', '')), '');
    v_movie_id := COALESCE(v_camp.target_criteria->>'movie_id', v_camp.target_criteria->>'tmdb_id');
    v_series_id := COALESCE(v_camp.target_criteria->>'series_id', v_camp.target_criteria->>'movie_id', v_camp.target_criteria->>'tmdb_id');
    v_season_number := CASE
        WHEN (v_camp.target_criteria->>'season_number') ~ '^[0-9]+$'
            THEN (v_camp.target_criteria->>'season_number')::integer
        ELSE NULL
    END;
    v_idempotency_key := NULLIF(trim(COALESCE(v_camp.target_criteria->>'idempotency_key', '')), '');

    -- Resolve candidate users across push-enabled devices, preferences, subscriptions, or explicit list
    FOR v_recipient IN
        WITH candidate_users AS (
            SELECT DISTINCT u_id AS user_id
            FROM (
                -- 'all' broadcast: users with an active non-revoked push endpoint OR explicit preferences OR active subscriptions
                SELECT ne.user_id AS u_id
                FROM public.notification_endpoints ne
                WHERE v_target_type = 'all'
                  AND ne.is_active = true
                  AND ne.revoked_at IS NULL
                  AND ne.user_id IS NOT NULL

                UNION

                SELECT up.user_id AS u_id
                FROM public.user_notification_preferences up
                WHERE v_target_type = 'all'
                  AND up.opt_in_all = true
                  AND (up.channel_in_app = true OR up.channel_push = true)

                UNION

                SELECT ns.user_id AS u_id
                FROM public.notification_subscriptions ns
                WHERE v_target_type = 'all'
                  AND ns.status = 'active'

                UNION

                -- 'movie' subscribers (plus compatible legacy series items stored as 'movie' before Phase 5.2 when media_type is unknown/movie)
                SELECT ns.user_id AS u_id
                FROM public.notification_subscriptions ns
                WHERE v_target_type = 'movie'
                  AND ns.status = 'active'
                  AND ns.entity_type = 'movie'
                  AND ns.entity_id = v_movie_id

                UNION

                -- 'series' subscribers
                SELECT ns.user_id AS u_id
                FROM public.notification_subscriptions ns
                WHERE v_target_type = 'series'
                  AND ns.status = 'active'
                  AND (
                      (ns.entity_type = 'series' AND ns.entity_id = v_series_id)
                      OR (
                          ns.entity_type = 'movie'
                          AND ns.entity_id = v_series_id
                          AND COALESCE(ns.metadata->>'media_type', 'movie') IN ('tv', 'series')
                      )
                  )

                UNION

                -- 'season' subscribers (targets both exact season subscribers and whole-series followers)
                SELECT ns.user_id AS u_id
                FROM public.notification_subscriptions ns
                WHERE v_target_type = 'season'
                  AND ns.status = 'active'
                  AND (
                      (v_season_number IS NOT NULL AND ns.entity_type = 'season' AND ns.entity_id = (v_series_id || ':s' || v_season_number::text))
                      OR (ns.entity_type = 'series' AND ns.entity_id = v_series_id)
                  )

                UNION

                -- 'actor' subscribers
                SELECT ns.user_id AS u_id
                FROM public.notification_subscriptions ns
                WHERE v_target_type = 'actor'
                  AND ns.status = 'active'
                  AND ns.entity_type = 'actor'
                  AND ns.entity_id = (v_camp.target_criteria->>'actor_id')

                UNION

                -- 'genre' subscribers
                SELECT ns.user_id AS u_id
                FROM public.notification_subscriptions ns
                WHERE v_target_type = 'genre'
                  AND ns.status = 'active'
                  AND ns.entity_type = 'genre'
                  AND ns.entity_id = (v_camp.target_criteria->>'genre_id')

                UNION

                -- Explicit 'users' list
                SELECT (jsonb_array_elements_text(v_camp.target_criteria->'user_ids'))::uuid AS u_id
                WHERE v_target_type = 'users'
                  AND jsonb_typeof(v_camp.target_criteria->'user_ids') = 'array'
            ) raw_users
            WHERE u_id IS NOT NULL
        )
        SELECT
            cu.user_id,
            COALESCE(p.channel_in_app, true) AS channel_in_app,
            COALESCE(p.channel_push, true) AS channel_push,
            COALESCE(p.quiet_hours_enabled, false) AS quiet_hours_enabled,
            p.quiet_hours_start,
            p.quiet_hours_end,
            COALESCE(p.quiet_hours_tz, 'UTC') AS quiet_hours_tz,
            COALESCE(p.max_daily_push, 5) AS max_daily_push
        FROM candidate_users cu
        LEFT JOIN public.user_notification_preferences p ON p.user_id = cu.user_id
        WHERE public.is_category_allowed_by_preferences(cu.user_id, v_camp.category, v_target_type, v_media_type)
    LOOP
        v_allow_in_app := v_recipient.channel_in_app;
        v_allow_push := v_recipient.channel_push;

        IF NOT v_allow_in_app AND NOT v_allow_push THEN
            CONTINUE;
        END IF;

        v_valid_tz := public.resolve_valid_timezone(v_recipient.quiet_hours_tz);
        v_resume_at := public.compute_quiet_hours_resume_at(
            v_recipient.quiet_hours_enabled,
            v_recipient.quiet_hours_start,
            v_recipient.quiet_hours_end,
            v_valid_tz,
            NOW()
        );

        -- Enforce per-user max_daily_push in the user's configured timezone
        SELECT count(*)::integer INTO v_daily_push_count
        FROM public.notification_deliveries d
        WHERE d.recipient_id = v_recipient.user_id
          AND d.channel_type IN ('fcm', 'web_push')
          AND d.delivery_status IN ('pending', 'leased', 'sent', 'delivered')
          AND (d.created_at AT TIME ZONE v_valid_tz)::date = (NOW() AT TIME ZONE v_valid_tz)::date;

        v_remaining_push_budget := GREATEST(0, v_recipient.max_daily_push - v_daily_push_count);
        v_first_delivery_id := NULL;
        v_user_push_queued := 0;

        -- Enqueue Push Deliveries only when channel_push is true and active endpoints exist
        IF v_allow_push THEN
            IF v_remaining_push_budget <= 0 THEN
                -- Count cap suppression if user actually had active endpoints
                IF EXISTS (
                    SELECT 1 FROM public.notification_endpoints ne
                    WHERE ne.user_id = v_recipient.user_id
                      AND ne.is_active = true
                      AND ne.revoked_at IS NULL
                ) THEN
                    v_suppressed_daily_cap := v_suppressed_daily_cap + 1;
                END IF;
            ELSE
                FOR v_endpoint IN
                    SELECT ne.id, ne.channel_type
                    FROM public.notification_endpoints ne
                    WHERE ne.user_id = v_recipient.user_id
                      AND ne.is_active = true
                      AND ne.revoked_at IS NULL
                      AND ne.channel_type IN ('fcm', 'web_push')
                    ORDER BY ne.last_seen_at DESC NULLS LAST, ne.created_at DESC
                LOOP
                    EXIT WHEN v_user_push_queued >= v_remaining_push_budget;

                    INSERT INTO public.notification_deliveries (
                        campaign_id, recipient_type, recipient_id, endpoint_id, channel_type,
                        delivery_status, next_retry_at
                    )
                    VALUES (
                        v_camp.id, 'user', v_recipient.user_id, v_endpoint.id, v_endpoint.channel_type,
                        'pending', v_resume_at
                    )
                    ON CONFLICT (campaign_id, endpoint_id) DO NOTHING
                    RETURNING id INTO v_delivery_id;

                    IF v_delivery_id IS NOT NULL THEN
                        IF v_first_delivery_id IS NULL THEN
                            v_first_delivery_id := v_delivery_id;
                        END IF;
                        v_user_push_queued := v_user_push_queued + 1;
                        v_push_deliveries := v_push_deliveries + 1;
                        IF v_resume_at IS NOT NULL THEN
                            v_deferred_quiet_hours := v_deferred_quiet_hours + 1;
                        END IF;
                    END IF;
                END LOOP;
            END IF;
        END IF;

        -- Independent In-App Inbox Entry (created even when user has 0 active push endpoints)
        IF v_allow_in_app THEN
            IF v_first_delivery_id IS NULL THEN
                -- Create tracked in_app delivery row for telemetry ownership & attribution
                INSERT INTO public.notification_deliveries (
                    campaign_id, recipient_type, recipient_id, endpoint_id, channel_type,
                    delivery_status
                )
                VALUES (
                    v_camp.id, 'user', v_recipient.user_id, NULL, 'in_app',
                    'pending'
                )
                RETURNING id INTO v_delivery_id;

                v_first_delivery_id := v_delivery_id;
                v_in_app_deliveries := v_in_app_deliveries + 1;
            END IF;

            INSERT INTO public.user_notifications (
                user_id, campaign_id, delivery_id, category, title, body, action_url, image_url, metadata
            )
            VALUES (
                v_recipient.user_id,
                v_camp.id,
                v_first_delivery_id,
                v_camp.category,
                v_camp.title,
                v_camp.body,
                v_camp.action_url,
                v_camp.image_url,
                COALESCE(v_camp.target_criteria, '{}'::jsonb)
            )
            ON CONFLICT (user_id, campaign_id) WHERE campaign_id IS NOT NULL DO NOTHING;
        END IF;

        IF v_user_push_queued > 0 OR v_allow_in_app THEN
            v_total_recipients := v_total_recipients + 1;
        END IF;
    END LOOP;

    v_final_status := CASE WHEN v_total_recipients > 0 THEN 'queued' ELSE 'completed' END;

    -- Persist batch-0 audit record in retired notification_queue ledger
    v_queue_key := COALESCE(v_idempotency_key, 'camp_' || v_camp.id::text);
    INSERT INTO public.notification_queue (
        campaign_id, idempotency_key, batch_index, payload, status, run_at
    )
    VALUES (
        v_camp.id,
        v_queue_key,
        0,
        jsonb_build_object(
            'campaign_id', v_camp.id,
            'total_recipients', v_total_recipients,
            'push_deliveries', v_push_deliveries,
            'in_app_deliveries', v_in_app_deliveries
        ),
        CASE WHEN v_total_recipients > 0 THEN 'pending' ELSE 'completed' END,
        NOW()
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    UPDATE public.notification_campaigns
    SET total_recipients = v_total_recipients,
        status = v_final_status,
        sent_at = COALESCE(sent_at, NOW()),
        completed_at = CASE WHEN v_final_status = 'completed' THEN NOW() ELSE NULL END,
        updated_at = NOW()
    WHERE id = v_camp.id;

    RETURN jsonb_build_object(
        'campaign_id', v_camp.id,
        'status', v_final_status,
        'total_recipients', v_total_recipients,
        'push_deliveries', v_push_deliveries,
        'in_app_deliveries', v_in_app_deliveries,
        'deferred_quiet_hours', v_deferred_quiet_hours,
        'suppressed_daily_cap', v_suppressed_daily_cap
    );
END;
$$;

REVOKE ALL ON FUNCTION public._materialize_notification_campaign(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._materialize_notification_campaign(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Updated ingest_notification_campaign (Preserves Exact Signature & Legacy Contract)
-- ----------------------------------------------------------------------------
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
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_is_service boolean;
    v_is_admin boolean;
    v_criteria jsonb;
    v_target_type text;
    v_is_draft boolean;
    v_idempotency_key text;
    v_existing_campaign record;
    v_campaign_id uuid;
    v_mat_result jsonb;
    v_actor_id uuid;
    v_actor_role text;
BEGIN
    -- Authorization Guard: Only service_role or server-verified admin_users may ingest campaigns
    v_is_service := (current_user IN ('postgres', 'supabase_admin') OR auth.role() = 'service_role');
    v_is_admin := public.notifications_is_admin();

    IF NOT v_is_service AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Forbidden: Administrator or service_role privileges required to ingest campaigns' USING ERRCODE = 'MV403';
    END IF;

    -- Input Length Validation Guards
    IF p_title IS NULL OR length(trim(p_title)) < 1 OR length(trim(p_title)) > 255 THEN
        RAISE EXCEPTION 'Title must be between 1 and 255 characters' USING ERRCODE = 'MV400';
    END IF;

    IF p_body IS NULL OR length(trim(p_body)) < 1 OR length(trim(p_body)) > 1000 THEN
        RAISE EXCEPTION 'Body must be between 1 and 1000 characters' USING ERRCODE = 'MV400';
    END IF;

    v_criteria := COALESCE(p_target_criteria, '{}'::jsonb);
    v_target_type := COALESCE(NULLIF(trim(v_criteria->>'type'), ''), 'all');
    v_is_draft := COALESCE((v_criteria->>'is_draft')::boolean, false);
    v_idempotency_key := NULLIF(trim(COALESCE(v_criteria->>'idempotency_key', '')), '');

    -- Idempotency Deduplication across both notification_queue and notification_campaigns
    IF v_idempotency_key IS NOT NULL THEN
        SELECT c.id, c.status, c.total_recipients INTO v_existing_campaign
        FROM public.notification_queue q
        JOIN public.notification_campaigns c ON c.id = q.campaign_id
        WHERE q.idempotency_key = v_idempotency_key
        LIMIT 1;

        IF NOT FOUND THEN
            SELECT c.id, c.status, c.total_recipients INTO v_existing_campaign
            FROM public.notification_campaigns c
            WHERE c.target_criteria->>'idempotency_key' = v_idempotency_key
              AND c.status != 'cancelled'
            LIMIT 1;
        END IF;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'campaign_id', v_existing_campaign.id,
                'status', v_existing_campaign.status,
                'total_recipients', v_existing_campaign.total_recipients,
                'already_exists', true
            );
        END IF;
    END IF;

    v_actor_id := COALESCE(p_created_by, auth.uid());
    v_actor_role := CASE WHEN v_is_service THEN 'service_role' ELSE 'admin' END;

    -- Create Campaign Record (category and target_type constraints validated by PostgreSQL CHECK)
    INSERT INTO public.notification_campaigns (
        title, body, category, action_url, image_url,
        target_type, target_criteria, status, scheduled_for, created_by
    )
    VALUES (
        trim(p_title),
        trim(p_body),
        p_category,
        p_url,
        p_image_url,
        v_target_type,
        v_criteria,
        CASE
            WHEN v_is_draft THEN 'draft'
            WHEN p_scheduled_for IS NOT NULL AND p_scheduled_for > NOW() THEN 'scheduled'
            ELSE 'processing'
        END,
        p_scheduled_for,
        v_actor_id
    )
    RETURNING id INTO v_campaign_id;

    -- Draft Isolation: Store metadata only
    IF v_is_draft THEN
        INSERT INTO public.notification_audit_log (actor_id, actor_role, action, entity_type, entity_id, details)
        VALUES (v_actor_id, v_actor_role, 'campaign_draft_created', 'notification_campaign', v_campaign_id::text, jsonb_build_object('category', p_category));

        RETURN jsonb_build_object(
            'campaign_id', v_campaign_id,
            'status', 'draft',
            'total_recipients', 0,
            'already_exists', false
        );
    END IF;

    -- Future Scheduled Isolation: Store campaign without materializing deliveries until scheduled_for
    IF p_scheduled_for IS NOT NULL AND p_scheduled_for > NOW() THEN
        INSERT INTO public.notification_audit_log (actor_id, actor_role, action, entity_type, entity_id, details)
        VALUES (
            v_actor_id, v_actor_role, 'campaign_scheduled', 'notification_campaign', v_campaign_id::text,
            jsonb_build_object('category', p_category, 'scheduled_for', p_scheduled_for)
        );

        RETURN jsonb_build_object(
            'campaign_id', v_campaign_id,
            'status', 'scheduled',
            'scheduled_for', p_scheduled_for,
            'total_recipients', 0,
            'already_exists', false
        );
    END IF;

    -- Immediate Materialization
    v_mat_result := public._materialize_notification_campaign(v_campaign_id);

    INSERT INTO public.notification_audit_log (actor_id, actor_role, action, entity_type, entity_id, details)
    VALUES (
        v_actor_id, v_actor_role, 'campaign_ingested', 'notification_campaign', v_campaign_id::text,
        v_mat_result || jsonb_build_object('category', p_category, 'target_type', v_target_type)
    );

    RETURN v_mat_result || jsonb_build_object('already_exists', false);
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_notification_campaign(text, text, text, text, text, jsonb, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ingest_notification_campaign(text, text, text, text, text, jsonb, timestamptz, uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Scheduled Campaign Promotion RPC (Worker-Only / Service Role)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_due_scheduled_campaigns(
    p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_is_service boolean;
    v_limit integer;
    v_camp record;
    v_mat_result jsonb;
    v_promoted integer := 0;
    v_promoted_campaigns jsonb := '[]'::jsonb;
BEGIN
    v_is_service := (current_user IN ('postgres', 'supabase_admin') OR auth.role() = 'service_role');
    IF NOT v_is_service THEN
        RAISE EXCEPTION 'Forbidden: service_role required to promote scheduled campaigns' USING ERRCODE = 'MV403';
    END IF;

    v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));

    FOR v_camp IN
        SELECT c.id, c.category, c.target_type, c.scheduled_for
        FROM public.notification_campaigns c
        WHERE c.status = 'scheduled'
          AND c.scheduled_for IS NOT NULL
          AND c.scheduled_for <= NOW()
        ORDER BY c.scheduled_for ASC, c.created_at ASC
        LIMIT v_limit
        FOR UPDATE SKIP LOCKED
    LOOP
        v_mat_result := public._materialize_notification_campaign(v_camp.id);

        INSERT INTO public.notification_audit_log (
            actor_id, actor_role, action, entity_type, entity_id, details
        )
        VALUES (
            NULL,
            'service_role',
            'campaign_scheduled_promoted',
            'notification_campaign',
            v_camp.id::text,
            v_mat_result || jsonb_build_object(
                'scheduled_for', v_camp.scheduled_for,
                'category', v_camp.category,
                'target_type', v_camp.target_type
            )
        );

        v_promoted := v_promoted + 1;
        v_promoted_campaigns := v_promoted_campaigns || jsonb_build_array(v_mat_result);
    END LOOP;

    RETURN jsonb_build_object(
        'promoted_count', v_promoted,
        'campaigns', v_promoted_campaigns
    );
END;
$$;

REVOKE ALL ON FUNCTION public.promote_due_scheduled_campaigns(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_due_scheduled_campaigns(integer) TO service_role;

-- ----------------------------------------------------------------------------
-- 6. Welcome Notification RPC & Auth Trigger (Strictly One Per Account)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_welcome_notification(
    p_user_id uuid,
    p_source text DEFAULT 'api'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_is_service boolean;
    v_user record;
    v_pref record;
    v_has_pref boolean := false;
    v_welcome_campaign_id uuid := '00000000-0000-4000-8000-000000000001'::uuid;
    v_title text := 'Welcome to MovieVerify!';
    v_body text := 'Track upcoming releases, subscribe to your favorite series, and manage your alert channels anytime.';
    v_action_url text := '/?section=notifications';
    v_dispatch_row record;
    v_notification_id uuid;
    v_in_app_delivery_id uuid;
    v_push_queued integer := 0;
    v_endpoint record;
    v_valid_tz text;
    v_resume_at timestamptz;
    v_daily_push_count integer := 0;
    v_remaining_budget integer := 5;
BEGIN
    v_is_service := (current_user IN ('postgres', 'supabase_admin') OR auth.role() = 'service_role');
    IF NOT v_is_service THEN
        RAISE EXCEPTION 'Forbidden: service_role required to issue welcome notification' USING ERRCODE = 'MV403';
    END IF;

    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('created', false, 'reason', 'missing_user_id');
    END IF;

    SELECT id, created_at INTO v_user
    FROM auth.users
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('created', false, 'reason', 'user_not_found');
    END IF;

    -- Idempotent first-claim guard: exactly one row allowed per user_id
    INSERT INTO public.user_welcome_dispatches (
        user_id, status, source
    )
    VALUES (
        p_user_id, 'created', COALESCE(NULLIF(trim(p_source), ''), 'api')
    )
    ON CONFLICT (user_id) DO NOTHING
    RETURNING * INTO v_dispatch_row;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'created', false,
            'already_processed', true,
            'reason', 'welcome_already_processed'
        );
    END IF;

    SELECT * INTO v_pref
    FROM public.user_notification_preferences
    WHERE user_id = p_user_id
    LIMIT 1;
    v_has_pref := FOUND;

    -- Respect canonical user preferences & system category opt-outs
    IF NOT public.is_category_allowed_by_preferences(p_user_id, 'system', 'users', NULL) THEN
        UPDATE public.user_welcome_dispatches
        SET status = 'suppressed_preferences',
            suppressed_reason = 'opt_in_all_or_notify_system_disabled'
        WHERE user_id = p_user_id;

        RETURN jsonb_build_object(
            'created', false,
            'already_processed', false,
            'reason', 'suppressed_preferences'
        );
    END IF;

    IF v_has_pref AND NOT COALESCE(v_pref.channel_in_app, true) AND NOT COALESCE(v_pref.channel_push, true) THEN
        UPDATE public.user_welcome_dispatches
        SET status = 'suppressed_channel',
            suppressed_reason = 'in_app_and_push_channels_disabled'
        WHERE user_id = p_user_id;

        RETURN jsonb_build_object(
            'created', false,
            'already_processed', false,
            'reason', 'suppressed_channel'
        );
    END IF;

    -- Ensure canonical internal system welcome campaign exists for telemetry & inbox deduplication
    INSERT INTO public.notification_campaigns (
        id, title, body, category, action_url, target_type, target_criteria, status, completed_at
    )
    VALUES (
        v_welcome_campaign_id,
        v_title,
        v_body,
        'system',
        v_action_url,
        'individual',
        '{"system_template":"welcome_v1"}'::jsonb,
        'completed',
        NOW()
    )
    ON CONFLICT (id) DO NOTHING;

    -- Create tracked delivery row if in_app is enabled (or push endpoints exist)
    IF COALESCE(v_pref.channel_in_app, true) THEN
        INSERT INTO public.notification_deliveries (
            campaign_id, recipient_type, recipient_id, endpoint_id, channel_type, delivery_status
        )
        VALUES (
            v_welcome_campaign_id, 'user', p_user_id, NULL, 'in_app', 'pending'
        )
        RETURNING id INTO v_in_app_delivery_id;

        INSERT INTO public.user_notifications (
            user_id, campaign_id, delivery_id, category, title, body, action_url, metadata
        )
        VALUES (
            p_user_id,
            v_welcome_campaign_id,
            v_in_app_delivery_id,
            'system',
            v_title,
            v_body,
            v_action_url,
            jsonb_build_object('event_type', 'welcome', 'source', COALESCE(NULLIF(trim(p_source), ''), 'api'))
        )
        ON CONFLICT (user_id, campaign_id) WHERE campaign_id IS NOT NULL DO NOTHING
        RETURNING id INTO v_notification_id;
    END IF;

    -- Optional push enqueue if user already has an active device endpoint & push channel allowed
    IF COALESCE(v_pref.channel_push, true) THEN
        v_valid_tz := public.resolve_valid_timezone(COALESCE(v_pref.quiet_hours_tz, 'UTC'));
        v_resume_at := public.compute_quiet_hours_resume_at(
            COALESCE(v_pref.quiet_hours_enabled, false),
            v_pref.quiet_hours_start,
            v_pref.quiet_hours_end,
            v_valid_tz,
            NOW()
        );

        SELECT count(*)::integer INTO v_daily_push_count
        FROM public.notification_deliveries d
        WHERE d.recipient_id = p_user_id
          AND d.channel_type IN ('fcm', 'web_push')
          AND d.delivery_status IN ('pending', 'leased', 'sent', 'delivered')
          AND (d.created_at AT TIME ZONE v_valid_tz)::date = (NOW() AT TIME ZONE v_valid_tz)::date;

        v_remaining_budget := GREATEST(0, COALESCE(v_pref.max_daily_push, 5) - v_daily_push_count);

        FOR v_endpoint IN
            SELECT ne.id, ne.channel_type
            FROM public.notification_endpoints ne
            WHERE ne.user_id = p_user_id
              AND ne.is_active = true
              AND ne.revoked_at IS NULL
              AND ne.channel_type IN ('fcm', 'web_push')
            ORDER BY ne.last_seen_at DESC NULLS LAST, ne.created_at DESC
        LOOP
            EXIT WHEN v_push_queued >= v_remaining_budget;
            INSERT INTO public.notification_deliveries (
                campaign_id, recipient_type, recipient_id, endpoint_id, channel_type, delivery_status, next_retry_at
            )
            VALUES (
                v_welcome_campaign_id, 'user', p_user_id, v_endpoint.id, v_endpoint.channel_type, 'pending', v_resume_at
            )
            ON CONFLICT (campaign_id, endpoint_id) DO NOTHING;

            v_push_queued := v_push_queued + 1;
        END LOOP;
    END IF;

    UPDATE public.user_welcome_dispatches
    SET notification_id = v_notification_id,
        delivery_id = v_in_app_delivery_id
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object(
        'created', (v_notification_id IS NOT NULL OR v_push_queued > 0),
        'notification_id', v_notification_id,
        'delivery_id', v_in_app_delivery_id,
        'push_queued', v_push_queued
    );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_welcome_notification(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_welcome_notification(uuid, text) TO service_role;

-- Trigger helper for genuine new Supabase auth.users registration (handles Email & OAuth signup)
CREATE OR REPLACE FUNCTION public.trg_auth_user_welcome_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    PERFORM public.issue_welcome_notification(NEW.id, 'auth_trigger');
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Never fail account registration if welcome notification creation errors
    RAISE WARNING 'Welcome notification creation failed for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_auth_user_welcome_notification() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    DROP TRIGGER IF EXISTS trg_movieverify_welcome_on_signup ON auth.users;
    CREATE TRIGGER trg_movieverify_welcome_on_signup
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.trg_auth_user_welcome_notification();
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Insufficient privilege to attach trigger on auth.users; /api/notifications/welcome will handle first-login welcome issuance.';
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Hardened Telemetry Recording (In-App State Transition & Client Failure Metrics)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_notification_telemetry(uuid, uuid, varchar, uuid, varchar, varchar, timestamptz, jsonb);

CREATE OR REPLACE FUNCTION public.record_notification_telemetry(
    p_delivery_id uuid,
    p_campaign_id uuid,
    p_recipient_type varchar(16),
    p_recipient_id uuid,
    p_event_type varchar(32),
    p_event_nonce varchar(64),
    p_client_timestamp timestamptz DEFAULT NULL,
    p_client_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_is_service boolean;
    v_delivery record;
    v_inserted_id uuid;
    v_camp_id uuid;
BEGIN
    v_is_service := (current_user IN ('postgres', 'supabase_admin') OR auth.role() = 'service_role');
    IF NOT v_is_service THEN
        RAISE EXCEPTION 'Forbidden: Telemetry RPC requires trusted server role (use /api/notifications/telemetry)' USING ERRCODE = 'MV403';
    END IF;

    IF p_client_metadata IS NOT NULL AND length(p_client_metadata::text) > 4096 THEN
        RAISE EXCEPTION 'Client metadata exceeds 4KB payload boundary' USING ERRCODE = 'MV400';
    END IF;

    SELECT * INTO v_delivery
    FROM public.notification_deliveries
    WHERE id = p_delivery_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'reason', 'DELIVERY_NOT_FOUND');
    END IF;

    v_camp_id := COALESCE(p_campaign_id, v_delivery.campaign_id);

    IF v_camp_id IS DISTINCT FROM v_delivery.campaign_id
       OR p_recipient_type IS DISTINCT FROM v_delivery.recipient_type
       OR p_recipient_id IS DISTINCT FROM v_delivery.recipient_id THEN
        RAISE EXCEPTION 'Telemetry recipient or campaign mismatch with delivery record' USING ERRCODE = 'MV403';
    END IF;

    -- Insert telemetry (agreement trigger + unique nonce constraint provide DB-level defense)
    INSERT INTO public.notification_telemetry (
        delivery_id, campaign_id, recipient_type, recipient_id,
        event_type, event_nonce, client_timestamp, client_metadata
    )
    VALUES (
        p_delivery_id, v_camp_id, p_recipient_type, p_recipient_id,
        p_event_type, p_event_nonce, p_client_timestamp, COALESCE(p_client_metadata, '{}'::jsonb)
    )
    ON CONFLICT (delivery_id, event_type, event_nonce) DO NOTHING
    RETURNING id INTO v_inserted_id;

    -- Transition in-app delivery from 'pending' -> 'delivered' on view/open/click so cancelled
    -- unread campaigns remain hidden while already-viewed alerts stay in the user inbox.
    IF v_inserted_id IS NOT NULL AND v_camp_id IS NOT NULL THEN
        IF v_delivery.channel_type = 'in_app'
           AND v_delivery.delivery_status = 'pending'
           AND p_event_type IN ('displayed', 'opened', 'clicked') THEN
            UPDATE public.notification_deliveries
            SET delivery_status = 'delivered',
                delivered_at = COALESCE(delivered_at, NOW()),
                updated_at = NOW()
            WHERE id = p_delivery_id
              AND delivery_status = 'pending';
        END IF;

        IF p_event_type IN ('opened', 'displayed') THEN
            UPDATE public.notification_campaigns
            SET open_count = open_count + 1, updated_at = NOW()
            WHERE id = v_camp_id;
        ELSIF p_event_type = 'clicked' THEN
            UPDATE public.notification_campaigns
            SET click_count = click_count + 1, updated_at = NOW()
            WHERE id = v_camp_id;
        ELSIF p_event_type = 'client_failed' THEN
            UPDATE public.notification_campaigns
            SET failure_count = failure_count + 1, updated_at = NOW()
            WHERE id = v_camp_id;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'recorded', (v_inserted_id IS NOT NULL),
        'telemetry_id', v_inserted_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_notification_telemetry(uuid, uuid, varchar, uuid, varchar, varchar, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_notification_telemetry(uuid, uuid, varchar, uuid, varchar, varchar, timestamptz, jsonb) TO service_role;

