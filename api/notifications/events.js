/**
 * POST /api/notifications/events
 *
 * Catalog publishing & release automation webhook/endpoint.
 * Accepts admin or M2M catalog release events (new movie, new TV series,
 * new TV season, or quality link update) and translates them into
 * idempotent Smart Notification campaigns without risking catalog writes.
 */

import { authenticateRequest } from '../_lib/authMiddleware.js';
import { parseJsonBody, sendJson } from '../_lib/requestUtils.js';
import {
  isAuthorizedM2M,
  isServerSideAdmin,
  ingestCampaign,
} from '../_lib/campaignService.js';
import { runDispatchCycle } from '../_lib/dispatchWorker.js';

const MAX_BODY_BYTES = 64 * 1024;
const VALID_EVENT_TYPES = [
  'movie_release',
  'series_release',
  'season_release',
  'content_update',
];

function sanitizeId(raw) {
  if (raw === undefined || raw === null) return '';
  return String(raw).split('-')[0].trim();
}

function buildEventCampaignPayload(body) {
  const eventType = String(body.event_type || '').trim().toLowerCase();
  if (!VALID_EVENT_TYPES.includes(eventType)) {
    return {
      valid: false,
      error: `Invalid event_type. Must be one of: ${VALID_EVENT_TYPES.join(', ')}`,
    };
  }

  const tmdbId = sanitizeId(body.tmdb_id || body.series_id || body.movie_id);
  const rawTitle = typeof body.title === 'string' ? body.title.trim() : '';

  if (!tmdbId || !rawTitle) {
    return {
      valid: false,
      error: 'tmdb_id and title are required.',
    };
  }

  const rawMedia = String(body.media_type || '').trim().toLowerCase();
  const isTv =
    rawMedia === 'tv' ||
    rawMedia === 'series' ||
    eventType === 'series_release' ||
    eventType === 'season_release';

  const seasonNumber =
    body.season_number !== undefined && body.season_number !== null && body.season_number !== ''
      ? parseInt(body.season_number, 10)
      : null;

  if (eventType === 'season_release' && (!Number.isInteger(seasonNumber) || seasonNumber <= 0)) {
    return {
      valid: false,
      error: 'Valid positive integer season_number is required for season_release.',
    };
  }

  const canonicalUrl =
    typeof body.url === 'string' && body.url.startsWith('/')
      ? body.url.trim()
      : `/?type=${isTv ? 'tv' : 'movie'}&id=${tmdbId}`;

  let category = 'movie_release';
  let title = '';
  let notificationBody = '';
  let defaultIdempotencyKey = '';
  const targetCriteria = {
    media_type: isTv ? 'tv' : 'movie',
    tmdb_id: tmdbId,
    event_type: eventType,
  };

  if (eventType === 'movie_release') {
    category = 'movie_release';
    title = `${rawTitle} is Now Available!`;
    notificationBody = `${rawTitle} has been added with verified download links. Watch or download now on MovieVerify.`;
    targetCriteria.type = 'movie';
    targetCriteria.movie_id = tmdbId;
    defaultIdempotencyKey = `catalog:movie_release:${tmdbId}`;
  } else if (eventType === 'series_release') {
    category = 'movie_release';
    title = `${rawTitle} Series Added!`;
    notificationBody = `${rawTitle} episodes are now available on MovieVerify. Open series page to explore seasons.`;
    targetCriteria.type = 'series';
    targetCriteria.series_id = tmdbId;
    targetCriteria.movie_id = tmdbId;
    defaultIdempotencyKey = `catalog:series_release:${tmdbId}`;
  } else if (eventType === 'season_release') {
    category = 'movie_release';
    title = `${rawTitle} — Season ${seasonNumber} Out Now!`;
    notificationBody = `Season ${seasonNumber} links for ${rawTitle} are live now on MovieVerify.`;
    targetCriteria.type = 'season';
    targetCriteria.series_id = tmdbId;
    targetCriteria.movie_id = tmdbId;
    targetCriteria.season_number = seasonNumber;
    defaultIdempotencyKey = `catalog:season_release:${tmdbId}:s${seasonNumber}`;
  } else {
    category = 'content_update';
    const qualityTag = typeof body.release_quality === 'string' && body.release_quality.trim()
      ? body.release_quality.trim()
      : 'updated';
    title = `${rawTitle} Links Updated`;
    notificationBody = isTv
      ? `Updated episodes and download mirrors are now available for ${rawTitle}.`
      : `Updated ${qualityTag !== 'updated' ? `${qualityTag} ` : ''}download links are now available for ${rawTitle}.`;
    targetCriteria.type = isTv ? 'series' : 'movie';
    targetCriteria.movie_id = tmdbId;
    if (isTv) {
      targetCriteria.series_id = tmdbId;
    }
    if (Number.isInteger(seasonNumber) && seasonNumber > 0) {
      targetCriteria.season_number = seasonNumber;
    }
    defaultIdempotencyKey = `catalog:content_update:${tmdbId}:${qualityTag}`;
  }

  const providedKey =
    typeof body.idempotency_key === 'string' && body.idempotency_key.trim()
      ? body.idempotency_key.trim().slice(0, 128)
      : defaultIdempotencyKey.slice(0, 128);

  return {
    valid: true,
    campaignPayload: {
      title: body.notification_title ? String(body.notification_title).trim() : title.slice(0, 255),
      body: body.notification_body ? String(body.notification_body).trim() : notificationBody.slice(0, 1000),
      category,
      url: canonicalUrl,
      image_url: body.image_url || null,
      target_criteria: targetCriteria,
      scheduled_for: body.scheduled_for || null,
      idempotency_key: providedKey,
    },
  };
}

export default async function handler(req, res, customDependencies = {}) {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method Not Allowed: Only POST is supported.' });
  }

  const rawContentLength = req.headers['content-length'] || req.headers['Content-Length'];
  if (rawContentLength) {
    const contentLength = parseInt(rawContentLength, 10);
    if (!Number.isNaN(contentLength) && contentLength > MAX_BODY_BYTES) {
      return sendJson(res, 413, { error: 'Payload Too Large: Request exceeds 64 KB.' });
    }
  }

  const customSupabase = customDependencies.supabase || null;
  let context = null;

  const hasM2MHeader = Boolean(
    req.headers['x-campaign-secret'] ||
    req.headers['X-Campaign-Secret'] ||
    req.headers['x-m2m-secret'] ||
    req.headers['X-M2M-Secret']
  );

  if (hasM2MHeader) {
    if (!isAuthorizedM2M(req.headers)) {
      return sendJson(res, 401, { error: 'Unauthorized: Invalid machine-to-machine secret.' });
    }
    context = { isM2M: true, user: null };
  } else {
    const authResult = await authenticateRequest(req, customSupabase);
    if (!authResult.authenticated) {
      return sendJson(res, 401, { error: 'Unauthorized: Admin Bearer token or M2M secret required.' });
    }

    const isAdmin = await isServerSideAdmin(authResult.user, customSupabase);
    if (!isAdmin) {
      return sendJson(res, 403, { error: 'Forbidden: Administrator privileges required.' });
    }
    context = { isM2M: false, user: authResult.user, token: authResult.token };
  }

  const body = (await parseJsonBody(req)) || {};
  const built = buildEventCampaignPayload(body);

  if (!built.valid) {
    return sendJson(res, 400, { error: built.error });
  }

  try {
    const result = await ingestCampaign(built.campaignPayload, context, customSupabase);

    // Instant Inline Dispatch for catalog events (movie release, series release, etc.):
    // Triggers FCM dispatch immediately in-process so subscribers get notified in 1-2 seconds
    // without waiting for the background GitHub Actions cron schedule.
    const hasPushDeliveries =
      (result.body?.push_deliveries > 0) ||
      (result.body?.total_deliveries > 0) ||
      result.body?.status === 'queued' ||
      result.body?.status === 'processing';

    if (result.status === 201 && hasPushDeliveries) {
      const dispatchFn = customDependencies.runDispatchCycle || runDispatchCycle;
      try {
        const dispatchSummary = await dispatchFn({
          batchSize: 50,
          leaseSeconds: 60,
          customSupabase,
          customMessaging: customDependencies.messaging || null,
        });

        if (result.body && typeof result.body === 'object') {
          result.body.immediate_dispatch = {
            dispatched: true,
            sent: dispatchSummary?.sent ?? 0,
            failed: dispatchSummary?.failed ?? 0,
          };
        }
        console.log(
          `[Events] Immediate dispatch executed: event=${body.event_type}, campaign=${result.body?.campaign_id}, sent=${dispatchSummary?.sent ?? 0}`
        );
      } catch (dispatchErr) {
        console.warn('[Events] Immediate dispatch non-fatal failure:', dispatchErr.message);
        if (result.body && typeof result.body === 'object') {
          result.body.immediate_dispatch = {
            dispatched: false,
            error: dispatchErr.message,
          };
        }
      }
    }

    return sendJson(res, result.status, {
      success: result.status >= 200 && result.status < 400,
      event_type: body.event_type,
      ...result.body,
    });
  } catch (err) {
    return sendJson(res, 500, {
      error: 'Failed to ingest notification event.',
      details: err.message,
    });
  }
}

export { buildEventCampaignPayload, VALID_EVENT_TYPES };
