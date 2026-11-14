/**
 * MovieVerify Site-Lock Verification & Management API
 * 
 * Verifies the site access key server-side with:
 * 1. Brute-force protection (In-memory IP rate limiter: max 5 failed attempts per 15 min).
 * 2. Constant-time secret comparison (timingSafeCompare) to prevent timing side channels.
 * 3. Zero client credential exposure (lock_password never sent to client).
 * 4. Authenticated admin management (Lock/Unlock toggle & access key update via service_role).
 */

import crypto from 'crypto';
import { getSupabaseServerClient } from '../_lib/supabaseServer.js';
import { parseJsonBody, sendJson } from '../_lib/requestUtils.js';
import { authenticateRequest } from '../_lib/authMiddleware.js';
import { isServerSideAdmin } from '../_lib/campaignService.js';

// In-memory rate limiting map: ip -> { count: number, blockedUntil: number }
const rateLimitStore = new Map();
const MAX_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Constant-time string comparison using SHA-256 pre-hashing
 * @param {string} a 
 * @param {string} b 
 * @returns {boolean}
 */
export function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = crypto.createHash('sha256').update(a).digest();
  const bufB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Resolves client IP address from standard headers
 * @param {object} req 
 * @returns {string}
 */
export function getClientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded && typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.headers?.['x-real-ip'] || req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Check and record failed attempt for an IP
 * @param {string} ip 
 * @returns {{ blocked: boolean, remaining: number, retryAfterSeconds?: number }}
 */
export function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitStore.get(ip);

  if (record) {
    if (record.blockedUntil && record.blockedUntil > now) {
      const retryAfterSeconds = Math.ceil((record.blockedUntil - now) / 1000);
      return { blocked: true, remaining: 0, retryAfterSeconds };
    }
    // Block expired, reset record
    if (record.blockedUntil && record.blockedUntil <= now) {
      rateLimitStore.delete(ip);
    }
  }

  const currentCount = record ? record.count : 0;
  return { blocked: false, remaining: Math.max(0, MAX_ATTEMPTS - currentCount) };
}

/**
 * Record a failed attempt
 * @param {string} ip 
 * @returns {{ blocked: boolean, remaining: number, retryAfterSeconds?: number }}
 */
export function recordFailedAttempt(ip) {
  const now = Date.now();
  const record = rateLimitStore.get(ip) || { count: 0, blockedUntil: 0 };
  record.count += 1;

  if (record.count >= MAX_ATTEMPTS) {
    record.blockedUntil = now + BLOCK_DURATION_MS;
    rateLimitStore.set(ip, record);
    return { blocked: true, remaining: 0, retryAfterSeconds: Math.ceil(BLOCK_DURATION_MS / 1000) };
  }

  rateLimitStore.set(ip, record);
  return { blocked: false, remaining: MAX_ATTEMPTS - record.count };
}

/**
 * Clear rate limit for IP upon successful authentication
 * @param {string} ip 
 */
export function clearRateLimit(ip) {
  rateLimitStore.delete(ip);
}

/**
 * Handler for POST /api/site-lock/verify
 * @param {object} req 
 * @param {object} res 
 * @param {object|null} customSupabase Optional client override for testing
 */
export default async function handler(req, res, customSupabase = null) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed. Use POST.' });
  }

  const body = await parseJsonBody(req);

  // 1. Admin Management Action (Lock / Unlock / Set Key / Reset via service_role)
  if (body?.action === 'toggle' || body?.action === 'update' || body?.action === 'status' || body?.action === 'reset') {
    const auth = await authenticateRequest(req, customSupabase);
    if (!auth.authenticated || !auth.user) {
      return sendJson(res, 401, { error: auth.error || 'Administrator authentication required.' });
    }

    const isAdmin = await isServerSideAdmin(auth.user, customSupabase);
    if (!isAdmin) {
      return sendJson(res, 403, { error: 'Forbidden: administrator credentials required.' });
    }

    const supabase = getSupabaseServerClient(customSupabase);

    if (body.action === 'reset') {
      const resetPayload = {
        lock_password: '',
        is_locked: false,
        updated_at: new Date().toISOString()
      };

      if (body.lock_password && typeof body.lock_password === 'string' && body.lock_password.trim()) {
        resetPayload.lock_password = body.lock_password.trim();
      }

      const { error: resetErr } = await supabase
        .from('site_settings')
        .update(resetPayload)
        .eq('id', 1);

      if (resetErr) {
        console.error('[SiteLock] Admin reset error:', resetErr.message);
        return sendJson(res, 500, { error: 'Database reset failed: ' + resetErr.message });
      }

      return sendJson(res, 200, {
        success: true,
        is_locked: false,
        has_password: Boolean(resetPayload.lock_password),
        message: resetPayload.lock_password
          ? 'Access key reset and new password set successfully.'
          : 'Access key reset successfully. Site has been unlocked.'
      });
    }

    if (body.action === 'status') {
      const { data, error: fetchErr } = await supabase
        .from('site_settings')
        .select('is_locked, lock_password, updated_at')
        .eq('id', 1)
        .single();

      if (fetchErr) {
        return sendJson(res, 500, { error: 'Failed to fetch status: ' + fetchErr.message });
      }

      const hasPassword = Boolean(data?.lock_password && String(data.lock_password).trim());

      return sendJson(res, 200, {
        success: true,
        is_locked: Boolean(data?.is_locked),
        has_password: hasPassword,
        updated_at: data?.updated_at
      });
    }

    const updatePayload = {
      updated_at: new Date().toISOString()
    };

    if (body.action === 'toggle') {
      if (typeof body.is_locked === 'boolean') {
        updatePayload.is_locked = body.is_locked;
      } else {
        const { data: currentSettings } = await supabase
          .from('site_settings')
          .select('is_locked')
          .eq('id', 1)
          .single();
        updatePayload.is_locked = !Boolean(currentSettings?.is_locked);
      }
    } else if (body.is_locked !== undefined) {
      updatePayload.is_locked = Boolean(body.is_locked);
    }

    if (body.lock_password && typeof body.lock_password === 'string' && body.lock_password.trim()) {
      updatePayload.lock_password = body.lock_password.trim();
    }

    // Strict Guard: Prevent locking site if no access key is provided and no access key exists in DB
    if (updatePayload.is_locked === true) {
      const newPass = updatePayload.lock_password && String(updatePayload.lock_password).trim();
      if (!newPass) {
        const { data: currentSettings } = await supabase
          .from('site_settings')
          .select('lock_password')
          .eq('id', 1)
          .single();
        const existingPass = currentSettings?.lock_password && String(currentSettings.lock_password).trim();
        if (!existingPass) {
          return sendJson(res, 400, {
            error: 'Pehle access key set karein! Cannot lock site without an access key.'
          });
        }
      }
    }

    const { error: updateErr } = await supabase
      .from('site_settings')
      .update(updatePayload)
      .eq('id', 1);

    if (updateErr) {
      console.error('[SiteLock] Admin update error:', updateErr.message);
      return sendJson(res, 500, { error: 'Database update failed: ' + updateErr.message });
    }

    return sendJson(res, 200, {
      success: true,
      is_locked: updatePayload.is_locked,
      message: updatePayload.is_locked === true
        ? 'Site locked successfully.'
        : (updatePayload.is_locked === false ? 'Site unlocked successfully.' : 'Site settings updated.')
    });
  }

  // 2. Visitor Access Verification
  const clientIp = getClientIp(req);
  const rateLimitStatus = checkRateLimit(clientIp);

  if (rateLimitStatus.blocked) {
    res.setHeader('Retry-After', String(rateLimitStatus.retryAfterSeconds || 900));
    return sendJson(res, 429, {
      error: `Too many failed attempts. Access blocked for ${Math.ceil((rateLimitStatus.retryAfterSeconds || 900) / 60)} minutes.`,
      retry_after_seconds: rateLimitStatus.retryAfterSeconds
    });
  }
  const password = body?.password;

  if (!password || typeof password !== 'string' || !password.trim()) {
    return sendJson(res, 400, { error: 'Access key is required.' });
  }

  try {
    const supabase = getSupabaseServerClient(customSupabase);

    // Fetch site lock settings using service-role client
    const { data, error } = await supabase
      .from('site_settings')
      .select('is_locked, lock_password')
      .eq('id', 1)
      .single();

    if (error) {
      console.error('[SiteLock] Database error:', error.message);
      return sendJson(res, 500, { error: 'Unable to verify access key at this time.' });
    }

    // If site is not currently locked, allow entry
    if (!data?.is_locked) {
      clearRateLimit(clientIp);
      return sendJson(res, 200, { success: true, site_locked: false });
    }

    const actualPassword = String(data.lock_password || '').trim();
    const inputClean = String(password || '').trim();
    const inputSha256 = crypto.createHash('sha256').update(inputClean).digest('hex');
    const isDirectMatch = timingSafeCompare(inputClean, actualPassword);
    const isHashMatch = timingSafeCompare(inputSha256, actualPassword);
    const isMatch = isDirectMatch || isHashMatch;

    if (!isMatch) {
      const failStatus = recordFailedAttempt(clientIp);
      if (failStatus.blocked) {
        res.setHeader('Retry-After', String(failStatus.retryAfterSeconds || 900));
        return sendJson(res, 429, {
          error: 'Too many failed attempts. Access temporarily blocked for 15 minutes.',
          retry_after_seconds: failStatus.retryAfterSeconds
        });
      }
      return sendJson(res, 401, {
        error: 'Incorrect access key. Please try again.',
        attempts_remaining: failStatus.remaining
      });
    }

    // Authentication succeeded
    clearRateLimit(clientIp);

    // Generate secure session token
    const secretKey = process.env.SITE_LOCK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'mv_site_lock_fallback_key';
    const token = crypto
      .createHmac('sha256', secretKey)
      .update(`${clientIp}:${Date.now()}`)
      .digest('hex');

    return sendJson(res, 200, {
      success: true,
      site_locked: true,
      token
    });
  } catch (err) {
    console.error('[SiteLock] Verification exception:', err.message);
    return sendJson(res, 500, { error: 'Internal server verification error.' });
  }
}

