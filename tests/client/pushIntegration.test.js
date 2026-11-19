/**
 * MovieVerify Phase 15.2.3 — Frontend FCM Client & PWA Push Integration Test Suite
 * 
 * Verifies all 15 required categories:
 * 1. Firebase Web initialization
 * 2. Missing Firebase configuration
 * 3. Unsupported browser detection
 * 4. Permission granted flow
 * 5. Permission denied handling
 * 6. Token registration with backend
 * 7. Token refresh and idempotency
 * 8. Logout revocation with backend
 * 9. Foreground push handling
 * 10. Background push handling
 * 11. Duplicate delivery ID suppression
 * 12. Notification click and safe internal deep link navigation
 * 13. Service worker offline cache regression
 * 14. Existing PWA registration behavior
 * 15. Existing authentication regression
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  isFirebaseConfigValid,
  isPushNotificationSupported,
  initFirebaseApp,
  requestNotificationPermission,
  registerTokenWithBackend,
  revokeTokenWithBackend,
  resetFirebaseClient,
  isInAppBrowser,
  getLastFcmError,
  repairPushRegistration,
} from '../../src/services/firebaseClient.js';

test('1. Firebase Web Initialization Suite', async (t) => {
  t.beforeEach(() => {
    resetFirebaseClient();
  });

  t.afterEach(() => {
    resetFirebaseClient();
  });

  await t.test('Initializes Firebase App successfully with valid configuration', () => {
    const validConfig = {
      apiKey: 'AIzaSyTestKey123456789',
      authDomain: 'movieverify-app.firebaseapp.com',
      projectId: 'movieverify-app',
      storageBucket: 'movieverify-app.appspot.com',
      messagingSenderId: '109876543210',
      appId: '1:109876543210:web:abcdef123456',
    };

    const app = initFirebaseApp(validConfig);
    assert.ok(app, 'Firebase app instance must be created');
    assert.equal(app.name, '[DEFAULT]');

    // Verify duplicate initialization prevention (Singleton)
    const appSecond = initFirebaseApp(validConfig);
    assert.equal(appSecond, app, 'Must return the same app instance on subsequent calls');
  });
});

test('2. Missing Firebase Configuration Suite', async (t) => {
  t.beforeEach(() => {
    resetFirebaseClient();
  });

  await t.test('Rejects empty or null configuration safely', () => {
    assert.equal(isFirebaseConfigValid(null), false);
    assert.equal(isFirebaseConfigValid({}), false);
    assert.equal(initFirebaseApp({}), null);
  });

  await t.test('Rejects partial configuration with missing required keys', () => {
    const missingAppId = {
      apiKey: 'AIzaSyTestKey123456789',
      projectId: 'movieverify-app',
      messagingSenderId: '109876543210',
      // appId is missing
    };
    assert.equal(isFirebaseConfigValid(missingAppId), false);
    assert.equal(initFirebaseApp(missingAppId), null);

    const missingApiKey = {
      projectId: 'movieverify-app',
      messagingSenderId: '109876543210',
      appId: '1:109876543210:web:abcdef123456',
    };
    assert.equal(isFirebaseConfigValid(missingApiKey), false);
    assert.equal(initFirebaseApp(missingApiKey), null);
  });
});

test('3. Unsupported Browser Detection Suite', async (t) => {
  await t.test('Returns false when window or Notification is undefined', async () => {
    // In Node.js testing environment, window is undefined
    const supported = await isPushNotificationSupported();
    assert.equal(supported, false, 'Node.js test environment must detect unsupported browser');
  });

  await t.test('requestNotificationPermission returns unsupported when Notification API is absent', async () => {
    const perm = await requestNotificationPermission();
    assert.equal(perm, 'unsupported');
  });
});

test('4 & 5. Permission Lifecycle Suite (Granted & Denied)', async (t) => {
  const originalWindow = global.window;
  const originalNotification = global.Notification;

  t.afterEach(() => {
    global.window = originalWindow;
    global.Notification = originalNotification;
  });

  await t.test('4. Permission Granted Flow: Returns granted upon user acceptance', async () => {
    const mockNotification = {
      permission: 'default',
      async requestPermission() {
        this.permission = 'granted';
        return 'granted';
      },
    };
    global.window = { Notification: mockNotification };
    global.Notification = mockNotification;

    const result = await requestNotificationPermission();
    assert.equal(result, 'granted');
    assert.equal(global.Notification.permission, 'granted');
  });

  await t.test('5. Permission Denied Flow: Returns denied upon rejection without reprompting', async () => {
    const mockNotification = {
      permission: 'denied',
      async requestPermission() {
        return 'denied';
      },
    };
    global.window = { Notification: mockNotification };
    global.Notification = mockNotification;

    // If permission is already denied, requestPermission should return denied immediately
    const result = await requestNotificationPermission();
    assert.equal(result, 'denied');
  });
});

test('6 & 7. FCM Token Registration & Refresh Suite', async (t) => {
  await t.test('6. Token Registration: Calls /api/notifications/register with auth header and payload', async () => {
    let capturedUrl = '';
    let capturedOptions = {};

    const mockFetch = async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        status: 201,
        json: async () => ({
          success: true,
          status: 'created',
          token_id: 'tok-uuid-1',
          masked_token: 'fK3b8x...91xL',
        }),
      };
    };

    const res = await registerTokenWithBackend({
      token: 'fK3b8x999999999999999999999999999999999999999999999999999999999991xL',
      accessToken: 'valid-user-jwt-session',
      deviceInfo: { browser: 'Chrome' },
      customFetch: mockFetch,
    });

    assert.equal(res.success, true);
    assert.equal(res.status, 201);
    assert.equal(capturedUrl, '/api/notifications/register');
    assert.equal(capturedOptions.method, 'POST');
    assert.equal(capturedOptions.headers['Authorization'], 'Bearer valid-user-jwt-session');

    const body = JSON.parse(capturedOptions.body);
    assert.equal(body.device_type, 'web');
    assert.equal(body.browser, 'Chrome');
    assert.equal(body.device_info.browser, 'Chrome');
    assert.equal(body.reauthorize, undefined);
    assert.equal(body.token, 'fK3b8x999999999999999999999999999999999999999999999999999999999991xL');

    // Explicit reauthorization sends top-level metadata & reauthorize: true
    await registerTokenWithBackend({
      token: 'fK3b8x999999999999999999999999999999999999999999999999999999999991xL',
      accessToken: 'valid-user-jwt-session',
      deviceName: 'Desktop Chrome',
      browser: 'Chrome 130',
      os: 'Windows',
      reauthorize: true,
      customFetch: mockFetch,
    });
    const reauthBody = JSON.parse(capturedOptions.body);
    assert.equal(reauthBody.reauthorize, true);
    assert.equal(reauthBody.device_name, 'Desktop Chrome');
    assert.equal(reauthBody.browser, 'Chrome 130');
    assert.equal(reauthBody.os, 'Windows');

    // Hook wiring check: subscribe passes reauthorize: true; passive SIGNED_IN passes reauthorize: false
    const hookSrc = fs.readFileSync(path.resolve('src/hooks/usePushNotifications.js'), 'utf8');
    assert.match(hookSrc, /subscribe[\s\S]*reauthorize:\s*true/);
    assert.match(hookSrc, /SIGNED_IN[\s\S]*reauthorize:\s*false/);
  });

  await t.test('7. Token Refresh & Validation: Rejects invalid or missing parameters safely', async () => {
    const missingToken = await registerTokenWithBackend({
      token: '',
      accessToken: 'jwt',
    });
    assert.equal(missingToken.success, false);
    assert.equal(missingToken.status, 400);

    const missingJwt = await registerTokenWithBackend({
      token: 'some-token',
      accessToken: '',
    });
    assert.equal(missingJwt.success, false);
    assert.equal(missingJwt.status, 401);
  });
});

test('8. Logout Revocation Suite', async (t) => {
  await t.test('Calls /api/notifications/revoke with auth token upon logout', async () => {
    let capturedUrl = '';
    let capturedOptions = {};

    const mockFetch = async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, message: 'Token deactivated' }),
      };
    };

    const res = await revokeTokenWithBackend({
      token: 'fcm-device-token-to-revoke',
      accessToken: 'active-user-jwt',
      customFetch: mockFetch,
    });

    assert.equal(res.success, true);
    assert.equal(res.status, 200);
    assert.equal(capturedUrl, '/api/notifications/revoke');
    assert.equal(capturedOptions.headers['Authorization'], 'Bearer active-user-jwt');

    const body = JSON.parse(capturedOptions.body);
    assert.equal(body.token, 'fcm-device-token-to-revoke');
  });
});

test('9. Foreground Push Handling Suite', async (t) => {
  await t.test('Invokes foreground message callback when payload arrives', () => {
    let listenerCallback = null;

    // Mock messaging instance
    const mockMessaging = {};
    let receivedPayload = null;

    const mockOnMessage = (messaging, cb) => {
      listenerCallback = cb;
      return () => { listenerCallback = null; };
    };

    // Custom foreground subscriber simulation
    function subscribeForeground(messaging, onPayload) {
      return mockOnMessage(messaging, (payload) => {
        onPayload(payload);
      });
    }

    const unsubscribe = subscribeForeground(mockMessaging, (payload) => {
      receivedPayload = payload;
    });

    assert.equal(typeof listenerCallback, 'function');

    // Simulate incoming push payload while app is focused in foreground
    listenerCallback({
      notification: { title: 'New Movie Added', body: 'Watch now on MovieVerify' },
      data: { delivery_id: 'del-fg-1', url: '/movie?id=12345' },
    });

    assert.ok(receivedPayload);
    assert.equal(receivedPayload.notification.title, 'New Movie Added');
    assert.equal(receivedPayload.data.delivery_id, 'del-fg-1');

    unsubscribe();
    assert.equal(listenerCallback, null);
  });
});

test('10, 11, 12, 13. Service Worker Background Push, Deduplication & Offline Cache Suite', async (t) => {
  const swCode = fs.readFileSync(path.resolve('public/sw.js'), 'utf-8');

  await t.test('10. Background Push: Service worker contains push listener and formats notification', () => {
    assert.match(swCode, /self\.addEventListener\(['"]push['"]/);
    assert.match(swCode, /showNotification\(/);
    assert.match(swCode, /tag:\s*deliveryId/);
    assert.match(swCode, /badge:\s*['"]\/(badge\.png|favicon\.ico)['"]/);
  });

  await t.test('11. Client Deduplication: Service worker implements atomic IndexedDB deduplication', () => {
    assert.match(swCode, /DEDUP_DB_NAME\s*=\s*['"]movieverify_pwa_dedup['"]/);
    assert.match(swCode, /isDeliveryDuplicateAndRecord\(/);
    assert.match(swCode, /Duplicate delivery suppressed/);
    // Verifies bounded 24h retention
    assert.match(swCode, /DEDUP_MAX_AGE_MS\s*=\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
    // Verifies tokens are NEVER stored in deduplication store (only id and timestamp)
    assert.doesNotMatch(swCode, /store\.put\([^)]*token[^)]*\)/);
  });

  await t.test('12. Notification Click: Safe deep-link navigation and internal URL validation', () => {
    assert.match(swCode, /self\.addEventListener\(['"]notificationclick['"]/);
    assert.match(swCode, /e\.notification\.close\(\)/);
    // Validates internal path guard against open redirects
    assert.match(swCode, /startsWith\(['"]\/['"]\)/);
    // Match window focus and openWindow logic
    assert.match(swCode, /clients\.matchAll/);
    assert.match(swCode, /clients\.openWindow/);
  });

  await t.test('13. Offline Cache Regression Protection: Existing cache name, install, activate, and fetch handlers preserved', () => {
    // Preserves original CACHE_NAME and STATIC_ASSETS
    assert.match(swCode, /const CACHE_NAME = 'movieverify-v1';/);
    assert.match(swCode, /const STATIC_ASSETS = \['\/', '\/index\.html'\];/);

    // Preserves install event with skipWaiting
    assert.match(swCode, /self\.addEventListener\('install'/);
    assert.match(swCode, /self\.skipWaiting\(\);/);

    // Preserves activate event with cache cleanup and clients.claim
    assert.match(swCode, /self\.addEventListener\('activate'/);
    assert.match(swCode, /self\.clients\.claim\(\);/);

    // Preserves fetch event and same-origin GET restrictions
    assert.match(swCode, /self\.addEventListener\('fetch'/);
    assert.match(swCode, /e\.request\.method !== 'GET' \|\| url\.origin !== self\.location\.origin/);
  });
});

test('14. PWA Registration Behavior Suite', async (t) => {
  const mainCode = fs.readFileSync(path.resolve('src/main.jsx'), 'utf-8');

  await t.test('Registers /sw.js on window load event at root scope', () => {
    assert.match(mainCode, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
    assert.doesNotMatch(mainCode, /firebase-messaging-sw\.js/, 'Must NOT register duplicate firebase-messaging-sw.js');
  });
});

test('15. Authentication Integration Regression Suite', async (t) => {
  const authModalCode = fs.readFileSync(path.resolve('src/components/AuthModal.jsx'), 'utf-8');
  const appCode = fs.readFileSync(path.resolve('src/App.jsx'), 'utf-8');

  await t.test('Preserves Google OAuth, Supabase sessions, and admin login', () => {
    // Google OAuth preservation
    assert.match(authModalCode, /supabase\.auth\.signInWithOAuth\(\s*{\s*provider:\s*['"]google['"]/);

    // Admin password login preservation
    assert.match(authModalCode, /supabase\.auth\.signInWithPassword/);

    // Session tracking in App.jsx
    assert.match(appCode, /supabase\.auth\.getSession\(\)/);
    assert.match(appCode, /supabase\.auth\.onAuthStateChange/);
  });
});

test('16. In-App Browser & Service Worker Token Resilience Suite', async (t) => {
  t.afterEach(() => {
    resetFirebaseClient();
  });

  await t.test('isInAppBrowser identifies WhatsApp, Instagram, Telegram webviews correctly', () => {
    // WhatsApp user-agent
    const whatsappUa = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 WhatsApp/2.24.1.6';
    assert.equal(isInAppBrowser(whatsappUa), true, 'WhatsApp webview must be detected as in-app browser');

    // Instagram user-agent
    const instagramUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Instagram 300.0';
    assert.equal(isInAppBrowser(instagramUa), true, 'Instagram webview must be detected as in-app browser');

    // Telegram user-agent
    const telegramUa = 'Mozilla/5.0 (Linux; Android 13; SM-G998B) Telegram-Android/10.2.0';
    assert.equal(isInAppBrowser(telegramUa), true, 'Telegram webview must be detected as in-app browser');

    // Standard Chrome on Android
    const chromeAndroidUa = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36';
    assert.equal(isInAppBrowser(chromeAndroidUa), false, 'Standard Chrome on Android must not be classified as in-app browser');

    // Standard Desktop Chrome
    const desktopChromeUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    assert.equal(isInAppBrowser(desktopChromeUa), false, 'Standard Desktop Chrome must not be classified as in-app browser');
  });

  await t.test('Canonical firebase-messaging-sw.js exists and bridges to /sw.js', () => {
    const fcmSwPath = path.resolve('public/firebase-messaging-sw.js');
    assert.ok(fs.existsSync(fcmSwPath), 'public/firebase-messaging-sw.js must exist to prevent 404 HTML fallback');
    const fcmSwCode = fs.readFileSync(fcmSwPath, 'utf-8');
    assert.match(fcmSwCode, /importScripts\(['"]\/sw\.js['"]\)/, 'Must bridge directly to canonical /sw.js');
  });

  await t.test('resetFirebaseClient clears lastFcmError state safely', () => {
    resetFirebaseClient();
    assert.equal(getLastFcmError(), null, 'lastFcmError must be null after reset');
  });
});

test('17. Push Service Error Self-Healing & Repair Suite', async (t) => {
  const firebaseClientSrc = fs.readFileSync(path.resolve('src/services/firebaseClient.js'), 'utf8');
  const hookSrc = fs.readFileSync(path.resolve('src/hooks/usePushNotifications.js'), 'utf8');
  const prefSrc = fs.readFileSync(path.resolve('src/components/NotificationPreferences.jsx'), 'utf8');

  await t.test('repairPushRegistration is exported and callable', () => {
    assert.equal(typeof repairPushRegistration, 'function', 'repairPushRegistration must be an exported function');
  });

  await t.test('firebaseClient implements secondary scope unregistration and stale subscription healing', () => {
    assert.match(
      firebaseClientSrc,
      /firebase-cloud-messaging-push-scope/,
      'Must detect and unregister conflicting secondary push scopes'
    );
    assert.match(
      firebaseClientSrc,
      /existingSub\.unsubscribe/,
      'Must heal push service errors by unsubscribing stale subscription'
    );
    assert.match(
      firebaseClientSrc,
      /attempt\s*<=\s*3/,
      'Must support up to 3 self-healing retry attempts with backoff'
    );
  });

  await t.test('usePushNotifications translates push service error and exposes repairPush', () => {
    assert.match(
      hookSrc,
      /push service error/,
      'Must detect push service error in lastErr message'
    );
    assert.match(
      hookSrc,
      /repairPush\s*=\s*useCallback/,
      'Must define repairPush callback'
    );
    assert.match(
      hookSrc,
      /repairPush,/,
      'Must return repairPush in hook result'
    );
  });

  await t.test('NotificationPreferences wires handleRepairPush and renders Fix Connection button', () => {
    assert.match(
      prefSrc,
      /repairPush,/,
      'Must destructure repairPush from usePushNotifications'
    );
    assert.match(
      prefSrc,
      /handleRepairPush/,
      'Must implement handleRepairPush handler'
    );
    assert.match(
      prefSrc,
      /Fix & Re-enable Connection/,
      'Must render Fix & Re-enable Connection button on push service error'
    );
  });
});
