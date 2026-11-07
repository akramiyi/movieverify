/**
 * MovieVerify Site Lock Security API (/api/site-lock)
 * 
 * Server-side controller for private site access, admin configuration,
 * password hashing, and cryptographic unlock session management.
 * 
 * Security Guarantees:
 * 1. Zero Password Leakage: Neither lock_password nor password hash is ever returned to client.
 * 2. Secure Password Hashing: Uses Node.js crypto PBKDF2 (SHA-256, 100,000 iterations, random salt).
 * 3. Transparent Legacy Migration: Plaintext passwords verified with timingSafeEqual and migrated to PBKDF2.
 * 4. Timing-Safe Comparison: All secret/credential comparisons use crypto.timingSafeEqual.
 * 5. Cryptographic Sessions: HMAC-signed HttpOnly, SameSite=Lax, Secure cookies with bounded TTL.
 * 6. Admin Verification: Enforces Supabase server auth.getUser() and admin_users whitelist membership.
 * 7. Fail-Closed Design: Errors in verification or database query fail closed without unlocking site.
 */

import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const COOKIE_NAME = 'mv_site_lock_session';
export const COOKIE_MAX_AGE_SECONDS = 86400; // 24 hours
export const PBKDF2_ITERATIONS = 100000;
export const PBKDF2_KEYLEN = 32;
export const PBKDF2_DIGEST = 'sha256';

// Development ephemeral fallback secret (generated once per server process)
let devFallbackSecret = null;

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 * Pre-hashes inputs with SHA-256 to guarantee identical buffer length before timingSafeEqual.
 * @param {string} a 
 * @param {string} b 
 * @returns {boolean}
 */
export function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length === 0 || b.length === 0) return false;
  const bufA = crypto.createHash('sha256').update(a).digest();
  const bufB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Hash a password using PBKDF2 with SHA-256 and a random 16-byte salt.
 * @param {string} password Plaintext password
 * @returns {string} Formatted hash string `pbkdf2:sha256:<iter>:<saltHex>:<hashHex>`
 */
export function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(
    password,
    Buffer.from(salt, 'hex'),
    PBKDF2_ITERATIONS,
    PBKDF2_KEYLEN,
    PBKDF2_DIGEST
  ).toString('hex');

  return `pbkdf2:${PBKDF2_DIGEST}:${PBKDF2_ITERATIONS}:${salt}:${hash}`;
}

/**
 * Verify candidate password against stored value.
 * Handles both PBKDF2 hashes and legacy plaintext values.
 * @param {string} candidate User-supplied password
 * @param {string} stored Stored database value (hash or legacy plaintext)
 * @returns {{ valid: boolean, needsMigration: boolean }}
 */
export function verifyPassword(candidate, stored) {
  if (typeof candidate !== 'string' || typeof stored !== 'string') {
    return { valid: false, needsMigration: false };
  }

  // Case 1: PBKDF2 hashed password
  if (stored.startsWith('pbkdf2:sha256:')) {
    const parts = stored.split(':');
    if (parts.length === 5) {
      const iterations = parseInt(parts[2], 10);
      const saltHex = parts[3];
      const hashHex = parts[4];

      if (!isNaN(iterations) && saltHex && hashHex) {
        try {
          const candidateHash = crypto.pbkdf2Sync(
            candidate,
            Buffer.from(saltHex, 'hex'),
            iterations,
            PBKDF2_KEYLEN,
            PBKDF2_DIGEST
          ).toString('hex');

          const bufCandidate = Buffer.from(candidateHash, 'hex');
          const bufExpected = Buffer.from(hashHex, 'hex');

          if (bufCandidate.length === bufExpected.length && crypto.timingSafeEqual(bufCandidate, bufExpected)) {
            return { valid: true, needsMigration: false };
          }
        } catch {
          return { valid: false, needsMigration: false };
        }
      }
    }
    return { valid: false, needsMigration: false };
  }

  // Case 2: Legacy plaintext password
  const match = timingSafeCompare(candidate, stored);
  return { valid: match, needsMigration: match };
}

/**
 * Create an HMAC-SHA256 signed session token for unlocked sessions.
 * Structure: v1.<exp>.<nonce>.<signature>
 * @param {string} secret Cryptographic session secret
 * @param {number} [maxAgeSeconds=86400] Session TTL
 * @returns {string} Signed token string
 */
export function createSessionToken(secret, maxAgeSeconds = COOKIE_MAX_AGE_SECONDS) {
  const exp = Math.floor(Date.now() / 1000) + maxAgeSeconds;
  const nonce = crypto.randomBytes(8).toString('hex');
  const payload = `v1.${exp}.${nonce}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');

  return `${payload}.${signature}`;
}

/**
 * Verify signature and expiration of a session token.
 * @param {string} token Session token
 * @param {string} secret Cryptographic session secret
 * @returns {boolean} True if valid and not expired
 */
export function verifySessionToken(token, secret) {
  if (!token || typeof token !== 'string') return false;

  const parts = token.split('.');
  if (parts.length !== 4) return false;

  const [version, expStr, nonce, sig] = parts;
  if (version !== 'v1') return false;

  const exp = parseInt(expStr, 10);
  if (isNaN(exp)) return false;

  // Reject expired tokens
  if (Math.floor(Date.now() / 1000) > exp) return false;

  const expectedPayload = `v1.${expStr}.${nonce}`;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(expectedPayload)
    .digest('base64url');

  const bufSig = Buffer.from(sig, 'utf8');
  const bufExpected = Buffer.from(expectedSig, 'utf8');

  if (bufSig.length !== bufExpected.length) return false;
  return crypto.timingSafeEqual(bufSig, bufExpected);
}

/**
 * Parse Cookie header into a key-value map.
 * @param {string|undefined} cookieHeader 
 * @returns {Record<string, string>}
 */
export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return cookies;

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.substring(0, idx).trim();
    const val = pair.substring(idx + 1).trim();
    if (!key) continue;
    cookies[key] = decodeURIComponent(val);
  }
  return cookies;
}

/**
 * Serialize a cookie string with security options.
 * @param {string} name 
 * @param {string} val 
 * @param {object} options 
 * @returns {string}
 */
export function serializeCookie(name, val, options = {}) {
  let cookie = `${name}=${encodeURIComponent(val)}`;
  if (options.maxAge) cookie += `; Max-Age=${options.maxAge}`;
  if (options.path) cookie += `; Path=${options.path}`;
  if (options.httpOnly) cookie += `; HttpOnly`;
  if (options.secure) cookie += `; Secure`;
  if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;
  return cookie;
}

/**
 * Retrieve the active session secret with security validation.
 * @returns {string} Secret key
 */
export function getSessionSecret() {
  const secret = process.env.SITE_LOCK_SESSION_SECRET;
  if (secret && typeof secret === 'string' && Buffer.byteLength(secret, 'utf8') >= 32) {
    return secret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('CRITICAL_CONFIGURATION_ERROR: SITE_LOCK_SESSION_SECRET must be configured with at least 32 bytes in production.');
  }

  // Non-production fallback for development/tests
  if (!devFallbackSecret) {
    devFallbackSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[SiteLock] Warning: Using ephemeral session secret in non-production environment.');
  }
  return devFallbackSecret;
}

/**
 * Initialize Supabase Server Client with service role privileges.
 * @param {object|null} customClient Client override for testing
 * @returns {object} Supabase Client
 */
export function getSupabase(customClient = null) {
  if (customClient) return customClient;

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase server configuration error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

/**
 * Verify whether an incoming request bearer token belongs to a verified administrator.
 * Validates via auth.getUser() and public.admin_users table or app_metadata.role.
 * @param {object} supabase 
 * @param {string|undefined} authHeader 
 * @returns {Promise<{ authorized: boolean, user?: object, error?: string, status: number }>}
 */
export async function verifyAdminSession(supabase, authHeader) {
  if (!authHeader || typeof authHeader !== 'string') {
    return { authorized: false, error: 'Authorization header is required.', status: 401 };
  }

  const parts = authHeader.trim().split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return { authorized: false, error: 'Malformed Bearer token.', status: 401 };
  }
  const token = parts[1];

  try {
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData || !userData.user) {
      return { authorized: false, error: 'Invalid or expired authentication session.', status: 401 };
    }

    const user = userData.user;

    // 1. Check trusted JWT app_metadata.role
    if (user.app_metadata && user.app_metadata.role === 'admin') {
      return { authorized: true, user, status: 200 };
    }

    // 2. Query public.admin_users table
    const { data: adminRow, error: adminErr } = await supabase
      .from('admin_users')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (adminErr) {
      console.error('[SiteLock] Admin table verification error:', adminErr.message);
      return { authorized: false, error: 'Database verification failure.', status: 500 };
    }

    if (adminRow && adminRow.user_id === user.id) {
      return { authorized: true, user, status: 200 };
    }

    return { authorized: false, error: 'Forbidden: Administrator privileges required.', status: 403 };
  } catch (err) {
    console.error('[SiteLock] Unexpected admin verification error:', err.message);
    return { authorized: false, error: 'Internal authorization error.', status: 500 };
  }
}

/**
 * Safely parse JSON request body (works in Vercel serverless and raw Node.js streams).
 * @param {object} req 
 * @returns {Promise<object>}
 */
async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

/**
 * Primary Vercel Serverless Function Handler
 */
export default async function handler(req, res) {
  // CORS & Security Headers
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  let sessionSecret;
  try {
    sessionSecret = getSessionSecret();
  } catch (err) {
    console.error('[SiteLock] Configuration error:', err.message);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  let supabase;
  try {
    supabase = getSupabase(req._customSupabase || null);
  } catch (err) {
    console.error('[SiteLock] Supabase client initialization error:', err.message);
    return res.status(500).json({ error: 'Database service unavailable.', is_locked: true, is_unlocked: false });
  }

  // ---------------------------------------------------------------------------
  // GET /api/site-lock: Retrieve Lock Status & Verify Unlock Session
  // ---------------------------------------------------------------------------
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('site_settings')
        .select('is_locked')
        .eq('id', 1)
        .single();

      if (error || !data) {
        console.error('[SiteLock] Failed to read site_settings:', error?.message);
        // Fail closed: Treat site as locked without unlock status
        return res.status(500).json({
          error: 'Failed to retrieve site lock status.',
          is_locked: true,
          is_unlocked: false
        });
      }

      const isLocked = Boolean(data.is_locked);
      if (!isLocked) {
        return res.status(200).json({
          is_locked: false,
          is_unlocked: true
        });
      }

      // If site is locked, inspect session cookie
      const cookies = parseCookies(req.headers.cookie);
      const sessionToken = cookies[COOKIE_NAME];
      const isUnlocked = verifySessionToken(sessionToken, sessionSecret);

      return res.status(200).json({
        is_locked: true,
        is_unlocked: isUnlocked
      });
    } catch (err) {
      console.error('[SiteLock] Unexpected error in GET handler:', err.message);
      return res.status(500).json({
        error: 'Internal service error.',
        is_locked: true,
        is_unlocked: false
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/site-lock: Handle Unlock or Admin Update
  // ---------------------------------------------------------------------------
  if (req.method === 'POST') {
    const body = await parseJsonBody(req);
    const action = body.action || (body.password !== undefined ? 'unlock' : 'unknown');

    // Case A: Visitor Unlock Attempt
    if (action === 'unlock') {
      const candidatePassword = typeof body.password === 'string' ? body.password.trim() : '';

      if (!candidatePassword) {
        return res.status(400).json({ success: false, error: 'Password key is required.' });
      }

      try {
        const { data, error } = await supabase
          .from('site_settings')
          .select('is_locked, lock_password')
          .eq('id', 1)
          .single();

        if (error || !data) {
          console.error('[SiteLock] Error fetching site_settings for unlock:', error?.message);
          return res.status(500).json({ success: false, error: 'Unable to verify access key. Please try again.' });
        }

        const storedPassword = data.lock_password || '';
        const { valid, needsMigration } = verifyPassword(candidatePassword, storedPassword);

        if (!valid) {
          return res.status(401).json({ success: false, error: 'Incorrect key. Please try again.' });
        }

        // Automatic Transparent Migration: Convert legacy plaintext to PBKDF2 hash
        if (needsMigration) {
          try {
            const newHash = hashPassword(candidatePassword);
            await supabase
              .from('site_settings')
              .update({
                lock_password: newHash,
                updated_at: new Date().toISOString()
              })
              .eq('id', 1);
            console.log('[SiteLock] Successfully migrated legacy plaintext password to PBKDF2 hash.');
          } catch (migrateErr) {
            console.warn('[SiteLock] Failed to persist migrated password hash:', migrateErr.message);
          }
        }

        // Issue cryptographically signed HttpOnly session cookie
        const token = createSessionToken(sessionSecret, COOKIE_MAX_AGE_SECONDS);
        const isSecure = process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
        const cookieString = serializeCookie(COOKIE_NAME, token, {
          maxAge: COOKIE_MAX_AGE_SECONDS,
          path: '/',
          httpOnly: true,
          secure: isSecure,
          sameSite: 'Lax'
        });

        res.setHeader('Set-Cookie', cookieString);
        return res.status(200).json({
          success: true,
          message: 'Site unlocked successfully.'
        });
      } catch (err) {
        console.error('[SiteLock] Unexpected error during unlock:', err.message);
        return res.status(500).json({ success: false, error: 'Something went wrong during verification.' });
      }
    }

    // Case B: Administrator Update (Toggle lock status or set new password)
    if (action === 'admin_update') {
      const authHeader = req.headers.authorization || req.headers.Authorization;
      const adminAuth = await verifyAdminSession(supabase, authHeader);

      if (!adminAuth.authorized) {
        return res.status(adminAuth.status).json({ success: false, error: adminAuth.error });
      }

      const { is_locked, new_password } = body;
      const updatePayload = {
        updated_at: new Date().toISOString()
      };

      if (typeof is_locked === 'boolean') {
        updatePayload.is_locked = is_locked;
      }

      // If a non-empty new_password is supplied, hash it before writing
      if (typeof new_password === 'string' && new_password.trim() !== '') {
        updatePayload.lock_password = hashPassword(new_password.trim());
      }
      // If new_password is empty string or omitted, lock_password is left untouched

      try {
        const { error: updateErr } = await supabase
          .from('site_settings')
          .update(updatePayload)
          .eq('id', 1);

        if (updateErr) {
          console.error('[SiteLock] Error updating site_settings:', updateErr.message);
          return res.status(500).json({ success: false, error: 'Failed to update site settings in database.' });
        }

        return res.status(200).json({
          success: true,
          message: 'Site settings updated successfully.',
          is_locked: updatePayload.is_locked !== undefined ? updatePayload.is_locked : undefined
        });
      } catch (err) {
        console.error('[SiteLock] Unexpected error during admin update:', err.message);
        return res.status(500).json({ success: false, error: 'Internal error updating site settings.' });
      }
    }

    return res.status(400).json({ error: `Unknown action: '${action}'.` });
  }

  // Fallthrough: Method Not Allowed
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: `Method ${req.method} not allowed.` });
}
