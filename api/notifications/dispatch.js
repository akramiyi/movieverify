/**
 * POST /api/notifications/dispatch
 * 
 * Secure endpoint to invoke a batch FCM notification dispatch cycle.
 * Guarded by internal authorization via 'x-worker-secret' header.
 * 
 * Security Controls:
 * 1. Only accepts authentication via 'x-worker-secret' header.
 * 2. Rejects query parameters (?secret=), Bearer tokens, or alternate headers.
 * 3. Uses constant-time secret comparison (crypto.timingSafeEqual with sha256).
 * 4. Fails closed if INTERNAL_WORKER_SECRET / CRON_SECRET is not configured.
 */

import crypto from 'node:crypto';
import { runDispatchCycle, sweepExpiredReservations } from '../_lib/dispatchWorker.js';
import { sendJson, parseJsonBody } from '../_lib/requestUtils.js';

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 * Pre-hashes both inputs with SHA-256 to guarantee identical buffer length before timingSafeEqual.
 * @param {string} a 
 * @param {string} b 
 * @returns {boolean}
 */
export function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  if (a.length === 0 || b.length === 0) {
    return false;
  }
  const bufA = crypto.createHash('sha256').update(a).digest();
  const bufB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Validates worker invocation authorization.
 * 
 * Strict Security Rules:
 * 1. Fails closed if INTERNAL_WORKER_SECRET or CRON_SECRET is not configured.
 * 2. Accepts worker secret ONLY via 'x-worker-secret' header.
 * 3. Rejects query parameters (?secret=), Bearer tokens, or alternate headers.
 * 4. Compares secrets in constant time using crypto.timingSafeEqual.
 * 
 * @param {object} headers Request headers
 * @returns {boolean}
 */
export function isAuthorizedWorker(headers) {
  const configuredSecret = process.env.INTERNAL_WORKER_SECRET || process.env.CRON_SECRET;

  // Fail closed if worker secret is not configured
  if (!configuredSecret || typeof configuredSecret !== 'string' || configuredSecret.trim() === '') {
    return false;
  }

  if (!headers || typeof headers !== 'object') {
    return false;
  }

  // Accept worker secret ONLY through x-worker-secret header (case-insensitive lookup)
  const headerKey = Object.keys(headers).find((k) => k.toLowerCase() === 'x-worker-secret');
  if (!headerKey) {
    return false;
  }

  const providedSecret = headers[headerKey];
  if (typeof providedSecret !== 'string') {
    return false;
  }

  return timingSafeCompare(providedSecret.trim(), configuredSecret.trim());
}

export default async function handler(req, res, customDependencies = {}) {
  // 1. Enforce HTTP Method
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed. Use POST.' });
  }

  // 2. Validate Worker Authorization (strictly x-worker-secret only, fail closed)
  if (!isAuthorizedWorker(req.headers)) {
    return sendJson(res, 401, { error: 'Unauthorized: Valid x-worker-secret header required.' });
  }

  // 3. Parse & Validate Strict Dispatch Configuration (Fail closed, never silently default)
  const body = await parseJsonBody(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return sendJson(res, 400, {
      error: 'Bad Request',
      message: 'Request body must be a valid JSON object.',
    });
  }

  // A. Validate batch_size (Required integer between 1 and 100)
  const rawBatchSize = body.batch_size;
  if (
    typeof rawBatchSize !== 'number' ||
    !Number.isInteger(rawBatchSize) ||
    rawBatchSize < 1 ||
    rawBatchSize > 100
  ) {
    return sendJson(res, 400, {
      error: 'Bad Request',
      message: 'Field "batch_size" is required and must be an integer between 1 and 100.',
    });
  }
  const batchSize = rawBatchSize;

  // B. Validate lease_seconds (Optional integer between 15 and 300, defaults to 60)
  let leaseSeconds = 60;
  if (body.lease_seconds !== undefined) {
    const rawLeaseSeconds = body.lease_seconds;
    if (
      typeof rawLeaseSeconds !== 'number' ||
      !Number.isInteger(rawLeaseSeconds) ||
      rawLeaseSeconds < 15 ||
      rawLeaseSeconds > 300
    ) {
      return sendJson(res, 400, {
        error: 'Bad Request',
        message: 'Field "lease_seconds", when provided, must be an integer between 15 and 300.',
      });
    }
    leaseSeconds = rawLeaseSeconds;
  }

  // C. Validate sweep_expired (Optional boolean, defaults to false)
  let sweepFirst = false;
  if (body.sweep_expired !== undefined) {
    const rawSweepExpired = body.sweep_expired;
    if (typeof rawSweepExpired !== 'boolean') {
      return sendJson(res, 400, {
        error: 'Bad Request',
        message: 'Field "sweep_expired", when provided, must be a boolean (true or false).',
      });
    }
    sweepFirst = rawSweepExpired;
  }

  try {
    const customSupabase = customDependencies.supabase || null;
    const customMessaging = customDependencies.messaging || null;

    // Optional sweep of abandoned reservations from dead workers
    let sweptCount = 0;
    if (sweepFirst) {
      sweptCount = await sweepExpiredReservations(customSupabase);
    }

    // Run Dispatch Cycle
    const cycleResult = await runDispatchCycle({
      batchSize,
      leaseSeconds,
      customSupabase,
      customMessaging,
    });

    return sendJson(res, 200, {
      success: true,
      worker_id: cycleResult.workerId,
      processed: cycleResult.processed,
      sent: cycleResult.sent,
      failed: cycleResult.failed,
      rejected: cycleResult.rejected,
      swept_expired: sweptCount,
      results: cycleResult.results,
    });
  } catch (err) {
    console.error('[DispatchEndpoint] Fatal dispatch execution error:', err.message);
    return sendJson(res, 500, {
      success: false,
      error: 'Dispatch cycle execution failed.',
      details: err.message,
    });
  }
}

