/**
 * MovieVerify FCM Notification Dispatch Worker Test Suite
 * Tests reservation, authorization fencing, mocked FCM messaging,
 * confirmation, transient/permanent failures, concurrency, and sweepers.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  generateWorkerId,
  mapFcmError,
  buildFcmPayload,
  authorizeDispatch,
  processDelivery,
  runDispatchCycle,
  sweepExpiredReservations,
} from '../../api/_lib/dispatchWorker.js';

import dispatchHandler, { isAuthorizedWorker, timingSafeCompare } from '../../api/notifications/dispatch.js';

/**
 * Creates an in-memory mock Supabase client mirroring the notification tables and RPCs
 */
function createMockSupabaseWithRpc(initialState = {}) {
  const deliveries = new Map((initialState.deliveries || []).map(d => [d.id, { ...d }]));
  const tokens = new Map((initialState.tokens || []).map(t => [t.id, { ...t }]));
  const campaigns = new Map((initialState.campaigns || []).map(c => [c.id, { ...c }]));

  return {
    _deliveries: deliveries,
    _tokens: tokens,
    _campaigns: campaigns,
    _rpcCalls: [],
    _confirmFailTimes: initialState.confirmFailTimes || 0,

    from(table) {
      if (table === 'notification_campaigns') {
        return {
          select() {
            return {
              eq(col, val) {
                return {
                  async maybeSingle() {
                    const found = campaigns.get(val);
                    return { data: found ? { ...found } : null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table ${table} in mock`);
    },

    async rpc(fnName, params = {}) {
      this._rpcCalls.push({ fnName, params });

      // 1. reserve_notification_deliveries
      if (fnName === 'reserve_notification_deliveries') {
        const batchSize = params.p_batch_size || 25;
        const workerId = params.p_worker_id;
        const resToken = 'res-token-' + Math.random().toString(36).substring(2, 8);
        const reserved = [];

        for (const del of deliveries.values()) {
          const tok = tokens.get(del.token_id);
          if (
            (del.delivery_status === 'pending' || del.delivery_status === 'reserved') &&
            del.attempt_count < (del.max_attempts || 3) &&
            tok && tok.is_active && !tok.revoked_at && !tok.revocation_reason && tok.user_id === del.recipient_id
          ) {
            del.delivery_status = 'reserved';
            del.worker_id = workerId;
            del.reservation_token = resToken;
            del.attempt_count = (del.attempt_count || 0) + 1;

            reserved.push({
              delivery_id: del.id,
              campaign_id: del.campaign_id,
              recipient_id: del.recipient_id,
              token_id: del.token_id,
              raw_token: tok.token,
              attempt_count: del.attempt_count,
              reservation_token: resToken,
            });

            if (reserved.length >= batchSize) break;
          }
        }
        return { data: reserved, error: null };
      }

      // 2. authorize_notification_delivery_dispatch
      if (fnName === 'authorize_notification_delivery_dispatch') {
        const del = deliveries.get(params.p_delivery_id);
        const tok = tokens.get(params.p_token_id);

        if (!tok) return { data: { authorized: false, reason: 'DISPATCH_REJECTED_TOKEN_NOT_FOUND' }, error: null };
        if (!del) return { data: { authorized: false, reason: 'DISPATCH_REJECTED_DELIVERY_NOT_FOUND' }, error: null };
        if (del.token_id !== params.p_token_id) return { data: { authorized: false, reason: 'DISPATCH_REJECTED_TOKEN_MISMATCH' }, error: null };
        if (del.delivery_status === 'dispatching') return { data: { authorized: false, reason: 'DISPATCH_REJECTED_ALREADY_DISPATCHING' }, error: null };
        if (del.delivery_status !== 'reserved') return { data: { authorized: false, reason: 'DISPATCH_REJECTED_INVALID_STATUS' }, error: null };
        if (del.worker_id !== params.p_worker_id || del.reservation_token !== params.p_reservation_token) {
          return { data: { authorized: false, reason: 'DISPATCH_REJECTED_CREDENTIALS_MISMATCH' }, error: null };
        }
        if (tok.user_id !== params.p_recipient_id) {
          del.delivery_status = 'cancelled';
          del.failure_reason = 'OWNERSHIP_TRANSFERRED';
          return { data: { authorized: false, reason: 'DISPATCH_REJECTED_OWNERSHIP_MISMATCH' }, error: null };
        }
        if (!tok.is_active || (tok.revoked_at !== undefined && tok.revoked_at !== null) || (tok.revocation_reason !== undefined && tok.revocation_reason !== null)) {
          del.delivery_status = 'failed';
          del.failure_reason = 'ENDPOINT_REVOKED_OR_INACTIVE';
          return { data: { authorized: false, reason: 'ENDPOINT_REVOKED_OR_INACTIVE' }, error: null };
        }

        const attemptId = 'attempt-' + Math.random().toString(36).substring(2, 8);
        del.delivery_status = 'dispatching';
        del.current_dispatch_attempt_id = attemptId;

        return {
          data: {
            authorized: true,
            status: 'DISPATCH_AUTHORIZED',
            dispatch_attempt_id: attemptId,
            provider_token: tok.token,
          },
          error: null,
        };
      }

      // 3. confirm_notification_delivery_sent
      if (fnName === 'confirm_notification_delivery_sent') {
        if (this._confirmFailTimes > 0) {
          this._confirmFailTimes--;
          return { data: null, error: new Error('Simulated database connection failure during confirmation') };
        }

        const del = deliveries.get(params.p_delivery_id);
        if (!del) return { data: { success: false, reason: 'DELIVERY_NOT_FOUND' }, error: null };
        if (del.delivery_status !== 'dispatching' || del.current_dispatch_attempt_id !== params.p_dispatch_attempt_id) {
          return { data: { success: false, reason: 'CONFIRMATION_REJECTED_ALREADY_TERMINAL' }, error: null };
        }

        del.delivery_status = 'sent';
        del.fcm_message_id = params.p_fcm_message_id;
        del.current_dispatch_attempt_id = null;
        del.reservation_token = null;

        return { data: { success: true, status: 'SENT' }, error: null };
      }

      // 4. fail_or_retry_notification_delivery
      if (fnName === 'fail_or_retry_notification_delivery') {
        const del = deliveries.get(params.p_delivery_id);
        if (!del) return { data: 'DELIVERY_NOT_FOUND_OR_NOT_ACTIVE', error: null };

        // Must be in reserved or dispatching status to be failed/retried
        if (del.delivery_status !== 'reserved' && del.delivery_status !== 'dispatching') {
          return { data: 'DELIVERY_NOT_FOUND_OR_NOT_ACTIVE', error: null };
        }

        const isPermanent = ['UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH'].includes(params.p_error_code);
        if (params.p_error_code === 'UNREGISTERED' && del.token_id) {
          const tok = tokens.get(del.token_id);
          if (tok) tok.is_active = false;
        }

        if (isPermanent || del.attempt_count >= (del.max_attempts || 3)) {
          del.delivery_status = 'failed';
          del.failure_reason = `${params.p_error_code}: ${params.p_error_message}`;
          return { data: 'failed', error: null };
        }

        del.delivery_status = 'pending';
        del.failure_reason = `${params.p_error_code}: ${params.p_error_message}`;
        del.worker_id = null;
        del.reservation_token = null;
        del.current_dispatch_attempt_id = null;
        return { data: 'pending', error: null };
      }

      // 5. sweep_expired_delivery_reservations
      if (fnName === 'sweep_expired_delivery_reservations') {
        let swept = 0;
        for (const del of deliveries.values()) {
          if (del.delivery_status === 'reserved' || del.delivery_status === 'dispatching') {
            del.delivery_status = 'pending';
            del.worker_id = null;
            del.reservation_token = null;
            del.current_dispatch_attempt_id = null;
            swept++;
          }
        }
        return { data: swept, error: null };
      }

      throw new Error(`Unhandled RPC ${fnName} in mock`);
    },
  };
}

/**
 * Creates a mocked Firebase Messaging service
 */
function createMockMessaging({ sendResult = 'projects/test-mv/messages/msg-12345', shouldFailWith = null } = {}) {
  const sentMessages = [];

  return {
    _sentMessages: sentMessages,
    async send(message) {
      sentMessages.push({ ...message });
      if (shouldFailWith) {
        throw shouldFailWith;
      }
      return sendResult;
    },
  };
}

test('Dispatch Worker Core Unit & Reliability Suite', async (t) => {
  await t.test('1. Worker ID: Generates structured, unique session identifier', () => {
    const id1 = generateWorkerId();
    const id2 = generateWorkerId();
    assert.match(id1, /^worker-/);
    assert.notEqual(id1, id2, 'Each worker ID must be unique');
  });

  await t.test('2. Error Mapping: Correctly maps FCM permanent and transient errors', () => {
    // Permanent: Unregistered token
    const unreg = mapFcmError({ code: 'messaging/registration-token-not-registered', message: 'Token dead' });
    assert.equal(unreg.code, 'UNREGISTERED');
    assert.equal(unreg.permanent, true);

    // Permanent: Invalid argument / token syntax
    const invalid = mapFcmError({ code: 'messaging/invalid-argument', message: 'Malformed' });
    assert.equal(invalid.code, 'INVALID_ARGUMENT');
    assert.equal(invalid.permanent, true);

    // Transient: Quota exceeded
    const quota = mapFcmError({ code: 'messaging/quota-exceeded', message: 'Too many requests' });
    assert.equal(quota.code, 'RESOURCE_EXHAUSTED');
    assert.equal(quota.permanent, false);

    // Transient: Service unavailable
    const unavail = mapFcmError({ code: 'messaging/server-unavailable', message: 'Back off' });
    assert.equal(unavail.code, 'UNAVAILABLE');
    assert.equal(unavail.permanent, false);
  });

  await t.test('3. Payload Builder: Formats title, body, links, and data correctly', () => {
    const delivery = {
      delivery_id: 'del-uuid-1',
      recipient_id: 'user-uuid-1',
      campaign_id: 'camp-uuid-1',
      raw_token: 'raw-fcm-device-token',
    };
    const campaign = {
      title: 'Inception Available',
      body: 'Watch now on MovieVerify',
      category: 'movie_release',
      url: '/?type=movie&id=27205',
      image_url: 'https://image.tmdb.org/t/p/w780/poster.jpg',
    };

    const payload = buildFcmPayload(delivery, campaign);
    assert.equal(payload.token, 'raw-fcm-device-token');
    assert.equal(payload.notification.title, 'Inception Available');
    assert.equal(payload.notification.imageUrl, 'https://image.tmdb.org/t/p/w780/poster.jpg');
    assert.equal(payload.data.delivery_id, 'del-uuid-1');
    assert.equal(payload.data.category, 'movie_release');
    assert.equal(payload.webpush.fcmOptions.link, '/?type=movie&id=27205');
  });

  await t.test('4. Empty Queue: Worker handles zero available deliveries safely', async () => {
    const mockSupabase = createMockSupabaseWithRpc({ deliveries: [], tokens: [] });
    const mockMessaging = createMockMessaging();

    const result = await runDispatchCycle({
      customSupabase: mockSupabase,
      customMessaging: mockMessaging,
    });

    assert.equal(result.processed, 0);
    assert.equal(result.sent, 0);
    assert.equal(result.failed, 0);
    assert.equal(mockMessaging._sentMessages.length, 0);
  });

  await t.test('5. Successful Dispatch: Reserves, Authorizes, Dispatches, and Confirms (Sent)', async () => {
    const mockDelivery = {
      id: 'del-success-1',
      recipient_id: 'user-1',
      token_id: 'tok-1',
      campaign_id: 'camp-1',
      delivery_status: 'pending',
      attempt_count: 0,
      max_attempts: 3,
    };
    const mockToken = {
      id: 'tok-1',
      user_id: 'user-1',
      token: 'raw-sample-fcm-token',
      is_active: true,
    };
    const mockCampaign = {
      id: 'camp-1',
      title: 'New Movie Added',
      body: 'Check out the latest release',
    };

    const mockSupabase = createMockSupabaseWithRpc({
      deliveries: [mockDelivery],
      tokens: [mockToken],
      campaigns: [mockCampaign],
    });
    const mockMessaging = createMockMessaging({ sendResult: 'projects/mv/messages/msg-test-777' });

    const result = await runDispatchCycle({
      customSupabase: mockSupabase,
      customMessaging: mockMessaging,
      batchSize: 10,
    });

    assert.equal(result.processed, 1);
    assert.equal(result.sent, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.results[0].status, 'sent');
    assert.equal(result.results[0].messageId, 'projects/mv/messages/msg-test-777');

    // Verify database record transitioned to 'sent'
    const updated = mockSupabase._deliveries.get('del-success-1');
    assert.equal(updated.delivery_status, 'sent');
    assert.equal(updated.fcm_message_id, 'projects/mv/messages/msg-test-777');
    assert.equal(updated.current_dispatch_attempt_id, null);
  });

  await t.test('6. Pre-Dispatch Fence: Rejects already dispatching deliveries (Duplicate Guard)', async () => {
    const mockDelivery = {
      id: 'del-race-1',
      recipient_id: 'user-1',
      token_id: 'tok-1',
      delivery_status: 'dispatching', // Already in flight
      current_dispatch_attempt_id: 'prior-attempt',
      attempt_count: 1,
      max_attempts: 3,
    };
    const mockToken = { id: 'tok-1', user_id: 'user-1', token: 'raw-token', is_active: true };

    const mockSupabase = createMockSupabaseWithRpc({
      deliveries: [mockDelivery],
      tokens: [mockToken],
    });
    const mockMessaging = createMockMessaging();

    const authRes = await authorizeDispatch(mockSupabase, {
      delivery_id: 'del-race-1',
      token_id: 'tok-1',
      reservation_token: 'dummy',
      recipient_id: 'user-1',
    }, 'worker-1');

    assert.equal(authRes.authorized, false);
    assert.equal(authRes.reason, 'DISPATCH_REJECTED_ALREADY_DISPATCHING');
    assert.equal(mockMessaging._sentMessages.length, 0, 'FCM send must never be invoked');
  });

  await t.test('7. Token Ownership Transfer during pending delivery: Rejects dispatch, cancels delivery', async () => {
    const mockDelivery = {
      id: 'del-transfer-race-1',
      recipient_id: 'user-1', // Delivery originally assigned to User 1
      token_id: 'tok-1',
      delivery_status: 'reserved',
      reservation_token: 'res-1',
      worker_id: 'worker-1',
      attempt_count: 1,
    };
    const mockToken = {
      id: 'tok-1',
      user_id: 'user-2', // Transferred to User 2 before dispatch!
      token: 'raw-token',
      is_active: true,
    };

    const mockSupabase = createMockSupabaseWithRpc({
      deliveries: [mockDelivery],
      tokens: [mockToken],
    });
    const mockMessaging = createMockMessaging();

    const context = {
      supabase: mockSupabase,
      messaging: mockMessaging,
      workerId: 'worker-1',
      campaignCache: new Map(),
    };

    const res = await processDelivery({
      delivery_id: 'del-transfer-race-1',
      token_id: 'tok-1',
      reservation_token: 'res-1',
      recipient_id: 'user-1',
      raw_token: 'raw-token',
    }, context);

    assert.equal(res.status, 'rejected');
    assert.equal(res.reason, 'DISPATCH_REJECTED_OWNERSHIP_MISMATCH');
    assert.equal(mockMessaging._sentMessages.length, 0, 'No notification sent to transferred token');

    const updated = mockSupabase._deliveries.get('del-transfer-race-1');
    assert.equal(updated.delivery_status, 'cancelled');
    assert.equal(updated.failure_reason, 'OWNERSHIP_TRANSFERRED');
  });

  await t.test('7b. Revoked Token Pre-Dispatch: Rejects dispatch when endpoint is revoked, marks delivery failed', async () => {
    const mockDelivery = {
      id: 'del-revoked-1',
      recipient_id: 'user-1',
      token_id: 'tok-revoked',
      delivery_status: 'reserved',
      reservation_token: 'res-revoked-1',
      worker_id: 'worker-1',
      attempt_count: 1,
    };
    const mockToken = {
      id: 'tok-revoked',
      user_id: 'user-1',
      token: 'revoked-token',
      is_active: true, // Suppose it was reactivated or is_active was true
      revoked_at: '2026-11-10T06:00:00.000Z', // But revoked_at is set!
    };

    const mockSupabase = createMockSupabaseWithRpc({
      deliveries: [mockDelivery],
      tokens: [mockToken],
    });
    const mockMessaging = createMockMessaging();

    const context = {
      supabase: mockSupabase,
      messaging: mockMessaging,
      workerId: 'worker-1',
      campaignCache: new Map(),
    };

    const res = await processDelivery({
      delivery_id: 'del-revoked-1',
      token_id: 'tok-revoked',
      reservation_token: 'res-revoked-1',
      recipient_id: 'user-1',
      raw_token: 'revoked-token',
    }, context);

    assert.equal(res.status, 'rejected');
    assert.equal(res.reason, 'ENDPOINT_REVOKED_OR_INACTIVE');
    assert.equal(mockMessaging._sentMessages.length, 0, 'No notification sent to revoked endpoint');

    const updated = mockSupabase._deliveries.get('del-revoked-1');
    assert.equal(updated.delivery_status, 'failed');
    assert.equal(updated.failure_reason, 'ENDPOINT_REVOKED_OR_INACTIVE');
  });

  await t.test('8. Permanent Failure: Unregistered token deactivates token & marks delivery failed', async () => {
    const mockDelivery = {
      id: 'del-unreg-1',
      recipient_id: 'user-1',
      token_id: 'tok-1',
      delivery_status: 'reserved',
      reservation_token: 'res-1',
      worker_id: 'worker-1',
      attempt_count: 1,
      max_attempts: 3,
    };
    const mockToken = { id: 'tok-1', user_id: 'user-1', token: 'dead-token', is_active: true };

    const mockSupabase = createMockSupabaseWithRpc({
      deliveries: [mockDelivery],
      tokens: [mockToken],
    });
    const unregError = new Error('Requested entity was not found.');
    unregError.code = 'messaging/registration-token-not-registered';

    const mockMessaging = createMockMessaging({ shouldFailWith: unregError });

    const context = {
      supabase: mockSupabase,
      messaging: mockMessaging,
      workerId: 'worker-1',
      campaignCache: new Map(),
    };

    const res = await processDelivery({
      delivery_id: 'del-unreg-1',
      token_id: 'tok-1',
      reservation_token: 'res-1',
      recipient_id: 'user-1',
      raw_token: 'dead-token',
    }, context);

    assert.equal(res.status, 'failed');
    assert.equal(res.permanent, true);

    const updatedToken = mockSupabase._tokens.get('tok-1');
    assert.equal(updatedToken.is_active, false, 'Unregistered token must be immediately deactivated');

    const updatedDel = mockSupabase._deliveries.get('del-unreg-1');
    assert.equal(updatedDel.delivery_status, 'failed');
    assert.match(updatedDel.failure_reason, /UNREGISTERED/);
  });

  await t.test('9. Transient Failure & Backoff: Server-unavailable schedules retry', async () => {
    const mockDelivery = {
      id: 'del-transient-1',
      recipient_id: 'user-1',
      token_id: 'tok-1',
      delivery_status: 'reserved',
      reservation_token: 'res-1',
      worker_id: 'worker-1',
      attempt_count: 1,
      max_attempts: 3,
    };
    const mockToken = { id: 'tok-1', user_id: 'user-1', token: 'valid-token', is_active: true };

    const mockSupabase = createMockSupabaseWithRpc({
      deliveries: [mockDelivery],
      tokens: [mockToken],
    });
    const transientError = new Error('Internal server error at Google');
    transientError.code = 'messaging/server-unavailable';

    const mockMessaging = createMockMessaging({ shouldFailWith: transientError });

    const context = {
      supabase: mockSupabase,
      messaging: mockMessaging,
      workerId: 'worker-1',
      campaignCache: new Map(),
    };

    const res = await processDelivery({
      delivery_id: 'del-transient-1',
      token_id: 'tok-1',
      reservation_token: 'res-1',
      recipient_id: 'user-1',
      raw_token: 'valid-token',
    }, context);

    assert.equal(res.status, 'pending');
    assert.equal(res.permanent, false);

    const updatedDel = mockSupabase._deliveries.get('del-transient-1');
    assert.equal(updatedDel.delivery_status, 'pending', 'Transient failure must be returned to pending for retry');
    assert.equal(updatedDel.worker_id, null);
    assert.equal(updatedDel.reservation_token, null);
  });

  await t.test('10. Retry Exhaustion: Exceeding max_attempts transitions delivery to failed', async () => {
    const mockDelivery = {
      id: 'del-exhausted-1',
      recipient_id: 'user-1',
      token_id: 'tok-1',
      delivery_status: 'reserved',
      reservation_token: 'res-1',
      worker_id: 'worker-1',
      attempt_count: 3, // At max attempts!
      max_attempts: 3,
    };
    const mockToken = { id: 'tok-1', user_id: 'user-1', token: 'valid-token', is_active: true };

    const mockSupabase = createMockSupabaseWithRpc({
      deliveries: [mockDelivery],
      tokens: [mockToken],
    });
    const transientError = new Error('Temporary glitch');
    transientError.code = 'messaging/server-unavailable';

    const mockMessaging = createMockMessaging({ shouldFailWith: transientError });

    const context = {
      supabase: mockSupabase,
      messaging: mockMessaging,
      workerId: 'worker-1',
      campaignCache: new Map(),
    };

    const res = await processDelivery({
      delivery_id: 'del-exhausted-1',
      token_id: 'tok-1',
      reservation_token: 'res-1',
      recipient_id: 'user-1',
      raw_token: 'valid-token',
    }, context);

    assert.equal(res.status, 'failed');
    const updatedDel = mockSupabase._deliveries.get('del-exhausted-1');
    assert.equal(updatedDel.delivery_status, 'failed', 'Max attempts exceeded must result in permanent failed status');
  });

  await t.test('11. Sweeper Recovery: Recovers abandoned reservations back to pending', async () => {
    const mockDelivery = {
      id: 'del-abandoned-1',
      recipient_id: 'user-1',
      token_id: 'tok-1',
      delivery_status: 'reserved',
      worker_id: 'dead-crashed-worker',
      reservation_token: 'dead-res-token',
    };

    const mockSupabase = createMockSupabaseWithRpc({
      deliveries: [mockDelivery],
      tokens: [{ id: 'tok-1', user_id: 'user-1', token: 't', is_active: true }],
    });

    const sweptCount = await sweepExpiredReservations(mockSupabase);
    assert.equal(sweptCount, 1);

    const updated = mockSupabase._deliveries.get('del-abandoned-1');
    assert.equal(updated.delivery_status, 'pending');
    assert.equal(updated.worker_id, null);
  });

  await t.test('12. Post-Send Confirmation: Bounded retries succeed on transient database glitch', async () => {
    const mockDelivery = {
      id: 'del-retry-confirm-1',
      recipient_id: 'user-1',
      token_id: 'tok-1',
      delivery_status: 'reserved',
      worker_id: 'worker-1',
      reservation_token: 'res-retry-1',
    };
    const mockToken = { id: 'tok-1', user_id: 'user-1', token: 'valid-token', is_active: true };

    // Fails once on RPC confirmation, then succeeds on retry
    const mockSupabase = createMockSupabaseWithRpc({
      deliveries: [mockDelivery],
      tokens: [mockToken],
      confirmFailTimes: 1,
    });
    const mockMessaging = createMockMessaging();

    const context = {
      supabase: mockSupabase,
      messaging: mockMessaging,
      workerId: 'worker-1',
      campaignCache: new Map(),
    };

    const res = await processDelivery({
      delivery_id: 'del-retry-confirm-1',
      token_id: 'tok-1',
      reservation_token: 'res-retry-1',
      recipient_id: 'user-1',
      raw_token: 'valid-token',
    }, context);

    assert.equal(res.status, 'sent');
    assert.match(res.messageId, /^projects\/.*\/messages\//);
    const updated = mockSupabase._deliveries.get('del-retry-confirm-1');
    assert.equal(updated.delivery_status, 'sent');
    assert.equal(updated.fcm_message_id, res.messageId);
  });

  await t.test('13. Post-Send Confirmation: Retries exhausted marks status as unconfirmed_sent without crashing', async () => {
    const mockDelivery = {
      id: 'del-unconfirmed-1',
      recipient_id: 'user-1',
      token_id: 'tok-1',
      delivery_status: 'reserved',
      worker_id: 'worker-1',
      reservation_token: 'res-unconfirmed-1',
    };
    const mockToken = { id: 'tok-1', user_id: 'user-1', token: 'valid-token', is_active: true };

    // Fails all confirmation retries (confirmFailTimes = 5)
    const mockSupabase = createMockSupabaseWithRpc({
      deliveries: [mockDelivery],
      tokens: [mockToken],
      confirmFailTimes: 5,
    });
    const mockMessaging = createMockMessaging();

    const context = {
      supabase: mockSupabase,
      messaging: mockMessaging,
      workerId: 'worker-1',
      campaignCache: new Map(),
    };

    const res = await processDelivery({
      delivery_id: 'del-unconfirmed-1',
      token_id: 'tok-1',
      reservation_token: 'res-unconfirmed-1',
      recipient_id: 'user-1',
      raw_token: 'valid-token',
    }, context);

    assert.equal(res.status, 'unconfirmed_sent');
    assert.match(res.messageId, /^projects\/.*\/messages\//);
    assert.match(res.warning, /FCM accepted message but database confirmation failed/);

    // In DB, delivery remains in 'dispatching' status with duplicate risk upon lease expiry
    const inDb = mockSupabase._deliveries.get('del-unconfirmed-1');
    assert.equal(inDb.delivery_status, 'dispatching');

    // Run cycle with unconfirmed sent: does not crash, increments sentCount
    const cycleRes = await runDispatchCycle({
      workerId: 'worker-1',
      customSupabase: mockSupabase,
      customMessaging: mockMessaging,
    });
    assert.equal(typeof cycleRes.processed, 'number');
  });

  await t.test('14. Reservation Fencing: Prevents concurrent authorization and mismatched worker claims', async () => {
    const mockDelivery = {
      id: 'del-fence-1',
      recipient_id: 'user-1',
      token_id: 'tok-1',
      delivery_status: 'reserved',
      worker_id: 'worker-owner',
      reservation_token: 'res-token-owner',
    };
    const mockToken = { id: 'tok-1', user_id: 'user-1', token: 'valid-token', is_active: true };

    const mockSupabase = createMockSupabaseWithRpc({
      deliveries: [mockDelivery],
      tokens: [mockToken],
    });

    // Mismatched worker attempt
    const authIntruder = await authorizeDispatch(mockSupabase, {
      delivery_id: 'del-fence-1',
      token_id: 'tok-1',
      reservation_token: 'res-token-owner',
      recipient_id: 'user-1',
    }, 'worker-intruder');

    assert.equal(authIntruder.authorized, false);
    assert.equal(authIntruder.reason, 'DISPATCH_REJECTED_CREDENTIALS_MISMATCH');

    // Valid worker authorises first time
    const authOwner = await authorizeDispatch(mockSupabase, {
      delivery_id: 'del-fence-1',
      token_id: 'tok-1',
      reservation_token: 'res-token-owner',
      recipient_id: 'user-1',
    }, 'worker-owner');

    assert.equal(authOwner.authorized, true);

    // Second authorization attempt while in 'dispatching' state
    const authSecond = await authorizeDispatch(mockSupabase, {
      delivery_id: 'del-fence-1',
      token_id: 'tok-1',
      reservation_token: 'res-token-owner',
      recipient_id: 'user-1',
    }, 'worker-owner');

    assert.equal(authSecond.authorized, false);
    assert.equal(authSecond.reason, 'DISPATCH_REJECTED_ALREADY_DISPATCHING');
  });

  await t.test('15. Retry Idempotency: Duplicate fail/retry calls on inactive deliveries are rejected without mutation', async () => {
    const mockDelivery = {
      id: 'del-idem-1',
      recipient_id: 'user-1',
      token_id: 'tok-1',
      delivery_status: 'reserved',
      worker_id: 'worker-1',
      reservation_token: 'res-idem-1',
      attempt_count: 1,
      max_attempts: 3,
    };
    const mockToken = { id: 'tok-1', user_id: 'user-1', token: 'valid-token', is_active: true };

    const mockSupabase = createMockSupabaseWithRpc({
      deliveries: [mockDelivery],
      tokens: [mockToken],
    });

    // First failure call: transitions delivery to pending
    const res1 = await mockSupabase.rpc('fail_or_retry_notification_delivery', {
      p_delivery_id: 'del-idem-1',
      p_worker_id: 'worker-1',
      p_reservation_token: 'res-idem-1',
      p_error_code: 'UNAVAILABLE',
      p_error_message: 'Service down',
    });
    assert.equal(res1.data, 'pending');

    const inDb = mockSupabase._deliveries.get('del-idem-1');
    assert.equal(inDb.delivery_status, 'pending');

    // Duplicate failure call: delivery is now in 'pending', not reserved or dispatching
    const res2 = await mockSupabase.rpc('fail_or_retry_notification_delivery', {
      p_delivery_id: 'del-idem-1',
      p_worker_id: 'worker-1',
      p_reservation_token: 'res-idem-1',
      p_error_code: 'UNAVAILABLE',
      p_error_message: 'Duplicate call',
    });
    assert.equal(res2.data, 'DELIVERY_NOT_FOUND_OR_NOT_ACTIVE');
    // Ensure attempt count was not mutated
    assert.equal(inDb.attempt_count, 1);
  });
});

test('HTTP Dispatch Endpoint Suite (POST /api/notifications/dispatch)', async (t) => {
  const originalEnv = { ...process.env };

  t.beforeEach(() => {
    process.env.INTERNAL_WORKER_SECRET = 'secret-test-key-xyz';
  });

  t.afterEach(() => {
    process.env = { ...originalEnv };
  });

  function createMockHttp({ method = 'POST', headers = {}, body = null } = {}) {
    const req = { method, headers: { ...headers }, body };
    const res = {
      statusCode: 200,
      headers: {},
      body: '',
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      end(d) { this.body = d; },
      json() { try { return JSON.parse(this.body); } catch { return null; } },
    };
    return { req, res };
  }

  await t.test('1. Rejects non-POST methods with 405 Method Not Allowed', async () => {
    const { req, res } = createMockHttp({ method: 'GET' });
    await dispatchHandler(req, res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers['allow'], 'POST');
  });

  await t.test('2. Rejects unauthorized requests when secret is configured (401)', async () => {
    const { req, res } = createMockHttp({
      method: 'POST',
      headers: { 'x-worker-secret': 'wrong-secret' },
    });
    await dispatchHandler(req, res);
    assert.equal(res.statusCode, 401);
    assert.match(res.json().error, /Valid x-worker-secret header required/);
  });

  await t.test('3. Executes dispatch cycle with valid worker secret (200 OK)', async () => {
    const mockSupabase = createMockSupabaseWithRpc({ deliveries: [], tokens: [] });
    const mockMessaging = createMockMessaging();

    const { req, res } = createMockHttp({
      method: 'POST',
      headers: { 'x-worker-secret': 'secret-test-key-xyz' },
      body: { batch_size: 10, sweep_expired: true },
    });

    await dispatchHandler(req, res, { supabase: mockSupabase, messaging: mockMessaging });

    assert.equal(res.statusCode, 200);
    const json = res.json();
    assert.equal(json.success, true);
    assert.equal(json.processed, 0);
    assert.equal(json.sent, 0);
    assert.equal(typeof json.worker_id, 'string');
  });

  await t.test('4. Rejects query parameter authentication (?secret=)', async () => {
    const { req, res } = createMockHttp({
      method: 'POST',
      headers: {}, // No x-worker-secret header
    });
    req.url = '/api/notifications/dispatch?secret=secret-test-key-xyz';
    req.query = { secret: 'secret-test-key-xyz' };

    await dispatchHandler(req, res);
    assert.equal(res.statusCode, 401);
    assert.match(res.json().error, /Valid x-worker-secret header required/);
  });

  await t.test('5. Rejects alternate headers (Authorization: Bearer and x-cron-secret)', async () => {
    // Attempt via Authorization: Bearer
    const { req: reqAuth, res: resAuth } = createMockHttp({
      method: 'POST',
      headers: { 'authorization': 'Bearer secret-test-key-xyz' },
    });
    await dispatchHandler(reqAuth, resAuth);
    assert.equal(resAuth.statusCode, 401);

    // Attempt via x-cron-secret
    const { req: reqCron, res: resCron } = createMockHttp({
      method: 'POST',
      headers: { 'x-cron-secret': 'secret-test-key-xyz' },
    });
    await dispatchHandler(reqCron, resCron);
    assert.equal(resCron.statusCode, 401);
  });

  await t.test('6. Fails closed when worker secret is not configured in environment', async () => {
    delete process.env.INTERNAL_WORKER_SECRET;
    delete process.env.CRON_SECRET;

    const { req, res } = createMockHttp({
      method: 'POST',
      headers: { 'x-worker-secret': 'secret-test-key-xyz' },
    });

    await dispatchHandler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(isAuthorizedWorker(req.headers), false);
  });

  await t.test('7. Constant-time secret comparison (timingSafeCompare)', () => {
    assert.equal(timingSafeCompare('correct-secret-123', 'correct-secret-123'), true);
    assert.equal(timingSafeCompare('correct-secret-123', 'wrong-secret-456'), false);
    assert.equal(timingSafeCompare('correct-secret-123', 'correct-secret-123-extra'), false);
    assert.equal(timingSafeCompare('', 'correct-secret-123'), false);
    assert.equal(timingSafeCompare('correct-secret-123', ''), false);
    assert.equal(timingSafeCompare(null, 'correct-secret-123'), false);
    assert.equal(timingSafeCompare('correct-secret-123', undefined), false);
    assert.equal(timingSafeCompare(12345, 12345), false);
  });

  await t.test('8. Strict Input Validation: Rejects empty or malformed dispatch requests with 400 (never silent default)', async (st) => {
    const invalidPayloads = [
      { name: 'Empty JSON body ({})', body: {} },
      { name: 'Missing body (null)', body: null },
      { name: 'Missing batch_size', body: { sweep_expired: true } },
      { name: 'Null batch_size', body: { batch_size: null } },
      { name: 'Zero batch_size', body: { batch_size: 0 } },
      { name: 'Negative batch_size', body: { batch_size: -10 } },
      { name: 'Batch size > 100', body: { batch_size: 101 } },
      { name: 'Fractional batch_size', body: { batch_size: 25.5 } },
      { name: 'String batch_size ("25")', body: { batch_size: '25' } },
      { name: 'String batch_size ("abc")', body: { batch_size: 'abc' } },
      { name: 'Boolean batch_size (true)', body: { batch_size: true } },
      { name: 'Array batch_size ([25])', body: { batch_size: [25] } },
      { name: 'Object batch_size ({})', body: { batch_size: { size: 25 } } },
      { name: 'Invalid lease_seconds (< 15)', body: { batch_size: 25, lease_seconds: 10 } },
      { name: 'Invalid lease_seconds (> 300)', body: { batch_size: 25, lease_seconds: 301 } },
      { name: 'String lease_seconds ("60")', body: { batch_size: 25, lease_seconds: '60' } },
      { name: 'Fractional lease_seconds (60.5)', body: { batch_size: 25, lease_seconds: 60.5 } },
      { name: 'String sweep_expired ("true")', body: { batch_size: 25, sweep_expired: 'true' } },
      { name: 'Number sweep_expired (1)', body: { batch_size: 25, sweep_expired: 1 } },
      { name: 'Array sweep_expired ([true])', body: { batch_size: 25, sweep_expired: [true] } },
      { name: 'Null sweep_expired', body: { batch_size: 25, sweep_expired: null } },
    ];

    for (const testCase of invalidPayloads) {
      await st.test(`Rejects ${testCase.name} with 400`, async () => {
        const mockSupabase = createMockSupabaseWithRpc({ deliveries: [], tokens: [] });
        const mockMessaging = createMockMessaging();

        const { req, res } = createMockHttp({
          method: 'POST',
          headers: { 'x-worker-secret': 'secret-test-key-xyz' },
          body: testCase.body,
        });

        await dispatchHandler(req, res, { supabase: mockSupabase, messaging: mockMessaging });

        assert.equal(res.statusCode, 400, `Expected 400 for ${testCase.name}`);
        assert.equal(res.json().error, 'Bad Request');
        assert.equal(mockSupabase._rpcCalls.length, 0, `RPC must NOT be called for ${testCase.name}`);
        assert.equal(mockMessaging._sentMessages.length, 0, `FCM must NOT be called for ${testCase.name}`);
      });
    }

    await st.test('Accepts valid minimum batch_size (1)', async () => {
      const mockSupabase = createMockSupabaseWithRpc({ deliveries: [], tokens: [] });
      const mockMessaging = createMockMessaging();
      const { req, res } = createMockHttp({
        method: 'POST',
        headers: { 'x-worker-secret': 'secret-test-key-xyz' },
        body: { batch_size: 1 },
      });
      await dispatchHandler(req, res, { supabase: mockSupabase, messaging: mockMessaging });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().success, true);
    });

    await st.test('Accepts valid maximum batch_size (100)', async () => {
      const mockSupabase = createMockSupabaseWithRpc({ deliveries: [], tokens: [] });
      const mockMessaging = createMockMessaging();
      const { req, res } = createMockHttp({
        method: 'POST',
        headers: { 'x-worker-secret': 'secret-test-key-xyz' },
        body: { batch_size: 100 },
      });
      await dispatchHandler(req, res, { supabase: mockSupabase, messaging: mockMessaging });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().success, true);
    });

    await st.test('Accepts omitted lease_seconds (defaults to 60s)', async () => {
      const mockSupabase = createMockSupabaseWithRpc({ deliveries: [], tokens: [] });
      const mockMessaging = createMockMessaging();
      const { req, res } = createMockHttp({
        method: 'POST',
        headers: { 'x-worker-secret': 'secret-test-key-xyz' },
        body: { batch_size: 25 },
      });
      await dispatchHandler(req, res, { supabase: mockSupabase, messaging: mockMessaging });
      assert.equal(res.statusCode, 200);
    });

    await st.test('Accepts valid lease_seconds boundaries (15 and 300)', async () => {
      for (const lease of [15, 300]) {
        const mockSupabase = createMockSupabaseWithRpc({ deliveries: [], tokens: [] });
        const mockMessaging = createMockMessaging();
        const { req, res } = createMockHttp({
          method: 'POST',
          headers: { 'x-worker-secret': 'secret-test-key-xyz' },
          body: { batch_size: 25, lease_seconds: lease },
        });
        await dispatchHandler(req, res, { supabase: mockSupabase, messaging: mockMessaging });
        assert.equal(res.statusCode, 200);
      }
    });

    await st.test('Accepts sweep_expired as actual boolean true and false', async () => {
      for (const sweep of [true, false]) {
        const mockSupabase = createMockSupabaseWithRpc({ deliveries: [], tokens: [] });
        const mockMessaging = createMockMessaging();
        const { req, res } = createMockHttp({
          method: 'POST',
          headers: { 'x-worker-secret': 'secret-test-key-xyz' },
          body: { batch_size: 25, sweep_expired: sweep },
        });
        await dispatchHandler(req, res, { supabase: mockSupabase, messaging: mockMessaging });
        assert.equal(res.statusCode, 200);
      }
    });

    await st.test('Accepts valid workflow payload (batch_size: 25, lease_seconds: 60, sweep_expired: true)', async () => {
      const mockSupabase = createMockSupabaseWithRpc({ deliveries: [], tokens: [] });
      const mockMessaging = createMockMessaging();
      const { req, res } = createMockHttp({
        method: 'POST',
        headers: { 'x-worker-secret': 'secret-test-key-xyz' },
        body: { batch_size: 25, lease_seconds: 60, sweep_expired: true },
      });
      await dispatchHandler(req, res, { supabase: mockSupabase, messaging: mockMessaging });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().success, true);
    });

    await st.test('GAP-5: Reason-only corrupt endpoint (revocation_reason is not null) is excluded from reservation and rejected at authorization', async () => {
      const corruptToken = {
        id: 'tok-corrupt-reason-only',
        user_id: 'user-corrupt-1',
        token: 'fcm-corrupt-token-12345',
        is_active: true,
        revoked_at: null,
        revocation_reason: 'fcm_unregistered',
      };
      const delivery = {
        id: 'del-corrupt-1',
        campaign_id: 'camp-1',
        recipient_id: 'user-corrupt-1',
        token_id: 'tok-corrupt-reason-only',
        delivery_status: 'pending',
        attempt_count: 0,
        max_attempts: 3,
      };
      const mockSupabase = createMockSupabaseWithRpc({
        deliveries: [delivery],
        tokens: [corruptToken],
        campaigns: [{ id: 'camp-1', status: 'processing' }],
      });

      // 1. Verification in reserve_notification_deliveries
      const reserveRes = await mockSupabase.rpc('reserve_notification_deliveries', {
        p_worker_id: 'worker-1',
        p_batch_size: 10,
      });
      assert.equal(reserveRes.data.length, 0, 'Reason-only corrupt endpoint must be excluded from reservation');

      // 2. Verification in authorize_notification_delivery_dispatch if manually forced
      const delInMock = mockSupabase._deliveries.get(delivery.id);
      delInMock.delivery_status = 'reserved';
      delInMock.worker_id = 'worker-1';
      delInMock.reservation_token = 'res-token-corrupt';
      const authRes = await mockSupabase.rpc('authorize_notification_delivery_dispatch', {
        p_delivery_id: delivery.id,
        p_token_id: corruptToken.id,
        p_reservation_token: 'res-token-corrupt',
        p_worker_id: 'worker-1',
        p_recipient_id: 'user-corrupt-1',
      });
      assert.equal(authRes.data.authorized, false);
      assert.equal(authRes.data.reason, 'ENDPOINT_REVOKED_OR_INACTIVE');
      assert.equal(delInMock.delivery_status, 'failed');
    });
  });
});

test('Phase 4.28 Option 2 Regression Suite (B5E SQL Static Contract & Mocked Worker Mechanics)', async (t) => {
  const b5ePath = path.resolve('supabase/migrations_superseded/20261111000000_endpoint_revocation_security_remediation.sql');
  const b5eSql = fs.readFileSync(b5ePath, 'utf8');

  function extractSqlBlock(sql, startMarker, endMarker) {
    const startIdx = sql.indexOf(startMarker);
    assert.notEqual(startIdx, -1, `Missing start marker in B5E SQL: ${startMarker}`);
    const endIdx = sql.indexOf(endMarker, startIdx + startMarker.length);
    assert.notEqual(endIdx, -1, `Missing end marker in B5E SQL: ${endMarker}`);
    return sql.slice(startIdx, endIdx);
  }

  await t.test('1. Static Contract + Mocked Interleaving (Revocation-First): FOR UPDATE revocation blocks FOR SHARE authorization and cancels dispatch before FCM', async () => {
    // Note: Real PostgreSQL MVCC lock serialization requires live PostgreSQL runtime;
    // this verifies B5E SQL lock clauses and mocked lock-handoff behavior in Node.
    const triggerSql = extractSqlBlock(
      b5eSql,
      'CREATE OR REPLACE FUNCTION public.trg_compat_notification_tokens_update()',
      '-- 2. Hardened reservation query:'
    );
    const authSql = extractSqlBlock(
      b5eSql,
      'CREATE OR REPLACE FUNCTION public.authorize_notification_delivery_dispatch(',
      '-- 4. Reconcile ALL existing endpoints'
    );

    assert.match(
      triggerSql,
      /FROM\s+public\.notification_endpoints\s+e\s+WHERE\s+e\.id\s*=\s*OLD\.id\s+FOR\s+UPDATE\s*;/is,
      'Revocation trigger must lock endpoint FOR UPDATE'
    );
    assert.match(
      authSql,
      /FROM\s+public\.notification_endpoints\s+WHERE\s+id\s*=\s*v_delivery\.endpoint_id\s+FOR\s+SHARE\s*;/is,
      'authorize_notification_delivery_dispatch must lock endpoint FOR SHARE'
    );

    const campaignLockIdx = authSql.search(/FROM\s+public\.notification_campaigns\s+WHERE\s+id\s*=\s*v_camp_id\s+FOR\s+SHARE\s*;/i);
    const deliveryLockIdx = authSql.search(/FROM\s+public\.notification_deliveries\s+WHERE\s+id\s*=\s*p_delivery_id\s+FOR\s+UPDATE\s*;/i);
    const endpointLockIdx = authSql.search(/FROM\s+public\.notification_endpoints\s+WHERE\s+id\s*=\s*v_delivery\.endpoint_id\s+FOR\s+SHARE\s*;/i);
    assert.ok(campaignLockIdx >= 0 && deliveryLockIdx > campaignLockIdx && endpointLockIdx > deliveryLockIdx,
      'Lock order must remain campaigns (FOR SHARE) -> deliveries (FOR UPDATE) -> endpoints (FOR SHARE)'
    );

    // Mocked lock contention simulation: Revocation holds endpoint lock and commits first
    const endpoint = { id: 'ep-race-1', user_id: 'user-1', is_active: true, revoked_at: null, revocation_reason: null };
    const delivery = { id: 'del-race-rev-first', recipient_id: 'user-1', token_id: 'ep-race-1', delivery_status: 'reserved', reservation_token: 'lease-1', worker_id: 'w-1', dispatch_attempt_id: null };

    let releaseRevocationLock;
    const revocationCommitted = new Promise((resolve) => {
      releaseRevocationLock = resolve;
    });

    const mockSupabase = {
      from() {
        return { select() { return { eq() { return { async maybeSingle() { return { data: null, error: null }; } }; } }; } };
      },
      async rpc(fnName, params) {
        if (fnName === 'authorize_notification_delivery_dispatch') {
          await revocationCommitted; // Blocked behind FOR UPDATE revocation
          if (!endpoint.is_active || endpoint.revoked_at !== null || endpoint.revocation_reason !== null) {
            delivery.delivery_status = 'failed';
            delivery.failure_reason = 'ENDPOINT_REVOKED_OR_INACTIVE';
            return { data: { authorized: false, reason: 'ENDPOINT_REVOKED_OR_INACTIVE' }, error: null };
          }
          return { data: { authorized: true, dispatch_attempt_id: `att-${params.p_delivery_id}`, provider_token: 'raw-tok-1' }, error: null };
        }
        throw new Error(`Unexpected RPC ${fnName}`);
      },
    };
    const mockMessaging = createMockMessaging();

    const workerPromise = processDelivery({
      delivery_id: delivery.id,
      recipient_id: 'user-1',
      token_id: 'ep-race-1',
      reservation_token: 'lease-1',
      raw_token: 'raw-tok-1',
    }, { supabase: mockSupabase, messaging: mockMessaging, workerId: 'w-1', campaignCache: new Map() });

    // Revocation acquires FOR UPDATE first and commits
    endpoint.is_active = false;
    endpoint.revoked_at = '2026-11-11T08:00:00Z';
    endpoint.revocation_reason = 'user_revoked';
    releaseRevocationLock();

    const res = await workerPromise;
    assert.equal(res.status, 'rejected');
    assert.equal(res.reason, 'ENDPOINT_REVOKED_OR_INACTIVE');
    assert.equal(mockMessaging._sentMessages.length, 0, 'Revoked endpoint must never reach FCM');
  });

  await t.test('2. Mocked Interleaving (Authorization-First): Authorization FOR SHARE commits before queued FOR UPDATE revocation and fences downstream confirmation', async () => {
    // Note: Simulated Node concurrency barrier (real MVCC locking is validated in PostgreSQL).
    const endpoint = { id: 'ep-race-2', user_id: 'user-1', is_active: true, revoked_at: null, revocation_reason: null };
    const delivery = { id: 'del-race-auth-first', recipient_id: 'user-1', token_id: 'ep-race-2', delivery_status: 'leased', lease_token: 'lease-2', worker_id: 'w-2', dispatch_attempt_id: null };

    const events = [];
    let releaseShareLock;
    const shareLockReleased = new Promise((resolve) => {
      releaseShareLock = resolve;
    });

    const mockSupabase = {
      from() {
        return { select() { return { eq() { return { async maybeSingle() { return { data: null, error: null }; } }; } }; } };
      },
      async rpc(fnName, params) {
        if (fnName === 'authorize_notification_delivery_dispatch') {
          events.push('auth_acquired_for_share');
          assert.equal(endpoint.is_active, true);
          assert.equal(endpoint.revoked_at, null);
          const attemptId = 'att-locked-first-99';
          delivery.dispatch_attempt_id = attemptId;
          events.push('auth_committed_and_released_share');
          releaseShareLock();
          return { data: { authorized: true, dispatch_attempt_id: attemptId, provider_token: 'raw-tok-2' }, error: null };
        }
        if (fnName === 'confirm_notification_delivery_sent') {
          events.push(`confirm_called_with:${params.p_dispatch_attempt_id}`);
          assert.equal(params.p_dispatch_attempt_id, 'att-locked-first-99');
          if (delivery.delivery_status !== 'leased' || delivery.dispatch_attempt_id !== params.p_dispatch_attempt_id) {
            return { data: { success: false, reason: 'CONFIRMATION_REJECTED_ALREADY_TERMINAL' }, error: null };
          }
          delivery.delivery_status = 'sent';
          delivery.dispatch_attempt_id = null;
          return { data: { success: true, status: 'SENT' }, error: null };
        }
        throw new Error(`Unexpected RPC ${fnName}`);
      },
    };
    const mockMessaging = createMockMessaging();

    const workerPromise = processDelivery({
      delivery_id: delivery.id,
      recipient_id: 'user-1',
      token_id: 'ep-race-2',
      reservation_token: 'lease-2',
      raw_token: 'raw-tok-2',
    }, { supabase: mockSupabase, messaging: mockMessaging, workerId: 'w-2', campaignCache: new Map() });

    const revocationPromise = (async () => {
      await shareLockReleased;
      events.push('revocation_acquired_for_update');
      endpoint.is_active = false;
      endpoint.revoked_at = '2026-11-11T08:00:01Z';
      endpoint.revocation_reason = 'user_revoked';
    })();

    const [workerRes] = await Promise.all([workerPromise, revocationPromise]);
    assert.equal(workerRes.status, 'sent');
    assert.equal(mockMessaging._sentMessages.length, 1);
    assert.equal(events[0], 'auth_acquired_for_share');
    assert.equal(events[1], 'auth_committed_and_released_share');
    assert.ok(events.includes('revocation_acquired_for_update'));
    assert.ok(events.includes('confirm_called_with:att-locked-first-99'));
  });

  await t.test('3. Static Contract + Mock: reserve_notification_deliveries explicitly clears stale dispatch_attempt_id = NULL', async () => {
    const reserveSql = extractSqlBlock(
      b5eSql,
      'CREATE OR REPLACE FUNCTION public.reserve_notification_deliveries(',
      '-- 3. Hardened dispatch authorization:'
    );
    assert.match(
      reserveSql,
      /UPDATE\s+public\.notification_deliveries\s+d[\s\S]*?dispatch_attempt_id\s*=\s*NULL/is,
      'B5E reserve_notification_deliveries UPDATE SET must explicitly clear dispatch_attempt_id = NULL'
    );

    // Mocked swept delivery still carrying stale dispatch_attempt_id before re-reservation
    const sweptDelivery = {
      id: 'del-swept-stale',
      recipient_id: 'user-1',
      token_id: 'tok-active',
      delivery_status: 'pending',
      dispatch_attempt_id: 'stale-attempt-before-sweep',
      attempt_count: 1,
      max_attempts: 3,
    };

    // Simulate B5E reserve_notification_deliveries UPDATE SET semantics
    const reserveB5EAligned = (del, workerId) => {
      del.delivery_status = 'leased';
      del.lease_token = 'fresh-lease-1';
      del.worker_id = workerId;
      del.dispatch_attempt_id = null; // Must match B5E SQL explicit reset
    };

    reserveB5EAligned(sweptDelivery, 'worker-recover');
    assert.equal(sweptDelivery.delivery_status, 'leased');
    assert.equal(sweptDelivery.dispatch_attempt_id, null, 'Re-reserved delivery must have dispatch_attempt_id cleared to null');
  });

  await t.test('4. Worker Fencing: Campaign lookup DB error or exception aborts before authorizeDispatch and never calls FCM', async () => {
    const scenarios = [
      {
        name: 'Supabase error object',
        fromImpl: () => ({
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: null, error: { message: 'Campaign table read timeout' } };
                  },
                };
              },
            };
          },
        }),
      },
      {
        name: 'Thrown network exception',
        fromImpl: () => ({
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    throw new Error('ECONNRESET while fetching campaign');
                  },
                };
              },
            };
          },
        }),
      },
    ];

    for (const scenario of scenarios) {
      const rpcCalls = [];
      const mockSupabase = {
        from(table) {
          assert.equal(table, 'notification_campaigns');
          return scenario.fromImpl();
        },
        async rpc(fnName, params) {
          rpcCalls.push({ fnName, params });
          if (fnName === 'fail_or_retry_notification_delivery') {
            return { data: 'pending', error: null };
          }
          throw new Error(`Unexpected RPC ${fnName} when campaign lookup fails (${scenario.name})`);
        },
      };
      const mockMessaging = createMockMessaging();

      const res = await processDelivery({
        delivery_id: 'del-camp-fail-1',
        campaign_id: 'camp-failing-1',
        recipient_id: 'user-1',
        token_id: 'tok-1',
        reservation_token: 'lease-camp-fail',
        raw_token: 'raw-tok-camp-fail',
      }, {
        supabase: mockSupabase,
        messaging: mockMessaging,
        workerId: 'worker-camp-fail',
        campaignCache: new Map(),
      });

      assert.equal(res.status, 'pending');
      assert.equal(res.reason, 'CAMPAIGN_LOOKUP_FAILED');
      assert.equal(mockMessaging._sentMessages.length, 0, `FCM must not run on ${scenario.name}`);
      assert.equal(
        rpcCalls.some(c => c.fnName === 'authorize_notification_delivery_dispatch'),
        false,
        `authorize_notification_delivery_dispatch must NEVER be called when campaign lookup fails (${scenario.name})`
      );
      assert.equal(rpcCalls.length, 1);
      assert.equal(rpcCalls[0].fnName, 'fail_or_retry_notification_delivery');
      assert.equal(rpcCalls[0].params.p_error_code, 'CAMPAIGN_LOOKUP_FAILED');
    }
  });

  await t.test('5 & 6. Call Ordering + Exact Attempt ID Confirmation: Fetches campaign BEFORE authorization, calls FCM, and confirms with exact dispatch_attempt_id', async () => {
    const callOrder = [];
    const exactAttemptId = 'attempt-exact-uuid-428';
    let confirmedAttemptId = null;

    const mockSupabase = {
      from(table) {
        assert.equal(table, 'notification_campaigns');
        return {
          select() {
            return {
              eq(col, val) {
                assert.equal(col, 'id');
                assert.equal(val, 'camp-order-1');
                return {
                  async maybeSingle() {
                    callOrder.push('campaign_lookup');
                    return {
                      data: { id: 'camp-order-1', title: 'Premiere Alert', body: 'Watch now', category: 'release', url: '/movies/tt1234567' },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      },
      async rpc(fnName, params) {
        if (fnName === 'authorize_notification_delivery_dispatch') {
          callOrder.push('authorize_dispatch');
          return { data: { authorized: true, dispatch_attempt_id: exactAttemptId, provider_token: 'raw-tok-order-1' }, error: null };
        }
        if (fnName === 'confirm_notification_delivery_sent') {
          callOrder.push('confirm_sent');
          confirmedAttemptId = params.p_dispatch_attempt_id;
          return { data: { success: true, status: 'SENT' }, error: null };
        }
        throw new Error(`Unexpected RPC ${fnName}`);
      },
    };

    const mockMessaging = {
      _sentMessages: [],
      async send(msg) {
        callOrder.push('fcm_send');
        this._sentMessages.push(msg);
        return 'projects/mv/messages/order-check-1';
      },
    };

    const res = await processDelivery({
      delivery_id: 'del-order-1',
      campaign_id: 'camp-order-1',
      recipient_id: 'user-1',
      token_id: 'tok-order-1',
      reservation_token: 'lease-order-1',
      raw_token: 'raw-tok-order-1',
    }, {
      supabase: mockSupabase,
      messaging: mockMessaging,
      workerId: 'worker-order',
      campaignCache: new Map(),
    });

    assert.equal(res.status, 'sent');
    assert.deepEqual(callOrder, ['campaign_lookup', 'authorize_dispatch', 'fcm_send', 'confirm_sent']);
    assert.equal(mockMessaging._sentMessages.length, 1);
    assert.equal(mockMessaging._sentMessages[0].notification.title, 'Premiere Alert');
    assert.equal(confirmedAttemptId, exactAttemptId, 'Confirmation must use the exact dispatch_attempt_id minted by authorization');
  });

  await t.test('7. Confirmation Fencing: Stale dispatch_attempt_id confirmation remains rejected', async () => {
    const delivery = {
      id: 'del-stale-confirm',
      recipient_id: 'user-1',
      token_id: 'tok-1',
      delivery_status: 'dispatching',
      current_dispatch_attempt_id: 'current-attempt-new',
    };
    const mockSupabase = createMockSupabaseWithRpc({
      deliveries: [delivery],
      tokens: [{ id: 'tok-1', user_id: 'user-1', token: 'tok', is_active: true }],
    });

    const res = await mockSupabase.rpc('confirm_notification_delivery_sent', {
      p_delivery_id: 'del-stale-confirm',
      p_dispatch_attempt_id: 'stale-attempt-old',
      p_fcm_message_id: 'projects/mv/messages/late-confirm',
    });

    assert.equal(res.error, null);
    assert.equal(res.data.success, false);
    assert.equal(res.data.reason, 'CONFIRMATION_REJECTED_ALREADY_TERMINAL');
    assert.equal(mockSupabase._deliveries.get('del-stale-confirm').delivery_status, 'dispatching');
    assert.equal(mockSupabase._deliveries.get('del-stale-confirm').current_dispatch_attempt_id, 'current-attempt-new');
  });

  await t.test('8. Phase 5.9.5 Worker Contract: Rejects provider_token mismatch/missing, uses authorized provider_token & stringifies guest recipient_id', async () => {
    // A. Guest recipient_id: null -> '' safe string in FCM data map
    const guestPayload = buildFcmPayload({
      delivery_id: 'del-guest-1',
      campaign_id: null,
      recipient_id: null,
      raw_token: 'guest-tok-valid-123456',
    }, { title: 'Guest Alert', body: 'Watch now', category: 'system', url: '/' });
    assert.equal(guestPayload.data.recipient_id, '');
    assert.equal(guestPayload.data.campaign_id, '');
    assert.equal(typeof guestPayload.data.recipient_id, 'string');

    // B. Mismatched authResult.provider_token rejects before calling FCM
    const rpcCallsMismatch = [];
    const mockMessagingMismatch = createMockMessaging();
    const mismatchRes = await processDelivery({
      delivery_id: 'del-tok-mismatch',
      campaign_id: null,
      recipient_id: 'user-1',
      token_id: 'tok-1',
      reservation_token: 'lease-m1',
      raw_token: 'reserved-token-A',
    }, {
      workerId: 'w-tok-1',
      campaignCache: new Map(),
      messaging: mockMessagingMismatch,
      supabase: {
        async rpc(fnName, params) {
          rpcCallsMismatch.push({ fnName, params });
          if (fnName === 'authorize_notification_delivery_dispatch') {
            return { data: { authorized: true, dispatch_attempt_id: 'att-m1', provider_token: 'authorized-token-B' }, error: null };
          }
          if (fnName === 'fail_or_retry_notification_delivery') {
            return { data: 'failed', error: null };
          }
          throw new Error(`Unexpected RPC ${fnName}`);
        },
      },
    });
    assert.equal(mismatchRes.status, 'rejected');
    assert.equal(mismatchRes.reason, 'PROVIDER_TOKEN_MISMATCH');
    assert.equal(mockMessagingMismatch._sentMessages.length, 0);
    assert.equal(rpcCallsMismatch.some((c) => c.fnName === 'fail_or_retry_notification_delivery' && c.params.p_error_code === 'PROVIDER_TOKEN_MISMATCH'), true);

    // C. Missing authResult.provider_token rejects fail-closed before calling FCM
    const mockMessagingMissing = createMockMessaging();
    const missingRes = await processDelivery({
      delivery_id: 'del-tok-missing',
      campaign_id: null,
      recipient_id: 'user-1',
      token_id: 'tok-1',
      reservation_token: 'lease-m2',
      raw_token: 'reserved-token-A',
    }, {
      workerId: 'w-tok-2',
      campaignCache: new Map(),
      messaging: mockMessagingMissing,
      supabase: {
        async rpc(fnName) {
          if (fnName === 'authorize_notification_delivery_dispatch') {
            return { data: { authorized: true, dispatch_attempt_id: 'att-m2' }, error: null };
          }
          if (fnName === 'fail_or_retry_notification_delivery') {
            return { data: 'failed', error: null };
          }
          throw new Error(`Unexpected RPC ${fnName}`);
        },
      },
    });
    assert.equal(missingRes.status, 'rejected');
    assert.equal(missingRes.reason, 'PROVIDER_TOKEN_MISMATCH');
    assert.equal(mockMessagingMissing._sentMessages.length, 0);

    // D. Uninstalled promote_due_scheduled_campaigns (PGRST202) degrades to HTTP 200 in standalone B5D/B5E
    const prevSecret = process.env.INTERNAL_WORKER_SECRET;
    process.env.INTERNAL_WORKER_SECRET = 'test-secret-595';
    try {
      const res = {
        statusCode: 200,
        headers: {},
        body: '',
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
        end(d) { this.body = d; },
      };
      await dispatchHandler(
        { method: 'POST', headers: { 'x-worker-secret': 'test-secret-595' }, body: { batch_size: 10, sweep_expired: false } },
        res,
        {
          supabase: {
            async rpc(fnName) {
              if (fnName === 'promote_due_scheduled_campaigns') {
                return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.promote_due_scheduled_campaigns(p_limit) in the schema cache' } };
              }
              if (fnName === 'reserve_notification_deliveries') {
                return { data: [], error: null };
              }
              return { data: null, error: null };
            },
          },
          messaging: createMockMessaging(),
        }
      );
      const parsedBody = JSON.parse(res.body);
      assert.equal(res.statusCode, 200);
      assert.equal(parsedBody.success, true);
      assert.equal(parsedBody.scheduled_promotion_skipped, true);
    } finally {
      if (prevSecret === undefined) delete process.env.INTERNAL_WORKER_SECRET;
      else process.env.INTERNAL_WORKER_SECRET = prevSecret;
    }
  });
});
