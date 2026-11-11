import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import telemetryHandler from '../../api/notifications/telemetry.js';

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

test('Phase 5.2 Telemetry API - enforces auth, ownership, server-side campaign binding, and metadata hygiene', async () => {
  const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const delA = '11111111-1111-4111-8111-111111111111';
  const delB = '22222222-2222-4222-8222-222222222222';
  const notifA = '33333333-3333-4333-8333-333333333333';
  const campA = '44444444-4444-4444-8444-444444444444';
  const campOther = '55555555-5555-4555-8555-555555555555';

  const rpcCalls = [];

  const mockSupabase = {
    auth: {
      getUser: async () => ({ data: { user: { id: userA } }, error: null }),
    },
    from: (table) => {
      if (table === 'user_notifications') {
        return {
          select: () => ({
            eq: (_col, id) => ({
              maybeSingle: async () => ({
                data: id === notifA ? { id: notifA, user_id: userA, delivery_id: delA, campaign_id: campA } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'notification_deliveries') {
        return {
          select: () => ({
            eq: (_col, id) => ({
              maybeSingle: async () => {
                if (id === delA) {
                  return { data: { id: delA, campaign_id: campA, recipient_type: 'user', recipient_id: userA }, error: null };
                }
                if (id === delB) {
                  return { data: { id: delB, campaign_id: campOther, recipient_type: 'user', recipient_id: userB }, error: null };
                }
                return { data: null, error: null };
              },
            }),
          }),
        };
      }
      return {};
    },
    rpc: async (fnName, params) => {
      rpcCalls.push({ fnName, params });
      return { data: { success: true, recorded: true, telemetry_id: 'tel-1' }, error: null };
    },
  };

  // 1. Unauthenticated -> 401
  const res401 = createMockRes();
  await telemetryHandler({ method: 'POST', headers: {} }, res401);
  assert.equal(res401.statusCode, 401);

  // 2. Spoofed user_id -> 403
  const resSpoofUser = createMockRes();
  await telemetryHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-a' },
      body: { delivery_id: delA, user_id: userB, event_type: 'opened' },
    },
    resSpoofUser,
    { supabase: mockSupabase }
  );
  assert.equal(resSpoofUser.statusCode, 403);

  // 3. Server-only event types rejected -> 400
  const resServerEvent = createMockRes();
  await telemetryHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-a' },
      body: { delivery_id: delA, event_type: 'provider_accepted' },
    },
    resServerEvent,
    { supabase: mockSupabase }
  );
  assert.equal(resServerEvent.statusCode, 400);

  // 4. Other user's delivery rejected -> 403
  const resOtherDelivery = createMockRes();
  await telemetryHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-a' },
      body: { delivery_id: delB, event_type: 'clicked' },
    },
    resOtherDelivery,
    { supabase: mockSupabase }
  );
  assert.equal(resOtherDelivery.statusCode, 403);

  // 5. Mismatched campaign_id rejected -> 403
  const resWrongCamp = createMockRes();
  await telemetryHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-a' },
      body: { delivery_id: delA, campaign_id: campOther, event_type: 'opened' },
    },
    resWrongCamp,
    { supabase: mockSupabase }
  );
  assert.equal(resWrongCamp.statusCode, 403);

  // 6. Oversized metadata (> 4096 bytes) rejected -> 400
  const resBigMeta = createMockRes();
  const largeMeta = {};
  for (let i = 0; i < 12; i += 1) {
    largeMeta[`field_${i}`] = 'x'.repeat(450);
  }
  await telemetryHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-a' },
      body: {
        delivery_id: delA,
        event_type: 'clicked',
        client_metadata: largeMeta,
      },
    },
    resBigMeta,
    { supabase: mockSupabase }
  );
  assert.equal(resBigMeta.statusCode, 400);

  // 7. Valid resolution via notification_id + strips sensitive keys
  const resOk = createMockRes();
  await telemetryHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer jwt-a' },
      body: {
        notification_id: notifA,
        event_type: 'clicked',
        client_metadata: {
          surface: 'notification_center',
          fcm_token: 'SECRET-TOKEN-LEAK',
          authorization: 'Bearer leak',
        },
      },
    },
    resOk,
    { supabase: mockSupabase }
  );
  assert.equal(resOk.statusCode, 200);
  assert.equal(resOk.body.recorded, true);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].params.p_recipient_id, userA);
  assert.equal(rpcCalls[0].params.p_campaign_id, campA);
  assert.deepEqual(rpcCalls[0].params.p_client_metadata, { surface: 'notification_center' });
});

test('Phase 5.2 Client Wiring - App, AdminPanel, NotificationCenter, NotificationPreferences, and CampaignManager', () => {
  const appCode = fs.readFileSync(path.resolve('src/App.jsx'), 'utf-8');
  const adminCode = fs.readFileSync(path.resolve('src/components/AdminPanel.jsx'), 'utf-8');
  const centerCode = fs.readFileSync(path.resolve('src/components/NotificationCenter.jsx'), 'utf-8');
  const prefsCode = fs.readFileSync(path.resolve('src/components/NotificationPreferences.jsx'), 'utf-8');
  const campCode = fs.readFileSync(path.resolve('src/components/CampaignManager.jsx'), 'utf-8');
  const subCode = fs.readFileSync(path.resolve('src/hooks/useSubscriptions.js'), 'utf-8');

  assert.match(appCode, /\/api\/notifications\/welcome/);
  assert.match(appCode, /reportNotificationTelemetry/);
  assert.match(adminCode, /\/api\/notifications\/events/);
  assert.match(centerCode, /reportNotificationTelemetry/);
  assert.match(prefsCode, /channel-email-status/);
  assert.match(campCode, /value:\s*'series'/);
  assert.match(campCode, /value:\s*'season'/);
  assert.match(subCode, /media_type:\s*mediaType/);
});

