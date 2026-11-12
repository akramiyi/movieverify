/**
 * POST /api/notifications/welcome
 *
 * Idempotently issues a single welcome notification when a genuine first-time
 * Supabase user completes registration (email signup or OAuth).
 *
 * Safeguards:
 * - Requires authenticated Supabase JWT Bearer token (401 otherwise).
 * - Derives user_id strictly from verified authResult.user.id.
 * - Rejects legacy/returning accounts older than the new-registration window.
 * - Relies on PostgreSQL `user_welcome_dispatches` primary-key deduplication and
 *   `issue_welcome_notification` RPC so concurrent requests never create duplicates.
 */

import { authenticateRequest } from '../_lib/authMiddleware.js';
import { getSupabaseServerClient } from '../_lib/supabaseServer.js';
import { parseJsonBody, sendJson } from '../_lib/requestUtils.js';
import { runDispatchCycle } from '../_lib/dispatchWorker.js';

const DEFAULT_MAX_NEW_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function normalizeSource(rawSource) {
  const s = typeof rawSource === 'string' ? rawSource.trim().toLowerCase() : '';
  if (['signup', 'oauth', 'signin', 'api_signin'].includes(s)) {
    return s;
  }
  return 'api_signin';
}

export default async function handler(req, res, customDependencies = {}) {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method Not Allowed: Only POST is supported.' });
  }

  const customSupabase = customDependencies.supabase || null;
  const authResult = await authenticateRequest(req, customSupabase);

  if (!authResult.authenticated || !authResult.user?.id) {
    return sendJson(res, 401, {
      error: 'Unauthorized: Valid Bearer authentication is required.',
    });
  }

  const body = (await parseJsonBody(req)) || {};
  const user = authResult.user;
  const maxAccountAgeMs = Number(
    customDependencies.maxAccountAgeMs ?? DEFAULT_MAX_NEW_ACCOUNT_AGE_MS
  );

  // Detect genuine first-time registration vs subsequent logins (fail closed if created_at absent)
  const createdMs = user.created_at ? Date.parse(user.created_at) : NaN;
  if (!Number.isFinite(createdMs)) {
    return sendJson(res, 200, {
      success: true,
      created: false,
      already_processed: false,
      reason: 'missing_created_at_timestamp',
    });
  }

  const accountAgeMs = Date.now() - createdMs;
  if (accountAgeMs > maxAccountAgeMs) {
    return sendJson(res, 200, {
      success: true,
      created: false,
      already_processed: false,
      reason: 'existing_account_subsequent_login',
    });
  }

  try {
    const supabase = getSupabaseServerClient(customSupabase);

    // Fast read guard before RPC if a dispatch record already exists
    const { data: existingDispatch } = await supabase
      .from('user_welcome_dispatches')
      .select('status, notification_id, created_at')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existingDispatch) {
      return sendJson(res, 200, {
        success: true,
        created: false,
        already_processed: true,
        status: existingDispatch.status,
        notification_id: existingDispatch.notification_id || null,
      });
    }

    const source = normalizeSource(body.source);
    const { data, error } = await supabase.rpc('issue_welcome_notification', {
      p_user_id: user.id,
      p_source: source,
    });

    if (error) {
      return sendJson(res, 500, {
        error: 'Failed to process welcome notification.',
        details: error.message,
      });
    }

    if (data?.push_queued > 0) {
      const dispatchFn = customDependencies.runDispatchCycle || runDispatchCycle;
      try {
        await dispatchFn({ batchSize: 5, leaseSeconds: 60, customSupabase });
      } catch (dispatchErr) {
        console.warn('[Welcome] Immediate dispatch non-fatal failure:', dispatchErr.message);
      }
    }

    return sendJson(res, 200, {
      success: true,
      created: Boolean(data?.created),
      already_processed: Boolean(data?.already_processed),
      notification_id: data?.notification_id || null,
      delivery_id: data?.delivery_id || null,
      push_queued: data?.push_queued || 0,
      reason: data?.reason || null,
    });
  } catch (err) {
    return sendJson(res, 500, {
      error: 'Internal server error processing welcome notification.',
      details: err.message,
    });
  }
}

