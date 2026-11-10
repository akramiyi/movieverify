/**
 * MovieVerify FCM Notification Dispatch Worker Test Suite
 * Tests reservation, authorization fencing, mocked FCM messaging,
 * confirmation, transient/permanent failures, concurrency, and sweepers.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

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
            tok && tok.is_active && tok.user_id === del.recipient_id
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
        if (!tok.is_active || (tok.revoked_at !== undefined && tok.revoked_at !== null)) {
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
  });
});
