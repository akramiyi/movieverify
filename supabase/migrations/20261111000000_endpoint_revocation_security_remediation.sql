-- Migration: 20261111000000_endpoint_revocation_security_remediation.sql
-- Description: Endpoint Revocation & Reauthorization Security Hardening
--              1. Prevents silent reactivation of revoked endpoints via compatibility view triggers.
--              2. Clears historical revoked_at on explicit reauthorization or ownership transfer.
--              3. Hardens reserve_notification_deliveries to filter out revoked_at IS NOT NULL.
--              4. Hardens authorize_notification_delivery_dispatch to reject endpoints with revoked_at IS NOT NULL.
--              5. Reconciles existing production endpoints with is_active = true and revoked_at IS NOT NULL.

BEGIN;

SET LOCAL lock_timeout = '3s';

-- 1. Correct trg_compat_notification_tokens_update trigger function
CREATE OR REPLACE FUNCTION public.trg_compat_notification_tokens_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_is_ownership_transfer boolean;
    v_explicit_reauthorize boolean;
    v_final_is_active boolean;
    v_final_revoked_at timestamptz;
BEGIN
    v_is_ownership_transfer := (NEW.user_id IS DISTINCT FROM OLD.user_id);
    v_explicit_reauthorize := (NEW.revoked_at IS NULL AND OLD.revoked_at IS NOT NULL);

    -- Security Guard: If endpoint was revoked, do not silently reactivate via normal update.
    -- Reactivation is only permitted if NEW.revoked_at is explicitly NULL or ownership is transferred.
    IF OLD.revoked_at IS NOT NULL AND NEW.is_active = true AND NOT v_is_ownership_transfer AND NOT v_explicit_reauthorize THEN
        v_final_is_active := false;
        v_final_revoked_at := OLD.revoked_at;
    ELSE
        v_final_is_active := COALESCE(NEW.is_active, OLD.is_active);
        v_final_revoked_at := CASE 
            WHEN v_final_is_active = false THEN COALESCE(NEW.revoked_at, OLD.revoked_at, NOW())
            WHEN v_explicit_reauthorize OR v_is_ownership_transfer THEN NULL
            ELSE OLD.revoked_at 
        END;
    END IF;

    UPDATE public.notification_endpoints
    SET user_id = COALESCE(NEW.user_id, OLD.user_id),
        token = COALESCE(NEW.token, OLD.token),
        device_type = COALESCE(NEW.device_type, OLD.device_type),
        device_name = COALESCE(NEW.device_name, OLD.device_name),
        browser = COALESCE(NEW.browser, OLD.browser),
        os = COALESCE(NEW.os, OLD.os),
        is_active = v_final_is_active,
        revoked_at = v_final_revoked_at,
        revocation_reason = CASE 
            WHEN v_final_is_active = true THEN NULL 
            WHEN NEW.is_active = false THEN COALESCE(notification_endpoints.revocation_reason, 'user_revoked')
            ELSE notification_endpoints.revocation_reason 
        END,
        last_seen_at = COALESCE(NEW.last_seen_at, NOW()),
        updated_at = NOW()
    WHERE id = OLD.id;

    RETURN NEW;
END;
$$;

-- 2. Hardened reservation query: filter out revoked_at IS NOT NULL
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
          AND e.revoked_at IS NULL
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

-- 3. Hardened dispatch authorization: reject revoked_at IS NOT NULL
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
    -- Step 1: Pre-read immutable campaign_id
    SELECT campaign_id INTO v_camp_id
    FROM public.notification_deliveries
    WHERE id = p_delivery_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'DELIVERY_NOT_FOUND');
    END IF;

    -- Step 2: Lock Campaign row FIRST FOR SHARE
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

    -- Step 3: Lock Delivery row SECOND FOR UPDATE
    SELECT * INTO v_delivery
    FROM public.notification_deliveries
    WHERE id = p_delivery_id
    FOR UPDATE;

    -- Defensive invariant: campaign_id relation cannot mutate
    IF v_delivery.campaign_id IS DISTINCT FROM v_camp_id THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'CAMPAIGN_RELATION_MUTATED');
    END IF;

    -- Verify lease fence
    IF v_delivery.delivery_status != 'leased' OR
       v_delivery.lease_token IS DISTINCT FROM p_reservation_token OR
       v_delivery.worker_id IS DISTINCT FROM p_worker_id THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'FENCE_TOKEN_MISMATCH');
    END IF;

    -- Single-sender exclusivity: only one authorization granted per lease
    IF v_delivery.dispatch_attempt_id IS NOT NULL THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'ALREADY_AUTHORIZED_FOR_DISPATCH');
    END IF;

    -- Verify lease expiry
    IF v_delivery.lease_expires_at <= NOW() THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'LEASE_EXPIRED');
    END IF;

    -- Unconditional NULL-safe caller parameter validation
    IF p_token_id IS DISTINCT FROM v_delivery.endpoint_id THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'TOKEN_MISMATCH');
    END IF;

    IF p_recipient_id IS DISTINCT FROM v_delivery.recipient_id THEN
        RETURN jsonb_build_object('authorized', false, 'reason', 'RECIPIENT_MISMATCH');
    END IF;

    -- Preflight check on target endpoint: Enforce is_active = true AND revoked_at IS NULL
    SELECT * INTO v_endpoint
    FROM public.notification_endpoints
    WHERE id = v_delivery.endpoint_id;

    IF NOT FOUND OR NOT v_endpoint.is_active OR v_endpoint.revoked_at IS NOT NULL THEN
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

    -- Generate and atomically bind new dispatch attempt ID
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

-- 4. Reconcile existing endpoints having inconsistent state (is_active = true and revoked_at IS NOT NULL)
UPDATE public.notification_endpoints
SET is_active = false,
    updated_at = NOW()
WHERE revoked_at IS NOT NULL AND is_active = true;

-- 5. Explicit Least-Privilege Grants
REVOKE ALL ON FUNCTION public.reserve_notification_deliveries(varchar, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_notification_deliveries(varchar, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.authorize_notification_delivery_dispatch(uuid, uuid, uuid, varchar, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authorize_notification_delivery_dispatch(uuid, uuid, uuid, varchar, uuid) TO service_role;

COMMIT;
