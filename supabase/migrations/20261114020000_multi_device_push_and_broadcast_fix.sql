-- ============================================================================
-- Migration: 20261114020000_multi_device_push_and_broadcast_fix.sql
-- Description:
-- 1. Eliminates multi-device budget starvation in _materialize_notification_campaign.
--    - Evaluates daily push budget by distinct campaign count instead of raw endpoint rows.
--    - When a user has remaining budget, materializes push deliveries for ALL of their active devices.
-- 2. Guarantees broadcast eligibility for all registered device endpoints in candidate_users CTE.
-- 3. Grants service_role execution on canonical functions.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._materialize_notification_campaign(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_camp record;
    v_target_type text;
    v_media_type text;
    v_movie_id text;
    v_series_id text;
    v_season_number integer;
    v_idempotency_key text;
    v_recipient record;
    v_endpoint record;
    v_allow_in_app boolean;
    v_allow_push boolean;
    v_valid_tz text;
    v_resume_at timestamptz;
    v_daily_campaign_count integer;
    v_remaining_push_budget integer;
    v_push_delivery_id uuid;
    v_in_app_delivery_id uuid;
    v_user_push_queued integer;
    v_total_recipients integer := 0;
    v_push_deliveries integer := 0;
    v_in_app_deliveries integer := 0;
    v_deferred_quiet_hours integer := 0;
    v_suppressed_daily_cap integer := 0;
    v_final_status text;
    v_queue_key text;
BEGIN
    SELECT * INTO v_camp
    FROM public.notification_campaigns
    WHERE id = p_campaign_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Campaign % not found', p_campaign_id USING ERRCODE = 'MV404';
    END IF;

    v_target_type := v_camp.target_type;
    v_media_type := NULLIF(trim(COALESCE(v_camp.target_criteria->>'media_type', '')), '');
    v_movie_id := COALESCE(v_camp.target_criteria->>'movie_id', v_camp.target_criteria->>'tmdb_id');
    v_series_id := COALESCE(v_camp.target_criteria->>'series_id', v_camp.target_criteria->>'movie_id', v_camp.target_criteria->>'tmdb_id');
    v_season_number := CASE
        WHEN (v_camp.target_criteria->>'season_number') ~ '^[0-9]+$'
            THEN (v_camp.target_criteria->>'season_number')::integer
        ELSE NULL
    END;
    v_idempotency_key := NULLIF(trim(COALESCE(v_camp.target_criteria->>'idempotency_key', '')), '');

    -- Resolve eligible recipients in deterministic user_id order to guarantee deadlock-free per-user locking
    FOR v_recipient IN
        WITH candidate_users AS (
            SELECT DISTINCT u_id AS user_id
            FROM (
                -- 'all' broadcast: active, unrevoked push endpoints
                SELECT ne.user_id AS u_id
                FROM public.notification_endpoints ne
                WHERE v_target_type = 'all'
                  AND ne.is_active = true
                  AND ne.revoked_at IS NULL
                  AND ne.revocation_reason IS NULL
                  AND ne.user_id IS NOT NULL

                UNION

                -- 'all' broadcast: users opted into all notifications
                SELECT up.user_id AS u_id
                FROM public.user_notification_preferences up
                WHERE v_target_type = 'all'
                  AND up.opt_in_all = true
                  AND (up.channel_in_app = true OR up.channel_push = true)

                UNION

                -- 'all' broadcast: active subscriptions
                SELECT ns.user_id AS u_id
                FROM public.notification_subscriptions ns
                WHERE v_target_type = 'all'
                  AND ns.status = 'active'

                UNION

                -- 'movie' target criteria
                SELECT ns.user_id AS u_id
                FROM public.notification_subscriptions ns
                WHERE v_target_type = 'movie'
                  AND ns.status = 'active'
                  AND ns.entity_type = 'movie'
                  AND ns.entity_id = v_movie_id

                UNION

                -- 'series' target criteria
                SELECT ns.user_id AS u_id
                FROM public.notification_subscriptions ns
                WHERE v_target_type = 'series'
                  AND ns.status = 'active'
                  AND (
                      (ns.entity_type = 'series' AND ns.entity_id = v_series_id)
                      OR (
                          ns.entity_type = 'movie'
                          AND ns.entity_id = v_series_id
                          AND COALESCE(ns.metadata->>'media_type', 'movie') IN ('tv', 'series')
                      )
                  )

                UNION

                -- 'season' target criteria
                SELECT ns.user_id AS u_id
                FROM public.notification_subscriptions ns
                WHERE v_target_type = 'season'
                  AND ns.status = 'active'
                  AND (
                      (v_season_number IS NOT NULL AND ns.entity_type = 'season' AND ns.entity_id = (v_series_id || ':s' || v_season_number::text))
                      OR (ns.entity_type = 'series' AND ns.entity_id = v_series_id)
                      OR (
                          ns.entity_type = 'movie'
                          AND ns.entity_id = v_series_id
                          AND COALESCE(ns.metadata->>'media_type', 'movie') IN ('tv', 'series')
                      )
                  )

                UNION

                -- 'actor' target criteria
                SELECT ns.user_id AS u_id
                FROM public.notification_subscriptions ns
                WHERE v_target_type = 'actor'
                  AND ns.status = 'active'
                  AND ns.entity_type = 'actor'
                  AND ns.entity_id = (v_camp.target_criteria->>'actor_id')

                UNION

                -- 'genre' target criteria
                SELECT ns.user_id AS u_id
                FROM public.notification_subscriptions ns
                WHERE v_target_type = 'genre'
                  AND ns.status = 'active'
                  AND ns.entity_type = 'genre'
                  AND ns.entity_id = (v_camp.target_criteria->>'genre_id')

                UNION

                -- Direct 'users' list
                SELECT (jsonb_array_elements_text(v_camp.target_criteria->'user_ids'))::uuid AS u_id
                WHERE v_target_type = 'users'
                  AND jsonb_typeof(v_camp.target_criteria->'user_ids') = 'array'
            ) raw_users
            WHERE u_id IS NOT NULL
        )
        SELECT
            cu.user_id,
            COALESCE(p.channel_in_app, true) AS channel_in_app,
            COALESCE(p.channel_push, true) AS channel_push,
            COALESCE(p.quiet_hours_enabled, false) AS quiet_hours_enabled,
            p.quiet_hours_start,
            p.quiet_hours_end,
            COALESCE(p.quiet_hours_tz, 'UTC') AS quiet_hours_tz,
            COALESCE(p.max_daily_push, 20) AS max_daily_push
        FROM candidate_users cu
        LEFT JOIN public.user_notification_preferences p ON p.user_id = cu.user_id
        WHERE public.is_category_allowed_by_preferences(cu.user_id, v_camp.category, v_target_type, v_media_type)
        ORDER BY cu.user_id ASC
    LOOP
        v_allow_in_app := v_recipient.channel_in_app;
        v_allow_push := v_recipient.channel_push;

        IF NOT v_allow_in_app AND NOT v_allow_push THEN
            CONTINUE;
        END IF;

        v_in_app_delivery_id := NULL;
        v_user_push_queued := 0;

        -- Serialize per-user daily push budget calculations cleanly across concurrent materializations
        IF v_allow_push THEN
            PERFORM pg_advisory_xact_lock(1001, hashtext(v_recipient.user_id::text));

            v_valid_tz := public.resolve_valid_timezone(v_recipient.quiet_hours_tz);
            v_resume_at := public.compute_quiet_hours_resume_at(
                v_recipient.quiet_hours_enabled,
                v_recipient.quiet_hours_start,
                v_recipient.quiet_hours_end,
                v_valid_tz,
                NOW()
            );

            -- Count distinct campaigns received today by this user so multi-device users are not penalized
            SELECT count(DISTINCT d.campaign_id)::integer INTO v_daily_campaign_count
            FROM public.notification_deliveries d
            WHERE d.recipient_id = v_recipient.user_id
              AND d.channel_type IN ('fcm', 'web_push')
              AND d.delivery_status IN ('pending', 'leased', 'sent', 'delivered')
              AND (d.created_at AT TIME ZONE v_valid_tz)::date = (NOW() AT TIME ZONE v_valid_tz)::date;

            v_remaining_push_budget := GREATEST(0, v_recipient.max_daily_push - v_daily_campaign_count);

            IF v_remaining_push_budget <= 0 THEN
                IF EXISTS (
                    SELECT 1 FROM public.notification_endpoints ne
                    WHERE ne.user_id = v_recipient.user_id
                      AND ne.is_active = true
                      AND ne.revoked_at IS NULL
                      AND ne.revocation_reason IS NULL
                      AND ne.channel_type IN ('fcm', 'web_push')
                ) THEN
                    v_suppressed_daily_cap := v_suppressed_daily_cap + 1;
                END IF;
            ELSE
                -- Deliver this campaign to ALL active endpoints of this user
                FOR v_endpoint IN
                    SELECT ne.id, ne.channel_type
                    FROM public.notification_endpoints ne
                    WHERE ne.user_id = v_recipient.user_id
                      AND ne.is_active = true
                      AND ne.revoked_at IS NULL
                      AND ne.revocation_reason IS NULL
                      AND ne.channel_type IN ('fcm', 'web_push')
                    ORDER BY ne.last_seen_at DESC NULLS LAST, ne.created_at DESC
                LOOP
                    INSERT INTO public.notification_deliveries (
                        campaign_id, recipient_type, recipient_id, endpoint_id, channel_type,
                        delivery_status, next_retry_at
                    )
                    VALUES (
                        v_camp.id, 'user', v_recipient.user_id, v_endpoint.id, v_endpoint.channel_type,
                        'pending', v_resume_at
                    )
                    ON CONFLICT (campaign_id, endpoint_id) WHERE endpoint_id IS NOT NULL DO NOTHING
                    RETURNING id INTO v_push_delivery_id;

                    IF v_push_delivery_id IS NOT NULL THEN
                        v_user_push_queued := v_user_push_queued + 1;
                        v_push_deliveries := v_push_deliveries + 1;
                        IF v_resume_at IS NOT NULL THEN
                            v_deferred_quiet_hours := v_deferred_quiet_hours + 1;
                        END IF;
                    END IF;
                END LOOP;
            END IF;
        END IF;

        -- Independent In-App Inbox Entry: always bind to a dedicated in_app delivery row
        IF v_allow_in_app THEN
            INSERT INTO public.notification_deliveries (
                campaign_id, recipient_type, recipient_id, endpoint_id, channel_type,
                delivery_status
            )
            VALUES (
                v_camp.id, 'user', v_recipient.user_id, NULL, 'in_app',
                'pending'
            )
            ON CONFLICT (campaign_id, recipient_id) WHERE channel_type = 'in_app' AND recipient_id IS NOT NULL DO NOTHING
            RETURNING id INTO v_in_app_delivery_id;

            IF v_in_app_delivery_id IS NULL THEN
                SELECT id INTO v_in_app_delivery_id
                FROM public.notification_deliveries
                WHERE campaign_id = v_camp.id
                  AND recipient_id = v_recipient.user_id
                  AND channel_type = 'in_app'
                LIMIT 1;
            ELSE
                v_in_app_deliveries := v_in_app_deliveries + 1;
            END IF;

            INSERT INTO public.user_notifications (
                user_id, campaign_id, delivery_id, category, title, body, action_url, image_url, metadata
            )
            VALUES (
                v_recipient.user_id,
                v_camp.id,
                v_in_app_delivery_id,
                v_camp.category,
                v_camp.title,
                v_camp.body,
                v_camp.action_url,
                v_camp.image_url,
                COALESCE(v_camp.target_criteria, '{}'::jsonb)
            )
            ON CONFLICT (user_id, campaign_id) WHERE campaign_id IS NOT NULL DO NOTHING;
        END IF;

        IF v_user_push_queued > 0 OR v_allow_in_app THEN
            v_total_recipients := v_total_recipients + 1;
        END IF;
    END LOOP;

    -- Mark in-app-only campaigns as completed immediately since push workers never poll in_app rows
    v_final_status := CASE WHEN v_push_deliveries > 0 THEN 'queued' ELSE 'completed' END;

    v_queue_key := COALESCE(v_idempotency_key, 'camp_' || v_camp.id::text);
    INSERT INTO public.notification_queue (
        campaign_id, idempotency_key, batch_index, payload, status, run_at
    )
    VALUES (
        v_camp.id,
        v_queue_key,
        0,
        jsonb_build_object(
            'campaign_id', v_camp.id,
            'total_recipients', v_total_recipients,
            'push_deliveries', v_push_deliveries,
            'in_app_deliveries', v_in_app_deliveries
        ),
        CASE WHEN v_push_deliveries > 0 THEN 'pending' ELSE 'completed' END,
        NOW()
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    UPDATE public.notification_campaigns
    SET total_recipients = v_total_recipients,
        status = v_final_status,
        sent_at = COALESCE(sent_at, NOW()),
        completed_at = CASE WHEN v_final_status = 'completed' THEN COALESCE(completed_at, NOW()) ELSE NULL END,
        updated_at = NOW()
    WHERE id = v_camp.id;

    RETURN jsonb_build_object(
        'campaign_id', v_camp.id,
        'status', v_final_status,
        'total_recipients', v_total_recipients,
        'push_deliveries', v_push_deliveries,
        'in_app_deliveries', v_in_app_deliveries,
        'deferred_quiet_hours', v_deferred_quiet_hours,
        'suppressed_daily_cap', v_suppressed_daily_cap
    );
END;
$$;

REVOKE ALL ON FUNCTION public._materialize_notification_campaign(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._materialize_notification_campaign(uuid) TO service_role;
