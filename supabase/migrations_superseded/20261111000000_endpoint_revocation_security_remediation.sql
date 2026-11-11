-- Migration: 20261111000000_endpoint_revocation_security_remediation.sql
-- Description: Endpoint Revocation & Reauthorization Security Hardening
--              1. Prevents silent reactivation of revoked endpoints via compatibility view triggers.
--              2. Enforces trusted-caller gating (service_role or database admin) for reauthorization.
--              3. Prevents unauthorized ownership reassignment on compatibility view updates.
--              4. Atomically clears historical revoked_at and revocation_reason on explicit reauthorization.
--              5. Hardens reserve_notification_deliveries to filter out revoked_at AND revocation_reason.
--              6. Hardens authorize_notification_delivery_dispatch to reject revoked endpoints symmetrically.
--              7. Reconciles existing production endpoints with inconsistent revocation states.

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
    -- Step 1: Read and lock the physical base table record to serialize concurrent operations
    SELECT e.is_active, e.revoked_at, e.revocation_reason, e.user_id
    INTO v_base_is_active, v_base_revoked_at, v_base_revocation_reason, v_base_user_id
    FROM public.notification_endpoints e
    WHERE e.id = OLD.id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- Step 2: Establish trusted caller provenance (service_role or verified database admin)
    -- Crucial: Inside a SECURITY DEFINER function owned by postgres, current_user is always postgres!
    -- Therefore, caller trust MUST be verified via auth.role(), session_user, or admin membership.
    v_is_trusted_caller := (
        COALESCE(auth.role(), '') = 'service_role'
        OR (auth.role() IS NULL AND session_user IN ('postgres', 'supabase_admin'))
        OR public.notifications_is_admin()
    );

    -- Step 3: Symmetrical evaluation of current revocation status across all markers
    v_is_currently_revoked := (
        v_base_is_active = false
        OR v_base_revoked_at IS NOT NULL
        OR v_base_revocation_reason IS NOT NULL
        OR OLD.is_active = false
        OR OLD.revoked_at IS NOT NULL
    );

    -- Step 4: Ownership transfer validation
    v_is_ownership_transfer := (NEW.user_id IS DISTINCT FROM v_base_user_id);
    IF v_is_ownership_transfer AND NOT v_is_trusted_caller THEN
        -- Prevent unauthorized ownership reassignment by direct view callers
        v_final_user_id := v_base_user_id;
    ELSE
        v_final_user_id := COALESCE(NEW.user_id, v_base_user_id);
    END IF;

    -- Step 5: Explicit reauthorization determination
    -- Reauthorization is ONLY valid when executed by a trusted caller (e.g. deviceTokenService via register API)
    -- with explicit intent (NEW.is_active = true AND NEW.revoked_at IS NULL).
    v_explicit_reauthorize := (
        v_is_trusted_caller
        AND NEW.is_active = true
        AND NEW.revoked_at IS NULL
        AND v_is_currently_revoked
    );

    -- Step 6: Enforce anti-silent-reactivation guard and state resolution
    IF v_is_currently_revoked THEN
        IF v_explicit_reauthorize THEN
            -- Legitimate, authorized reauthorization: atomically clear all revocation markers
            v_final_is_active := true;
            v_final_revoked_at := NULL;
            v_final_revocation_reason := NULL;
        ELSE
            -- Untrusted direct view update, silent client heartbeat, or un-reauthorized ownership transfer:
            -- Force endpoint to remain revoked and preserve historical revocation metadata.
            v_final_is_active := false;
            v_final_revoked_at := COALESCE(v_base_revoked_at, OLD.revoked_at, NOW());
            v_final_revocation_reason := COALESCE(v_base_revocation_reason, 'previously_revoked');
        END IF;
    ELSE
        -- Endpoint was not previously revoked
        IF NEW.is_active = false THEN
            -- Explicit voluntary deactivation by user or API
            v_final_is_active := false;
            v_final_revoked_at := COALESCE(NEW.revoked_at, NOW());
            v_final_revocation_reason := COALESCE(v_base_revocation_reason, 'user_revoked');
        ELSE
            -- Normal heartbeat / metadata refresh on active endpoint
            v_final_is_active := true;
            v_final_revoked_at := NULL;
            v_final_revocation_reason := NULL;
        END IF;
    END IF;

    -- Step 7: Apply atomic update on physical base table
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

    RETURN NEW;
END;
$$;

-- Ensure compatibility trigger is attached to view
DROP TRIGGER IF EXISTS trg_tokens_update ON public.notification_tokens;
CREATE TRIGGER trg_tokens_update
INSTEAD OF UPDATE ON public.notification_tokens
FOR EACH ROW EXECUTE FUNCTION public.trg_compat_notification_tokens_update();

-- 2. Hardened reservation query: symmetrically filter out revoked_at AND revocation_reason
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

-- 3. Hardened dispatch authorization: symmetrically reject revoked_at AND revocation_reason
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

    -- Preflight check on target endpoint: Lock row FOR SHARE to serialize against concurrent revocation
    -- while preserving active AND zero revocation marker invariants
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

    -- Endpoint recipient ownership check (null-safe for guest support)
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

-- 4. Reconcile ALL existing endpoints having inconsistent revocation states
-- Handles:
-- - State 2: is_active = true AND revoked_at IS NOT NULL (e.g. faa972b2-3cd7-4ed9-bb67-f931ca6a0601)
-- - State 3: is_active = true AND revocation_reason IS NOT NULL
-- - State 4: is_active = true AND both markers present
UPDATE public.notification_endpoints
SET is_active = false,
    revoked_at = COALESCE(revoked_at, NOW()),
    revocation_reason = COALESCE(revocation_reason, 'legacy_inconsistent_state_reconciled'),
    updated_at = NOW()
WHERE is_active = true 
  AND (revoked_at IS NOT NULL OR revocation_reason IS NOT NULL);

-- 5. Explicit Least-Privilege Grants
REVOKE ALL ON FUNCTION public.reserve_notification_deliveries(varchar, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_notification_deliveries(varchar, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.authorize_notification_delivery_dispatch(uuid, uuid, uuid, varchar, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authorize_notification_delivery_dispatch(uuid, uuid, uuid, varchar, uuid) TO service_role;

COMMIT;
