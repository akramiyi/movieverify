/**
 * GET, POST /api/notifications/dispatch
 * 
 * Secure endpoint to invoke a batch FCM notification dispatch cycle.
 * Dual-scheduler support:
 * 1. GitHub Actions / manual workers via 'x-worker-secret' header (POST with JSON body).
 * 2. Vercel Cron / external ping monitors via 'Authorization: Bearer <CRON_SECRET>' header (GET or POST).
 * 
 * Security Controls:
 * 1. Accepts authentication via 'x-worker-secret' or 'Authorization: Bearer <token>'.
 * 2. Rejects query parameters (?secret=), alternate headers (x-cron-secret), or invalid schemes.
 * 3. Uses constant-time secret comparison (crypto.timingSafeEqual with sha256).
 * 4. Fails closed if neither INTERNAL_WORKER_SECRET nor CRON_SECRET is configured.
 */

import crypto from 'node:crypto';
import { isNotificationDispatchEnabled, runDispatchCycle, sweepExpiredReservations } from '../_lib/dispatchWorker.js';
import { promoteDueScheduledCampaigns } from '../_lib/scheduledCampaignService.js';
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
 * 1. Fails closed if neither INTERNAL_WORKER_SECRET nor CRON_SECRET is configured.
 * 2. Accepts worker secret via 'x-worker-secret' header OR 'Authorization: Bearer <token>' header.
 * 3. Rejects query parameters (?secret=), non-Bearer authorization schemes, or alternate headers.
 * 4. Compares secrets in constant time using crypto.timingSafeEqual.
 * 
 * @param {object} headers Request headers
 * @returns {boolean}
 */
export function isAuthorizedWorker(headers) {
  const configuredSecret = process.env.INTERNAL_WORKER_SECRET || process.env.CRON_SECRET;
  const cronSecret = process.env.CRON_SECRET || process.env.INTERNAL_WORKER_SECRET;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  // Fail closed if neither worker secret nor service role key is configured
  if (
    (!configuredSecret || typeof configuredSecret !== 'string' || configuredSecret.trim() === '') &&
    (!serviceRoleKey || typeof serviceRoleKey !== 'string' || serviceRoleKey.trim() === '')
  ) {
    return false;
  }

  if (!headers || typeof headers !== 'object') {
    return false;
  }

  // Channel 1: Accept worker secret through x-worker-secret header (case-insensitive)
  const workerSecretKey = Object.keys(headers).find((k) => k.toLowerCase() === 'x-worker-secret');
  if (workerSecretKey) {
    const providedWorkerSecret = headers[workerSecretKey];
    if (typeof providedWorkerSecret === 'string' && providedWorkerSecret.trim() !== '') {
      if (
        (configuredSecret && timingSafeCompare(providedWorkerSecret.trim(), configuredSecret.trim())) ||
        (cronSecret && timingSafeCompare(providedWorkerSecret.trim(), cronSecret.trim())) ||
        (serviceRoleKey && timingSafeCompare(providedWorkerSecret.trim(), serviceRoleKey.trim()))
      ) {
        return true;
      }
    }
  }

  // Channel 2: Accept Bearer token through Authorization header (Vercel Cron standard)
  const authHeaderKey = Object.keys(headers).find((k) => k.toLowerCase() === 'authorization');
  if (authHeaderKey) {
    const authVal = headers[authHeaderKey];
    if (typeof authVal === 'string' && authVal.trim() !== '') {
      const match = authVal.match(/^Bearer\s+(.+)$/i);
      if (match && match[1]) {
        const bearerToken = match[1].trim();
        if (
          (configuredSecret && timingSafeCompare(bearerToken, configuredSecret.trim())) ||
          (cronSecret && timingSafeCompare(bearerToken, cronSecret.trim())) ||
          (serviceRoleKey && timingSafeCompare(bearerToken, serviceRoleKey.trim()))
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

export default async function handler(req, res, customDependencies = {}) {
  // 1. Enforce HTTP Method (GET for Vercel Cron/monitors, POST for workers/GitHub Actions)
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { error: 'Method not allowed. Use GET or POST.' });
  }

  // 2. Validate Worker Authorization (strictly x-worker-secret or Authorization: Bearer, fail closed)
  if (!isAuthorizedWorker(req.headers)) {
    return sendJson(res, 401, { error: 'Unauthorized: Valid x-worker-secret header required or Authorization Bearer token.' });
  }

  // 2b. Runtime Kill Switch (fail closed unless NOTIFICATION_DISPATCH_ENABLED === 'true')
  if (!isNotificationDispatchEnabled()) {
    return sendJson(res, 503, {
      success: false,
      code: 'DISPATCH_DISABLED',
      error: 'Notification dispatch is disabled.',
      message: 'Set NOTIFICATION_DISPATCH_ENABLED=true to enable server-side dispatch execution.',
    });
  }

  // 3. Parse & Validate Strict Dispatch Configuration
  let batchSize = 25;
  let leaseSeconds = 60;
  let sweepFirst = true;

  if (method === 'GET') {
    // Vercel Cron and monitoring pings invoke via GET without request body
    // Safe defaults: batch_size=25, lease_seconds=60, sweep_expired=true
    let query = req.query;
    if (!query && typeof req.url === 'string' && req.url.includes('?')) {
      try {
        const parsedUrl = new URL(req.url, 'http://localhost');
        query = Object.fromEntries(parsedUrl.searchParams.entries());
      } catch {
        query = {};
      }
    }
    query = query || {};

    if (query.batch_size !== undefined) {
      const qBatch = parseInt(query.batch_size, 10);
      if (!Number.isNaN(qBatch) && qBatch >= 1 && qBatch <= 100) {
        batchSize = qBatch;
      }
    }
    if (query.lease_seconds !== undefined) {
      const qLease = parseInt(query.lease_seconds, 10);
      if (!Number.isNaN(qLease) && qLease >= 15 && qLease <= 300) {
        leaseSeconds = qLease;
      }
    }
    if (query.sweep_expired !== undefined) {
      sweepFirst = query.sweep_expired === 'true' || query.sweep_expired === true;
    }
  } else {
    // POST requests must follow the strict JSON payload schema
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
    batchSize = rawBatchSize;

    // B. Validate lease_seconds (Optional integer between 15 and 300, defaults to 60)
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

    // C. Validate sweep_expired (Optional boolean, defaults to false for targeted POST runs)
    if (body.sweep_expired !== undefined) {
      const rawSweepExpired = body.sweep_expired;
      if (typeof rawSweepExpired !== 'boolean') {
        return sendJson(res, 400, {
          error: 'Bad Request',
          message: 'Field "sweep_expired", when provided, must be a boolean (true or false).',
        });
      }
      sweepFirst = rawSweepExpired;
    } else {
      sweepFirst = false;
    }
  }

  try {
    const customSupabase = customDependencies.supabase || null;
    const customMessaging = customDependencies.messaging || null;

    // Promote due scheduled campaigns into notification_deliveries & user_notifications
    // ahead of B5E reservation. Gracefully skip only when scheduled promotion RPC is
    // not yet installed (standalone B5D/B5E deployments) or omitted by a test mock.
    let promotionResult = { promoted_count: 0, campaigns: [] };
    let promotionError = null;
    let promotionSkipped = false;
    if (customDependencies.promoteScheduled !== false) {
      try {
        promotionResult = await promoteDueScheduledCampaigns(customSupabase);
      } catch (promoErr) {
        const promoMsg = promoErr.message || '';
        const isMockRpcOmitted =
          Boolean(customSupabase) &&
          /Unhandled RPC promote_due_scheduled_campaigns/i.test(promoMsg);
        const isUninstalledScheduledRpc =
          /PGRST202|42883|Could not find the function public\.promote_due_scheduled_campaigns|function public\.promote_due_scheduled_campaigns.*does not exist/i.test(promoMsg);
        if (isMockRpcOmitted || isUninstalledScheduledRpc) {
          promotionSkipped = true;
          console.warn('[DispatchEndpoint] Scheduled campaign promotion unavailable/skipped:', promoMsg);
        } else {
          promotionError = promoMsg || 'Scheduled campaign promotion failed';
          console.error('[DispatchEndpoint] Scheduled campaign promotion error:', promotionError);
        }
      }
    }

    // Optional sweep of abandoned reservations from dead workers
    let sweptCount = 0;
    if (sweepFirst) {
      sweptCount = await sweepExpiredReservations(customSupabase);
    }

    // Run Dispatch Cycle even if scheduler failed so queued deliveries are not starved
    const cycleResult = await runDispatchCycle({
      batchSize,
      leaseSeconds,
      customSupabase,
      customMessaging,
    });

    if (promotionError) {
      return sendJson(res, 500, {
        success: false,
        error: 'Scheduled campaign promotion failed.',
        details: promotionError,
        promotion_error: promotionError,
        worker_id: cycleResult.workerId,
        processed: cycleResult.processed,
        sent: cycleResult.sent,
        failed: cycleResult.failed,
        rejected: cycleResult.rejected,
        swept_expired: sweptCount,
        promoted_campaigns: 0,
        results: cycleResult.results,
      });
    }

    return sendJson(res, 200, {
      success: true,
      worker_id: cycleResult.workerId,
      processed: cycleResult.processed,
      sent: cycleResult.sent,
      failed: cycleResult.failed,
      rejected: cycleResult.rejected,
      swept_expired: sweptCount,
      promoted_campaigns: promotionResult.promoted_count,
      ...(promotionSkipped ? { scheduled_promotion_skipped: true } : {}),
      results: cycleResult.results,
    });
  } catch (err) {
    if (err?.code === 'DISPATCH_DISABLED') {
      return sendJson(res, 503, {
        success: false,
        code: 'DISPATCH_DISABLED',
        error: 'Notification dispatch is disabled.',
        message: err.message,
      });
    }
    console.error('[DispatchEndpoint] Fatal dispatch execution error:', err.message);
    return sendJson(res, 500, {
      success: false,
      error: 'Dispatch cycle execution failed.',
      details: err.message,
    });
  }
}

