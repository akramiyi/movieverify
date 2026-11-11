import { supabase } from '../data/supabaseClient';

/**
 * Reports non-blocking notification lifecycle telemetry to the authenticated backend.
 * Server derives user_id and campaign_id strictly from verified auth & delivery ownership.
 */
export async function reportNotificationTelemetry({
  deliveryId = null,
  notificationId = null,
  eventType,
  eventNonce = null,
  metadata = {},
} = {}) {
  if (!eventType || (!deliveryId && !notificationId)) {
    return { ok: false, skipped: true };
  }

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return { ok: false, reason: 'unauthenticated' };
    }

    const res = await fetch('/api/notifications/telemetry', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        delivery_id: deliveryId || undefined,
        notification_id: notificationId || undefined,
        event_type: eventType,
        event_nonce: eventNonce || undefined,
        client_timestamp: new Date().toISOString(),
        client_metadata: metadata,
      }),
    });

    if (!res.ok) {
      return { ok: false, status: res.status };
    }

    return { ok: true, ...(await res.json().catch(() => ({}))) };
  } catch {
    // Telemetry must never break notification click or UI flows
    return { ok: false, reason: 'network_error' };
  }
}

