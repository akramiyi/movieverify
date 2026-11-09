-- ============================================================================
-- MOVIEVERIFY CONCURRENCY SETUP HARNESS (Phase 2 — R4.0)
-- File: tests/db/concurrency_harness.sql
-- Phase 2 corrections:
--   - notification_deliveries uses endpoint_id (not token_id/token_snapshot_hash)
--   - notification_deliveries requires campaign_id NOT NULL
--   - delivery_status values: 'pending','leased',... (not 'reserved')
--   - No failure_reason column in Phase 2 notification_deliveries
--   - Concurrency audit tables use test-specific labels (not failure_reason) for cleanup
-- ============================================================================

\set ON_ERROR_STOP on

-- Ensure clean lock state before starting concurrency tests
SELECT pg_advisory_unlock_all();

BEGIN;

CREATE TABLE IF NOT EXISTS public.concurrency_test_claims (
    claim_id serial PRIMARY KEY,
    worker_id text NOT NULL,
    delivery_id uuid NOT NULL,
    xact_id bigint NOT NULL,
    tx_start timestamptz NOT NULL,
    claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    tx_end timestamptz
);

CREATE TABLE IF NOT EXISTS public.transfer_race_audit (
    audit_id serial PRIMARY KEY,
    session_name text NOT NULL,
    deliveries_returned integer NOT NULL,
    raw_token_returned boolean NOT NULL,
    xact_id bigint,
    tx_start timestamptz,
    tx_end timestamptz,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.campaign_idemp_race_audit (
    audit_id serial PRIMARY KEY,
    session_name text NOT NULL,
    campaign_id uuid,
    already_exists boolean,
    total_recipients integer,
    total_deliveries integer,
    xact_id bigint NOT NULL,
    tx_start timestamptz NOT NULL,
    tx_end timestamptz,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

TRUNCATE TABLE public.concurrency_test_claims;
TRUNCATE TABLE public.transfer_race_audit;
TRUNCATE TABLE public.campaign_idemp_race_audit;

-- Clean seed data from prior runs using device_name label (not failure_reason)
DELETE FROM public.notification_deliveries
WHERE endpoint_id IN (
    SELECT id FROM public.notification_endpoints
    WHERE device_name IN ('concurrency_seed_device', 'transfer_seed_device')
);

-- Deactivate and clean up seed endpoints from prior runs
UPDATE public.notification_endpoints
SET is_active = false, revoked_at = NOW(), revocation_reason = 'concurrency_harness_cleanup'
WHERE device_name IN ('concurrency_seed_device', 'transfer_seed_device')
  AND is_active = true;

DELETE FROM public.notification_campaigns
WHERE (target_criteria->>'idempotency_key') = 'concurrency_race_idemp_key_1';

DO $$
DECLARE
    v_uid             uuid := '00000000-0000-0000-0000-000000000001';
    v_uid2            uuid := '00000000-0000-0000-0000-000000000002';
    v_ep_id           uuid;
    v_transfer_ep_id  uuid;
    v_camp_id         uuid;
    v_hash            text;
    v_hash2           text;
    v_secret          text;
    v_secret2         text;
    i                 integer;
BEGIN
    -- Ensure test auth users exist
    INSERT INTO auth.users (id, email) VALUES
    ('00000000-0000-0000-0000-000000000001', 'user1@movieverify.com'),
    ('00000000-0000-0000-0000-000000000002', 'user2@movieverify.com')
    ON CONFLICT (id) DO NOTHING;

    -- Compute endpoint hashes
    v_hash    := encode(sha256('seed_token_concurrency'::bytea), 'hex');
    v_hash2   := encode(sha256('seed_token_transfer'::bytea), 'hex');
    v_secret  := encode(sha256(('seed_token_concurrency:' || v_uid::text)::bytea), 'hex');
    v_secret2 := encode(sha256(('seed_token_transfer:' || v_uid::text)::bytea), 'hex');

    -- Seed a campaign for concurrency deliveries (campaign_id FK is NOT NULL)
    INSERT INTO public.notification_campaigns (
        title, body, category, target_type, target_criteria, status,
        total_recipients, sent_count, success_count, failure_count,
        open_count, click_count
    ) VALUES (
        'Concurrency Test Campaign', 'Concurrency harness probe', 'movie_release',
        'users', '{"type":"users","user_ids":["00000000-0000-0000-0000-000000000001"]}'::jsonb,
        'queued', 1, 0, 0, 0, 0, 0
    ) RETURNING id INTO v_camp_id;

    -- Endpoint for 2-worker reservation race
    INSERT INTO public.notification_endpoints (
        user_id, channel_type, token, endpoint_hash, client_secret_hash,
        device_type, device_name, is_active, last_seen_at
    ) VALUES (
        v_uid, 'fcm', 'seed_token_concurrency',
        v_hash, v_secret, 'web', 'concurrency_seed_device', true, NOW()
    ) RETURNING id INTO v_ep_id;

    -- 6 pending deliveries for the two workers (3 each)
    FOR i IN 1..6 LOOP
        INSERT INTO public.notification_deliveries (
            campaign_id, recipient_type, recipient_id, endpoint_id,
            channel_type, delivery_status, retry_count, max_retries
        ) VALUES (
            v_camp_id, 'user', v_uid, v_ep_id,
            'fcm', 'pending', 0, 2
        );
    END LOOP;

    -- Endpoint for transfer race (owned initially by user 1)
    INSERT INTO public.notification_endpoints (
        user_id, channel_type, token, endpoint_hash, client_secret_hash,
        device_type, device_name, is_active, last_seen_at
    ) VALUES (
        v_uid, 'fcm', 'seed_token_transfer',
        v_hash2, v_secret2, 'web', 'transfer_seed_device', true, NOW()
    ) RETURNING id INTO v_transfer_ep_id;

    -- 4 pending deliveries for transfer race
    FOR i IN 1..4 LOOP
        INSERT INTO public.notification_deliveries (
            campaign_id, recipient_type, recipient_id, endpoint_id,
            channel_type, delivery_status, retry_count, max_retries
        ) VALUES (
            v_camp_id, 'user', v_uid, v_transfer_ep_id,
            'fcm', 'pending', 0, 2
        );
    END LOOP;
END $$;

COMMIT;
