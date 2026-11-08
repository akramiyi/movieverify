-- ============================================================================
-- Migration: 20261108000005_notification_rpcs_and_functions.sql
-- Description: Core lifecycle, campaign, dispatch, and telemetry RPCs
-- Target: PostgreSQL 17 / Supabase
-- Architecture Baseline: Phase 1.9, v1.9.0
-- ============================================================================

-- 1. Helper function: notifications_is_admin()
-- Verifies authoritative server-side admin role strictly through public.admin_users membership.
-- Does not grant admin access solely based on JWT app_metadata claims.
-- Strictly adheres to admin_users.user_id membership contract (no is_active assumption).
CREATE OR REPLACE FUNCTION public.notifications_is_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN false;
    END IF;

    -- Authoritative membership in public.admin_users only
    IF EXISTS (
        SELECT 1 FROM public.admin_users
        WHERE user_id = v_user_id
    ) THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

-- 2. RPC: register_notification_endpoint
-- Registers or updates physical push device token with client cryptographic possession proof.
CREATE OR REPLACE FUNCTION public.register_notification_endpoint(
    p_channel_type varchar(16),
    p_token text,
    p_endpoint_url text,
    p_p256dh_key text,
    p_auth_secret text,
    p_client_secret text,
    p_device_type varchar(16) DEFAULT 'web',
    p_device_name varchar(128) DEFAULT NULL,
    p_browser varchar(64) DEFAULT NULL,
    p_os varchar(64) DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_endpoint_hash text;
    v_new_secret_hash text;
    v_existing record;
    v_endpoint_id uuid;
    v_attempts integer := 0;
    v_constraint text;
BEGIN
    -- 1. Parameter validation & hash calculation
    IF p_channel_type = 'fcm' THEN
        IF p_token IS NULL OR length(trim(p_token)) < 10 THEN
            RAISE EXCEPTION 'Invalid FCM token' USING ERRCODE = 'MV400';
        END IF;
        v_endpoint_hash := encode(sha256(trim(p_token)::bytea), 'hex');
    ELSIF p_channel_type = 'web_push' THEN
        IF p_endpoint_url IS NULL OR p_p256dh_key IS NULL OR p_auth_secret IS NULL THEN
            RAISE EXCEPTION 'Invalid Web Push parameters' USING ERRCODE = 'MV400';
        END IF;
        v_endpoint_hash := encode(sha256(trim(p_endpoint_url)::bytea), 'hex');
    ELSE
        RAISE EXCEPTION 'Unsupported channel type: %', p_channel_type USING ERRCODE = 'MV400';
    END IF;

    IF p_client_secret IS NULL OR length(trim(p_client_secret)) < 16 THEN
        RAISE EXCEPTION 'Client possession secret must be at least 16 characters' USING ERRCODE = 'MV400';
    END IF;

    v_new_secret_hash := encode(sha256(trim(p_client_secret)::bytea), 'hex');

    -- 2. Concurrency-safe atomic loop
    LOOP
        v_attempts := v_attempts + 1;
        IF v_attempts > 5 THEN
            RAISE EXCEPTION 'Registration contention exceeded maximum retry limit' USING ERRCODE = 'MV500';
        END IF;

        -- Attempt to find and lock existing active endpoint
        SELECT * INTO v_existing
        FROM public.notification_endpoints
        WHERE endpoint_hash = v_endpoint_hash AND is_active = true
        FOR UPDATE;

        IF FOUND THEN
            -- Verify cryptographic possession proof
            IF v_existing.client_secret_hash != v_new_secret_hash THEN
                RAISE EXCEPTION 'Possession verification failed: device secret mismatch' USING ERRCODE = 'MV403';
            END IF;

            -- Case A: Cross-Account Switch (Device possessed by current user, but bound to another account)
            IF v_existing.user_id IS NOT NULL AND auth.uid() IS NOT NULL AND v_existing.user_id != auth.uid() THEN
                UPDATE public.notification_endpoints
                SET is_active = false,
                    revoked_at = NOW(),
                    revocation_reason = 'account_switch',
                    updated_at = NOW()
                WHERE id = v_existing.id;

                INSERT INTO public.notification_endpoints (
                    user_id, channel_type, token, endpoint_url, p256dh_key, auth_secret,
                    endpoint_hash, client_secret_hash, device_type, device_name, browser, os,
                    is_active, revoked_at, revocation_reason
                )
                VALUES (
                    auth.uid(), p_channel_type, p_token, p_endpoint_url, p_p256dh_key, p_auth_secret,
                    v_endpoint_hash, v_new_secret_hash, p_device_type, p_device_name, p_browser, p_os,
                    true, NULL, NULL
                )
                RETURNING id INTO v_endpoint_id;

                RETURN v_endpoint_id;
            END IF;

            -- Case B: Same user or guest refreshing metadata
            UPDATE public.notification_endpoints
            SET user_id = COALESCE(auth.uid(), v_existing.user_id),
                token = p_token,
                endpoint_url = p_endpoint_url,
                p256dh_key = p_p256dh_key,
                auth_secret = p_auth_secret,
                device_type = p_device_type,
                device_name = COALESCE(p_device_name, v_existing.device_name),
                browser = COALESCE(p_browser, v_existing.browser),
                os = COALESCE(p_os, v_existing.os),
                last_seen_at = NOW(),
                updated_at = NOW()
            WHERE id = v_existing.id
            RETURNING id INTO v_endpoint_id;

            RETURN v_endpoint_id;
        ELSE
            -- Case C: No active endpoint found. Attempt insertion inside subtransaction.
            BEGIN
                INSERT INTO public.notification_endpoints (
                    user_id, channel_type, token, endpoint_url, p256dh_key, auth_secret,
                    endpoint_hash, client_secret_hash, device_type, device_name, browser, os,
                    is_active, revoked_at, revocation_reason
                )
                VALUES (
                    auth.uid(), p_channel_type, p_token, p_endpoint_url, p_p256dh_key, p_auth_secret,
                    v_endpoint_hash, v_new_secret_hash, p_device_type, p_device_name, p_browser, p_os,
                    true, NULL, NULL
                )
                RETURNING id INTO v_endpoint_id;

                RETURN v_endpoint_id;
            EXCEPTION WHEN unique_violation THEN
                GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
                IF v_constraint = 'uq_endpoints_active_hash' THEN
                    CONTINUE;
                ELSE
                    RAISE;
                END IF;
            END;
        END IF;
    END LOOP;
END;
$$;

-- 3. RPC: claim_notification_endpoint
-- Binds an anonymous guest endpoint to an authenticated user upon sign-in.
CREATE OR REPLACE FUNCTION public.claim_notification_endpoint(
    p_endpoint_id uuid,
    p_client_secret text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_secret_hash text;
    v_endpoint record;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required to claim endpoint' USING ERRCODE = 'MV401';
    END IF;

    IF p_client_secret IS NULL THEN
        RAISE EXCEPTION 'Client possession secret required' USING ERRCODE = 'MV400';
    END IF;

    v_secret_hash := encode(sha256(trim(p_client_secret)::bytea), 'hex');

    SELECT * INTO v_endpoint
    FROM public.notification_endpoints
    WHERE id = p_endpoint_id AND is_active = true
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active endpoint % not found', p_endpoint_id USING ERRCODE = 'MV404';
    END IF;

    IF v_endpoint.client_secret_hash != v_secret_hash THEN
        RAISE EXCEPTION 'Possession verification failed: device secret mismatch' USING ERRCODE = 'MV403';
    END IF;

    -- If already owned by current user: idempotent success
    IF v_endpoint.user_id = auth.uid() THEN
        RETURN true;
    END IF;

    -- If bound to another user: archive old endpoint and create new one for current user
    IF v_endpoint.user_id IS NOT NULL AND v_endpoint.user_id != auth.uid() THEN
        UPDATE public.notification_endpoints
        SET is_active = false,
            revoked_at = NOW(),
            revocation_reason = 'claimed_by_other_account',
            updated_at = NOW()
        WHERE id = v_endpoint.id;

        INSERT INTO public.notification_endpoints (
            user_id, channel_type, token, endpoint_url, p256dh_key, auth_secret,
            endpoint_hash, client_secret_hash, device_type, device_name, browser, os,
            is_active
        )
        VALUES (
            auth.uid(), v_endpoint.channel_type, v_endpoint.token, v_endpoint.endpoint_url,
            v_endpoint.p256dh_key, v_endpoint.auth_secret, v_endpoint.endpoint_hash,
            v_endpoint.client_secret_hash, v_endpoint.device_type, v_endpoint.device_name,
            v_endpoint.browser, v_endpoint.os, true
        );
        RETURN true;
    END IF;

    -- If guest: bind to authenticated user
    UPDATE public.notification_endpoints
    SET user_id = auth.uid(),
        last_seen_at = NOW(),
        updated_at = NOW()
    WHERE id = v_endpoint.id;

    RETURN true;
END;
$$;

-- 4. RPC: revoke_notification_endpoint
-- Deactivates an endpoint upon user sign-out or device revocation.
CREATE OR REPLACE FUNCTION public.revoke_notification_endpoint(
    p_endpoint_id uuid,
    p_client_secret text DEFAULT NULL,
    p_revocation_reason varchar(64) DEFAULT 'user_revoked'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_secret_hash text;
    v_endpoint record;
BEGIN
    SELECT * INTO v_endpoint
    FROM public.notification_endpoints
    WHERE id = p_endpoint_id
    FOR UPDATE;

    IF NOT FOUND THEN
        -- Idempotent success
        RETURN true;
    END IF;

    IF NOT v_endpoint.is_active THEN
        -- Already inactive
        RETURN true;
    END IF;

    -- Verify authorization: User ownership OR client possession secret
    IF v_endpoint.user_id IS NOT NULL AND auth.uid() IS NOT NULL AND v_endpoint.user_id = auth.uid() THEN
        -- Authorized via user session
        NULL;
    ELSIF p_client_secret IS NOT NULL THEN
        v_secret_hash := encode(sha256(trim(p_client_secret)::bytea), 'hex');
        IF v_endpoint.client_secret_hash != v_secret_hash THEN
            RAISE EXCEPTION 'Possession verification failed: secret mismatch' USING ERRCODE = 'MV403';
        END IF;
    ELSE
        RAISE EXCEPTION 'Unauthorized: user ownership or client possession secret required' USING ERRCODE = 'MV401';
    END IF;

    UPDATE public.notification_endpoints
    SET is_active = false,
        revoked_at = NOW(),
        revocation_reason = COALESCE(p_revocation_reason, 'user_revoked'),
        updated_at = NOW()
    WHERE id = v_endpoint.id;

    RETURN true;
END;
$$;

-- 5. RPC: ingest_notification_campaign
-- Ingests broadcast campaign and enqueues deliveries & queue items.
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
    v_clean_title text;
    v_clean_body text;
    v_clean_category text;
    v_idempotency_key text;
    v_target_type text;
    v_campaign_id uuid;
    v_existing_camp record;
    v_recipient_count integer := 0;
    v_delivery_count integer := 0;
    v_is_draft boolean := false;
    v_initial_status varchar(24) := 'queued';
    v_created_by uuid;
BEGIN
    -- Authorization: Admin JWT or service_role
    IF current_user != 'service_role' AND NOT public.notifications_is_admin() THEN
        RAISE EXCEPTION 'Forbidden: Administrator privileges required' USING ERRCODE = 'MV403';
    END IF;

    v_clean_title := trim(p_title);
    v_clean_body := trim(p_body);
    v_clean_category := lower(trim(p_category));

    IF length(v_clean_title) = 0 OR length(v_clean_title) > 255 THEN
        RAISE EXCEPTION 'Title must be between 1 and 255 characters' USING ERRCODE = 'MV400';
    END IF;
    IF length(v_clean_body) = 0 OR length(v_clean_body) > 1000 THEN
        RAISE EXCEPTION 'Body must be between 1 and 1000 characters' USING ERRCODE = 'MV400';
    END IF;

    v_idempotency_key := trim(COALESCE(p_target_criteria->>'idempotency_key', ''));
    v_target_type := lower(trim(COALESCE(p_target_criteria->>'type', 'all')));
    v_is_draft := COALESCE((p_target_criteria->>'is_draft')::boolean, false);

    -- Check Idempotency Key
    IF length(v_idempotency_key) > 0 THEN
        SELECT id, status, total_recipients INTO v_existing_camp
        FROM public.notification_campaigns
        WHERE target_criteria->>'idempotency_key' = v_idempotency_key;

        IF FOUND THEN
            SELECT count(*) INTO v_delivery_count
            FROM public.notification_deliveries
            WHERE campaign_id = v_existing_camp.id;

            RETURN jsonb_build_object(
                'success', true,
                'already_exists', true,
                'campaign_id', v_existing_camp.id,
                'status', v_existing_camp.status,
                'total_recipients', v_existing_camp.total_recipients,
                'total_deliveries', v_delivery_count
            );
        END IF;
    END IF;

    -- Determine initial status
    IF v_is_draft THEN
        v_initial_status := 'draft';
    ELSIF p_scheduled_for IS NOT NULL AND p_scheduled_for > NOW() THEN
        v_initial_status := 'scheduled';
    ELSE
        v_initial_status := 'queued';
    END IF;

    v_created_by := COALESCE(auth.uid(), p_created_by);

    -- 1. Insert Campaign Record
    INSERT INTO public.notification_campaigns (
        title, body, category, action_url, image_url,
        target_type, target_criteria, status, scheduled_for, created_by
    )
    VALUES (
        v_clean_title, v_clean_body, v_clean_category, p_url, p_image_url,
        v_target_type, p_target_criteria, v_initial_status, p_scheduled_for, v_created_by
    )
    RETURNING id INTO v_campaign_id;

    -- If draft or scheduled, return early without generating deliveries
    IF v_initial_status IN ('draft', 'scheduled') THEN
        INSERT INTO public.notification_audit_log (actor_id, actor_role, action, entity_type, entity_id, details)
        VALUES (v_created_by, 'admin', 'campaign_' || v_initial_status, 'notification_campaigns', v_campaign_id::text,
            jsonb_build_object('title', v_clean_title, 'category', v_clean_category)
        );

        RETURN jsonb_build_object(
            'success', true,
            'already_exists', false,
            'campaign_id', v_campaign_id,
            'status', v_initial_status,
            'total_recipients', 0,
            'total_deliveries', 0
        );
    END IF;

    -- 2. Materialize Deliveries for Targeted Recipients
    -- Resolve recipient user IDs respecting opt-outs and active endpoints
    CREATE TEMP TABLE tmp_recipients (
        user_id uuid,
        endpoint_id uuid,
        channel_type varchar(16)
    ) ON COMMIT DROP;

    IF v_target_type = 'all' THEN
        INSERT INTO tmp_recipients (user_id, endpoint_id, channel_type)
        SELECT e.user_id, e.id, e.channel_type
        FROM public.notification_endpoints e
        LEFT JOIN public.user_notification_preferences p ON p.user_id = e.user_id
        WHERE e.is_active = true
          AND (p.user_id IS NULL OR (
              p.opt_in_all = true AND
              (v_clean_category != 'promotional' OR p.notify_promotions = true)
          ));

    ELSIF v_target_type = 'movie' THEN
        INSERT INTO tmp_recipients (user_id, endpoint_id, channel_type)
        SELECT e.user_id, e.id, e.channel_type
        FROM public.notification_subscriptions s
        JOIN public.notification_endpoints e ON e.user_id = s.user_id
        LEFT JOIN public.user_notification_preferences p ON p.user_id = e.user_id
        WHERE s.entity_type = 'movie'
          AND s.entity_id = trim(p_target_criteria->>'movie_id')
          AND s.status = 'active'
          AND e.is_active = true
          AND (p.user_id IS NULL OR p.opt_in_all = true);

    ELSIF v_target_type = 'actor' THEN
        INSERT INTO tmp_recipients (user_id, endpoint_id, channel_type)
        SELECT e.user_id, e.id, e.channel_type
        FROM public.notification_subscriptions s
        JOIN public.notification_endpoints e ON e.user_id = s.user_id
        LEFT JOIN public.user_notification_preferences p ON p.user_id = e.user_id
        WHERE s.entity_type = 'actor'
          AND s.entity_id = trim(p_target_criteria->>'actor_id')
          AND s.status = 'active'
          AND e.is_active = true
          AND (p.user_id IS NULL OR p.opt_in_all = true);

    ELSIF v_target_type = 'genre' THEN
        INSERT INTO tmp_recipients (user_id, endpoint_id, channel_type)
        SELECT e.user_id, e.id, e.channel_type
        FROM public.notification_subscriptions s
        JOIN public.notification_endpoints e ON e.user_id = s.user_id
        LEFT JOIN public.user_notification_preferences p ON p.user_id = e.user_id
        WHERE s.entity_type = 'genre'
          AND s.entity_id = trim(p_target_criteria->>'genre_id')
          AND s.status = 'active'
          AND e.is_active = true
          AND (p.user_id IS NULL OR p.opt_in_all = true);

    ELSIF v_target_type = 'users' THEN
        INSERT INTO tmp_recipients (user_id, endpoint_id, channel_type)
        SELECT e.user_id, e.id, e.channel_type
        FROM jsonb_array_elements_text(p_target_criteria->'user_ids') uid
        JOIN public.notification_endpoints e ON e.user_id = uid::uuid
        WHERE e.is_active = true;
    END IF;

    -- Distinct recipient count
    SELECT count(DISTINCT user_id) INTO v_recipient_count FROM tmp_recipients;

    -- Insert Deliveries
    INSERT INTO public.notification_deliveries (
        campaign_id, recipient_type, recipient_id, endpoint_id, channel_type, delivery_status
    )
    SELECT
        v_campaign_id,
        CASE WHEN r.user_id IS NOT NULL THEN 'user' ELSE 'guest' END,
        r.user_id,
        r.endpoint_id,
        r.channel_type,
        'pending'
    FROM tmp_recipients r;

    GET DIAGNOSTICS v_delivery_count = ROW_COUNT;

    -- Insert In-App notifications for distinct users
    INSERT INTO public.user_notifications (
        user_id, campaign_id, category, title, body, action_url, image_url
    )
    SELECT DISTINCT
        r.user_id, v_campaign_id, v_clean_category, v_clean_title, v_clean_body, p_url, p_image_url
    FROM tmp_recipients r
    WHERE r.user_id IS NOT NULL
    ON CONFLICT (user_id, campaign_id) WHERE campaign_id IS NOT NULL DO NOTHING;

    -- Create Queue entry for batch processing
    INSERT INTO public.notification_queue (
        campaign_id, idempotency_key, batch_index, payload, status
    )
    VALUES (
        v_campaign_id,
        COALESCE(NULLIF(v_idempotency_key, ''), gen_random_uuid()::text),
        0,
        jsonb_build_object(
            'campaign_id', v_campaign_id,
            'title', v_clean_title,
            'body', v_clean_body,
            'url', p_url,
            'image_url', p_image_url,
            'category', v_clean_category,
            'total_deliveries', v_delivery_count
        ),
        'pending'
    );

    -- Update campaign stats
    UPDATE public.notification_campaigns
    SET total_recipients = v_recipient_count,
        updated_at = NOW()
    WHERE id = v_campaign_id;

    -- Audit log
    INSERT INTO public.notification_audit_log (actor_id, actor_role, action, entity_type, entity_id, details)
    VALUES (v_created_by, 'admin', 'campaign_ingested', 'notification_campaigns', v_campaign_id::text,
        jsonb_build_object('total_recipients', v_recipient_count, 'total_deliveries', v_delivery_count)
    );

    RETURN jsonb_build_object(
        'success', true,
        'already_exists', false,
        'campaign_id', v_campaign_id,
        'status', v_initial_status,
        'total_recipients', v_recipient_count,
        'total_deliveries', v_delivery_count
    );
END;
$$;

-- 6. RPC: cancel_notification_campaign
CREATE OR REPLACE FUNCTION public.cancel_notification_campaign(
    p_campaign_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_campaign record;
    v_cancelled_deliveries integer := 0;
BEGIN
    IF current_user != 'service_role' AND NOT public.notifications_is_admin() THEN
        RAISE EXCEPTION 'Forbidden: Administrator privileges required' USING ERRCODE = 'MV403';
    END IF;

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

    -- Cancel campaign
    UPDATE public.notification_campaigns
    SET status = 'cancelled',
        cancelled_at = NOW(),
        updated_at = NOW()
    WHERE id = p_campaign_id;

    -- Cancel pending queue jobs
    UPDATE public.notification_queue
    SET status = 'cancelled',
        updated_at = NOW()
    WHERE campaign_id = p_campaign_id AND status = 'pending';

    -- Cancel pending deliveries
    UPDATE public.notification_deliveries
    SET delivery_status = 'cancelled',
        updated_at = NOW()
    WHERE campaign_id = p_campaign_id AND delivery_status = 'pending';

    GET DIAGNOSTICS v_cancelled_deliveries = ROW_COUNT;

    -- Audit log
    INSERT INTO public.notification_audit_log (actor_id, actor_role, action, entity_type, entity_id, details)
    VALUES (auth.uid(), 'admin', 'campaign_cancelled', 'notification_campaigns', p_campaign_id::text,
        jsonb_build_object('cancelled_deliveries', v_cancelled_deliveries)
    );

    RETURN jsonb_build_object(
        'success', true,
        'campaign_id', p_campaign_id,
        'cancelled_deliveries', v_cancelled_deliveries
    );
END;
$$;

-- 7. RPC: reserve_notification_deliveries
-- Batch claim with FOR UPDATE SKIP LOCKED and cryptographic lease token generation.
CREATE OR REPLACE FUNCTION public.reserve_notification_deliveries(
    p_worker_id varchar(64),
    p_batch_size integer DEFAULT 25,
    p_lease_seconds integer DEFAULT 60
)
RETURNS TABLE (
    delivery_id uuid,
    token_id uuid,
    raw_token text,
    recipient_id uuid,
    reservation_token uuid,
    campaign_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_lease_token uuid := gen_random_uuid();
    v_lease_expiry timestamptz := NOW() + (p_lease_seconds || ' seconds')::interval;
BEGIN
    RETURN QUERY
    WITH claimable AS (
        SELECT d.id
        FROM public.notification_deliveries d
        JOIN public.notification_endpoints e ON e.id = d.endpoint_id
        WHERE d.delivery_status = 'pending'
          AND (d.next_retry_at IS NULL OR d.next_retry_at <= NOW())
          AND e.is_active = true
        ORDER BY d.created_at ASC
        LIMIT p_batch_size
        FOR UPDATE OF d SKIP LOCKED
    ),
    updated AS (
        UPDATE public.notification_deliveries d
        SET delivery_status = 'leased',
            lease_token = v_lease_token,
            lease_expires_at = v_lease_expiry,
            worker_id = p_worker_id,
            updated_at = NOW()
        FROM claimable c
        WHERE d.id = c.id
        RETURNING d.id AS u_delivery_id, d.endpoint_id, d.recipient_id, d.lease_token, d.campaign_id
    )
    SELECT
        u.u_delivery_id AS delivery_id,
        e.id AS token_id,
        e.token AS raw_token,
        u.recipient_id,
        u.lease_token AS reservation_token,
        u.campaign_id
    FROM updated u
    JOIN public.notification_endpoints e ON e.id = u.endpoint_id;
END;
$$;

-- 8. RPC: authorize_notification_delivery_dispatch
-- Pre-dispatch boundary fence checking active lease and endpoint validity.
CREATE OR REPLACE FUNCTION public.authorize_notification_delivery_dispatch(
    p_delivery_id uuid,
    p_token_id uuid,
    p_reservation_token uuid,
    p_worker_id varchar(64),
    p_recipient_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_delivery record;
    v_endpoint record;
BEGIN
    SELECT * INTO v_delivery
    FROM public.notification_deliveries
    WHERE id = p_delivery_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'DELIVERY_NOT_FOUND');
    END IF;

    -- Verify lease fence
    IF v_delivery.delivery_status != 'leased' OR
       v_delivery.lease_token IS DISTINCT FROM p_reservation_token OR
       v_delivery.worker_id IS DISTINCT FROM p_worker_id THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'FENCE_TOKEN_MISMATCH');
    END IF;

    IF v_delivery.lease_expires_at <= NOW() THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'LEASE_EXPIRED');
    END IF;

    -- Preflight check on endpoint
    SELECT * INTO v_endpoint
    FROM public.notification_endpoints
    WHERE id = v_delivery.endpoint_id;

    IF NOT FOUND OR NOT v_endpoint.is_active THEN
        -- Mark delivery failed since endpoint was revoked/deleted prior to dispatch
        UPDATE public.notification_deliveries
        SET delivery_status = 'failed',
            lease_token = NULL,
            lease_expires_at = NULL,
            provider_response = jsonb_build_object('error', 'ENDPOINT_INACTIVE_PREFLIGHT'),
            updated_at = NOW()
        WHERE id = p_delivery_id;

        RETURN jsonb_build_object('authorized', false, 'reason', 'ENDPOINT_REVOKED_OR_INACTIVE');
    END IF;

    RETURN jsonb_build_object(
        'authorized', true,
        'dispatch_attempt_id', gen_random_uuid()
    );
END;
$$;

-- 9. RPC: confirm_notification_delivery_sent
-- Fenced CAS confirming FCM dispatch acceptance.
CREATE OR REPLACE FUNCTION public.confirm_notification_delivery_sent(
    p_delivery_id uuid,
    p_dispatch_attempt_id uuid,
    p_fcm_message_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_camp_id uuid;
BEGIN
    UPDATE public.notification_deliveries
    SET delivery_status = 'sent',
        provider_message_id = p_fcm_message_id,
        provider_status_code = 200,
        sent_at = NOW(),
        lease_token = NULL,
        lease_expires_at = NULL,
        updated_at = NOW()
    WHERE id = p_delivery_id
      AND delivery_status = 'leased'
    RETURNING campaign_id INTO v_camp_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'reason', 'CAS_FAILED_OR_LEASE_LOST');
    END IF;

    -- Increment campaign counts
    UPDATE public.notification_campaigns
    SET sent_count = sent_count + 1,
        success_count = success_count + 1,
        updated_at = NOW()
    WHERE id = v_camp_id;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- 10. RPC: fail_or_retry_notification_delivery
-- Fenced CAS recording failure or scheduling backoff retry.
CREATE OR REPLACE FUNCTION public.fail_or_retry_notification_delivery(
    p_delivery_id uuid,
    p_worker_id varchar(64),
    p_reservation_token uuid,
    p_error_code text,
    p_error_message text,
    p_retry_after_seconds integer DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_delivery record;
    v_is_permanent boolean := false;
    v_next_status varchar(24);
    v_retry_delay integer;
BEGIN
    SELECT * INTO v_delivery
    FROM public.notification_deliveries
    WHERE id = p_delivery_id
    FOR UPDATE;

    IF NOT FOUND OR v_delivery.delivery_status != 'leased' OR v_delivery.lease_token IS DISTINCT FROM p_reservation_token THEN
        RETURN 'conflict';
    END IF;

    IF p_error_code IN ('UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH') THEN
        v_is_permanent := true;
    END IF;

    IF NOT v_is_permanent AND v_delivery.retry_count < v_delivery.max_retries THEN
        -- Retry
        v_next_status := 'pending';
        v_retry_delay := COALESCE(p_retry_after_seconds, power(2, v_delivery.retry_count) * 30);

        UPDATE public.notification_deliveries
        SET delivery_status = 'pending',
            retry_count = retry_count + 1,
            next_retry_at = NOW() + (v_retry_delay || ' seconds')::interval,
            lease_token = NULL,
            lease_expires_at = NULL,
            provider_response = jsonb_build_object('error_code', p_error_code, 'message', p_error_message),
            updated_at = NOW()
        WHERE id = p_delivery_id;
    ELSE
        -- Terminal failure
        v_next_status := 'failed';

        UPDATE public.notification_deliveries
        SET delivery_status = 'failed',
            lease_token = NULL,
            lease_expires_at = NULL,
            provider_response = jsonb_build_object('error_code', p_error_code, 'message', p_error_message),
            updated_at = NOW()
        WHERE id = p_delivery_id;

        UPDATE public.notification_campaigns
        SET failure_count = failure_count + 1,
            updated_at = NOW()
        WHERE id = v_delivery.campaign_id;

        -- If unregistered token: deactivate endpoint
        IF p_error_code = 'UNREGISTERED' AND v_delivery.endpoint_id IS NOT NULL THEN
            UPDATE public.notification_endpoints
            SET is_active = false,
                revoked_at = NOW(),
                revocation_reason = 'fcm_unregistered',
                updated_at = NOW()
            WHERE id = v_delivery.endpoint_id;
        END IF;
    END IF;

    RETURN v_next_status;
END;
$$;

-- 10B. RPC: record_notification_delivery_failure
-- Compatible wrapper for worker callers using record_notification_delivery_failure naming convention.
CREATE OR REPLACE FUNCTION public.record_notification_delivery_failure(
    p_delivery_id uuid,
    p_worker_id varchar(64),
    p_reservation_token uuid,
    p_error_code text,
    p_error_message text,
    p_retry_after_seconds integer DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    RETURN public.fail_or_retry_notification_delivery(
        p_delivery_id,
        p_worker_id,
        p_reservation_token,
        p_error_code,
        p_error_message,
        p_retry_after_seconds
    );
END;
$$;

-- 11. RPC: sweep_expired_delivery_reservations
-- Sweeps dead worker reservations back to pending.
CREATE OR REPLACE FUNCTION public.sweep_expired_delivery_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_swept integer := 0;
BEGIN
    UPDATE public.notification_deliveries
    SET delivery_status = CASE WHEN retry_count < max_retries THEN 'pending' ELSE 'failed' END,
        lease_token = NULL,
        lease_expires_at = NULL,
        worker_id = NULL,
        retry_count = CASE WHEN retry_count < max_retries THEN retry_count + 1 ELSE retry_count END,
        updated_at = NOW()
    WHERE delivery_status = 'leased'
      AND lease_expires_at <= NOW();

    GET DIAGNOSTICS v_swept = ROW_COUNT;
    RETURN v_swept;
END;
$$;

-- 12. RPC: record_notification_telemetry
-- Anti-replay telemetry ingestion.
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
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    INSERT INTO public.notification_telemetry (
        delivery_id, campaign_id, recipient_type, recipient_id,
        event_type, event_nonce, client_timestamp, client_metadata
    )
    VALUES (
        p_delivery_id, p_campaign_id, p_recipient_type, p_recipient_id,
        p_event_type, p_event_nonce, p_client_timestamp, p_client_metadata
    )
    ON CONFLICT (delivery_id, event_type, event_nonce) DO NOTHING;

    -- Update campaign open / click metrics
    IF p_event_type IN ('opened', 'displayed') THEN
        UPDATE public.notification_campaigns
        SET open_count = open_count + 1, updated_at = NOW()
        WHERE id = p_campaign_id;
    ELSIF p_event_type = 'clicked' THEN
        UPDATE public.notification_campaigns
        SET click_count = click_count + 1, updated_at = NOW()
        WHERE id = p_campaign_id;
    END IF;

    RETURN true;
END;
$$;

