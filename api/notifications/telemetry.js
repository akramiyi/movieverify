/**
 * POST /api/notifications/telemetry
 *
 * Authenticated notification telemetry ingestion endpoint.
 * Security controls:
 * - Requires authenticated Supabase Bearer JWT (`requireAuth` / `authenticateRequest`).
 * - Strictly binds `recipient_id = user.id` on the server (rejects spoofed `user_id`/`recipient_id`).
 * - Verifies ownership of `delivery_id` / `notification_id` before recording.
 * - Derives `campaign_id` strictly from the owned delivery record (never client-trusted).
 * - Restricts event types to valid client-reportable lifecycle metrics (`device_received`,
 *   `displayed`, `opened`, `clicked`, `dismissed`, `client_failed`).
 * - Enforces <= 4096-byte serialized `client_metadata` and strips sensitive key patterns.
 */

import crypto from 'node:crypto';
import { authenticateRequest } from '../_lib/authMiddleware.js';
import { getSupabaseServerClient } from '../_lib/supabaseServer.js';
import { parseJsonBody, sendJson } from '../_lib/requestUtils.js';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_METADATA_BYTES = 4096;
const CLIENT_TELEMETRY_EVENTS = [
  'device_received',
  'displayed',
  'opened',
  'clicked',
  'dismissed',
  'client_failed',
];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SENSITIVE_META_KEY_REGEX = /(token|secret|password|authorization|auth_key|p256dh|credential|cookie)/i;

function sanitizeMetadata(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: true, metadata: {} };
  }

  const sanitized = {};
  for (const [key, val] of Object.entries(raw)) {
    if (SENSITIVE_META_KEY_REGEX.test(key)) {
      continue;
    }
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean' || val === null) {
      sanitized[String(key).slice(0, 64)] = typeof val === 'string' ? val.slice(0, 512) : val;
    }
  }

  const serializedSize = Buffer.byteLength(JSON.stringify(sanitized), 'utf8');
  if (serializedSize > MAX_METADATA_BYTES) {
    return { valid: false, error: 'client_metadata exceeds 4096-byte limit.' };
  }

  return { valid: true, metadata: sanitized };
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
      return sendJson(res, 413, { error: 'Payload Too Large: Telemetry payload exceeds 16 KB limit.' });
    }
  }

  const customSupabase = customDependencies.supabase || null;
  const authResult = await authenticateRequest(req, customSupabase);

  if (!authResult.authenticated || !authResult.user?.id) {
    return sendJson(res, 401, { error: 'Unauthorized: Bearer token authentication required.' });
  }

  const user = authResult.user;
  const body = (await parseJsonBody(req)) || {};

  // Reject spoofed recipient_id / user_id
  if (
    (body.recipient_id && String(body.recipient_id) !== user.id) ||
    (body.user_id && String(body.user_id) !== user.id)
  ) {
    return sendJson(res, 403, {
      error: 'Forbidden: Telemetry cannot be recorded on behalf of another user.',
    });
  }

  const eventType = String(body.event_type || '').trim().toLowerCase();
  if (!CLIENT_TELEMETRY_EVENTS.includes(eventType)) {
    return sendJson(res, 400, {
      error: `Invalid event_type. Allowed client telemetry events: ${CLIENT_TELEMETRY_EVENTS.join(', ')}`,
    });
  }

  let deliveryId = typeof body.delivery_id === 'string' ? body.delivery_id.trim() : null;
  const notificationId = typeof body.notification_id === 'string' ? body.notification_id.trim() : null;

  if (deliveryId && !UUID_REGEX.test(deliveryId)) {
    return sendJson(res, 400, { error: 'Invalid delivery_id format.' });
  }
  if (notificationId && !UUID_REGEX.test(notificationId)) {
    return sendJson(res, 400, { error: 'Invalid notification_id format.' });
  }
  if (!deliveryId && !notificationId) {
    return sendJson(res, 400, { error: 'delivery_id or notification_id is required.' });
  }

  const metaCheck = sanitizeMetadata(body.client_metadata);
  if (!metaCheck.valid) {
    return sendJson(res, 400, { error: metaCheck.error });
  }

  try {
    const supabase = getSupabaseServerClient(customSupabase);

    // Resolve delivery_id via owned user_notifications if only notification_id was supplied
    if (!deliveryId && notificationId) {
      const { data: notifRow, error: notifErr } = await supabase
        .from('user_notifications')
        .select('id, user_id, delivery_id, campaign_id')
        .eq('id', notificationId)
        .maybeSingle();

      if (notifErr) {
        return sendJson(res, 500, { error: 'Failed to verify notification ownership.' });
      }
      if (!notifRow) {
        return sendJson(res, 404, { error: 'Notification not found.' });
      }
      if (notifRow.user_id !== user.id) {
        return sendJson(res, 403, { error: 'Forbidden: Notification belongs to another user.' });
      }
      if (!notifRow.delivery_id) {
        return sendJson(res, 200, {
          success: true,
          recorded: false,
          reason: 'no_delivery_record_attached',
        });
      }
      deliveryId = notifRow.delivery_id;
    }

    // Verify delivery ownership & derive campaign_id strictly server-side
    const { data: deliveryRow, error: deliveryErr } = await supabase
      .from('notification_deliveries')
      .select('id, campaign_id, recipient_type, recipient_id')
      .eq('id', deliveryId)
      .maybeSingle();

    if (deliveryErr) {
      return sendJson(res, 500, { error: 'Failed to look up delivery record.' });
    }
    if (!deliveryRow) {
      return sendJson(res, 404, { error: 'Delivery record not found.' });
    }
    if (deliveryRow.recipient_id !== user.id) {
      return sendJson(res, 403, {
        error: 'Forbidden: Delivery record belongs to another user.',
      });
    }

    if (body.campaign_id && String(body.campaign_id).trim() !== deliveryRow.campaign_id) {
      return sendJson(res, 403, {
        error: 'Forbidden: Campaign identifier mismatch for this delivery.',
      });
    }

    const rawNonce = typeof body.event_nonce === 'string' && body.event_nonce.trim()
      ? body.event_nonce.trim().slice(0, 64)
      : crypto.randomUUID();

    const clientTs =
      body.client_timestamp && !Number.isNaN(Date.parse(body.client_timestamp))
        ? new Date(body.client_timestamp).toISOString()
        : new Date().toISOString();

    const { data, error } = await supabase.rpc('record_notification_telemetry', {
      p_delivery_id: deliveryRow.id,
      p_campaign_id: deliveryRow.campaign_id,
      p_recipient_type: deliveryRow.recipient_type || 'user',
      p_recipient_id: user.id,
      p_event_type: eventType,
      p_event_nonce: rawNonce,
      p_client_timestamp: clientTs,
      p_client_metadata: metaCheck.metadata,
    });

    if (error) {
      return sendJson(res, 500, {
        error: 'Failed to record telemetry event.',
        details: error.message,
      });
    }

    return sendJson(res, 200, {
      success: Boolean(data?.success ?? true),
      recorded: Boolean(data?.recorded ?? false),
      telemetry_id: data?.telemetry_id || null,
    });
  } catch (err) {
    return sendJson(res, 500, {
      error: 'Internal server error recording telemetry.',
      details: err.message,
    });
  }
}

export { CLIENT_TELEMETRY_EVENTS, sanitizeMetadata };

