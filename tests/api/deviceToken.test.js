/**
 * MovieVerify Device Token API & Service Test Suite
 * Tests authentication enforcement, payload validation, SHA-256 hashing,
 * idempotent upsert, ownership transfer, cross-user revocation rejection, and secrecy.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  hashToken,
  maskToken,
  validateRegistrationPayload,
  registerDeviceToken,
  revokeDeviceToken,
} from '../../api/_lib/deviceTokenService.js';

import registerHandler from '../../api/notifications/register.js';
import revokeHandler from '../../api/notifications/revoke.js';

/**
 * Creates an in-memory mock Supabase client mirroring public.notification_tokens
 */
function createMockSupabase(initialTokens = []) {
  const store = new Map();
  initialTokens.forEach(t => store.set(t.id, { ...t }));

  return {
    _store: store,
    from(tableName) {
      if (tableName !== 'notification_tokens') {
        throw new Error(`Unexpected table ${tableName} in mock`);
      }

      return {
        select() {
          return {
            eq(col, val) {
              return {
                async maybeSingle() {
                  for (const record of store.values()) {
                    if (record[col] === val) {
                      return { data: { ...record }, error: null };
                    }
                  }
                  return { data: null, error: null };
                },
                async single() {
                  for (const record of store.values()) {
                    if (record[col] === val) {
                      return { data: { ...record }, error: null };
                    }
                  }
                  return { data: null, error: { message: 'Row not found', code: 'PGRST116' } };
                },
              };
            },
          };
        },
        insert(record) {
          const id = record.id || `tok-${crypto.randomUUID()}`;
          const newRecord = { ...record, id };
          store.set(id, newRecord);

          return {
            select() {
              return {
                async single() {
                  return { data: { ...newRecord }, error: null };
                },
              };
            },
          };
        },
        update(updates) {
          const filters = [];
          const builder = {
            eq(col, val) {
              filters.push({ col, val });
              return builder;
            },
            select() {
              return {
                async single() {
                  for (const [id, record] of store.entries()) {
                    const match = filters.every(f => record[f.col] === f.val);
                    if (match) {
                      const updated = { ...record, ...updates };
                      store.set(id, updated);
                      return { data: { ...updated }, error: null };
                    }
                  }
                  return { data: null, error: { message: '0 rows updated', code: 'PGRST116' } };
                },
              };
            },
            then(resolve) {
              for (const [id, record] of store.entries()) {
                const match = filters.every(f => record[f.col] === f.val);
                if (match) {
                  const updated = { ...record, ...updates };
                  store.set(id, updated);
                  break;
                }
              }
              return resolve({ data: null, error: null });
            },
          };
          return builder;
        },
      };
    },
    auth: {
      async getUser(token) {
        if (token === 'valid-user-1-jwt') {
          return { data: { user: { id: '00000000-0000-0000-0000-000000000001', email: 'user1@movieverify.com' } }, error: null };
        }
        if (token === 'valid-user-2-jwt') {
          return { data: { user: { id: '00000000-0000-0000-0000-000000000002', email: 'user2@movieverify.com' } }, error: null };
        }
        return { data: { user: null }, error: { message: 'Invalid or expired token' } };
      },
    },
  };
}

/**
 * Creates mock HTTP Request & Response objects
 */
function createMockHttp({ method = 'POST', headers = {}, body = null } = {}) {
  const req = {
    method,
    headers: { ...headers },
    body,
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

test('Device Token Security & Registration Suite', async (t) => {
  const user1 = { id: '00000000-0000-0000-0000-000000000001', email: 'user1@movieverify.com' };
  const user2 = { id: '00000000-0000-0000-0000-000000000002', email: 'user2@movieverify.com' };
  const rawFcmToken = 'fcm_sample_token_alpha_1234567890_abcdefghijklmnopqrstuvwxyz';

  await t.test('1. Hashing: SHA-256 matches exact cryptographic digest', () => {
    const expected = crypto.createHash('sha256').update(rawFcmToken).digest('hex');
    const computed = hashToken(rawFcmToken);
    assert.equal(computed, expected);
    assert.match(computed, /^[a-f0-9]{64}$/);
  });

  await t.test('2. Token Masking: Hides middle of token, prevents raw leak in logs', () => {
    const masked = maskToken(rawFcmToken);
    assert.ok(!masked.includes('abcdefghijklmnopqrstuvwxyz'));
    assert.ok(masked.startsWith('fcm_sa...'));
    assert.ok(masked.endsWith('wxyz'));
  });

  await t.test('3. Payload Validation: Validates device type and token boundaries', () => {
    // Missing token
    assert.equal(validateRegistrationPayload({}).valid, false);
    assert.equal(validateRegistrationPayload({ token: 'short' }).valid, false);

    // Unsupported device_type
    assert.equal(validateRegistrationPayload({ token: rawFcmToken, device_type: 'blackberry' }).valid, false);

    // Supported device_type
    const valid = validateRegistrationPayload({
      token: rawFcmToken,
      device_type: 'web',
      device_name: 'Chrome Windows',
      browser: 'Chrome 120',
      os: 'Windows 11',
    });
    assert.equal(valid.valid, true);
    assert.equal(valid.sanitized.deviceType, 'web');
    assert.equal(valid.sanitized.deviceName, 'Chrome Windows');

    // Enforces database column limits (device_name<=128, browser<=64, os<=64)
    const longUa = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
    const clamped = validateRegistrationPayload({
      token: rawFcmToken,
      device_type: 'web',
      device_name: 'D'.repeat(200),
      browser: longUa,
      os: 'O'.repeat(120),
    });
    assert.equal(clamped.valid, true);
    assert.equal(clamped.sanitized.deviceName.length, 128);
    assert.equal(clamped.sanitized.browser.length, 64);
    assert.equal(clamped.sanitized.os.length, 64);
  });

  await t.test('4. Registration: Creates new token for authenticated user (201 Created)', async () => {
    const mockSupabase = createMockSupabase([]);
    const result = await registerDeviceToken(user1, {
      token: rawFcmToken,
      device_type: 'web',
      device_name: 'Desktop PC',
    }, mockSupabase);

    assert.equal(result.success, true);
    assert.equal(result.status, 201);
    assert.equal(result.data.action, 'created');
    assert.equal(result.data.token_hash, hashToken(rawFcmToken));
    assert.equal(result.data.is_active, true);

    // Verify stored record belongs to authenticated user
    const stored = Array.from(mockSupabase._store.values())[0];
    assert.equal(stored.user_id, user1.id);
    assert.equal(stored.device_type, 'web');
  });

  await t.test('5. Ownership Security: Ignores client-supplied user_id in payload', async () => {
    const mockSupabase = createMockSupabase([]);
    const spoofedUserId = '99999999-9999-9999-9999-999999999999';

    // Attacker sends arbitrary user_id in body
    const result = await registerDeviceToken(user1, {
      token: rawFcmToken,
      user_id: spoofedUserId,
    }, mockSupabase);

    assert.equal(result.success, true);
    const stored = Array.from(mockSupabase._store.values())[0];
    assert.equal(stored.user_id, user1.id, 'User ID must strictly come from authenticated context');
    assert.notEqual(stored.user_id, spoofedUserId);
  });

  await t.test('6. Idempotency: Re-registering existing active token for same user refreshes metadata (200 OK)', async () => {
    const tokenHash = hashToken(rawFcmToken);
    const initialToken = {
      id: 'tok-existing-1',
      user_id: user1.id,
      token: rawFcmToken,
      token_hash: tokenHash,
      device_type: 'web',
      device_name: 'Old Name',
      is_active: true,
      revoked_at: null,
    };

    const mockSupabase = createMockSupabase([initialToken]);
    const result = await registerDeviceToken(user1, {
      token: rawFcmToken,
      device_name: 'New Name',
    }, mockSupabase);

    assert.equal(result.success, true);
    assert.equal(result.status, 200);
    assert.equal(result.data.action, 'refreshed');
    assert.equal(result.data.is_active, true);

    const stored = mockSupabase._store.get('tok-existing-1');
    assert.equal(stored.is_active, true);
    assert.equal(stored.device_name, 'New Name');
  });

  await t.test('6b. Security Guard: Revoked endpoint heartbeat rejected without explicit reauthorization (409 Conflict)', async () => {
    const tokenHash = hashToken(rawFcmToken);
    const initialToken = {
      id: 'tok-revoked-heartbeat',
      user_id: user1.id,
      token: rawFcmToken,
      token_hash: tokenHash,
      device_type: 'web',
      is_active: false,
      revoked_at: '2026-11-10T06:00:00.000Z',
    };

    const mockSupabase = createMockSupabase([initialToken]);
    // Normal registration heartbeat without reauthorize flag
    const result = await registerDeviceToken(user1, {
      token: rawFcmToken,
      device_name: 'Heartbeat Device',
    }, mockSupabase);

    assert.equal(result.success, false);
    assert.equal(result.status, 409);
    assert.equal(result.code, 'TOKEN_REVOKED');
    assert.equal(result.data.is_active, false);
    assert.equal(result.data.requires_reauthorization, true);

    // Endpoint must remain strictly revoked in storage
    const stored = mockSupabase._store.get('tok-revoked-heartbeat');
    assert.equal(stored.is_active, false);
    assert.equal(stored.revoked_at, '2026-11-10T06:00:00.000Z');
  });

  await t.test('6c. Explicit Reauthorization: Successfully reactivates revoked endpoint and clears revoked_at (200 OK)', async () => {
    const tokenHash = hashToken(rawFcmToken);
    const initialToken = {
      id: 'tok-revoked-reauth',
      user_id: user1.id,
      token: rawFcmToken,
      token_hash: tokenHash,
      device_type: 'web',
      is_active: false,
      revoked_at: '2026-11-10T06:00:00.000Z',
    };

    const mockSupabase = createMockSupabase([initialToken]);
    // Explicit reauthorization request with reauthorize: true
    const result = await registerDeviceToken(user1, {
      token: rawFcmToken,
      device_name: 'Reactivated Device',
      reauthorize: true,
    }, mockSupabase);

    assert.equal(result.success, true);
    assert.equal(result.status, 200);
    assert.equal(result.data.action, 'reauthorized');
    assert.equal(result.data.is_active, true);

    // Endpoint must now be active with revoked_at cleanly erased to null
    const stored = mockSupabase._store.get('tok-revoked-reauth');
    assert.equal(stored.is_active, true);
    assert.equal(stored.revoked_at, null);
  });

  await t.test('6d. Concurrency Race: Concurrent revocation blocks registration overwrite (409 Conflict)', async () => {
    const tokenHash = hashToken(rawFcmToken);
    // Initially active in DB
    const initialToken = {
      id: 'tok-race-1',
      user_id: user1.id,
      token: rawFcmToken,
      token_hash: tokenHash,
      device_type: 'web',
      is_active: true,
      revoked_at: null,
    };

    const mockSupabase = createMockSupabase([initialToken]);

    // Simulate concurrent revocation occurring between SELECT and UPDATE:
    // Override select().eq().maybeSingle to trigger a revocation before returning
    const originalFrom = mockSupabase.from.bind(mockSupabase);
    mockSupabase.from = (table) => {
      const q = originalFrom(table);
      if (table === 'notification_tokens') {
        const origSelect = q.select.bind(q);
        q.select = (...args) => {
          const s = origSelect(...args);
          const origEq = s.eq.bind(s);
          s.eq = (col, val) => {
            const e = origEq(col, val);
            const origMaybeSingle = e.maybeSingle.bind(e);
            e.maybeSingle = async () => {
              const res = await origMaybeSingle();
              // Simulating concurrent revoke transaction committing right now:
              mockSupabase._store.get('tok-race-1').is_active = false;
              mockSupabase._store.get('tok-race-1').revoked_at = '2026-11-10T06:30:00.000Z';
              return res;
            };
            return e;
          };
          return s;
        };
      }
      return q;
    };

    // Client attempts normal heartbeat (which read active state earlier)
    const result = await registerDeviceToken(user1, {
      token: rawFcmToken,
    }, mockSupabase);

    assert.equal(result.success, false);
    assert.equal(result.status, 409);
    assert.equal(result.code, 'TOKEN_REVOKED_CONCURRENT');

    // Storage must still reflect the revocation, not overwritten
    const stored = mockSupabase._store.get('tok-race-1');
    assert.equal(stored.is_active, false);
    assert.equal(stored.revoked_at, '2026-11-10T06:30:00.000Z');
  });

  await t.test('7. Token Ownership Transfer: Re-registering token under new user updates owner (200 OK)', async () => {
    const tokenHash = hashToken(rawFcmToken);
    const initialToken = {
      id: 'tok-existing-transfer',
      user_id: user1.id, // Currently owned by User 1
      token: rawFcmToken,
      token_hash: tokenHash,
      device_type: 'web',
      is_active: true,
    };

    const mockSupabase = createMockSupabase([initialToken]);
    // User 2 logs into the same device and registers the FCM token
    const result = await registerDeviceToken(user2, {
      token: rawFcmToken,
    }, mockSupabase);

    assert.equal(result.success, true);
    assert.equal(result.data.action, 'transferred');

    const stored = mockSupabase._store.get('tok-existing-transfer');
    assert.equal(stored.user_id, user2.id, 'Token ownership must cleanly transition to User 2');
  });

  await t.test('8. Revocation: Owner can deactivate device token', async () => {
    const tokenHash = hashToken(rawFcmToken);
    const initialToken = {
      id: 'tok-to-revoke',
      user_id: user1.id,
      token: rawFcmToken,
      token_hash: tokenHash,
      is_active: true,
    };

    const mockSupabase = createMockSupabase([initialToken]);
    const result = await revokeDeviceToken(user1, {
      token: rawFcmToken,
    }, mockSupabase);

    assert.equal(result.success, true);
    assert.equal(result.status, 200);
    assert.equal(result.data.is_active, false);
    assert.equal(result.data.action, 'revoked');

    const stored = mockSupabase._store.get('tok-to-revoke');
    assert.equal(stored.is_active, false);
  });

  await t.test('9. Cross-User Revocation: Blocked with 403 Forbidden', async () => {
    const tokenHash = hashToken(rawFcmToken);
    const initialToken = {
      id: 'tok-user1-protected',
      user_id: user1.id, // Owned by User 1
      token: rawFcmToken,
      token_hash: tokenHash,
      is_active: true,
    };

    const mockSupabase = createMockSupabase([initialToken]);
    // User 2 attempts to revoke User 1's token
    const result = await revokeDeviceToken(user2, {
      token: rawFcmToken,
    }, mockSupabase);

    assert.equal(result.success, false);
    assert.equal(result.status, 403);
    assert.match(result.error, /Forbidden: You do not own this device token/);

    // Verify token was NOT modified
    const stored = mockSupabase._store.get('tok-user1-protected');
    assert.equal(stored.is_active, true);
  });

  await t.test('10. Revocation Idempotency: Already inactive token returns success', async () => {
    const tokenHash = hashToken(rawFcmToken);
    const initialToken = {
      id: 'tok-already-inactive',
      user_id: user1.id,
      token: rawFcmToken,
      token_hash: tokenHash,
      is_active: false,
    };

    const mockSupabase = createMockSupabase([initialToken]);
    const result = await revokeDeviceToken(user1, {
      token_id: 'tok-already-inactive',
    }, mockSupabase);

    assert.equal(result.success, true);
    assert.equal(result.data.is_active, false);
    assert.equal(result.data.action, 'already_inactive');
  });

  await t.test('11. Database Failure Handling: Fails safely on query errors (500)', async () => {
    const brokenSupabase = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: null, error: { message: 'Connection terminated' } };
                  },
                };
              },
            };
          },
        };
      },
    };

    const result = await registerDeviceToken(user1, { token: rawFcmToken }, brokenSupabase);
    assert.equal(result.success, false);
    assert.equal(result.status, 500);
    assert.match(result.error, /Database error querying device token status/);
  });
});

test('HTTP Handler Endpoints Suite (/api/notifications/register & /revoke)', async (t) => {
  const rawFcmToken = 'fcm_sample_token_gamma_9876543210_abcdefghijklmnopqrstuvwxyz';
  const mockSupabase = createMockSupabase([]);

  await t.test('1. POST /api/notifications/register: Rejects non-POST methods (405)', async () => {
    const { req, res } = createMockHttp({ method: 'GET' });
    await registerHandler(req, res, mockSupabase);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers['allow'], 'POST');
    assert.match(res.json().error, /Method not allowed/);
  });

  await t.test('2. POST /api/notifications/register: Rejects unauthenticated requests (401)', async () => {
    const { req, res } = createMockHttp({
      method: 'POST',
      headers: {}, // No Authorization header
      body: { token: rawFcmToken },
    });

    await registerHandler(req, res, mockSupabase);
    assert.equal(res.statusCode, 401);
    assert.match(res.json().error, /Authentication required/);
  });

  await t.test('3. POST /api/notifications/register: Rejects invalid JWT tokens (401)', async () => {
    const { req, res } = createMockHttp({
      method: 'POST',
      headers: { authorization: 'Bearer invalid-expired-jwt' },
      body: { token: rawFcmToken },
    });

    await registerHandler(req, res, mockSupabase);
    assert.equal(res.statusCode, 401);
    assert.match(res.json().error, /Invalid, expired, or revoked/);
  });

  await t.test('4. POST /api/notifications/register: Successfully registers with valid JWT (201)', async () => {
    const { req, res } = createMockHttp({
      method: 'POST',
      headers: { authorization: 'Bearer valid-user-1-jwt' },
      body: { token: rawFcmToken, device_type: 'web', device_name: 'Chrome' },
    });

    await registerHandler(req, res, mockSupabase);
    assert.equal(res.statusCode, 201);
    const json = res.json();
    assert.equal(json.is_active, true);
    assert.equal(json.action, 'created');
    assert.equal(json.token_hash, hashToken(rawFcmToken));
  });

  await t.test('5. POST /api/notifications/revoke: Rejects non-POST/DELETE methods (405)', async () => {
    const { req, res } = createMockHttp({ method: 'PUT' });
    await revokeHandler(req, res, mockSupabase);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers['allow'], 'POST, DELETE');
  });

  await t.test('6. POST /api/notifications/revoke: Rejects unauthenticated requests (401)', async () => {
    const { req, res } = createMockHttp({
      method: 'POST',
      headers: {},
      body: { token: rawFcmToken },
    });

    await revokeHandler(req, res, mockSupabase);
    assert.equal(res.statusCode, 401);
  });

  await t.test('7. POST /api/notifications/revoke: Successfully revokes with valid JWT (200)', async () => {
    const { req, res } = createMockHttp({
      method: 'POST',
      headers: { authorization: 'Bearer valid-user-1-jwt' },
      body: { token: rawFcmToken },
    });

    await revokeHandler(req, res, mockSupabase);
    assert.equal(res.statusCode, 200);
    const json = res.json();
    assert.equal(json.is_active, false);
    assert.equal(json.action, 'revoked');
  });
});

test('Phase 3F: B5E Trigger Security, Role-Gating, and Revocation Remediation Suite', async (t) => {
  /**
   * Exact simulation of PostgreSQL trigger public.trg_compat_notification_tokens_update()
   * as defined in migration 20261111000000_endpoint_revocation_security_remediation.sql
   */
  function simulateTriggerUpdate(baseRecord, updates, callerContext = {}) {
    const isTrustedCaller = callerContext.role === 'service_role' ||
                            callerContext.sessionUser === 'postgres' ||
                            callerContext.isAdmin === true;

    const isCurrentlyRevoked = baseRecord.is_active === false ||
                               baseRecord.revoked_at !== null ||
                               baseRecord.revocation_reason !== null;

    // Ownership transfer check
    const isOwnershipTransfer = updates.user_id !== undefined && updates.user_id !== baseRecord.user_id;
    let finalUserId = baseRecord.user_id;
    if (isOwnershipTransfer) {
      if (!isTrustedCaller) {
        finalUserId = baseRecord.user_id; // Untrusted callers cannot reassign user_id
      } else {
        finalUserId = updates.user_id;
      }
    }

    // Explicit reauthorization check: ONLY trusted service_role can reauthorize
    const explicitReauthorize = isTrustedCaller &&
                                updates.is_active === true &&
                                updates.revoked_at === null &&
                                isCurrentlyRevoked;

    let finalIsActive;
    let finalRevokedAt;
    let finalRevocationReason;

    if (isCurrentlyRevoked) {
      if (explicitReauthorize) {
        finalIsActive = true;
        finalRevokedAt = null;
        finalRevocationReason = null;
      } else {
        // Untrusted caller, silent heartbeat, or un-reauthorized ownership transfer
        finalIsActive = false;
        finalRevokedAt = baseRecord.revoked_at || new Date().toISOString();
        finalRevocationReason = baseRecord.revocation_reason || 'previously_revoked';
      }
    } else {
      if (updates.is_active === false) {
        finalIsActive = false;
        finalRevokedAt = updates.revoked_at || new Date().toISOString();
        finalRevocationReason = baseRecord.revocation_reason || 'user_revoked';
      } else {
        finalIsActive = true;
        finalRevokedAt = null;
        finalRevocationReason = null;
      }
    }

    return {
      ...baseRecord,
      ...updates,
      user_id: finalUserId,
      is_active: finalIsActive,
      revoked_at: finalRevokedAt,
      revocation_reason: finalRevocationReason,
      updated_at: new Date().toISOString(),
    };
  }

  await t.test('GAP-1: Direct PostgREST authenticated view update CANNOT reactivate revoked endpoint', () => {
    const revokedEndpoint = {
      id: 'ep-revoked-001',
      user_id: 'user-alice',
      token: 'token-alice-12345',
      is_active: false,
      revoked_at: '2026-11-08T00:00:07Z',
      revocation_reason: 'fcm_unregistered',
    };

    // Ordinary authenticated user tries direct PostgREST PATCH /rest/v1/notification_tokens
    const directUserUpdate = { is_active: true, revoked_at: null };
    const result = simulateTriggerUpdate(revokedEndpoint, directUserUpdate, { role: 'authenticated' });

    assert.equal(result.is_active, false, 'Endpoint must remain inactive');
    assert.equal(result.revoked_at, '2026-11-08T00:00:07Z', 'Revoked timestamp must be preserved');
    assert.equal(result.revocation_reason, 'fcm_unregistered', 'Revocation reason must be preserved');
  });

  await t.test('GAP-2: Unauthorized direct view caller CANNOT reassign user_id', () => {
    const originalEndpoint = {
      id: 'ep-ownership-001',
      user_id: 'user-legitimate-owner',
      token: 'token-ownership-12345',
      is_active: true,
      revoked_at: null,
      revocation_reason: null,
    };

    // Attacker tries to transfer ownership of their view record to another user
    const directUserUpdate = { user_id: 'user-malicious-target' };
    const result = simulateTriggerUpdate(originalEndpoint, directUserUpdate, { role: 'authenticated' });

    assert.equal(result.user_id, 'user-legitimate-owner', 'user_id reassignment by untrusted caller must be ignored');
  });

  await t.test('GAP-3: Trusted service_role reauthorization atomically clears revoked_at and revocation_reason', () => {
    const revokedEndpoint = {
      id: 'ep-revoked-002',
      user_id: 'user-bob',
      token: 'token-bob-12345',
      is_active: false,
      revoked_at: '2026-11-08T12:00:00Z',
      revocation_reason: 'user_revoked',
    };

    // Trusted server API sends reauthorization update
    const reauthUpdate = { is_active: true, revoked_at: null };
    const result = simulateTriggerUpdate(revokedEndpoint, reauthUpdate, { role: 'service_role' });

    assert.equal(result.is_active, true, 'Endpoint must be reactivated');
    assert.equal(result.revoked_at, null, 'revoked_at must be cleared');
    assert.equal(result.revocation_reason, null, 'revocation_reason must be cleared');
  });

  await t.test('GAP-4: Concurrent heartbeat and revocation preserve revoked state (anti-resurrection)', async () => {
    const baseEndpoint = {
      id: 'ep-concurrency-001',
      user_id: 'user-carol',
      token: 'token-carol-12345',
      is_active: true,
      revoked_at: null,
      revocation_reason: null,
    };

    // Worker revokes endpoint due to terminal failure
    const workerRevocation = simulateTriggerUpdate(
      baseEndpoint,
      { is_active: false, revoked_at: new Date().toISOString() },
      { role: 'service_role' }
    );
    assert.equal(workerRevocation.is_active, false);

    // Concurrent heartbeat attempts to send normal registration (reauthorize: false)
    // Under SELECT ... FOR UPDATE, heartbeat evaluates latest committed row
    const heartbeatResult = simulateTriggerUpdate(
      workerRevocation,
      { is_active: true }, // Heartbeat attempts to keep it active
      { role: 'authenticated' }
    );

    assert.equal(heartbeatResult.is_active, false, 'Heartbeat must NOT reactivate revoked endpoint');
    assert.notEqual(heartbeatResult.revoked_at, null, 'Revocation timestamp must remain intact');
  });

  await t.test('Timestamp-only corrupt endpoint (faa972b2-3cd7-4ed9-bb67-f931ca6a0601) lifecycle', async () => {
    const rawToken = 'fcm_corrupt_test_token_faa972b2_xyz1234567890';
    const tokenHash = hashToken(rawToken);
    const corruptEndpoint = {
      id: 'faa972b2-3cd7-4ed9-bb67-f931ca6a0601',
      user_id: 'user-prod-1',
      token: rawToken,
      token_hash: tokenHash,
      is_active: true,
      revoked_at: '2026-11-08T00:00:07Z',
      revocation_reason: null,
    };

    const mockSupabase = createMockSupabase([corruptEndpoint]);

    // 1. Normal heartbeat / registration without reauthorize=true returns 409 Conflict
    const resNoReauth = await registerDeviceToken(
      { id: 'user-prod-1' },
      { token: rawToken, device_type: 'web', reauthorize: false },
      mockSupabase
    );
    assert.equal(resNoReauth.status, 409);
    assert.equal(resNoReauth.code, 'TOKEN_REVOKED');
    assert.equal(resNoReauth.data.requires_reauthorization, true);

    // 2. Explicit reauthorization with reauthorize=true succeeds
    const resWithReauth = await registerDeviceToken(
      { id: 'user-prod-1' },
      { token: rawToken, device_type: 'web', reauthorize: true },
      mockSupabase
    );
    assert.equal(resWithReauth.status, 200);
    assert.equal(resWithReauth.success, true);
    assert.equal(resWithReauth.data.action, 'reauthorized');
    assert.equal(resWithReauth.data.is_active, true);

    // 3. Database state must be clean
    const inStore = mockSupabase._store.get('faa972b2-3cd7-4ed9-bb67-f931ca6a0601');
    assert.equal(inStore.is_active, true);
    assert.equal(inStore.revoked_at, null);
  });

  await t.test('Ownership transfer of revoked endpoint preserves revoked state until reauthorized', () => {
    const revokedEndpoint = {
      id: 'ep-transfer-001',
      user_id: 'user-old-owner',
      token: 'token-transfer-12345',
      is_active: false,
      revoked_at: '2026-11-08T15:00:00Z',
      revocation_reason: 'user_revoked',
    };

    // Service role transfers ownership to user-new-owner WITHOUT reauthorization
    const transferOnly = simulateTriggerUpdate(
      revokedEndpoint,
      { user_id: 'user-new-owner', is_active: false },
      { role: 'service_role' }
    );
    assert.equal(transferOnly.user_id, 'user-new-owner');
    assert.equal(transferOnly.is_active, false);
    assert.equal(transferOnly.revoked_at, '2026-11-08T15:00:00Z');

    // New owner explicitly reauthorizes
    const reauthorized = simulateTriggerUpdate(
      transferOnly,
      { is_active: true, revoked_at: null },
      { role: 'service_role' }
    );
    assert.equal(reauthorized.user_id, 'user-new-owner');
    assert.equal(reauthorized.is_active, true);
    assert.equal(reauthorized.revoked_at, null);
    assert.equal(reauthorized.revocation_reason, null);
  });
});
