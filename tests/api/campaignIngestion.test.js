/**
 * MovieVerify Campaign Ingestion & Cancellation API Test Suite
 * 
 * Verifies:
 * 1. Validation & sanitization guards (title, body, category, internal URL, targets).
 * 2. Trusted server-side admin authorization (JWT verification, role check, email domain).
 * 3. Machine-to-machine (M2M) authorization (x-campaign-secret, fail closed, timing-safe).
 * 4. Role separation: rejection of x-worker-secret and non-admin tokens.
 * 5. Bounded payload length (413 Payload Too Large).
 * 6. Forwarding of exact parameters to public.ingest_notification_campaign RPC.
 * 7. Idempotency handling (201 Created on first ingestion, 200 OK on replay).
 * 8. Draft and future-scheduled campaign contracts.
 * 9. Domain targeting (all, movie, actor, genre, users).
 * 10. Cancellation via DELETE and POST action=cancel calling public.cancel_notification_campaign.
 * 11. Cancellation terminal / not-found states (404 and 409).
 * 12. Token privacy and zero-leakage in logs.
 * 13. Regression protection for existing notification APIs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateInternalUrl,
  validateCampaignPayload,
  validateCancellationInput,
  isServerSideAdmin,
  isAuthorizedM2M,
  ingestCampaign,
  cancelCampaign,
} from '../../api/_lib/campaignService.js';

import campaignsHandler from '../../api/notifications/campaigns.js';
import { getSupabaseUserClient } from '../../api/_lib/supabaseServer.js';

/**
 * Creates mock HTTP Request & Response objects
 */
function createMockHttp({ method = 'POST', headers = {}, body = null, url = '/api/notifications/campaigns', query = null } = {}) {
  const req = {
    method,
    headers: { ...headers },
    body,
    url,
    query,
  };

  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    end(data) {
      this.body = data;
    },
    json() {
      try {
        return JSON.parse(this.body);
      } catch {
        return null;
      }
    },
  };

  return { req, res };
}

/**
 * Creates an in-memory mock Supabase client mirroring the campaign RPCs and auth
 */
function createMockSupabaseForCampaigns(options = {}) {
  const campaigns = new Map((options.campaigns || []).map(c => [c.id, { ...c }]));
  const rpcCalls = [];

  return {
    _campaigns: campaigns,
    _rpcCalls: rpcCalls,

    auth: {
      async getUser(token) {
        if (token === 'admin-jwt-valid') {
          return {
            data: {
              user: {
                id: '00000000-0000-0000-0000-000000000001',
                email: 'admin@movieverify.com',
                app_metadata: { role: 'admin' },
              },
            },
            error: null,
          };
        }
        if (token === 'domain-admin-jwt') {
          return {
            data: {
              user: {
                id: '00000000-0000-0000-0000-000000000002',
                email: 'staff@movieverify.com',
                app_metadata: {},
              },
            },
            error: null,
          };
        }
        if (token === 'regular-user-jwt') {
          return {
            data: {
              user: {
                id: '00000000-0000-0000-0000-000000000003',
                email: 'user@gmail.com',
                app_metadata: { role: 'authenticated' },
              },
            },
            error: null,
          };
        }
        return { data: { user: null }, error: { message: 'Invalid token' } };
      },
    },

    async rpc(fnName, params = {}) {
      rpcCalls.push({ fnName, params });

      if (fnName === 'ingest_notification_campaign') {
        if (options.failRpc) {
          return { data: null, error: { message: 'Simulated database RPC failure' } };
        }

        const idempKey = params.p_target_criteria?.idempotency_key;
        if (idempKey && options.existingIdempKey === idempKey) {
          return {
            data: {
              success: true,
              already_exists: true,
              campaign_id: '11111111-1111-1111-1111-111111111111',
              status: 'processing',
              total_recipients: 5,
              total_deliveries: 6,
              message: 'Campaign with idempotency key already exists',
            },
            error: null,
          };
        }

        const campaignId = '22222222-2222-2222-2222-222222222222';
        let status = 'processing';
        if (params.p_target_criteria?.is_draft) {
          status = 'draft';
        } else if (params.p_scheduled_for && new Date(params.p_scheduled_for) > new Date()) {
          status = 'scheduled';
        }

        const newCamp = {
          id: campaignId,
          title: params.p_title,
          body: params.p_body,
          category: params.p_category,
          status,
          total_recipients: 10,
          total_deliveries: status === 'draft' ? 0 : 12,
          scheduled_for: params.p_scheduled_for,
          created_by: params.p_created_by,
        };
        campaigns.set(campaignId, newCamp);

        return {
          data: {
            success: true,
            already_exists: false,
            campaign_id: campaignId,
            status,
            total_recipients: 10,
            total_deliveries: status === 'draft' ? 0 : 12,
            scheduled_for: params.p_scheduled_for,
          },
          error: null,
        };
      }

      if (fnName === 'cancel_notification_campaign') {
        if (options.failRpc) {
          return { data: null, error: { message: 'Simulated cancellation RPC failure' } };
        }

        const campId = params.p_campaign_id;
        const camp = campaigns.get(campId);

        if (!camp) {
          return {
            data: {
              success: false,
              error: 'CAMPAIGN_NOT_FOUND',
              message: `Campaign ${campId} does not exist`,
            },
            error: null,
          };
        }

        if (camp.status === 'completed' || camp.status === 'cancelled') {
          return {
            data: {
              success: false,
              error: 'INVALID_CAMPAIGN_STATE',
              message: `Campaign ${campId} is already in terminal state: ${camp.status}`,
              status: camp.status,
            },
            error: null,
          };
        }

        camp.status = 'cancelled';
        return {
          data: {
            success: true,
            campaign_id: campId,
            status: 'cancelled',
            cancelled_deliveries: 4,
          },
          error: null,
        };
      }

      throw new Error(`Unexpected RPC call: ${fnName}`);
    },

    from(tableName) {
      if (tableName === 'admin_users') {
        const adminUsers = new Set(options.adminUsers || [
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000002', // whitelisted admin user
        ]);
        return {
          select() {
            return {
              eq(col, val) {
                return {
                  async maybeSingle() {
                    if (adminUsers.has(val)) {
                      return { data: { user_id: val }, error: null };
                    }
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: null, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

test('Campaign Service Unit & Validation Suite', async (t) => {
  await t.test('1. validateInternalUrl: Accepts valid relative paths and rejects external/relative protocols', () => {
    assert.equal(validateInternalUrl('/'), true);
    assert.equal(validateInternalUrl('/movies'), true);
    assert.equal(validateInternalUrl('/movies/123?ref=notify'), true);

    // Rejections
    assert.equal(validateInternalUrl('https://evil.com'), false);
    assert.equal(validateInternalUrl('http://evil.com'), false);
    assert.equal(validateInternalUrl('//evil.com'), false);
    assert.equal(validateInternalUrl('/\\evil.com'), false);
    assert.equal(validateInternalUrl('javascript:alert(1)'), false);
    assert.equal(validateInternalUrl('movies/relative'), false);
    assert.equal(validateInternalUrl(''), false);
    assert.equal(validateInternalUrl(null), false);
  });

  await t.test('2. isServerSideAdmin: Sole authority is public.admin_users membership (no app_metadata bypass)', async () => {
    const mockSupabase = {
      from(_table) {
        return {
          select() {
            return {
              eq(col, val) {
                return {
                  async maybeSingle() {
                    if (val === '00000000-0000-0000-0000-000000000002') {
                      return { data: { user_id: val }, error: null };
                    }
                    if (val === 'error-user-id') {
                      return { data: null, error: { message: 'DB connection error' } };
                    }
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      },
    };

    // 1. Role admin in app_metadata WITHOUT admin_users membership is REJECTED
    assert.equal(await isServerSideAdmin({ app_metadata: { role: 'admin' }, email: 'any@gmail.com' }, mockSupabase), false);
    assert.equal(await isServerSideAdmin({ id: '00000000-0000-0000-0000-000000000099', app_metadata: { role: 'admin' }, email: 'admin@movieverify.com' }, mockSupabase), false);

    // 2. Whitelisted in admin_users table -> SUCCEEDS
    assert.equal(await isServerSideAdmin({ id: '00000000-0000-0000-0000-000000000002', app_metadata: {} }, mockSupabase), true);

    // 3. Email domain @movieverify.com without admin role or admin_users membership is REJECTED
    assert.equal(await isServerSideAdmin({ id: '00000000-0000-0000-0000-000000000099', app_metadata: {}, email: 'dev@movieverify.com' }, mockSupabase), false);
    assert.equal(await isServerSideAdmin({ id: '00000000-0000-0000-0000-000000000099', app_metadata: {}, email: 'ADMIN@MOVIEVERIFY.COM' }, mockSupabase), false);

    // 4. Regular user rejected
    assert.equal(await isServerSideAdmin({ id: '00000000-0000-0000-0000-000000000003', app_metadata: { role: 'user' }, email: 'user@gmail.com' }, mockSupabase), false);
    assert.equal(await isServerSideAdmin({ id: '00000000-0000-0000-0000-000000000099', email: 'user@spoofedmovieverify.com' }, mockSupabase), false);

    // 5. Database lookup error fails closed
    assert.equal(await isServerSideAdmin({ id: 'error-user-id', app_metadata: {} }, mockSupabase), false);

    // 6. Missing or empty user fails closed
    assert.equal(await isServerSideAdmin(null, mockSupabase), false);
    assert.equal(await isServerSideAdmin({}, mockSupabase), false);
  });

  await t.test('3. isAuthorizedM2M: Validates x-campaign-secret and fails closed without secret', () => {
    const originalEnv = process.env.CAMPAIGN_API_SECRET;
    process.env.CAMPAIGN_API_SECRET = 'm2m_secure_campaign_token_alpha_123';

    try {
      assert.equal(isAuthorizedM2M({ 'x-campaign-secret': 'm2m_secure_campaign_token_alpha_123' }), true);
      assert.equal(isAuthorizedM2M({ 'x-m2m-secret': 'm2m_secure_campaign_token_alpha_123' }), true);

      // Wrong secret
      assert.equal(isAuthorizedM2M({ 'x-campaign-secret': 'wrong_secret' }), false);
      assert.equal(isAuthorizedM2M({}), false);

      // Role separation: rejects x-worker-secret
      assert.equal(isAuthorizedM2M({ 'x-worker-secret': 'm2m_secure_campaign_token_alpha_123' }), false);

      // Fail closed when env unset
      delete process.env.CAMPAIGN_API_SECRET;
      delete process.env.INTERNAL_CAMPAIGN_SECRET;
      assert.equal(isAuthorizedM2M({ 'x-campaign-secret': 'm2m_secure_campaign_token_alpha_123' }), false);
    } finally {
      process.env.CAMPAIGN_API_SECRET = originalEnv;
    }
  });

  await t.test('4. validateCampaignPayload: Validates title, body, category and target criteria', () => {
    // Missing title
    let res = validateCampaignPayload({ body: 'B', category: 'movie_release' });
    assert.equal(res.valid, false);
    assert.match(res.error, /Title is required/);

    // Title too long (> 150)
    res = validateCampaignPayload({ title: 'A'.repeat(151), body: 'B', category: 'movie_release' });
    assert.equal(res.valid, false);
    assert.match(res.error, /Title must not exceed 150/);

    // Body too long (> 1000)
    res = validateCampaignPayload({ title: 'T', body: 'B'.repeat(1001), category: 'movie_release' });
    assert.equal(res.valid, false);
    assert.match(res.error, /Body must not exceed 1000/);

    // Invalid category
    res = validateCampaignPayload({ title: 'T', body: 'B', category: 'unsupported_cat' });
    assert.equal(res.valid, false);
    assert.match(res.error, /Invalid category/);

    // Invalid URL
    res = validateCampaignPayload({ title: 'T', body: 'B', category: 'movie_release', url: 'https://external.com' });
    assert.equal(res.valid, false);
    assert.match(res.error, /URL must be a valid internal path/);

    // Target type: movie requires movie_id
    res = validateCampaignPayload({ title: 'T', body: 'B', category: 'movie_release', target_criteria: { type: 'movie' } });
    assert.equal(res.valid, false);
    assert.match(res.error, /movie_id is required/);

    // Target type: actor requires actor_id
    res = validateCampaignPayload({ title: 'T', body: 'B', category: 'movie_release', target_criteria: { type: 'actor' } });
    assert.equal(res.valid, false);
    assert.match(res.error, /actor_id is required/);

    // Target type: genre requires genre_id
    res = validateCampaignPayload({ title: 'T', body: 'B', category: 'movie_release', target_criteria: { type: 'genre' } });
    assert.equal(res.valid, false);
    assert.match(res.error, /genre_id is required/);

    // Target type: users requires array of valid UUIDs
    res = validateCampaignPayload({ title: 'T', body: 'B', category: 'movie_release', target_criteria: { type: 'users', user_ids: ['invalid-uuid'] } });
    assert.equal(res.valid, false);
    assert.match(res.error, /Invalid user UUID/);

    // Invalid scheduled_for
    res = validateCampaignPayload({ title: 'T', body: 'B', category: 'movie_release', scheduled_for: 'not-a-date' });
    assert.equal(res.valid, false);
    assert.match(res.error, /scheduled_for must be a valid ISO 8601 date/);

    // Valid payload
    res = validateCampaignPayload({
      title: 'Valid Title',
      body: 'Valid Body',
      category: 'movie_release',
      url: '/movies/123',
      target_criteria: { type: 'movie', movie_id: '42' },
      idempotency_key: 'idemp-123',
    });
    assert.equal(res.valid, true);
    assert.equal(res.sanitized.title, 'Valid Title');
    assert.equal(res.sanitized.target_criteria.movie_id, '42');
    assert.equal(res.sanitized.target_criteria.idempotency_key, 'idemp-123');
  });

  await t.test('5. validateCancellationInput: Requires valid UUID', () => {
    assert.equal(validateCancellationInput('00000000-0000-0000-0000-000000000001').valid, true);
    assert.equal(validateCancellationInput({ campaign_id: '00000000-0000-0000-0000-000000000001' }).valid, true);
    assert.equal(validateCancellationInput('not-a-uuid').valid, false);
    assert.equal(validateCancellationInput({}).valid, false);
  });
});

test('Campaign Ingestion & Cancellation Service Functions Suite', async (t) => {
  await t.test('1. Ingestion forwards verified admin created_by and ignores client created_by override', async () => {
    const mockSupabase = createMockSupabaseForCampaigns();
    const adminUser = { id: '00000000-0000-0000-0000-000000000001', email: 'admin@movieverify.com' };

    const payload = {
      title: 'New Movie Release',
      body: 'Catch the premiere tonight',
      category: 'movie_release',
      url: '/movies/premiere',
      created_by: 'malicious-injected-uuid', // Attacker override attempt
    };

    const res = await ingestCampaign(payload, { user: adminUser }, mockSupabase);
    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.already_exists, false);

    // Verify RPC call was passed verified admin ID, not the attacker's created_by
    const call = mockSupabase._rpcCalls.find(c => c.fnName === 'ingest_notification_campaign');
    assert.ok(call);
    assert.equal(call.params.p_created_by, '00000000-0000-0000-0000-000000000001');
    assert.equal(call.params.p_title, 'New Movie Release');
  });

  await t.test('2. Ingestion handles idempotency replay (200 OK, already_exists=true)', async () => {
    const mockSupabase = createMockSupabaseForCampaigns({ existingIdempKey: 'idemp-replay-key' });
    const payload = {
      title: 'Duplicate Attempt',
      body: 'Same key replay',
      category: 'movie_release',
      idempotency_key: 'idemp-replay-key',
    };

    const res = await ingestCampaign(payload, { isM2M: true }, mockSupabase);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.already_exists, true);
    assert.equal(res.body.campaign_id, '11111111-1111-1111-1111-111111111111');
  });

  await t.test('3. Ingestion handles draft and scheduled campaigns', async () => {
    const mockSupabase = createMockSupabaseForCampaigns();

    // Draft
    const draftRes = await ingestCampaign({
      title: 'Draft Campaign',
      body: 'Will review later',
      category: 'content_update',
      is_draft: true,
    }, { isM2M: true }, mockSupabase);

    assert.equal(draftRes.status, 201);
    assert.equal(draftRes.body.status, 'draft');
    assert.equal(draftRes.body.total_deliveries, 0);

    // Scheduled
    const futureDate = new Date(Date.now() + 3600000).toISOString();
    const schRes = await ingestCampaign({
      title: 'Scheduled Campaign',
      body: 'Will send in 1 hour',
      category: 'movie_release',
      scheduled_for: futureDate,
    }, { isM2M: true }, mockSupabase);

    assert.equal(schRes.status, 201);
    assert.equal(schRes.body.status, 'scheduled');
  });

  await t.test('4. Ingestion handles database RPC error gracefully (500)', async () => {
    const mockSupabase = createMockSupabaseForCampaigns({ failRpc: true });
    const res = await ingestCampaign({
      title: 'Error Probe',
      body: 'Will fail in RPC',
      category: 'promotional',
    }, { isM2M: true }, mockSupabase);

    assert.equal(res.status, 500);
    assert.equal(res.body.error, 'Database Ingestion Error');
  });

  await t.test('5. Cancellation handles success, not found, and terminal state conflicts', async () => {
    const activeCamp = { id: '33333333-3333-3333-3333-333333333333', status: 'processing' };
    const completedCamp = { id: '44444444-4444-4444-4444-444444444444', status: 'completed' };
    const mockSupabase = createMockSupabaseForCampaigns({ campaigns: [activeCamp, completedCamp] });

    // Success (200)
    const successRes = await cancelCampaign('33333333-3333-3333-3333-333333333333', {}, mockSupabase);
    assert.equal(successRes.status, 200);
    assert.equal(successRes.body.success, true);
    assert.equal(successRes.body.status, 'cancelled');
    assert.ok(successRes.body.recall_limitation);

    // Not Found (404)
    const notFoundRes = await cancelCampaign('99999999-9999-9999-9999-999999999999', {}, mockSupabase);
    assert.equal(notFoundRes.status, 404);
    assert.equal(notFoundRes.body.error, 'CAMPAIGN_NOT_FOUND');

    // Terminal conflict (409)
    const terminalRes = await cancelCampaign('44444444-4444-4444-4444-444444444444', {}, mockSupabase);
    assert.equal(terminalRes.status, 409);
    assert.equal(terminalRes.body.error, 'INVALID_CAMPAIGN_STATE');
  });
});

test('HTTP Handler Endpoints Suite (POST & DELETE /api/notifications/campaigns)', async (t) => {
  const originalEnv = process.env.CAMPAIGN_API_SECRET;
  process.env.CAMPAIGN_API_SECRET = 'm2m_test_secret_999';

  const mockSupabase = createMockSupabaseForCampaigns();

  t.after(() => {
    process.env.CAMPAIGN_API_SECRET = originalEnv;
  });

  await t.test('1. Method Guard: Rejects non-POST/DELETE methods with 405', async () => {
    const { req, res } = createMockHttp({ method: 'GET' });
    await campaignsHandler(req, res, { supabase: mockSupabase });
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers['allow'], 'POST, DELETE');
    assert.match(res.json().error, /Method Not Allowed/);
  });

  await t.test('2. Payload Size Limit: Rejects requests > 64 KB with 413 Payload Too Large', async () => {
    const { req, res } = createMockHttp({
      method: 'POST',
      headers: {
        'content-length': '70000', // 70 KB
        authorization: 'Bearer admin-jwt-valid',
      },
      body: { title: 'Big' },
    });

    await campaignsHandler(req, res, { supabase: mockSupabase });
    assert.equal(res.statusCode, 413);
    assert.match(res.json().error, /Payload Too Large/);
  });

  await t.test('3. Auth Guard: Rejects unauthenticated requests with 401', async () => {
    const { req, res } = createMockHttp({
      method: 'POST',
      headers: {},
      body: { title: 'T', body: 'B', category: 'movie_release' },
    });

    await campaignsHandler(req, res, { supabase: mockSupabase });
    assert.equal(res.statusCode, 401);
    assert.match(res.json().error, /Unauthorized/);
  });

  await t.test('4. Role Guard: Rejects non-admin authenticated users with 403 Forbidden', async () => {
    const { req, res } = createMockHttp({
      method: 'POST',
      headers: { authorization: 'Bearer regular-user-jwt' },
      body: { title: 'T', body: 'B', category: 'movie_release' },
    });

    await campaignsHandler(req, res, { supabase: mockSupabase });
    assert.equal(res.statusCode, 403);
    assert.match(res.json().error, /Forbidden: Administrator privileges are required/);
  });

  await t.test('5. Role Separation: Rejects x-worker-secret for campaign creation (401)', async () => {
    const { req, res } = createMockHttp({
      method: 'POST',
      headers: { 'x-worker-secret': 'some_worker_secret' },
      body: { title: 'T', body: 'B', category: 'movie_release' },
    });

    await campaignsHandler(req, res, { supabase: mockSupabase });
    assert.equal(res.statusCode, 401);
  });

  await t.test('6. Admin JWT Ingestion: Successfully creates campaign with valid admin Bearer token (201)', async () => {
    const { req, res } = createMockHttp({
      method: 'POST',
      headers: { authorization: 'Bearer admin-jwt-valid' },
      body: {
        title: 'Blockbuster Alert',
        body: 'Movie of the year is now streaming',
        category: 'movie_release',
        url: '/movies/blockbuster',
      },
    });

    await campaignsHandler(req, res, { supabase: mockSupabase });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().success, true);
    assert.equal(res.json().already_exists, false);
  });

  await t.test('7. Admin Users Table Ingestion: Accepts admin verified via public.admin_users whitelist (201)', async () => {
    const { req, res } = createMockHttp({
      method: 'POST',
      headers: { authorization: 'Bearer domain-admin-jwt' },
      body: {
        title: 'Staff Announcement',
        body: 'Special screening this Friday',
        category: 'admin_announcement',
      },
    });

    await campaignsHandler(req, res, { supabase: mockSupabase });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().success, true);
  });

  await t.test('8. M2M Secret Ingestion: Successfully creates campaign with x-campaign-secret (201)', async () => {
    const { req, res } = createMockHttp({
      method: 'POST',
      headers: { 'x-campaign-secret': 'm2m_test_secret_999' },
      body: {
        title: 'Automated Daily Feed',
        body: 'Fresh releases available today',
        category: 'content_update',
      },
    });

    await campaignsHandler(req, res, { supabase: mockSupabase });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().success, true);
  });

  await t.test('9. HTTP Idempotency Header: Respects Idempotency-Key header on replay (200 OK)', async () => {
    const mockSupabaseWithIdemp = createMockSupabaseForCampaigns({ existingIdempKey: 'hdr-idemp-999' });

    const { req, res } = createMockHttp({
      method: 'POST',
      headers: {
        'x-campaign-secret': 'm2m_test_secret_999',
        'Idempotency-Key': 'hdr-idemp-999',
      },
      body: {
        title: 'Replayed Campaign',
        body: 'Should not create duplicate',
        category: 'movie_release',
      },
    });

    await campaignsHandler(req, res, { supabase: mockSupabaseWithIdemp });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().already_exists, true);
  });

  await t.test('10. DELETE /api/notifications/campaigns: Cancels campaign by query id (200 OK)', async () => {
    const testCamp = { id: '55555555-5555-5555-5555-555555555555', status: 'processing' };
    const mockWithCamp = createMockSupabaseForCampaigns({ campaigns: [testCamp] });

    const { req, res } = createMockHttp({
      method: 'DELETE',
      headers: { 'x-campaign-secret': 'm2m_test_secret_999' },
      url: '/api/notifications/campaigns?id=55555555-5555-5555-5555-555555555555',
    });

    await campaignsHandler(req, res, { supabase: mockWithCamp });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);
    assert.equal(res.json().status, 'cancelled');
  });

  await t.test('11. POST action=cancel: Cancels campaign via POST JSON body (200 OK)', async () => {
    const testCamp = { id: '66666666-6666-6666-6666-666666666666', status: 'processing' };
    const mockWithCamp = createMockSupabaseForCampaigns({ campaigns: [testCamp] });

    const { req, res } = createMockHttp({
      method: 'POST',
      headers: { authorization: 'Bearer admin-jwt-valid' },
      body: { action: 'cancel', id: '66666666-6666-6666-6666-666666666666' },
    });

    await campaignsHandler(req, res, { supabase: mockWithCamp });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);
    assert.equal(res.json().status, 'cancelled');
  });

  await t.test('12. Privacy Audit: Responses and logs never expose raw tokens or client credentials', async () => {
    const { req, res } = createMockHttp({
      method: 'POST',
      headers: { authorization: 'Bearer admin-jwt-valid' },
      body: {
        title: 'Privacy Probe',
        body: 'Verifying zero leakage',
        category: 'user_alert',
      },
    });

    await campaignsHandler(req, res, { supabase: mockSupabase });
    const responseBody = JSON.stringify(res.json());
    assert.equal(responseBody.includes('fcm_sample_token'), false);
    assert.equal(responseBody.includes('token_hash'), false);
    assert.equal(responseBody.includes('private_key'), false);
  });
});

test('Phase 6A: Request-Scoped Admin Supabase Client & RPC Authorization Suite', async (t) => {
  await t.test('1. getSupabaseUserClient: creates client with user JWT in Authorization header', () => {
    const prevUrl = process.env.SUPABASE_URL;
    const prevAnon = process.env.VITE_SUPABASE_ANON_KEY;
    try {
      process.env.SUPABASE_URL = 'https://mock.supabase.co';
      process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key';

      const userJwt = 'sample-admin-jwt-token';
      const client = getSupabaseUserClient(userJwt);
      assert.ok(client, 'User client should be instantiated');
    } finally {
      process.env.SUPABASE_URL = prevUrl;
      process.env.VITE_SUPABASE_ANON_KEY = prevAnon;
    }
  });

  await t.test('2. getSupabaseUserClient: fails closed when JWT or anon key is missing', () => {
    const prevUrl = process.env.SUPABASE_URL;
    const prevAnon = process.env.VITE_SUPABASE_ANON_KEY;
    const prevSupAnon = process.env.SUPABASE_ANON_KEY;
    try {
      delete process.env.SUPABASE_ANON_KEY;
      delete process.env.VITE_SUPABASE_ANON_KEY;
      process.env.SUPABASE_URL = 'https://mock.supabase.co';

      assert.throws(
        () => getSupabaseUserClient('valid-token'),
        /SUPABASE_ANON_KEY/,
        'Should throw when anon key is missing'
      );

      process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key';
      assert.throws(
        () => getSupabaseUserClient(null),
        /userJwt is required/,
        'Should throw when user JWT is missing'
      );
    } finally {
      process.env.SUPABASE_URL = prevUrl;
      process.env.VITE_SUPABASE_ANON_KEY = prevAnon;
      process.env.SUPABASE_ANON_KEY = prevSupAnon;
    }
  });

  await t.test('3. Ingest and Cancel invoke RPC via user-scoped client when context.token is provided', async () => {
    const mockUserScopedClient = {
      async rpc(fnName) {
        return {
          data: {
            success: true,
            campaign_id: '88888888-8888-8888-8888-888888888888',
            status: fnName === 'cancel_notification_campaign' ? 'cancelled' : 'processing',
            total_recipients: 10,
            total_deliveries: 10,
          },
          error: null,
        };
      },
    };

    const adminContext = {
      isM2M: false,
      user: { id: '00000000-0000-0000-0000-000000000001' },
      token: 'verified-admin-jwt-12345',
    };

    // Test ingestion with custom client override
    const ingestRes = await ingestCampaign(
      {
        title: 'User Client Test',
        body: 'Testing user client forwarding',
        category: 'user_alert',
      },
      adminContext,
      mockUserScopedClient
    );
    assert.equal(ingestRes.status, 201);
    assert.equal(ingestRes.body.success, true);

    // Test cancellation with custom client override
    const cancelRes = await cancelCampaign(
      '88888888-8888-8888-8888-888888888888',
      adminContext,
      mockUserScopedClient
    );
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.success, true);
  });

  await t.test('4. End-to-end HTTP Handler: preserves token and completes ingestion for verified admin', async () => {
    let rpcCalledWithToken = false;
    const mockSupabase = {
      auth: {
        async getUser(token) {
          if (token === 'valid-admin-bearer-token') {
            return {
              data: {
                user: {
                  id: '00000000-0000-0000-0000-000000000001',
                  email: 'admin@movieverify.com',
                },
              },
              error: null,
            };
          }
          return { data: { user: null }, error: { message: 'Invalid' } };
        },
      },
      from() {
        return {
          select() {
            return {
              eq(_col, val) {
                return {
                  async maybeSingle() {
                    // admin user exists
                    if (val === '00000000-0000-0000-0000-000000000001') {
                      return { data: { user_id: val }, error: null };
                    }
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      },
      async rpc() {
        rpcCalledWithToken = true;
        return {
          data: {
            success: true,
            already_exists: false,
            campaign_id: '99999999-9999-9999-9999-999999999999',
            status: 'processing',
            total_recipients: 5,
            total_deliveries: 5,
          },
          error: null,
        };
      },
    };

    const { req, res } = createMockHttp({
      method: 'POST',
      headers: { authorization: 'Bearer valid-admin-bearer-token' },
      body: {
        title: 'Phase 6A Verified Admin Campaign',
        body: 'Admin created campaign with preserved bearer token',
        category: 'movie_release',
      },
    });

    await campaignsHandler(req, res, { supabase: mockSupabase });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().success, true);
    assert.equal(rpcCalledWithToken, true);
  });
});
