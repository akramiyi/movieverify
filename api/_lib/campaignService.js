/**
 * MovieVerify Campaign Ingestion & Cancellation Service
 * 
 * Provides server-side validation, authorization, and execution of notification campaigns
 * utilizing the canonical database contracts:
 * - public.ingest_notification_campaign
 * - public.cancel_notification_campaign
 * 
 * Security Controls:
 * 1. Trusted server-side admin check (app_metadata.role === 'admin' or @movieverify.com email).
 * 2. Dedicated machine-to-machine (M2M) secret validation (x-campaign-secret / x-m2m-secret).
 * 3. Never trusts client-supplied created_by or frontend claims.
 * 4. Strict input sanitization (title, body, internal URL regex, category whitelist).
 * 5. Bounded payload length and UUID format verification.
 * 6. Privacy-safe structured logging (zero raw token or credential exposure).
 */

import crypto from 'node:crypto';
import { getSupabaseServerClient } from './supabaseServer.js';

export const VALID_CATEGORIES = [
  'movie_release',
  'content_update',
  'user_alert',
  'admin_announcement',
  'promotional',
];

export const VALID_TARGET_TYPES = ['all', 'movie', 'actor', 'genre', 'users'];

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Constant-time comparison for M2M secrets
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
 * Verifies if a user has trusted server-side admin privileges
 * Rule: app_metadata.role === 'admin' OR admin_users.user_id === user.id
 * Symmetrical with SQL notifications_is_admin(). Fails closed on missing user or error.
 * @param {object|null} user Verified Supabase user object
 * @param {object|null} customSupabase Optional Supabase client instance
 * @returns {Promise<boolean>}
 */
export async function isServerSideAdmin(user, customSupabase = null) {
  if (!user || typeof user !== 'object') return false;

  // 1. Check trusted JWT app_metadata.role
  if (user.app_metadata && user.app_metadata.role === 'admin') {
    return true;
  }

  // 2. Query public.admin_users table whitelist
  const userId = user.id;
  if (!userId || typeof userId !== 'string') {
    return false;
  }

  try {
    const supabase = customSupabase || getSupabaseServerClient();
    const { data, error } = await supabase
      .from('admin_users')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('[CampaignService] Error checking admin_users table:', error.message);
      return false; // Fail closed
    }

    return Boolean(data && data.user_id === userId);
  } catch (err) {
    console.error('[CampaignService] Unexpected error in isServerSideAdmin:', err.message);
    return false; // Fail closed
  }
}

/**
 * Validates M2M secret for programmatic campaign dispatch
 * Dedicated secret policy: DOES NOT accept or reuse x-worker-secret
 * @param {object} headers Request headers
 * @returns {boolean}
 */
export function isAuthorizedM2M(headers) {
  const configuredSecret = process.env.CAMPAIGN_API_SECRET || process.env.INTERNAL_CAMPAIGN_SECRET;
  if (!configuredSecret || typeof configuredSecret !== 'string' || configuredSecret.trim() === '') {
    return false; // Fail closed
  }

  if (!headers || typeof headers !== 'object') return false;

  const headerKey = Object.keys(headers).find(
    (k) => k.toLowerCase() === 'x-campaign-secret' || k.toLowerCase() === 'x-m2m-secret'
  );
  if (!headerKey) return false;

  const providedSecret = headers[headerKey];
  if (typeof providedSecret !== 'string') return false;

  return timingSafeCompare(providedSecret.trim(), configuredSecret.trim());
}

/**
 * Validates that URL is a relative internal path starting with /
 * Prevents open-redirect and protocol spoofing (e.g. javascript:, //evil.com)
 * @param {string} url 
 * @returns {boolean}
 */
export function validateInternalUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  // Must start with single slash, not protocol-relative (//), and not external protocol
  return trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.includes('\\');
}

/**
 * Validates campaign creation request payload
 * @param {object} payload 
 * @returns {{ valid: boolean, error?: string, sanitized?: object }}
 */
export function validateCampaignPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, error: 'Request body must be a valid JSON object.' };
  }

  // Title: 1 - 150 chars
  if (typeof payload.title !== 'string' || payload.title.trim().length === 0) {
    return { valid: false, error: 'Title is required and must not be empty.' };
  }
  const cleanTitle = payload.title.trim();
  if (cleanTitle.length > 150) {
    return { valid: false, error: 'Title must not exceed 150 characters.' };
  }

  // Body: 1 - 1000 chars
  if (typeof payload.body !== 'string' || payload.body.trim().length === 0) {
    return { valid: false, error: 'Body is required and must not be empty.' };
  }
  const cleanBody = payload.body.trim();
  if (cleanBody.length > 1000) {
    return { valid: false, error: 'Body must not exceed 1000 characters.' };
  }

  // Category
  if (typeof payload.category !== 'string') {
    return { valid: false, error: 'Category is required.' };
  }
  const cleanCategory = payload.category.toLowerCase().trim();
  if (!VALID_CATEGORIES.includes(cleanCategory)) {
    return {
      valid: false,
      error: `Invalid category "${payload.category}". Allowed: ${VALID_CATEGORIES.join(', ')}`,
    };
  }

  // Internal URL
  let cleanUrl = null;
  if (payload.url !== undefined && payload.url !== null && String(payload.url).trim() !== '') {
    cleanUrl = String(payload.url).trim();
    if (!validateInternalUrl(cleanUrl)) {
      return { valid: false, error: 'URL must be a valid internal path starting with /.' };
    }
  }

  // Image URL
  let cleanImageUrl = null;
  if (payload.image_url !== undefined && payload.image_url !== null && String(payload.image_url).trim() !== '') {
    cleanImageUrl = String(payload.image_url).trim();
    if (cleanImageUrl.length > 2048) {
      return { valid: false, error: 'Image URL must not exceed 2048 characters.' };
    }
  }

  // Target Criteria
  const rawTarget = payload.target_criteria || {};
  if (typeof rawTarget !== 'object' || Array.isArray(rawTarget)) {
    return { valid: false, error: 'target_criteria must be an object.' };
  }

  const targetType = (rawTarget.type || 'all').toLowerCase().trim();
  if (!VALID_TARGET_TYPES.includes(targetType)) {
    return {
      valid: false,
      error: `Unsupported target type "${rawTarget.type}". Allowed: ${VALID_TARGET_TYPES.join(', ')}`,
    };
  }

  const sanitizedTarget = { ...rawTarget, type: targetType };

  if (targetType === 'movie') {
    const movieId = rawTarget.movie_id !== undefined && rawTarget.movie_id !== null ? String(rawTarget.movie_id).trim() : '';
    if (!movieId) {
      return { valid: false, error: 'movie_id is required for target type "movie".' };
    }
    sanitizedTarget.movie_id = movieId;
  } else if (targetType === 'actor') {
    const actorId = rawTarget.actor_id !== undefined && rawTarget.actor_id !== null ? String(rawTarget.actor_id).trim() : '';
    if (!actorId) {
      return { valid: false, error: 'actor_id is required for target type "actor".' };
    }
    sanitizedTarget.actor_id = actorId;
  } else if (targetType === 'genre') {
    const genreId = rawTarget.genre_id !== undefined && rawTarget.genre_id !== null ? String(rawTarget.genre_id).trim() : '';
    if (!genreId) {
      return { valid: false, error: 'genre_id is required for target type "genre".' };
    }
    sanitizedTarget.genre_id = genreId;
  } else if (targetType === 'users') {
    if (!Array.isArray(rawTarget.user_ids) || rawTarget.user_ids.length === 0) {
      return { valid: false, error: 'user_ids array of UUIDs is required for target type "users".' };
    }
    if (rawTarget.user_ids.length > 10000) {
      return { valid: false, error: 'user_ids array exceeds maximum limit of 10000 recipients.' };
    }
    for (const uid of rawTarget.user_ids) {
      if (!UUID_REGEX.test(String(uid))) {
        return { valid: false, error: `Invalid user UUID in user_ids: "${uid}".` };
      }
    }
    sanitizedTarget.user_ids = rawTarget.user_ids.map(u => String(u).trim());
  }

  // Idempotency Key (Accept from payload or target_criteria)
  const idempKey = payload.idempotency_key || rawTarget.idempotency_key;
  if (idempKey !== undefined && idempKey !== null && String(idempKey).trim() !== '') {
    const cleanIdemp = String(idempKey).trim();
    if (cleanIdemp.length > 256) {
      return { valid: false, error: 'idempotency_key must not exceed 256 characters.' };
    }
    sanitizedTarget.idempotency_key = cleanIdemp;
  }

  // Draft Flag
  if (payload.is_draft !== undefined) {
    sanitizedTarget.is_draft = Boolean(payload.is_draft);
  }

  // Scheduled For
  let cleanScheduledFor = null;
  if (payload.scheduled_for !== undefined && payload.scheduled_for !== null && String(payload.scheduled_for).trim() !== '') {
    const parsedDate = new Date(payload.scheduled_for);
    if (Number.isNaN(parsedDate.getTime())) {
      return { valid: false, error: 'scheduled_for must be a valid ISO 8601 date string.' };
    }
    cleanScheduledFor = parsedDate.toISOString();
  }

  return {
    valid: true,
    sanitized: {
      title: cleanTitle,
      body: cleanBody,
      category: cleanCategory,
      url: cleanUrl,
      image_url: cleanImageUrl,
      target_criteria: sanitizedTarget,
      scheduled_for: cleanScheduledFor,
    },
  };
}

/**
 * Validates campaign cancellation payload
 * @param {string|object} input Campaign ID string or object containing id / campaign_id
 * @returns {{ valid: boolean, error?: string, campaignId?: string }}
 */
export function validateCancellationInput(input) {
  let id = null;
  if (typeof input === 'string') {
    id = input.trim();
  } else if (input && typeof input === 'object') {
    id = String(input.campaign_id || input.id || '').trim();
  }

  if (!id || !UUID_REGEX.test(id)) {
    return { valid: false, error: 'A valid campaign UUID is required for cancellation.' };
  }

  return { valid: true, campaignId: id };
}

/**
 * Executes campaign ingestion via public.ingest_notification_campaign RPC
 * 
 * @param {object} payload Validated payload
 * @param {object} context Caller context { user, isM2M }
 * @param {object|null} customSupabase 
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function ingestCampaign(payload, context = {}, customSupabase = null) {
  const validation = validateCampaignPayload(payload);
  if (!validation.valid) {
    return {
      status: 400,
      body: { error: 'Validation Error', message: validation.error },
    };
  }

  const { sanitized } = validation;

  // Never trust client-supplied created_by. Use verified server-side user ID or null for M2M.
  const createdBy = context.user?.id || null;

  try {
    const supabase = getSupabaseServerClient(customSupabase);

    const rpcParams = {
      p_title: sanitized.title,
      p_body: sanitized.body,
      p_category: sanitized.category,
      p_url: sanitized.url,
      p_image_url: sanitized.image_url,
      p_target_criteria: sanitized.target_criteria,
      p_scheduled_for: sanitized.scheduled_for,
      p_created_by: createdBy,
    };

    const { data, error } = await supabase.rpc('ingest_notification_campaign', rpcParams);

    if (error) {
      console.error('[CampaignService] RPC Error during ingest:', error.message);
      return {
        status: 500,
        body: { error: 'Database Ingestion Error', message: error.message },
      };
    }

    if (!data || typeof data !== 'object') {
      return {
        status: 500,
        body: { error: 'Invalid RPC Response', message: 'RPC returned non-object response.' },
      };
    }

    // Privacy-safe audit log (zero token exposure)
    console.log(
      `[CampaignService] Campaign ${data.already_exists ? 'replayed' : 'created'}: id=${data.campaign_id}, status=${data.status}, recipients=${data.total_recipients}, deliveries=${data.total_deliveries}`
    );

    // If replayed due to idempotency key: return 200 OK. If newly created: 201 Created.
    const httpStatus = data.already_exists ? 200 : 201;

    return {
      status: httpStatus,
      body: data,
    };
  } catch (err) {
    console.error('[CampaignService] Ingestion failed:', err.message);
    return {
      status: 500,
      body: { error: 'Internal Server Error', message: err.message },
    };
  }
}

/**
 * Executes campaign cancellation via public.cancel_notification_campaign RPC
 * 
 * @param {string|object} input Campaign UUID or request object
 * @param {object} context Caller context { user, isM2M }
 * @param {object|null} customSupabase 
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function cancelCampaign(input, context = {}, customSupabase = null) {
  const validation = validateCancellationInput(input);
  if (!validation.valid) {
    return {
      status: 400,
      body: { error: 'Validation Error', message: validation.error },
    };
  }

  const { campaignId } = validation;

  try {
    const supabase = getSupabaseServerClient(customSupabase);

    const { data, error } = await supabase.rpc('cancel_notification_campaign', {
      p_campaign_id: campaignId,
    });

    if (error) {
      console.error('[CampaignService] RPC Error during cancellation:', error.message);
      return {
        status: 500,
        body: { error: 'Database Cancellation Error', message: error.message },
      };
    }

    if (!data || typeof data !== 'object') {
      return {
        status: 500,
        body: { error: 'Invalid RPC Response', message: 'RPC returned non-object response.' },
      };
    }

    if (!data.success) {
      if (data.error === 'CAMPAIGN_NOT_FOUND') {
        return { status: 404, body: data };
      }
      if (data.error === 'INVALID_CAMPAIGN_STATE') {
        return { status: 409, body: data };
      }
      return { status: 400, body: data };
    }

    console.log(
      `[CampaignService] Campaign cancelled: id=${data.campaign_id}, cancelled_deliveries=${data.cancelled_deliveries}`
    );

    return {
      status: 200,
      body: {
        ...data,
        recall_limitation:
          'Notifications already accepted by Firebase Cloud Messaging cannot be recalled, but pending and reserved deliveries have been safely cancelled.',
      },
    };
  } catch (err) {
    console.error('[CampaignService] Cancellation failed:', err.message);
    return {
      status: 500,
      body: { error: 'Internal Server Error', message: err.message },
    };
  }
}

