-- Migration: 20261110150000_notification_dispatch_hardening_and_concurrency.sql
-- Description: Production Hardening for Notification Dispatch Concurrency.
--              1. Adds dispatch_attempt_id to notification_deliveries.
--              2. Establishes hierarchical Campaign-first row locking to eliminate deadlocks (40P01).
--              3. Fences single-sender authorization per lease.
--              4. Fences worker_id in fail_or_retry.
--              5. Enforces unconditional null-safe parameter validation.
-- Baseline Commit: d8dd5df877a875221449b5338773aff6f1245294

BEGIN;

-- 1. Schema Addition: dispatch_attempt_id column & partial index
ALTER TABLE public.notification_deliveries
ADD COLUMN IF NOT EXISTS dispatch_attempt_id uuid DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_attempt
ON public.notification_deliveries (id, dispatch_attempt_id)
WHERE dispatch_attempt_id IS NOT NULL;


-- 2. RPC: cancel_notification_campaign
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
    IF current_user != 'service_role' AND current_user != 'postgres' AND NOT public.notifications_is_admin() THEN
        RAISE EXCEPTION 'Forbidden: Administrator privileges required' USING ERRCODE = 'MV403';
    END IF;

    -- Step 1: Lock Campaign row FIRST FOR UPDATE
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

    -- Transition campaign status
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

    -- Audit log entry
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


-- 3. RPC: reserve_notification_deliveries
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


-- 4. RPC: authorize_notification_delivery_dispatch
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

    -- Preflight check on target endpoint
    SELECT * INTO v_endpoint
    FROM public.notification_endpoints
    WHERE id = v_delivery.endpoint_id;

    IF NOT FOUND OR NOT v_endpoint.is_active THEN
        UPDATE public.notification_deliveries
        SET delivery_status = 'failed',
            lease_token = NULL,
            lease_expires_at = NULL,
            worker_id = NULL,
            dispatch_attempt_id = NULL,
            provider_response = jsonb_build_object('error', 'ENDPOINT_INACTIVE_PREFLIGHT'),
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

    -- Step 4: Grant single-sender dispatch authorization
    v_attempt_id := gen_random_uuid();

    UPDATE public.notification_deliveries
    SET dispatch_attempt_id = v_attempt_id,
        updated_at = NOW()
    WHERE id = p_delivery_id;

    RETURN jsonb_build_object(
        'authorized', true,
        'dispatch_attempt_id', v_attempt_id
    );
END;
$$;


-- 5. RPC: confirm_notification_delivery_sent
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
    -- Step 1: Pre-read immutable campaign_id
    SELECT campaign_id INTO v_camp_id
    FROM public.notification_deliveries
    WHERE id = p_delivery_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'reason', 'DELIVERY_NOT_FOUND');
    END IF;

    -- Step 2: Lock Campaign row FIRST FOR UPDATE
    SELECT id INTO v_camp_id
    FROM public.notification_campaigns
    WHERE id = v_camp_id
    FOR UPDATE;

    -- Step 3: Atomic CAS on Delivery row SECOND
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

    -- Step 4: Update campaign counters exactly once
    UPDATE public.notification_campaigns
    SET sent_count = sent_count + 1,
        success_count = success_count + 1,
        updated_at = NOW()
    WHERE id = v_camp_id;

    RETURN jsonb_build_object('success', true);
END;
$$;


-- 6. RPC: fail_or_retry_notification_delivery
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
    v_is_permanent boolean := false;
    v_next_status varchar(24);
    v_retry_delay integer;
BEGIN
    -- Step 1: Pre-read immutable campaign_id
    SELECT campaign_id INTO v_camp_id
    FROM public.notification_deliveries
    WHERE id = p_delivery_id;

    IF NOT FOUND THEN
        RETURN 'conflict';
    END IF;

    -- Step 2: Lock Campaign row FIRST FOR UPDATE
    SELECT id INTO v_camp_id
    FROM public.notification_campaigns
    WHERE id = v_camp_id
    FOR UPDATE;

    -- Step 3: Lock Delivery row SECOND FOR UPDATE
    SELECT * INTO v_delivery
    FROM public.notification_deliveries
    WHERE id = p_delivery_id
    FOR UPDATE;

    -- Hardened fence: validates both reservation_token AND worker_id
    IF NOT FOUND OR 
       v_delivery.delivery_status != 'leased' OR 
       v_delivery.lease_token IS DISTINCT FROM p_reservation_token OR
       v_delivery.worker_id IS DISTINCT FROM p_worker_id THEN
        RETURN 'conflict';
    END IF;

    IF p_error_code IN ('UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH') THEN
        v_is_permanent := true;
    END IF;

    IF NOT v_is_permanent AND v_delivery.retry_count < v_delivery.max_retries THEN
        -- Retryable path: returns to pending without incrementing failure counter
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
        -- Terminal failure: increments campaign failure counter exactly once
        v_next_status := 'failed';

        UPDATE public.notification_deliveries
        SET delivery_status = 'failed',
            lease_token = NULL,
            lease_expires_at = NULL,
            worker_id = NULL,
            dispatch_attempt_id = NULL,
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


-- 6B. RPC: record_notification_delivery_failure (Compatibility Wrapper)
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


-- 7. RPC: sweep_expired_delivery_reservations
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
        dispatch_attempt_id = NULL,
        retry_count = CASE WHEN retry_count < max_retries THEN retry_count + 1 ELSE retry_count END,
        updated_at = NOW()
    WHERE delivery_status = 'leased'
      AND lease_expires_at <= NOW();

    GET DIAGNOSTICS v_swept = ROW_COUNT;
    RETURN v_swept;
END;
$$;


-- 8. Explicit Least-Privilege DCL Grants
REVOKE ALL ON FUNCTION public.cancel_notification_campaign(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_notification_campaign(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reserve_notification_deliveries(varchar, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_notification_deliveries(varchar, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.authorize_notification_delivery_dispatch(uuid, uuid, uuid, varchar, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authorize_notification_delivery_dispatch(uuid, uuid, uuid, varchar, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.confirm_notification_delivery_sent(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_notification_delivery_sent(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.fail_or_retry_notification_delivery(uuid, varchar, uuid, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fail_or_retry_notification_delivery(uuid, varchar, uuid, text, text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.record_notification_delivery_failure(uuid, varchar, uuid, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_notification_delivery_failure(uuid, varchar, uuid, text, text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.sweep_expired_delivery_reservations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sweep_expired_delivery_reservations() TO service_role;

COMMIT;
