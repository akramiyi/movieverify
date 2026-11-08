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
  const config = getFirebaseWebConfig(customConfig);
  const vapidKey = explicitVapid || config.vapidKey;

  const messaging = await getMessagingInstance(customConfig);
  if (!messaging) {
    return null;
  }

  let swReg = explicitReg;
  if (!swReg && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      swReg = await navigator.serviceWorker.ready;
    } catch (swErr) {
      console.warn('[FCMClient] Service worker ready check failed:', swErr.message);
    }
  }

  const tokenParams = {};
  if (vapidKey) tokenParams.vapidKey = vapidKey;
  if (swReg) tokenParams.serviceWorkerRegistration = swReg;

  try {
    const currentToken = await getToken(messaging, tokenParams);
    return currentToken || null;
  } catch (tokenErr) {
    console.error('[FCMClient] Error generating FCM device token:', tokenErr.message);
    return null;
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
export async function registerTokenWithBackend({ token, accessToken, deviceInfo = {}, customFetch = null }) {
  if (!token || typeof token !== 'string') {
    return { success: false, status: 400, error: 'Token is required' };
  }
  if (!accessToken || typeof accessToken !== 'string') {
    return { success: false, status: 401, error: 'Authenticated user access token is required' };
  }

  const fetchFn = customFetch || (typeof window !== 'undefined' ? window.fetch.bind(window) : fetch);

  const payload = {
    token,
    device_type: 'web',
    device_info: {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
      platform: typeof navigator !== 'undefined' ? navigator.platform : 'Unknown',
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
}

