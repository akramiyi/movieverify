/**
 * POST /api/notifications/register
 * 
 * Secure endpoint to register or refresh an FCM device registration token.
 * Authenticated user identity is strictly extracted from verified Supabase JWT.
 * Associating token ownership with client-supplied user IDs is strictly forbidden.
 * Also supports:
 * - action: 'test_push' -> Dispatches an immediate test FCM alert to the calling device.
 * - action: 'diagnostics' -> Retrieves active registered device status for the user.
 */

import { requireAuth } from '../_lib/authMiddleware.js';
import { registerDeviceToken, maskToken } from '../_lib/deviceTokenService.js';
import { parseJsonBody, sendJson } from '../_lib/requestUtils.js';
import { getFirebaseMessaging } from '../_lib/firebaseAdmin.js';
import { getSupabaseServerClient } from '../_lib/supabaseServer.js';

export default async function handler(req, res, customSupabase = null, customDependencies = {}) {
  // Enforce HTTP Method (Strict POST)
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed. Use POST.' });
  }

  // 1. Authenticate Request
  const user = await requireAuth(req, res, customSupabase);
  if (!user) {
    return; // Response already handled by requireAuth
  }

  // 2. Parse Request Body
  const body = await parseJsonBody(req);
  if (body === null) {
    return sendJson(res, 400, { error: 'Malformed JSON payload.' });
  }

  // 3. Optional Diagnostics Action
  if (body.action === 'diagnostics') {
    try {
      const supabase = customSupabase || getSupabaseServerClient();
      const { data: endpoints, error: epErr } = await supabase
        .from('notification_endpoints')
        .select('id, channel_type, device_type, device_name, browser, os, is_active, last_seen_at, created_at')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .is('revoked_at', null)
        .order('last_seen_at', { ascending: false });

      if (epErr) {
        return sendJson(res, 500, { error: 'Failed to query device endpoints.', details: epErr.message });
      }

      return sendJson(res, 200, {
        success: true,
        user_id: user.id,
        device_count: endpoints?.length || 0,
        devices: endpoints || [],
      });
    } catch (err) {
      return sendJson(res, 500, { error: 'Diagnostic lookup failure.', details: err.message });
    }
  }

  // 4. Optional Test Push Action
  if (body.action === 'test_push') {
    try {
      let targetToken = typeof body.token === 'string' && body.token.trim() ? body.token.trim() : null;
      const supabase = customSupabase || getSupabaseServerClient();

      if (!targetToken) {
        try {
          const { data: ep } = await supabase
            .from('notification_endpoints')
            .select('token')
            .eq('user_id', user.id)
            .eq('is_active', true)
            .is('revoked_at', null)
            .order('last_seen_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          targetToken = ep?.token || null;
        } catch {}
      }

      if (!targetToken) {
        return sendJson(res, 404, {
          error: 'No active device token found for this account. Please enable push notifications on this device first.',
        });
      }

      const messaging = customDependencies.messaging || getFirebaseMessaging();
      if (!messaging) {
        return sendJson(res, 503, {
          error: 'Push service unavailable. Firebase credentials are not configured on server.',
        });
      }

      const siteBase = (process.env.VITE_APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://movieverify.vercel.app').replace(/\/+$/, '');
      const fcmMessage = {
        token: targetToken,
        notification: {
          title: '🔔 MovieVerify Test Alert',
          body: 'Push notifications are working! You will receive instant movie link updates.',
        },
        data: {
          url: '/',
          title: '🔔 MovieVerify Test Alert',
          body: 'Push notifications are working! You will receive instant movie link updates.',
          test_sent_at: new Date().toISOString(),
        },
        android: {
          priority: 'high',
          ttl: 86400 * 1000,
        },
        webpush: {
          fcmOptions: {
            link: '/',
          },
          headers: {
            Urgency: 'high',
            TTL: '86400',
          },
          notification: {
            icon: `${siteBase}/logo192.png`,
            badge: `${siteBase}/badge.png`,
            vibrate: [200, 100, 200, 100, 200],
            tag: `test-push-${Date.now()}`,
            renotify: true,
          },
        },
      };

      const messageId = await messaging.send(fcmMessage);
      return sendJson(res, 200, {
        success: true,
        messageId,
        sent_at: new Date().toISOString(),
        token_masked: maskToken(targetToken),
        note: 'Test push delivered to Firebase successfully.',
      });
    } catch (pushErr) {
      console.error('[Register API] Test push delivery error:', pushErr.message);
      return sendJson(res, 500, {
        error: 'Failed to dispatch test notification.',
        details: pushErr.message,
      });
    }
  }

  // 5. Standard Register or Refresh Device Token
  const result = await registerDeviceToken(user, body, customSupabase);

  if (!result.success) {
    return sendJson(res, result.status || 400, {
      error: result.error,
      code: result.code,
      data: result.data,
    });
  }

  return sendJson(res, result.status || 200, result.data);
}
