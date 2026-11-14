/**
 * POST /api/notifications/campaigns
 * DELETE /api/notifications/campaigns
 * 
 * Secure endpoint for Notification Campaign Ingestion and Cancellation.
 * 
 * Authorization Modes:
 * 1. Admin User: Valid Supabase JWT Bearer token with public.admin_users membership.
 * 2. M2M API: Valid x-campaign-secret or x-m2m-secret header.
 * 
 * Security Controls:
 * - Rejects unauthorized requests with 401 Unauthorized.
 * - Rejects authenticated non-admins with 403 Forbidden.
 * - Rejects payload size > 64 KB with 413 Payload Too Large.
 * - Enforces HTTP methods POST and DELETE (405 Method Not Allowed).
 * - Disallows client overriding created_by (bound to server token).
 * - Rejects x-worker-secret to enforce role separation.
 */

import { authenticateRequest } from '../_lib/authMiddleware.js';
import { parseJsonBody, sendJson } from '../_lib/requestUtils.js';
import {
  isAuthorizedM2M,
  isServerSideAdmin,
  ingestCampaign,
  cancelCampaign,
} from '../_lib/campaignService.js';
import { runDispatchCycle } from '../_lib/dispatchWorker.js';
import {
  promoteDueScheduledCampaigns,
  promoteDueScheduledCampaignsFallback,
} from '../_lib/scheduledCampaignService.js';
import { getSupabaseServerClient } from '../_lib/supabaseServer.js';

const MAX_BODY_BYTES = 64 * 1024; // 64 KB

export default async function handler(req, res, customDependencies = {}) {
  // 1. Enforce Allowed HTTP Methods
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'POST' && method !== 'DELETE') {
    res.setHeader('Allow', 'POST, DELETE');
    return sendJson(res, 405, {
      error: 'Method Not Allowed: Only POST and DELETE methods are supported.',
      message: 'Only POST and DELETE methods are supported.',
    });
  }

  // 2. Enforce Content-Length Limits (Max 64 KB)
  const rawContentLength = req.headers['content-length'] || req.headers['Content-Length'];
  if (rawContentLength) {
    const contentLength = parseInt(rawContentLength, 10);
    if (!Number.isNaN(contentLength) && contentLength > MAX_BODY_BYTES) {
      return sendJson(res, 413, {
        error: 'Payload Too Large: Request payload exceeds the 64 KB size limit.',
        message: 'Request payload exceeds the 64 KB size limit.',
      });
    }
  }

  const customSupabase = customDependencies.supabase || null;

  // 3. Dual-Channel Authentication (M2M Secret OR Server-Side Admin JWT)
  let context = null;

  // Check Channel A: Restricted M2M Secret
  const hasM2MHeader = Boolean(
    req.headers['x-campaign-secret'] ||
    req.headers['X-Campaign-Secret'] ||
    req.headers['x-m2m-secret'] ||
    req.headers['X-M2M-Secret']
  );

  if (hasM2MHeader) {
    if (isAuthorizedM2M(req.headers)) {
      context = { isM2M: true, user: null };
    } else {
      return sendJson(res, 401, {
        error: 'Unauthorized: Invalid or missing machine-to-machine campaign secret.',
        message: 'Invalid or missing machine-to-machine campaign secret.',
      });
    }
  } else {
    // Check Channel B: Supabase Admin JWT Bearer Token
    const authResult = await authenticateRequest(req, customSupabase);
    if (!authResult.authenticated) {
      return sendJson(res, 401, {
        error: 'Unauthorized: Authentication required via admin Bearer token or valid x-campaign-secret.',
        message: 'Authentication required via admin Bearer token or valid x-campaign-secret.',
      });
    }

    // Enforce Server-Side Admin Role (Do not trust frontend claims)
    const isAdmin = await isServerSideAdmin(authResult.user, customSupabase);
    if (!isAdmin) {
      return sendJson(res, 403, {
        error: 'Forbidden: Administrator privileges are required to manage notification campaigns.',
        message: 'Administrator privileges are required to manage notification campaigns.',
      });
    }

    context = { isM2M: false, user: authResult.user, token: authResult.token };
  }

  // 4. Dispatch by Method & Action
  const body = (await parseJsonBody(req)) || {};

  // Check header-level idempotency key
  const idempHeader =
    req.headers['idempotency-key'] ||
    req.headers['Idempotency-Key'] ||
    req.headers['x-idempotency-key'] ||
    req.headers['X-Idempotency-Key'];

  if (idempHeader && typeof idempHeader === 'string' && idempHeader.trim()) {
    if (!body.idempotency_key) {
      body.idempotency_key = idempHeader.trim();
    }
  }

  if (method === 'DELETE' || (method === 'POST' && body.action === 'cancel')) {
    // Extract campaign ID from query params, body, or path
    let campaignId = body.campaign_id || body.id;
    if (!campaignId && req.query) {
      campaignId = req.query.id || req.query.campaign_id;
    }
    if (!campaignId && typeof req.url === 'string') {
      try {
        const parsedUrl = new URL(req.url, 'http://localhost');
        campaignId = parsedUrl.searchParams.get('id') || parsedUrl.searchParams.get('campaign_id');
      } catch {
        // Ignored
      }
    }

    const cancelResult = await cancelCampaign(campaignId, context, customSupabase);
    return sendJson(res, cancelResult.status, cancelResult.body);
  }

  // Admin Manual or Scheduled Dispatch Trigger:
  // Allows authorized admins to immediately promote due scheduled campaigns and trigger
  // a dispatch cycle without having to wait hours for background cron queues.
  if (method === 'POST' && (body.action === 'dispatch_due' || body.action === 'dispatch_now')) {
    if (body.campaign_id) {
      try {
        const supabaseServer = customSupabase || getSupabaseServerClient();
        if (typeof supabaseServer?.from === 'function') {
          await supabaseServer
            .from('notification_campaigns')
            .update({
              scheduled_for: new Date().toISOString(),
              status: 'scheduled',
            })
            .eq('id', body.campaign_id);
        }
      } catch (updErr) {
        console.warn('[Campaigns] Server advance scheduled_for error:', updErr.message);
      }
    }

    let promoResult = { promoted_count: 0, campaigns: [] };
    let promoError = null;
    try {
      const promoteFn = customDependencies.promoteDueScheduledCampaigns || promoteDueScheduledCampaigns;
      promoResult = await promoteFn(customSupabase);
    } catch (err) {
      const isUninstalled = /PGRST202|42883|Could not find the function/i.test(err.message || '');
      if (isUninstalled) {
        try {
          promoResult = await promoteDueScheduledCampaignsFallback(customSupabase);
        } catch (fbErr) {
          promoError = fbErr.message;
        }
      } else {
        promoError = err.message;
      }
      if (promoError) {
        console.warn('[Campaigns] Scheduled promotion error during manual dispatch:', promoError);
      }
    }

    const dispatchFn = customDependencies.runDispatchCycle || runDispatchCycle;
    let dispatchSummary = { processed: 0, sent: 0, failed: 0, rejected: 0 };
    let dispatchError = null;
    try {
      dispatchSummary = await dispatchFn({
        batchSize: 50,
        leaseSeconds: 60,
        customSupabase,
        customMessaging: customDependencies.messaging || null,
      });
    } catch (err) {
      dispatchError = err.message;
      console.warn('[Campaigns] Dispatch cycle error during manual dispatch:', err.message);
    }

    return sendJson(res, 200, {
      success: true,
      action: body.action,
      promoted_campaigns: promoResult?.promoted_count || 0,
      processed: dispatchSummary?.processed || 0,
      sent: dispatchSummary?.sent || 0,
      failed: dispatchSummary?.failed || 0,
      rejected: dispatchSummary?.rejected || 0,
      promo_error: promoError,
      dispatch_error: dispatchError,
    });
  }

  // Otherwise POST is Campaign Creation
  const ingestResult = await ingestCampaign(body, context, customSupabase);

  // Instant Inline Dispatch:
  // If this is a newly created, non-draft, non-scheduled campaign (or has pending push deliveries),
  // immediately trigger a dispatch cycle in-process so push notifications reach user devices
  // in 1-2 seconds instead of waiting for the background GitHub Actions cron schedule.
  const hasPushDeliveries =
    (ingestResult.body?.push_deliveries > 0) ||
    (ingestResult.body?.total_deliveries > 0) ||
    ingestResult.body?.status === 'queued' ||
    ingestResult.body?.status === 'processing';

  if (
    ingestResult.status === 201 &&
    !body.is_draft &&
    !body.scheduled_for &&
    hasPushDeliveries
  ) {
    const dispatchFn = customDependencies.runDispatchCycle || runDispatchCycle;
    try {
      const dispatchSummary = await dispatchFn({
        batchSize: 50,
        leaseSeconds: 60,
        customSupabase,
        customMessaging: customDependencies.messaging || null,
      });

      if (ingestResult.body && typeof ingestResult.body === 'object') {
        ingestResult.body.immediate_dispatch = {
          dispatched: true,
          sent: dispatchSummary?.sent ?? 0,
          failed: dispatchSummary?.failed ?? 0,
        };
      }
      console.log(
        `[Campaigns] Immediate dispatch executed: campaign=${ingestResult.body?.campaign_id}, sent=${dispatchSummary?.sent ?? 0}`
      );
    } catch (dispatchErr) {
      console.warn('[Campaigns] Immediate dispatch non-fatal failure:', dispatchErr.message);
      if (ingestResult.body && typeof ingestResult.body === 'object') {
        ingestResult.body.immediate_dispatch = {
          dispatched: false,
          error: dispatchErr.message,
        };
      }
    }
  }

  return sendJson(res, ingestResult.status, ingestResult.body);
}
