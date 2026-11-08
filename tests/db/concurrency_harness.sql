-- ============================================================================
-- MOVIEVERIFY CONCURRENCY SETUP HARNESS (R3.1)
-- File: tests/db/concurrency_harness.sql
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

-- Seed clean test deliveries and tokens
DELETE FROM public.notification_campaigns WHERE (target_criteria->>'idempotency_key') = 'concurrency_race_idemp_key_1';
DELETE FROM public.notification_deliveries WHERE failure_reason IN ('CONCURRENCY_TEST_SEED', 'TRANSFER_TEST_SEED');
DELETE FROM public.notification_tokens WHERE device_name IN ('concurrency_seed_device', 'transfer_seed_device');

DO $$
DECLARE
    v_uid uuid := '00000000-0000-0000-0000-000000000001';
    v_tok_id uuid;
    v_transfer_tok_id uuid;
    i integer;
BEGIN
    -- Ensure test auth users exist
    INSERT INTO auth.users (id, email) VALUES 
    ('00000000-0000-0000-0000-000000000001', 'user1@movieverify.com'),
    ('00000000-0000-0000-0000-000000000002', 'user2@movieverify.com')
    ON CONFLICT (id) DO NOTHING;

    -- Token for 2-worker reservation race
    INSERT INTO public.notification_tokens (user_id, token, token_hash, device_name, is_active)
    VALUES (v_uid, 'seed_token_concurrency', encode(digest('seed_token_concurrency', 'sha256'), 'hex'), 'concurrency_seed_device', true)
    RETURNING id INTO v_tok_id;

    -- 6 pending deliveries for the two workers (3 each)
    FOR i IN 1..6 LOOP
        INSERT INTO public.notification_deliveries (
            recipient_id, token_id, token_snapshot_hash, delivery_status, failure_reason
        ) VALUES (
            v_uid, v_tok_id, encode(digest('seed_token_concurrency', 'sha256'), 'hex'), 'pending', 'CONCURRENCY_TEST_SEED'
        );
    END LOOP;

    -- Token for transfer race
    INSERT INTO public.notification_tokens (user_id, token, token_hash, device_name, is_active)
    VALUES (v_uid, 'seed_token_transfer', encode(digest('seed_token_transfer', 'sha256'), 'hex'), 'transfer_seed_device', true)
    RETURNING id INTO v_transfer_tok_id;

    -- 4 pending deliveries for transfer race
    FOR i IN 1..4 LOOP
        INSERT INTO public.notification_deliveries (
            recipient_id, token_id, token_snapshot_hash, delivery_status, failure_reason
        ) VALUES (
            v_uid, v_transfer_tok_id, encode(digest('seed_token_transfer', 'sha256'), 'hex'), 'pending', 'TRANSFER_TEST_SEED'
        );
    END LOOP;
END $$;

COMMIT;
