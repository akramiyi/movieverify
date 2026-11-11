-- ============================================================================
-- MOVIEVERIFY PHASE 5.7: CONCURRENCY HARNESS (STAGE 4)
-- File: tests/db/phase57_concurrency_harness.sql
-- ============================================================================

\set ON_ERROR_STOP on
SELECT pg_advisory_unlock_all();

BEGIN;

CREATE TABLE IF NOT EXISTS public.p57_conc_audit (
    id serial PRIMARY KEY,
    suite text NOT NULL,
    session_name text NOT NULL,
    xact_id bigint NOT NULL,
    tx_start timestamptz NOT NULL,
    tx_end timestamptz,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
TRUNCATE TABLE public.p57_conc_audit;

DO $$
DECLARE
    v_u_cap   uuid := '57200000-0000-0000-0000-000000000001';
    v_ep_cap  uuid := '57210000-0000-0000-0000-000000000001';
    v_u_lock  uuid := '57200000-0000-0000-0000-000000000002';
    v_ep_lock uuid := '57210000-0000-0000-0000-000000000002';
    v_ep_rev  uuid := '57210000-0000-0000-0000-000000000003';
    v_c_lock  uuid := '57220000-0000-0000-0000-000000000001';
    v_c_b5e   uuid := '57220000-0000-0000-0000-000000000002';
    v_d_tlm   uuid := '57230000-0000-0000-0000-000000000001';
BEGIN
    INSERT INTO auth.users (id, email) VALUES
        (v_u_cap, 'p57_cap@movieverify.test'),
        (v_u_lock, 'p57_lock@movieverify.test')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_notification_preferences (
        user_id, opt_in_all, notify_system, channel_in_app, channel_push, quiet_hours_enabled, quiet_hours_tz, max_daily_push
    ) VALUES (
        v_u_cap, true, true, true, true, false, 'UTC', 1
    ), (
        v_u_lock, true, true, true, true, false, 'UTC', 20
    ) ON CONFLICT (user_id) DO UPDATE SET
        max_daily_push = EXCLUDED.max_daily_push,
        channel_push = true,
        channel_in_app = true,
        opt_in_all = true;

    INSERT INTO public.notification_endpoints (
        id, user_id, channel_type, token, endpoint_hash, client_secret_hash,
        device_type, device_name, is_active, revoked_at, revocation_reason, last_seen_at
    ) VALUES (
        v_ep_cap, v_u_cap, 'fcm', 'p57_tok_cap',
        encode(sha256('p57_tok_cap'::bytea), 'hex'),
        encode(sha256(('p57_tok_cap:' || v_u_cap::text)::bytea), 'hex'),
        'web', 'P57 Cap Device', true, NULL, NULL, NOW()
    ), (
        v_ep_lock, v_u_lock, 'fcm', 'p57_tok_lock',
        encode(sha256('p57_tok_lock'::bytea), 'hex'),
        encode(sha256(('p57_tok_lock:' || v_u_lock::text)::bytea), 'hex'),
        'web', 'P57 Lock Device', true, NULL, NULL, NOW()
    ), (
        v_ep_rev, v_u_lock, 'fcm', 'p57_tok_revoked_b5e',
        encode(sha256('p57_tok_revoked_b5e'::bytea), 'hex'),
        encode(sha256(('p57_tok_revoked_b5e:' || v_u_lock::text)::bytea), 'hex'),
        'web', 'P57 Revoked Device', true, NULL, 'USER_LOGOUT', NOW()
    ) ON CONFLICT (id) DO NOTHING;

    -- Campaign & sent delivery for H-4 lock contention test
    INSERT INTO public.notification_campaigns (
        id, title, body, category, target_type, target_criteria, status, total_recipients
    ) VALUES (
        v_c_lock, 'P57 Lock Order Campaign', 'Body', 'system', 'users',
        '{"type":"users","user_ids":["57200000-0000-0000-0000-000000000002"],"idempotency_key":"p57_lock_camp_seed"}'::jsonb,
        'queued', 1
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.notification_deliveries (
        id, campaign_id, recipient_type, recipient_id, endpoint_id, channel_type, delivery_status, sent_at
    ) VALUES (
        v_d_tlm, v_c_lock, 'user', v_u_lock, v_ep_lock, 'fcm', 'sent', NOW()
    ) ON CONFLICT (id) DO NOTHING;

    -- B5E Reservation Concurrency Campaign (4 valid + 1 revoked endpoint deliveries across 4 campaigns)
    INSERT INTO public.notification_campaigns (
        id, title, body, category, target_type, target_criteria, status, total_recipients
    ) VALUES (
        v_c_b5e, 'P57 B5E Seed Campaign 0', 'Body', 'system', 'users',
        '{"type":"users","user_ids":["57200000-0000-0000-0000-000000000002"],"idempotency_key":"p57_b5e_seed_0"}'::jsonb,
        'queued', 1
    ) ON CONFLICT (id) DO NOTHING;

    FOR i IN 1..4 LOOP
        INSERT INTO public.notification_campaigns (
            title, body, category, target_type, target_criteria, status, total_recipients
        ) VALUES (
            'P57 B5E Seed ' || i, 'Body', 'system', 'users',
            jsonb_build_object('type', 'users', 'user_ids', jsonb_build_array(v_u_lock), 'idempotency_key', 'p57_b5e_seed_' || i),
            'queued', 1
        );

        INSERT INTO public.notification_deliveries (
            campaign_id, recipient_type, recipient_id, endpoint_id, channel_type, delivery_status
        )
        SELECT id, 'user', v_u_lock, v_ep_lock, 'fcm', 'pending'
        FROM public.notification_campaigns
        WHERE target_criteria->>'idempotency_key' = 'p57_b5e_seed_' || i;
    END LOOP;

    -- Deliveries referencing revoked_reason endpoint (must be skipped by B5E reserve)
    INSERT INTO public.notification_deliveries (
        campaign_id, recipient_type, recipient_id, endpoint_id, channel_type, delivery_status
    ) VALUES (
        v_c_b5e, 'user', v_u_lock, v_ep_rev, 'fcm', 'pending'
    );
END $$;

COMMIT;

