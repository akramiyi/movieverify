/**
 * MovieVerify FCM Notification Dispatch Worker
 * 
 * Implements the secure, transactional FCM dispatch worker:
 * 1. Reserves eligible deliveries with FOR UPDATE SKIP LOCKED (rpc reserve_notification_deliveries).
 * 2. Pre-dispatch authorization & fencing (rpc authorize_notification_delivery_dispatch).
 * 3. Sends push notification via Firebase Admin SDK.
 * 4. Confirms successful delivery (rpc confirm_notification_delivery_sent) with bounded retries or
 *    handles failure & backoff (rpc fail_or_retry_notification_delivery).
 * 5. Strictly protects token secrecy (raw tokens are never logged or exposed).
 * 
 * ARCHITECTURAL DELIVERY SEMANTICS: AT-LEAST-ONCE DELIVERY
 * --------------------------------------------------------
 * Push notifications across third-party networks (FCM / APNs) cannot guarantee
 * exactly-once delivery due to the distributed provider boundary:
 * 1. FCM HTTP v1 API does not participate in distributed two-phase commit (2PC) transactions.
 * 2. If FCM accepts a push payload but database confirmation fails (transient DB failure, worker timeout,
 *    or crash), the delivery row in PostgreSQL remains in 'leased' status with an active dispatch_attempt_id.
 * 3. Once the lease ('lease_expires_at') elapses, 'sweep_expired_delivery_reservations()'
 *    resets the delivery back to 'pending' (provided attempt_count < max_attempts).
 * 4. A subsequent worker will re-reserve and re-dispatch the payload, resulting in a DUPLICATE notification.
 * 
 * Mitigations:
 * - Pre-dispatch fencing ensures no two workers can dispatch the same reservation simultaneously.
 * - Bounded immediate confirmation retries minimize the unconfirmed window.
 * - Client-side deduplication via delivery_id / nonce in Service Worker prevents duplicate alert popups.
 */

import crypto from 'node:crypto';
import os from 'node:os';
import { getSupabaseServerClient } from './supabaseServer.js';
import { getFirebaseMessaging } from './firebaseAdmin.js';
import { maskToken } from './deviceTokenService.js';

/**
 * Generate a unique worker session identifier
 * @param {string} prefix 
 * @returns {string}
 */
export function generateWorkerId(prefix = 'worker') {
  const host = os.hostname() || 'host';
  const pid = process.pid || '0';
  const uid = crypto.randomUUID().substring(0, 8);
  return `${prefix}-${host}-${pid}-${uid}`;
}

/**
 * Map Firebase Cloud Messaging error codes to database error codes
 * @param {any} err Error object from Firebase Admin SDK
 * @returns {{ code: string, message: string, permanent: boolean }}
 */
export function mapFcmError(err) {
  if (!err) {
    return { code: 'UNKNOWN_ERROR', message: 'Unknown error occurred', permanent: false };
  }

  const fcmCode = err.code || (err.errorInfo && err.errorInfo.code) || '';
  const message = err.message || String(err);

  // Permanent failure codes: Unregistered device token or invalid syntax
  if (
    fcmCode === 'messaging/registration-token-not-registered' ||
    fcmCode === 'messaging/invalid-registration-token'
  ) {
    return { code: 'UNREGISTERED', message: `FCM token unregistered: ${message}`, permanent: true };
  }

  if (fcmCode === 'messaging/invalid-argument') {
    return { code: 'INVALID_ARGUMENT', message: `FCM invalid argument: ${message}`, permanent: true };
  }

  if (fcmCode === 'messaging/mismatched-credential') {
    return { code: 'SENDER_ID_MISMATCH', message: `FCM credential mismatch: ${message}`, permanent: true };
  }

  // Transient failure codes: Quota, rate limits, network or server downtime
  if (fcmCode === 'messaging/quota-exceeded' || fcmCode === 'messaging/device-message-rate-exceeded') {
    return { code: 'RESOURCE_EXHAUSTED', message: `FCM rate limit/quota: ${message}`, permanent: false };
  }

  if (fcmCode === 'messaging/server-unavailable' || fcmCode === 'messaging/internal-error') {
    return { code: 'UNAVAILABLE', message: `FCM service unavailable: ${message}`, permanent: false };
  }

  return { code: 'FCM_ERROR', message: `FCM dispatch error [${fcmCode}]: ${message}`, permanent: false };
}

/**
 * Step 2: Reserve a batch of eligible deliveries from the database
 * @param {object} supabase Supabase client
 * @param {string} workerId Unique worker identifier
 * @param {number} batchSize Number of deliveries to reserve
 * @param {number} leaseSeconds Reservation lease timeout in seconds
 * @returns {Promise<Array<object>>}
 */
export async function reserveEligibleDeliveries(supabase, workerId, batchSize = 25, leaseSeconds = 60) {
  const { data, error } = await supabase.rpc('reserve_notification_deliveries', {
    p_worker_id: workerId,
    p_batch_size: batchSize,
    p_lease_seconds: leaseSeconds,
  });

  if (error) {
    console.error('[DispatchWorker] Reservation error:', error.message);
    throw new Error(`Failed to reserve deliveries: ${error.message}`);
  }

  return data || [];
}

/**
 * Step 3: Authorize dispatch on the database fence before sending
 * @param {object} supabase Supabase client
 * @param {object} delivery Delivery record from reservation
 * @param {string} workerId Worker identifier
 * @returns {Promise<object>} Authorization result object
 */
export async function authorizeDispatch(supabase, delivery, workerId) {
  const { data, error } = await supabase.rpc('authorize_notification_delivery_dispatch', {
    p_delivery_id: delivery.delivery_id,
    p_token_id: delivery.token_id,
    p_reservation_token: delivery.reservation_token,
    p_worker_id: workerId,
    p_recipient_id: delivery.recipient_id,
  });

  if (error) {
    console.error('[DispatchWorker] Authorization RPC error for delivery:', delivery.delivery_id, error.message);
    return { authorized: false, reason: 'AUTHORIZATION_RPC_ERROR', details: error.message };
  }

  return data;
}

/**
 * Step 4A: Confirm delivery sent in the database with bounded retries
 * @param {object} supabase Supabase client
 * @param {string} deliveryId Delivery UUID
 * @param {string} dispatchAttemptId Attempt UUID granted by authorization
 * @param {string} fcmMessageId FCM message identifier returned by Firebase
 * @param {number} maxRetries Number of immediate retries on database errors
 * @returns {Promise<object>}
 */
export async function confirmDeliverySent(supabase, deliveryId, dispatchAttemptId, fcmMessageId, maxRetries = 2) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    attempt++;
    const { data, error } = await supabase.rpc('confirm_notification_delivery_sent', {
      p_delivery_id: deliveryId,
      p_dispatch_attempt_id: dispatchAttemptId,
      p_fcm_message_id: fcmMessageId,
    });

    if (!error) {
      if (data && data.success === false) {
        console.warn(`[DispatchWorker] Delivery ${deliveryId} confirmation rejected:`, data.reason);
      }
      return data;
    }

    console.error(
      `[DispatchWorker] Confirmation RPC error (attempt ${attempt}/${maxRetries + 1}) for delivery ${deliveryId}:`,
      error.message
    );

    if (attempt <= maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    } else {
      throw new Error(`Failed to confirm delivery sent: ${error.message}`);
    }
  }
}

/**
 * Step 4B: Record delivery failure or schedule retry in the database
 * @param {object} supabase Supabase client
 * @param {object} delivery Delivery record
 * @param {string} workerId Worker identifier
 * @param {string} errorCode Error category code
 * @param {string} errorMessage Error explanation
 * @param {number|null} retryAfterSeconds Optional custom retry delay
 * @returns {Promise<string>} New status ('failed' or 'pending')
 */
export async function recordDeliveryFailure(
  supabase,
  delivery,
  workerId,
  errorCode,
  errorMessage,
  retryAfterSeconds = null
) {
  const { data, error } = await supabase.rpc('fail_or_retry_notification_delivery', {
    p_delivery_id: delivery.delivery_id,
    p_worker_id: workerId,
    p_reservation_token: delivery.reservation_token,
    p_error_code: errorCode,
    p_error_message: errorMessage,
    p_retry_after_seconds: retryAfterSeconds,
  });

  if (error) {
    console.error('[DispatchWorker] Failure/retry RPC error for delivery:', delivery.delivery_id, error.message);
    throw new Error(`Failed to record delivery failure: ${error.message}`);
  }

  return data;
}

/**
 * Build safe FCM Message payload
 * @param {object} delivery 
 * @param {object|null} campaign 
 * @returns {object}
 */
export function buildFcmPayload(delivery, campaign = null) {
  const title = campaign?.title || 'MovieVerify Update';
  const body = campaign?.body || 'You have a new notification from MovieVerify.';
  const linkUrl = campaign?.action_url || campaign?.url || '/';
  const resolvedToken = delivery.provider_token || delivery.raw_token;

  const fcmMessage = {
    token: resolvedToken,
    notification: {
      title,
      body,
    },
    data: {
      delivery_id: delivery.delivery_id != null ? String(delivery.delivery_id) : '',
      recipient_id: delivery.recipient_id != null ? String(delivery.recipient_id) : '',
      campaign_id: delivery.campaign_id != null ? String(delivery.campaign_id) : '',
      category: String(campaign?.category || 'system'),
      url: String(linkUrl),
      title: String(title),
      body: String(body),
    },
    webpush: {
      fcmOptions: {
        link: linkUrl,
      },
      headers: {
        Urgency: 'high',
        TTL: '86400',
      },
      notification: {
        icon: '/logo192.png',
        badge: '/badge.png',
        vibrate: [200, 100, 200, 100, 200],
        silent: false,
        renotify: true,
        tag: (delivery.delivery_id != null && String(delivery.delivery_id).trim() !== '')
          ? String(delivery.delivery_id)
          : (campaign?.id ? String(campaign.id) : 'movieverify-campaign'),
        data: {
          url: linkUrl,
          delivery_id: delivery.delivery_id != null ? String(delivery.delivery_id) : '',
        },
        actions: [
          { action: 'download', title: '⬇️ Download Now' },
        ],
      },
    },
  };

  if (campaign?.image_url) {
    fcmMessage.notification.imageUrl = campaign.image_url;
    fcmMessage.webpush.notification.image = campaign.image_url;
    fcmMessage.data.image = String(campaign.image_url);
  }

  return fcmMessage;
}

/**
 * Process a single delivery end-to-end
 * @param {object} delivery Delivery row from reservation
 * @param {object} context Worker execution context
 * @returns {Promise<{ status: string, deliveryId: string, messageId?: string, error?: string }>}
 */
export async function processDelivery(delivery, context) {
  const { supabase, messaging, workerId, campaignCache } = context;
  const deliveryId = delivery.delivery_id;

  // 1. Fetch Campaign details before authorizing dispatch so lookup latency/failure
  // never holds an authorized dispatch_attempt_id across a network round-trip.
  let campaign = null;
  if (delivery.campaign_id) {
    if (campaignCache.has(delivery.campaign_id)) {
      campaign = campaignCache.get(delivery.campaign_id);
    } else {
      let campData = null;
      let campLookupError = null;
      try {
        const res = await supabase
          .from('notification_campaigns')
          .select('id, title, body, category, action_url, image_url')
          .eq('id', delivery.campaign_id)
          .maybeSingle();
        campData = res?.data ?? null;
        campLookupError = res?.error ?? null;
      } catch (err) {
        campLookupError = err;
      }

      if (campLookupError) {
        const errorMessage = campLookupError.message || 'Unknown campaign lookup error';
        console.error(
          `[DispatchWorker] Campaign lookup failed for delivery ${deliveryId} (campaign ${delivery.campaign_id}):`,
          errorMessage
        );
        try {
          const failureStatus = await recordDeliveryFailure(
            supabase,
            delivery,
            workerId,
            'CAMPAIGN_LOOKUP_FAILED',
            errorMessage
          );
          return {
            status: failureStatus,
            deliveryId,
            permanent: failureStatus === 'failed',
            reason: 'CAMPAIGN_LOOKUP_FAILED',
            error: errorMessage,
          };
        } catch (recordErr) {
          return {
            status: 'error',
            deliveryId,
            reason: 'CAMPAIGN_LOOKUP_FAILED',
            error: recordErr.message,
          };
        }
      }

      if (campData) {
        campaign = campData;
        campaignCache.set(delivery.campaign_id, campData);
      }
    }
  }

  // 2. Authorize Dispatch (Provider Boundary Fence)
  const authResult = await authorizeDispatch(supabase, delivery, workerId);

  if (!authResult || !authResult.authorized) {
    const reason = authResult?.reason || 'AUTHORIZATION_DENIED';
    // When authorization fails (e.g. ownership changed or token inactive), the database
    // function has already updated the delivery status safely.
    return {
      status: 'rejected',
      deliveryId,
      reason,
    };
  }

  const dispatchAttemptId = authResult.dispatch_attempt_id;
  const authorizedToken = typeof authResult.provider_token === 'string' ? authResult.provider_token.trim() : '';

  if (!authorizedToken || (delivery.raw_token && authorizedToken !== delivery.raw_token)) {
    const mismatchMsg = !authorizedToken
      ? 'Authorized provider_token missing from dispatch authorization response.'
      : 'Authorized provider_token mismatched reserved delivery raw_token.';
    console.error(`[DispatchWorker] Token fence rejection for delivery ${deliveryId}: ${mismatchMsg}`);
    try {
      await recordDeliveryFailure(
        supabase,
        delivery,
        workerId,
        'PROVIDER_TOKEN_MISMATCH',
        mismatchMsg,
        null
      );
    } catch (recordErr) {
      console.error(`[DispatchWorker] Failed recording token mismatch for delivery ${deliveryId}:`, recordErr.message);
    }
    return {
      status: 'rejected',
      deliveryId,
      reason: 'PROVIDER_TOKEN_MISMATCH',
    };
  }

  // 3. Dispatch via Firebase Admin SDK using the freshly authorized provider token
  const fcmMessage = buildFcmPayload({ ...delivery, raw_token: authorizedToken }, campaign);
  let fcmMessageId = null;

  try {
    fcmMessageId = await messaging.send(fcmMessage);
  } catch (err) {
    const { code, message, permanent } = mapFcmError(err);
    console.error(
      `[DispatchWorker] Dispatch failed for delivery ${deliveryId} (Token: ${maskToken(authorizedToken)}): [${code}]`
    );

    const newStatus = await recordDeliveryFailure(
      supabase,
      delivery,
      workerId,
      code,
      message,
      permanent ? null : undefined
    );

    return {
      status: newStatus,
      deliveryId,
      error: code,
      permanent,
    };
  }

  // 4. Confirm Successful Delivery
  try {
    const confirmRes = await confirmDeliverySent(supabase, deliveryId, dispatchAttemptId, fcmMessageId);
    if (confirmRes && confirmRes.success === false) {
      console.warn(`[DispatchWorker] Delivery ${deliveryId} confirmation rejected: ${confirmRes.reason}`);
      return {
        status: 'confirmation_rejected',
        deliveryId,
        messageId: fcmMessageId,
        reason: confirmRes.reason,
      };
    }
  } catch (confirmErr) {
    // Distributed boundary failure: FCM accepted the message, but PostgreSQL confirmation failed after retries.
    // Delivery remains in 'leased' status with an active dispatch_attempt_id and duplicate send risk if lease expires and sweeper resets it.
    console.error(
      `[DispatchWorker] CRITICAL POST-SEND DB FAILURE: FCM accepted message (ID: ${fcmMessageId}) for delivery ${deliveryId}, but confirmation RPC failed: ${confirmErr.message}. Delivery remains in 'leased' status (active dispatch_attempt_id) with duplicate send risk upon lease expiry.`
    );
    return {
      status: 'unconfirmed_sent',
      deliveryId,
      messageId: fcmMessageId,
      warning: 'FCM accepted message but database confirmation failed',
      error: confirmErr.message,
    };
  }

  return {
    status: 'sent',
    deliveryId,
    messageId: fcmMessageId,
  };
}

/**
 * Runtime dispatch kill switch.
 * Fails closed unless NOTIFICATION_DISPATCH_ENABLED is explicitly set to 'true'.
 * @returns {boolean}
 */
export function isNotificationDispatchEnabled() {
  return process.env.NOTIFICATION_DISPATCH_ENABLED === 'true';
}

function createDispatchDisabledError() {
  const err = new Error('Notification dispatch is disabled. Set NOTIFICATION_DISPATCH_ENABLED=true to enable execution.');
  err.code = 'DISPATCH_DISABLED';
  return err;
}

/**
 * Execute a complete dispatch cycle for reserved deliveries
 * @param {object} options Worker options
 * @returns {Promise<{ workerId: string, processed: number, sent: number, failed: number, rejected: number, results: Array }>}
 */
export async function runDispatchCycle(options = {}) {
  if (!isNotificationDispatchEnabled()) {
    throw createDispatchDisabledError();
  }

  const workerId = options.workerId || generateWorkerId();
  const batchSize = options.batchSize || 25;
  const leaseSeconds = options.leaseSeconds || 60;

  const supabase = options.customSupabase || getSupabaseServerClient();
  const messaging = options.customMessaging || getFirebaseMessaging();

  if (!messaging) {
    throw new Error('Firebase Messaging is not initialized. Please verify service account credentials.');
  }

  // 1. Reserve Deliveries
  const deliveries = await reserveEligibleDeliveries(supabase, workerId, batchSize, leaseSeconds);

  if (!deliveries || deliveries.length === 0) {
    return {
      workerId,
      processed: 0,
      sent: 0,
      failed: 0,
      rejected: 0,
      results: [],
    };
  }

  const campaignCache = new Map();
  const context = {
    supabase,
    messaging,
    workerId,
    campaignCache,
  };

  const results = [];
  let sentCount = 0;
  let failedCount = 0;
  let rejectedCount = 0;

  // Process in bounded concurrency chunks (5 parallel) to optimize speed without exceeding DB/FCM pools
  const CONCURRENCY_LIMIT = 5;
  for (let i = 0; i < deliveries.length; i += CONCURRENCY_LIMIT) {
    const chunk = deliveries.slice(i, i + CONCURRENCY_LIMIT);
    const chunkOutcomes = await Promise.allSettled(
      chunk.map(async (delivery) => {
        try {
          return await processDelivery(delivery, context);
        } catch (err) {
          console.error('[DispatchWorker] Unexpected error processing delivery:', delivery.delivery_id, err.message);
          return { status: 'error', deliveryId: delivery.delivery_id, error: err.message };
        }
      })
    );

    for (const outcome of chunkOutcomes) {
      const res = outcome.status === 'fulfilled'
        ? outcome.value
        : { status: 'error', error: outcome.reason?.message || 'Unknown chunk failure' };
      results.push(res);
      if (res.status === 'sent' || res.status === 'unconfirmed_sent') {
        sentCount++;
      } else if (res.status === 'rejected' || res.status === 'confirmation_rejected') {
        rejectedCount++;
      } else {
        failedCount++;
      }
    }
  }

  return {
    workerId,
    processed: deliveries.length,
    sent: sentCount,
    failed: failedCount,
    rejected: rejectedCount,
    results,
  };
}

/**
 * Recover abandoned or expired reservations
 * @param {object|null} customSupabase 
 * @returns {Promise<number>} Number of recovered reservations
 */
export async function sweepExpiredReservations(customSupabase = null) {
  const supabase = customSupabase || getSupabaseServerClient();
  const { data, error } = await supabase.rpc('sweep_expired_delivery_reservations');

  if (error) {
    console.error('[DispatchWorker] Sweep RPC error:', error.message);
    throw new Error(`Failed to sweep expired reservations: ${error.message}`);
  }

  return data || 0;
}
