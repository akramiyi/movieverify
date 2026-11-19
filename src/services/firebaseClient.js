/**
 * MovieVerify Firebase Cloud Messaging (Web Client)
 * 
 * Provides isolated, client-side Firebase initialization and FCM token management.
 * 
 * Security & Design Principles:
 * 1. Uses public client credentials only (VITE_FIREBASE_*). No private keys.
 * 2. Initializes Firebase App and Messaging lazily and idempotently.
 * 3. Never auto-prompts for permissions without explicit user action.
 * 4. Binds to existing canonical Service Worker (/sw.js).
 * 5. Registers tokens via authenticated backend API (/api/notifications/register).
 * 6. Revokes tokens on logout via (/api/notifications/revoke).
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';

let appInstance = null;
let messagingInstance = null;
let lastFcmError = null;

/**
 * Returns the most recent FCM token error, if any
 * @returns {Error|null}
 */
export function getLastFcmError() {
  return lastFcmError;
}

/**
 * Detects whether the current browser context is an embedded in-app WebView
 * (e.g. WhatsApp, Instagram, Facebook, Telegram, TikTok, WeChat, etc.)
 * In-app browsers do not support Web Push / PushManager OS background routing.
 * @param {string} [customUserAgent] Optional user agent override (useful for testing)
 * @returns {boolean}
 */
export function isInAppBrowser(customUserAgent = null) {
  if (customUserAgent && typeof customUserAgent === 'string') {
    return /FBAN|FBAV|Instagram|WhatsApp|Line|musical_ly|Bytedance|TikTok|MicroMessenger|Snapchat|Telegram|Twitter|LinkedIn|Pinterest|GSA|GSA\//i.test(customUserAgent);
  }
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || navigator.vendor || (typeof window !== 'undefined' && window.opera) || '';
  return /FBAN|FBAV|Instagram|WhatsApp|Line|musical_ly|Bytedance|TikTok|MicroMessenger|Snapchat|Telegram|Twitter|LinkedIn|Pinterest|GSA|GSA\//i.test(ua);
}

/**
 * Retrieves the Firebase Web client configuration from Vite environment variables
 * or custom overrides (useful for testing).
 * @param {object} [customConfig]
 * @returns {object}
 */
export function getFirebaseWebConfig(customConfig = null) {
  if (customConfig) return customConfig;

  // Safe access for browser and testing environments
  const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : (typeof process !== 'undefined' && process.env ? process.env : {});

  return {
    apiKey: env.VITE_FIREBASE_API_KEY || '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: env.VITE_FIREBASE_PROJECT_ID || '',
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: env.VITE_FIREBASE_APP_ID || '',
    measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || '',
    vapidKey: env.VITE_FIREBASE_VAPID_KEY || '',
  };
}

/**
 * Validates that essential Firebase web credentials are present
 * @param {object} config 
 * @returns {boolean}
 */
export function isFirebaseConfigValid(config) {
  if (!config || typeof config !== 'object') return false;
  const { apiKey, projectId, messagingSenderId, appId } = config;
  return Boolean(
    apiKey && typeof apiKey === 'string' && apiKey.trim() !== '' &&
    projectId && typeof projectId === 'string' && projectId.trim() !== '' &&
    messagingSenderId && typeof messagingSenderId === 'string' && messagingSenderId.trim() !== '' &&
    appId && typeof appId === 'string' && appId.trim() !== ''
  );
}

/**
 * Detects whether the current browser environment supports Push Notifications and Service Workers
 * @returns {Promise<boolean>}
 */
export async function isPushNotificationSupported() {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window)) return false;
  if (!('serviceWorker' in navigator)) return false;
  if (!('PushManager' in window)) return false;

  try {
    return await isSupported();
  } catch {
    return false;
  }
}

/**
 * Initializes Firebase App idempotently
 * @param {object} [customConfig]
 * @returns {object|null}
 */
export function initFirebaseApp(customConfig = null) {
  const config = getFirebaseWebConfig(customConfig);
  if (!isFirebaseConfigValid(config)) {
    return null;
  }

  if (appInstance) {
    return appInstance;
  }

  const existingApps = getApps();
  if (existingApps.length > 0) {
    appInstance = getApp();
    return appInstance;
  }

  appInstance = initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
    measurementId: config.measurementId,
  });

  return appInstance;
}

/**
 * Retrieves the Firebase Messaging instance
 * @param {object} [customConfig]
 * @returns {Promise<object|null>}
 */
export async function getMessagingInstance(customConfig = null) {
  if (messagingInstance) return messagingInstance;

  const supported = await isPushNotificationSupported();
  if (!supported) return null;

  const app = initFirebaseApp(customConfig);
  if (!app) return null;

  try {
    messagingInstance = getMessaging(app);
    return messagingInstance;
  } catch (err) {
    console.warn('[FCMClient] Failed to initialize Firebase Messaging:', err.message);
    return null;
  }
}

/**
 * Requests browser notification permission.
 * MUST be invoked in response to a user gesture (click/tap).
 * @returns {Promise<'granted'|'denied'|'default'|'unsupported'>}
 */
export async function requestNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }

  const current = Notification.permission;
  if (current === 'granted' || current === 'denied') {
    return current;
  }

  try {
    const result = await Notification.requestPermission();
    return result;
  } catch (err) {
    console.error('[FCMClient] Error requesting notification permission:', err.message);
    return Notification.permission || 'denied';
  }
}

/**
 * Generates an FCM device token bound to the canonical service worker (/sw.js)
 * @param {object} options
 * @param {string} [options.vapidKey]
 * @param {ServiceWorkerRegistration} [options.serviceWorkerRegistration]
 * @param {object} [options.customConfig]
 * @returns {Promise<string|null>}
 */
export async function getDeviceFcmToken(options = {}) {
  const { vapidKey: explicitVapid, serviceWorkerRegistration: explicitReg, customConfig } = options;
  lastFcmError = null;

  if (isInAppBrowser()) {
    lastFcmError = new Error('Push notifications are not supported inside in-app browsers (WhatsApp/Telegram/Instagram). Please open this link in Google Chrome or your default device browser.');
    lastFcmError.code = 'in-app-browser';
    console.warn('[FCMClient] In-app browser detected; push notifications are unavailable in embedded webviews.');
    return null;
  }

  const config = getFirebaseWebConfig(customConfig);
  const vapidKey = explicitVapid || config.vapidKey;

  const messaging = await getMessagingInstance(customConfig);
  if (!messaging) {
    lastFcmError = new Error('Push notification service is not configured or unsupported in this browser.');
    return null;
  }

  let swReg = explicitReg;
  if (!swReg && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      // 1. Clean up any rogue secondary registrations (e.g. legacy Firebase cloud messaging push scope)
      const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
      for (const reg of registrations) {
        if (reg.scope && reg.scope.includes('firebase-cloud-messaging-push-scope')) {
          console.warn('[FCMClient] Cleaning up conflicting secondary service worker:', reg.scope);
          await reg.unregister().catch(() => {});
        }
      }

      // 2. Ensure /sw.js is registered at root scope
      await navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});

      // 3. Resolve active service worker
      swReg = await navigator.serviceWorker.ready;
    } catch (swErr) {
      console.warn('[FCMClient] Service worker ready check failed:', swErr.message);
    }
  }

  const tokenParams = {};
  if (vapidKey) tokenParams.vapidKey = vapidKey;
  if (swReg) {
    tokenParams.serviceWorkerRegistration = swReg;
  }

  // Attempt token generation with automatic self-healing retry (up to 3 attempts)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const currentToken = await getToken(messaging, tokenParams);
      if (currentToken) {
        lastFcmError = null;
        return currentToken;
      }
    } catch (tokenErr) {
      lastFcmError = tokenErr;
      const errMsg = tokenErr?.message || '';
      console.warn(`[FCMClient] FCM token attempt ${attempt} failed:`, errMsg);

      if (attempt < 3 && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        // Heal push service error, AbortError, or stale subscription conflicts
        if (
          errMsg.toLowerCase().includes('push service error') ||
          errMsg.toLowerCase().includes('aborterror') ||
          errMsg.toLowerCase().includes('subscription')
        ) {
          try {
            const targetReg = tokenParams.serviceWorkerRegistration || await navigator.serviceWorker.ready.catch(() => null);
            if (targetReg && targetReg.pushManager) {
              const existingSub = await targetReg.pushManager.getSubscription().catch(() => null);
              if (existingSub) {
                console.warn('[FCMClient] Healing push service error by clearing stale subscription...');
                await existingSub.unsubscribe().catch(() => {});
              }
            }
          } catch (healErr) {
            console.warn('[FCMClient] Subscription healing warning:', healErr?.message);
          }
        }

        // Stagger retry: 1000ms on first attempt, 1800ms on second attempt (to give Android Play Services socket time to reconnect)
        const delay = attempt === 1 ? 1000 : 1800;
        await new Promise((r) => setTimeout(r, delay));

        try {
          const freshReg = await navigator.serviceWorker.ready;
          if (freshReg) {
            tokenParams.serviceWorkerRegistration = freshReg;
          }
        } catch {}
      }
    }
  }

  return null;
}

/**
 * Forces clean-up of stale push subscriptions and resets the canonical service worker.
 * Fixes "Registration failed - push service error" on Android/Chrome.
 * @returns {Promise<boolean>}
 */
export async function repairPushRegistration() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }

  try {
    // 1. Unsubscribe any stale push subscription
    try {
      const reg = await navigator.serviceWorker.getRegistration('/').catch(() => null);
      if (reg && reg.pushManager) {
        const sub = await reg.pushManager.getSubscription().catch(() => null);
        if (sub) {
          await sub.unsubscribe().catch(() => {});
        }
      }
    } catch {}

    // 2. Unregister any secondary service workers
    const allRegs = await navigator.serviceWorker.getRegistrations().catch(() => []);
    for (const r of allRegs) {
      if (r.scope && r.scope.includes('firebase-cloud-messaging-push-scope')) {
        await r.unregister().catch(() => {});
      }
    }

    // 3. Re-register canonical /sw.js at root scope
    await navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    await navigator.serviceWorker.ready.catch(() => {});

    return true;
  } catch (err) {
    console.warn('[FCMClient] repairPushRegistration warning:', err?.message);
    return false;
  }
}

/**
 * Registers an FCM token with the MovieVerify backend API (/api/notifications/register)
 * @param {object} params
 * @param {string} params.token FCM Device Token
 * @param {string} params.accessToken Supabase User JWT
 * @param {object} [params.deviceInfo] Optional device metadata
 * @param {function} [params.customFetch] Optional fetch override for testing
 * @returns {Promise<{ success: boolean, status: number, data?: object, error?: string }>}
 */
export async function registerTokenWithBackend({
  token,
  accessToken,
  deviceInfo = {},
  deviceName = null,
  browser = null,
  os = null,
  reauthorize = false,
  customFetch = null,
}) {
  if (!token || typeof token !== 'string') {
    return { success: false, status: 400, error: 'Token is required' };
  }
  if (!accessToken || typeof accessToken !== 'string') {
    return { success: false, status: 401, error: 'Authenticated user access token is required' };
  }

  const fetchFn = customFetch || (typeof window !== 'undefined' ? window.fetch.bind(window) : fetch);

  const navPlatform = typeof navigator !== 'undefined' ? navigator.platform : null;
  const navUserAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null;
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navUserAgent || '');
  const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navUserAgent || '');
  const detectedDeviceType = isAndroid ? 'android' : isIOS ? 'ios' : 'web';

  let detectedOs = 'Unknown OS';
  if (isAndroid) detectedOs = 'Android';
  else if (isIOS) detectedOs = 'iOS';
  else if (typeof navigator !== 'undefined' && /Windows/i.test(navUserAgent || '')) detectedOs = 'Windows';
  else if (typeof navigator !== 'undefined' && /Mac/i.test(navUserAgent || '')) detectedOs = 'macOS';

  let detectedBrowser = 'Browser';
  if (typeof navigator !== 'undefined' && navUserAgent) {
    if (/Edg/i.test(navUserAgent)) detectedBrowser = 'Edge';
    else if (/Chrome/i.test(navUserAgent)) detectedBrowser = 'Chrome';
    else if (/Firefox/i.test(navUserAgent)) detectedBrowser = 'Firefox';
    else if (/Safari/i.test(navUserAgent)) detectedBrowser = 'Safari';
  }

  const resolvedDeviceName = (deviceName || deviceInfo.device_name || deviceInfo.deviceName || (navPlatform ? `${detectedOs} - ${detectedBrowser}` : null))?.slice(0, 128) || null;
  const resolvedBrowser = (browser || deviceInfo.browser || (navUserAgent ? detectedBrowser : null))?.slice(0, 64) || null;
  const resolvedOs = (os || deviceInfo.os || deviceInfo.platform || (navPlatform ? detectedOs : null))?.slice(0, 64) || null;

  const payload = {
    token,
    device_type: deviceInfo.device_type || detectedDeviceType,
    ...(resolvedDeviceName ? { device_name: resolvedDeviceName } : {}),
    ...(resolvedBrowser ? { browser: resolvedBrowser } : {}),
    ...(resolvedOs ? { os: resolvedOs } : {}),
    ...(reauthorize === true ? { reauthorize: true } : {}),
    device_info: {
      userAgent: navUserAgent || 'Unknown',
      platform: navPlatform || 'Unknown',
      language: typeof navigator !== 'undefined' ? navigator.language : 'en',
      ...deviceInfo,
    },
  };

  try {
    const res = await fetchFn('/api/notifications/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => null);

    if (res.ok) {
      return { success: true, status: res.status, data };
    }

    return {
      success: false,
      status: res.status,
      code: data?.code,
      data: data?.data,
      error: data?.error || `Registration failed with status ${res.status}`,
    };
  } catch (err) {
    console.error('[FCMClient] Backend registration network error:', err.message);
    return { success: false, status: 500, error: err.message };
  }
}

/**
 * Revokes an FCM device token upon logout (/api/notifications/revoke)
 * @param {object} params
 * @param {string} params.token FCM Device Token
 * @param {string} params.accessToken Supabase User JWT
 * @param {function} [params.customFetch] Optional fetch override for testing
 * @returns {Promise<{ success: boolean, status: number, error?: string }>}
 */
export async function revokeTokenWithBackend({ token, accessToken, customFetch = null }) {
  if (!token || typeof token !== 'string') {
    return { success: false, status: 400, error: 'Token is required for revocation' };
  }
  if (!accessToken || typeof accessToken !== 'string') {
    return { success: false, status: 401, error: 'Access token is required for revocation' };
  }

  const fetchFn = customFetch || (typeof window !== 'undefined' ? window.fetch.bind(window) : fetch);

  try {
    const res = await fetchFn('/api/notifications/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token }),
    });

    const data = await res.json().catch(() => null);

    if (res.ok) {
      return { success: true, status: res.status };
    }

    return {
      success: false,
      status: res.status,
      error: data?.error || `Revocation failed with status ${res.status}`,
    };
  } catch (err) {
    console.error('[FCMClient] Backend revocation network error:', err.message);
    return { success: false, status: 500, error: err.message };
  }
}

/**
 * Subscribes to foreground push notifications
 * @param {object} messaging Firebase Messaging instance
 * @param {function} onPayload Callback when message arrives in foreground
 * @returns {function} Unsubscribe function
 */
export function setupForegroundMessageHandler(messaging, onPayload) {
  if (!messaging || typeof onPayload !== 'function') {
    return () => {};
  }
  try {
    return onMessage(messaging, (payload) => {
      onPayload(payload);
    });
  } catch (err) {
    console.warn('[FCMClient] Unable to attach onMessage listener:', err.message);
    return () => {};
  }
}

/**
 * Reset module state (Used for test suite isolation)
 */
export function resetFirebaseClient() {
  appInstance = null;
  messagingInstance = null;
  lastFcmError = null;
}

