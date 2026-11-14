import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import handler, {
  timingSafeCompare,
  checkRateLimit,
  recordFailedAttempt,
  clearRateLimit,
  getClientIp
} from '../../api/site-lock/verify.js';

describe('Site-Lock Verification Suite', () => {
  beforeEach(() => {
    clearRateLimit('127.0.0.1');
    clearRateLimit('192.168.1.100');
  });

  test('timingSafeCompare correctly compares equal and unequal strings in constant time', () => {
    assert.equal(timingSafeCompare('secret123', 'secret123'), true);
    assert.equal(timingSafeCompare('secret123', 'secret124'), false);
    assert.equal(timingSafeCompare('short', 'longer_string'), false);
    assert.equal(timingSafeCompare('', ''), true);
    assert.equal(timingSafeCompare(null, 'secret'), false);
  });

  test('getClientIp parses x-forwarded-for first IP and falls back safely', () => {
    const req1 = { headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18' } };
    assert.equal(getClientIp(req1), '203.0.113.195');

    const req2 = { headers: { 'x-real-ip': '198.51.100.1' } };
    assert.equal(getClientIp(req2), '198.51.100.1');

    const req3 = { headers: {}, socket: { remoteAddress: '10.0.0.1' } };
    assert.equal(getClientIp(req3), '10.0.0.1');
  });

  test('Rate Limiter blocks after 5 failed attempts and resets on clear', () => {
    const ip = '192.168.1.100';
    clearRateLimit(ip);

    assert.equal(checkRateLimit(ip).blocked, false);
    assert.equal(checkRateLimit(ip).remaining, 5);

    // Fail 4 times
    for (let i = 1; i <= 4; i++) {
      const res = recordFailedAttempt(ip);
      assert.equal(res.blocked, false);
      assert.equal(res.remaining, 5 - i);
    }

    // 5th failure triggers block
    const finalFail = recordFailedAttempt(ip);
    assert.equal(finalFail.blocked, true);
    assert.equal(finalFail.remaining, 0);
    assert.ok(finalFail.retryAfterSeconds > 0);

    // Subsequent check reports blocked
    assert.equal(checkRateLimit(ip).blocked, true);

    // Clear rate limit
    clearRateLimit(ip);
    assert.equal(checkRateLimit(ip).blocked, false);
    assert.equal(checkRateLimit(ip).remaining, 5);
  });

  test('Handler rejects non-POST requests with 405', async () => {
    const req = { method: 'GET', headers: {} };
    let status = 0;
    let jsonBody = null;
    const res = {
      setHeader: () => {},
      end: (data) => { jsonBody = JSON.parse(data); },
      set statusCode(val) { status = val; }
    };

    await handler(req, res);
    assert.equal(status, 405);
    assert.ok(jsonBody.error.includes('Method not allowed'));
  });

  test('Handler rejects missing password with 400', async () => {
    const req = { method: 'POST', headers: {}, body: {} };
    let status = 0;
    let jsonBody = null;
    const res = {
      setHeader: () => {},
      end: (data) => { jsonBody = JSON.parse(data); },
      set statusCode(val) { status = val; }
    };

    await handler(req, res);
    assert.equal(status, 400);
    assert.equal(jsonBody.error, 'Access key is required.');
  });

  test('Handler verifies correct password with 200 OK and returns session token', async () => {
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { is_locked: true, lock_password: 'master_super_key_2026' },
              error: null
            })
          })
        })
      })
    };

    const req = {
      method: 'POST',
      headers: { 'x-real-ip': '127.0.0.1' },
      body: { password: 'master_super_key_2026' }
    };

    let status = 0;
    let jsonBody = null;
    const res = {
      setHeader: () => {},
      end: (data) => { jsonBody = JSON.parse(data); },
      set statusCode(val) { status = val; }
    };

    await handler(req, res, mockSupabase);
    assert.equal(status, 200);
    assert.equal(jsonBody.success, true);
    assert.equal(jsonBody.site_locked, true);
    assert.ok(typeof jsonBody.token === 'string' && jsonBody.token.length > 20);
  });

  test('Handler rejects incorrect password with 401 and decrements attempts_remaining', async () => {
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { is_locked: true, lock_password: 'correct_password' },
              error: null
            })
          })
        })
      })
    };

    const req = {
      method: 'POST',
      headers: { 'x-real-ip': '127.0.0.1' },
      body: { password: 'wrong_password' }
    };

    let status = 0;
    let jsonBody = null;
    const res = {
      setHeader: () => {},
      end: (data) => { jsonBody = JSON.parse(data); },
      set statusCode(val) { status = val; }
    };

    await handler(req, res, mockSupabase);
    assert.equal(status, 401);
    assert.equal(jsonBody.error, 'Incorrect access key. Please try again.');
    assert.equal(jsonBody.attempts_remaining, 4);
  });

  test('Handler unlocks immediately if site is not currently locked', async () => {
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { is_locked: false, lock_password: 'unused_password' },
              error: null
            })
          })
        })
      })
    };

    const req = {
      method: 'POST',
      headers: { 'x-real-ip': '127.0.0.1' },
      body: { password: 'any_random_input' }
    };

    let status = 0;
    let jsonBody = null;
    const res = {
      setHeader: () => {},
      end: (data) => { jsonBody = JSON.parse(data); },
      set statusCode(val) { status = val; }
    };

    await handler(req, res, mockSupabase);
    assert.equal(status, 200);
    assert.equal(jsonBody.success, true);
    assert.equal(jsonBody.site_locked, false);
  });

  describe('Admin Site-Lock Management Suite', () => {
    function createMockSupabaseForAdmin({
      user = { id: 'admin-1', email: 'admin@movieverify.com' },
      isAdmin = true,
      initialSettings = { is_locked: false, lock_password: 'initial_password' }
    } = {}) {
      let settings = { ...initialSettings };
      return {
        auth: {
          getUser: async (token) => {
            if (!token || token === 'invalid_token') {
              return { data: { user: null }, error: { message: 'Invalid token' } };
            }
            return { data: { user }, error: null };
          }
        },
        from: (table) => {
          if (table === 'admin_users') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: isAdmin ? { user_id: user.id } : null,
                    error: null
                  })
                })
              })
            };
          }
          if (table === 'site_settings') {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: settings,
                    error: null
                  })
                })
              }),
              update: (payload) => ({
                eq: () => {
                  settings = { ...settings, ...payload };
                  return Promise.resolve({ data: settings, error: null });
                }
              })
            };
          }
          return {};
        }
      };
    }

    test('Admin toggle rejects unauthenticated request with 401', async () => {
      const req = {
        method: 'POST',
        headers: {},
        body: { action: 'toggle', is_locked: true }
      };
      let status = 0;
      let jsonBody = null;
      const res = {
        setHeader: () => {},
        end: (data) => { jsonBody = JSON.parse(data); },
        set statusCode(val) { status = val; }
      };

      const mockSupabase = createMockSupabaseForAdmin();
      await handler(req, res, mockSupabase);
      assert.equal(status, 401);
      assert.ok(jsonBody.error.includes('Authentication required'));
    });

    test('Admin toggle rejects non-admin authenticated user with 403', async () => {
      const req = {
        method: 'POST',
        headers: { authorization: 'Bearer viewer_token' },
        body: { action: 'toggle', is_locked: true }
      };
      let status = 0;
      let jsonBody = null;
      const res = {
        setHeader: () => {},
        end: (data) => { jsonBody = JSON.parse(data); },
        set statusCode(val) { status = val; }
      };

      const mockSupabase = createMockSupabaseForAdmin({ isAdmin: false });
      await handler(req, res, mockSupabase);
      assert.equal(status, 403);
      assert.ok(jsonBody.error.includes('Forbidden'));
    });

    test('Admin toggle successfully locks site with new password via service_role', async () => {
      const req = {
        method: 'POST',
        headers: { authorization: 'Bearer valid_admin_token' },
        body: { action: 'toggle', is_locked: true, lock_password: 'super_secure_key_2026' }
      };
      let status = 0;
      let jsonBody = null;
      const res = {
        setHeader: () => {},
        end: (data) => { jsonBody = JSON.parse(data); },
        set statusCode(val) { status = val; }
      };

      const mockSupabase = createMockSupabaseForAdmin();
      await handler(req, res, mockSupabase);
      assert.equal(status, 200);
      assert.equal(jsonBody.success, true);
      assert.equal(jsonBody.is_locked, true);
      assert.equal(jsonBody.message, 'Site locked successfully.');
    });

    test('Admin toggle rejects locking when no access key is configured or provided', async () => {
      const req = {
        method: 'POST',
        headers: { authorization: 'Bearer valid_admin_token' },
        body: { action: 'toggle', is_locked: true }
      };
      let status = 0;
      let jsonBody = null;
      const res = {
        setHeader: () => {},
        end: (data) => { jsonBody = JSON.parse(data); },
        set statusCode(val) { status = val; }
      };

      const mockSupabase = createMockSupabaseForAdmin({
        initialSettings: { is_locked: false, lock_password: null }
      });
      await handler(req, res, mockSupabase);
      assert.equal(status, 400);
      assert.ok(jsonBody.error.includes('access key'));
    });

    test('Admin toggle successfully unlocks site', async () => {
      const req = {
        method: 'POST',
        headers: { authorization: 'Bearer valid_admin_token' },
        body: { action: 'toggle', is_locked: false }
      };
      let status = 0;
      let jsonBody = null;
      const res = {
        setHeader: () => {},
        end: (data) => { jsonBody = JSON.parse(data); },
        set statusCode(val) { status = val; }
      };

      const mockSupabase = createMockSupabaseForAdmin({ initialSettings: { is_locked: true } });
      await handler(req, res, mockSupabase);
      assert.equal(status, 200);
      assert.equal(jsonBody.success, true);
      assert.equal(jsonBody.is_locked, false);
      assert.equal(jsonBody.message, 'Site unlocked successfully.');
    });

    test('Admin status action retrieves current lock status', async () => {
      const req = {
        method: 'POST',
        headers: { authorization: 'Bearer valid_admin_token' },
        body: { action: 'status' }
      };
      let status = 0;
      let jsonBody = null;
      const res = {
        setHeader: () => {},
        end: (data) => { jsonBody = JSON.parse(data); },
        set statusCode(val) { status = val; }
      };

      const mockSupabase = createMockSupabaseForAdmin({ initialSettings: { is_locked: true, updated_at: '2026-11-13T00:00:00Z' } });
      await handler(req, res, mockSupabase);
      assert.equal(status, 200);
      assert.equal(jsonBody.success, true);
      assert.equal(jsonBody.is_locked, true);
    });

    test('Admin reset action clears access key and unlocks site', async () => {
      const req = {
        method: 'POST',
        headers: { authorization: 'Bearer valid_admin_token' },
        body: { action: 'reset' }
      };
      let status = 0;
      let jsonBody = null;
      const res = {
        setHeader: () => {},
        end: (data) => { jsonBody = JSON.parse(data); },
        set statusCode(val) { status = val; }
      };

      const mockSupabase = createMockSupabaseForAdmin({
        initialSettings: { is_locked: true, lock_password: 'forgotten_secret' }
      });
      await handler(req, res, mockSupabase);
      assert.equal(status, 200);
      assert.equal(jsonBody.success, true);
      assert.equal(jsonBody.is_locked, false);
      assert.equal(jsonBody.has_password, false);
    });
  });
});

