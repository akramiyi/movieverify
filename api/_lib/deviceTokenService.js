/**
 * MovieVerify Device Token Management Service
 * 
 * Implements business logic for secure device token registration and revocation.
 * - Computes cryptographic SHA-256 token hash.
 * - Enforces authenticated user ownership (never trusts client-supplied user IDs).
 * - Enforces database uniqueness and deterministic ownership transfer.
 * - Sanitizes device/browser metadata.
 * - Strictly avoids logging raw FCM tokens.
 */

import crypto from 'node:crypto';
import { getSupabaseServerClient } from './supabaseServer.js';

const ALLOWED_DEVICE_TYPES = ['web', 'android', 'ios'];
const MAX_DEVICE_NAME_LENGTH = 128;
const MAX_BROWSER_LENGTH = 64;
const MAX_OS_LENGTH = 64;
const MIN_TOKEN_LENGTH = 16;
const MAX_TOKEN_LENGTH = 4096;

/**
 * Compute SHA-256 hash of FCM raw device token
 * @param {string} token Raw FCM registration token
 * @returns {string} Hex-encoded SHA-256 digest
 */
export function hashToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid token provided for hashing');
  }
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

/**
 * Mask raw token for safe debugging/logging (shows first 6 and last 4 chars)
 * @param {string} token 
 * @returns {string}
 */
export function maskToken(token) {
  if (!token || typeof token !== 'string') return '[invalid]';
  const clean = token.trim();
  if (clean.length <= 12) return '***';
  return `${clean.substring(0, 6)}...${clean.substring(clean.length - 4)}`;
}

/**
 * Sanitize text inputs for metadata storage
 * @param {any} val 
 * @param {number} maxLen 
 * @returns {string|null}
 */
function sanitizeString(val, maxLen = MAX_DEVICE_NAME_LENGTH) {
  if (!val || typeof val !== 'string') return null;
  const clean = val.trim();
  if (!clean) return null;
  return clean.substring(0, maxLen);
}

/**
 * Ensures a default user_notification_preferences record exists for the subscriber.
 * Non-fatal: safely ignored if table or client mock does not implement it.
 * @param {object} supabase 
 * @param {string} userId 
 */
async function seedUserPreferencesSafely(supabase, userId) {
  if (!supabase || !userId) return;
  try {
    if (typeof supabase.from === 'function') {
      await supabase
        .from('user_notification_preferences')
        .upsert(
          {
            user_id: userId,
            opt_in_all: true,
            notify_new_movies: true,
            notify_new_series: true,
            notify_movie_updates: true,
            notify_promotions: false,
            notify_system: true,
            channel_in_app: true,
            channel_push: true,
            max_daily_push: 20,
          },
          { onConflict: 'user_id', ignoreDuplicates: true }
        );
    }
  } catch {
    // Non-fatal if table mock throws or user preferences already exist
  }
}

/**
 * Validate token registration payload
 * @param {object} payload 
 * @returns {{ valid: boolean, error?: string, sanitized?: object }}
 */
export function validateRegistrationPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object.' };
  }

  const { token, device_type, device_name, browser, os, reauthorize } = payload;

  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Device token is required and must be a string.' };
  }

  const cleanToken = token.trim();
  if (cleanToken.length < MIN_TOKEN_LENGTH || cleanToken.length > MAX_TOKEN_LENGTH) {
    return { 
      valid: false, 
      error: `Device token length must be between ${MIN_TOKEN_LENGTH} and ${MAX_TOKEN_LENGTH} characters.` 
    };
  }

  const cleanDeviceType = (device_type && typeof device_type === 'string') 
    ? device_type.trim().toLowerCase() 
    : 'web';

  if (!ALLOWED_DEVICE_TYPES.includes(cleanDeviceType)) {
    return { 
      valid: false, 
      error: `Invalid device_type '${device_type}'. Supported: ${ALLOWED_DEVICE_TYPES.join(', ')}.` 
    };
  }

  return {
    valid: true,
    sanitized: {
      token: cleanToken,
      deviceType: cleanDeviceType,
      deviceName: sanitizeString(device_name, MAX_DEVICE_NAME_LENGTH),
      browser: sanitizeString(browser, MAX_BROWSER_LENGTH),
      os: sanitizeString(os, MAX_OS_LENGTH),
      reauthorize: reauthorize === true,
    },
  };
}

/**
 * Register or update an FCM device token for the authenticated user
 * @param {object} authenticatedUser Authenticated Supabase user object
 * @param {object} payload Request payload
 * @param {object|null} customSupabase Optional client override for testing
 * @returns {Promise<{ success: boolean, data?: object, error?: string, status: number }>}
 */
export async function registerDeviceToken(authenticatedUser, payload, customSupabase = null) {
  if (!authenticatedUser || !authenticatedUser.id) {
    return { success: false, error: 'Unauthorized: Valid user identity required.', status: 401 };
  }

  const validation = validateRegistrationPayload(payload);
  if (!validation.valid) {
    return { success: false, error: validation.error, status: 400 };
  }

  const { token, deviceType, deviceName, browser, os, reauthorize } = validation.sanitized;
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();

  try {
    const supabase = getSupabaseServerClient(customSupabase);

    // 1. Check for existing token record by unique token_hash
    const { data: existing, error: fetchErr } = await supabase
      .from('notification_tokens')
      .select('id, user_id, is_active, revoked_at, device_name, browser, os')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (fetchErr) {
      console.error('[DeviceTokenService] Database query error for token_hash:', tokenHash, fetchErr.message);
      return { success: false, error: 'Database error querying device token status.', status: 500 };
    }

    if (!existing) {
      // 2. New token registration
      const { data: inserted, error: insertErr } = await supabase
        .from('notification_tokens')
        .insert({
          user_id: authenticatedUser.id,
          token,
          token_hash: tokenHash,
          device_type: deviceType,
          device_name: deviceName,
          browser,
          os,
          is_active: true,
          revoked_at: null,
          last_seen_at: now,
          created_at: now,
          updated_at: now,
        })
        .select('id, token_hash, device_type, is_active, created_at')
        .single();

      if (insertErr) {
        console.error('[DeviceTokenService] Token insertion error for hash:', tokenHash, insertErr.message);
        return { success: false, error: 'Failed to register device token.', status: 500 };
      }

      // Ensure canonical user_notification_preferences exist so this subscriber receives broadcasts
      await seedUserPreferencesSafely(supabase, authenticatedUser.id);

      return {
        success: true,
        status: 201,
        data: {
          token_id: inserted.id,
          token_hash: inserted.token_hash,
          device_type: inserted.device_type,
          is_active: inserted.is_active,
          action: 'created',
          registered_at: inserted.created_at,
        },
      };
    }

    // 3. Existing token: idempotent update, reauthorization or ownership transfer
    const isOwnershipTransfer = existing.user_id !== authenticatedUser.id;
    const isRevoked = !existing.is_active || existing.revoked_at !== null;

    // Security Guard: A revoked token MUST NOT be silently reactivated by a normal heartbeat.
    // Explicit reauthorization (reauthorize: true) is required.
    if (isRevoked && !isOwnershipTransfer && !reauthorize) {
      return {
        success: false,
        status: 409,
        error: 'Device token is revoked. Explicit reauthorization required.',
        code: 'TOKEN_REVOKED',
        data: {
          token_id: existing.id,
          token_hash: tokenHash,
          device_type: existing.device_type || deviceType,
          is_active: false,
          revoked_at: existing.revoked_at,
          requires_reauthorization: true,
        },
      };
    }

    const updatePayload = {
      user_id: authenticatedUser.id,
      token, // Ensures sync trigger fires if token updated
      device_type: deviceType,
      device_name: deviceName || existing.device_name,
      browser: browser || existing.browser,
      os: os || existing.os,
      is_active: true,
      revoked_at: null, // Clear revocation timestamp upon valid activation or reauthorization
      last_seen_at: now,
      updated_at: now,
    };

    let updateQuery = supabase
      .from('notification_tokens')
      .update(updatePayload)
      .eq('id', existing.id);

    // Optimistic Concurrency Guard:
    // If the token was believed to be active, ensure it was not concurrently revoked.
    if (!isRevoked) {
      updateQuery = updateQuery.eq('is_active', true);
    }

    const { data: updated, error: updateErr } = await updateQuery
      .select('id, token_hash, device_type, is_active, updated_at')
      .single();

    if (updateErr) {
      // Concurrency race: token was revoked concurrently between SELECT and UPDATE
      if (!isRevoked && (updateErr.code === 'PGRST116' || updateErr.message?.includes('0 rows'))) {
        return {
          success: false,
          status: 409,
          error: 'Device token was revoked concurrently. Explicit reauthorization required.',
          code: 'TOKEN_REVOKED_CONCURRENT',
          data: {
            token_id: existing.id,
            token_hash: tokenHash,
            is_active: false,
            requires_reauthorization: true,
          },
        };
      }
      console.error('[DeviceTokenService] Token update error for id:', existing.id, updateErr.message);
      return { success: false, error: 'Failed to update device token.', status: 500 };
    }

    let action = 'refreshed';
    if (isOwnershipTransfer) {
      action = 'transferred';
    } else if (isRevoked && reauthorize) {
      action = 'reauthorized';
    }

    // Ensure canonical user_notification_preferences exist so this subscriber receives broadcasts
    await seedUserPreferencesSafely(supabase, authenticatedUser.id);

    return {
      success: true,
      status: 200,
      data: {
        token_id: updated.id,
        token_hash: updated.token_hash,
        device_type: updated.device_type,
        is_active: updated.is_active,
        action,
        registered_at: updated.updated_at,
      },
    };
  } catch (err) {
    console.error('[DeviceTokenService] Unexpected exception during token registration:', err.message);
    return { success: false, error: 'Internal server error processing device token registration.', status: 500 };
  }
}

/**
 * Revoke/unregister an FCM device token for the authenticated user
 * @param {object} authenticatedUser Authenticated Supabase user object
 * @param {object} payload Request payload with { token, token_id, token_hash }
 * @param {object|null} customSupabase Optional client override for testing
 * @returns {Promise<{ success: boolean, data?: object, error?: string, status: number }>}
 */
export async function revokeDeviceToken(authenticatedUser, payload, customSupabase = null) {
  if (!authenticatedUser || !authenticatedUser.id) {
    return { success: false, error: 'Unauthorized: Valid user identity required.', status: 401 };
  }

  if (!payload || typeof payload !== 'object') {
    return { success: false, error: 'Request body must specify token, token_id, or token_hash.', status: 400 };
  }

  const { token, token_id, token_hash } = payload;

  if (!token && !token_id && !token_hash) {
    return { success: false, error: 'At least one of token, token_id, or token_hash must be provided.', status: 400 };
  }

  try {
    const supabase = getSupabaseServerClient(customSupabase);
    let query = supabase.from('notification_tokens').select('id, user_id, is_active, revoked_at, token_hash');

    if (token_id) {
      query = query.eq('id', token_id);
    } else if (token_hash) {
      query = query.eq('token_hash', token_hash);
    } else if (token) {
      const computedHash = hashToken(token);
      query = query.eq('token_hash', computedHash);
    }

    const { data: record, error: fetchErr } = await query.maybeSingle();

    if (fetchErr) {
      console.error('[DeviceTokenService] Database query error on revoke:', fetchErr.message);
      return { success: false, error: 'Database error locating device token for revocation.', status: 500 };
    }

    if (!record) {
      // Idempotent: token not found is treated as already deactivated
      return {
        success: true,
        status: 200,
        data: {
          is_active: false,
          action: 'not_found_or_already_revoked',
        },
      };
    }

    // Ownership Enforcement: user can only revoke their own tokens
    if (record.user_id !== authenticatedUser.id) {
      return {
        success: false,
        error: 'Forbidden: You do not own this device token and cannot revoke it.',
        status: 403,
      };
    }

    // If already inactive and revoked_at is recorded, return idempotent success
    if (!record.is_active && record.revoked_at !== null) {
      return {
        success: true,
        status: 200,
        data: {
          token_id: record.id,
          token_hash: record.token_hash,
          is_active: false,
          action: 'already_inactive',
          revoked_at: record.revoked_at,
        },
      };
    }

    // Revoke token by setting is_active = false and recording timestamp
    const now = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from('notification_tokens')
      .update({
        is_active: false,
        revoked_at: now,
        updated_at: now,
      })
      .eq('id', record.id);

    if (updateErr) {
      console.error('[DeviceTokenService] Database update error on revoke for id:', record.id, updateErr.message);
      return { success: false, error: 'Failed to revoke device token.', status: 500 };
    }

    return {
      success: true,
      status: 200,
      data: {
        token_id: record.id,
        token_hash: record.token_hash,
        is_active: false,
        action: 'revoked',
        revoked_at: now,
      },
    };
  } catch (err) {
    console.error('[DeviceTokenService] Unexpected exception during token revocation:', err.message);
    return { success: false, error: 'Internal server error processing device token revocation.', status: 500 };
  }
}

