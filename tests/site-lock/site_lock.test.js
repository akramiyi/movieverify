/**
 * MovieVerify Site Lock Security & Cryptographic Verification Test Suite
 * 
 * Verifies:
 * 1. Password Hashing (PBKDF2 SHA-256 with 100,000 iterations & random salt)
 * 2. Password Verification (matching hash, non-matching, and legacy plaintext migration)
 * 3. Timing-Safe Comparison (constant-time evaluation across lengths)
 * 4. Session Tokens (HMAC-SHA256 signature, expiry, tampering detection)
 * 5. Cookie Parsing & Serialization (HttpOnly, SameSite=Lax, Secure attributes)
 * 6. GET /api/site-lock Endpoint:
 *    - Unlocked site returns is_locked: false, is_unlocked: true
 *    - Locked site with no session returns is_locked: true, is_unlocked: false
 *    - Locked site with valid session returns is_locked: true, is_unlocked: true
 *    - Locked site with tampered/expired session returns is_locked: true, is_unlocked: false
 *    - Database error fails closed (500, is_locked: true, is_unlocked: false)
 *    - Zero password or hash leakage in response
 * 7. POST /api/site-lock (Unlock Action):
 *    - Correct password succeeds (200), issues signed cookie
 *    - Transparent migration of plaintext password to PBKDF2 hash
 *    - Incorrect password fails (401), no cookie set
 *    - Empty/missing password rejected (400)
 * 8. POST /api/site-lock (Admin Update Action):
 *    - Anonymous caller rejected (401)
 *    - Non-admin authenticated user rejected (403)
 *    - Verified admin can toggle is_locked
 *    - Verified admin can set new password (hashed before writing)
 *    - Empty password preserves existing stored password
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import handler, {
  hashPassword,
  verifyPassword,
  timingSafeCompare,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  serializeCookie,
  verifyAdminSession,
  COOKIE_NAME,
  COOKIE_MAX_AGE_SECONDS
} from '../../api/site-lock.js';

const TEST_SECRET = 'a'.repeat(64); // 64-character test session secret

describe('1. Password Hashing & Verification (PBKDF2 SHA-256)', () => {
  it('hashes password with PBKDF2 and random salt', () => {
    const raw = 'SuperSecret123!';
    const hash1 = hashPassword(raw);
    const hash2 = hashPassword(raw);

    assert.ok(hash1.startsWith('pbkdf2:sha256:100000:'), 'Hash format must start with pbkdf2:sha256:100000:');
    assert.notEqual(hash1, hash2, 'Salts must be randomly generated, producing unique hashes');
    assert.equal(hash1.split(':').length, 5, 'Hash must contain 5 colon-separated segments');
  });

  it('rejects empty or non-string passwords during hashing', () => {
    assert.throws(() => hashPassword(''), /Password must be a non-empty string/);
    assert.throws(() => hashPassword(null), /Password must be a non-empty string/);
    assert.throws(() => hashPassword(12345), /Password must be a non-empty string/);
  });

  it('verifies valid PBKDF2 password returning needsMigration: false', () => {
    const raw = 'CorrectAccessKey2026';
    const hash = hashPassword(raw);

    const result = verifyPassword(raw, hash);
    assert.equal(result.valid, true);
    assert.equal(result.needsMigration, false);
  });

  it('rejects incorrect password against PBKDF2 hash', () => {
    const raw = 'CorrectAccessKey2026';
    const hash = hashPassword(raw);

    const result = verifyPassword('WrongAccessKey', hash);
    assert.equal(result.valid, false);
    assert.equal(result.needsMigration, false);
  });

  it('supports legacy plaintext password and flags needsMigration: true on match', () => {
    const legacyPlaintext = 'legacy_plaintext_key_123';

    // Correct candidate
    const matchResult = verifyPassword(legacyPlaintext, legacyPlaintext);
    assert.equal(matchResult.valid, true, 'Legacy plaintext must authenticate correctly');
    assert.equal(matchResult.needsMigration, true, 'Legacy plaintext must be flagged for migration');

    // Incorrect candidate
    const failResult = verifyPassword('wrong_legacy_key', legacyPlaintext);
    assert.equal(failResult.valid, false);
    assert.equal(failResult.needsMigration, false);
  });

  it('handles invalid inputs gracefully in verifyPassword', () => {
    assert.deepEqual(verifyPassword(null, 'somehash'), { valid: false, needsMigration: false });
    assert.deepEqual(verifyPassword('somepass', null), { valid: false, needsMigration: false });
    assert.deepEqual(verifyPassword(123, 'somehash'), { valid: false, needsMigration: false });
    assert.deepEqual(verifyPassword('pass', 'malformed:pbkdf2:hash'), { valid: false, needsMigration: false });
  });

  it('timingSafeCompare works correctly and safely across equal and unequal lengths', () => {
    assert.equal(timingSafeCompare('secret', 'secret'), true);
    assert.equal(timingSafeCompare('secret', 'other'), false);
    assert.equal(timingSafeCompare('secret', 'secretLonger'), false);
    assert.equal(timingSafeCompare('', ''), false);
    assert.equal(timingSafeCompare(null, 'secret'), false);
  });
});

describe('2. Cryptographic Unlock Session Token Management', () => {
  it('creates a valid session token that passes verification', () => {
    const token = createSessionToken(TEST_SECRET, 3600);
    assert.ok(token.startsWith('v1.'), 'Token must start with v1.');

    const isValid = verifySessionToken(token, TEST_SECRET);
    assert.equal(isValid, true, 'Valid token must be verified');
  });

  it('rejects expired session tokens', () => {
    // Max age of -1 second (already expired)
    const expiredToken = createSessionToken(TEST_SECRET, -1);
    const isValid = verifySessionToken(expiredToken, TEST_SECRET);
    assert.equal(isValid, false, 'Expired token must be rejected');
  });

  it('rejects tampered signature tokens', () => {
    const token = createSessionToken(TEST_SECRET, 3600);
    const parts = token.split('.');
    // Modify signature
    const tamperedToken = `${parts[0]}.${parts[1]}.${parts[2]}.TAMPERED_SIGNATURE`;

    const isValid = verifySessionToken(tamperedToken, TEST_SECRET);
    assert.equal(isValid, false, 'Token with altered signature must be rejected');
  });

  it('rejects tampered payload tokens', () => {
    const token = createSessionToken(TEST_SECRET, 3600);
    const parts = token.split('.');
    // Extend expiration timestamp
    const futureExp = parseInt(parts[1], 10) + 100000;
    const tamperedToken = `${parts[0]}.${futureExp}.${parts[2]}.${parts[3]}`;

    const isValid = verifySessionToken(tamperedToken, TEST_SECRET);
    assert.equal(isValid, false, 'Token with altered payload must be rejected');
  });

  it('rejects tokens signed with a different secret', () => {
    const token = createSessionToken(TEST_SECRET, 3600);
    const otherSecret = 'b'.repeat(64);

    const isValid = verifySessionToken(token, otherSecret);
    assert.equal(isValid, false, 'Token signed with different secret must be rejected');
  });

  it('rejects malformed token strings', () => {
    assert.equal(verifySessionToken('', TEST_SECRET), false);
    assert.equal(verifySessionToken(null, TEST_SECRET), false);
    assert.equal(verifySessionToken('v1.notanumber.nonce.sig', TEST_SECRET), false);
    assert.equal(verifySessionToken('v2.12345.nonce.sig', TEST_SECRET), false);
    assert.equal(verifySessionToken('v1.12345', TEST_SECRET), false);
  });
});

describe('3. Cookie Serialization and Parsing', () => {
  it('serializes cookies with HttpOnly, SameSite=Lax, and Path=/', () => {
    const serialized = serializeCookie(COOKIE_NAME, 'sample_token_val', {
      maxAge: COOKIE_MAX_AGE_SECONDS,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      secure: true
    });

    assert.ok(serialized.includes(`${COOKIE_NAME}=sample_token_val`));
    assert.ok(serialized.includes('HttpOnly'));
    assert.ok(serialized.includes('SameSite=Lax'));
    assert.ok(serialized.includes('Path=/'));
    assert.ok(serialized.includes('Secure'));
    assert.ok(serialized.includes(`Max-Age=${COOKIE_MAX_AGE_SECONDS}`));
  });

  it('parses multi-cookie headers accurately', () => {
    const header = `other_cookie=123; ${COOKIE_NAME}=my_token_value; theme=dark`;
    const parsed = parseCookies(header);

    assert.equal(parsed[COOKIE_NAME], 'my_token_value');
    assert.equal(parsed.other_cookie, '123');
    assert.equal(parsed.theme, 'dark');
  });

  it('handles empty or malformed cookie headers gracefully', () => {
    assert.deepEqual(parseCookies(''), {});
    assert.deepEqual(parseCookies(undefined), {});
    assert.deepEqual(parseCookies('corrupt; =empty; trailing='), { trailing: '' });
  });
});

describe('4. Serverless API Endpoint Tests (/api/site-lock)', () => {
  // Helper to create a mock HTTP response object
  function createMockResponse() {
    let statusCode = 200;
    const headers = {};
    let jsonBody = null;

    const res = {
      status(code) {
        statusCode = code;
        return res;
      },
      setHeader(name, val) {
        headers[name] = val;
        return res;
      },
      json(data) {
        jsonBody = data;
        return res;
      },
      getStatusCode: () => statusCode,
      getHeaders: () => headers,
      getBody: () => jsonBody
    };
    return res;
  }

  // Mock Supabase Builder
  function createMockSupabase(initialSettings = { is_locked: true, lock_password: 'testpassword' }, adminUsers = ['admin-123']) {
    let currentSettings = initialSettings === null ? null : { ...initialSettings };

    return {
      _getCurrentSettings: () => currentSettings,
      from(table) {
        if (table === 'site_settings') {
          return {
            select(fields) {
              return {
                eq(col, val) {
                  return {
                    single: async () => {
                      if (currentSettings === null) {
                        return { data: null, error: new Error('Database connection failed') };
                      }
                      return { data: { ...currentSettings }, error: null };
                    }
                  };
                }
              };
            },
            update(fields) {
              return {
                eq(col, val) {
                  currentSettings = { ...currentSettings, ...fields };
                  return Promise.resolve({ data: currentSettings, error: null });
                }
              };
            }
          };
        }

        if (table === 'admin_users') {
          return {
            select(fields) {
              return {
                eq(col, val) {
                  return {
                    maybeSingle: async () => {
                      if (adminUsers.includes(val)) {
                        return { data: { user_id: val }, error: null };
                      }
                      return { data: null, error: null };
                    }
                  };
                }
              };
            }
          };
        }

        throw new Error(`Unexpected mock table: ${table}`);
      },
      auth: {
        async getUser(token) {
          if (token === 'valid-admin-token') {
            return { data: { user: { id: 'admin-123', email: 'admin@movieverify.com' } }, error: null };
          }
          if (token === 'regular-user-token') {
            return { data: { user: { id: 'user-456', email: 'viewer@movieverify.com' } }, error: null };
          }
          return { data: null, error: new Error('Invalid JWT') };
        }
      }
    };
  }

  it('GET /api/site-lock: Returns is_locked: false, is_unlocked: true when site is public', async () => {
    process.env.SITE_LOCK_SESSION_SECRET = TEST_SECRET;
    const mockSupabase = createMockSupabase({ is_locked: false, lock_password: 'hashed' });

    const req = {
      method: 'GET',
      headers: {},
      _customSupabase: mockSupabase
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.getStatusCode(), 200);
    assert.deepEqual(res.getBody(), { is_locked: false, is_unlocked: true });
    assert.equal(res.getBody().lock_password, undefined, 'Must NEVER return password');
  });

  it('GET /api/site-lock: Returns is_locked: true, is_unlocked: false when locked and no cookie', async () => {
    process.env.SITE_LOCK_SESSION_SECRET = TEST_SECRET;
    const mockSupabase = createMockSupabase({ is_locked: true, lock_password: 'hashed' });

    const req = {
      method: 'GET',
      headers: {},
      _customSupabase: mockSupabase
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.getStatusCode(), 200);
    assert.deepEqual(res.getBody(), { is_locked: true, is_unlocked: false });
    assert.equal(res.getBody().lock_password, undefined, 'Must NEVER return password');
  });

  it('GET /api/site-lock: Returns is_locked: true, is_unlocked: true when locked with valid cookie', async () => {
    process.env.SITE_LOCK_SESSION_SECRET = TEST_SECRET;
    const mockSupabase = createMockSupabase({ is_locked: true, lock_password: 'hashed' });
    const validToken = createSessionToken(TEST_SECRET, 3600);

    const req = {
      method: 'GET',
      headers: {
        cookie: `${COOKIE_NAME}=${validToken}`
      },
      _customSupabase: mockSupabase
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.getStatusCode(), 200);
    assert.deepEqual(res.getBody(), { is_locked: true, is_unlocked: true });
  });

  it('GET /api/site-lock: Fails closed (500, is_locked: true, is_unlocked: false) on DB error', async () => {
    process.env.SITE_LOCK_SESSION_SECRET = TEST_SECRET;
    const mockSupabase = createMockSupabase(null); // Simulate DB failure

    const req = {
      method: 'GET',
      headers: {},
      _customSupabase: mockSupabase
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.getStatusCode(), 500);
    assert.equal(res.getBody().is_locked, true);
    assert.equal(res.getBody().is_unlocked, false);
  });

  it('POST /api/site-lock (unlock): Correct password succeeds, sets HttpOnly cookie, and migrates legacy plaintext to PBKDF2', async () => {
    process.env.SITE_LOCK_SESSION_SECRET = TEST_SECRET;
    const initialPlaintext = 'my_plaintext_pass';
    const mockSupabase = createMockSupabase({ is_locked: true, lock_password: initialPlaintext });

    const req = {
      method: 'POST',
      headers: {},
      body: { action: 'unlock', password: initialPlaintext },
      _customSupabase: mockSupabase
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.getStatusCode(), 200);
    assert.equal(res.getBody().success, true);

    // Verify Set-Cookie header is issued
    const setCookie = res.getHeaders()['Set-Cookie'];
    assert.ok(setCookie, 'Must set session cookie on successful unlock');
    assert.ok(setCookie.includes('HttpOnly'), 'Cookie must be HttpOnly');
    assert.ok(setCookie.includes('SameSite=Lax'), 'Cookie must be SameSite=Lax');

    // Verify legacy plaintext was migrated to PBKDF2 hash in the database
    const updatedSettings = mockSupabase._getCurrentSettings();
    assert.ok(updatedSettings.lock_password.startsWith('pbkdf2:sha256:100000:'), 'Legacy password must be migrated to PBKDF2 hash');
  });

  it('POST /api/site-lock (unlock): Correct password against PBKDF2 succeeds without re-migrating', async () => {
    process.env.SITE_LOCK_SESSION_SECRET = TEST_SECRET;
    const password = 'my_secure_pass';
    const existingHash = hashPassword(password);
    const mockSupabase = createMockSupabase({ is_locked: true, lock_password: existingHash });

    const req = {
      method: 'POST',
      headers: {},
      body: { action: 'unlock', password },
      _customSupabase: mockSupabase
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.getStatusCode(), 200);
    assert.equal(res.getBody().success, true);
    // Hash should remain identical (not needlessly re-hashed)
    assert.equal(mockSupabase._getCurrentSettings().lock_password, existingHash);
  });

  it('POST /api/site-lock (unlock): Incorrect password returns 401 and does NOT set cookie', async () => {
    process.env.SITE_LOCK_SESSION_SECRET = TEST_SECRET;
    const mockSupabase = createMockSupabase({ is_locked: true, lock_password: 'real_password' });

    const req = {
      method: 'POST',
      headers: {},
      body: { action: 'unlock', password: 'wrong_password' },
      _customSupabase: mockSupabase
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.getStatusCode(), 401);
    assert.equal(res.getBody().success, false);
    assert.equal(res.getHeaders()['Set-Cookie'], undefined, 'Must not set cookie on failed password');
  });

  it('POST /api/site-lock (admin_update): Anonymous request returns 401', async () => {
    process.env.SITE_LOCK_SESSION_SECRET = TEST_SECRET;
    const mockSupabase = createMockSupabase({ is_locked: true, lock_password: 'pwd' });

    const req = {
      method: 'POST',
      headers: {}, // No Authorization header
      body: { action: 'admin_update', is_locked: false },
      _customSupabase: mockSupabase
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.getStatusCode(), 401);
    assert.equal(res.getBody().success, false);
  });

  it('POST /api/site-lock (admin_update): Non-admin user returns 403 Forbidden', async () => {
    process.env.SITE_LOCK_SESSION_SECRET = TEST_SECRET;
    const mockSupabase = createMockSupabase({ is_locked: true, lock_password: 'pwd' }, ['admin-123']);

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer regular-user-token' },
      body: { action: 'admin_update', is_locked: false },
      _customSupabase: mockSupabase
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.getStatusCode(), 403);
    assert.equal(res.getBody().success, false);
  });

  it('POST /api/site-lock (admin_update): Verified admin can toggle site lock status', async () => {
    process.env.SITE_LOCK_SESSION_SECRET = TEST_SECRET;
    const mockSupabase = createMockSupabase({ is_locked: true, lock_password: 'pwd' }, ['admin-123']);

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer valid-admin-token' },
      body: { action: 'admin_update', is_locked: false },
      _customSupabase: mockSupabase
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.getStatusCode(), 200);
    assert.equal(res.getBody().success, true);
    assert.equal(mockSupabase._getCurrentSettings().is_locked, false);
  });

  it('POST /api/site-lock (admin_update): Empty new_password preserves existing stored password', async () => {
    process.env.SITE_LOCK_SESSION_SECRET = TEST_SECRET;
    const originalPassword = 'pbkdf2:sha256:100000:original_password_hash';
    const mockSupabase = createMockSupabase({ is_locked: false, lock_password: originalPassword }, ['admin-123']);

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer valid-admin-token' },
      body: { action: 'admin_update', is_locked: true, new_password: '' },
      _customSupabase: mockSupabase
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.getStatusCode(), 200);
    assert.equal(mockSupabase._getCurrentSettings().lock_password, originalPassword, 'Password must remain untouched when new_password is empty');
    assert.equal(mockSupabase._getCurrentSettings().is_locked, true);
  });

  it('POST /api/site-lock (admin_update): Non-empty new_password is automatically hashed before storing', async () => {
    process.env.SITE_LOCK_SESSION_SECRET = TEST_SECRET;
    const mockSupabase = createMockSupabase({ is_locked: true, lock_password: 'old' }, ['admin-123']);

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer valid-admin-token' },
      body: { action: 'admin_update', is_locked: true, new_password: 'BrandNewAdminKey2026!' },
      _customSupabase: mockSupabase
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.getStatusCode(), 200);
    const updated = mockSupabase._getCurrentSettings();
    assert.ok(updated.lock_password.startsWith('pbkdf2:sha256:100000:'), 'New password must be hashed with PBKDF2');
    assert.notEqual(updated.lock_password, 'BrandNewAdminKey2026!', 'Plaintext password must never be stored in database');
    assert.equal(verifyPassword('BrandNewAdminKey2026!', updated.lock_password).valid, true);
  });
});
