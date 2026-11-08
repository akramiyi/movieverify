-- ============================================================================
-- Migration: 20261108000004_notification_deliveries_and_telemetry.sql
-- Description: Creates notification_deliveries, notification_telemetry, and integrity triggers
-- Target: PostgreSQL 17 / Supabase
-- Architecture Baseline: Phase 1.9, v1.9.0
-- ============================================================================

-- Table 8: public.notification_deliveries
-- Per-device and in-app dispatch lifecycle tracking with recipient ownership verification.
CREATE TABLE IF NOT EXISTS public.notification_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES public.notification_campaigns(id) ON DELETE RESTRICT,
    recipient_type varchar(16) NOT NULL DEFAULT 'user' CHECK (recipient_type IN ('user', 'guest')),
    recipient_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint_id uuid REFERENCES public.notification_endpoints(id) ON DELETE SET NULL,
    channel_type varchar(16) NOT NULL CHECK (channel_type IN ('fcm', 'web_push', 'in_app')),
    delivery_status varchar(24) NOT NULL DEFAULT 'pending' CHECK (delivery_status IN (
        'pending', 'leased', 'sent', 'delivered', 'failed', 'expired', 'cancelled'
    )),
    provider_message_id text,
    provider_status_code smallint,
    provider_response jsonb,
    lease_token uuid,
    lease_expires_at timestamptz,
    worker_id varchar(64),
    retry_count smallint NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    max_retries smallint NOT NULL DEFAULT 2 CHECK (max_retries >= 0 AND max_retries <= 5),
    next_retry_at timestamptz,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),

    -- Relational consistency constraint:
    -- In-app requires user recipient and NULL endpoint.
    -- User push requires recipient_id and FCM/Web Push.
    -- Guest push requires NULL recipient_id and FCM/Web Push.
    CONSTRAINT chk_delivery_recipient_channel CHECK (
        (recipient_type = 'user' AND recipient_id IS NOT NULL AND channel_type = 'in_app' AND endpoint_id IS NULL) OR
        (recipient_type = 'user' AND recipient_id IS NOT NULL AND channel_type IN ('fcm', 'web_push')) OR
        (recipient_type = 'guest' AND recipient_id IS NULL AND channel_type IN ('fcm', 'web_push'))
    ),

    CONSTRAINT uq_deliveries_id_campaign UNIQUE (id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_deliveries_claim
ON public.notification_deliveries (delivery_status, next_retry_at, created_at)
WHERE delivery_status IN ('pending', 'leased');

CREATE INDEX IF NOT EXISTS idx_deliveries_recipient
ON public.notification_deliveries (recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deliveries_campaign
ON public.notification_deliveries (campaign_id, delivery_status);

-- Wire foreign key from user_notifications to notification_deliveries
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_user_notif_delivery' AND table_name = 'user_notifications'
    ) THEN
        ALTER TABLE public.user_notifications
        ADD CONSTRAINT fk_user_notif_delivery
        FOREIGN KEY (delivery_id) REFERENCES public.notification_deliveries(id) ON DELETE SET NULL;
    END IF;
END;
$$;

-- Table 9: public.notification_telemetry
-- Server-authoritative and client-reported delivery and engagement tracking.
CREATE TABLE IF NOT EXISTS public.notification_telemetry (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    recipient_type varchar(16) NOT NULL DEFAULT 'user' CHECK (recipient_type IN ('user', 'guest')),
    recipient_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    event_type varchar(32) NOT NULL CHECK (event_type IN (
        'dispatched', 'provider_accepted', 'provider_rejected', 'provider_unregistered',
        'device_received', 'displayed', 'opened', 'clicked', 'dismissed'
    )),
    event_nonce varchar(64) NOT NULL,
    client_timestamp timestamptz,
    client_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT NOW(),

    -- Composite FK enforcing exact campaign and delivery agreement
    CONSTRAINT fk_telemetry_delivery_campaign FOREIGN KEY (delivery_id, campaign_id)
        REFERENCES public.notification_deliveries(id, campaign_id) ON DELETE CASCADE,

    -- Anti-replay constraint: exactly one event of a given type per delivery and nonce
    CONSTRAINT uq_telemetry_delivery_event UNIQUE (delivery_id, event_type, event_nonce)
);

CREATE INDEX IF NOT EXISTS idx_telemetry_campaign_event
ON public.notification_telemetry (campaign_id, event_type);

CREATE INDEX IF NOT EXISTS idx_telemetry_delivery
ON public.notification_telemetry (delivery_id);

-- ============================================================================
-- TRIGGERS & INTEGRITY GUARDS
-- ============================================================================

-- 1. Delivery Ownership Validation Trigger
-- Enforces that push deliveries reference valid, active endpoints owned by the exact same recipient (or guest).
CREATE OR REPLACE FUNCTION public.trg_validate_delivery_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_endpoint record;
BEGIN
    -- 1. Push Channel Validation (FCM & Web Push)
    IF NEW.channel_type IN ('fcm', 'web_push') THEN
        -- Push deliveries require an explicit physical endpoint
        IF NEW.endpoint_id IS NULL THEN
            IF TG_OP = 'UPDATE' THEN
                -- If endpoint was deleted via ON DELETE SET NULL while delivery is active,
                -- transition delivery to failed with reason ENDPOINT_DELETED and clear lease
                IF NEW.delivery_status IN ('pending', 'leased') THEN
                    NEW.delivery_status := 'failed';
                    NEW.provider_response := jsonb_build_object(
                        'error', 'ENDPOINT_DELETED',
                        'message', 'Endpoint was deleted prior to dispatch'
                    );
                    NEW.lease_token := NULL;
                    NEW.lease_expires_at := NULL;
                    RETURN NEW;
                -- Terminal delivery history preserved intact
                ELSIF NEW.delivery_status IN ('sent', 'delivered', 'failed', 'expired', 'cancelled') THEN
                    RETURN NEW;
                END IF;
            END IF;
            RAISE EXCEPTION 'Push delivery requires non-null endpoint_id' 
                USING ERRCODE = 'MV400';
        END IF;

        -- Fetch target endpoint record
        SELECT id, user_id, is_active INTO v_endpoint
        FROM public.notification_endpoints
        WHERE id = NEW.endpoint_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Referenced endpoint % does not exist', NEW.endpoint_id 
                USING ERRCODE = 'MV404';
        END IF;

        -- Hardened Active State Check (Covers both INSERT and UPDATE on active delivery states)
        IF NEW.delivery_status IN ('pending', 'leased') AND v_endpoint.is_active = false THEN
            RAISE EXCEPTION 'Cannot schedule or update delivery to inactive or revoked endpoint %', NEW.endpoint_id 
                USING ERRCODE = 'MV410';
        END IF;

        -- Authenticated user push delivery: Endpoint must belong to recipient
        IF NEW.recipient_type = 'user' THEN
            IF NEW.recipient_id IS NULL THEN
                RAISE EXCEPTION 'User delivery requires non-null recipient_id' 
                    USING ERRCODE = 'MV400';
            END IF;

            IF v_endpoint.user_id IS NULL OR v_endpoint.user_id != NEW.recipient_id THEN
                RAISE EXCEPTION 'Ownership mismatch: endpoint % (owned by %) does not belong to recipient %',
                    NEW.endpoint_id, COALESCE(v_endpoint.user_id::text, 'guest'), NEW.recipient_id 
                    USING ERRCODE = 'MV403';
            END IF;

        -- Anonymous guest push delivery: Endpoint must NOT belong to an authenticated user
        ELSIF NEW.recipient_type = 'guest' THEN
            IF NEW.recipient_id IS NOT NULL THEN
                RAISE EXCEPTION 'Guest delivery must have null recipient_id' 
                    USING ERRCODE = 'MV400';
            END IF;

            IF v_endpoint.user_id IS NOT NULL THEN
                RAISE EXCEPTION 'Guest delivery cannot target authenticated user endpoint %', NEW.endpoint_id 
                    USING ERRCODE = 'MV403';
            END IF;
        END IF;

    -- 2. In-App Channel Validation
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

REVOKE ALL ON FUNCTION public.trg_validate_delivery_ownership() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_delivery_ownership_guard ON public.notification_deliveries;
CREATE TRIGGER trg_delivery_ownership_guard
BEFORE INSERT OR UPDATE OF endpoint_id, recipient_id, recipient_type, channel_type, delivery_status ON public.notification_deliveries
FOR EACH ROW EXECUTE FUNCTION public.trg_validate_delivery_ownership();

-- 2. Delivery Identity Immutability Trigger
-- Blocks subsequent updates on identity columns to preserve downstream referential consistency.
CREATE OR REPLACE FUNCTION public.trg_enforce_delivery_identity_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF (NEW.campaign_id IS DISTINCT FROM OLD.campaign_id) OR
       (NEW.recipient_type IS DISTINCT FROM OLD.recipient_type) OR
       (NEW.recipient_id IS DISTINCT FROM OLD.recipient_id) OR
       (NEW.channel_type IS DISTINCT FROM OLD.channel_type) THEN
        RAISE EXCEPTION 'Delivery identity fields (campaign_id, recipient_type, recipient_id, channel_type) are strictly immutable'
            USING ERRCODE = 'MV409';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_enforce_delivery_identity_immutability() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_delivery_identity_immutable ON public.notification_deliveries;
CREATE TRIGGER trg_delivery_identity_immutable
BEFORE UPDATE OF campaign_id, recipient_type, recipient_id, channel_type ON public.notification_deliveries
FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_delivery_identity_immutability();

-- 3. Telemetry Ingestion Agreement Trigger
-- Guarantees that telemetry records agree with the underlying delivery.
CREATE OR REPLACE FUNCTION public.trg_validate_telemetry_delivery_agreement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_delivery record;
BEGIN
    SELECT campaign_id, recipient_type, recipient_id
    INTO v_delivery
    FROM public.notification_deliveries
    WHERE id = NEW.delivery_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Telemetry references non-existent delivery %', NEW.delivery_id
            USING ERRCODE = 'MV404';
    END IF;

    IF v_delivery.campaign_id != NEW.campaign_id THEN
        RAISE EXCEPTION 'Campaign mismatch: delivery belongs to campaign %, but telemetry reported %',
            v_delivery.campaign_id, NEW.campaign_id 
            USING ERRCODE = 'MV409';
    END IF;

    IF v_delivery.recipient_type != NEW.recipient_type THEN
        RAISE EXCEPTION 'Recipient type mismatch: delivery is %, but telemetry reported %',
            v_delivery.recipient_type, NEW.recipient_type 
            USING ERRCODE = 'MV409';
    END IF;

    IF (v_delivery.recipient_id IS DISTINCT FROM NEW.recipient_id) THEN
        RAISE EXCEPTION 'Recipient mismatch: delivery recipient is %, but telemetry reported %',
            v_delivery.recipient_id, NEW.recipient_id 
            USING ERRCODE = 'MV403';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_validate_telemetry_delivery_agreement() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_telemetry_delivery_agreement_guard ON public.notification_telemetry;
CREATE TRIGGER trg_telemetry_delivery_agreement_guard
BEFORE INSERT OR UPDATE OF delivery_id, campaign_id, recipient_type, recipient_id ON public.notification_telemetry
FOR EACH ROW EXECUTE FUNCTION public.trg_validate_telemetry_delivery_agreement();

-- 4. Audit Log Immutability Triggers (Row-level & Statement-level TRUNCATE)
CREATE OR REPLACE FUNCTION public.trg_enforce_audit_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    RAISE EXCEPTION 'Table public.notification_audit_log is append-only. UPDATE and DELETE operations are strictly forbidden'
        USING ERRCODE = 'MV405';
END;
$$;

REVOKE ALL ON FUNCTION public.trg_enforce_audit_immutability() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_audit_log_no_update_delete ON public.notification_audit_log;
CREATE TRIGGER trg_audit_log_no_update_delete
BEFORE UPDATE OR DELETE ON public.notification_audit_log
FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_audit_immutability();

CREATE OR REPLACE FUNCTION public.trg_enforce_audit_truncate_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    RAISE EXCEPTION 'Table public.notification_audit_log is append-only. TRUNCATE operation is strictly forbidden'
        USING ERRCODE = 'MV405';
END;
$$;

REVOKE ALL ON FUNCTION public.trg_enforce_audit_truncate_immutability() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_audit_log_no_truncate ON public.notification_audit_log;
CREATE TRIGGER trg_audit_log_no_truncate
BEFORE TRUNCATE ON public.notification_audit_log
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_enforce_audit_truncate_immutability();

