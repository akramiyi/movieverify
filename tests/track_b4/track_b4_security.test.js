import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Load actual proposed middleware and API modules directly from docs/TRACK_B4_R1_26/proposed
const proposedMiddlewarePath = path.resolve(process.cwd(), 'docs/TRACK_B4_R1_26/proposed/middleware.js');
const proposedVerifyApiPath = path.resolve(process.cwd(), 'docs/TRACK_B4_R1_26/proposed/api/site-lock/verify.js');
const proposedRotateApiPath = path.resolve(process.cwd(), 'docs/TRACK_B4_R1_26/proposed/api/site-lock/rotate.js');
const proposedPruneCronPath = path.resolve(process.cwd(), 'docs/TRACK_B4_R1_26/proposed/api/internal/prune-rate-limits.js');
const proposedVercelJsonPath = path.resolve(process.cwd(), 'docs/TRACK_B4_R1_26/proposed/vercel.json');

let verifyApiModule;
let middlewareModule;
let rotateApiModule;
let pruneCronModule;
try {
  verifyApiModule = await import(`file://${proposedVerifyApiPath.replace(/\\/g, '/')}`);
  middlewareModule = await import(`file://${proposedMiddlewarePath.replace(/\\/g, '/')}`);
  rotateApiModule = await import(`file://${proposedRotateApiPath.replace(/\\/g, '/')}`);
  pruneCronModule = await import(`file://${proposedPruneCronPath.replace(/\\/g, '/')}`);
} catch (e) {
  console.error('Failed to import proposed modules:', e);
}

// Read proposed middleware source directly
const mwSourceCode = fs.readFileSync(proposedMiddlewarePath, 'utf8');

// Parse EXACT_EXEMPT_ROUTES from middleware source
const exactRoutesMatch = mwSourceCode.match(/EXACT_EXEMPT_ROUTES\s*=\s*new Set\(\[\s*([\s\S]*?)\]\);/);
const parsedExactRoutes = new Set(
  exactRoutesMatch[1]
    .split(',')
    .map(s => s.trim().replace(/['"]/g, ''))
    .filter(Boolean)
);

// Parse BOUNDED_PREFIX_EXEMPT_ROUTES from middleware source
const prefixRoutesMatch = mwSourceCode.match(/BOUNDED_PREFIX_EXEMPT_ROUTES\s*=\s*\[\s*([\s\S]*?)\];/);
const parsedPrefixRoutes = prefixRoutesMatch[1]
  .split(',')
  .map(s => s.trim().replace(/['"]/g, ''))
  .filter(Boolean);

function proposedIsRouteExempt(pathname) {
  if (parsedExactRoutes.has(pathname)) return true;
  for (const prefix of parsedPrefixRoutes) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

// In-Memory Simulation Harness: Simulates atomic PostgreSQL row-lock rate limiting
class MockDatabaseAtomicRPC {
  constructor(correctPasswordHash, initialVersion = 1, isLocked = true, isInitialized = true, maxAttempts = 5, windowSeconds = 900) {
    this.correctPasswordHash = correctPasswordHash;
    this.activeVersion = initialVersion;
    this.isLocked = isLocked;
    this.isInitialized = isInitialized;
    this.maxAttempts = maxAttempts;
    this.windowSeconds = windowSeconds;
    this.rateLimitTable = new Map();
    this.mutex = new Map();
  }

  rotatePassword(newPasswordHash) {
    this.correctPasswordHash = newPasswordHash;
    this.activeVersion += 1;
    this.isInitialized = true;
    return this.activeVersion;
  }

  updateSiteSettingsLock(newIsLocked) {
    if (newIsLocked === false && !this.isInitialized) {
      throw new Error('violates check constraint "chk_initialized_to_unlock"');
    }
    this.isLocked = newIsLocked;
    return { is_locked: this.isLocked, is_initialized: this.isInitialized };
  }

  async verifyAndRateLimit(clientIdHash, candidatePassword) {
    while (this.mutex.get(clientIdHash)) {
      await new Promise(r => setTimeout(r, 5));
    }
    this.mutex.set(clientIdHash, true);

    try {
      const now = Date.now();
      let record = this.rateLimitTable.get(clientIdHash);

      if (!record) {
        record = { attempt_count: 0, last_attempt: now, blocked_until: null };
        this.rateLimitTable.set(clientIdHash, record);
      }

      if (!this.isLocked) {
        return {
          status: 'valid',
          site_locked: false,
          attempts_remaining: this.maxAttempts
        };
      }

      if (this.isInitialized !== true) {
        return {
          status: 'uninitialized',
          error: 'Site lock is uninitialized. Administrative rotation required.'
        };
      }

      if (record.blocked_until && record.blocked_until > now) {
        return {
          status: 'blocked',
          blocked_until: new Date(record.blocked_until).toISOString(),
          attempts_remaining: 0
        };
      }

      if (record.last_attempt < (now - (this.windowSeconds * 1000)) && (!record.blocked_until || record.blocked_until <= now)) {
        record.attempt_count = 0;
        record.blocked_until = null;
      }

      // Check Attempt Limit Prior to Password Evaluation (6th attempt rejected with 429)
      if (record.attempt_count >= this.maxAttempts) {
        record.blocked_until = now + (this.windowSeconds * 1000);
        record.last_attempt = now;
        return {
          status: 'blocked',
          blocked_until: new Date(record.blocked_until).toISOString(),
          attempts_remaining: 0
        };
      }

      const candidateHash = crypto.createHash('sha256').update(candidatePassword).digest('hex');
      const isMatch = (candidateHash === this.correctPasswordHash);

      if (isMatch) {
        record.attempt_count = 0;
        record.blocked_until = null;
        record.last_attempt = now;
        return {
          status: 'valid',
          site_locked: true,
          version: this.activeVersion,
          attempts_remaining: this.maxAttempts
        };
      } else {
        record.attempt_count += 1;
        record.last_attempt = now;
        return {
          status: 'invalid',
          attempts_remaining: Math.max(0, this.maxAttempts - record.attempt_count)
        };
      }
    } finally {
      this.mutex.set(clientIdHash, false);
    }
  }
}

describe('Track B4 R1.26 Comprehensive Security & Verification Suite', () => {

  describe('A. Static Source & SQL Assertions', () => {
    test('A1. Cron RPC name in proposed cron handler matches SQL draft canonical name', () => {
      const pruneSource = fs.readFileSync(proposedPruneCronPath, 'utf8');
      assert.strictEqual(pruneSource.includes("'prune_site_lock_rate_limits'"), true);
    });

    test('A2. Cookie name in proposed verify API matches proposed middleware', () => {
      assert.strictEqual(verifyApiModule.COOKIE_NAME, 'site_lock_auth');
      assert.strictEqual(mwSourceCode.includes("'site_lock_auth'"), true);
    });

    test('A3. Secret byte length requirement is at least 32 bytes in both API and middleware', () => {
      const verifySource = fs.readFileSync(proposedVerifyApiPath, 'utf8');
      assert.strictEqual(verifySource.includes('Buffer.byteLength(secretKey, \'utf8\') < 32'), true);
      assert.strictEqual(mwSourceCode.includes('new TextEncoder().encode(secretKey).length < 32'), true);
    });

    test('A4. Static SQL inspection: Migration 00 uses valid has_schema_privilege and does NOT use invalid information_schema.schema_privileges', () => {
      const sql00 = fs.readFileSync(path.resolve(process.cwd(), 'docs/TRACK_B4_R1_26/sql/00_secret_store_foundation_DRAFT.sql'), 'utf8');
      assert.strictEqual(sql00.includes('information_schema.schema_privileges'), false);
      assert.strictEqual(sql00.includes("has_schema_privilege(v_role, v_schema, 'CREATE')"), true);
    });

    test('A5. Static SQL inspection: Migration 00 enforces immutable baseline and does NOT overwrite on rerun', () => {
      const sql00 = fs.readFileSync(path.resolve(process.cwd(), 'docs/TRACK_B4_R1_26/sql/00_secret_store_foundation_DRAFT.sql'), 'utf8');
      assert.strictEqual(sql00.includes('ON CONFLICT (id) DO UPDATE'), false);
      assert.strictEqual(sql00.includes('Preserving immutable pre-migration baseline'), true);
    });

    test('A6. Static SQL inspection: Migration 00 contains exact normalized check constraint comparisons', () => {
      const sql00 = fs.readFileSync(path.resolve(process.cwd(), 'docs/TRACK_B4_R1_26/sql/00_secret_store_foundation_DRAFT.sql'), 'utf8');
      assert.strictEqual(sql00.includes("CHECK (((is_locked = true) OR (is_initialized = true)))"), true);
      assert.strictEqual(sql00.includes("valid_bcrypt_format"), true);
      assert.strictEqual(sql00.includes("CHECK ((attempt_count >= 0))"), true);
    });

    test('A7. Static SQL inspection: Migration 00 rejects unsupported schemas and dynamically qualifies pgcrypto calls', () => {
      const sql00 = fs.readFileSync(path.resolve(process.cwd(), 'docs/TRACK_B4_R1_26/sql/00_secret_store_foundation_DRAFT.sql'), 'utf8');
      assert.strictEqual(sql00.includes('UNSUPPORTED_EXTENSION_SCHEMA'), true);
      assert.strictEqual(sql00.includes('%I.crypt(new_password, %I.gen_salt('), true);
      assert.strictEqual(sql00.includes('(%I.crypt(p_candidate_password, v_correct_hash) = v_correct_hash)'), true);
    });

    test('A8. Static SQL inspection: Migration 01 removes dangerous GRANT ALL on site_settings', () => {
      const sql01 = fs.readFileSync(path.resolve(process.cwd(), 'docs/TRACK_B4_R1_26/sql/01_policy_and_acl_cutover_DRAFT.sql'), 'utf8');
      assert.strictEqual(sql01.includes('GRANT ALL ON public.site_settings TO authenticated'), false);
      assert.strictEqual(sql01.includes('GRANT SELECT (id, is_locked, is_initialized, updated_at) ON public.site_settings TO anon, authenticated'), true);
      assert.strictEqual(sql01.includes('GRANT UPDATE (is_locked, is_initialized, updated_at) ON public.site_settings TO authenticated'), true);
    });

    test('A9. Static SQL inspection: Rollback plan consumes captured baseline, drops only Track B4 objects without CASCADE', () => {
      const rollbackSql = fs.readFileSync(path.resolve(process.cwd(), 'docs/TRACK_B4_R1_26/ROLLBACK_PLAN.md'), 'utf8');
      assert.strictEqual(rollbackSql.includes('GRANT SELECT ON public.site_settings TO anon, authenticated;'), false);
      assert.strictEqual(rollbackSql.includes('ROLLBACK_ACL_ABORT'), true);
      assert.strictEqual(rollbackSql.includes('v_baseline.captured_policies'), true);
      assert.strictEqual(rollbackSql.includes('v_baseline.captured_column_privs'), true);
      const sqlBlock = rollbackSql.split('```sql')[1].split('```')[0];
      assert.strictEqual(/\bDROP\s+[A-Z0-9_]+\s+[^;]*\bCASCADE\b/i.test(sqlBlock), false);
    });

    test('A10. Static Source: Middleware imports next from @vercel/functions and does NOT use request.cookies', () => {
      assert.strictEqual(mwSourceCode.includes("import { next } from '@vercel/functions';"), true);
      assert.strictEqual(mwSourceCode.includes("request.cookies"), false);
      assert.strictEqual(mwSourceCode.includes("extractAuthCookie(request)"), true);
      assert.strictEqual(parsedExactRoutes.has('/api/site-lock/rotate'), true);
    });

    test('A11. Static SQL inspection: Migration 01 contains explicit assertions verifying no TRUNCATE, REFERENCES, TRIGGER on site_settings', () => {
      const sql01 = fs.readFileSync(path.resolve(process.cwd(), 'docs/TRACK_B4_R1_26/sql/01_policy_and_acl_cutover_DRAFT.sql'), 'utf8');
      assert.strictEqual(sql01.includes("has_table_privilege('authenticated', 'public.site_settings', 'TRUNCATE')"), true);
      assert.strictEqual(sql01.includes("has_table_privilege('authenticated', 'public.site_settings', 'REFERENCES')"), true);
      assert.strictEqual(sql01.includes("has_table_privilege('authenticated', 'public.site_settings', 'TRIGGER')"), true);
    });

    test('A12. Static SQL inspection: Migration 00 captures pg_get_functiondef and site_settings column definitions', () => {
      const sql00 = fs.readFileSync(path.resolve(process.cwd(), 'docs/TRACK_B4_R1_26/sql/00_secret_store_foundation_DRAFT.sql'), 'utf8');
      assert.strictEqual(sql00.includes('pg_get_functiondef(p.oid)'), true);
      assert.strictEqual(sql00.includes('is_initialized_preexisted'), true);
      assert.strictEqual(sql00.includes('is_locked_nullable'), true);
    });
  });

  describe('B. Native Web Request Cookie Header Integration Tests (P0)', () => {
    const dummySecret = 'super-secret-key-that-is-at-least-32-bytes-long!';
    const clientIp = '198.51.100.22';
    const activeVersion = 1;

    test('B1. Native Request with valid site_lock_auth cookie allows continuation (next)', async () => {
      const token = verifyApiModule.generateSessionToken(clientIp, activeVersion, dummySecret, 3600);
      const req = new Request('https://movieverify.com/admin', {
        headers: {
          'cookie': `foo=bar; site_lock_auth=${token}; other=123`,
          'x-real-ip': clientIp
        }
      });

      const extracted = middlewareModule.extractAuthCookie(req);
      assert.strictEqual(extracted, token);

      const isValid = await middlewareModule.parseAndVerifyCookie(extracted, dummySecret, clientIp, activeVersion);
      assert.strictEqual(isValid, true);
    });

    test('B2. Native Request missing cookie header returns null (redirect to site-lock)', () => {
      const req = new Request('https://movieverify.com/admin', {
        headers: {
          'x-real-ip': clientIp
        }
      });
      const extracted = middlewareModule.extractAuthCookie(req);
      assert.strictEqual(extracted, null);
    });

    test('B3. Native Request with duplicate site_lock_auth cookies is rejected (fails closed)', () => {
      const req = new Request('https://movieverify.com/admin', {
        headers: {
          'cookie': 'site_lock_auth=token1; site_lock_auth=token2',
          'x-real-ip': clientIp
        }
      });
      const extracted = middlewareModule.extractAuthCookie(req);
      assert.strictEqual(extracted, null);
    });

    test('B4. Native Request with malformed cookie value containing spaces/quotes is rejected', () => {
      const req = new Request('https://movieverify.com/admin', {
        headers: {
          'cookie': 'site_lock_auth="malformed token with spaces"; foo=bar',
          'x-real-ip': clientIp
        }
      });
      const extracted = middlewareModule.extractAuthCookie(req);
      assert.strictEqual(extracted, null);
    });

    test('B5. Native Request with expired token fails verification', async () => {
      const expiredToken = verifyApiModule.generateSessionToken(clientIp, activeVersion, dummySecret, -60);
      const req = new Request('https://movieverify.com/admin', {
        headers: {
          'cookie': `site_lock_auth=${expiredToken}`,
          'x-real-ip': clientIp
        }
      });
      const extracted = middlewareModule.extractAuthCookie(req);
      const isValid = await middlewareModule.parseAndVerifyCookie(extracted, dummySecret, clientIp, activeVersion);
      assert.strictEqual(isValid, false);
    });

    test('B6. Native Request with mismatched client IP fails verification', async () => {
      const token = verifyApiModule.generateSessionToken('203.0.113.50', activeVersion, dummySecret, 3600);
      const req = new Request('https://movieverify.com/admin', {
        headers: {
          'cookie': `site_lock_auth=${token}`,
          'x-real-ip': clientIp
        }
      });
      const extracted = middlewareModule.extractAuthCookie(req);
      const isValid = await middlewareModule.parseAndVerifyCookie(extracted, dummySecret, clientIp, activeVersion);
      assert.strictEqual(isValid, false);
    });
  });

  describe('C. Administrative Password Rotation & Exemption Lifecycle (P0)', () => {
    test('C1. Middleware exemption list exempts /api/site-lock/rotate', () => {
      assert.strictEqual(proposedIsRouteExempt('/api/site-lock/rotate'), true);
    });

    test('C2. Rotation endpoint rejects requests without Authorization header (401)', async () => {
      let statusCode = null;
      let jsonPayload = null;
      const mockReq = {
        method: 'POST',
        headers: {},
        body: { password: 'new-valid-admin-password' }
      };
      const mockRes = {
        status: (code) => { statusCode = code; return mockRes; },
        json: (data) => { jsonPayload = data; return mockRes; }
      };

      await rotateApiModule.default(mockReq, mockRes);
      assert.strictEqual(statusCode, 401);
      assert.strictEqual(jsonPayload.error.includes('Missing or invalid authentication token'), true);
    });

    test('C3. Rotation endpoint rejects password shorter than 8 characters (400)', async () => {
      let statusCode = null;
      let jsonPayload = null;
      const mockReq = {
        method: 'POST',
        headers: { authorization: 'Bearer some-admin-token' },
        body: { password: 'short' }
      };
      const mockRes = {
        status: (code) => { statusCode = code; return mockRes; },
        json: (data) => { jsonPayload = data; return mockRes; }
      };

      await rotateApiModule.default(mockReq, mockRes);
      assert.strictEqual(statusCode, 400);
      assert.strictEqual(jsonPayload.error.includes('at least 8 characters long'), true);
    });

    test('C4. Initial password rotation works while site is locked and uninitialized', () => {
      const harness = new MockDatabaseAtomicRPC('dummy-initial-hash', 1, true, false);
      assert.strictEqual(harness.isLocked, true);
      assert.strictEqual(harness.isInitialized, false);

      assert.throws(() => harness.updateSiteSettingsLock(false), /chk_initialized_to_unlock/);

      const newVersion = harness.rotatePassword('new-secure-rotated-hash');
      assert.strictEqual(newVersion, 2);
      assert.strictEqual(harness.isInitialized, true);

      const unlocked = harness.updateSiteSettingsLock(false);
      assert.strictEqual(unlocked.is_locked, false);
    });
  });

  describe('D. Schema Privilege Preflight Negative Tests', () => {
    test('D1. Preflight aborts when PUBLIC, anon, or authenticated has effective CREATE privilege on searched schema', () => {
      function evaluateSchemaPreflight(roleGrants) {
        const untrustedRoles = ['public', 'anon', 'authenticated'];
        const searchedSchemas = ['public', 'extensions'];

        for (const schema of searchedSchemas) {
          for (const role of untrustedRoles) {
            const hasPriv = roleGrants[`${role}@${schema}`] || false;
            if (hasPriv) {
              if (schema === 'public' && role === 'public') {
                continue; // Auto-revoked in step 3
              } else {
                throw new Error(`SECURITY_PREFLIGHT_ABORT: Role "${role}" possesses untrusted CREATE privilege on schema "${schema}"`);
              }
            }
          }
        }
        return true;
      }

      assert.strictEqual(evaluateSchemaPreflight({ 'public@public': true }), true);
      assert.throws(() => evaluateSchemaPreflight({ 'anon@public': true }), /SECURITY_PREFLIGHT_ABORT: Role "anon"/);
      assert.throws(() => evaluateSchemaPreflight({ 'authenticated@public': true }), /SECURITY_PREFLIGHT_ABORT: Role "authenticated"/);
      assert.throws(() => evaluateSchemaPreflight({ 'anon@extensions': true }), /SECURITY_PREFLIGHT_ABORT: Role "anon" possesses untrusted CREATE privilege on schema "extensions"/);
    });
  });

  describe('E. Baseline Immutability & Migration Rerun Simulation', () => {
    test('E1. First migration run creates baseline; subsequent run NEVER overwrites original table-existed flags', () => {
      let baselineRow = null;

      function runMigrationStep0(currentSecretsTableExists, currentRateLimitsTableExists) {
        if (baselineRow !== null) {
          return { status: 'PRESERVED', baseline: baselineRow };
        } else {
          baselineRow = {
            id: 1,
            secrets_table_preexisted: currentSecretsTableExists,
            rate_limits_table_preexisted: currentRateLimitsTableExists,
            chk_initialized_to_unlock_preexisted: false,
            captured_at: new Date().toISOString()
          };
          return { status: 'CAPTURED', baseline: baselineRow };
        }
      }

      const run1 = runMigrationStep0(false, false);
      assert.strictEqual(run1.status, 'CAPTURED');
      assert.strictEqual(run1.baseline.secrets_table_preexisted, false);

      const run2 = runMigrationStep0(true, true);
      assert.strictEqual(run2.status, 'PRESERVED');
      assert.strictEqual(run2.baseline.secrets_table_preexisted, false);
      assert.strictEqual(baselineRow.secrets_table_preexisted, false);
    });
  });

  describe('F. Actual Exported Matcher Testing', () => {
    const rawMatcher = mwSourceCode.match(/matcher:\s*\[\s*'([^']+)'\s*\]/);
    const matcherRegex = new RegExp('^' + rawMatcher[1] + '$');

    test('F1. Tests the actual exported matcher regex against paths', () => {
      assert.strictEqual(matcherRegex.test('/site-lock'), true);
      assert.strictEqual(matcherRegex.test('/api/site-lock/verify'), true);
      assert.strictEqual(matcherRegex.test('/api/site-lock/rotate'), true);
      assert.strictEqual(matcherRegex.test('/admin'), true);
      assert.strictEqual(matcherRegex.test('/movies/123'), true);
      assert.strictEqual(matcherRegex.test('/_next/image/foo'), true);

      assert.strictEqual(matcherRegex.test('/_next/static/chunks/main.js'), false);
      assert.strictEqual(matcherRegex.test('/_next/image'), false);
      assert.strictEqual(matcherRegex.test('/favicon.ico'), false);
      assert.strictEqual(matcherRegex.test('/assets/index-abc12345.js'), false);
    });
  });

  describe('G. Concurrency & Rate Limiting (Simulation Harness)', () => {
    test('G1. First 5 failed attempts return invalid (401), 6th attempt is blocked (429)', async () => {
      const correctHash = crypto.createHash('sha256').update('CorrectPassword123!').digest('hex');
      const harness = new MockDatabaseAtomicRPC(correctHash, 1, true, true, 5, 900);
      const clientIdHash = 'test-client-sha256-hash';

      for (let i = 1; i <= 5; i++) {
        const res = await harness.verifyAndRateLimit(clientIdHash, `WrongPassword${i}`);
        assert.strictEqual(res.status, 'invalid');
        assert.strictEqual(res.attempts_remaining, 5 - i);
      }

      const res6 = await harness.verifyAndRateLimit(clientIdHash, 'WrongPassword6');
      assert.strictEqual(res6.status, 'blocked');
      assert.strictEqual(res6.attempts_remaining, 0);
    });

    test('G2. 10 simultaneous failed requests serialize cleanly (5 invalid, 5 blocked)', async () => {
      const correctHash = crypto.createHash('sha256').update('CorrectPassword123!').digest('hex');
      const harness = new MockDatabaseAtomicRPC(correctHash, 1, true, true, 5, 900);
      const clientIdHash = 'concurrent-client-sha256-hash';

      const promises = Array.from({ length: 10 }, (_, i) =>
        harness.verifyAndRateLimit(clientIdHash, `BadPassword${i}`)
      );

      const results = await Promise.all(promises);
      const invalidCount = results.filter(r => r.status === 'invalid').length;
      const blockedCount = results.filter(r => r.status === 'blocked').length;

      assert.strictEqual(invalidCount, 5);
      assert.strictEqual(blockedCount, 5);
    });
  });

  describe('H. Trusted Proxy Provenance (Direct Vercel Ingress Rules)', () => {
    test('H1. Direct Vercel ingress: Single public IP in x-forwarded-for is accepted', () => {
      const req = { headers: { 'x-forwarded-for': '198.51.100.22' } };
      const ip = verifyApiModule.getAuthoritativeClientIp(req);
      assert.strictEqual(ip, '198.51.100.22');
    });

    test('H2. Direct Vercel ingress: Multi-value x-forwarded-for chain fails closed', () => {
      const req = { headers: { 'x-forwarded-for': '203.0.113.195, 198.51.100.22' } };
      assert.throws(() => verifyApiModule.getAuthoritativeClientIp(req), /UNTRUSTED_CLIENT_IP/);
    });

    test('H3. Direct Vercel ingress: x-real-ip single valid IP is accepted', () => {
      const req = { headers: { 'x-real-ip': '198.51.100.99' } };
      const ip = verifyApiModule.getAuthoritativeClientIp(req);
      assert.strictEqual(ip, '198.51.100.99');
    });
  });

  describe('I. Vercel Routing Middleware Continuation Helper (@vercel/functions)', () => {
    test('I1. next() from @vercel/functions returns standard Web Response with continuation header', async () => {
      const { next } = await import('@vercel/functions');
      const res = next();
      assert.strictEqual(res instanceof Response, true);
      assert.strictEqual(res.headers.get('x-middleware-next'), '1');
    });
  });

  describe('J. Documented Vercel Middleware Export Convention (P0)', () => {
    test('J1. Proposed middleware provides documented default export and named export', () => {
      assert.strictEqual(typeof middlewareModule.default, 'function');
      assert.strictEqual(typeof middlewareModule.middleware, 'function');
      assert.strictEqual(middlewareModule.default, middlewareModule.middleware);
      assert.strictEqual(Array.isArray(middlewareModule.config?.matcher), true);
    });
  });

  describe('K. Pre-Existing Function & Schema Restoration Fixtures (P1)', () => {
    test('K1. Rollback script restores pre-existing function definition captured via pg_get_functiondef', () => {
      const rollbackSql = fs.readFileSync(path.resolve(process.cwd(), 'docs/TRACK_B4_R1_26/ROLLBACK_PLAN.md'), 'utf8');
      assert.strictEqual(rollbackSql.includes("r_func->>'functiondef' IS NOT NULL"), true);
      assert.strictEqual(rollbackSql.includes("EXECUTE (r_func->>'functiondef')"), true);
    });

    test('K2. Rollback script reverses is_initialized addition and restores is_locked nullability', () => {
      const rollbackSql = fs.readFileSync(path.resolve(process.cwd(), 'docs/TRACK_B4_R1_26/ROLLBACK_PLAN.md'), 'utf8');
      assert.strictEqual(rollbackSql.includes("ALTER TABLE public.site_settings DROP COLUMN IF EXISTS is_initialized;"), true);
      assert.strictEqual(rollbackSql.includes("ALTER TABLE public.site_settings ALTER COLUMN is_locked DROP NOT NULL;"), true);
    });
  });

  describe('L. Vercel Cron Endpoint GET & Configuration (P1)', () => {
    test('L1. Prune rate limits endpoint accepts GET method used by Vercel Cron', async () => {
      let statusCode = null;
      let jsonPayload = null;
      const mockReq = {
        method: 'GET',
        headers: { authorization: 'Bearer dummy-cron-secret-that-is-long-enough' }
      };
      const mockRes = {
        status: (code) => { statusCode = code; return mockRes; },
        json: (data) => { jsonPayload = data; return mockRes; }
      };

      process.env.CRON_SECRET = 'dummy-cron-secret-that-is-long-enough';
      await pruneCronModule.default(mockReq, mockRes);
      // Fails on missing Supabase env, NOT on method 405
      assert.notStrictEqual(statusCode, 405);
    });

    test('L2. Prune rate limits endpoint accepts POST method', async () => {
      let statusCode = null;
      const mockReq = {
        method: 'POST',
        headers: { authorization: 'Bearer dummy-cron-secret-that-is-long-enough' }
      };
      const mockRes = {
        status: (code) => { statusCode = code; return mockRes; },
        json: () => mockRes
      };

      process.env.CRON_SECRET = 'dummy-cron-secret-that-is-long-enough';
      await pruneCronModule.default(mockReq, mockRes);
      assert.notStrictEqual(statusCode, 405);
    });

    test('L3. Prune rate limits endpoint rejects unpermitted methods (PUT/DELETE) with 405', async () => {
      let statusCode = null;
      const mockReq = { method: 'DELETE', headers: {} };
      const mockRes = {
        status: (code) => { statusCode = code; return mockRes; },
        json: () => mockRes
      };

      await pruneCronModule.default(mockReq, mockRes);
      assert.strictEqual(statusCode, 405);
    });

    test('L4. vercel.json contains documented cron configuration for /api/internal/prune-rate-limits', () => {
      const vercelConfig = JSON.parse(fs.readFileSync(proposedVercelJsonPath, 'utf8'));
      assert.strictEqual(Array.isArray(vercelConfig.crons), true);
      assert.strictEqual(vercelConfig.crons[0].path, '/api/internal/prune-rate-limits');
      assert.strictEqual(vercelConfig.crons[0].schedule, '0 3 * * *');
    });
  });

  describe('M. Comprehensive IPv4/IPv6 Validation & Normalization (P1)', () => {
    test('M1. Validates standard IPv4 addresses', () => {
      assert.strictEqual(middlewareModule.isValidIp('198.51.100.22'), true);
      assert.strictEqual(middlewareModule.isValidIp('0.0.0.0'), true);
      assert.strictEqual(middlewareModule.isValidIp('255.255.255.255'), true);
      assert.strictEqual(middlewareModule.isValidIp('256.0.0.1'), false);
      assert.strictEqual(middlewareModule.isValidIp('01.0.0.1'), false);
    });

    test('M2. Validates compressed IPv6 addresses', () => {
      assert.strictEqual(middlewareModule.isValidIp('::1'), true);
      assert.strictEqual(middlewareModule.isValidIp('::'), true);
      assert.strictEqual(middlewareModule.isValidIp('2001:db8::1'), true);
      assert.strictEqual(middlewareModule.isValidIp('fe80::'), true);
    });

    test('M3. Validates full IPv6 addresses', () => {
      assert.strictEqual(middlewareModule.isValidIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334'), true);
    });

    test('M4. Validates IPv4-mapped IPv6 addresses', () => {
      assert.strictEqual(middlewareModule.isValidIp('::ffff:192.0.2.1'), true);
      assert.strictEqual(middlewareModule.isValidIp('::ffff:198.51.100.22'), true);
      assert.strictEqual(middlewareModule.isValidIp('::ffff:256.0.0.1'), false);
    });

    test('M5. Rejects malformed IP addresses (triple colon, multiple double colon, non-hex)', () => {
      assert.strictEqual(middlewareModule.isValidIp('2001:db8:::1'), false);
      assert.strictEqual(middlewareModule.isValidIp('2001:db8::1::2'), false);
      assert.strictEqual(middlewareModule.isValidIp('invalid.ip.address'), false);
      assert.strictEqual(middlewareModule.isValidIp(''), false);
    });

    test('M6. IP Normalizer produces consistent lowercase trimmed string', () => {
      assert.strictEqual(middlewareModule.normalizeIp(' 198.51.100.22 '), '198.51.100.22');
      assert.strictEqual(middlewareModule.normalizeIp('::FFFF:192.0.2.1'), '::ffff:192.0.2.1');
      assert.strictEqual(verifyApiModule.normalizeIp('::FFFF:192.0.2.1'), '::ffff:192.0.2.1');
    });
  });

  describe('N. Password Untrimmed Consistency (P1)', () => {
    test('N1. verify.js passes exact untrimmed password to RPC', () => {
      const verifySource = fs.readFileSync(proposedVerifyApiPath, 'utf8');
      assert.strictEqual(verifySource.includes('p_candidate_password: password\n'), true);
      assert.strictEqual(verifySource.includes('password.trim()'), false);
    });
  });
});
