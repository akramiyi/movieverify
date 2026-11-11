-- Migration: 20261111180000_unified_notification_dispatch_and_revocation.sql
-- Phase 5.9.5: Unified Forward-Only Production Remediation
-- Target Baseline: Production migrations 20261108000001 through 20261108195246
--                  (also idempotent if applied after local B5D/B5E/5.2/5.4 migrations)
--
-- Consolidates B5D concurrency/attempt fencing, working-tree B5E revocation
-- hardening, and Phase 5.4 security fixes while remediating additional defects:
--   1. Adds dispatch_attempt_id and partial attempt index cleanly (no speculative columns).
--   2. Fixes cancel_notification_campaign() SECURITY DEFINER authorization
--      (never trusts current_user; verifies auth.role()/session_user/notifications_is_admin()).
--   3. Repairs trg_validate_delivery_ownership() so legitimate terminal transitions
--      (failed/cancelled/expired/sent/delivered) succeed when identity columns are
--      unchanged, while still rejecting identity/endpoint mutations and active mismatches.
--   4. Hardens reserve_notification_deliveries() & authorize_notification_delivery_dispatch()
--      with FOR UPDATE/FOR SHARE serialization, symmetric revocation checks, and
--      recipient/token/provider_token bindings.
--   5. Enforces role-gated anti-silent-reactivation in trg_compat_notification_tokens_update().
--   6. Orders sweep_expired_delivery_reservations() deterministically (ORDER BY id ASC
--      FOR UPDATE SKIP LOCKED) and transitions revoked/transferred leases cleanly to failed.
--   7. Safely reconciles inconsistent notification_endpoints in place without deleting rows.
--   8. Enforces explicit REVOKE ALL / GRANT EXECUTE ACLs on every function.

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Schema Addition: dispatch_attempt_id & Partial Index
-- ----------------------------------------------------------------------------
ALTER TABLE public.notification_deliveries
ADD COLUMN IF NOT EXISTS dispatch_attempt_id uuid DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_attempt
ON public.notification_deliveries (id, dispatch_attempt_id)
WHERE dispatch_attempt_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. Repair trg_validate_delivery_ownership()
--    - Enforces ownership + active endpoint on INSERT and active ('pending', 'leased') states.
--    - Never allows terminal status updates to bypass endpoint/identity mutations.
--    - Allows terminal failure/cancellation/completion transitions when identity columns
--      (endpoint_id, recipient_id, recipient_type, channel_type) remain unchanged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_validate_delivery_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_endpoint record;
    v_target_changed boolean;
BEGIN
    IF NEW.channel_type IN ('fcm', 'web_push') THEN
        IF NEW.endpoint_id IS NULL THEN
            IF TG_OP = 'UPDATE' THEN
                IF NEW.delivery_status IN ('pending', 'leased') THEN
                    NEW.delivery_status := 'failed';
                    NEW.provider_response := jsonb_build_object(
                        'error', 'ENDPOINT_DELETED',
                        'message', 'Endpoint was deleted prior to dispatch'
                    );
                    NEW.lease_token := NULL;
                    NEW.lease_expires_at := NULL;
                    RETURN NEW;
                ELSIF NEW.delivery_status IN ('sent', 'delivered', 'failed', 'expired', 'cancelled') THEN
                    RETURN NEW;
                END IF;
            END IF;
            RAISE EXCEPTION 'Push delivery requires non-null endpoint_id'
                USING ERRCODE = 'MV400';
        END IF;

        SELECT id, user_id, is_active INTO v_endpoint
        FROM public.notification_endpoints
        WHERE id = NEW.endpoint_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Referenced endpoint % does not exist', NEW.endpoint_id
                USING ERRCODE = 'MV404';
        END IF;

        IF (TG_OP = 'INSERT' OR NEW.delivery_status IN ('pending', 'leased')) AND v_endpoint.is_active = false THEN
            RAISE EXCEPTION 'Cannot schedule or update delivery to inactive or revoked endpoint %', NEW.endpoint_id
                USING ERRCODE = 'MV410';
        END IF;

        IF TG_OP = 'INSERT' THEN
            v_target_changed := true;
        ELSE
            v_target_changed := (
                (NEW.endpoint_id IS DISTINCT FROM OLD.endpoint_id)
                OR (NEW.recipient_id IS DISTINCT FROM OLD.recipient_id)
                OR (NEW.recipient_type IS DISTINCT FROM OLD.recipient_type)
                OR (NEW.channel_type IS DISTINCT FROM OLD.channel_type)
            );
        END IF;

        IF NEW.recipient_type = 'user' THEN
            IF NEW.recipient_id IS NULL THEN
                RAISE EXCEPTION 'User delivery requires non-null recipient_id'
                    USING ERRCODE = 'MV400';
            END IF;

            IF (v_target_changed OR NEW.delivery_status IN ('pending', 'leased'))
               AND (v_endpoint.user_id IS NULL OR v_endpoint.user_id != NEW.recipient_id) THEN
                RAISE EXCEPTION 'Ownership mismatch: endpoint % (owned by %) does not belong to recipient %',
                    NEW.endpoint_id, COALESCE(v_endpoint.user_id::text, 'guest'), NEW.recipient_id
                    USING ERRCODE = 'MV403';
            END IF;
        ELSIF NEW.recipient_type = 'guest' THEN
            IF NEW.recipient_id IS NOT NULL THEN
                RAISE EXCEPTION 'Guest delivery must have null recipient_id'
                    USING ERRCODE = 'MV400';
            END IF;

            IF (v_target_changed OR NEW.delivery_status IN ('pending', 'leased'))
               AND v_endpoint.user_id IS NOT NULL THEN
                RAISE EXCEPTION 'Guest delivery cannot target authenticated user endpoint %', NEW.endpoint_id
                    USING ERRCODE = 'MV403';
            END IF;
        ELSE
            RAISE EXCEPTION 'Unsupported recipient_type: %', NEW.recipient_type
                USING ERRCODE = 'MV400';
        END IF;

    ELSIF NEW.channel_type = 'in_app' THEN
        IF NEW.endpoint_id IS NOT NULL THEN
            RAISE EXCEPTION 'In-app delivery must not reference a physical push endpoint'
                USING ERRCODE = 'MV400';
        END IF;

        IF NEW.recipient_type != 'user' OR NEW.recipient_id IS NULL THEN
            RAISE EXCEPTION 'In-app delivery requires an authenticated recipient user'
                USING ERRCODE = 'MV400';
        END IF;
    ELSE
        RAISE EXCEPTION 'Unsupported delivery channel type: %', NEW.channel_type
            USING ERRCODE = 'MV400';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_validate_delivery_ownership() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_delivery_ownership_guard ON public.notification_deliveries;
CREATE TRIGGER trg_delivery_ownership_guard
BEFORE INSERT OR UPDATE OF endpoint_id, recipient_id, recipient_type, channel_type, delivery_status ON public.notification_deliveries
FOR EACH ROW EXECUTE FUNCTION public.trg_validate_delivery_ownership();

-- ----------------------------------------------------------------------------
-- 3. Compatibility View Anti-Silent-Reactivation Trigger (Working-Tree B5E)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_compat_notification_tokens_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_base_is_active boolean;
    v_base_revoked_at timestamptz;
    v_base_revocation_reason text;
    v_base_user_id uuid;
    v_is_trusted_caller boolean;
    v_is_currently_revoked boolean;
    v_is_ownership_transfer boolean;
    v_explicit_reauthorize boolean;
    v_final_is_active boolean;
    v_final_revoked_at timestamptz;
    v_final_revocation_reason text;
    v_final_user_id uuid;
BEGIN
    SELECT e.is_active, e.revoked_at, e.revocation_reason, e.user_id
    INTO v_base_is_active, v_base_revoked_at, v_base_revocation_reason, v_base_user_id
    FROM public.notification_endpoints e
    WHERE e.id = OLD.id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    v_is_trusted_caller := (
        COALESCE(auth.role(), '') = 'service_role'
        OR (auth.role() IS NULL AND session_user IN ('postgres', 'supabase_admin'))
        OR public.notifications_is_admin()
    );

    v_is_currently_revoked := (
        v_base_is_active = false
        OR v_base_revoked_at IS NOT NULL
        OR v_base_revocation_reason IS NOT NULL
        OR OLD.is_active = false
        OR OLD.revoked_at IS NOT NULL
    );

    v_is_ownership_transfer := (NEW.user_id IS DISTINCT FROM v_base_user_id);
    IF v_is_ownership_transfer AND NOT v_is_trusted_caller THEN
        v_final_user_id := v_base_user_id;
    ELSE
        v_final_user_id := COALESCE(NEW.user_id, v_base_user_id);
    END IF;

    v_explicit_reauthorize := (
        v_is_trusted_caller
        AND NEW.is_active = true
        AND NEW.revoked_at IS NULL
        AND v_is_currently_revoked
    );

    IF v_is_currently_revoked THEN
        IF v_explicit_reauthorize THEN
            v_final_is_active := true;
            v_final_revoked_at := NULL;
            v_final_revocation_reason := NULL;
        ELSE
            v_final_is_active := false;
            v_final_revoked_at := COALESCE(v_base_revoked_at, OLD.revoked_at, NOW());
            v_final_revocation_reason := COALESCE(v_base_revocation_reason, 'previously_revoked');
        END IF;
    ELSE
        IF NEW.is_active = false THEN
            v_final_is_active := false;
            v_final_revoked_at := COALESCE(NEW.revoked_at, NOW());
            v_final_revocation_reason := COALESCE(v_base_revocation_reason, 'user_revoked');
        ELSE
            v_final_is_active := true;
            v_final_revoked_at := NULL;
            v_final_revocation_reason := NULL;
        END IF;
    END IF;

    UPDATE public.notification_endpoints
    SET user_id = v_final_user_id,
        token = COALESCE(NEW.token, OLD.token),
        device_type = COALESCE(NEW.device_type, OLD.device_type),
        device_name = COALESCE(NEW.device_name, OLD.device_name),
        browser = COALESCE(NEW.browser, OLD.browser),
        os = COALESCE(NEW.os, OLD.os),
        is_active = v_final_is_active,
        revoked_at = v_final_revoked_at,
        revocation_reason = v_final_revocation_reason,
        last_seen_at = COALESCE(NEW.last_seen_at, NOW()),
        updated_at = NOW()
    WHERE id = OLD.id;

    NEW.user_id := v_final_user_id;
    NEW.is_active := v_final_is_active;
    NEW.revoked_at := v_final_revoked_at;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_compat_notification_tokens_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tokens_update ON public.notification_tokens;
CREATE TRIGGER trg_tokens_update
INSTEAD OF UPDATE ON public.notification_tokens
FOR EACH ROW EXECUTE FUNCTION public.trg_compat_notification_tokens_update();

-- ----------------------------------------------------------------------------
-- 4. Remediated cancel_notification_campaign(uuid) (Phase 5.4 Trusted-Caller Fix)
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
    v_is_service := (
        COALESCE(auth.role(), '') = 'service_role'
        OR (auth.role() IS NULL AND session_user IN ('postgres', 'supabase_admin'))
    );
    v_is_admin := public.notifications_is_admin();

    IF NOT v_is_service AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Forbidden: Administrator privileges required' USING ERRCODE = 'MV403';
    END IF;

    -- Lock Campaign row FIRST FOR UPDATE
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

    -- Cancel pending and leased deliveries SECOND
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

    v_actor_id := CASE WHEN v_is_service THEN NULL ELSE auth.uid() END;
    v_actor_role := CASE WHEN v_is_service THEN 'service_role' ELSE 'admin' END;

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

-- ----------------------------------------------------------------------------
-- 5. Hardened reserve_notification_deliveries()
-- ----------------------------------------------------------------------------
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
        JOIN public.notification_campaigns c ON c.id = d.campaign_id
        WHERE d.delivery_status = 'pending'
          AND (d.next_retry_at IS NULL OR d.next_retry_at <= NOW())
          AND c.status IN ('queued', 'processing')
          AND e.is_active = true
          AND e.revoked_at IS NULL
          AND e.revocation_reason IS NULL
          AND (e.user_id IS NOT DISTINCT FROM d.recipient_id)
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
            dispatch_attempt_id = NULL,
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

-- ----------------------------------------------------------------------------
-- 6. Hardened authorize_notification_delivery_dispatch()
-- ----------------------------------------------------------------------------
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
    v_camp_id uuid;
    v_camp_status varchar(24);
    v_delivery record;
    v_endpoint record;
    v_attempt_id uuid;
BEGIN
    SELECT campaign_id INTO v_camp_id
    FROM public.notification_deliveries
    WHERE id = p_delivery_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'DELIVERY_NOT_FOUND');
    END IF;

    -- Lock Campaign row FIRST FOR SHARE
    SELECT status INTO v_camp_status
    FROM public.notification_campaigns
    WHERE id = v_camp_id
    FOR SHARE;

    IF NOT FOUND OR v_camp_status NOT IN ('queued', 'processing') THEN
        UPDATE public.notification_deliveries
        SET delivery_status = 'cancelled',
            lease_token = NULL,
            lease_expires_at = NULL,
            worker_id = NULL,
            dispatch_attempt_id = NULL,
            updated_at = NOW()
        WHERE id = p_delivery_id;

        RETURN jsonb_build_object('authorized', false, 'reason', 'CAMPAIGN_INELIGIBLE_OR_CANCELLED');
    END IF;

    -- Lock Delivery row SECOND FOR UPDATE
    SELECT * INTO v_delivery
    FROM public.notification_deliveries
    WHERE id = p_delivery_id
    FOR UPDATE;

    IF v_delivery.campaign_id IS DISTINCT FROM v_camp_id THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'CAMPAIGN_RELATION_MUTATED');
    END IF;

    IF v_delivery.delivery_status != 'leased' OR
       v_delivery.lease_token IS DISTINCT FROM p_reservation_token OR
       v_delivery.worker_id IS DISTINCT FROM p_worker_id THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'FENCE_TOKEN_MISMATCH');
    END IF;

    IF v_delivery.dispatch_attempt_id IS NOT NULL THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'ALREADY_AUTHORIZED_FOR_DISPATCH');
    END IF;

    IF v_delivery.lease_expires_at <= NOW() THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'LEASE_EXPIRED');
    END IF;

    IF p_token_id IS DISTINCT FROM v_delivery.endpoint_id THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'TOKEN_MISMATCH');
    END IF;

    IF p_recipient_id IS DISTINCT FROM v_delivery.recipient_id THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'RECIPIENT_MISMATCH');
    END IF;

    -- Lock Endpoint row THIRD FOR SHARE
    SELECT * INTO v_endpoint
    FROM public.notification_endpoints
    WHERE id = v_delivery.endpoint_id
    FOR SHARE;

    IF NOT FOUND
       OR NOT v_endpoint.is_active
       OR v_endpoint.revoked_at IS NOT NULL
       OR v_endpoint.revocation_reason IS NOT NULL THEN
        UPDATE public.notification_deliveries
        SET delivery_status = 'failed',
            lease_token = NULL,
            lease_expires_at = NULL,
            worker_id = NULL,
            dispatch_attempt_id = NULL,
            provider_response = jsonb_build_object('error', 'ENDPOINT_REVOKED_OR_INACTIVE'),
            updated_at = NOW()
        WHERE id = p_delivery_id;

        RETURN jsonb_build_object('authorized', false, 'reason', 'ENDPOINT_REVOKED_OR_INACTIVE');
    END IF;

    IF v_endpoint.user_id IS DISTINCT FROM v_delivery.recipient_id THEN
        UPDATE public.notification_deliveries
        SET delivery_status = 'failed',
            lease_token = NULL,
            lease_expires_at = NULL,
            worker_id = NULL,
            dispatch_attempt_id = NULL,
            provider_response = jsonb_build_object('error', 'RECIPIENT_OWNERSHIP_MISMATCH'),
            updated_at = NOW()
        WHERE id = p_delivery_id;

        RETURN jsonb_build_object('authorized', false, 'reason', 'RECIPIENT_OWNERSHIP_MISMATCH');
    END IF;

    v_attempt_id := gen_random_uuid();

    UPDATE public.notification_deliveries
    SET dispatch_attempt_id = v_attempt_id,
        updated_at = NOW()
    WHERE id = p_delivery_id;

    RETURN jsonb_build_object(
        'authorized', true,
        'dispatch_attempt_id', v_attempt_id,
        'provider_token', v_endpoint.token,
        'endpoint_hash', v_endpoint.endpoint_hash,
        'channel_type', v_delivery.channel_type
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. confirm_notification_delivery_sent(), fail_or_retry_notification_delivery(),
--    and record_notification_delivery_failure()
-- ----------------------------------------------------------------------------
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
    SELECT campaign_id INTO v_camp_id
    FROM public.notification_deliveries
    WHERE id = p_delivery_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'reason', 'DELIVERY_NOT_FOUND');
    END IF;

    -- Lock Campaign row FIRST FOR UPDATE
    SELECT id INTO v_camp_id
    FROM public.notification_campaigns
    WHERE id = v_camp_id
    FOR UPDATE;

    -- Atomic CAS on Delivery row SECOND
    UPDATE public.notification_deliveries
    SET delivery_status = 'sent',
        provider_message_id = p_fcm_message_id,
        provider_status_code = 200,
        sent_at = NOW(),
        lease_token = NULL,
        lease_expires_at = NULL,
        worker_id = NULL,
        dispatch_attempt_id = NULL,
        updated_at = NOW()
    WHERE id = p_delivery_id
      AND delivery_status = 'leased'
      AND dispatch_attempt_id = p_dispatch_attempt_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'reason', 'CAS_FAILED_OR_LEASE_LOST');
    END IF;

    UPDATE public.notification_campaigns
    SET sent_count = sent_count + 1,
        success_count = success_count + 1,
        updated_at = NOW()
    WHERE id = v_camp_id;

    RETURN jsonb_build_object('success', true);
END;
$$;

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
    v_camp_id uuid;
    v_delivery record;
    v_endpoint record;
    v_is_permanent boolean := false;
    v_endpoint_invalid boolean := false;
    v_next_status varchar(24);
    v_retry_delay integer;
BEGIN
    SELECT campaign_id INTO v_camp_id
    FROM public.notification_deliveries
    WHERE id = p_delivery_id;

    IF NOT FOUND THEN
        RETURN 'conflict';
    END IF;

    -- Lock Campaign row FIRST FOR UPDATE
    SELECT id INTO v_camp_id
    FROM public.notification_campaigns
    WHERE id = v_camp_id
    FOR UPDATE;

    -- Lock Delivery row SECOND FOR UPDATE
    SELECT * INTO v_delivery
    FROM public.notification_deliveries
    WHERE id = p_delivery_id
    FOR UPDATE;

    IF NOT FOUND OR
       v_delivery.delivery_status != 'leased' OR
       v_delivery.lease_token IS DISTINCT FROM p_reservation_token OR
       v_delivery.worker_id IS DISTINCT FROM p_worker_id THEN
        RETURN 'conflict';
    END IF;

    IF p_error_code IN ('UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH', 'PROVIDER_TOKEN_MISMATCH') THEN
        v_is_permanent := true;
    END IF;

    -- Check endpoint validity THIRD (FOR SHARE) if considering a retry back to 'pending'
    IF NOT v_is_permanent AND v_delivery.retry_count < v_delivery.max_retries AND v_delivery.endpoint_id IS NOT NULL THEN
        SELECT id, user_id, is_active, revoked_at, revocation_reason INTO v_endpoint
        FROM public.notification_endpoints
        WHERE id = v_delivery.endpoint_id
        FOR SHARE;

        IF NOT FOUND
           OR NOT v_endpoint.is_active
           OR v_endpoint.revoked_at IS NOT NULL
           OR v_endpoint.revocation_reason IS NOT NULL
           OR (v_endpoint.user_id IS DISTINCT FROM v_delivery.recipient_id) THEN
            v_endpoint_invalid := true;
        END IF;
    END IF;

    IF NOT v_is_permanent AND NOT v_endpoint_invalid AND v_delivery.retry_count < v_delivery.max_retries THEN
        v_next_status := 'pending';
        v_retry_delay := COALESCE(p_retry_after_seconds, power(2, v_delivery.retry_count) * 30);

        UPDATE public.notification_deliveries
        SET delivery_status = 'pending',
            retry_count = retry_count + 1,
            next_retry_at = NOW() + (v_retry_delay || ' seconds')::interval,
            lease_token = NULL,
            lease_expires_at = NULL,
            worker_id = NULL,
            dispatch_attempt_id = NULL,
            provider_response = jsonb_build_object('error_code', p_error_code, 'message', p_error_message),
            updated_at = NOW()
        WHERE id = p_delivery_id;
    ELSE
        v_next_status := 'failed';

        UPDATE public.notification_deliveries
        SET delivery_status = 'failed',
            lease_token = NULL,
            lease_expires_at = NULL,
            worker_id = NULL,
            dispatch_attempt_id = NULL,
            provider_response = jsonb_build_object(
                'error_code', CASE WHEN v_endpoint_invalid THEN 'ENDPOINT_INVALID_OR_TRANSFERRED' ELSE p_error_code END,
                'message', p_error_message
            ),
            updated_at = NOW()
        WHERE id = p_delivery_id;

        UPDATE public.notification_campaigns
        SET failure_count = failure_count + 1,
            updated_at = NOW()
        WHERE id = v_delivery.campaign_id;

        IF p_error_code = 'UNREGISTERED' AND v_delivery.endpoint_id IS NOT NULL THEN
            UPDATE public.notification_endpoints
            SET is_active = false,
                revoked_at = COALESCE(revoked_at, NOW()),
                revocation_reason = 'fcm_unregistered',
                updated_at = NOW()
            WHERE id = v_delivery.endpoint_id;
        END IF;
    END IF;

    RETURN v_next_status;
END;
$$;

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

-- ----------------------------------------------------------------------------
-- 8. Deterministically Locked sweep_expired_delivery_reservations()
--    Uses ORDER BY d.id ASC + FOR UPDATE OF d SKIP LOCKED to avoid multi-row
--    deadlocks against concurrent cancel_notification_campaign().
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sweep_expired_delivery_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_swept integer := 0;
BEGIN
    WITH expired AS (
        SELECT
            d.id,
            (
                d.retry_count < d.max_retries
                AND (
                    d.endpoint_id IS NULL
                    OR (
                        e.id IS NOT NULL
                        AND e.is_active = true
                        AND e.revoked_at IS NULL
                        AND e.revocation_reason IS NULL
                        AND (e.user_id IS NOT DISTINCT FROM d.recipient_id)
                    )
                )
            ) AS can_retry,
            (
                d.endpoint_id IS NOT NULL
                AND (
                    e.id IS NULL
                    OR NOT e.is_active
                    OR e.revoked_at IS NOT NULL
                    OR e.revocation_reason IS NOT NULL
                    OR (e.user_id IS DISTINCT FROM d.recipient_id)
                )
            ) AS endpoint_invalid
        FROM public.notification_deliveries d
        LEFT JOIN public.notification_endpoints e ON e.id = d.endpoint_id
        WHERE d.delivery_status = 'leased'
          AND d.lease_expires_at <= NOW()
        ORDER BY d.id ASC
        FOR UPDATE OF d SKIP LOCKED
    )
    UPDATE public.notification_deliveries d
    SET delivery_status = CASE WHEN ex.can_retry THEN 'pending' ELSE 'failed' END,
        lease_token = NULL,
        lease_expires_at = NULL,
        worker_id = NULL,
        dispatch_attempt_id = NULL,
        retry_count = CASE WHEN ex.can_retry THEN d.retry_count + 1 ELSE d.retry_count END,
        provider_response = CASE
            WHEN NOT ex.can_retry THEN
                jsonb_build_object(
                    'error', CASE WHEN ex.endpoint_invalid THEN 'ENDPOINT_INVALID_ON_SWEEP' ELSE 'LEASE_EXPIRED_MAX_RETRIES' END
                )
            ELSE d.provider_response
        END,
        updated_at = NOW()
    FROM expired ex
    WHERE d.id = ex.id;

    GET DIAGNOSTICS v_swept = ROW_COUNT;
    RETURN v_swept;
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. Safe In-Place Reconciliation of Inconsistent Endpoints
-- ----------------------------------------------------------------------------
UPDATE public.notification_endpoints
SET is_active = false,
    revoked_at = COALESCE(revoked_at, NOW()),
    revocation_reason = COALESCE(revocation_reason, 'legacy_inconsistent_state_reconciled'),
    updated_at = NOW()
WHERE is_active = true
  AND (revoked_at IS NOT NULL OR revocation_reason IS NOT NULL);

-- ----------------------------------------------------------------------------
-- 10. Explicit Least-Privilege Function ACLs
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.cancel_notification_campaign(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_notification_campaign(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reserve_notification_deliveries(varchar, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_notification_deliveries(varchar, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.authorize_notification_delivery_dispatch(uuid, uuid, uuid, varchar, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_notification_delivery_dispatch(uuid, uuid, uuid, varchar, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.confirm_notification_delivery_sent(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_notification_delivery_sent(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.fail_or_retry_notification_delivery(uuid, varchar, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_or_retry_notification_delivery(uuid, varchar, uuid, text, text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.record_notification_delivery_failure(uuid, varchar, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_notification_delivery_failure(uuid, varchar, uuid, text, text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.sweep_expired_delivery_reservations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_expired_delivery_reservations() TO service_role;

COMMIT;

