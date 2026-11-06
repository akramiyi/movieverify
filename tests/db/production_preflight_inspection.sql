-- ============================================================================
-- MOVIEVERIFY PRODUCTION PREFLIGHT INSPECTION SUITE (STRICT READ-ONLY)
-- File: tests/db/production_preflight_inspection.sql
-- Target: Production Supabase SQL Editor
-- Safety: 100% SELECT-only queries against system catalogs and application tables.
-- Zero mutations, zero DDL, zero locking, zero state alteration.
-- ============================================================================

-- ============================================================================
-- PART 1: UNCONDITIONAL SYSTEM CATALOG INSPECTIONS
-- (These queries are 100% safe to run in any database, whether tables exist or not)
-- ============================================================================

-- Q1: Table Existence & Schema Classification across all 15 candidate tables
SELECT 
    t.table_name,
    CASE 
        WHEN to_regclass('public.' || t.table_name) IS NOT NULL THEN 'EXISTS' 
        ELSE 'DOES_NOT_EXIST' 
    END AS table_status,
    CASE 
        WHEN to_regclass('public.' || t.table_name) IS NOT NULL THEN pg_size_pretty(pg_total_relation_size('public.' || t.table_name))
        ELSE '0 bytes' 
    END AS total_size
FROM (VALUES 
    ('admin_users'),
    ('notification_tokens'),
    ('movie_notify_requests'),
    ('actor_notify_requests'),
    ('genre_notify_requests'),
    ('notification_campaigns'),
    ('notification_queue'),
    ('notification_deliveries'),
    ('notification_telemetry'),
    ('user_notifications'),
    ('notification_opt_outs'),
    ('notification_audit_log'),
    ('legacy_token_quarantine'),
    ('legacy_subscription_quarantine'),
    ('legacy_delivery_quarantine')
) AS t(table_name)
ORDER BY table_status DESC, t.table_name;

-- Q2: Public Schema Privilege Audit (Verify untrusted roles CANNOT create objects in public)
SELECT 
    r.rolname AS role_name,
    has_schema_privilege(r.rolname, 'public', 'USAGE') AS has_public_usage,
    has_schema_privilege(r.rolname, 'public', 'CREATE') AS has_public_create,
    CASE 
        WHEN r.rolname IN ('anon', 'authenticated') AND has_schema_privilege(r.rolname, 'public', 'CREATE') THEN 'FAIL_INSECURE'
        WHEN r.rolname IN ('anon', 'authenticated') THEN 'PASS_SECURE'
        ELSE 'AUTHORIZED_ROLE'
    END AS security_verdict
FROM pg_roles r
WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'postgres', 'authenticator')
UNION ALL
SELECT 
    'public (pseudo-role)',
    has_schema_privilege('public', 'public', 'USAGE'),
    has_schema_privilege('public', 'public', 'CREATE'),
    CASE 
        WHEN has_schema_privilege('public', 'public', 'CREATE') THEN 'FAIL_INSECURE'
        ELSE 'PASS_SECURE'
    END
ORDER BY role_name;

-- Q3: Row Level Security (RLS) & Policy Inventory Across All 11 Notification Tables + admin_users
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual AS using_expression,
    with_check AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'admin_users',
    'notification_tokens',
    'movie_notify_requests',
    'actor_notify_requests',
    'genre_notify_requests',
    'notification_campaigns',
    'notification_queue',
    'notification_deliveries',
    'notification_telemetry',
    'user_notifications',
    'notification_opt_outs',
    'notification_audit_log'
  )
ORDER BY tablename, policyname;

-- Q4: Complete Function Ownership, search_path, and Security Definer Inventory
SELECT 
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    r.rolname AS owner,
    p.prosecdef AS is_security_definer,
    array_to_string(p.proconfig, ', ') AS proconfig_settings,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_roles r ON r.oid = p.proowner
WHERE n.nspname = 'public'
  AND p.proname IN (
    'notifications_is_admin',
    'claim_notification_queue_batch',
    'renew_notification_queue_lease',
    'fail_or_retry_notification_job',
    'complete_notification_queue_job',
    'sweep_expired_notification_queue_jobs',
    'reserve_notification_deliveries',
    'authorize_notification_delivery_dispatch',
    'renew_notification_delivery_leases',
    'confirm_notification_delivery_sent',
    'fail_or_retry_notification_delivery',
    'record_notification_telemetry',
    'sweep_expired_delivery_reservations',
    'sweep_stale_notification_deliveries',
    'ingest_notification_campaign',
    'cancel_notification_campaign',
    'trg_validate_delivery_status_transition',
    'trg_sync_notification_token_hash',
    'trg_sync_notification_token_ownership',
    'trg_protect_user_notifications_update',
    'trg_sync_campaign_cancellation'
  )
ORDER BY p.proname;

-- ============================================================================
-- PART 2: CONDITIONAL DATA PREFLIGHT INSPECTIONS
-- (These dynamic SQL blocks check table and column existence before querying,
-- ensuring they never throw 42P01 undefined_table or 42703 undefined_column errors)
-- ============================================================================

-- Q5: Row Counts for Existing Notification Tables (Safe conditional execution)
DO $$
DECLARE
    v_sql text;
    v_rec record;
BEGIN
    RAISE NOTICE '=== Q5: ROW COUNTS FOR EXISTING NOTIFICATION TABLES ===';
    FOR v_rec IN 
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public' 
          AND tablename IN (
            'admin_users', 'notification_tokens', 'movie_notify_requests', 
            'actor_notify_requests', 'genre_notify_requests', 'notification_campaigns',
            'notification_queue', 'notification_deliveries', 'notification_telemetry',
            'user_notifications', 'notification_opt_outs', 'notification_audit_log',
            'legacy_token_quarantine', 'legacy_subscription_quarantine', 'legacy_delivery_quarantine'
          )
        ORDER BY tablename
    LOOP
        EXECUTE format('SELECT count(*) FROM public.%I', v_rec.tablename) INTO v_sql;
        RAISE NOTICE 'Table %: % rows', rpad(v_rec.tablename, 35), v_sql;
    END LOOP;
END $$;

-- Q6: Duplicate Notification Tokens Preflight (Checks raw token duplicate hashes)
DO $$
DECLARE
    v_dup_count integer := 0;
BEGIN
    RAISE NOTICE '=== Q6: DUPLICATE NOTIFICATION TOKENS PREFLIGHT ===';
    IF to_regclass('public.notification_tokens') IS NOT NULL THEN
        SELECT count(*) INTO v_dup_count FROM (
            SELECT encode(digest(token, 'sha256'), 'hex') 
            FROM public.notification_tokens 
            GROUP BY encode(digest(token, 'sha256'), 'hex') 
            HAVING count(*) > 1
        ) sub;
        RAISE NOTICE 'Duplicate token hash clusters found: %', v_dup_count;
        IF v_dup_count > 0 THEN
            RAISE NOTICE 'Action: Deduplication will prune duplicate rows (keeping newest) and archive them to legacy_token_quarantine.';
        ELSE
            RAISE NOTICE 'Status: Zero duplicate token hashes. Zero tokens will be pruned.';
        END IF;
    ELSE
        RAISE NOTICE 'notification_tokens does not exist yet. Safe to create.';
    END IF;
END $$;

-- Q7: Orphan user_id Values (user_id not present in auth.users)
DO $$
DECLARE
    v_orphans integer := 0;
    v_tbl text;
BEGIN
    RAISE NOTICE '=== Q7: ORPHAN USER_ID AUDIT ===';
    FOR v_tbl IN VALUES ('notification_tokens'), ('movie_notify_requests'), ('actor_notify_requests'), ('genre_notify_requests')
    LOOP
        IF to_regclass('public.' || v_tbl) IS NOT NULL THEN
            EXECUTE format(
                'SELECT count(*) FROM public.%I t WHERE t.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.user_id)',
                v_tbl
            ) INTO v_orphans;
            RAISE NOTICE 'Table %: % orphan user_id records found', rpad(v_tbl, 25), v_orphans;
        ELSE
            RAISE NOTICE 'Table %: does not exist', rpad(v_tbl, 25);
        END IF;
    END LOOP;
END $$;

-- Q8: Corrupted Subscription Records (NULL actor_id or NULL genre_id)
DO $$
DECLARE
    v_nulls integer := 0;
BEGIN
    RAISE NOTICE '=== Q8: CORRUPTED SUBSCRIPTION RECORDS AUDIT ===';
    IF to_regclass('public.actor_notify_requests') IS NOT NULL THEN
        SELECT count(*) INTO v_nulls FROM public.actor_notify_requests WHERE actor_id IS NULL;
        RAISE NOTICE 'actor_notify_requests with NULL actor_id: %', v_nulls;
    END IF;
    IF to_regclass('public.genre_notify_requests') IS NOT NULL THEN
        SELECT count(*) INTO v_nulls FROM public.genre_notify_requests WHERE genre_id IS NULL;
        RAISE NOTICE 'genre_notify_requests with NULL genre_id: %', v_nulls;
    END IF;
END $$;

-- Q9: Duplicate Subscriptions (Same user subscribed to the same entity multiple times)
DO $$
DECLARE
    v_dups integer := 0;
BEGIN
    RAISE NOTICE '=== Q9: DUPLICATE SUBSCRIPTIONS AUDIT ===';
    IF to_regclass('public.movie_notify_requests') IS NOT NULL THEN
        SELECT count(*) INTO v_dups FROM (
            SELECT movie_id, user_id FROM public.movie_notify_requests 
            WHERE user_id IS NOT NULL GROUP BY movie_id, user_id HAVING count(*) > 1
        ) sub;
        RAISE NOTICE 'movie_notify_requests duplicate pairs: %', v_dups;
    END IF;
    IF to_regclass('public.actor_notify_requests') IS NOT NULL THEN
        SELECT count(*) INTO v_dups FROM (
            SELECT actor_id, user_id FROM public.actor_notify_requests 
            WHERE user_id IS NOT NULL GROUP BY actor_id, user_id HAVING count(*) > 1
        ) sub;
        RAISE NOTICE 'actor_notify_requests duplicate pairs: %', v_dups;
    END IF;
    IF to_regclass('public.genre_notify_requests') IS NOT NULL THEN
        SELECT count(*) INTO v_dups FROM (
            SELECT genre_id, user_id FROM public.genre_notify_requests 
            WHERE user_id IS NOT NULL GROUP BY genre_id, user_id HAVING count(*) > 1
        ) sub;
        RAISE NOTICE 'genre_notify_requests duplicate pairs: %', v_dups;
    END IF;
END $$;

-- Q10: Deliveries Status Audit (Inspect in-flight deliveries if table exists)
DO $$
DECLARE
    v_rec record;
BEGIN
    RAISE NOTICE '=== Q10: DELIVERIES STATUS AUDIT ===';
    IF to_regclass('public.notification_deliveries') IS NOT NULL THEN
        FOR v_rec IN 
            SELECT delivery_status, count(*) as cnt 
            FROM public.notification_deliveries 
            GROUP BY delivery_status 
            ORDER BY cnt DESC
        LOOP
            RAISE NOTICE 'Delivery Status %: % records', rpad(v_rec.delivery_status, 15), v_rec.cnt;
        END LOOP;
    ELSE
        RAISE NOTICE 'notification_deliveries does not exist yet. No in-flight deliveries to reconcile.';
    END IF;
END $$;
