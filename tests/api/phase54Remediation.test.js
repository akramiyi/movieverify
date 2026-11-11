import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import subscriptionsHandler from '../../api/notifications/subscriptions.js';
import preferencesHandler from '../../api/notifications/preferences.js';
import welcomeHandler from '../../api/notifications/welcome.js';
import dispatchHandler from '../../api/notifications/dispatch.js';
import { buildContentUpdateIdempotencyKey } from '../../src/utils/notificationLinks.js';

function createMockRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(payload) {
      if (payload) {
        try {
          this.body = JSON.parse(payload);
        } catch {
          this.body = payload;
        }
      }
      return this;
    },
  };
}

function readRemediationSql() {
  const migrationPath = path.resolve(
    'supabase/migrations/20261111150000_smart_notification_critical_remediation.sql'
  );
  assert.equal(fs.existsSync(migrationPath), true, 'Phase 5.4 remediation SQL migration must exist');
  return fs.readFileSync(migrationPath, 'utf-8');
}

function extractSqlSection(sql, startMarker, endMarker) {
  const startIdx = sql.indexOf(startMarker);
  assert.notEqual(startIdx, -1, `Missing SQL section marker: ${startMarker}`);
  if (!endMarker) return sql.slice(startIdx);
  const endIdx = sql.indexOf(endMarker, startIdx);
  assert.notEqual(endIdx, -1, `Missing SQL end marker: ${endMarker}`);
  return sql.slice(startIdx, endIdx);
}

test('Phase 5.4 SQL (C-1 & C-3) - partial unique index conflict inference and delivered_at remediation', () => {
  const sql = readRemediationSql();

  // C-3: delivered_at column exists before telemetry update references it
  assert.match(sql, /ALTER TABLE public\.notification_deliveries\s+ADD COLUMN IF NOT EXISTS delivered_at timestamptz;/);

  // C-1: Partial unique index preserves multiple NULL endpoint_id ('in_app') deliveries per campaign
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_deliveries_campaign_endpoint\s+ON public\.notification_deliveries \(campaign_id, endpoint_id\)\s+WHERE endpoint_id IS NOT NULL;/
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_deliveries_campaign_user_in_app\s+ON public\.notification_deliveries \(campaign_id, recipient_id\)\s+WHERE channel_type = 'in_app' AND recipient_id IS NOT NULL;/
  );

  // Both push INSERT statements match the exact partial index predicate
  const conflictMatches = sql.match(
    /ON CONFLICT \(campaign_id, endpoint_id\) WHERE endpoint_id IS NOT NULL DO NOTHING/g
  );
  assert.equal(
    conflictMatches?.length,
    2,
    'Both campaign materializer and welcome helper must use partial-index ON CONFLICT predicate'
  );
});

test('Phase 5.4 SQL (C-2) - removes current_user checks, enforces auth.role()/session_user & internal welcome helper', () => {
  const sql = readRemediationSql();

  // Strip comments so assertion checks executable SQL statements only
  const executableSql = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  assert.doesNotMatch(
    executableSql,
    /\bcurrent_user\b/i,
    'Executable SQL in forward-only remediation must never trust current_user inside SECURITY DEFINER'
  );

  const authFns = [
    'CREATE OR REPLACE FUNCTION public.cancel_notification_campaign(',
    'CREATE OR REPLACE FUNCTION public.ingest_notification_campaign(',
    'CREATE OR REPLACE FUNCTION public.promote_due_scheduled_campaigns(',
    'CREATE OR REPLACE FUNCTION public.issue_welcome_notification(',
    'CREATE OR REPLACE FUNCTION public.record_notification_telemetry(',
  ];

  for (const fnSig of authFns) {
    assert.ok(sql.includes(fnSig), `Expected remediated function definition: ${fnSig}`);
  }

  // Trusted caller check across functions
  const trustedPatternCount = (
    sql.match(/COALESCE\(auth\.role\(\), ''\) = 'service_role'\s+OR \(auth\.role\(\) IS NULL AND session_user IN \('postgres', 'supabase_admin'\)\)/g) || []
  ).length;
  assert.equal(trustedPatternCount, 5, 'All 5 public/privileged RPCs must check auth.role()/session_user');

  // ingest_notification_campaign prevents p_created_by spoofing for non-service callers
  const ingestBody = extractSqlSection(
    sql,
    'CREATE OR REPLACE FUNCTION public.ingest_notification_campaign(',
    'REVOKE ALL ON FUNCTION public.ingest_notification_campaign'
  );
  assert.match(
    ingestBody,
    /v_actor_id := CASE\s+WHEN v_is_service THEN COALESCE\(p_created_by, auth\.uid\(\)\)\s+ELSE auth\.uid\(\)\s+END;/
  );

  // Private internal welcome helper is revoked from every external role including service_role
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\._issue_welcome_notification_internal\(/
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\._issue_welcome_notification_internal\(uuid, text\) FROM PUBLIC, anon, authenticated, service_role;/
  );
  assert.match(
    sql,
    /PERFORM public\._issue_welcome_notification_internal\(NEW\.id, 'auth_trigger'\);/
  );
});

test('Phase 5.4 SQL (H-1, H-2, H-3, H-4, H-5 & B5D/B5E preservation) - concurrency, lock order, revocation & status compatibility', () => {
  const sql = readRemediationSql();

  // H-1: Welcome campaign starts as 'queued', heals 'completed' -> 'queued', and skips push when cancelled
  const welcomeInternal = extractSqlSection(
    sql,
    'CREATE OR REPLACE FUNCTION public._issue_welcome_notification_internal(',
    'REVOKE ALL ON FUNCTION public._issue_welcome_notification_internal'
  );
  assert.match(welcomeInternal, /'queued'\s*\)\s+ON CONFLICT \(id\) DO NOTHING/);
  assert.match(welcomeInternal, /SET status = 'queued',\s+completed_at = NULL[\s\S]+WHERE id = v_welcome_campaign_id\s+AND status = 'completed';/);
  assert.match(welcomeInternal, /IF COALESCE\(v_welcome_camp_status, ''\) NOT IN \('queued', 'processing'\)/);
  assert.match(welcomeInternal, /RETURNING id INTO v_push_del_id;\s+IF v_push_del_id IS NOT NULL THEN\s+v_push_queued := v_push_queued \+ 1;/);
  assert.match(welcomeInternal, /IF v_notification_id IS NULL AND v_push_queued = 0 THEN/);

  // H-2: Deterministic recipient ordering & per-user daily push advisory lock
  const matBody = extractSqlSection(
    sql,
    'CREATE OR REPLACE FUNCTION public._materialize_notification_campaign(',
    'REVOKE ALL ON FUNCTION public._materialize_notification_campaign'
  );
  assert.match(matBody, /ORDER BY cu\.user_id ASC/);
  assert.match(matBody, /PERFORM pg_advisory_xact_lock\(1001, hashtext\(v_recipient\.user_id::text\)\);/);
  assert.match(welcomeInternal, /PERFORM pg_advisory_xact_lock\(1001, hashtext\(p_user_id::text\)\);/);

  // H-3: Campaign idempotency advisory lock & active partial unique index
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_campaigns_active_idempotency_key/
  );
  assert.match(sql, /PERFORM pg_advisory_xact_lock\(1002, hashtext\(v_idempotency_key\)\);/);

  // H-4: Campaign-first, delivery-second lock ordering in record_notification_telemetry
  const telemBody = extractSqlSection(
    sql,
    'CREATE OR REPLACE FUNCTION public.record_notification_telemetry(',
    'REVOKE ALL ON FUNCTION public.record_notification_telemetry'
  );
  const campLockIdx = telemBody.search(/SELECT id INTO v_locked_camp_id\s+FROM public\.notification_campaigns\s+WHERE id = v_camp_id\s+FOR UPDATE/);
  const delivLockIdx = telemBody.search(/SELECT \* INTO v_delivery\s+FROM public\.notification_deliveries\s+WHERE id = p_delivery_id\s+FOR UPDATE/);
  assert.ok(campLockIdx !== -1 && delivLockIdx !== -1, 'Telemetry must lock both tables FOR UPDATE');
  assert.ok(campLockIdx < delivLockIdx, 'Campaign row MUST be locked BEFORE delivery row');

  // H-5: Endpoint queries check ne.revocation_reason IS NULL (strip comment header before counting)
  const executableSql = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  const revReasonChecks = (executableSql.match(/ne\.revocation_reason IS NULL/g) || []).length;
  assert.equal(revReasonChecks, 4, 'All 4 endpoint eligibility queries must enforce revocation_reason IS NULL');

  // In-app-only completion & legacy TV fallback on 'season' targets
  assert.match(matBody, /v_final_status := CASE WHEN v_push_deliveries > 0 THEN 'queued' ELSE 'completed' END;/);
  assert.match(matBody, /WHERE v_target_type = 'season'[\s\S]+ns\.entity_type = 'movie'[\s\S]+COALESCE\(ns\.metadata->>'media_type', 'movie'\) IN \('tv', 'series'\)/);

  // Confirm B5D & B5E RPCs are never altered/overwritten in Phase 5.4
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.reserve_notification_deliveries/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.authorize_notification_delivery_dispatch/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.confirm_notification_delivery_sent/);
});

test('Phase 5.4 Multi-Season Subscriptions - supports concurrent series + multiple seasons cleanly', async () => {
  const store = new Map();
  let lastConflict = null;
  const userId = 'usr-multi-1';

  const mockSupabase = {
    auth: {
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
    },
    from: (table) => {
      assert.equal(table, 'movie_notify_requests');
      return {
        upsert: (row, opts) => {
          lastConflict = opts?.onConflict;
          const key = `${row.user_id}:${row.movie_id}:${row.season_scope}`;
          store.set(key, { ...row });
          return {
            select: () => ({
              single: async () => ({ data: store.get(key), error: null }),
            }),
          };
        },
        delete: () => {
          const filters = {};
          const chain = {
            eq(col, val) {
              filters[col] = val;
              return chain;
            },
            gt(col, val) {
              filters[`${col}_gt`] = val;
              return chain;
            },
            then(resolve) {
              for (const [k, row] of Array.from(store.entries())) {
                const matchEq =
                  (!filters.user_id || row.user_id === filters.user_id) &&
                  (!filters.movie_id || row.movie_id === filters.movie_id) &&
                  (filters.season_scope === undefined || row.season_scope === filters.season_scope) &&
                  (filters.season_scope_gt === undefined || row.season_scope > filters.season_scope_gt);
                if (matchEq) store.delete(k);
              }
              resolve({ error: null });
            },
          };
          return chain;
        },
      };
    },
  };

  // Subscribe to Series + Season 2 + Season 3 simultaneously
  const resSeries = createMockRes();
  await subscriptionsHandler(
    { method: 'POST', headers: { authorization: 'Bearer jwt' }, body: { type: 'series', target_id: '71446-tv', target_name: 'Money Heist' } },
    resSeries,
    mockSupabase
  );
  assert.equal(resSeries.statusCode, 201);
  assert.equal(lastConflict, 'user_id,movie_id,season_scope');

  const resS2 = createMockRes();
  await subscriptionsHandler(
    { method: 'POST', headers: { authorization: 'Bearer jwt' }, body: { type: 'season', target_id: '71446-tv', target_name: 'Money Heist', season_number: 2 } },
    resS2,
    mockSupabase
  );
  assert.equal(resS2.statusCode, 201);

  const resS3 = createMockRes();
  await subscriptionsHandler(
    { method: 'POST', headers: { authorization: 'Bearer jwt' }, body: { type: 'season', target_id: '71446-tv', target_name: 'Money Heist', season_number: 3 } },
    resS3,
    mockSupabase
  );
  assert.equal(resS3.statusCode, 201);
  assert.equal(store.size, 3, 'Series + Season 2 + Season 3 must coexist simultaneously');

  // Delete ONLY Season 2 without disturbing Series or Season 3
  const resDelS2 = createMockRes();
  await subscriptionsHandler(
    { method: 'DELETE', headers: { authorization: 'Bearer jwt' }, body: { type: 'season', target_id: '71446-tv', season_number: 2 } },
    resDelS2,
    mockSupabase
  );
  assert.equal(resDelS2.statusCode, 200);
  assert.equal(store.size, 2);
  assert.equal(store.has(`${userId}:71446:0`), true);
  assert.equal(store.has(`${userId}:71446:3`), true);
});

test('Phase 5.4 API & Client Fixes - welcome created_at fail-closed, TZ validation, dispatch 500 observability, deterministic update key', async () => {
  // 1. Welcome endpoint fails closed if created_at is missing
  const rpcCalls = [];
  const resMissingCreated = createMockRes();
  await welcomeHandler(
    { method: 'POST', headers: { authorization: 'Bearer jwt' }, body: { source: 'signin' } },
    resMissingCreated,
    {
      supabase: {
        auth: { getUser: async () => ({ data: { user: { id: 'usr-no-created' } }, error: null }) },
        rpc: async (name) => {
          rpcCalls.push(name);
          return { data: {}, error: null };
        },
      },
    }
  );
  assert.equal(resMissingCreated.statusCode, 200);
  assert.equal(resMissingCreated.body.created, false);
  assert.equal(resMissingCreated.body.reason, 'missing_created_at_timestamp');
  assert.equal(rpcCalls.length, 0);

  // 2. Preferences API rejects invalid quiet_hours_tz & accepts valid IANA timezone
  const createPrefMock = () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'usr-tz-1' } }, error: null }) },
    from: (table) => {
      if (table === 'user_notification_preferences') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          upsert: (row) => ({ select: () => ({ single: async () => ({ data: row, error: null }) }) }),
        };
      }
      if (table === 'notification_opt_outs') {
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
          upsert: async () => ({ error: null }),
          delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
        };
      }
      return {};
    },
  });

  const resBadTz = createMockRes();
  await preferencesHandler(
    { method: 'POST', headers: { authorization: 'Bearer jwt' }, body: { quiet_hours_tz: 'Invalid/Zone_XYZ' } },
    resBadTz,
    createPrefMock()
  );
  assert.equal(resBadTz.statusCode, 400);
  assert.match(resBadTz.body.error, /IANA timezone/i);

  const resGoodTz = createMockRes();
  await preferencesHandler(
    { method: 'POST', headers: { authorization: 'Bearer jwt' }, body: { quiet_hours_tz: 'Asia/Kolkata' } },
    resGoodTz,
    createPrefMock()
  );
  assert.equal(resGoodTz.statusCode, 200);
  assert.equal(resGoodTz.body.preferences.quiet_hours_tz, 'Asia/Kolkata');

  // 3. Dispatch surfaces HTTP 500 when promote_due_scheduled_campaigns fails in DB while still processing queue
  const prevSecret = process.env.INTERNAL_WORKER_SECRET;
  const prevDispatchEnabled = process.env.NOTIFICATION_DISPATCH_ENABLED;
  process.env.INTERNAL_WORKER_SECRET = 'test-worker-secret-p54';
  process.env.NOTIFICATION_DISPATCH_ENABLED = 'true';
  try {
    const dispatchRpcs = [];
    const resPromoFail = createMockRes();
    await dispatchHandler(
      {
        method: 'POST',
        headers: { 'x-worker-secret': 'test-worker-secret-p54' },
        body: { batch_size: 10 },
      },
      resPromoFail,
      {
        supabase: {
          rpc: async (fnName) => {
            dispatchRpcs.push(fnName);
            if (fnName === 'promote_due_scheduled_campaigns') {
              return { data: null, error: { message: 'connection timeout' } };
            }
            if (fnName === 'reserve_notification_deliveries') {
              return { data: [], error: null };
            }
            return { data: null, error: null };
          },
        },
        messaging: { send: async () => 'msg-1' },
      }
    );
    assert.equal(resPromoFail.statusCode, 500);
    assert.equal(resPromoFail.body.success, false);
    assert.match(resPromoFail.body.promotion_error, /connection timeout/);
    assert.deepEqual(dispatchRpcs, ['promote_due_scheduled_campaigns', 'reserve_notification_deliveries']);
  } finally {
    if (prevSecret === undefined) delete process.env.INTERNAL_WORKER_SECRET;
    else process.env.INTERNAL_WORKER_SECRET = prevSecret;
    if (prevDispatchEnabled === undefined) delete process.env.NOTIFICATION_DISPATCH_ENABLED;
    else process.env.NOTIFICATION_DISPATCH_ENABLED = prevDispatchEnabled;
  }

  // 4. AdminPanel deterministic content_update idempotency key
  const keyA1 = buildContentUpdateIdempotencyKey({
    tmdbId: '550-movie',
    mediaType: 'movie',
    link720: 'https://example.com/a-720',
  });
  const keyA2 = buildContentUpdateIdempotencyKey({
    tmdbId: '550-movie',
    mediaType: 'movie',
    link720: 'https://example.com/a-720',
  });
  const keyB = buildContentUpdateIdempotencyKey({
    tmdbId: '550-movie',
    mediaType: 'movie',
    link720: 'https://example.com/b-720',
  });
  assert.equal(keyA1, keyA2, 'Identical link snapshot must deduplicate across retries');
  assert.notEqual(keyA1, keyB, 'Distinct link update must produce distinct idempotency key immediately');

  // 5. useSubscriptions & NotificationPreferences wiring checks
  const subsCode = fs.readFileSync(path.resolve('src/hooks/useSubscriptions.js'), 'utf-8');
  assert.match(subsCode, /onConflict:\s*'user_id,movie_id,season_scope'/);
  assert.match(subsCode, /\.eq\('season_scope',\s*seasonScope\)/);
  assert.match(subsCode, /isMovieNotifying:\s*\(id,\s*targetSeason\s*=\s*undefined\)/);

  const prefsUiCode = fs.readFileSync(path.resolve('src/components/NotificationPreferences.jsx'), 'utf-8');
  assert.match(prefsUiCode, /quiet-hours-tz-select/);
  assert.doesNotMatch(prefsUiCode, /during your rest hours \(UTC\)\./);
});
