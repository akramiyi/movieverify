import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import welcomeHandler from '../../api/notifications/welcome.js';
import eventsHandler, { buildEventCampaignPayload } from '../../api/notifications/events.js';
import subscriptionsHandler from '../../api/notifications/subscriptions.js';
import preferencesHandler from '../../api/notifications/preferences.js';
import dispatchHandler from '../../api/notifications/dispatch.js';
import { validateCampaignPayload } from '../../api/_lib/campaignService.js';

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

test('Phase 5.2 Welcome API - issues once for newly registered users and suppresses repeats/old accounts', async () => {
  const welcomeDispatches = new Map();
  let rpcCount = 0;

  const createSupabaseForUser = (user) => ({
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
    },
    from: (table) => {
      if (table === 'user_welcome_dispatches') {
        return {
          select: () => ({
            eq: (_col, uid) => ({
              maybeSingle: async () => ({ data: welcomeDispatches.get(uid) || null, error: null }),
            }),
          }),
        };
      }
      return {};
    },
    rpc: async (fnName, params) => {
      if (fnName === 'issue_welcome_notification') {
        rpcCount += 1;
        welcomeDispatches.set(params.p_user_id, {
          user_id: params.p_user_id,
          status: 'created',
          notification_id: 'notif-welcome-1',
        });
        return {
          data: {
            created: true,
            notification_id: 'notif-welcome-1',
            delivery_id: 'del-welcome-1',
            push_queued: 0,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  });

  // 1. Unauthenticated rejected (401)
  const res401 = createMockRes();
  await welcomeHandler({ method: 'POST', headers: {} }, res401);
  assert.equal(res401.statusCode, 401);

  // 2. Method enforcement (405)
  const res405 = createMockRes();
  await welcomeHandler({ method: 'GET', headers: {} }, res405);
  assert.equal(res405.statusCode, 405);

  // 3. Genuine newly registered user gets welcome notification
  const newUser = {
    id: '11111111-1111-4111-8111-111111111111',
    created_at: new Date().toISOString(),
  };
  const mockSupabaseNew = createSupabaseForUser(newUser);

  const resFirst = createMockRes();
  await welcomeHandler(
    { method: 'POST', headers: { authorization: 'Bearer valid-jwt' }, body: { source: 'oauth' } },
    resFirst,
    { supabase: mockSupabaseNew }
  );
  assert.equal(resFirst.statusCode, 200);
  assert.equal(resFirst.body.created, true);
  assert.equal(resFirst.body.notification_id, 'notif-welcome-1');
  assert.equal(rpcCount, 1);

  // 4. Repeat OAuth / subsequent login does NOT issue duplicate
  const resRepeat = createMockRes();
  await welcomeHandler(
    { method: 'POST', headers: { authorization: 'Bearer valid-jwt' }, body: { source: 'signin' } },
    resRepeat,
    { supabase: mockSupabaseNew }
  );
  assert.equal(resRepeat.statusCode, 200);
  assert.equal(resRepeat.body.created, false);
  assert.equal(resRepeat.body.already_processed, true);
  assert.equal(rpcCount, 1);

  // 5. Existing older account (>24h) is skipped cleanly without calling RPC
  const oldUser = {
    id: '22222222-2222-4222-8222-222222222222',
    created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const resOld = createMockRes();
  await welcomeHandler(
    { method: 'POST', headers: { authorization: 'Bearer valid-jwt' }, body: { source: 'signin' } },
    resOld,
    { supabase: createSupabaseForUser(oldUser) }
  );
  assert.equal(resOld.statusCode, 200);
  assert.equal(resOld.body.created, false);
  assert.equal(resOld.body.reason, 'existing_account_subsequent_login');
  assert.equal(rpcCount, 1);
});

test('Phase 5.2 Events API & CampaignService - supports movie, series, and season targets with idempotency', async () => {
  // 1. Validate buildEventCampaignPayload across release types
  const seriesBuilt = buildEventCampaignPayload({
    event_type: 'series_release',
    tmdb_id: '71446-tv',
    media_type: 'tv',
    title: 'Money Heist',
  });
  assert.equal(seriesBuilt.valid, true);
  assert.equal(seriesBuilt.campaignPayload.category, 'movie_release');
  assert.equal(seriesBuilt.campaignPayload.url, '/?type=tv&id=71446');
  assert.equal(seriesBuilt.campaignPayload.target_criteria.type, 'series');
  assert.equal(seriesBuilt.campaignPayload.target_criteria.series_id, '71446');
  assert.equal(seriesBuilt.campaignPayload.idempotency_key, 'catalog:series_release:71446');

  const seasonBuilt = buildEventCampaignPayload({
    event_type: 'season_release',
    tmdb_id: '71446',
    media_type: 'tv',
    season_number: 5,
    title: 'Money Heist',
  });
  assert.equal(seasonBuilt.valid, true);
  assert.equal(seasonBuilt.campaignPayload.target_criteria.type, 'season');
  assert.equal(seasonBuilt.campaignPayload.target_criteria.season_number, 5);
  assert.equal(seasonBuilt.campaignPayload.idempotency_key, 'catalog:season_release:71446:s5');

  const invalidSeason = buildEventCampaignPayload({
    event_type: 'season_release',
    tmdb_id: '71446',
    title: 'Money Heist',
  });
  assert.equal(invalidSeason.valid, false);

  // 2. validateCampaignPayload supports 'series' and 'season'
  const validSeasonCamp = validateCampaignPayload({
    title: 'Season 5 Ready',
    body: 'Watch now',
    category: 'movie_release',
    url: '/?type=tv&id=71446',
    target_criteria: { type: 'season', series_id: '71446', season_number: 5 },
  });
  assert.equal(validSeasonCamp.valid, true);
  assert.equal(validSeasonCamp.sanitized.target_criteria.series_id, '71446');

  // 3. Handler rejects non-admin user (403) and ingests for admin (201)
  const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const nonAdminId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const rpcCalls = [];

  const buildMockAdminSupabase = (uid) => ({
    auth: {
      getUser: async () => ({ data: { user: { id: uid } }, error: null }),
    },
    from: (table) => {
      if (table === 'admin_users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: uid === adminId ? { user_id: adminId } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    },
    rpc: async (fnName, params) => {
      rpcCalls.push({ fnName, params });
      return {
        data: { campaign_id: 'camp-evt-1', status: 'queued', total_recipients: 3, already_exists: false },
        error: null,
      };
    },
  });

  const resForbidden = createMockRes();
  await eventsHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer user-jwt' },
      body: { event_type: 'movie_release', tmdb_id: '550', title: 'Fight Club' },
    },
    resForbidden,
    { supabase: buildMockAdminSupabase(nonAdminId) }
  );
  assert.equal(resForbidden.statusCode, 403);

  const resAdmin = createMockRes();
  await eventsHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer admin-jwt' },
      body: { event_type: 'movie_release', tmdb_id: '550', title: 'Fight Club' },
    },
    resAdmin,
    { supabase: buildMockAdminSupabase(adminId) }
  );
  assert.equal(resAdmin.statusCode, 201);
  assert.equal(resAdmin.body.campaign_id, 'camp-evt-1');
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fnName, 'ingest_notification_campaign');
  assert.equal(rpcCalls[0].params.p_target_criteria.type, 'movie');
});

test('Phase 5.2 Subscriptions & Preferences APIs - series/season subscriptions and explicit email capability disclosure', async () => {
  let lastUpsert = null;
  const mockSubSupabase = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'usr-sub-1' } }, error: null }),
    },
    from: () => ({
      upsert: (row) => {
        lastUpsert = row;
        return {
          select: () => ({
            single: async () => ({ data: row, error: null }),
          }),
        };
      },
    }),
  };

  const resSeasonSub = createMockRes();
  await subscriptionsHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer valid-jwt' },
      body: { type: 'season', target_id: '71446-tv', target_name: 'Money Heist', season_number: 3 },
    },
    resSeasonSub,
    mockSubSupabase
  );
  assert.equal(resSeasonSub.statusCode, 201);
  assert.equal(lastUpsert.movie_id, '71446');
  assert.equal(lastUpsert.media_type, 'tv');
  assert.equal(lastUpsert.target_season, 3);

  // Preferences returns explicit channel_capabilities & warning for unsupported channel_email
  const mockPrefSupabase = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'usr-pref-1' } }, error: null }),
    },
    from: (table) => {
      if (table === 'user_notification_preferences') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  user_id: 'usr-pref-1',
                  opt_in_all: true,
                  channel_in_app: true,
                  channel_push: true,
                  channel_email: true,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'notification_opt_outs') {
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
      }
      return {};
    },
  };

  const resPref = createMockRes();
  await preferencesHandler(
    { method: 'GET', headers: { authorization: 'Bearer valid-jwt' } },
    resPref,
    mockPrefSupabase
  );
  assert.equal(resPref.statusCode, 200);
  assert.deepEqual(resPref.body.channel_capabilities, { in_app: true, push: true, email: false });
  assert.equal(resPref.body.warnings.length, 1);
  assert.match(resPref.body.warnings[0], /email notification delivery is not supported/i);
});

test('Phase 5.2 Dispatch Integration - promotes due scheduled campaigns before reserving deliveries', async () => {
  const prevWorkerSecret = process.env.INTERNAL_WORKER_SECRET;
  const prevDispatchEnabled = process.env.NOTIFICATION_DISPATCH_ENABLED;
  process.env.INTERNAL_WORKER_SECRET = 'test-worker-secret-p52';
  process.env.NOTIFICATION_DISPATCH_ENABLED = 'true';

  try {
    const calledRpcs = [];
    const mockSupabase = {
      rpc: async (fnName) => {
        calledRpcs.push(fnName);
        if (fnName === 'promote_due_scheduled_campaigns') {
          return { data: { promoted_count: 2, campaigns: [{ campaign_id: 'c1' }, { campaign_id: 'c2' }] }, error: null };
        }
        if (fnName === 'reserve_notification_deliveries') {
          return { data: [], error: null };
        }
        return { data: null, error: null };
      },
    };
    const mockMessaging = { send: async () => 'msg-1' };

    const res = createMockRes();
    await dispatchHandler(
      {
        method: 'POST',
        headers: { 'x-worker-secret': 'test-worker-secret-p52' },
        body: { batch_size: 10 },
      },
      res,
      { supabase: mockSupabase, messaging: mockMessaging }
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.promoted_campaigns, 2);
    assert.deepEqual(calledRpcs.slice(0, 2), [
      'promote_due_scheduled_campaigns',
      'reserve_notification_deliveries',
    ]);
  } finally {
    if (prevWorkerSecret === undefined) delete process.env.INTERNAL_WORKER_SECRET;
    else process.env.INTERNAL_WORKER_SECRET = prevWorkerSecret;
    if (prevDispatchEnabled === undefined) delete process.env.NOTIFICATION_DISPATCH_ENABLED;
    else process.env.NOTIFICATION_DISPATCH_ENABLED = prevDispatchEnabled;
  }
});

test('Phase 5.2 SQL Migration Integrity - forward-only migration preserves B5E and implements complete engine', () => {
  const migrationPath = path.resolve('supabase/migrations/20261111120000_smart_notification_automation_engine.sql');
  assert.equal(fs.existsSync(migrationPath), true, 'New forward-only migration file must exist');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.user_welcome_dispatches/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.compute_quiet_hours_resume_at/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.is_category_allowed_by_preferences/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\._materialize_notification_campaign/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.ingest_notification_campaign/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.promote_due_scheduled_campaigns/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.issue_welcome_notification/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.record_notification_telemetry/);
  assert.match(sql, /retired from worker polling/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.promote_due_scheduled_campaigns\(integer\) FROM PUBLIC, anon, authenticated;/);

  // Confirm B5E security migration was NOT overwritten or degraded
  const b5ePath = path.resolve('supabase/migrations_superseded/20261111000000_endpoint_revocation_security_remediation.sql');
  const b5eSql = fs.readFileSync(b5ePath, 'utf-8');
  assert.match(b5eSql, /e\.revocation_reason IS NULL/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.reserve_notification_deliveries/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.authorize_notification_delivery_dispatch/);
});

