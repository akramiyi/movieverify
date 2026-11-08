-- ============================================================================
-- Migration: 20261108000006_notification_rls_and_dcl.sql
-- Description: Enables and forces RLS across 9 tables, scopes DCL privileges
-- Target: PostgreSQL 17 / Supabase
-- Architecture Baseline: Phase 1.9, v1.9.0
-- ============================================================================

-- 1. Enable and Force Row Level Security on all 9 tables
ALTER TABLE public.notification_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_endpoints FORCE ROW LEVEL SECURITY;

ALTER TABLE public.user_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notification_preferences FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notification_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_subscriptions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notifications FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notification_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_campaigns FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_queue FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notification_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_telemetry FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notification_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_audit_log FORCE ROW LEVEL SECURITY;

-- 2. Scoped Table Privileges (Strictly restricted to 9 notification tables)
-- Table 1: notification_endpoints
REVOKE ALL ON TABLE public.notification_endpoints FROM anon, authenticated, public;
GRANT SELECT (
    id, user_id, channel_type, device_type, device_name, browser, os, is_active, last_seen_at, created_at, updated_at
) ON public.notification_endpoints TO authenticated;
GRANT UPDATE (device_name) ON public.notification_endpoints TO authenticated;
GRANT ALL ON public.notification_endpoints TO service_role;

-- Table 2: user_notification_preferences
REVOKE ALL ON TABLE public.user_notification_preferences FROM anon, authenticated, public;
GRANT SELECT, INSERT ON public.user_notification_preferences TO authenticated;
GRANT UPDATE (
    opt_in_all, notify_new_movies, notify_new_series, notify_movie_updates, 
    notify_promotions, notify_system, channel_in_app, channel_push, 
    channel_email, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, 
    quiet_hours_tz, max_daily_push
) ON public.user_notification_preferences TO authenticated;
GRANT ALL ON public.user_notification_preferences TO service_role;

-- Table 3: notification_subscriptions
REVOKE ALL ON TABLE public.notification_subscriptions FROM anon, authenticated, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_subscriptions TO authenticated;
GRANT ALL ON public.notification_subscriptions TO service_role;

-- Table 4: user_notifications (inbox)
REVOKE ALL ON TABLE public.user_notifications FROM anon, authenticated, public;
GRANT SELECT ON public.user_notifications TO authenticated;
GRANT UPDATE (is_read, read_at, is_deleted) ON public.user_notifications TO authenticated;
GRANT ALL ON public.user_notifications TO service_role;

-- Table 5: notification_campaigns
REVOKE ALL ON TABLE public.notification_campaigns FROM anon, authenticated, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_campaigns TO authenticated;
GRANT ALL ON public.notification_campaigns TO service_role;

-- Table 6: notification_queue
REVOKE ALL ON TABLE public.notification_queue FROM anon, authenticated, public;
GRANT SELECT ON public.notification_queue TO authenticated;
GRANT ALL ON public.notification_queue TO service_role;

-- Table 7: notification_deliveries
REVOKE ALL ON TABLE public.notification_deliveries FROM anon, authenticated, public;
GRANT SELECT ON public.notification_deliveries TO authenticated;
GRANT ALL ON public.notification_deliveries TO service_role;

-- Table 8: notification_telemetry
REVOKE ALL ON TABLE public.notification_telemetry FROM anon, authenticated, public;
GRANT SELECT ON public.notification_telemetry TO authenticated;
GRANT ALL ON public.notification_telemetry TO service_role;

-- Table 9: notification_audit_log
REVOKE ALL ON TABLE public.notification_audit_log FROM anon, authenticated, public;
GRANT SELECT ON public.notification_audit_log TO authenticated;
GRANT SELECT, INSERT ON public.notification_audit_log TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.notification_audit_log FROM service_role;

-- Sequence Privileges
REVOKE ALL ON SEQUENCE public.notification_audit_log_id_seq FROM anon, authenticated, public;
GRANT USAGE, SELECT ON SEQUENCE public.notification_audit_log_id_seq TO service_role;

-- Safe View Privileges
REVOKE ALL ON TABLE public.user_notification_endpoints FROM anon, public;
GRANT SELECT ON TABLE public.user_notification_endpoints TO authenticated;

-- Function Privileges (Explicit signatures)
REVOKE ALL ON FUNCTION public.notifications_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notifications_is_admin() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.register_notification_endpoint(
    varchar, text, text, text, text, text, varchar, varchar, varchar, varchar
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_notification_endpoint(
    varchar, text, text, text, text, text, varchar, varchar, varchar, varchar
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.claim_notification_endpoint(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_notification_endpoint(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.revoke_notification_endpoint(uuid, text, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_notification_endpoint(uuid, text, varchar) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.ingest_notification_campaign(text, text, text, text, text, jsonb, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_notification_campaign(text, text, text, text, text, jsonb, timestamptz, uuid) TO authenticated, service_role;

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

REVOKE ALL ON FUNCTION public.record_notification_telemetry(uuid, uuid, varchar, uuid, varchar, varchar, timestamptz, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_notification_telemetry(uuid, uuid, varchar, uuid, varchar, varchar, timestamptz, jsonb) TO service_role;

-- 3. Row Level Security Policies
-- Table 1: notification_endpoints
DROP POLICY IF EXISTS p_endpoints_user_select ON public.notification_endpoints;
CREATE POLICY p_endpoints_user_select ON public.notification_endpoints
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.notifications_is_admin());

DROP POLICY IF EXISTS p_endpoints_user_update ON public.notification_endpoints;
CREATE POLICY p_endpoints_user_update ON public.notification_endpoints
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS p_endpoints_service_all ON public.notification_endpoints;
CREATE POLICY p_endpoints_service_all ON public.notification_endpoints
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

-- Table 2: user_notification_preferences
DROP POLICY IF EXISTS p_prefs_user_select ON public.user_notification_preferences;
CREATE POLICY p_prefs_user_select ON public.user_notification_preferences
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.notifications_is_admin());

DROP POLICY IF EXISTS p_prefs_user_insert ON public.user_notification_preferences;
CREATE POLICY p_prefs_user_insert ON public.user_notification_preferences
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS p_prefs_user_update ON public.user_notification_preferences;
CREATE POLICY p_prefs_user_update ON public.user_notification_preferences
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS p_prefs_service_all ON public.user_notification_preferences;
CREATE POLICY p_prefs_service_all ON public.user_notification_preferences
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

-- Table 3: notification_subscriptions
DROP POLICY IF EXISTS p_subs_user_all ON public.notification_subscriptions;
CREATE POLICY p_subs_user_all ON public.notification_subscriptions
FOR ALL TO authenticated
USING (user_id = auth.uid() OR public.notifications_is_admin())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS p_subs_service_all ON public.notification_subscriptions;
CREATE POLICY p_subs_service_all ON public.notification_subscriptions
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

-- Table 4: user_notifications (inbox)
DROP POLICY IF EXISTS p_inbox_user_select ON public.user_notifications;
CREATE POLICY p_inbox_user_select ON public.user_notifications
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.notifications_is_admin());

DROP POLICY IF EXISTS p_inbox_user_update ON public.user_notifications;
CREATE POLICY p_inbox_user_update ON public.user_notifications
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS p_inbox_service_all ON public.user_notifications;
CREATE POLICY p_inbox_service_all ON public.user_notifications
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

-- Table 5: notification_campaigns
DROP POLICY IF EXISTS p_camp_admin_all ON public.notification_campaigns;
CREATE POLICY p_camp_admin_all ON public.notification_campaigns
FOR ALL TO authenticated
USING (public.notifications_is_admin())
WITH CHECK (public.notifications_is_admin());

DROP POLICY IF EXISTS p_camp_service_all ON public.notification_campaigns;
CREATE POLICY p_camp_service_all ON public.notification_campaigns
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

-- Table 6: notification_queue
DROP POLICY IF EXISTS p_queue_admin_select ON public.notification_queue;
CREATE POLICY p_queue_admin_select ON public.notification_queue
FOR SELECT TO authenticated
USING (public.notifications_is_admin());

DROP POLICY IF EXISTS p_queue_service_all ON public.notification_queue;
CREATE POLICY p_queue_service_all ON public.notification_queue
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

-- Table 7: notification_deliveries
DROP POLICY IF EXISTS p_deliv_user_select ON public.notification_deliveries;
CREATE POLICY p_deliv_user_select ON public.notification_deliveries
FOR SELECT TO authenticated
USING (recipient_id = auth.uid() OR public.notifications_is_admin());

DROP POLICY IF EXISTS p_deliv_service_all ON public.notification_deliveries;
CREATE POLICY p_deliv_service_all ON public.notification_deliveries
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

-- Table 8: notification_telemetry
DROP POLICY IF EXISTS p_telem_user_select ON public.notification_telemetry;
CREATE POLICY p_telem_user_select ON public.notification_telemetry
FOR SELECT TO authenticated
USING (recipient_id = auth.uid() OR public.notifications_is_admin());

DROP POLICY IF EXISTS p_telem_service_all ON public.notification_telemetry;
CREATE POLICY p_telem_service_all ON public.notification_telemetry
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

-- Table 9: notification_audit_log
DROP POLICY IF EXISTS p_audit_admin_select ON public.notification_audit_log;
CREATE POLICY p_audit_admin_select ON public.notification_audit_log
FOR SELECT TO authenticated
USING (public.notifications_is_admin());

DROP POLICY IF EXISTS p_audit_service_all ON public.notification_audit_log;
CREATE POLICY p_audit_service_all ON public.notification_audit_log
FOR SELECT TO service_role
USING (true);

DROP POLICY IF EXISTS p_audit_service_insert ON public.notification_audit_log;
CREATE POLICY p_audit_service_insert ON public.notification_audit_log
FOR INSERT TO service_role
WITH CHECK (true);

