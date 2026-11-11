-- ============================================================================
-- Migration: 20261111150000_smart_notification_critical_remediation.sql
-- Description: Phase 5.4 Smart Notification Critical Security & Runtime Remediation
--   Forward-only fixes for every Critical and High finding from Phase 5.3:
--   - C-1: Deduplicate & create partial unique indexes on public.notification_deliveries
--          and update ON CONFLICT predicates (preserving multiple in_app NULL endpoints)
--   - C-2: Replace unsafe current_user checks in SECURITY DEFINER RPCs with
--          B5E-aligned auth.role()/session_user checks across ingest_notification_campaign,
--          promote_due_scheduled_campaigns, issue_welcome_notification,
--          record_notification_telemetry, and B5D cancel_notification_campaign;
--          prevent p_created_by spoofing; split internal auth.users welcome helper
--   - C-3: Add delivered_at column on notification_deliveries & fix telemetry transition
--   - H-1: Keep shared welcome campaign status='queued' (respecting admin cancellation)
--          so welcome push deliveries clear B5E status/dispatch_attempt_id gating
--   - H-2: Serialize per-user daily push budget checks with deterministic ORDER BY user_id
--   - H-3: Serialize campaign idempotency_key via advisory lock + partial unique index
--   - H-4: Enforce campaign-first, delivery-second lock ordering in telemetry RPC
--   - H-5: Add ne.revocation_reason IS NULL to all endpoint eligibility queries
--   - Extra: Multi-season movie_notify_requests uniqueness (season_scope), accurate
--            in-app-only 'completed' status, dedicated in_app delivery rows for
--            deferred-push inbox cancellation safety, legacy TV matching for season,
--            and accurate welcome suppressed_channel state
-- Target: PostgreSQL 17 / Supabase
-- Security Baseline: Preserves B5D & B5E intact without altering prior migrations
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. C-3: Additive Schema Column for Delivery Acknowledgement Timing
-- ----------------------------------------------------------------------------
ALTER TABLE public.notification_deliveries
ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- ----------------------------------------------------------------------------
-- 2. C-1: Clean Existing Duplicates & Create Partial Unique Indexes on notification_deliveries
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_dup_group record;
    v_removed_push integer := 0;
    v_removed_in_app integer := 0;
    v_telemetry_repointed integer := 0;
    v_telemetry_collision_count integer := 0;
BEGIN
    -- 2A. Deduplicate any existing push rows sharing (campaign_id, endpoint_id)
    --     Preserve all historical telemetry and reject ambiguous recipient attribution.
    FOR v_dup_group IN
        SELECT
            campaign_id,
            endpoint_id,
            (ARRAY_AGG(id ORDER BY
                CASE delivery_status
                    WHEN 'delivered' THEN 1
                    WHEN 'sent' THEN 2
                    WHEN 'leased' THEN 3
                    WHEN 'pending' THEN 4
                    ELSE 5
                END,
                created_at ASC,
                id ASC
            ))[1] AS keep_id,
            ARRAY_AGG(id) AS all_ids,
            ARRAY_AGG(DISTINCT (recipient_type || ':' || COALESCE(recipient_id::text, '<NULL>'))) AS recipient_sigs
        FROM public.notification_deliveries
        WHERE endpoint_id IS NOT NULL
        GROUP BY campaign_id, endpoint_id
        HAVING count(*) > 1
    LOOP
        IF COALESCE(array_length(v_dup_group.recipient_sigs, 1), 0) > 1 THEN
            RAISE EXCEPTION 'Ambiguous recipient attribution across duplicate deliveries for campaign %, endpoint % (%); manual reconciliation required before deduplication',
                v_dup_group.campaign_id, v_dup_group.endpoint_id, array_to_string(v_dup_group.recipient_sigs, ', ')
                USING ERRCODE = 'MV409';
        END IF;

        SELECT count(*) INTO v_telemetry_collision_count
        FROM (
            SELECT t.event_type, t.event_nonce
            FROM public.notification_telemetry t
            WHERE t.delivery_id = ANY(v_dup_group.all_ids)
            GROUP BY t.event_type, t.event_nonce
            HAVING count(*) > 1
        ) collisions;

        IF v_telemetry_collision_count > 0 THEN
            RAISE EXCEPTION 'Telemetry (event_type, event_nonce) collision detected across duplicate deliveries for campaign %, endpoint % (keep_id %); refusing silent cascade deletion',
                v_dup_group.campaign_id, v_dup_group.endpoint_id, v_dup_group.keep_id
                USING ERRCODE = 'MV409';
        END IF;

        UPDATE public.notification_telemetry
        SET delivery_id = v_dup_group.keep_id
        WHERE delivery_id = ANY(v_dup_group.all_ids)
          AND delivery_id IS DISTINCT FROM v_dup_group.keep_id;

        GET DIAGNOSTICS v_telemetry_repointed = ROW_COUNT;

        UPDATE public.user_notifications
        SET delivery_id = v_dup_group.keep_id
        WHERE delivery_id = ANY(v_dup_group.all_ids)
          AND delivery_id IS DISTINCT FROM v_dup_group.keep_id;

        UPDATE public.user_welcome_dispatches
        SET delivery_id = v_dup_group.keep_id
        WHERE delivery_id = ANY(v_dup_group.all_ids)
          AND delivery_id IS DISTINCT FROM v_dup_group.keep_id;

        IF EXISTS (
            SELECT 1 FROM public.notification_telemetry
            WHERE delivery_id = ANY(v_dup_group.all_ids)
              AND delivery_id IS DISTINCT FROM v_dup_group.keep_id
        ) THEN
            RAISE EXCEPTION 'Telemetry rows still reference duplicate delivery IDs for campaign %, endpoint %',
                v_dup_group.campaign_id, v_dup_group.endpoint_id
                USING ERRCODE = 'MV409';
        END IF;

        DELETE FROM public.notification_deliveries
        WHERE id = ANY(v_dup_group.all_ids)
          AND id != v_dup_group.keep_id;

        v_removed_push := v_removed_push + (array_length(v_dup_group.all_ids, 1) - 1);
    END LOOP;

    -- 2B. Deduplicate any existing duplicate in_app rows sharing (campaign_id, recipient_id)
    FOR v_dup_group IN
        SELECT
            campaign_id,
            recipient_id,
            (ARRAY_AGG(id ORDER BY
                CASE delivery_status
                    WHEN 'delivered' THEN 1
                    WHEN 'sent' THEN 2
                    WHEN 'pending' THEN 3
                    ELSE 4
                END,
                created_at ASC,
                id ASC
            ))[1] AS keep_id,
            ARRAY_AGG(id) AS all_ids,
            ARRAY_AGG(DISTINCT (recipient_type || ':' || COALESCE(recipient_id::text, '<NULL>'))) AS recipient_sigs
        FROM public.notification_deliveries
        WHERE channel_type = 'in_app'
          AND recipient_id IS NOT NULL
        GROUP BY campaign_id, recipient_id
        HAVING count(*) > 1
    LOOP
        IF COALESCE(array_length(v_dup_group.recipient_sigs, 1), 0) > 1 THEN
            RAISE EXCEPTION 'Ambiguous recipient attribution across duplicate in_app deliveries for campaign %, recipient %',
                v_dup_group.campaign_id, v_dup_group.recipient_id
                USING ERRCODE = 'MV409';
        END IF;

        SELECT count(*) INTO v_telemetry_collision_count
        FROM (
            SELECT t.event_type, t.event_nonce
            FROM public.notification_telemetry t
            WHERE t.delivery_id = ANY(v_dup_group.all_ids)
            GROUP BY t.event_type, t.event_nonce
            HAVING count(*) > 1
        ) collisions;

        IF v_telemetry_collision_count > 0 THEN
            RAISE EXCEPTION 'Telemetry (event_type, event_nonce) collision detected across duplicate in_app deliveries for campaign %, recipient % (keep_id %); refusing silent cascade deletion',
                v_dup_group.campaign_id, v_dup_group.recipient_id, v_dup_group.keep_id
                USING ERRCODE = 'MV409';
        END IF;

        UPDATE public.notification_telemetry
        SET delivery_id = v_dup_group.keep_id
        WHERE delivery_id = ANY(v_dup_group.all_ids)
          AND delivery_id IS DISTINCT FROM v_dup_group.keep_id;

        UPDATE public.user_notifications
        SET delivery_id = v_dup_group.keep_id
        WHERE delivery_id = ANY(v_dup_group.all_ids)
          AND delivery_id IS DISTINCT FROM v_dup_group.keep_id;

        UPDATE public.user_welcome_dispatches
        SET delivery_id = v_dup_group.keep_id
        WHERE delivery_id = ANY(v_dup_group.all_ids)
          AND delivery_id IS DISTINCT FROM v_dup_group.keep_id;

        DELETE FROM public.notification_deliveries
        WHERE id = ANY(v_dup_group.all_ids)
          AND id != v_dup_group.keep_id;

        v_removed_in_app := v_removed_in_app + (array_length(v_dup_group.all_ids, 1) - 1);
    END LOOP;

    IF v_removed_push > 0 OR v_removed_in_app > 0 THEN
        RAISE NOTICE 'Deduplicated % push and % in_app rows in public.notification_deliveries (telemetry preserved)', v_removed_push, v_removed_in_app;
    END IF;
END;
$$;

-- Preserves unlimited multiple NULL endpoint_id ('in_app') deliveries per campaign across recipients
CREATE UNIQUE INDEX IF NOT EXISTS uq_deliveries_campaign_endpoint
ON public.notification_deliveries (campaign_id, endpoint_id)
WHERE endpoint_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_deliveries_campaign_user_in_app
ON public.notification_deliveries (campaign_id, recipient_id)
WHERE channel_type = 'in_app' AND recipient_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. H-3: Deduplicate & Enforce Unique Active Campaign Idempotency Keys
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_dup_camp record;
BEGIN
    FOR v_dup_camp IN
        SELECT
            NULLIF(trim(target_criteria->>'idempotency_key'), '') AS idem_key,
            (ARRAY_AGG(id ORDER BY created_at ASC, id ASC))[1] AS keep_id,
            ARRAY_AGG(id) AS all_ids
        FROM public.notification_campaigns
        WHERE status != 'cancelled'
          AND NULLIF(trim(target_criteria->>'idempotency_key'), '') IS NOT NULL
        GROUP BY NULLIF(trim(target_criteria->>'idempotency_key'), '')
        HAVING count(*) > 1
    LOOP
        UPDATE public.notification_campaigns
        SET status = 'cancelled',
            cancelled_at = COALESCE(cancelled_at, NOW()),
            updated_at = NOW()
        WHERE id = ANY(v_dup_camp.all_ids)
          AND id != v_dup_camp.keep_id
          AND status != 'cancelled';
    END LOOP;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaigns_active_idempotency_key
ON public.notification_campaigns ((NULLIF(trim(target_criteria->>'idempotency_key'), '')))
WHERE status != 'cancelled' AND NULLIF(trim(target_criteria->>'idempotency_key'), '') IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. Multi-Season Subscription Uniqueness (movie_notify_requests & sync trigger)
-- ----------------------------------------------------------------------------
ALTER TABLE public.movie_notify_requests
ADD COLUMN IF NOT EXISTS season_scope integer NOT NULL DEFAULT 0;

UPDATE public.movie_notify_requests
SET season_scope = COALESCE(target_season, 0)
WHERE season_scope IS DISTINCT FROM COALESCE(target_season, 0);

DO $$
DECLARE
    v_dup_sub record;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_movie_notify_season_scope'
          AND conrelid = 'public.movie_notify_requests'::regclass
    ) THEN
        ALTER TABLE public.movie_notify_requests
        ADD CONSTRAINT chk_movie_notify_season_scope
        CHECK (season_scope >= 0);
    END IF;

    -- Clean any pre-existing duplicate (user_id, movie_id, season_scope) before creating constraint
    FOR v_dup_sub IN
        SELECT
            user_id,
            movie_id,
            season_scope,
            (ARRAY_AGG(id ORDER BY created_at ASC, id ASC))[1] AS keep_id,
            ARRAY_AGG(id) AS all_ids
        FROM public.movie_notify_requests
        GROUP BY user_id, movie_id, season_scope
        HAVING count(*) > 1
    LOOP
        DELETE FROM public.movie_notify_requests
        WHERE id = ANY(v_dup_sub.all_ids)
          AND id != v_dup_sub.keep_id;
    END LOOP;

    ALTER TABLE public.movie_notify_requests
    DROP CONSTRAINT IF EXISTS uq_movie_user;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'uq_movie_user_season'
          AND conrelid = 'public.movie_notify_requests'::regclass
    ) THEN
        ALTER TABLE public.movie_notify_requests
        ADD CONSTRAINT uq_movie_user_season UNIQUE (user_id, movie_id, season_scope);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_movie_notify_set_season_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF NEW.target_season IS NOT NULL AND NEW.target_season > 0 THEN
        NEW.season_scope := NEW.target_season;
    ELSE
        NEW.target_season := NULL;
        NEW.season_scope := 0;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_movie_notify_set_season_scope() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_movie_notify_season_scope ON public.movie_notify_requests;
CREATE TRIGGER trg_movie_notify_season_scope
BEFORE INSERT OR UPDATE ON public.movie_notify_requests
FOR EACH ROW EXECUTE FUNCTION public.trg_movie_notify_set_season_scope();

-- Replace canonical sync trigger so multi-season rows for the same show never clobber sibling seasons
CREATE OR REPLACE FUNCTION public.trg_sync_movie_to_canonical()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_entity_type varchar(16);
    v_entity_id varchar(64);
    v_old_entity_type varchar(16);
    v_old_entity_id varchar(64);
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

        -- Remove ONLY this row's prior canonical mapping if target changed
        IF TG_OP = 'UPDATE' THEN
            IF OLD.target_season IS NOT NULL AND OLD.target_season > 0 THEN
                v_old_entity_type := 'season';
                v_old_entity_id := OLD.movie_id || ':s' || OLD.target_season::text;
            ELSIF LOWER(COALESCE(OLD.media_type, 'movie')) IN ('tv', 'series') THEN
                v_old_entity_type := 'series';
                v_old_entity_id := OLD.movie_id;
            ELSE
                v_old_entity_type := 'movie';
                v_old_entity_id := OLD.movie_id;
            END IF;

            IF v_old_entity_type IS DISTINCT FROM v_entity_type OR v_old_entity_id IS DISTINCT FROM v_entity_id THEN
                DELETE FROM public.notification_subscriptions
                WHERE user_id = OLD.user_id
                  AND entity_type = v_old_entity_type
                  AND entity_id = v_old_entity_id;
            END IF;
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
        IF OLD.target_season IS NOT NULL AND OLD.target_season > 0 THEN
            v_old_entity_type := 'season';
            v_old_entity_id := OLD.movie_id || ':s' || OLD.target_season::text;
        ELSIF LOWER(COALESCE(OLD.media_type, 'movie')) IN ('tv', 'series') THEN
            v_old_entity_type := 'series';
            v_old_entity_id := OLD.movie_id;
        ELSE
            v_old_entity_type := 'movie';
            v_old_entity_id := OLD.movie_id;
        END IF;

        DELETE FROM public.notification_subscriptions
        WHERE user_id = OLD.user_id
          AND entity_type = v_old_entity_type
          AND entity_id = v_old_entity_id;
        RETURN OLD;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_sync_movie_to_canonical() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. H-1: Heal Existing System Welcome Campaign Status Without Re-Opening Cancelled State
-- ----------------------------------------------------------------------------
UPDATE public.notification_campaigns
SET status = 'queued',
    completed_at = NULL,
    updated_at = NOW()
WHERE id = '00000000-0000-4000-8000-000000000001'::uuid
  AND status = 'completed';

-- ----------------------------------------------------------------------------
-- 6. C-2 (B5D Forward-Only Fix): Harden cancel_notification_campaign Auth Guard
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_notification_campaign(
    p_campaign_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_is_service boolean;
    v_is_admin boolean;
    v_campaign record;
    v_cancelled_deliveries integer := 0;
    v_actor_id uuid;
    v_actor_role text;
BEGIN
    -- Verify caller via auth.role(), session_user, or admin membership (never current_user)
    v_is_service := (
        COALESCE(auth.role(), '') = 'service_role'
        OR (auth.role() IS NULL AND session_user IN ('postgres', 'supabase_admin'))
    );
    v_is_admin := public.notifications_is_admin();

    IF NOT v_is_service AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Forbidden: Administrator privileges required' USING ERRCODE = 'MV403';
    END IF;

    -- Step 1: Lock Campaign row FIRST FOR UPDATE (B5D lock hierarchy)
    SELECT * INTO v_campaign
    FROM public.notification_campaigns
    WHERE id = p_campaign_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'CAMPAIGN_NOT_FOUND', 'message', 'Campaign not found');
    END IF;

    IF v_campaign.status IN ('completed', 'cancelled') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'INVALID_CAMPAIGN_STATE',
            'message', 'Campaign is already ' || v_campaign.status
        );
    END IF;

    UPDATE public.notification_campaigns
    SET status = 'cancelled',
        cancelled_at = NOW(),
        updated_at = NOW()
    WHERE id = p_campaign_id;

    UPDATE public.notification_queue
    SET status = 'cancelled',
        updated_at = NOW()
    WHERE campaign_id = p_campaign_id AND status = 'pending';

    -- Step 2: Cancel pending and leased deliveries SECOND
    UPDATE public.notification_deliveries
    SET delivery_status = 'cancelled',
        lease_token = NULL,
        lease_expires_at = NULL,
        worker_id = NULL,
        dispatch_attempt_id = NULL,
        updated_at = NOW()
    WHERE campaign_id = p_campaign_id
      AND delivery_status IN ('pending', 'leased');

    GET DIAGNOSTICS v_cancelled_deliveries = ROW_COUNT;

    v_actor_id := CASE WHEN v_is_service AND NOT v_is_admin THEN NULL ELSE auth.uid() END;
    v_actor_role := CASE WHEN v_is_service AND NOT v_is_admin THEN 'service_role' ELSE 'admin' END;

    INSERT INTO public.notification_audit_log (actor_id, actor_role, action, entity_type, entity_id, details)
    VALUES (
        v_actor_id,
        v_actor_role,
        'campaign_cancelled',
        'notification_campaigns',
        p_campaign_id::text,
        jsonb_build_object('cancelled_deliveries', v_cancelled_deliveries)
    );

    RETURN jsonb_build_object(
        'success', true,
        'campaign_id', p_campaign_id,
        'cancelled_deliveries', v_cancelled_deliveries
    );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_notification_campaign(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_notification_campaign(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. Remediated _materialize_notification_campaign (C-1, H-2, H-5, Inbox & Season Fixes)
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
    v_in_app_delivery_id uuid;
    v_push_delivery_id uuid;
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

    -- Resolve eligible recipients in deterministic user_id order to guarantee deadlock-free per-user locking
    FOR v_recipient IN
        WITH candidate_users AS (
            SELECT DISTINCT u_id AS user_id
            FROM (
                -- 'all' broadcast: active, unrevoked push endpoints (H-5: include revocation_reason IS NULL)
                SELECT ne.user_id AS u_id
                FROM public.notification_endpoints ne
                WHERE v_target_type = 'all'
                  AND ne.is_active = true
                  AND ne.revoked_at IS NULL
                  AND ne.revocation_reason IS NULL
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

                SELECT ns.user_id AS u_id
                FROM public.notification_subscriptions ns
                WHERE v_target_type = 'movie'
                  AND ns.status = 'active'
                  AND ns.entity_type = 'movie'
                  AND ns.entity_id = v_movie_id

                UNION

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

                -- 'season' targets exact season subscribers, whole-series followers, and legacy TV rows
                SELECT ns.user_id AS u_id
                FROM public.notification_subscriptions ns
                WHERE v_target_type = 'season'
                  AND ns.status = 'active'
                  AND (
                      (v_season_number IS NOT NULL AND ns.entity_type = 'season' AND ns.entity_id = (v_series_id || ':s' || v_season_number::text))
                      OR (ns.entity_type = 'series' AND ns.entity_id = v_series_id)
                      OR (
                          ns.entity_type = 'movie'
                          AND ns.entity_id = v_series_id
                          AND COALESCE(ns.metadata->>'media_type', 'movie') IN ('tv', 'series')
                      )
                  )

                UNION

                SELECT ns.user_id AS u_id
                FROM public.notification_subscriptions ns
                WHERE v_target_type = 'actor'
                  AND ns.status = 'active'
                  AND ns.entity_type = 'actor'
                  AND ns.entity_id = (v_camp.target_criteria->>'actor_id')

                UNION

                SELECT ns.user_id AS u_id
                FROM public.notification_subscriptions ns
                WHERE v_target_type = 'genre'
                  AND ns.status = 'active'
                  AND ns.entity_type = 'genre'
                  AND ns.entity_id = (v_camp.target_criteria->>'genre_id')

                UNION

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
        ORDER BY cu.user_id ASC
    LOOP
        v_allow_in_app := v_recipient.channel_in_app;
        v_allow_push := v_recipient.channel_push;

        IF NOT v_allow_in_app AND NOT v_allow_push THEN
            CONTINUE;
        END IF;

        v_in_app_delivery_id := NULL;
        v_user_push_queued := 0;

        -- H-2: Serialize per-user daily push budget calculations cleanly across concurrent materializations
        IF v_allow_push THEN
            PERFORM pg_advisory_xact_lock(1001, hashtext(v_recipient.user_id::text));

            v_valid_tz := public.resolve_valid_timezone(v_recipient.quiet_hours_tz);
            v_resume_at := public.compute_quiet_hours_resume_at(
                v_recipient.quiet_hours_enabled,
                v_recipient.quiet_hours_start,
                v_recipient.quiet_hours_end,
                v_valid_tz,
                NOW()
            );

            SELECT count(*)::integer INTO v_daily_push_count
            FROM public.notification_deliveries d
            WHERE d.recipient_id = v_recipient.user_id
              AND d.channel_type IN ('fcm', 'web_push')
              AND d.delivery_status IN ('pending', 'leased', 'sent', 'delivered')
              AND (d.created_at AT TIME ZONE v_valid_tz)::date = (NOW() AT TIME ZONE v_valid_tz)::date;

            v_remaining_push_budget := GREATEST(0, v_recipient.max_daily_push - v_daily_push_count);

            IF v_remaining_push_budget <= 0 THEN
                IF EXISTS (
                    SELECT 1 FROM public.notification_endpoints ne
                    WHERE ne.user_id = v_recipient.user_id
                      AND ne.is_active = true
                      AND ne.revoked_at IS NULL
                      AND ne.revocation_reason IS NULL
                      AND ne.channel_type IN ('fcm', 'web_push')
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
                      AND ne.revocation_reason IS NULL
                      AND ne.channel_type IN ('fcm', 'web_push')
                    ORDER BY ne.last_seen_at DESC NULLS LAST, ne.created_at DESC
                LOOP
                    EXIT WHEN v_user_push_queued >= v_remaining_push_budget;

                    -- C-1: Match uq_deliveries_campaign_endpoint partial unique index
                    INSERT INTO public.notification_deliveries (
                        campaign_id, recipient_type, recipient_id, endpoint_id, channel_type,
                        delivery_status, next_retry_at
                    )
                    VALUES (
                        v_camp.id, 'user', v_recipient.user_id, v_endpoint.id, v_endpoint.channel_type,
                        'pending', v_resume_at
                    )
                    ON CONFLICT (campaign_id, endpoint_id) WHERE endpoint_id IS NOT NULL DO NOTHING
                    RETURNING id INTO v_push_delivery_id;

                    IF v_push_delivery_id IS NOT NULL THEN
                        v_user_push_queued := v_user_push_queued + 1;
                        v_push_deliveries := v_push_deliveries + 1;
                        IF v_resume_at IS NOT NULL THEN
                            v_deferred_quiet_hours := v_deferred_quiet_hours + 1;
                        END IF;
                    END IF;
                END LOOP;
            END IF;
        END IF;

        -- Independent In-App Inbox Entry: always bind to a dedicated in_app delivery row
        -- so quiet-hours push deferrals & cancellations stay decoupled from seen inbox alerts.
        IF v_allow_in_app THEN
            INSERT INTO public.notification_deliveries (
                campaign_id, recipient_type, recipient_id, endpoint_id, channel_type,
                delivery_status
            )
            VALUES (
                v_camp.id, 'user', v_recipient.user_id, NULL, 'in_app',
                'pending'
            )
            ON CONFLICT (campaign_id, recipient_id) WHERE channel_type = 'in_app' AND recipient_id IS NOT NULL DO NOTHING
            RETURNING id INTO v_in_app_delivery_id;

            IF v_in_app_delivery_id IS NULL THEN
                SELECT id INTO v_in_app_delivery_id
                FROM public.notification_deliveries
                WHERE campaign_id = v_camp.id
                  AND recipient_id = v_recipient.user_id
                  AND channel_type = 'in_app'
                LIMIT 1;
            ELSE
                v_in_app_deliveries := v_in_app_deliveries + 1;
            END IF;

            INSERT INTO public.user_notifications (
                user_id, campaign_id, delivery_id, category, title, body, action_url, image_url, metadata
            )
            VALUES (
                v_recipient.user_id,
                v_camp.id,
                v_in_app_delivery_id,
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

    -- Mark in-app-only campaigns as completed immediately since push workers never poll in_app rows
    v_final_status := CASE WHEN v_push_deliveries > 0 THEN 'queued' ELSE 'completed' END;

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
        CASE WHEN v_push_deliveries > 0 THEN 'pending' ELSE 'completed' END,
        NOW()
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    UPDATE public.notification_campaigns
    SET total_recipients = v_total_recipients,
        status = v_final_status,
        sent_at = COALESCE(sent_at, NOW()),
        completed_at = CASE WHEN v_final_status = 'completed' THEN COALESCE(completed_at, NOW()) ELSE NULL END,
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
-- 8. C-2 & H-3: Hardened ingest_notification_campaign
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
    -- C-2: Strict trusted-caller guard using auth.role(), session_user, or verified admin membership
    v_is_service := (
        COALESCE(auth.role(), '') = 'service_role'
        OR (auth.role() IS NULL AND session_user IN ('postgres', 'supabase_admin'))
    );
    v_is_admin := public.notifications_is_admin();

    IF NOT v_is_service AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Forbidden: Administrator or service_role privileges required to ingest campaigns' USING ERRCODE = 'MV403';
    END IF;

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

    -- H-3: Serialize concurrent ingestion attempts sharing the same idempotency_key
    IF v_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(1002, hashtext(v_idempotency_key));

        SELECT c.id, c.status, c.total_recipients INTO v_existing_campaign
        FROM public.notification_queue q
        JOIN public.notification_campaigns c ON c.id = q.campaign_id
        WHERE q.idempotency_key = v_idempotency_key
          AND c.status != 'cancelled'
        LIMIT 1;

        IF NOT FOUND THEN
            SELECT c.id, c.status, c.total_recipients INTO v_existing_campaign
            FROM public.notification_campaigns c
            WHERE NULLIF(trim(c.target_criteria->>'idempotency_key'), '') = v_idempotency_key
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

    -- C-2: Prevent authenticated callers from spoofing p_created_by; only service_role may pass p_created_by
    v_actor_id := CASE
        WHEN v_is_service THEN COALESCE(p_created_by, auth.uid())
        ELSE auth.uid()
    END;
    v_actor_role := CASE
        WHEN v_is_service AND NOT v_is_admin THEN 'service_role'
        ELSE 'admin'
    END;

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
-- 9. C-2: Hardened promote_due_scheduled_campaigns
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
    v_is_service := (
        COALESCE(auth.role(), '') = 'service_role'
        OR (auth.role() IS NULL AND session_user IN ('postgres', 'supabase_admin'))
    );
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
-- 10. C-1, C-2, H-1, H-2, H-5: Private Welcome Helper + Public RPC + Trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._issue_welcome_notification_internal(
    p_user_id uuid,
    p_source text DEFAULT 'api'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_user record;
    v_pref record;
    v_has_pref boolean := false;
    v_welcome_campaign_id uuid := '00000000-0000-4000-8000-000000000001'::uuid;
    v_welcome_camp_status text;
    v_title text := 'Welcome to MovieVerify!';
    v_body text := 'Track upcoming releases, subscribe to your favorite series, and manage your alert channels anytime.';
    v_action_url text := '/?section=notifications';
    v_dispatch_row record;
    v_notification_id uuid;
    v_in_app_delivery_id uuid;
    v_push_del_id uuid;
    v_push_queued integer := 0;
    v_endpoint record;
    v_valid_tz text;
    v_resume_at timestamptz;
    v_daily_push_count integer := 0;
    v_remaining_budget integer := 5;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('created', false, 'reason', 'missing_user_id');
    END IF;

    SELECT id, created_at INTO v_user
    FROM auth.users
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('created', false, 'reason', 'user_not_found');
    END IF;

    -- Idempotent first-claim guard: strictly 1 record per account
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

    -- H-1: Ensure welcome system campaign starts as 'queued' (and never overrides 'cancelled')
    INSERT INTO public.notification_campaigns (
        id, title, body, category, action_url, target_type, target_criteria, status
    )
    VALUES (
        v_welcome_campaign_id,
        v_title,
        v_body,
        'system',
        v_action_url,
        'individual',
        '{"system_template":"welcome_v1"}'::jsonb,
        'queued'
    )
    ON CONFLICT (id) DO NOTHING;

    UPDATE public.notification_campaigns
    SET status = 'queued',
        completed_at = NULL,
        updated_at = NOW()
    WHERE id = v_welcome_campaign_id
      AND status = 'completed';

    SELECT status INTO v_welcome_camp_status
    FROM public.notification_campaigns
    WHERE id = v_welcome_campaign_id;

    IF COALESCE(v_welcome_camp_status, '') NOT IN ('queued', 'processing') THEN
        UPDATE public.user_welcome_dispatches
        SET status = 'suppressed_channel',
            suppressed_reason = 'welcome_campaign_inactive_or_cancelled'
        WHERE user_id = p_user_id;

        RETURN jsonb_build_object(
            'created', false,
            'already_processed', false,
            'reason', 'welcome_campaign_inactive'
        );
    END IF;

    IF COALESCE(v_pref.channel_in_app, true) THEN
        INSERT INTO public.notification_deliveries (
            campaign_id, recipient_type, recipient_id, endpoint_id, channel_type, delivery_status
        )
        VALUES (
            v_welcome_campaign_id, 'user', p_user_id, NULL, 'in_app', 'pending'
        )
        ON CONFLICT (campaign_id, recipient_id) WHERE channel_type = 'in_app' AND recipient_id IS NOT NULL DO NOTHING
        RETURNING id INTO v_in_app_delivery_id;

        IF v_in_app_delivery_id IS NULL THEN
            SELECT id INTO v_in_app_delivery_id
            FROM public.notification_deliveries
            WHERE campaign_id = v_welcome_campaign_id
              AND recipient_id = p_user_id
              AND channel_type = 'in_app'
            LIMIT 1;
        END IF;

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

    IF COALESCE(v_pref.channel_push, true) THEN
        -- H-2: Serialize per-user daily push budget check
        PERFORM pg_advisory_xact_lock(1001, hashtext(p_user_id::text));

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
              AND ne.revocation_reason IS NULL
              AND ne.channel_type IN ('fcm', 'web_push')
            ORDER BY ne.last_seen_at DESC NULLS LAST, ne.created_at DESC
        LOOP
            EXIT WHEN v_push_queued >= v_remaining_budget;

            -- C-1: Match partial unique index on (campaign_id, endpoint_id)
            INSERT INTO public.notification_deliveries (
                campaign_id, recipient_type, recipient_id, endpoint_id, channel_type, delivery_status, next_retry_at
            )
            VALUES (
                v_welcome_campaign_id, 'user', p_user_id, v_endpoint.id, v_endpoint.channel_type, 'pending', v_resume_at
            )
            ON CONFLICT (campaign_id, endpoint_id) WHERE endpoint_id IS NOT NULL DO NOTHING
            RETURNING id INTO v_push_del_id;

            IF v_push_del_id IS NOT NULL THEN
                v_push_queued := v_push_queued + 1;
            END IF;
        END LOOP;
    END IF;

    -- Do not mark dispatch as 'created' if neither in-app nor push delivery occurred
    IF v_notification_id IS NULL AND v_push_queued = 0 THEN
        UPDATE public.user_welcome_dispatches
        SET status = 'suppressed_channel',
            suppressed_reason = 'no_active_push_endpoint_and_in_app_disabled',
            notification_id = NULL,
            delivery_id = NULL
        WHERE user_id = p_user_id;

        RETURN jsonb_build_object(
            'created', false,
            'already_processed', false,
            'notification_id', NULL,
            'delivery_id', NULL,
            'push_queued', 0,
            'reason', 'suppressed_channel'
        );
    END IF;

    UPDATE public.user_welcome_dispatches
    SET notification_id = v_notification_id,
        delivery_id = v_in_app_delivery_id
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object(
        'created', true,
        'notification_id', v_notification_id,
        'delivery_id', v_in_app_delivery_id,
        'push_queued', v_push_queued
    );
END;
$$;

-- Strictly private helper: revoke from every external role including service_role
REVOKE ALL ON FUNCTION public._issue_welcome_notification_internal(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

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
BEGIN
    -- C-2: Strict service_role / DB owner authorization (never current_user)
    v_is_service := (
        COALESCE(auth.role(), '') = 'service_role'
        OR (auth.role() IS NULL AND session_user IN ('postgres', 'supabase_admin'))
    );
    IF NOT v_is_service THEN
        RAISE EXCEPTION 'Forbidden: service_role required to issue welcome notification' USING ERRCODE = 'MV403';
    END IF;

    RETURN public._issue_welcome_notification_internal(p_user_id, p_source);
END;
$$;

REVOKE ALL ON FUNCTION public.issue_welcome_notification(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_welcome_notification(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_auth_user_welcome_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    PERFORM public._issue_welcome_notification_internal(NEW.id, 'auth_trigger');
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Welcome notification creation failed for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_auth_user_welcome_notification() FROM PUBLIC, anon, authenticated, service_role;

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
-- 11. C-2, C-3, H-4: Hardened record_notification_telemetry (Campaign-First Locking)
-- ----------------------------------------------------------------------------
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
    v_camp_id uuid;
    v_locked_camp_id uuid;
    v_delivery record;
    v_inserted_id uuid;
BEGIN
    -- C-2: Strict service_role check (never current_user)
    v_is_service := (
        COALESCE(auth.role(), '') = 'service_role'
        OR (auth.role() IS NULL AND session_user IN ('postgres', 'supabase_admin'))
    );
    IF NOT v_is_service THEN
        RAISE EXCEPTION 'Forbidden: Telemetry RPC requires trusted server role (use /api/notifications/telemetry)' USING ERRCODE = 'MV403';
    END IF;

    IF p_client_metadata IS NOT NULL AND length(p_client_metadata::text) > 4096 THEN
        RAISE EXCEPTION 'Client metadata exceeds 4KB payload boundary' USING ERRCODE = 'MV400';
    END IF;

    -- H-4 Step 1: Pre-read immutable campaign_id WITHOUT acquiring row lock
    SELECT campaign_id INTO v_camp_id
    FROM public.notification_deliveries
    WHERE id = p_delivery_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'reason', 'DELIVERY_NOT_FOUND');
    END IF;

    -- H-4 Step 2: Lock Campaign row FIRST FOR UPDATE (matches B5D lock hierarchy; prevents 40P01)
    IF v_camp_id IS NOT NULL THEN
        SELECT id INTO v_locked_camp_id
        FROM public.notification_campaigns
        WHERE id = v_camp_id
        FOR UPDATE;
    END IF;

    -- H-4 Step 3: Lock Delivery row SECOND FOR UPDATE
    SELECT * INTO v_delivery
    FROM public.notification_deliveries
    WHERE id = p_delivery_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'reason', 'DELIVERY_NOT_FOUND');
    END IF;

    IF COALESCE(p_campaign_id, v_delivery.campaign_id) IS DISTINCT FROM v_delivery.campaign_id
       OR p_recipient_type IS DISTINCT FROM v_delivery.recipient_type
       OR p_recipient_id IS DISTINCT FROM v_delivery.recipient_id THEN
        RAISE EXCEPTION 'Telemetry recipient or campaign mismatch with delivery record' USING ERRCODE = 'MV403';
    END IF;

    INSERT INTO public.notification_telemetry (
        delivery_id, campaign_id, recipient_type, recipient_id,
        event_type, event_nonce, client_timestamp, client_metadata
    )
    VALUES (
        p_delivery_id, v_delivery.campaign_id, p_recipient_type, p_recipient_id,
        p_event_type, p_event_nonce, p_client_timestamp, COALESCE(p_client_metadata, '{}'::jsonb)
    )
    ON CONFLICT (delivery_id, event_type, event_nonce) DO NOTHING
    RETURNING id INTO v_inserted_id;

    -- C-3: Update delivery_status & delivered_at for both in-app and delivered push events
    IF v_inserted_id IS NOT NULL THEN
        IF v_delivery.channel_type = 'in_app'
           AND v_delivery.delivery_status = 'pending'
           AND p_event_type IN ('displayed', 'opened', 'clicked') THEN
            UPDATE public.notification_deliveries
            SET delivery_status = 'delivered',
                delivered_at = COALESCE(delivered_at, NOW()),
                updated_at = NOW()
            WHERE id = p_delivery_id
              AND delivery_status = 'pending';
        ELSIF v_delivery.channel_type IN ('fcm', 'web_push')
           AND v_delivery.delivery_status = 'sent'
           AND p_event_type IN ('device_received', 'displayed', 'opened', 'clicked') THEN
            UPDATE public.notification_deliveries
            SET delivery_status = 'delivered',
                delivered_at = COALESCE(delivered_at, NOW()),
                updated_at = NOW()
            WHERE id = p_delivery_id
              AND delivery_status = 'sent';
        END IF;

        IF v_delivery.campaign_id IS NOT NULL THEN
            IF p_event_type IN ('opened', 'displayed') THEN
                UPDATE public.notification_campaigns
                SET open_count = open_count + 1, updated_at = NOW()
                WHERE id = v_delivery.campaign_id;
            ELSIF p_event_type = 'clicked' THEN
                UPDATE public.notification_campaigns
                SET click_count = click_count + 1, updated_at = NOW()
                WHERE id = v_delivery.campaign_id;
            ELSIF p_event_type = 'client_failed' THEN
                UPDATE public.notification_campaigns
                SET failure_count = failure_count + 1, updated_at = NOW()
                WHERE id = v_delivery.campaign_id;
            END IF;
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

COMMIT;

