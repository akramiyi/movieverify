-- ============================================================================
-- MOVIEVERIFY HARDENED NOTIFICATION ARCHITECTURE ROLLBACK SCRIPT
-- File: tests/db/rollback_notifications.sql
-- Target: Production Supabase SQL Editor
-- Safety: Fully transactional rollback (BEGIN ... COMMIT).
-- 
-- BACKUP-FIRST RECOVERY PROTOCOL & DATA RETENTION POLICY:
-- Operators MUST execute an external backup before running this script:
--
-- pg_dump "$DATABASE_URL" \
--   -t public.notification_tokens \
--   -t public.user_notifications \
--   -t public.movie_notify_requests \
--   -t public.actor_notify_requests \
--   -t public.genre_notify_requests \
--   -t public.notification_opt_outs \
--   -t public.notification_campaigns \
--   -t public.notification_deliveries \
--   -t public.notification_telemetry \
--   -t public.notification_audit_log \
--   -t public.legacy_token_quarantine \
--   -t public.legacy_subscription_quarantine \
--   -t public.legacy_delivery_quarantine \
--   -f backup_notification_all_tables_$(date +%Y%m%d_%H%M%S).sql
--
-- POST-ROLLBACK TABLE ACCESS & SECURITY STATE:
-- 1. When RLS policies are dropped (STEP 1), PostgreSQL table RLS mode remains ENABLED
--    on tables where ALTER TABLE ... ENABLE ROW LEVEL SECURITY was executed.
-- 2. An RLS-enabled table with ZERO policies enforces DEFAULT-DENY:
--    - Ordinary client roles (anon, authenticated) are COMPLETELY BLOCKED from SELECT/DML.
--    - Superusers and BYPASSRLS roles (postgres, service_role) retain full administrative access.
-- 3. For tables without RLS (legacy quarantine tables), access is governed strictly by SQL
--    grants; since all client grants were revoked and zero granted, clients remain 100% blocked.
--
-- DATA RETENTION GUARANTEE:
-- To prevent accidental data loss, NO user data, delivery records, telemetry,
-- campaign records, or audit history tables are automatically dropped by default.
-- By default, this script only rolls back RLS policies, triggers, functions,
-- constraints, and transient queue structures.
-- If complete table teardown is explicitly authorized, see STEP 4.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- STEP 1: DROP RLS POLICIES ON ALL NOTIFICATION TABLES
-- Must be dropped before dropping functions that policies depend on
-- (Specifically notifications_is_admin)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS p_tokens_user_all ON public.notification_tokens;
DROP POLICY IF EXISTS p_movie_notify_user_all ON public.movie_notify_requests;
DROP POLICY IF EXISTS p_actor_notify_user_all ON public.actor_notify_requests;
DROP POLICY IF EXISTS p_genre_notify_user_all ON public.genre_notify_requests;
DROP POLICY IF EXISTS p_user_notif_select ON public.user_notifications;
DROP POLICY IF EXISTS p_user_notif_update ON public.user_notifications;
DROP POLICY IF EXISTS p_opt_outs_user_all ON public.notification_opt_outs;
DROP POLICY IF EXISTS p_campaigns_admin ON public.notification_campaigns;
DROP POLICY IF EXISTS p_queue_admin ON public.notification_queue;
DROP POLICY IF EXISTS p_deliveries_user_select ON public.notification_deliveries;
DROP POLICY IF EXISTS p_telemetry_user_select ON public.notification_telemetry;
DROP POLICY IF EXISTS p_audit_log_admin ON public.notification_audit_log;

-- ----------------------------------------------------------------------------
-- STEP 2: DROP DATABASE TRIGGERS
-- Must be dropped before dropping trigger functions
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_validate_delivery_status ON public.notification_deliveries;
DROP TRIGGER IF EXISTS trg_sync_token_hash ON public.notification_tokens;
DROP TRIGGER IF EXISTS trg_token_ownership_change ON public.notification_tokens;
DROP TRIGGER IF EXISTS trg_protect_user_notifications ON public.user_notifications;
DROP TRIGGER IF EXISTS trg_campaign_cancellation_sync ON public.notification_campaigns;

-- ----------------------------------------------------------------------------
-- STEP 3: DROP ALL 21 NOTIFICATION FUNCTIONS
-- (Both worker RPCs and trigger functions)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cancel_notification_campaign(uuid);
DROP FUNCTION IF EXISTS public.ingest_notification_campaign(text, text, text, text, text, jsonb, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.sweep_stale_notification_deliveries(integer);
DROP FUNCTION IF EXISTS public.sweep_expired_delivery_reservations();
DROP FUNCTION IF EXISTS public.record_notification_telemetry(uuid, uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.fail_or_retry_notification_delivery(uuid, text, uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.confirm_notification_delivery_sent(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.renew_notification_delivery_leases(text, uuid[], integer);
DROP FUNCTION IF EXISTS public.authorize_notification_delivery_dispatch(uuid, uuid, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.reserve_notification_deliveries(text, integer, integer);
DROP FUNCTION IF EXISTS public.sweep_expired_notification_queue_jobs();
DROP FUNCTION IF EXISTS public.complete_notification_queue_job(uuid, text);
DROP FUNCTION IF EXISTS public.fail_or_retry_notification_job(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.renew_notification_queue_lease(uuid, text, integer);
DROP FUNCTION IF EXISTS public.claim_notification_queue_batch(text, integer, integer);
DROP FUNCTION IF EXISTS public.trg_sync_campaign_cancellation();
DROP FUNCTION IF EXISTS public.trg_protect_user_notifications_update();
DROP FUNCTION IF EXISTS public.trg_sync_notification_token_ownership();
DROP FUNCTION IF EXISTS public.trg_sync_notification_token_hash();
DROP FUNCTION IF EXISTS public.trg_validate_delivery_status_transition();
DROP FUNCTION IF EXISTS public.notifications_is_admin();

-- ----------------------------------------------------------------------------
-- STEP 4: TRANSIENT WORKER QUEUE TEARDOWN
-- Only ephemeral job queue and worker locks are dropped by default.
-- Data-bearing tables (notification_deliveries, notification_telemetry,
-- notification_audit_log, notification_campaigns, user_notifications,
-- notification_tokens, and subscriptions) ARE PRESERVED INTACT.
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.notification_queue;

-- OPTIONAL DESTRUCTIVE TEARDOWN:
-- If and ONLY IF an operator has completed the backup above AND explicitly
-- authorizes the deletion of campaign, delivery, telemetry and audit history,
-- uncomment the following block:
/*
DROP TABLE IF EXISTS public.notification_audit_log;
DROP TABLE IF EXISTS public.notification_telemetry;
DROP TABLE IF EXISTS public.notification_deliveries;
DROP TABLE IF EXISTS public.notification_campaigns;
*/

-- ----------------------------------------------------------------------------
-- STEP 5: REVERT CONSTRAINTS & INDEXES ON USER DATA TABLES
-- Tables public.notification_tokens, public.user_notifications,
-- public.movie_notify_requests, public.actor_notify_requests,
-- public.genre_notify_requests, and public.notification_opt_outs
-- ARE PRESERVED INTACT TO PREVENT USER DATA LOSS.
-- ----------------------------------------------------------------------------

-- notification_tokens
ALTER TABLE IF EXISTS public.notification_tokens 
    DROP CONSTRAINT IF EXISTS fk_notification_tokens_user;
DROP INDEX IF EXISTS public.uq_notification_tokens_hash;
DROP INDEX IF EXISTS public.idx_notification_tokens_user_active;

-- movie_notify_requests
ALTER TABLE IF EXISTS public.movie_notify_requests 
    DROP CONSTRAINT IF EXISTS fk_movie_notify_user;
DROP INDEX IF EXISTS public.uq_movie_notify_user;

-- actor_notify_requests
ALTER TABLE IF EXISTS public.actor_notify_requests 
    DROP CONSTRAINT IF EXISTS fk_actor_notify_user;
DROP INDEX IF EXISTS public.uq_actor_notify_user;
ALTER TABLE IF EXISTS public.actor_notify_requests 
    ALTER COLUMN actor_id DROP NOT NULL;

-- genre_notify_requests
ALTER TABLE IF EXISTS public.genre_notify_requests 
    DROP CONSTRAINT IF EXISTS fk_genre_notify_user;
DROP INDEX IF EXISTS public.uq_genre_notify_user;
ALTER TABLE IF EXISTS public.genre_notify_requests 
    ALTER COLUMN genre_id DROP NOT NULL;

-- ----------------------------------------------------------------------------
-- STEP 6: PRESERVE AUDIT QUARANTINE DATA
-- The following tables are STRICTLY PRESERVED:
--   - public.legacy_token_quarantine
--   - public.legacy_subscription_quarantine
--   - public.legacy_delivery_quarantine
-- Dropping them would erase historical evidence of quarantined and pruned records.
-- ----------------------------------------------------------------------------

COMMIT;
