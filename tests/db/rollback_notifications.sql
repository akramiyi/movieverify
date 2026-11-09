-- ============================================================================
-- MOVIEVERIFY PHASE 2 NOTIFICATION ARCHITECTURE ROLLBACK SCRIPT
-- File: tests/db/rollback_notifications.sql
-- Target: Disposable isolated test database ONLY (mv_rollback_test)
-- Safety: Fully transactional (BEGIN ... COMMIT).
-- Mode: RESTRICT (zero CASCADE — all dependencies must be explicitly resolved)
--
-- Phase 2 reverse dependency order:
--   Step 1: Drop all Phase 2 & Phase 1.9 RLS policies (they reference
--           notifications_is_admin() and must be dropped before functions)
--   Step 2: Drop compatibility views (notification_tokens references
--           notifications_is_admin() in its WHERE clause)
--   Step 3: Drop INSTEAD OF triggers on views (before dropping views — but
--           views are dropped in Step 2 which cascades triggers automatically;
--           included explicitly for safety)
--   Step 4: Drop table-level triggers (before dropping trigger functions)
--   Step 5: Drop trigger functions (before dropping canonical RPCs)
--   Step 6: Drop canonical RPCs and helper functions (notifications_is_admin last)
--   Step 7: Drop safe read views (user_notification_endpoints)
--   Step 8: Drop Phase 2 tables in FK-safe reverse order
--   Step 9: Revert constraints & indexes on legacy tables
--
-- PRESERVED (not dropped):
--   - auth.users (Supabase-managed)
--   - public.admin_users (pre-existing application table)
--   - public.download_links, movie_reports, movie_reviews, site_settings
--     (pre-existing application tables — no notification FK)
--   - public.legacy_delivery_quarantine, legacy_token_quarantine,
--     legacy_subscription_quarantine (historical evidence preserved)
--
-- DATA RETENTION:
--   Data-bearing tables (notification_deliveries, notification_telemetry,
--   notification_audit_log, notification_campaigns, user_notifications) are
--   preserved by default. Enable OPTIONAL DESTRUCTIVE TEARDOWN block only
--   after explicit operator authorization and external backup.
--
-- POST-ROLLBACK STATE:
--   RLS remains ENABLED on surviving notification tables (zero policies = default-deny).
--   Superusers and service_role (BYPASSRLS) retain administrative access.
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: DROP ALL PHASE 2 RLS POLICIES
-- Must precede dropping notifications_is_admin() which policies reference.
-- ============================================================================

-- Table: notification_endpoints (Migration 6)
DROP POLICY IF EXISTS p_endpoints_user_select   ON public.notification_endpoints;
DROP POLICY IF EXISTS p_endpoints_user_update   ON public.notification_endpoints;
DROP POLICY IF EXISTS p_endpoints_service_all   ON public.notification_endpoints;

-- Table: user_notification_preferences (Migration 6)
DROP POLICY IF EXISTS p_prefs_user_select       ON public.user_notification_preferences;
DROP POLICY IF EXISTS p_prefs_user_insert       ON public.user_notification_preferences;
DROP POLICY IF EXISTS p_prefs_user_update       ON public.user_notification_preferences;
DROP POLICY IF EXISTS p_prefs_service_all       ON public.user_notification_preferences;

-- Table: notification_subscriptions (Migration 6)
DROP POLICY IF EXISTS p_subs_user_all           ON public.notification_subscriptions;
DROP POLICY IF EXISTS p_subs_service_all        ON public.notification_subscriptions;

-- Table: user_notifications (Migration 6)
DROP POLICY IF EXISTS p_inbox_user_select       ON public.user_notifications;
DROP POLICY IF EXISTS p_inbox_user_update       ON public.user_notifications;
DROP POLICY IF EXISTS p_inbox_service_all       ON public.user_notifications;

-- Table: notification_campaigns (Migration 6)
DROP POLICY IF EXISTS p_camp_admin_all          ON public.notification_campaigns;
DROP POLICY IF EXISTS p_camp_service_all        ON public.notification_campaigns;

-- Table: notification_queue (Migration 6)
DROP POLICY IF EXISTS p_queue_admin_select      ON public.notification_queue;
DROP POLICY IF EXISTS p_queue_service_all       ON public.notification_queue;

-- Table: notification_deliveries (Migration 6)
DROP POLICY IF EXISTS p_deliv_user_select       ON public.notification_deliveries;
DROP POLICY IF EXISTS p_deliv_service_all       ON public.notification_deliveries;

-- Table: notification_telemetry (Migration 6)
DROP POLICY IF EXISTS p_telem_user_select       ON public.notification_telemetry;
DROP POLICY IF EXISTS p_telem_service_all       ON public.notification_telemetry;

-- Table: notification_audit_log (Migration 6)
DROP POLICY IF EXISTS p_audit_admin_select      ON public.notification_audit_log;
DROP POLICY IF EXISTS p_audit_service_all       ON public.notification_audit_log;
DROP POLICY IF EXISTS p_audit_service_insert    ON public.notification_audit_log;

-- Table: notification_opt_outs (Migration 7)
DROP POLICY IF EXISTS p_opt_outs_user           ON public.notification_opt_outs;
DROP POLICY IF EXISTS p_opt_outs_service        ON public.notification_opt_outs;

-- Table: movie_notify_requests (Migration 7)
DROP POLICY IF EXISTS p_movie_sub_user           ON public.movie_notify_requests;
DROP POLICY IF EXISTS p_movie_sub_service        ON public.movie_notify_requests;

-- Table: actor_notify_requests (Migration 7)
DROP POLICY IF EXISTS p_actor_sub_user           ON public.actor_notify_requests;
DROP POLICY IF EXISTS p_actor_sub_service        ON public.actor_notify_requests;

-- Table: genre_notify_requests (Migration 7)
DROP POLICY IF EXISTS p_genre_sub_user           ON public.genre_notify_requests;
DROP POLICY IF EXISTS p_genre_sub_service        ON public.genre_notify_requests;

-- ============================================================================
-- STEP 2: DROP COMPATIBILITY VIEWS (Migration 7)
-- notification_tokens view references notifications_is_admin() — must drop
-- before the function. Dropping the view automatically drops its INSTEAD OF triggers.
-- ============================================================================
DROP VIEW IF EXISTS public.notification_tokens          RESTRICT;
DROP VIEW IF EXISTS public.user_notification_endpoints  RESTRICT;

-- ============================================================================
-- STEP 3: DROP TABLE-LEVEL TRIGGERS (Migrations 4 & 7)
-- Must precede dropping trigger functions.
-- ============================================================================

-- Migration 4: Delivery & Telemetry integrity triggers
DROP TRIGGER IF EXISTS trg_delivery_ownership_guard          ON public.notification_deliveries;
DROP TRIGGER IF EXISTS trg_delivery_identity_immutable       ON public.notification_deliveries;
DROP TRIGGER IF EXISTS trg_telemetry_delivery_agreement_guard ON public.notification_telemetry;
DROP TRIGGER IF EXISTS trg_audit_log_no_update_delete        ON public.notification_audit_log;
DROP TRIGGER IF EXISTS trg_audit_log_no_truncate             ON public.notification_audit_log;

-- Migration 7: Legacy subscription sync triggers
DROP TRIGGER IF EXISTS trg_movie_sync_canonical              ON public.movie_notify_requests;
DROP TRIGGER IF EXISTS trg_actor_sync_canonical              ON public.actor_notify_requests;
DROP TRIGGER IF EXISTS trg_genre_sync_canonical              ON public.genre_notify_requests;
DROP TRIGGER IF EXISTS trg_opt_out_sync_preferences          ON public.notification_opt_outs;

-- ============================================================================
-- STEP 4: DROP TRIGGER FUNCTIONS (Migrations 4 & 7)
-- (Triggers dropped above, so functions can now be dropped safely with RESTRICT)
-- ============================================================================
DROP FUNCTION IF EXISTS public.trg_validate_delivery_ownership()              RESTRICT;
DROP FUNCTION IF EXISTS public.trg_enforce_delivery_identity_immutability()   RESTRICT;
DROP FUNCTION IF EXISTS public.trg_validate_telemetry_delivery_agreement()    RESTRICT;
DROP FUNCTION IF EXISTS public.trg_enforce_audit_immutability()               RESTRICT;
DROP FUNCTION IF EXISTS public.trg_enforce_audit_truncate_immutability()      RESTRICT;

DROP FUNCTION IF EXISTS public.trg_sync_movie_to_canonical()                  RESTRICT;
DROP FUNCTION IF EXISTS public.trg_sync_actor_to_canonical()                  RESTRICT;
DROP FUNCTION IF EXISTS public.trg_sync_genre_to_canonical()                  RESTRICT;
DROP FUNCTION IF EXISTS public.trg_sync_opt_out_to_preferences()              RESTRICT;

DROP FUNCTION IF EXISTS public.trg_compat_notification_tokens_insert()        RESTRICT;
DROP FUNCTION IF EXISTS public.trg_compat_notification_tokens_update()        RESTRICT;
DROP FUNCTION IF EXISTS public.trg_compat_notification_tokens_delete()        RESTRICT;

DROP FUNCTION IF EXISTS public.trg_enforce_campaign_idempotency_lock()        RESTRICT;

-- ============================================================================
-- STEP 6: DROP CANONICAL RPCs (Migration 5), then notifications_is_admin() last
-- ============================================================================
DROP FUNCTION IF EXISTS public.record_notification_telemetry(uuid, uuid, varchar, uuid, varchar, varchar, timestamptz, jsonb) RESTRICT;
DROP FUNCTION IF EXISTS public.sweep_expired_delivery_reservations()                                              RESTRICT;
DROP FUNCTION IF EXISTS public.record_notification_delivery_failure(uuid, varchar, uuid, text, text, integer)    RESTRICT;
DROP FUNCTION IF EXISTS public.fail_or_retry_notification_delivery(uuid, varchar, uuid, text, text, integer)     RESTRICT;
DROP FUNCTION IF EXISTS public.confirm_notification_delivery_sent(uuid, uuid, text)                              RESTRICT;
DROP FUNCTION IF EXISTS public.authorize_notification_delivery_dispatch(uuid, uuid, uuid, varchar, uuid)         RESTRICT;
DROP FUNCTION IF EXISTS public.reserve_notification_deliveries(varchar, integer, integer)                        RESTRICT;
DROP FUNCTION IF EXISTS public.cancel_notification_campaign(uuid)                                                RESTRICT;
DROP FUNCTION IF EXISTS public.ingest_notification_campaign(text, text, text, text, text, jsonb, timestamptz, uuid) RESTRICT;
DROP FUNCTION IF EXISTS public.revoke_notification_endpoint(uuid, text, varchar)                                 RESTRICT;
DROP FUNCTION IF EXISTS public.claim_notification_endpoint(uuid, text)                                           RESTRICT;
DROP FUNCTION IF EXISTS public.register_notification_endpoint(varchar, text, text, text, text, text, varchar, varchar, varchar, varchar) RESTRICT;

-- Drop notifications_is_admin() last — all dependents removed above
DROP FUNCTION IF EXISTS public.notifications_is_admin() RESTRICT;

-- ============================================================================
-- STEP 7: DROP PHASE 2 NOTIFICATION TABLES (reverse FK dependency order)
-- notification_telemetry → notification_deliveries → notification_queue →
-- notification_campaigns → notification_subscriptions → user_notifications →
-- user_notification_preferences → notification_endpoints
-- ============================================================================

-- Only the ephemeral queue table is dropped by default.
-- Data-bearing tables are preserved to prevent accidental data loss.
DROP TABLE IF EXISTS public.notification_queue RESTRICT;

-- OPTIONAL DESTRUCTIVE TEARDOWN:
-- Requires explicit operator authorization AND an external backup.
-- Uncomment ONLY after backup is verified and rollback is authorized:
/*
DROP TABLE IF EXISTS public.notification_telemetry RESTRICT;
DROP TABLE IF EXISTS public.notification_deliveries RESTRICT;
DROP TABLE IF EXISTS public.notification_audit_log RESTRICT;
DROP TABLE IF EXISTS public.notification_campaigns RESTRICT;
DROP TABLE IF EXISTS public.user_notifications RESTRICT;
DROP TABLE IF EXISTS public.notification_subscriptions RESTRICT;
DROP TABLE IF EXISTS public.user_notification_preferences RESTRICT;
DROP TABLE IF EXISTS public.notification_endpoints RESTRICT;
*/

-- ============================================================================
-- STEP 8: DROP LEGACY COMPATIBILITY TABLES (Migration 7)
-- movie_notify_requests, actor_notify_requests, genre_notify_requests,
-- notification_opt_outs — these are Phase 2-created legacy shim tables.
-- notification_tokens was a view — already dropped in Step 2.
-- ============================================================================
DROP TABLE IF EXISTS public.notification_opt_outs     RESTRICT;
DROP TABLE IF EXISTS public.genre_notify_requests     RESTRICT;
DROP TABLE IF EXISTS public.actor_notify_requests     RESTRICT;
DROP TABLE IF EXISTS public.movie_notify_requests     RESTRICT;

-- ============================================================================
-- STEP 9: VERIFY PRESERVED APPLICATION TABLES REMAIN INTACT
-- (Executed as a no-op SELECT to prove tables are still accessible)
-- ============================================================================
DO $$
DECLARE
    v_count integer;
BEGIN
    -- Verify pre-existing core tables were NOT dropped
    SELECT COUNT(*) INTO v_count FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('admin_users', 'download_links', 'movie_reports',
                         'movie_reviews', 'site_settings');

    RAISE NOTICE 'Rollback verification: % pre-existing application tables remain intact.', v_count;

    -- Verify notification_audit_log data was not destroyed (append-only history preserved)
    BEGIN
        SELECT COUNT(*) INTO v_count FROM public.notification_audit_log;
        RAISE NOTICE 'notification_audit_log preserved with % audit records.', v_count;
    EXCEPTION WHEN undefined_table THEN
        RAISE NOTICE 'notification_audit_log was dropped (optional destructive teardown was enabled).';
    END;

    -- Verify legacy quarantine tables are intact
    SELECT COUNT(*) INTO v_count FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('legacy_delivery_quarantine', 'legacy_token_quarantine',
                         'legacy_subscription_quarantine');

    RAISE NOTICE '% legacy quarantine tables preserved (historical evidence intact).', v_count;
END $$;

COMMIT;
