-- ============================================================================
-- MovieVerify Phase 5.9.7: Production Read-Only Preflight SQL (Linked Project)
-- Strictly READ-ONLY (SELECT / WITH ... SELECT only; zero mutations).
-- Privacy Guard: Returns schema metadata and aggregate counts only. Never
-- selects raw FCM tokens, VAPID keys, hashes, emails, or user secrets.
-- ============================================================================

-- 1A. Applied migration ledger
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version ASC;

-- 1B. Exact 8 baseline versions vs unexpected/pending versions check
WITH expected_baseline(version) AS (
    VALUES
        ('20261108000001'),
        ('20261108000002'),
        ('20261108000003'),
        ('20261108000004'),
        ('20261108000005'),
        ('20261108000006'),
        ('20261108000007'),
        ('20261108195246')
),
pending_candidates(version, label) AS (
    VALUES
        ('20261110150000', 'B5D_dispatch_hardening_DO_NOT_APPLY_VERBATIM'),
        ('20261111000000', 'B5E_endpoint_revocation_DO_NOT_APPLY_VERBATIM'),
        ('20261111120000', 'Phase_5_2_automation_engine'),
        ('20261111150000', 'Phase_5_4_critical_remediation'),
        ('20261111180000', 'Phase_5_9_5_unified_dispatch_revocation')
)
SELECT
    e.version,
    'expected_baseline' AS category,
    (m.version IS NOT NULL) AS applied
FROM expected_baseline e
LEFT JOIN supabase_migrations.schema_migrations m ON m.version = e.version
UNION ALL
SELECT
    p.version,
    p.label AS category,
    (m.version IS NOT NULL) AS applied
FROM pending_candidates p
LEFT JOIN supabase_migrations.schema_migrations m ON m.version = p.version
ORDER BY version;

-- 2. Existing notification tables & views (RLS, FORCE RLS & security_invoker options)
SELECT
    c.relname AS relation_name,
    c.relkind,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS rls_forced,
    c.reloptions
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
      'notification_endpoints',
      'user_notification_endpoints',
      'notification_tokens',
      'user_notification_preferences',
      'notification_subscriptions',
      'user_notifications',
      'notification_campaigns',
      'notification_audit_log',
      'notification_queue',
      'notification_deliveries',
      'notification_telemetry',
      'user_welcome_dispatches',
      'movie_notify_requests',
      'legacy_delivery_quarantine'
  )
ORDER BY c.relname;

-- 3. Relevant columns on endpoints, deliveries, and legacy subscription table
SELECT
    table_name,
    ordinal_position,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('notification_endpoints', 'notification_deliveries', 'movie_notify_requests')
ORDER BY table_name, ordinal_position;

-- 4. Existing constraints (including FK delete rules) & indexes on notification tables
SELECT
    c.conrelid::regclass AS table_name,
    c.conname AS constraint_name,
    c.contype AS constraint_type,
    c.confdeltype AS fk_delete_action,
    pg_get_constraintdef(c.oid) AS constraint_def
FROM pg_constraint c
JOIN pg_class tbl ON tbl.oid = c.conrelid
JOIN pg_namespace n ON n.oid = tbl.relnamespace
WHERE n.nspname = 'public'
  AND tbl.relname IN (
      'notification_endpoints',
      'notification_campaigns',
      'notification_deliveries',
      'notification_telemetry',
      'user_notifications',
      'user_welcome_dispatches',
      'movie_notify_requests'
  )
ORDER BY tbl.relname, c.conname;

SELECT
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
      'notification_endpoints',
      'notification_campaigns',
      'notification_deliveries',
      'notification_telemetry',
      'user_notifications',
      'user_welcome_dispatches',
      'movie_notify_requests'
  )
ORDER BY tablename, indexname;

-- 5A. Information schema trigger definitions & bindings
SELECT
    event_object_schema,
    event_object_table,
    trigger_name,
    action_timing,
    event_manipulation,
    action_statement
FROM information_schema.triggers
WHERE event_object_schema IN ('public', 'auth')
  AND (
      event_object_table LIKE '%notification%'
      OR event_object_table IN ('movie_notify_requests', 'actor_notify_requests', 'genre_notify_requests', 'users')
  )
ORDER BY event_object_schema, event_object_table, trigger_name;

-- 5B. Catalog trigger enablement state (verifies auth.users welcome trigger state)
SELECT
    n.nspname AS table_schema,
    c.relname AS table_name,
    t.tgname AS trigger_name,
    t.tgenabled AS trigger_enabled_mode,
    t.tgfoid::regproc AS trigger_function
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND n.nspname IN ('public', 'auth')
  AND (
      c.relname LIKE '%notification%'
      OR c.relname IN ('movie_notify_requests', 'actor_notify_requests', 'genre_notify_requests', 'users')
  )
ORDER BY n.nspname, c.relname, t.tgname;

-- 6. pg_proc signatures, owners, SECURITY DEFINER, search_path & explicit ACLs
SELECT
    p.proname,
    pg_get_function_identity_arguments(p.oid) AS args,
    pg_get_function_result(p.oid) AS return_type,
    pg_get_userbyid(p.proowner) AS owner_role,
    p.prosecdef AS is_security_definer,
    p.proconfig AS function_config,
    COALESCE(array_to_string(p.proacl, ', '), '<DEFAULT PUBLIC>') AS proacl_raw,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
      'notifications_is_admin',
      'cancel_notification_campaign',
      'reserve_notification_deliveries',
      'authorize_notification_delivery_dispatch',
      'confirm_notification_delivery_sent',
      'fail_or_retry_notification_delivery',
      'record_notification_delivery_failure',
      'sweep_expired_delivery_reservations',
      'record_notification_telemetry',
      'ingest_notification_campaign',
      '_materialize_notification_campaign',
      'promote_due_scheduled_campaigns',
      'issue_welcome_notification',
      '_issue_welcome_notification_internal',
      'trg_auth_user_welcome_notification',
      'is_category_allowed_by_preferences',
      'resolve_valid_timezone',
      'compute_quiet_hours_resume_at',
      'trg_compat_notification_tokens_update',
      'trg_validate_delivery_ownership',
      'trg_enforce_delivery_identity_immutability'
  )
ORDER BY p.proname, args;

-- 7. notification_endpoints inconsistent revocation & integrity counts
SELECT
    count(*) AS total_endpoints,
    count(*) FILTER (WHERE is_active = true AND revoked_at IS NULL AND revocation_reason IS NULL) AS clean_active,
    count(*) FILTER (WHERE is_active = true AND revoked_at IS NOT NULL) AS inconsistent_active_with_revoked_at,
    count(*) FILTER (WHERE is_active = true AND revocation_reason IS NOT NULL) AS inconsistent_active_with_reason,
    count(*) FILTER (WHERE is_active = true AND (revoked_at IS NOT NULL OR revocation_reason IS NOT NULL)) AS total_inconsistent_to_reconcile,
    count(*) FILTER (WHERE is_active = false) AS inactive_endpoints,
    count(*) FILTER (WHERE is_active = false AND revoked_at IS NULL) AS inactive_missing_revoked_at
FROM public.notification_endpoints;

-- 8. Pending/leased deliveries linked to missing, inactive, revoked, inconsistent, or mismatched endpoints
SELECT
    d.delivery_status,
    count(*) AS delivery_count,
    count(*) FILTER (WHERE d.endpoint_id IS NOT NULL AND e.id IS NULL) AS missing_endpoint_refs,
    count(*) FILTER (WHERE e.is_active = false) AS inactive_endpoint_refs,
    count(*) FILTER (WHERE e.revoked_at IS NOT NULL OR e.revocation_reason IS NOT NULL) AS revoked_endpoint_refs,
    count(*) FILTER (WHERE e.is_active = true AND (e.revoked_at IS NOT NULL OR e.revocation_reason IS NOT NULL)) AS inconsistent_active_revoked_refs,
    count(*) FILTER (WHERE d.endpoint_id IS NOT NULL AND e.user_id IS DISTINCT FROM d.recipient_id) AS ownership_mismatched_refs
FROM public.notification_deliveries d
LEFT JOIN public.notification_endpoints e ON e.id = d.endpoint_id
WHERE d.delivery_status IN ('pending', 'leased')
GROUP BY d.delivery_status
ORDER BY d.delivery_status;

-- 9A. Orphan deliveries (null or missing campaign_id)
SELECT
    count(*) FILTER (WHERE d.campaign_id IS NULL) AS orphan_null_campaign_deliveries,
    count(*) FILTER (WHERE c.id IS NULL AND d.campaign_id IS NOT NULL) AS orphan_missing_campaign_deliveries
FROM public.notification_deliveries d
LEFT JOIN public.notification_campaigns c ON c.id = d.campaign_id;

-- 9B. Duplicate PUSH deliveries & telemetry preservation hazard summary
WITH dup_push_groups AS (
    SELECT
        d.campaign_id,
        d.endpoint_id,
        count(*) AS row_cnt,
        count(DISTINCT (d.recipient_type || ':' || COALESCE(d.recipient_id::text, '<NULL>'))) AS recipient_sig_cnt,
        ARRAY_AGG(d.id) AS delivery_ids
    FROM public.notification_deliveries d
    WHERE d.endpoint_id IS NOT NULL
    GROUP BY d.campaign_id, d.endpoint_id
    HAVING count(*) > 1
),
dup_push_telemetry_collisions AS (
    SELECT
        g.campaign_id,
        g.endpoint_id,
        count(*) AS colliding_nonce_pairs
    FROM dup_push_groups g
    JOIN public.notification_telemetry t ON t.delivery_id = ANY(g.delivery_ids)
    GROUP BY g.campaign_id, g.endpoint_id, t.event_type, t.event_nonce
    HAVING count(*) > 1
)
SELECT
    count(*) AS duplicate_push_groups,
    COALESCE(sum(row_cnt - 1), 0) AS excess_push_rows,
    count(*) FILTER (WHERE recipient_sig_cnt > 1) AS ambiguous_recipient_push_groups,
    (
        SELECT count(*)
        FROM public.notification_telemetry t
        WHERE t.delivery_id IN (SELECT unnest(delivery_ids) FROM dup_push_groups)
    ) AS telemetry_rows_on_duplicate_push,
    (SELECT count(DISTINCT (campaign_id, endpoint_id)) FROM dup_push_telemetry_collisions) AS push_groups_with_nonce_collision
FROM dup_push_groups;

-- 9C. Duplicate IN-APP deliveries & telemetry preservation hazard summary
WITH dup_inapp_groups AS (
    SELECT
        d.campaign_id,
        d.recipient_id,
        count(*) AS row_cnt,
        count(*) FILTER (WHERE d.endpoint_id IS NOT NULL) AS non_null_endpoint_rows,
        ARRAY_AGG(d.id) AS delivery_ids
    FROM public.notification_deliveries d
    WHERE d.channel_type = 'in_app'
      AND d.campaign_id IS NOT NULL
      AND d.recipient_id IS NOT NULL
    GROUP BY d.campaign_id, d.recipient_id
    HAVING count(*) > 1
),
dup_inapp_telemetry_collisions AS (
    SELECT
        g.campaign_id,
        g.recipient_id
    FROM dup_inapp_groups g
    JOIN public.notification_telemetry t ON t.delivery_id = ANY(g.delivery_ids)
    GROUP BY g.campaign_id, g.recipient_id, t.event_type, t.event_nonce
    HAVING count(*) > 1
)
SELECT
    count(*) AS duplicate_inapp_groups,
    COALESCE(sum(row_cnt - 1), 0) AS excess_inapp_rows,
    count(*) FILTER (WHERE non_null_endpoint_rows > 0) AS inapp_groups_with_non_null_endpoint,
    (
        SELECT count(*)
        FROM public.notification_telemetry t
        WHERE t.delivery_id IN (SELECT unnest(delivery_ids) FROM dup_inapp_groups)
    ) AS telemetry_rows_on_duplicate_inapp,
    (SELECT count(DISTINCT (campaign_id, recipient_id)) FROM dup_inapp_telemetry_collisions) AS inapp_groups_with_nonce_collision
FROM dup_inapp_groups;

-- 10A. Telemetry & inbox integrity (global + linked to inconsistent/inactive/revoked endpoints)
SELECT
    (SELECT count(*) FROM public.notification_telemetry) AS total_telemetry_rows,
    (SELECT count(*) FROM public.notification_telemetry WHERE delivery_id IS NOT NULL) AS telemetry_with_delivery_fk,
    (
        SELECT count(*)
        FROM public.notification_telemetry t
        LEFT JOIN public.notification_deliveries d ON d.id = t.delivery_id
        WHERE t.delivery_id IS NOT NULL AND d.id IS NULL
    ) AS orphan_telemetry_delivery_refs,
    (
        SELECT count(*)
        FROM public.notification_telemetry t
        JOIN public.notification_deliveries d ON d.id = t.delivery_id
        JOIN public.notification_endpoints e ON e.id = d.endpoint_id
        WHERE e.is_active = true AND (e.revoked_at IS NOT NULL OR e.revocation_reason IS NOT NULL)
    ) AS telemetry_linked_to_inconsistent_endpoints,
    (
        SELECT count(*)
        FROM public.notification_telemetry t
        JOIN public.notification_deliveries d ON d.id = t.delivery_id
        JOIN public.notification_endpoints e ON e.id = d.endpoint_id
        WHERE e.is_active = false OR e.revoked_at IS NOT NULL OR e.revocation_reason IS NOT NULL
    ) AS telemetry_linked_to_inactive_or_revoked_endpoints,
    (SELECT count(*) FROM public.user_notifications) AS total_inbox_rows,
    (SELECT count(*) FROM public.user_notifications WHERE delivery_id IS NOT NULL) AS inbox_with_delivery_fk,
    (SELECT count(*) FROM public.user_notifications WHERE campaign_id IS NOT NULL) AS inbox_with_campaign_fk,
    (
        SELECT count(*)
        FROM public.user_notifications u
        LEFT JOIN public.notification_deliveries d ON d.id = u.delivery_id
        WHERE u.delivery_id IS NOT NULL AND d.id IS NULL
    ) AS orphan_inbox_delivery_refs,
    (
        SELECT count(*)
        FROM public.user_notifications u
        JOIN public.notification_deliveries d ON d.id = u.delivery_id
        JOIN public.notification_endpoints e ON e.id = d.endpoint_id
        WHERE e.is_active = true AND (e.revoked_at IS NOT NULL OR e.revocation_reason IS NOT NULL)
    ) AS inbox_linked_to_inconsistent_endpoints,
    (
        SELECT count(*)
        FROM public.user_notifications u
        JOIN public.notification_deliveries d ON d.id = u.delivery_id
        JOIN public.notification_endpoints e ON e.id = d.endpoint_id
        WHERE e.is_active = false OR e.revoked_at IS NOT NULL OR e.revocation_reason IS NOT NULL
    ) AS inbox_linked_to_inactive_or_revoked_endpoints;

-- 10B. Legacy subscription multi-season & campaign idempotency uniqueness readiness
SELECT
    (
        SELECT count(*)
        FROM (
            SELECT m.user_id, m.movie_id, COALESCE(NULLIF(trim(to_jsonb(m)->>'target_season'), '')::integer, 0) AS season_scope
            FROM public.movie_notify_requests AS m
            GROUP BY m.user_id, m.movie_id, COALESCE(NULLIF(trim(to_jsonb(m)->>'target_season'), '')::integer, 0)
            HAVING count(*) > 1
        ) dup_sub
    ) AS duplicate_movie_notify_season_groups,
    (
        SELECT count(*)
        FROM (
            SELECT NULLIF(trim(COALESCE(target_criteria->>'idempotency_key', '')), '') AS ikey
            FROM public.notification_campaigns
            WHERE status <> 'cancelled'
              AND NULLIF(trim(COALESCE(target_criteria->>'idempotency_key', '')), '') IS NOT NULL
            GROUP BY 1
            HAVING count(*) > 1
        ) dup_ikey
    ) AS duplicate_active_campaign_idempotency_keys;
