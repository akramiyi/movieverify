-- ============================================================================
-- Migration: 20261108000007_legacy_api_compatibility_layer.sql
-- Description: Compatibility layer for legacy API contracts without duplicating production engines
-- Target: PostgreSQL 17 / Supabase
-- Architecture Baseline: Phase 1.9, v1.9.0
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. LEGACY CONTRACT: notification_tokens (Updatable View over notification_endpoints)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.notification_tokens 
WITH (security_invoker = false)
AS
SELECT
    id,
    user_id,
    token,
    endpoint_hash AS token_hash,
    channel_type AS channel,
    device_type,
    device_name,
    browser,
    os,
    is_active,
    last_seen_at,
    revoked_at,
    created_at,
    updated_at
FROM public.notification_endpoints
WHERE channel_type = 'fcm'
  AND (
      current_user IN ('postgres', 'supabase_admin')
      OR (auth.role() = 'service_role')
      OR (user_id = auth.uid())
      OR public.notifications_is_admin()
  );

CREATE OR REPLACE FUNCTION public.trg_compat_notification_tokens_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_token_hash text;
    v_secret_hash text;
    v_id uuid;
BEGIN
    v_token_hash := COALESCE(NEW.token_hash, encode(sha256(trim(NEW.token)::bytea), 'hex'));
    v_secret_hash := encode(sha256((trim(NEW.token) || ':' || COALESCE(NEW.user_id::text, 'anon'))::bytea), 'hex');

    -- Insert or update into canonical endpoints
    INSERT INTO public.notification_endpoints (
        user_id, channel_type, token, endpoint_hash, client_secret_hash,
        device_type, device_name, browser, os, is_active, last_seen_at, created_at, updated_at
    )
    VALUES (
        NEW.user_id, 'fcm', NEW.token, v_token_hash, v_secret_hash,
        COALESCE(NEW.device_type, 'web'), NEW.device_name, NEW.browser, NEW.os,
        COALESCE(NEW.is_active, true), COALESCE(NEW.last_seen_at, NOW()),
        COALESCE(NEW.created_at, NOW()), COALESCE(NEW.updated_at, NOW())
    )
    RETURNING id INTO v_id;

    NEW.id := v_id;
    NEW.token_hash := v_token_hash;
    NEW.channel := 'fcm';
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_compat_notification_tokens_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    UPDATE public.notification_endpoints
    SET user_id = COALESCE(NEW.user_id, OLD.user_id),
        token = COALESCE(NEW.token, OLD.token),
        device_type = COALESCE(NEW.device_type, OLD.device_type),
        device_name = COALESCE(NEW.device_name, OLD.device_name),
        browser = COALESCE(NEW.browser, OLD.browser),
        os = COALESCE(NEW.os, OLD.os),
        is_active = COALESCE(NEW.is_active, OLD.is_active),
        revoked_at = CASE WHEN NEW.is_active = false AND OLD.is_active = true THEN NOW() ELSE OLD.revoked_at END,
        last_seen_at = COALESCE(NEW.last_seen_at, NOW()),
        updated_at = NOW()
    WHERE id = OLD.id;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_compat_notification_tokens_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    UPDATE public.notification_endpoints
    SET is_active = false,
        revoked_at = NOW(),
        revocation_reason = 'compat_deleted',
        updated_at = NOW()
    WHERE id = OLD.id;

    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_tokens_insert ON public.notification_tokens;
CREATE TRIGGER trg_tokens_insert
INSTEAD OF INSERT ON public.notification_tokens
FOR EACH ROW EXECUTE FUNCTION public.trg_compat_notification_tokens_insert();

DROP TRIGGER IF EXISTS trg_tokens_update ON public.notification_tokens;
CREATE TRIGGER trg_tokens_update
INSTEAD OF UPDATE ON public.notification_tokens
FOR EACH ROW EXECUTE FUNCTION public.trg_compat_notification_tokens_update();

DROP TRIGGER IF EXISTS trg_tokens_delete ON public.notification_tokens;
CREATE TRIGGER trg_tokens_delete
INSTEAD OF DELETE ON public.notification_tokens
FOR EACH ROW EXECUTE FUNCTION public.trg_compat_notification_tokens_delete();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_tokens TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. LEGACY CONTRACT: Subscriptions (movie_notify_requests, actor_notify_requests, genre_notify_requests)
-- Supports PostgreSQL ON CONFLICT (user_id, entity_id) while synchronizing with canonical notification_subscriptions
-- ----------------------------------------------------------------------------

-- A. movie_notify_requests
CREATE TABLE IF NOT EXISTS public.movie_notify_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    movie_id varchar(64) NOT NULL,
    movie_title varchar(255),
    created_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_movie_user UNIQUE (user_id, movie_id)
);

CREATE OR REPLACE FUNCTION public.trg_sync_movie_to_canonical()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        INSERT INTO public.notification_subscriptions (
            user_id, entity_type, entity_id, entity_title, status, created_at, updated_at
        )
        VALUES (
            NEW.user_id, 'movie', NEW.movie_id, NEW.movie_title, 'active', NEW.created_at, NOW()
        )
        ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE
        SET entity_title = EXCLUDED.entity_title, status = 'active', updated_at = NOW();
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        DELETE FROM public.notification_subscriptions
        WHERE user_id = OLD.user_id AND entity_type = 'movie' AND entity_id = OLD.movie_id;
        RETURN OLD;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_movie_sync_canonical ON public.movie_notify_requests;
CREATE TRIGGER trg_movie_sync_canonical
AFTER INSERT OR UPDATE OR DELETE ON public.movie_notify_requests
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_movie_to_canonical();

-- B. actor_notify_requests
CREATE TABLE IF NOT EXISTS public.actor_notify_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    actor_id varchar(64) NOT NULL,
    actor_name varchar(255),
    created_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_actor_user UNIQUE (user_id, actor_id)
);

CREATE OR REPLACE FUNCTION public.trg_sync_actor_to_canonical()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        INSERT INTO public.notification_subscriptions (
            user_id, entity_type, entity_id, entity_title, status, created_at, updated_at
        )
        VALUES (
            NEW.user_id, 'actor', NEW.actor_id, NEW.actor_name, 'active', NEW.created_at, NOW()
        )
        ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE
        SET entity_title = EXCLUDED.entity_title, status = 'active', updated_at = NOW();
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        DELETE FROM public.notification_subscriptions
        WHERE user_id = OLD.user_id AND entity_type = 'actor' AND entity_id = OLD.actor_id;
        RETURN OLD;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_actor_sync_canonical ON public.actor_notify_requests;
CREATE TRIGGER trg_actor_sync_canonical
AFTER INSERT OR UPDATE OR DELETE ON public.actor_notify_requests
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_actor_to_canonical();

-- C. genre_notify_requests
CREATE TABLE IF NOT EXISTS public.genre_notify_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    genre_id varchar(64) NOT NULL,
    genre_name varchar(255),
    created_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_genre_user UNIQUE (user_id, genre_id)
);

CREATE OR REPLACE FUNCTION public.trg_sync_genre_to_canonical()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        INSERT INTO public.notification_subscriptions (
            user_id, entity_type, entity_id, entity_title, status, created_at, updated_at
        )
        VALUES (
            NEW.user_id, 'genre', NEW.genre_id, NEW.genre_name, 'active', NEW.created_at, NOW()
        )
        ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE
        SET entity_title = EXCLUDED.entity_title, status = 'active', updated_at = NOW();
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        DELETE FROM public.notification_subscriptions
        WHERE user_id = OLD.user_id AND entity_type = 'genre' AND entity_id = OLD.genre_id;
        RETURN OLD;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_genre_sync_canonical ON public.genre_notify_requests;
CREATE TRIGGER trg_genre_sync_canonical
AFTER INSERT OR UPDATE OR DELETE ON public.genre_notify_requests
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_genre_to_canonical();

-- Enable and Force RLS on subscription compatibility tables
ALTER TABLE public.movie_notify_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movie_notify_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.actor_notify_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actor_notify_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.genre_notify_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.genre_notify_requests FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.movie_notify_requests TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.actor_notify_requests TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.genre_notify_requests TO authenticated, service_role;

DROP POLICY IF EXISTS p_movie_sub_user ON public.movie_notify_requests;
CREATE POLICY p_movie_sub_user ON public.movie_notify_requests
FOR ALL TO authenticated
USING (user_id = auth.uid() OR public.notifications_is_admin())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS p_movie_sub_service ON public.movie_notify_requests;
CREATE POLICY p_movie_sub_service ON public.movie_notify_requests
FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS p_actor_sub_user ON public.actor_notify_requests;
CREATE POLICY p_actor_sub_user ON public.actor_notify_requests
FOR ALL TO authenticated
USING (user_id = auth.uid() OR public.notifications_is_admin())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS p_actor_sub_service ON public.actor_notify_requests;
CREATE POLICY p_actor_sub_service ON public.actor_notify_requests
FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS p_genre_sub_user ON public.genre_notify_requests;
CREATE POLICY p_genre_sub_user ON public.genre_notify_requests
FOR ALL TO authenticated
USING (user_id = auth.uid() OR public.notifications_is_admin())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS p_genre_sub_service ON public.genre_notify_requests;
CREATE POLICY p_genre_sub_service ON public.genre_notify_requests
FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- 3. LEGACY CONTRACT: notification_opt_outs
-- Supports PostgreSQL ON CONFLICT (user_id, category) while synchronizing with canonical user_notification_preferences
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_opt_outs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    category text NOT NULL,
    reason text DEFAULT 'user_preference',
    created_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_opt_out_user_cat UNIQUE (user_id, category)
);

CREATE OR REPLACE FUNCTION public.trg_sync_opt_out_to_preferences()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Insert/update preferences setting corresponding category disabled
        INSERT INTO public.user_notification_preferences (
            user_id,
            notify_new_movies,
            notify_movie_updates,
            notify_promotions,
            notify_system
        )
        VALUES (
            NEW.user_id,
            CASE WHEN NEW.category = 'movie_release' THEN false ELSE true END,
            CASE WHEN NEW.category = 'content_update' THEN false ELSE true END,
            CASE WHEN NEW.category = 'promotional' THEN false ELSE false END,
            CASE WHEN NEW.category IN ('user_alert', 'admin_announcement') THEN false ELSE true END
        )
        ON CONFLICT (user_id) DO UPDATE SET
            notify_new_movies = CASE WHEN NEW.category = 'movie_release' THEN false ELSE user_notification_preferences.notify_new_movies END,
            notify_movie_updates = CASE WHEN NEW.category = 'content_update' THEN false ELSE user_notification_preferences.notify_movie_updates END,
            notify_promotions = CASE WHEN NEW.category = 'promotional' THEN false ELSE user_notification_preferences.notify_promotions END,
            notify_system = CASE WHEN NEW.category IN ('user_alert', 'admin_announcement') THEN false ELSE user_notification_preferences.notify_system END,
            updated_at = NOW();
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- Re-enable category
        UPDATE public.user_notification_preferences
        SET notify_new_movies = CASE WHEN OLD.category = 'movie_release' THEN true ELSE notify_new_movies END,
            notify_movie_updates = CASE WHEN OLD.category = 'content_update' THEN true ELSE notify_movie_updates END,
            notify_promotions = CASE WHEN OLD.category = 'promotional' THEN true ELSE notify_promotions END,
            notify_system = CASE WHEN OLD.category IN ('user_alert', 'admin_announcement') THEN true ELSE notify_system END,
            updated_at = NOW()
        WHERE user_id = OLD.user_id;
        RETURN OLD;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_opt_out_sync_preferences ON public.notification_opt_outs;
CREATE TRIGGER trg_opt_out_sync_preferences
AFTER INSERT OR DELETE ON public.notification_opt_outs
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_opt_out_to_preferences();

ALTER TABLE public.notification_opt_outs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_opt_outs FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_opt_outs TO authenticated, service_role;

DROP POLICY IF EXISTS p_opt_outs_user ON public.notification_opt_outs;
CREATE POLICY p_opt_outs_user ON public.notification_opt_outs
FOR ALL TO authenticated
USING (user_id = auth.uid() OR public.notifications_is_admin())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS p_opt_outs_service ON public.notification_opt_outs;
CREATE POLICY p_opt_outs_service ON public.notification_opt_outs
FOR ALL TO service_role USING (true) WITH CHECK (true);

