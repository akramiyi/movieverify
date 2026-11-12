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
});
