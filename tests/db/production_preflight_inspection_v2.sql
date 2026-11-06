-- ============================================================================
-- MOVIEVERIFY PRODUCTION PREFLIGHT INSPECTION SUITE V2 (STRICT READ-ONLY)
-- File: tests/db/production_preflight_inspection_v2.sql
-- Target: Production Supabase SQL Editor (Option B Single-Infrastructure)
-- 
-- POSTGRESQL CONCURRENCY & LOCKING SPECIFICATION:
-- All inspection queries in this file execute pure SELECT statements against
-- PostgreSQL system catalogs and existing application tables.
-- In PostgreSQL, SELECT queries acquire ACCESS SHARE locks on queried relations.
-- ACCESS SHARE locks DO NOT block concurrent read or write transactions
-- (SELECT, INSERT, UPDATE, DELETE transactions operate concurrently).
-- However, ACCESS SHARE locks will conflict with concurrent ACCESS EXCLUSIVE
-- locks requested by DDL operations (such as ALTER TABLE, DROP TABLE, VACUUM FULL).
-- This script requests ZERO exclusive locks and executes ZERO mutations.
--
-- PRIVACY & CREDENTIAL HYGIENE:
-- This script NEVER selects or displays raw device tokens, user passwords,
-- JWT secrets, private keys, or PII. All token audits calculate aggregated
-- cryptographic hash cluster counts without exposing token strings.
-- ============================================================================

-- ============================================================================
-- PART 1: UNCONDITIONAL SYSTEM CATALOG INSPECTIONS
-- (These queries inspect PostgreSQL catalogs and are 100% safe to execute
-- in any database environment, whether application tables exist or not)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Q0: All-Schema Production Object & Privilege Cross-Check (PG17 & Supabase Audit)
-- ----------------------------------------------------------------------------
-- Cross-audits objects across public, auth, storage, extensions, cron, graphql, graphql_public
-- Audits table presence, relation sizes, RLS status, and checks for PostgreSQL 17 MAINTAIN privilege.
SELECT 
    n.nspname AS schemaname,
    c.relname AS object_name,
    c.relkind AS relkind,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS rls_forced,
    pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
    r.rolname AS object_owner,
    CASE 
        WHEN c.relrowsecurity THEN 'RLS_ACTIVE'
        ELSE 'RLS_NOT_ENABLED'
    END AS rls_status,
    COALESCE(
        (SELECT string_agg(priv.p_type, ', ')
         FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) priv(p_type)
         WHERE has_table_privilege('anon', c.oid, priv.p_type)
        ), 'NONE'
    ) AS anon_effective_privileges,
    COALESCE(
        (SELECT string_agg(priv.p_type, ', ')
         FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) priv(p_type)
         WHERE has_table_privilege('authenticated', c.oid, priv.p_type)
        ), 'NONE'
    ) AS authenticated_effective_privileges
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_roles r ON r.oid = c.relowner
WHERE n.nspname IN ('public', 'auth', 'storage', 'extensions', 'cron', 'graphql', 'graphql_public')
  AND c.relkind IN ('r', 'v', 'm', 'p')
  AND (
      n.nspname = 'public' 
      OR c.relname IN ('users', 'objects', 'buckets')
  )
ORDER BY n.nspname, c.relname;

-- ----------------------------------------------------------------------------
-- Q1: Table Existence & Schema Classification
-- ----------------------------------------------------------------------------
SELECT 
    t.table_name,
    CASE 
        WHEN to_regclass('public.' || t.table_name) IS NOT NULL THEN 'EXISTS' 
        ELSE 'DOES_NOT_EXIST' 
    END AS table_status,
    CASE 
        WHEN to_regclass('public.' || t.table_name) IS NOT NULL THEN pg_size_pretty(pg_total_relation_size('public.' || t.table_name))
        ELSE '0 bytes' 
    END AS total_relation_size,
    CASE 
        WHEN to_regclass('public.' || t.table_name) IS NOT NULL THEN 'PASS (Table exists)'
        ELSE 'SKIPPED (Table not yet created)'
    END AS inspection_status
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

-- ----------------------------------------------------------------------------
-- Q2: Public Schema Privilege Audit
-- Evaluates both effective role privileges and direct PUBLIC ACL metadata.
-- Verifies that untrusted roles (anon, authenticated, PUBLIC) cannot CREATE
-- objects in schema public, eliminating SECURITY DEFINER function shadowing.
-- ----------------------------------------------------------------------------

-- Q2.1: Individual Role Privilege Inspection
-- Explicitly starts from an inventory of expected roles (VALUES) to ensure that
-- missing cluster roles are reported explicitly (as MISSING) rather than silently omitted.
SELECT 
    er.expected_rolname AS evaluated_role,
    CASE 
        WHEN r.oid IS NOT NULL THEN 'EXISTS'
        ELSE 'MISSING'
    END AS role_status,
    CASE 
        WHEN r.oid IS NOT NULL THEN has_schema_privilege(r.oid, 'public', 'USAGE')
        ELSE false 
    END AS effective_usage,
    CASE 
        WHEN r.oid IS NOT NULL THEN has_schema_privilege(r.oid, 'public', 'CREATE')
        ELSE false 
    END AS effective_create,
    CASE 
        WHEN r.oid IS NULL 
            THEN 'FAIL (Expected cluster role does not exist in pg_roles)'
        WHEN er.expected_rolname IN ('anon', 'authenticated') AND has_schema_privilege(r.oid, 'public', 'CREATE') 
            THEN 'FAIL (Untrusted role possesses CREATE on public - shadowing risk)'
        WHEN er.expected_rolname IN ('anon', 'authenticated') AND NOT has_schema_privilege(r.oid, 'public', 'CREATE') 
            THEN 'PASS (Untrusted role cannot CREATE objects in public)'
        WHEN er.expected_rolname = 'postgres' AND has_schema_privilege(r.oid, 'public', 'CREATE') 
            THEN 'PASS (Database superuser/owner possesses CREATE)'
        WHEN er.expected_rolname = 'service_role' 
            THEN 'NEEDS REVIEW (Service role possesses ' || CASE WHEN has_schema_privilege(r.oid, 'public', 'CREATE') THEN 'CREATE' ELSE 'USAGE only' END || ')'
        WHEN er.expected_rolname = 'authenticator' AND NOT has_schema_privilege(r.oid, 'public', 'CREATE')
            THEN 'PASS (Connection pooler cannot CREATE objects)'
        ELSE 'NEEDS REVIEW (Inspect custom role privileges)'
    END AS privilege_verdict
FROM (VALUES 
    ('anon'),
    ('authenticated'),
    ('service_role'),
    ('postgres'),
    ('authenticator')
) AS er(expected_rolname)
LEFT JOIN pg_roles r ON r.rolname = er.expected_rolname
ORDER BY er.expected_rolname;

-- Q2.2: Direct PUBLIC Pseudo-Role ACL Inspection (Raw Metadata Breakdown)
-- NOTE ON DEFAULT ACL AND POSTGRESQL 15+ BEHAVIOR:
-- 1. When n.nspacl IS NULL, PostgreSQL applies the generic system default ACL for schemas,
--    represented by acldefault('n', n.nspowner).
-- 2. PostgreSQL documents that the generic hard-wired default ACL for a schema grants
--    USAGE and CREATE exclusively to the schema owner (world_default = ACL_NO_RIGHTS).
--    The generic schema default returned by acldefault('n', owner) does NOT grant USAGE to PUBLIC.
-- 3. In PostgreSQL 15+, the previous global default privilege allowing PUBLIC to CREATE objects
--    in the 'public' schema was removed. Any privileges possessed by PUBLIC on schema public
--    arise either from an explicit grant recorded in nspacl (e.g., standard template USAGE)
--    or from explicit database/role grants.
-- 4. An implicit default ACL (nspacl IS NULL) is NOT an explicit grant; it represents the absence
--    of custom ACL entries, falling back to owner-only schema access.
SELECT 
    'PUBLIC (pseudo-role)' AS grantee_identity,
    CASE 
        WHEN n.nspacl IS NULL THEN 'DEFAULT_ACL (Implicit: nspacl is NULL; generic schema default grants owner-only access via acldefault)'
        ELSE 'EXPLICIT_ACL (Directly configured in nspacl)'
    END AS acl_configuration_mode,
    (n.nspacl IS NULL) AS is_implicit_default_acl,
    COALESCE(
        (SELECT bool_or(a.privilege_type = 'CREATE')
         FROM aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
         WHERE a.grantee = 0),
        false
    ) AS public_has_direct_create,
    COALESCE(
        (SELECT bool_or(a.privilege_type = 'USAGE')
         FROM aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
         WHERE a.grantee = 0),
        false
    ) AS public_has_direct_usage,
    CASE 
        WHEN COALESCE(
            (SELECT bool_or(a.privilege_type = 'CREATE')
             FROM aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
             WHERE a.grantee = 0),
            false
        ) THEN 'FAIL (PUBLIC pseudo-role possesses CREATE grant on public in ACL metadata)'
        WHEN n.nspacl IS NULL THEN 'PASS (Implicit generic default ACL: zero CREATE and zero USAGE to PUBLIC; verify effective role privileges in Q2.1)'
        ELSE 'PASS (Explicit ACL metadata confirms zero CREATE privileges for PUBLIC pseudo-role on public)'
    END AS public_acl_verdict
FROM pg_namespace n
WHERE n.nspname = 'public';

-- ----------------------------------------------------------------------------
-- Q3: Row Level Security (RLS), Table Privileges & Column-Level Access Audit
-- Audits all 15 notification and quarantine tables:
--   - 12 active notification tables
--   - 3 legacy quarantine tables (legacy_token_quarantine, legacy_subscription_quarantine, legacy_delivery_quarantine)
-- 
-- RLS ENFORCEMENT & VERDICT SEMANTICS:
-- 1. RLS disabled (relrowsecurity = false): RLS supplies no row-level filtering. Actual access
--    depends strictly on SQL table/column privileges (GRANTs) and other controls.
-- 2. RLS enabled with zero policies: DEFAULT-DENY for ordinary roles subject to RLS. Table data
--    is inaccessible to clients unless policies are added.
-- 3. FORCE RLS (relforcerowsecurity = true): Makes the table owner subject to RLS policies.
-- 4. Superusers and roles with BYPASSRLS attribute always bypass RLS regardless of relforcerowsecurity.
-- 5. Without FORCE RLS, the table owner normally bypasses RLS. Disabling FORCE RLS is standard in
--    Supabase architectures so service_role/table-owner backend workers can operate without circular policies.
-- 6. Quarantine tables: Server-side quarantine tables are intended for internal ingestion and audit.
--    The consolidated migration creates them WITHOUT enabling RLS. Therefore, their security relies
--    strictly on SQL table/column privilege isolation (zero access to PUBLIC, anon, and authenticated).
-- ----------------------------------------------------------------------------

-- Q3.1: Table-Level RLS Enforcement, Role Bypass Attributes & SQL Privilege Audit
SELECT 
    n.nspname AS schemaname,
    c.relname AS tablename,
    c.oid AS table_oid,
    c.relrowsecurity AS relrowsecurity,
    c.relforcerowsecurity AS relforcerowsecurity,
    tbl_owner.rolname AS table_owner,
    COALESCE(tbl_owner.rolsuper, false) AS owner_is_superuser,
    COALESCE(tbl_owner.rolbypassrls, false) AS owner_has_bypassrls,
    CASE 
        WHEN anon_r.oid IS NULL THEN 'MISSING_ROLE (anon role not found in pg_roles)'
        WHEN anon_r.rolsuper THEN 'HIGH_RISK_BYPASS (anon role has superuser attribute)'
        WHEN anon_r.rolbypassrls THEN 'HIGH_RISK_BYPASS (anon role has BYPASSRLS attribute)'
        WHEN EXISTS (
            SELECT 1 FROM pg_roles bp
            WHERE bp.oid <> anon_r.oid
              AND (bp.rolsuper OR bp.rolbypassrls)
              AND pg_has_role(anon_r.oid, bp.oid, 'MEMBER')
        ) THEN 'HIGH_RISK_BYPASS (anon can assume superuser or BYPASSRLS role via membership: ' || (
            SELECT string_agg(bp.rolname, ', ')
            FROM pg_roles bp
            WHERE bp.oid <> anon_r.oid
              AND (bp.rolsuper OR bp.rolbypassrls)
              AND pg_has_role(anon_r.oid, bp.oid, 'MEMBER')
        ) || ')'
        ELSE 'ENFORCED (anon role subject to RLS; no direct or inherited bypass)'
    END AS anon_rls_bypass_status,
    CASE 
        WHEN auth_r.oid IS NULL THEN 'MISSING_ROLE (authenticated role not found in pg_roles)'
        WHEN auth_r.rolsuper THEN 'HIGH_RISK_BYPASS (authenticated role has superuser attribute)'
        WHEN auth_r.rolbypassrls THEN 'HIGH_RISK_BYPASS (authenticated role has BYPASSRLS attribute)'
        WHEN EXISTS (
            SELECT 1 FROM pg_roles bp
            WHERE bp.oid <> auth_r.oid
              AND (bp.rolsuper OR bp.rolbypassrls)
              AND pg_has_role(auth_r.oid, bp.oid, 'MEMBER')
        ) THEN 'HIGH_RISK_BYPASS (authenticated can assume superuser or BYPASSRLS role via membership: ' || (
            SELECT string_agg(bp.rolname, ', ')
            FROM pg_roles bp
            WHERE bp.oid <> auth_r.oid
              AND (bp.rolsuper OR bp.rolbypassrls)
              AND pg_has_role(auth_r.oid, bp.oid, 'MEMBER')
        ) || ')'
        ELSE 'ENFORCED (authenticated role subject to RLS; no direct or inherited bypass)'
    END AS authenticated_rls_bypass_status,
    CASE 
        WHEN srv_r.oid IS NULL THEN 'MISSING_ROLE (service_role not found in pg_roles)'
        WHEN srv_r.rolsuper THEN 'SUPERUSER_BYPASS (service_role has superuser attribute)'
        WHEN srv_r.rolbypassrls THEN 'BYPASSRLS_ACTIVE (service_role has BYPASSRLS attribute; bypasses table RLS)'
        ELSE 'SUBJECT_TO_RLS (service_role lacks BYPASSRLS; subject to RLS policies unless table owner)'
    END AS service_role_rls_bypass_status,
    CASE 
        WHEN NOT c.relrowsecurity 
            THEN 'RLS_DISABLED (RLS supplies no row filtering; access governed solely by SQL privileges)'
        WHEN count(pol.policyname) OVER (PARTITION BY c.oid) = 0
            THEN 'DEFAULT_DENY (RLS enabled with 0 policies; ordinary roles blocked by default-deny; owner ' || tbl_owner.rolname || ' and superusers bypass RLS)'
        WHEN c.relforcerowsecurity 
            THEN 'RLS_FORCE_ENABLED (RLS enforced for all roles including table owner ' || tbl_owner.rolname || '; superusers/BYPASSRLS bypass)'
        ELSE 'RLS_ENABLED (RLS enforced for ordinary roles; table owner ' || tbl_owner.rolname || ' and superusers bypass RLS)'
    END AS table_rls_enforcement_status,
    CASE 
        WHEN anon_r.oid IS NULL THEN 'SKIPPED (anon role missing)'
        ELSE COALESCE(
            (SELECT string_agg(priv.p_type, ', ')
             FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) priv(p_type)
             WHERE has_table_privilege(anon_r.oid, c.oid, priv.p_type)
            ), 'NONE'
        )
    END AS anon_table_privileges,
    CASE 
        WHEN auth_r.oid IS NULL THEN 'SKIPPED (authenticated role missing)'
        ELSE COALESCE(
            (SELECT string_agg(priv.p_type, ', ')
             FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) priv(p_type)
             WHERE has_table_privilege(auth_r.oid, c.oid, priv.p_type)
            ), 'NONE'
        )
    END AS authenticated_table_privileges,
    CASE 
        WHEN srv_r.oid IS NULL THEN 'SKIPPED (service_role missing)'
        ELSE COALESCE(
            (SELECT string_agg(priv.p_type, ', ')
             FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) priv(p_type)
             WHERE has_table_privilege(srv_r.oid, c.oid, priv.p_type)
            ), 'NONE'
        )
    END AS service_role_table_privileges,
    COALESCE(
        (SELECT string_agg(DISTINCT a.privilege_type, ', ' ORDER BY a.privilege_type)
         FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
         WHERE a.grantee = 0
        ), 'NONE'
    ) AS public_table_grants,
    pol.policyname,
    pol.permissive,
    pol.roles,
    pol.cmd,
    pol.qual AS using_expression,
    pol.with_check AS with_check_expression,
    count(pol.policyname) OVER (PARTITION BY c.oid) AS table_policy_count,
    count(pol.policyname) FILTER (WHERE pol.permissive = 'PERMISSIVE') OVER (PARTITION BY c.oid, pol.cmd) AS permissive_policies_for_cmd,
    COALESCE(bool_or(pol.cmd = 'ALL' AND pol.permissive = 'PERMISSIVE') OVER (PARTITION BY c.oid), false) AS table_has_permissive_all_policy,
    CASE 
        -- 1. Quarantine Tables: Not enabled for RLS in migration; verified via strict privilege isolation
        -- Complete Table Privilege Audit: SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
        WHEN c.relname IN ('legacy_token_quarantine', 'legacy_subscription_quarantine', 'legacy_delivery_quarantine')
            THEN CASE 
                -- Fail-safe: Required client roles must exist in pg_roles before evaluating isolation
                WHEN anon_r.oid IS NULL OR auth_r.oid IS NULL
                    THEN 'NEEDS REVIEW (Quarantine table evaluation skipped: anon or authenticated missing from pg_roles)'
                WHEN has_table_privilege(anon_r.oid, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
                    THEN 'FAIL (Quarantine table exposed to anon role via SQL table privileges)'
                WHEN has_table_privilege(auth_r.oid, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
                    THEN 'FAIL (Quarantine table exposed to authenticated role via SQL table privileges)'
                WHEN EXISTS (
                    SELECT 1 FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
                    WHERE a.grantee = 0 AND a.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
                ) THEN 'FAIL (Quarantine table has direct SQL privilege grant to PUBLIC)'
                WHEN c.relrowsecurity
                    THEN 'PASS (Quarantine table has zero client SQL privileges across all 8 privilege types (including PG17 MAINTAIN) and RLS enabled)'
                ELSE 'PASS (Quarantine table internal isolation verified: zero SQL table privileges across all 8 privilege types (including PG17 MAINTAIN) for PUBLIC, anon, and authenticated; RLS disabled as intended by migration)'
            END

        -- 2. Actual table RLS enforcement check: If RLS is disabled on regular notification tables
        WHEN NOT c.relrowsecurity
            THEN 'FAIL (RLS disabled; table lacks row-level filtering - access governed solely by SQL privileges)'

        -- 2. Zero-policy detection: If RLS is enabled but table has no policies defined
        WHEN pol.policyname IS NULL
            THEN 'DEFAULT_DENY (RLS enabled with 0 policies; ordinary roles blocked by default-deny; table owner ' || tbl_owner.rolname || ' and superusers bypass RLS)'

        -- 3. Permissive policy structure validation
        WHEN pol.permissive <> 'PERMISSIVE'
            THEN 'NEEDS REVIEW (Non-permissive / restrictive policy detected - inspect combination semantics)'

        -- 4. Multiple permissive policies for the same command combine with boolean OR, broadening access
        WHEN count(pol.policyname) FILTER (WHERE pol.permissive = 'PERMISSIVE') OVER (PARTITION BY c.oid, pol.cmd) > 1
            THEN 'NEEDS REVIEW (Multiple permissive policies detected on ' || c.relname || ' for ' || pol.cmd || ' - boolean OR combination may broaden access)'

        -- 5. Permissive specific command policy coexisting with permissive ALL policy on the same table
        WHEN pol.cmd <> 'ALL' AND COALESCE(bool_or(pol.cmd = 'ALL' AND pol.permissive = 'PERMISSIVE') OVER (PARTITION BY c.oid), false)
            THEN 'NEEDS REVIEW (Permissive ' || pol.cmd || ' policy coexists with permissive ALL policy on ' || c.relname || ' - boolean OR combination may broaden access)'

        -- 6. admin_users: verified self-row SELECT policy (exact identity: auth.uid() = user_id)
        WHEN c.relname = 'admin_users'
         AND pol.cmd = 'SELECT'
         AND 'authenticated' = ANY(pol.roles::text[])
         AND NOT ('anon' = ANY(pol.roles::text[]))
         AND regexp_replace(pol.qual, '\s+', '', 'g') IN ('(auth.uid()=user_id)', '((auth.uid()=user_id))', 'auth.uid()=user_id', '(user_id=auth.uid())', '((user_id=auth.uid()))', 'user_id=auth.uid()')
         AND pol.with_check IS NULL
            THEN 'PASS (Policy-level match: admin self-row SELECT. Note: does not prove complete table-level RLS security)'

        -- 7. notification_tokens: authenticated self-row management (exact identity: auth.uid() = user_id)
        WHEN c.relname = 'notification_tokens'
         AND pol.cmd = 'ALL'
         AND pol.roles::text[] = ARRAY['authenticated']
         AND regexp_replace(pol.qual, '\s+', '', 'g') IN ('(auth.uid()=user_id)', '((auth.uid()=user_id))', 'auth.uid()=user_id', '(user_id=auth.uid())', '((user_id=auth.uid()))', 'user_id=auth.uid()')
         AND regexp_replace(pol.with_check, '\s+', '', 'g') IN ('(auth.uid()=user_id)', '((auth.uid()=user_id))', 'auth.uid()=user_id', '(user_id=auth.uid())', '((user_id=auth.uid()))', 'user_id=auth.uid()')
            THEN 'PASS (Policy-level match: tokens self-row ALL for authenticated. Note: does not prove complete table-level RLS security)'

        -- 8. Subscription tables: authenticated self-row management (exact identity: auth.uid() = user_id)
        WHEN c.relname IN ('movie_notify_requests', 'actor_notify_requests', 'genre_notify_requests')
         AND pol.cmd = 'ALL'
         AND pol.roles::text[] = ARRAY['authenticated']
         AND regexp_replace(pol.qual, '\s+', '', 'g') IN ('(auth.uid()=user_id)', '((auth.uid()=user_id))', 'auth.uid()=user_id', '(user_id=auth.uid())', '((user_id=auth.uid()))', 'user_id=auth.uid()')
         AND regexp_replace(pol.with_check, '\s+', '', 'g') IN ('(auth.uid()=user_id)', '((auth.uid()=user_id))', 'auth.uid()=user_id', '(user_id=auth.uid())', '((user_id=auth.uid()))', 'user_id=auth.uid()')
            THEN 'PASS (Policy-level match: subscription self-row ALL for authenticated. Note: does not prove complete table-level RLS security)'

        -- 9. User notifications: authenticated self-read SELECT (exact identity: auth.uid() = user_id)
        WHEN c.relname = 'user_notifications'
         AND pol.cmd = 'SELECT'
         AND pol.roles::text[] = ARRAY['authenticated']
         AND regexp_replace(pol.qual, '\s+', '', 'g') IN ('(auth.uid()=user_id)', '((auth.uid()=user_id))', 'auth.uid()=user_id', '(user_id=auth.uid())', '((user_id=auth.uid()))', 'user_id=auth.uid()')
         AND pol.with_check IS NULL
            THEN 'PASS (Policy-level match: user_notifications SELECT for authenticated. Note: does not prove complete table-level RLS security)'

        -- 10. User notifications: authenticated self-update UPDATE (exact identity: auth.uid() = user_id)
        WHEN c.relname = 'user_notifications'
         AND pol.cmd = 'UPDATE'
         AND pol.roles::text[] = ARRAY['authenticated']
         AND regexp_replace(pol.qual, '\s+', '', 'g') IN ('(auth.uid()=user_id)', '((auth.uid()=user_id))', 'auth.uid()=user_id', '(user_id=auth.uid())', '((user_id=auth.uid()))', 'user_id=auth.uid()')
         AND regexp_replace(pol.with_check, '\s+', '', 'g') IN ('(auth.uid()=user_id)', '((auth.uid()=user_id))', 'auth.uid()=user_id', '(user_id=auth.uid())', '((user_id=auth.uid()))', 'user_id=auth.uid()')
            THEN 'PASS (Policy-level match: user_notifications UPDATE for authenticated. Note: does not prove complete table-level RLS security)'

        -- 11. Notification opt-outs: authenticated self-row management (exact identity: auth.uid() = user_id)
        WHEN c.relname = 'notification_opt_outs'
         AND pol.cmd = 'ALL'
         AND pol.roles::text[] = ARRAY['authenticated']
         AND regexp_replace(pol.qual, '\s+', '', 'g') IN ('(auth.uid()=user_id)', '((auth.uid()=user_id))', 'auth.uid()=user_id', '(user_id=auth.uid())', '((user_id=auth.uid()))', 'user_id=auth.uid()')
         AND regexp_replace(pol.with_check, '\s+', '', 'g') IN ('(auth.uid()=user_id)', '((auth.uid()=user_id))', 'auth.uid()=user_id', '(user_id=auth.uid())', '((user_id=auth.uid()))', 'user_id=auth.uid()')
            THEN 'PASS (Policy-level match: opt-outs self-row ALL for authenticated. Note: does not prove complete table-level RLS security)'

        -- 12. Admin-only tables: campaigns & queue management (exact function: notifications_is_admin())
        WHEN c.relname IN ('notification_campaigns', 'notification_queue')
         AND pol.cmd = 'ALL'
         AND pol.roles::text[] = ARRAY['authenticated']
         AND regexp_replace(pol.qual, '\s+', '', 'g') IN ('(public.notifications_is_admin())', '((public.notifications_is_admin()))', 'public.notifications_is_admin()', '(notifications_is_admin())', '((notifications_is_admin()))', 'notifications_is_admin()')
         AND regexp_replace(pol.with_check, '\s+', '', 'g') IN ('(public.notifications_is_admin())', '((public.notifications_is_admin()))', 'public.notifications_is_admin()', '(notifications_is_admin())', '((notifications_is_admin()))', 'notifications_is_admin()')
            THEN 'PASS (Policy-level match: admin-only ALL for authenticated. Note: does not prove complete table-level RLS security)'

        -- 13. Admin audit log: admin read-only SELECT (exact function: notifications_is_admin())
        WHEN c.relname = 'notification_audit_log'
         AND pol.cmd = 'SELECT'
         AND pol.roles::text[] = ARRAY['authenticated']
         AND regexp_replace(pol.qual, '\s+', '', 'g') IN ('(public.notifications_is_admin())', '((public.notifications_is_admin()))', 'public.notifications_is_admin()', '(notifications_is_admin())', '((notifications_is_admin()))', 'notifications_is_admin()')
         AND pol.with_check IS NULL
            THEN 'PASS (Policy-level match: admin-only audit log SELECT for authenticated. Note: does not prove complete table-level RLS security)'

        -- 14. Deliveries & Telemetry: recipient self-read OR admin (exact identity OR admin verification)
        WHEN c.relname IN ('notification_deliveries', 'notification_telemetry')
         AND pol.cmd = 'SELECT'
         AND pol.roles::text[] = ARRAY['authenticated']
         AND regexp_replace(pol.qual, '\s+', '', 'g') IN (
             '((auth.uid()=recipient_id)OR(public.notifications_is_admin()))',
             '((auth.uid()=recipient_id)OR(notifications_is_admin()))',
             '(auth.uid()=recipient_idORpublic.notifications_is_admin())',
             '(auth.uid()=recipient_idORnotifications_is_admin())',
             '((public.notifications_is_admin())OR(auth.uid()=recipient_id))',
             '((notifications_is_admin())OR(auth.uid()=recipient_id))',
             '(public.notifications_is_admin()ORauth.uid()=recipient_id)',
             '(notifications_is_admin()ORauth.uid()=recipient_id)',
             '((recipient_id=auth.uid())OR(public.notifications_is_admin()))',
             '((recipient_id=auth.uid())OR(notifications_is_admin()))',
             '(recipient_id=auth.uid()ORpublic.notifications_is_admin())',
             '(recipient_id=auth.uid()ORnotifications_is_admin())',
             '((public.notifications_is_admin())OR(recipient_id=auth.uid()))',
             '((notifications_is_admin())OR(recipient_id=auth.uid()))',
             '(public.notifications_is_admin()ORrecipient_id=auth.uid())',
             '(notifications_is_admin()ORrecipient_id=auth.uid())'
         )
         AND pol.with_check IS NULL
            THEN 'PASS (Policy-level match: deliveries/telemetry SELECT for authenticated. Note: does not prove complete table-level RLS security)'

        -- 15. Conservative fallback: legacy, unverified, or non-matching policies
        ELSE 'NEEDS REVIEW (Policy definition cannot be verified statically - inspect roles, cmd, qual, and with_check)'
    END AS policy_audit_status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_roles tbl_owner ON tbl_owner.oid = c.relowner
LEFT JOIN pg_roles anon_r ON anon_r.rolname = 'anon'
LEFT JOIN pg_roles auth_r ON auth_r.rolname = 'authenticated'
LEFT JOIN pg_roles srv_r ON srv_r.rolname = 'service_role'
LEFT JOIN pg_policies pol ON pol.schemaname = n.nspname AND pol.tablename = c.relname
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
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
    'notification_audit_log',
    'legacy_token_quarantine',
    'legacy_subscription_quarantine',
    'legacy_delivery_quarantine'
  )
ORDER BY c.relname, pol.policyname;

-- ----------------------------------------------------------------------------
-- Q3.2: Complete Sensitive Token and Quarantine Column Privilege Audit
-- Inspects column-level privileges for sensitive notification credential and hash columns:
--   - public.notification_tokens.token
--   - public.notification_tokens.token_hash
-- Inspects every column across all three quarantine tables:
--   - public.legacy_token_quarantine (6 columns)
--   - public.legacy_subscription_quarantine (7 columns)
--   - public.legacy_delivery_quarantine (7 columns)
--
-- SECURITY RATIONALE:
-- Device tokens and hashes are sensitive credentials. Untrusted client roles (anon, authenticated,
-- and the PUBLIC pseudo-role) must never possess direct column ACL grants or unchecked effective
-- privileges (SELECT, INSERT, UPDATE, REFERENCES) on these columns.
-- Quarantine tables contain orphaned or invalid tokens, subscriptions, and delivery payloads.
-- The migration intentionally does not enable RLS on quarantine tables; they rely on strict SQL
-- privilege isolation. Every column in every quarantine table must have zero direct column grants
-- and zero effective access for PUBLIC, anon, and authenticated across all 4 column privilege types.
-- NOTE ON POSTGRESQL PRIVILEGE INHERITANCE:
-- has_column_privilege() returns TRUE if privilege is granted either at table level OR at column level.
-- Therefore, this query independently reports:
--   1. Direct column ACL grants (from a.attacl) for PUBLIC, anon, and authenticated.
--   2. Effective column privileges (via has_column_privilege()) for all 4 privilege types.
--   3. Client role RLS bypass status (rolsuper, rolbypassrls, and reachable bypass roles).
-- FAIL-SAFE: If either anon or authenticated is missing from pg_roles, verdicts return NEEDS REVIEW.
-- A PASS verdict for notification_tokens requires zero direct column grants, zero anon access,
-- table RLS enforced, and verified absence of rolsuper/rolbypassrls on anon and authenticated.
-- A PASS verdict for quarantine columns verifies total client isolation with RLS disabled as intended.
-- This query NEVER selects or displays data; it audits catalog metadata and permissions only.
-- ----------------------------------------------------------------------------
SELECT 
    tgt.target_table,
    tgt.target_column,
    CASE 
        WHEN c.oid IS NULL THEN 'TABLE_MISSING'
        WHEN a.attnum IS NULL THEN 'COLUMN_MISSING'
        ELSE 'EXISTS'
    END AS object_status,
    -- Direct column-level ACL grants (attacl only)
    COALESCE(
        (SELECT string_agg(DISTINCT priv.privilege_type, ', ' ORDER BY priv.privilege_type)
         FROM aclexplode(a.attacl) priv
         WHERE priv.grantee = 0
        ), 'NONE'
    ) AS public_direct_column_grants,
    COALESCE(
        (SELECT string_agg(DISTINCT priv.privilege_type, ', ' ORDER BY priv.privilege_type)
         FROM aclexplode(a.attacl) priv
         JOIN pg_roles r ON r.oid = priv.grantee
         WHERE r.rolname = 'anon'
        ), 'NONE'
    ) AS anon_direct_column_grants,
    COALESCE(
        (SELECT string_agg(DISTINCT priv.privilege_type, ', ' ORDER BY priv.privilege_type)
         FROM aclexplode(a.attacl) priv
         JOIN pg_roles r ON r.oid = priv.grantee
         WHERE r.rolname = 'authenticated'
        ), 'NONE'
    ) AS authenticated_direct_column_grants,
    -- Effective column privileges (table-level or column-level)
    CASE 
        WHEN c.oid IS NULL OR a.attnum IS NULL THEN 'N/A'
        WHEN anon_r.oid IS NULL THEN 'SKIPPED (anon role missing)'
        ELSE COALESCE(
            (SELECT string_agg(priv.p_type, ', ')
             FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) priv(p_type)
             WHERE has_column_privilege(anon_r.oid, c.oid, a.attname, priv.p_type)
            ), 'NONE'
        )
    END AS anon_effective_column_privileges,
    CASE 
        WHEN c.oid IS NULL OR a.attnum IS NULL THEN 'N/A'
        WHEN auth_r.oid IS NULL THEN 'SKIPPED (authenticated role missing)'
        ELSE COALESCE(
            (SELECT string_agg(priv.p_type, ', ')
             FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) priv(p_type)
             WHERE has_column_privilege(auth_r.oid, c.oid, a.attname, priv.p_type)
            ), 'NONE'
        )
    END AS authenticated_effective_column_privileges,
    CASE 
        WHEN c.oid IS NULL OR a.attnum IS NULL THEN 'N/A'
        WHEN srv_r.oid IS NULL THEN 'SKIPPED (service_role missing)'
        ELSE COALESCE(
            (SELECT string_agg(priv.p_type, ', ')
             FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) priv(p_type)
             WHERE has_column_privilege(srv_r.oid, c.oid, a.attname, priv.p_type)
            ), 'NONE'
        )
    END AS service_role_effective_column_privileges,
    -- Client role RLS bypass status verification (direct and membership)
    CASE 
        WHEN anon_r.oid IS NULL THEN false
        WHEN anon_r.rolsuper OR anon_r.rolbypassrls THEN true
        WHEN EXISTS (
            SELECT 1 FROM pg_roles bp
            WHERE (bp.rolsuper OR bp.rolbypassrls)
              AND bp.oid <> anon_r.oid
              AND pg_has_role(anon_r.oid, bp.oid, 'MEMBER')
        ) THEN true
        ELSE false
    END AS anon_bypasses_rls,
    CASE 
        WHEN auth_r.oid IS NULL THEN false
        WHEN auth_r.rolsuper OR auth_r.rolbypassrls THEN true
        WHEN EXISTS (
            SELECT 1 FROM pg_roles bp
            WHERE (bp.rolsuper OR bp.rolbypassrls)
              AND bp.oid <> auth_r.oid
              AND pg_has_role(auth_r.oid, bp.oid, 'MEMBER')
        ) THEN true
        ELSE false
    END AS authenticated_bypasses_rls,
    -- Column Security Verdict
    CASE 
        WHEN c.oid IS NULL THEN 'SKIPPED (Table does not exist)'
        WHEN a.attnum IS NULL THEN 'SKIPPED (Column does not exist)'
        -- Fail-safe: Required roles must exist in pg_roles for valid verdict
        WHEN anon_r.oid IS NULL OR auth_r.oid IS NULL
            THEN 'NEEDS REVIEW (Column evaluation skipped: anon or authenticated missing from pg_roles)'
        -- Direct column grant checks
        WHEN EXISTS (
            SELECT 1 FROM aclexplode(a.attacl) priv
            WHERE priv.grantee = 0 AND priv.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
        ) THEN 'FAIL (Direct column privilege grant to PUBLIC pseudo-role detected in attacl)'
        WHEN EXISTS (
            SELECT 1 FROM aclexplode(a.attacl) priv
            WHERE priv.grantee = anon_r.oid AND priv.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
        ) THEN 'FAIL (Direct column privilege grant to anon role detected in attacl)'
        WHEN EXISTS (
            SELECT 1 FROM aclexplode(a.attacl) priv
            WHERE priv.grantee = auth_r.oid AND priv.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
        ) THEN 'FAIL (Direct column privilege grant to authenticated role detected in attacl)'
        -- Effective anon access check
        WHEN has_column_privilege(anon_r.oid, c.oid, a.attname, 'SELECT')
          OR has_column_privilege(anon_r.oid, c.oid, a.attname, 'INSERT')
          OR has_column_privilege(anon_r.oid, c.oid, a.attname, 'UPDATE')
          OR has_column_privilege(anon_r.oid, c.oid, a.attname, 'REFERENCES')
            THEN 'FAIL (Column accessible to untrusted anon role via effective SQL privileges)'
        -- Quarantine isolation check across all quarantine tables and columns
        WHEN tgt.target_table IN ('legacy_token_quarantine', 'legacy_subscription_quarantine', 'legacy_delivery_quarantine')
            THEN CASE 
                WHEN has_column_privilege(auth_r.oid, c.oid, a.attname, 'SELECT')
                  OR has_column_privilege(auth_r.oid, c.oid, a.attname, 'INSERT')
                  OR has_column_privilege(auth_r.oid, c.oid, a.attname, 'UPDATE')
                  OR has_column_privilege(auth_r.oid, c.oid, a.attname, 'REFERENCES')
                    THEN 'FAIL (Quarantine column accessible to authenticated role via effective SQL privileges)'
                ELSE 'PASS (Quarantine column isolated from client roles: zero direct grants, zero effective anon/authenticated/PUBLIC privileges across SELECT, INSERT, UPDATE, REFERENCES; RLS disabled as intended by migration)'
            END
        -- Notification tokens table-level RLS & role bypass verification
        WHEN tgt.target_table = 'notification_tokens' AND NOT c.relrowsecurity
            THEN 'FAIL (notification_tokens table lacks RLS enforcement)'
        WHEN tgt.target_table = 'notification_tokens' AND (
            anon_r.rolsuper OR anon_r.rolbypassrls OR EXISTS (
                SELECT 1 FROM pg_roles bp
                WHERE (bp.rolsuper OR bp.rolbypassrls) AND bp.oid <> anon_r.oid AND pg_has_role(anon_r.oid, bp.oid, 'MEMBER')
            )
        ) THEN 'FAIL (anon role possesses or can assume superuser or BYPASSRLS attribute; table RLS bypassed)'
        WHEN tgt.target_table = 'notification_tokens' AND (
            auth_r.rolsuper OR auth_r.rolbypassrls OR EXISTS (
                SELECT 1 FROM pg_roles bp
                WHERE (bp.rolsuper OR bp.rolbypassrls) AND bp.oid <> auth_r.oid AND pg_has_role(auth_r.oid, bp.oid, 'MEMBER')
            )
        ) THEN 'FAIL (authenticated role possesses or can assume superuser or BYPASSRLS attribute; table RLS bypassed)'
        WHEN tgt.target_table = 'notification_tokens' AND (
            has_column_privilege(auth_r.oid, c.oid, a.attname, 'SELECT')
            OR has_column_privilege(auth_r.oid, c.oid, a.attname, 'INSERT')
            OR has_column_privilege(auth_r.oid, c.oid, a.attname, 'UPDATE')
            OR has_column_privilege(auth_r.oid, c.oid, a.attname, 'REFERENCES')
        ) THEN 'FAIL (Sensitive token column accessible to authenticated role via effective SQL privileges - registration must be service_role only)'
        WHEN tgt.target_table = 'notification_tokens' AND c.relrowsecurity
            THEN 'PASS (Column metadata secure: zero client privileges for anon and authenticated across SELECT, INSERT, UPDATE, REFERENCES; backend-only service_role access enforced)'
        ELSE 'NEEDS REVIEW (Inspect column ACL and table RLS configuration)'
    END AS column_security_verdict
FROM (VALUES 
    -- Sensitive credential & hash columns
    ('notification_tokens', 'token'),
    ('notification_tokens', 'token_hash'),
    -- legacy_token_quarantine (all 6 columns)
    ('legacy_token_quarantine', 'quarantine_id'),
    ('legacy_token_quarantine', 'token_id'),
    ('legacy_token_quarantine', 'user_id'),
    ('legacy_token_quarantine', 'raw_token'),
    ('legacy_token_quarantine', 'reason'),
    ('legacy_token_quarantine', 'quarantined_at'),
    -- legacy_subscription_quarantine (all 7 columns)
    ('legacy_subscription_quarantine', 'quarantine_id'),
    ('legacy_subscription_quarantine', 'table_source'),
    ('legacy_subscription_quarantine', 'record_id'),
    ('legacy_subscription_quarantine', 'user_id'),
    ('legacy_subscription_quarantine', 'target_id'),
    ('legacy_subscription_quarantine', 'reason'),
    ('legacy_subscription_quarantine', 'quarantined_at'),
    -- legacy_delivery_quarantine (all 7 columns)
    ('legacy_delivery_quarantine', 'quarantine_id'),
    ('legacy_delivery_quarantine', 'delivery_id'),
    ('legacy_delivery_quarantine', 'campaign_id'),
    ('legacy_delivery_quarantine', 'recipient_id'),
    ('legacy_delivery_quarantine', 'token_id'),
    ('legacy_delivery_quarantine', 'reason'),
    ('legacy_delivery_quarantine', 'quarantined_at')
) AS tgt(target_table, target_column)
JOIN pg_namespace n ON n.nspname = 'public'
LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = tgt.target_table AND c.relkind = 'r'
LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = tgt.target_column AND NOT a.attisdropped
LEFT JOIN pg_roles anon_r ON anon_r.rolname = 'anon'
LEFT JOIN pg_roles auth_r ON auth_r.rolname = 'authenticated'
LEFT JOIN pg_roles srv_r ON srv_r.rolname = 'service_role'
ORDER BY tgt.target_table, tgt.target_column;

-- ----------------------------------------------------------------------------
-- Q4: Complete Function Ownership, search_path, and EXECUTE Privilege Inventory
-- Inspects all 21 notification functions (worker RPCs, triggers, and client RPCs).
-- Evaluates direct PUBLIC grants, default ACL state, and effective role privileges.
-- Starts from a static inventory of all 21 expected notification functions to detect
-- missing functions and unexpected overloads.
-- Enforces that all 21 notification functions MUST be SECURITY DEFINER (p.prosecdef = true).
-- Validates search_path with a conservative parser:
--   - Rejects missing search_path, $user, empty values, and empty elements (FAIL).
--   - Flags multiple search_path settings or quoted/special syntax (NEEDS REVIEW).
--   - Allows pg_temp ONLY in the final position of search_path; flags unsafe placement
--     and temporary schema variants (NEEDS REVIEW).
--   - Audits schema CREATE privileges across ALL roles in pg_roles (direct & inherited),
--     flagging any schema writable by non-admin roles (anon, authenticated, service_role,
--     authenticator, and custom roles) or PUBLIC.
--
-- SECURITY RATIONALE FOR EXCLUDED PRIVILEGED ROLES:
-- 'postgres' and 'supabase_admin' are the managed hosting provider's superusers and system-level
-- catalog administrators. They are responsible for database migrations, extensions, and catalog
-- maintenance. In a managed PostgreSQL/Supabase environment, they inherently possess schema
-- ownership and DDL rights.
-- All other roles—including anon, authenticated, service_role, authenticator, and any custom or
-- third-party roles created in the cluster—MUST NOT possess CREATE privilege on any schema in the
-- search_path of a SECURITY DEFINER function. If any non-admin role possesses CREATE privilege
-- (either directly or via role inheritance), an attacker or compromised backend component could
-- create shadowing objects (e.g., trojan tables, types, or functions) executed by the SECURITY
-- DEFINER function under its elevated privileges.
-- ----------------------------------------------------------------------------
SELECT 
    exp.expected_proname AS function_name,
    exp.expected_category AS function_category,
    CASE 
        WHEN p.oid IS NOT NULL THEN 'EXISTS' 
        ELSE 'MISSING' 
    END AS function_status,
    count(p.oid) OVER (PARTITION BY exp.expected_proname) AS overload_count,
    exp.expected_arguments,
    COALESCE(pg_get_function_identity_arguments(p.oid), 'N/A') AS actual_identity_arguments,
    CASE 
        WHEN p.oid IS NULL THEN 'N/A (Missing)'
        WHEN pg_get_function_identity_arguments(p.oid) = exp.expected_arguments THEN 'EXACT_MATCH'
        ELSE 'MISMATCH'
    END AS identity_arguments_match,
    exp.expected_result_type,
    COALESCE(pg_get_function_result(p.oid), 'N/A') AS actual_result_type,
    CASE 
        WHEN p.oid IS NULL THEN 'N/A (Missing)'
        WHEN pg_get_function_result(p.oid) = exp.expected_result_type THEN 'EXACT_MATCH'
        ELSE 'MISMATCH'
    END AS result_type_match,
    COALESCE(r.rolname, 'N/A') AS function_owner,
    CASE 
        WHEN p.oid IS NULL THEN 'N/A (Function missing)'
        WHEN r.rolname = 'postgres' THEN 'PASS (Managed superuser/owner postgres)'
        WHEN r.rolname = 'supabase_admin' THEN 'PASS (Managed catalog administrator supabase_admin)'
        WHEN r.rolname IS NOT NULL THEN 'NEEDS REVIEW (Function owned by non-standard role: ' || r.rolname || ' - verify migration ownership)'
        ELSE 'NEEDS REVIEW (Function owner cannot be resolved)'
    END AS owner_verdict,
    p.prosecdef AS is_security_definer,
    array_to_string(p.proconfig, ', ') AS proconfig_settings,
    CASE 
        WHEN p.oid IS NULL THEN 'N/A (Function missing)'
        WHEN sp.sp_count = 0 THEN 'MISSING'
        WHEN sp.sp_count > 1 THEN sp.sp_all_settings
        ELSE sp.sp_raw_setting
    END AS search_path_setting,
    CASE 
        WHEN p.oid IS NULL THEN 'N/A (Function missing)'
        WHEN sp.sp_count = 0 THEN 'None (search_path not configured)'
        WHEN sp.sp_count > 1 THEN 'Multiple search_path settings configured in proconfig'
        WHEN sp.sp_has_special THEN 'search_path contains quoted identifiers or special syntax requiring manual review'
        WHEN sp.sp_has_empty_or_malformed THEN 'search_path contains empty element or malformed comma delimiter'
        WHEN sp.sp_has_user THEN 'search_path contains $user'
        ELSE COALESCE(sp.sp_untrusted_list, 'None (All schemas verified)')
    END AS search_path_untrusted_schemas,
    CASE 
        WHEN p.oid IS NULL THEN 'N/A (Function missing)'
        WHEN sp.sp_count = 0 THEN 'HIGH RISK: Missing explicit search_path'
        WHEN sp.sp_count > 1 THEN 'NEEDS REVIEW: Multiple search_path settings configured in proconfig'
        WHEN sp.sp_has_special THEN 'NEEDS REVIEW: search_path contains quoted identifiers or special syntax requiring manual review'
        WHEN sp.sp_has_empty_or_malformed THEN 'HIGH RISK: search_path contains empty element or malformed delimiter'
        WHEN sp.sp_has_user THEN 'HIGH RISK: search_path contains $user'
        WHEN sp.sp_untrusted_count > 0 THEN 'POTENTIAL RISK: search_path contains writable, non-final temp, or unverified schemas'
        ELSE 'VERIFIED SCHEMA TRUST: Hardened search_path on admin schemas with zero non-admin CREATE grants (pg_temp final or absent)'
    END AS search_path_risk_assessment,
    CASE 
        WHEN p.oid IS NULL THEN 'N/A (Function missing)'
        WHEN p.proacl IS NULL THEN 'DEFAULT_ACL (Implicit: EXECUTE to PUBLIC by default)'
        ELSE 'EXPLICIT_ACL'
    END AS acl_configuration_mode,
    CASE WHEN p.oid IS NOT NULL THEN (p.proacl IS NULL) ELSE false END AS has_default_acl,
    CASE WHEN p.oid IS NOT NULL THEN COALESCE(
        (SELECT bool_or(a.privilege_type = 'EXECUTE')
         FROM aclexplode(p.proacl) a
         WHERE a.grantee = 0),
        false
    ) ELSE false END AS public_has_direct_grant,
    CASE WHEN p.oid IS NOT NULL THEN COALESCE(
        (SELECT bool_or(a.privilege_type = 'EXECUTE')
         FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
         WHERE a.grantee = 0),
        false
    ) ELSE false END AS public_has_effective_grant,
    CASE 
        WHEN p.oid IS NULL THEN 'N/A'
        WHEN anon_r.oid IS NULL THEN 'SKIPPED (anon role missing)'
        WHEN has_function_privilege(anon_r.oid, p.oid, 'EXECUTE') THEN 'TRUE (EXECUTE permitted)'
        ELSE 'FALSE'
    END AS anon_can_execute,
    CASE 
        WHEN p.oid IS NULL THEN 'N/A'
        WHEN auth_r.oid IS NULL THEN 'SKIPPED (authenticated role missing)'
        WHEN has_function_privilege(auth_r.oid, p.oid, 'EXECUTE') THEN 'TRUE (EXECUTE permitted)'
        ELSE 'FALSE'
    END AS authenticated_can_execute,
    CASE 
        WHEN p.oid IS NULL THEN 'N/A'
        WHEN srv_r.oid IS NULL THEN 'SKIPPED (service_role missing)'
        WHEN has_function_privilege(srv_r.oid, p.oid, 'EXECUTE') THEN 'TRUE (EXECUTE permitted)'
        ELSE 'FALSE'
    END AS service_role_can_execute,
    (
        SELECT string_agg(
            CASE 
                WHEN a.grantee = 0 THEN 'PUBLIC'
                ELSE COALESCE(gr.rolname, a.grantee::text)
            END,
            ', ' ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE gr.rolname END
        )
        FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
        LEFT JOIN pg_roles gr ON gr.oid = a.grantee
        WHERE a.privilege_type = 'EXECUTE'
    ) AS direct_execute_grantees,
    (
        SELECT string_agg(gr.rolname, ', ' ORDER BY gr.rolname)
        FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
        JOIN pg_roles gr ON gr.oid = a.grantee
        WHERE a.privilege_type = 'EXECUTE'
          AND a.grantee <> 0
          AND (
              (exp.expected_category = 'worker_rpc' AND gr.rolname NOT IN ('postgres', 'service_role', 'supabase_admin'))
              OR
              (exp.expected_category = 'client_rpc' AND gr.rolname NOT IN ('postgres', 'service_role', 'supabase_admin', 'authenticated'))
              OR
              (exp.expected_category = 'trigger_fn' AND gr.rolname NOT IN ('postgres', 'service_role', 'supabase_admin'))
          )
    ) AS other_role_grantees,
    (
        SELECT string_agg(v.violating_role, ', ' ORDER BY v.violating_role)
        FROM (
            -- Branch 1: Global illegal authenticator membership in admin roles (independent of function ACL)
            SELECT ar.rolname AS violating_role
            FROM (VALUES ('postgres'), ('supabase_admin')) AS admin_candidates(cand_name)
            JOIN pg_roles ar ON ar.rolname = admin_candidates.cand_name
            JOIN pg_roles auth_r ON auth_r.rolname = 'authenticator'
            WHERE pg_has_role(auth_r.oid, ar.oid, 'MEMBER')

            UNION

            -- Branch 2: Direct EXECUTE granted to authenticator on this function
            SELECT gr.rolname AS violating_role
            FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
            JOIN pg_roles gr ON gr.oid = a.grantee
            WHERE a.privilege_type = 'EXECUTE'
              AND a.grantee <> 0
              AND gr.rolname = 'authenticator'

            UNION

            -- Branch 3: Authenticator can reach a direct grantee not approved for this category
            SELECT gr.rolname AS violating_role
            FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
            JOIN pg_roles gr ON gr.oid = a.grantee
            JOIN pg_roles auth_r ON auth_r.rolname = 'authenticator'
            WHERE a.privilege_type = 'EXECUTE'
              AND a.grantee <> 0
              AND pg_has_role(auth_r.oid, gr.oid, 'MEMBER')
              AND (
                  (exp.expected_category = 'worker_rpc' AND gr.rolname <> 'service_role')
                  OR
                  (exp.expected_category = 'client_rpc' AND gr.rolname NOT IN ('authenticated', 'service_role'))
                  OR
                  (exp.expected_category = 'trigger_fn' AND gr.rolname <> 'service_role')
              )
        ) v
    ) AS authenticator_unapproved_reachable_grantees,
    (
        SELECT string_agg(
            DISTINCT gr.rolname || ' -> ' || reachable.rolname || ' (' || 
            CASE 
                WHEN pg_has_role(reachable.oid, gr.oid, 'USAGE') THEN 'INHERITED_PRIVILEGES'
                WHEN pg_has_role(reachable.oid, gr.oid, 'MEMBER') AND NOT pg_has_role(reachable.oid, gr.oid, 'USAGE') THEN 'SET_ROLE_ONLY'
                ELSE 'NEEDS_REVIEW'
            END || ')', 
            ', ' ORDER BY gr.rolname || ' -> ' || reachable.rolname || ' (' || 
            CASE 
                WHEN pg_has_role(reachable.oid, gr.oid, 'USAGE') THEN 'INHERITED_PRIVILEGES'
                WHEN pg_has_role(reachable.oid, gr.oid, 'MEMBER') AND NOT pg_has_role(reachable.oid, gr.oid, 'USAGE') THEN 'SET_ROLE_ONLY'
                ELSE 'NEEDS_REVIEW'
            END || ')'
        )
        FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
        JOIN pg_roles gr ON gr.oid = a.grantee
        CROSS JOIN pg_roles reachable
        WHERE a.privilege_type = 'EXECUTE'
          AND a.grantee <> 0
          -- Check reachability into grantee:
          AND (
              -- Case 1: Custom/other role can reach a grantee that is not admin/service
              (gr.rolname NOT IN ('postgres', 'service_role', 'supabase_admin') AND reachable.rolname NOT IN ('postgres', 'service_role', 'supabase_admin', gr.rolname))
              OR
              -- Case 2: Unapproved custom role or client role (anon, authenticated) can reach service_role
              (gr.rolname = 'service_role' AND reachable.rolname NOT IN ('postgres', 'supabase_admin', 'authenticator', 'service_role'))
              OR
              -- Case 3: Any non-admin role (including anon, authenticated, authenticator) can reach postgres or supabase_admin
              (gr.rolname IN ('postgres', 'supabase_admin') AND reachable.rolname NOT IN ('postgres', 'supabase_admin'))
          )
          AND pg_has_role(reachable.oid, gr.oid, 'MEMBER')
    ) AS custom_role_unapproved_reachable_grantees,
    CASE 
        -- 1. Existence check: Expected notification function must exist in schema public
        WHEN p.oid IS NULL
            THEN 'FAIL (Expected notification function does not exist in schema public)'

        -- 2a. Overload check: Unexpected overloaded signatures detected
        WHEN count(p.oid) OVER (PARTITION BY exp.expected_proname) > 1
            THEN 'NEEDS REVIEW (Unexpected overloaded function signature: ' || count(p.oid) OVER (PARTITION BY exp.expected_proname) || ' variants detected in public - verify signature)'

        -- 2b. Exact signature check: Identity arguments and return type must match expected migration definition
        WHEN pg_get_function_identity_arguments(p.oid) IS DISTINCT FROM exp.expected_arguments
             OR pg_get_function_result(p.oid) IS DISTINCT FROM exp.expected_result_type
            THEN 'FAIL (Function signature or return type mismatch: expected (' || exp.expected_arguments || ') RETURNS ' || exp.expected_result_type || ', found (' || COALESCE(pg_get_function_identity_arguments(p.oid), 'N/A') || ') RETURNS ' || COALESCE(pg_get_function_result(p.oid), 'N/A') || ')'

        -- 3. Security Mode Validation: All 21 notification functions must be SECURITY DEFINER
        WHEN NOT p.prosecdef
            THEN 'FAIL (Function is not SECURITY DEFINER - execution runs with caller privileges)'

        -- 3b. Function Owner Validation: Must be owned by approved admin role (postgres or supabase_admin)
        WHEN r.rolname NOT IN ('postgres', 'supabase_admin')
            THEN 'NEEDS REVIEW (Function owner is ' || COALESCE(r.rolname, 'UNKNOWN') || '; expected approved admin role postgres or supabase_admin)'

        -- 4. Missing explicit search_path configuration
        WHEN sp.sp_count = 0
            THEN 'FAIL (Function lacks explicit search_path configuration)'

        -- 5. Duplicate search_path configurations
        WHEN sp.sp_count > 1
            THEN 'NEEDS REVIEW (Multiple search_path settings configured in proconfig - potential override)'

        -- 6. Known unsafe search_path tokens ($user, empty value, empty elements, malformed commas)
        WHEN sp.sp_has_empty_or_malformed OR sp.sp_has_user
            THEN 'FAIL (Unsafe search_path configuration: includes $user, empty value, or malformed comma delimiter)'

        -- 7. Quoted identifiers, comments, or special syntax requiring manual review
        WHEN sp.sp_has_special
            THEN 'NEEDS REVIEW (search_path contains quoted identifiers, comments, or special syntax - verify parser isolation)'

        -- 8. Default ACL grants EXECUTE to PUBLIC by default
        WHEN p.proacl IS NULL
            THEN 'FAIL (Function possesses default ACL - EXECUTE granted to PUBLIC by default)'

        -- 9. Direct or default EXECUTE granted to PUBLIC pseudo-role
        WHEN COALESCE(
            (SELECT bool_or(a.privilege_type = 'EXECUTE')
             FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
             WHERE a.grantee = 0),
            false
        ) THEN 'FAIL (Direct or default EXECUTE privilege granted to PUBLIC pseudo-role)'

        -- 10. Effective execution by untrusted anon role
        WHEN anon_r.oid IS NOT NULL AND has_function_privilege(anon_r.oid, p.oid, 'EXECUTE')
            THEN 'FAIL (Effective EXECUTE privilege possessed by untrusted anon role)'

        -- 11a. Unexpected / unverified category-specific direct EXECUTE grants
        WHEN EXISTS (
            SELECT 1 
            FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
            JOIN pg_roles gr ON gr.oid = a.grantee
            WHERE a.privilege_type = 'EXECUTE'
              AND a.grantee <> 0
              AND (
                  (exp.expected_category = 'worker_rpc' AND gr.rolname NOT IN ('postgres', 'service_role', 'supabase_admin'))
                  OR
                  (exp.expected_category = 'client_rpc' AND gr.rolname NOT IN ('postgres', 'service_role', 'supabase_admin', 'authenticated'))
                  OR
                  (exp.expected_category = 'trigger_fn' AND gr.rolname NOT IN ('postgres', 'service_role', 'supabase_admin'))
              )
        ) THEN 'NEEDS REVIEW (Unverified category-specific EXECUTE access granted to other roles - inspect other_role_grantees)'

        -- 11b. Authenticator holds direct EXECUTE, is member of admin roles, or can assume/inherit unapproved grantees
        WHEN (
            -- Global admin-role membership check (independent of function ACL)
            EXISTS (
                SELECT 1
                FROM (VALUES ('postgres'), ('supabase_admin')) AS admin_candidates(cand_name)
                JOIN pg_roles ar ON ar.rolname = admin_candidates.cand_name
                JOIN pg_roles auth_r ON auth_r.rolname = 'authenticator'
                WHERE pg_has_role(auth_r.oid, ar.oid, 'MEMBER')
            )
            OR
            -- Function-specific ACL authenticator escape check
            EXISTS (
                SELECT 1
                FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                JOIN pg_roles gr ON gr.oid = a.grantee
                WHERE a.privilege_type = 'EXECUTE'
              AND a.grantee <> 0
              AND (
                  gr.rolname = 'authenticator'
                  OR (
                      EXISTS (SELECT 1 FROM pg_roles auth_r WHERE auth_r.rolname = 'authenticator' AND pg_has_role(auth_r.oid, gr.oid, 'MEMBER'))
                      AND (
                          (exp.expected_category = 'worker_rpc' AND gr.rolname <> 'service_role')
                          OR
                          (exp.expected_category = 'client_rpc' AND gr.rolname NOT IN ('authenticated', 'service_role'))
                          OR
                          (exp.expected_category = 'trigger_fn' AND gr.rolname <> 'service_role')
                      )
                  )
              )
            )
        ) THEN 'NEEDS REVIEW (Authenticator possesses direct grant, reaches admin role, or reaches unapproved grantee - inspect authenticator_unapproved_reachable_grantees)'

        -- 11c. Custom / unrecognized role membership reachability check
        -- Closes privileged-role membership gaps: checks if unapproved custom or client roles can reach
        -- privileged grantees (service_role, postgres, supabase_admin) via inheritance or SET ROLE.
        WHEN EXISTS (
            SELECT 1
            FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
            JOIN pg_roles gr ON gr.oid = a.grantee
            CROSS JOIN pg_roles reachable
            WHERE a.privilege_type = 'EXECUTE'
              AND a.grantee <> 0
              AND (
                  -- Case 1: Custom/other role can reach a grantee that is not admin/service
                  (gr.rolname NOT IN ('postgres', 'service_role', 'supabase_admin') AND reachable.rolname NOT IN ('postgres', 'service_role', 'supabase_admin', gr.rolname))
                  OR
                  -- Case 2: Unapproved custom role or client role (anon, authenticated) can reach service_role
                  (gr.rolname = 'service_role' AND reachable.rolname NOT IN ('postgres', 'supabase_admin', 'authenticator', 'service_role'))
                  OR
                  -- Case 3: Any non-admin role (including anon, authenticated, authenticator) can reach postgres or supabase_admin
                  (gr.rolname IN ('postgres', 'supabase_admin') AND reachable.rolname NOT IN ('postgres', 'supabase_admin'))
              )
              AND pg_has_role(reachable.oid, gr.oid, 'MEMBER')
        ) THEN 'NEEDS REVIEW (Unapproved custom or client role can inherit or reach EXECUTE privilege on grantee - inspect custom_role_unapproved_reachable_grantees)'

        -- 12. Client-callable RPCs: authorized for authenticated and service_role
        WHEN exp.expected_category = 'client_rpc'
            THEN CASE 
                WHEN auth_r.oid IS NULL OR srv_r.oid IS NULL
                    THEN 'NEEDS REVIEW (Client RPC evaluation skipped: authenticated or service_role missing from pg_roles)'
                WHEN NOT (has_function_privilege(auth_r.oid, p.oid, 'EXECUTE') AND has_function_privilege(srv_r.oid, p.oid, 'EXECUTE'))
                    THEN 'NEEDS REVIEW (Client RPC missing intended authenticated or service_role privilege)'
                WHEN sp.sp_untrusted_count > 0
                    THEN 'NEEDS REVIEW (Client RPC roles verified; search_path contains writable, non-final temp, or unverified schemas - inspect search_path_untrusted_schemas)'
                ELSE 'PASS (Hardened search_path on verified admin-owned schemas with zero non-admin CREATE grants)'
            END

        -- 13. Internal worker RPCs and triggers: strictly restricted from authenticated role
        WHEN auth_r.oid IS NOT NULL AND has_function_privilege(auth_r.oid, p.oid, 'EXECUTE')
            THEN 'FAIL (Internal worker/trigger function exposed to authenticated role)'

        -- 14. Internal worker RPCs and trigger functions: verify service_role EXECUTE privilege
        -- NOTE ON TRIGGER FUNCTIONS: The consolidated migration explicitly grants EXECUTE on all 5
        -- trigger functions to service_role (lines 1918-1922). This allows maintenance and backend
        -- worker operations while remaining strictly restricted from anon and authenticated roles.
        WHEN srv_r.oid IS NULL
            THEN 'NEEDS REVIEW (service_role missing from pg_roles; cannot verify worker/trigger privilege)'
        WHEN exp.expected_category = 'worker_rpc' AND NOT has_function_privilege(srv_r.oid, p.oid, 'EXECUTE')
            THEN 'NEEDS REVIEW (Internal worker function missing service_role privilege)'
        WHEN exp.expected_category = 'trigger_fn' AND NOT has_function_privilege(srv_r.oid, p.oid, 'EXECUTE')
            THEN 'NEEDS REVIEW (Trigger function missing expected service_role grant from consolidated migration)'

        -- 15. Internal worker RPCs and triggers: verify search_path schemas
        WHEN sp.sp_untrusted_count > 0
            THEN 'NEEDS REVIEW (Internal isolation verified; search_path contains writable, non-final temp, or unverified schemas - inspect search_path_untrusted_schemas)'

        -- 16. Final PASS for internal worker RPCs and triggers
        ELSE 'PASS (Hardened search_path on verified admin-owned schemas with zero non-admin CREATE grants)'
    END AS security_verdict
FROM (VALUES 
    ('notifications_is_admin', 'client_rpc', '', 'boolean'),
    ('record_notification_telemetry', 'client_rpc', 'p_delivery_id uuid, p_recipient_id uuid, p_event_type text, p_nonce text, p_device_info jsonb', 'boolean'),
    ('claim_notification_queue_batch', 'worker_rpc', 'p_worker_id text, p_batch_size integer, p_lease_seconds integer', 'TABLE(job_id uuid, campaign_id uuid, payload jsonb, attempts integer)'),
    ('renew_notification_queue_lease', 'worker_rpc', 'p_job_id uuid, p_worker_id text, p_extension_seconds integer', 'boolean'),
    ('fail_or_retry_notification_job', 'worker_rpc', 'p_job_id uuid, p_worker_id text, p_error_code text, p_error_message text', 'text'),
    ('complete_notification_queue_job', 'worker_rpc', 'p_job_id uuid, p_worker_id text', 'boolean'),
    ('sweep_expired_notification_queue_jobs', 'worker_rpc', '', 'integer'),
    ('reserve_notification_deliveries', 'worker_rpc', 'p_worker_id text, p_batch_size integer, p_lease_seconds integer', 'TABLE(delivery_id uuid, campaign_id uuid, recipient_id uuid, token_id uuid, raw_token text, attempt_count integer, reservation_token uuid)'),
    ('authorize_notification_delivery_dispatch', 'worker_rpc', 'p_delivery_id uuid, p_token_id uuid, p_reservation_token uuid, p_worker_id text, p_recipient_id uuid', 'jsonb'),
    ('renew_notification_delivery_leases', 'worker_rpc', 'p_worker_id text, p_reservation_tokens uuid[], p_extension_seconds integer', 'integer'),
    ('confirm_notification_delivery_sent', 'worker_rpc', 'p_delivery_id uuid, p_dispatch_attempt_id uuid, p_fcm_message_id text', 'jsonb'),
    ('fail_or_retry_notification_delivery', 'worker_rpc', 'p_delivery_id uuid, p_worker_id text, p_reservation_token uuid, p_error_code text, p_error_message text, p_retry_after_seconds integer', 'text'),
    ('sweep_expired_delivery_reservations', 'worker_rpc', '', 'integer'),
    ('sweep_stale_notification_deliveries', 'worker_rpc', 'p_stale_hours integer', 'integer'),
    ('ingest_notification_campaign', 'worker_rpc', 'p_title text, p_body text, p_category text, p_url text, p_image_url text, p_target_criteria jsonb, p_scheduled_for timestamp with time zone, p_created_by uuid', 'jsonb'),
    ('cancel_notification_campaign', 'worker_rpc', 'p_campaign_id uuid', 'jsonb'),
    ('trg_validate_delivery_status_transition', 'trigger_fn', '', 'trigger'),
    ('trg_sync_notification_token_hash', 'trigger_fn', '', 'trigger'),
    ('trg_sync_notification_token_ownership', 'trigger_fn', '', 'trigger'),
    ('trg_protect_user_notifications_update', 'trigger_fn', '', 'trigger'),
    ('trg_sync_campaign_cancellation', 'trigger_fn', '', 'trigger')
) AS exp(expected_proname, expected_category, expected_arguments, expected_result_type)
JOIN pg_namespace n ON n.nspname = 'public'
LEFT JOIN pg_proc p ON p.pronamespace = n.oid AND p.proname = exp.expected_proname
LEFT JOIN pg_roles r ON r.oid = p.proowner
LEFT JOIN pg_roles anon_r ON anon_r.rolname = 'anon'
LEFT JOIN pg_roles auth_r ON auth_r.rolname = 'authenticated'
LEFT JOIN pg_roles srv_r ON srv_r.rolname = 'service_role'
LEFT JOIN LATERAL (
    SELECT 
        cfg_stats.sp_count,
        cfg_stats.sp_raw_setting,
        cfg_stats.sp_raw_value,
        cfg_stats.sp_all_settings,
        cfg_stats.sp_has_special,
        cfg_stats.sp_has_empty_or_malformed,
        cfg_stats.sp_has_user,
        COALESCE(untrusted_agg.untrusted_count, 0) AS sp_untrusted_count,
        untrusted_agg.untrusted_list AS sp_untrusted_list
    FROM (
        SELECT 
            count(cfg) AS sp_count,
            min(cfg) AS sp_raw_setting,
            min(regexp_replace(cfg, '^[[:space:]]*search_path[[:space:]]*=[[:space:]]*', '')) AS sp_raw_value,
            string_agg(cfg, '; ') AS sp_all_settings,
            COALESCE(bool_or(
                position('"' in regexp_replace(cfg, '^[[:space:]]*search_path[[:space:]]*=[[:space:]]*', '')) > 0
                OR position('''' in regexp_replace(cfg, '^[[:space:]]*search_path[[:space:]]*=[[:space:]]*', '')) > 0
                OR position(';' in regexp_replace(cfg, '^[[:space:]]*search_path[[:space:]]*=[[:space:]]*', '')) > 0
                OR position('(' in regexp_replace(cfg, '^[[:space:]]*search_path[[:space:]]*=[[:space:]]*', '')) > 0
                OR position(')' in regexp_replace(cfg, '^[[:space:]]*search_path[[:space:]]*=[[:space:]]*', '')) > 0
                OR position('/*' in regexp_replace(cfg, '^[[:space:]]*search_path[[:space:]]*=[[:space:]]*', '')) > 0
                OR position('--' in regexp_replace(cfg, '^[[:space:]]*search_path[[:space:]]*=[[:space:]]*', '')) > 0
                OR position(E'\\' in regexp_replace(cfg, '^[[:space:]]*search_path[[:space:]]*=[[:space:]]*', '')) > 0
                OR regexp_replace(cfg, '^[[:space:]]*search_path[[:space:]]*=[[:space:]]*', '') ~ '[[:cntrl:]]'
            ), false) AS sp_has_special,
            COALESCE(bool_or(
                regexp_replace(cfg, '^[[:space:]]*search_path[[:space:]]*=[[:space:]]*', '') ~ '^[[:space:]]*$'
                OR regexp_replace(cfg, '^[[:space:]]*search_path[[:space:]]*=[[:space:]]*', '') ~ '^[[:space:]]*,|[[:space:]]*,[[:space:]]*,|,[[:space:]]*$'
            ), false) AS sp_has_empty_or_malformed,
            COALESCE(bool_or(
                position('$user' in lower(regexp_replace(cfg, '^[[:space:]]*search_path[[:space:]]*=[[:space:]]*', ''))) > 0
            ), false) AS sp_has_user
        FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg
        WHERE cfg ~ '^[[:space:]]*search_path[[:space:]]*='
    ) cfg_stats
    LEFT JOIN LATERAL (
        SELECT 
            count(*) AS untrusted_count,
            string_agg(elem_desc, ', ') AS untrusted_list
        FROM (
            SELECT 
                sch.sch_name || ' (' || 
                CASE 
                    WHEN sch.sch_name = '$user' THEN 'resolves to caller session user ($user)'
                    WHEN sch.sch_name = '' THEN 'empty schema entry'
                    WHEN sch.sch_name = 'pg_temp' AND sch.elem_pos < sch.total_elems
                        THEN 'pg_temp in non-final position (' || sch.elem_pos || ' of ' || sch.total_elems || ') - shadowing risk'
                    WHEN sch.sch_name ~* '^(pg_temp|pg_toast_temp)' AND sch.sch_name <> 'pg_temp'
                        THEN 'temporary schema variant: ' || sch.sch_name
                    WHEN sn.oid IS NULL THEN 'schema not found in catalog'
                    WHEN s_owner.rolname NOT IN ('postgres', 'supabase_admin') AND NOT COALESCE(s_owner.rolsuper, false)
                        THEN 'non-admin owner: ' || COALESCE(s_owner.rolname, 'unknown')
                    WHEN EXISTS (
                        SELECT 1 FROM pg_roles r2
                        WHERE r2.rolname NOT IN ('postgres', 'supabase_admin')
                          AND NOT r2.rolsuper
                          AND has_schema_privilege(r2.oid, sn.oid, 'CREATE')
                    ) THEN 'writable by non-admin roles: ' || (
                        SELECT string_agg(DISTINCT r2.rolname, ', ' ORDER BY r2.rolname)
                        FROM pg_roles r2
                        WHERE r2.rolname NOT IN ('postgres', 'supabase_admin')
                          AND NOT r2.rolsuper
                          AND has_schema_privilege(r2.oid, sn.oid, 'CREATE')
                    )
                    WHEN COALESCE((
                        SELECT bool_or(a.privilege_type = 'CREATE')
                        FROM aclexplode(COALESCE(sn.nspacl, acldefault('n', sn.nspowner))) a
                        WHERE a.grantee = 0
                    ), false) THEN 'writable by PUBLIC'
                    ELSE 'unverified schema trust'
                END || ')' AS elem_desc
            FROM (
                SELECT 
                    trim(both ' ' FROM t.elem) AS sch_name,
                    t.elem_pos,
                    cardinality(string_to_array(cfg_stats.sp_raw_value, ',')) AS total_elems
                FROM unnest(
                    string_to_array(cfg_stats.sp_raw_value, ',')
                ) WITH ORDINALITY AS t(elem, elem_pos)
            ) sch
            LEFT JOIN pg_namespace sn ON sn.nspname = sch.sch_name
            LEFT JOIN pg_roles s_owner ON s_owner.oid = sn.nspowner
            WHERE cfg_stats.sp_count = 1
              AND NOT cfg_stats.sp_has_special
              AND NOT cfg_stats.sp_has_empty_or_malformed
              AND NOT cfg_stats.sp_has_user
              AND (
                  sch.sch_name = '$user'
                  OR sch.sch_name = ''
                  OR (sch.sch_name = 'pg_temp' AND sch.elem_pos < sch.total_elems)
                  OR (sch.sch_name ~* '^(pg_temp|pg_toast_temp)' AND sch.sch_name <> 'pg_temp')
                  OR (
                      sch.sch_name <> 'pg_temp'
                      AND (
                          sn.oid IS NULL
                          OR (s_owner.rolname NOT IN ('postgres', 'supabase_admin') AND NOT COALESCE(s_owner.rolsuper, false))
                          OR EXISTS (
                              SELECT 1 FROM pg_roles r2
                              WHERE r2.rolname NOT IN ('postgres', 'supabase_admin')
                                AND NOT r2.rolsuper
                                AND has_schema_privilege(r2.oid, sn.oid, 'CREATE')
                          )
                          OR COALESCE((
                              SELECT bool_or(a.privilege_type = 'CREATE')
                              FROM aclexplode(COALESCE(sn.nspacl, acldefault('n', sn.nspowner))) a
                              WHERE a.grantee = 0
                          ), false)
                      )
                  )
              )
        ) untrusted_items
    ) untrusted_agg ON true
) sp ON true
ORDER BY exp.expected_proname;

-- ============================================================================
-- PART 2: CONDITIONAL DATA PREFLIGHT INSPECTIONS
-- (These dynamic PL/pgSQL blocks inspect data ONLY after verifying that
-- the target table and all required columns exist, completely preventing
-- 42P01 undefined_table and 42703 undefined_column exceptions)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Q5: Row Counts for Existing Notification Tables
-- Safely quotes identifiers with format('%I') and stores count in bigint.
-- Accurately documents PostgreSQL ACCESS SHARE lock acquisition.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_tbl_candidate text;
    v_row_count bigint := 0;
BEGIN
    RAISE NOTICE '============================================================';
    RAISE NOTICE '=== Q5: ROW COUNTS FOR NOTIFICATION CANDIDATE TABLES     ===';
    RAISE NOTICE '=== (Note: SELECT queries acquire ACCESS SHARE locks)    ===';
    RAISE NOTICE '============================================================';

    FOR v_tbl_candidate IN VALUES 
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
    LOOP
        IF to_regclass('public.' || v_tbl_candidate) IS NOT NULL THEN
            EXECUTE format('SELECT count(*) FROM public.%I', v_tbl_candidate) INTO v_row_count;
            RAISE NOTICE '[EXISTS]  Table % : % rows', rpad(v_tbl_candidate, 32), v_row_count;
        ELSE
            RAISE NOTICE '[SKIPPED] Table % : DOES NOT EXIST (Safe to create during migration)', rpad(v_tbl_candidate, 32);
        END IF;
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Q6: Duplicate Notification Token Hashes Audit
-- Verifies table, column, and pgcrypto digest() availability across schemas.
-- Resolves digest(text, text) or digest(bytea, text) dynamically with fully
-- compatible invocation expressions. Never outputs raw device tokens or hashes.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_has_table boolean := false;
    v_has_column boolean := false;
    v_has_digest boolean := false;
    v_digest_schema text := NULL;
    v_digest_sig text := NULL;
    v_token_arg_expr text := NULL;
    v_dup_clusters bigint := 0;
    v_max_cluster bigint := 0;
BEGIN
    RAISE NOTICE '============================================================';
    RAISE NOTICE '=== Q6: DUPLICATE NOTIFICATION TOKENS PREFLIGHT          ===';
    RAISE NOTICE '============================================================';

    v_has_table := (to_regclass('public.notification_tokens') IS NOT NULL);

    IF v_has_table THEN
        SELECT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
              AND table_name = 'notification_tokens' 
              AND column_name = 'token'
        ) INTO v_has_column;
    END IF;

    -- Dynamically locate executable digest function across any schema (public, extensions, etc.)
    -- Supports both digest(text, text) and digest(bytea, text) with strictly compatible argument generation
    SELECT n.nspname, pg_get_function_identity_arguments(p.oid)
    INTO v_digest_schema, v_digest_sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'digest'
      AND pg_get_function_identity_arguments(p.oid) IN ('text, text', 'bytea, text')
      AND has_function_privilege(p.oid, 'EXECUTE')
      AND has_schema_privilege(n.oid, 'USAGE')
    ORDER BY CASE 
        WHEN pg_get_function_identity_arguments(p.oid) = 'text, text' THEN 1 
        ELSE 2 
    END,
    CASE 
        WHEN n.nspname = 'public' THEN 1
        WHEN n.nspname = 'extensions' THEN 2
        ELSE 3 
    END, n.nspname
    LIMIT 1;

    v_has_digest := (v_digest_schema IS NOT NULL);

    IF NOT v_has_table THEN
        RAISE NOTICE '[SKIPPED] public.notification_tokens table does not exist. Token duplicate preflight skipped.';
    ELSIF NOT v_has_column THEN
        RAISE NOTICE '[SKIPPED] Column "token" does not exist on public.notification_tokens. Token duplicate preflight skipped.';
    ELSIF NOT v_has_digest THEN
        RAISE NOTICE '[SKIPPED] pgcrypto extension or executable digest(text, text) / digest(bytea, text) function is not available. Token hash duplicate check skipped.';
    ELSE
        -- Ensure selected function signature and generated invocation expression are 100% compatible
        IF v_digest_sig = 'text, text' THEN
            v_token_arg_expr := 'token::text';
        ELSE
            -- digest(bytea, text) explicitly converts text token to UTF8 bytea
            v_token_arg_expr := 'convert_to(token::text, ''UTF8'')';
        END IF;

        EXECUTE format(
            'SELECT count(*), COALESCE(max(sub.cluster_size), 0) ' ||
            'FROM ( ' ||
            '    SELECT encode(%I.digest(%s, ''sha256''), ''hex'') AS token_hash, count(*) AS cluster_size ' ||
            '    FROM public.notification_tokens ' ||
            '    WHERE token IS NOT NULL AND token <> '''' ' ||
            '    GROUP BY encode(%I.digest(%s, ''sha256''), ''hex'') ' ||
            '    HAVING count(*) > 1 ' ||
            ') sub',
            v_digest_schema, v_token_arg_expr,
            v_digest_schema, v_token_arg_expr
        ) INTO v_dup_clusters, v_max_cluster;

        IF v_dup_clusters = 0 THEN
            RAISE NOTICE '[PASS] Zero duplicate token hashes found. Deduplication will prune 0 rows.';
        ELSE
            RAISE NOTICE '[NEEDS REVIEW] % duplicate token hash cluster(s) detected (largest cluster: % duplicate tokens).', v_dup_clusters, v_max_cluster;
            RAISE NOTICE '                Deduplication will retain the newest token per hash and archive pruned tokens to legacy_token_quarantine.';
        END IF;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Q7: Orphan user_id Audit
-- Checks whether user_id values in candidate tables exist in auth.users.
-- Verifies auth.users and each table's user_id column before executing dynamic SQL.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_has_auth_users boolean := false;
    v_tbl text;
    v_has_table boolean := false;
    v_has_user_col boolean := false;
    v_orphan_count bigint := 0;
BEGIN
    RAISE NOTICE '============================================================';
    RAISE NOTICE '=== Q7: ORPHAN USER_ID PREFLIGHT AUDIT                   ===';
    RAISE NOTICE '============================================================';

    v_has_auth_users := (to_regclass('auth.users') IS NOT NULL);

    IF NOT v_has_auth_users THEN
        RAISE NOTICE '[SKIPPED] auth.users table does not exist. Orphan user_id verification skipped.';
        RETURN;
    END IF;

    FOR v_tbl IN VALUES 
        ('notification_tokens'), 
        ('movie_notify_requests'), 
        ('actor_notify_requests'), 
        ('genre_notify_requests')
    LOOP
        v_has_table := (to_regclass('public.' || v_tbl) IS NOT NULL);
        v_has_user_col := false;

        IF v_has_table THEN
            SELECT EXISTS (
                SELECT 1 
                FROM information_schema.columns 
                WHERE table_schema = 'public' 
                  AND table_name = v_tbl 
                  AND column_name = 'user_id'
            ) INTO v_has_user_col;
        END IF;

        IF NOT v_has_table THEN
            RAISE NOTICE '[SKIPPED] Table % : table does not exist.', rpad(v_tbl, 28);
        ELSIF NOT v_has_user_col THEN
            RAISE NOTICE '[SKIPPED] Table % : column "user_id" does not exist.', rpad(v_tbl, 28);
        ELSE
            EXECUTE format(
                'SELECT count(*) FROM public.%I t WHERE t.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.user_id)',
                v_tbl
            ) INTO v_orphan_count;

            IF v_orphan_count = 0 THEN
                RAISE NOTICE '[PASS]    Table % : 0 orphan user_id records.', rpad(v_tbl, 28);
            ELSE
                RAISE NOTICE '[NEEDS REVIEW] Table % : % orphan user_id records found.', rpad(v_tbl, 28), v_orphan_count;
                RAISE NOTICE '                 Foreign key retrofit will archive orphans to legacy quarantine and set user_id to NULL.';
            END IF;
        END IF;
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Q8: Corrupted Subscription Records Audit (NULL Entity IDs)
-- Checks for NULL actor_id or genre_id records before applying NOT NULL constraints.
-- Verifies table and target columns exist before querying.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_has_actor_tbl boolean := false;
    v_has_actor_col boolean := false;
    v_null_actors bigint := 0;

    v_has_genre_tbl boolean := false;
    v_has_genre_col boolean := false;
    v_null_genres bigint := 0;
BEGIN
    RAISE NOTICE '============================================================';
    RAISE NOTICE '=== Q8: CORRUPTED SUBSCRIPTION RECORDS AUDIT (NULL IDS)  ===';
    RAISE NOTICE '============================================================';

    -- Check actor_notify_requests
    v_has_actor_tbl := (to_regclass('public.actor_notify_requests') IS NOT NULL);
    IF v_has_actor_tbl THEN
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'actor_notify_requests' AND column_name = 'actor_id'
        ) INTO v_has_actor_col;
    END IF;

    IF NOT v_has_actor_tbl THEN
        RAISE NOTICE '[SKIPPED] actor_notify_requests table does not exist.';
    ELSIF NOT v_has_actor_col THEN
        RAISE NOTICE '[SKIPPED] Column "actor_id" does not exist on actor_notify_requests.';
    ELSE
        SELECT count(*) INTO v_null_actors FROM public.actor_notify_requests WHERE actor_id IS NULL;
        IF v_null_actors = 0 THEN
            RAISE NOTICE '[PASS]    actor_notify_requests has 0 NULL actor_id records.';
        ELSE
            RAISE NOTICE '[NEEDS REVIEW] actor_notify_requests has % NULL actor_id records (will be quarantined and pruned).', v_null_actors;
        END IF;
    END IF;

    -- Check genre_notify_requests
    v_has_genre_tbl := (to_regclass('public.genre_notify_requests') IS NOT NULL);
    IF v_has_genre_tbl THEN
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'genre_notify_requests' AND column_name = 'genre_id'
        ) INTO v_has_genre_col;
    END IF;

    IF NOT v_has_genre_tbl THEN
        RAISE NOTICE '[SKIPPED] genre_notify_requests table does not exist.';
    ELSIF NOT v_has_genre_col THEN
        RAISE NOTICE '[SKIPPED] Column "genre_id" does not exist on genre_notify_requests.';
    ELSE
        SELECT count(*) INTO v_null_genres FROM public.genre_notify_requests WHERE genre_id IS NULL;
        IF v_null_genres = 0 THEN
            RAISE NOTICE '[PASS]    genre_notify_requests has 0 NULL genre_id records.';
        ELSE
            RAISE NOTICE '[NEEDS REVIEW] genre_notify_requests has % NULL genre_id records (will be quarantined and pruned).', v_null_genres;
        END IF;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Q9: Duplicate Subscriptions Audit
-- Checks for duplicate user subscriptions before applying partial unique indexes.
-- Verifies table and all required grouping columns exist before querying.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_cols_found integer := 0;
    v_dups bigint := 0;
BEGIN
    RAISE NOTICE '============================================================';
    RAISE NOTICE '=== Q9: DUPLICATE SUBSCRIPTIONS PREFLIGHT AUDIT          ===';
    RAISE NOTICE '============================================================';

    -- 1. movie_notify_requests: requires movie_id, user_id
    IF to_regclass('public.movie_notify_requests') IS NOT NULL THEN
        SELECT count(*) INTO v_cols_found 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'movie_notify_requests' 
          AND column_name IN ('movie_id', 'user_id');

        IF v_cols_found = 2 THEN
            SELECT count(*) INTO v_dups FROM (
                SELECT movie_id, user_id 
                FROM public.movie_notify_requests 
                WHERE user_id IS NOT NULL 
                GROUP BY movie_id, user_id 
                HAVING count(*) > 1
            ) sub;

            IF v_dups = 0 THEN
                RAISE NOTICE '[PASS]    movie_notify_requests has 0 duplicate user-movie subscriptions.';
            ELSE
                RAISE NOTICE '[NEEDS REVIEW] movie_notify_requests has % duplicate user-movie subscription pairs.', v_dups;
                RAISE NOTICE '                 Note: Duplicate rows are pruned without quarantine (backup snapshot required).';
            END IF;
        ELSE
            RAISE NOTICE '[SKIPPED] movie_notify_requests required columns (movie_id, user_id) not fully present.';
        END IF;
    ELSE
        RAISE NOTICE '[SKIPPED] movie_notify_requests table does not exist.';
    END IF;

    -- 2. actor_notify_requests: requires actor_id, user_id
    IF to_regclass('public.actor_notify_requests') IS NOT NULL THEN
        SELECT count(*) INTO v_cols_found 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'actor_notify_requests' 
          AND column_name IN ('actor_id', 'user_id');

        IF v_cols_found = 2 THEN
            SELECT count(*) INTO v_dups FROM (
                SELECT actor_id, user_id 
                FROM public.actor_notify_requests 
                WHERE user_id IS NOT NULL 
                GROUP BY actor_id, user_id 
                HAVING count(*) > 1
            ) sub;

            IF v_dups = 0 THEN
                RAISE NOTICE '[PASS]    actor_notify_requests has 0 duplicate user-actor subscriptions.';
            ELSE
                RAISE NOTICE '[NEEDS REVIEW] actor_notify_requests has % duplicate user-actor subscription pairs.', v_dups;
                RAISE NOTICE '                 Note: Duplicate rows are pruned without quarantine (backup snapshot required).';
            END IF;
        ELSE
            RAISE NOTICE '[SKIPPED] actor_notify_requests required columns (actor_id, user_id) not fully present.';
        END IF;
    ELSE
        RAISE NOTICE '[SKIPPED] actor_notify_requests table does not exist.';
    END IF;

    -- 3. genre_notify_requests: requires genre_id, user_id
    IF to_regclass('public.genre_notify_requests') IS NOT NULL THEN
        SELECT count(*) INTO v_cols_found 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'genre_notify_requests' 
          AND column_name IN ('genre_id', 'user_id');

        IF v_cols_found = 2 THEN
            SELECT count(*) INTO v_dups FROM (
                SELECT genre_id, user_id 
                FROM public.genre_notify_requests 
                WHERE user_id IS NOT NULL 
                GROUP BY genre_id, user_id 
                HAVING count(*) > 1
            ) sub;

            IF v_dups = 0 THEN
                RAISE NOTICE '[PASS]    genre_notify_requests has 0 duplicate user-genre subscriptions.';
            ELSE
                RAISE NOTICE '[NEEDS REVIEW] genre_notify_requests has % duplicate user-genre subscription pairs.', v_dups;
                RAISE NOTICE '                 Note: Duplicate rows are pruned without quarantine (backup snapshot required).';
            END IF;
        ELSE
            RAISE NOTICE '[SKIPPED] genre_notify_requests required columns (genre_id, user_id) not fully present.';
        END IF;
    ELSE
        RAISE NOTICE '[SKIPPED] genre_notify_requests table does not exist.';
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Q10: Deliveries Status Audit
-- Checks delivery status distribution if notification_deliveries exists.
-- Reports in-flight states (pending, reserved, dispatching) separately.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_has_deliv_tbl boolean := false;
    v_has_status_col boolean := false;
    v_pending bigint := 0;
    v_reserved bigint := 0;
    v_dispatching bigint := 0;
    v_sent bigint := 0;
    v_delivered bigint := 0;
    v_failed bigint := 0;
    v_cancelled bigint := 0;
    v_total bigint := 0;
BEGIN
    RAISE NOTICE '============================================================';
    RAISE NOTICE '=== Q10: IN-FLIGHT DELIVERIES STATUS AUDIT               ===';
    RAISE NOTICE '============================================================';

    v_has_deliv_tbl := (to_regclass('public.notification_deliveries') IS NOT NULL);

    IF v_has_deliv_tbl THEN
        SELECT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
              AND table_name = 'notification_deliveries' 
              AND column_name = 'delivery_status'
        ) INTO v_has_status_col;
    END IF;

    IF NOT v_has_deliv_tbl THEN
        RAISE NOTICE '[SKIPPED] public.notification_deliveries table does not exist. No in-flight deliveries to audit.';
    ELSIF NOT v_has_status_col THEN
        RAISE NOTICE '[SKIPPED] Column "delivery_status" does not exist on public.notification_deliveries.';
    ELSE
        SELECT 
            count(*) FILTER (WHERE delivery_status = 'pending'),
            count(*) FILTER (WHERE delivery_status = 'reserved'),
            count(*) FILTER (WHERE delivery_status = 'dispatching'),
            count(*) FILTER (WHERE delivery_status = 'sent'),
            count(*) FILTER (WHERE delivery_status = 'delivered'),
            count(*) FILTER (WHERE delivery_status = 'failed'),
            count(*) FILTER (WHERE delivery_status = 'cancelled'),
            count(*)
        INTO 
            v_pending, v_reserved, v_dispatching, 
            v_sent, v_delivered, v_failed, v_cancelled, v_total
        FROM public.notification_deliveries;

        RAISE NOTICE 'Total Deliveries : %', v_total;
        RAISE NOTICE '  - Pending      : %', v_pending;
        RAISE NOTICE '  - Reserved     : %', v_reserved;
        RAISE NOTICE '  - Dispatching  : %', v_dispatching;
        RAISE NOTICE '  - Sent         : %', v_sent;
        RAISE NOTICE '  - Delivered    : %', v_delivered;
        RAISE NOTICE '  - Failed       : %', v_failed;
        RAISE NOTICE '  - Cancelled    : %', v_cancelled;

        IF (v_pending + v_reserved + v_dispatching) = 0 THEN
            RAISE NOTICE '[PASS] Zero in-flight deliveries pending, reserved, or dispatching.';
        ELSE
            RAISE NOTICE '[NEEDS REVIEW] % in-flight deliveries found (pending=%, reserved=%, dispatching=%).', 
                (v_pending + v_reserved + v_dispatching), v_pending, v_reserved, v_dispatching;
            RAISE NOTICE '                 Verify background dispatch workers are paused before migration.';
        END IF;
    END IF;
END $$;
