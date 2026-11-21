/**
 * React Hook for Firebase Cloud Messaging & Push Notification Management
 * 
 * Provides permission checking, token lifecycle handling, and auth sync.
 * Adheres strictly to non-intrusive permission policies (never auto-prompts).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../data/supabaseClient';
import {
  isPushNotificationSupported,
  requestNotificationPermission,
  getDeviceFcmToken,
  registerTokenWithBackend,
  revokeTokenWithBackend,
  getMessagingInstance,
  setupForegroundMessageHandler,
  getLastFcmError,
  isInAppBrowser,
  repairPushRegistration,
} from '../services/firebaseClient';

const STORAGE_REGISTERED_KEY = 'movieverify_push_registered';
const STORAGE_LAST_TOKEN_KEY = 'movieverify_push_last_token';

/**
 * Revoke any registered FCM push token on the backend BEFORE Supabase signOut clears the session JWT.
 * Bounded so network errors never block user sign-out.
 */
export async function revokePushTokenBeforeSignOut() {
  let token = null;
  try {
    token = localStorage.getItem(STORAGE_LAST_TOKEN_KEY);
  } catch {}

  if (!token) {
    try {
      localStorage.removeItem(STORAGE_REGISTERED_KEY);
    } catch {}
    return { success: true, skipped: true };
  }

  let revoked = false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      const res = await revokeTokenWithBackend({
        token,
        accessToken: session.access_token,
      });
      revoked = !!res?.success;
    }
  } catch (err) {
    console.warn('[usePushNotifications] Pre-signout revocation failed:', err?.message);
  }

  try {
    localStorage.removeItem(STORAGE_REGISTERED_KEY);
    localStorage.removeItem(STORAGE_LAST_TOKEN_KEY);
  } catch {}

  return { success: true, revoked };
}

let globalLastSyncedKey = null;
let activeSyncPromise = null;

export function usePushNotifications(options = {}) {
  const { onForegroundMessage = null, vapidKey = null } = options;

  const [permission, setPermission] = useState('default');
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const tokenRef = useRef(null);
  const foregroundCallbackRef = useRef(onForegroundMessage);
  const lastSyncedKeyRef = useRef('');

  useEffect(() => {
    foregroundCallbackRef.current = onForegroundMessage;
  }, [onForegroundMessage]);

  // 1. Initial Browser Capabilities & Permission Check
  useEffect(() => {
    let isMounted = true;

    const checkCapabilities = async () => {
      if (typeof window === 'undefined') {
        if (isMounted) setIsLoading(false);
        return;
      }

      const supported = await isPushNotificationSupported();
      if (!isMounted) return;
      setIsSupported(supported);

      if (!supported) {
        setPermission('unsupported');
        setIsSubscribed(false);
        setIsLoading(false);
        return;
      }

      const currentPerm = Notification.permission;
      setPermission(currentPerm);

      const hasRegistered = localStorage.getItem(STORAGE_REGISTERED_KEY) === 'true';
      const lastToken = localStorage.getItem(STORAGE_LAST_TOKEN_KEY);
      if (lastToken) {
        tokenRef.current = lastToken;
      }

      setIsSubscribed(currentPerm === 'granted' && hasRegistered);
      setIsLoading(false);
    };

    checkCapabilities();

    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Foreground Message Listener Setup
  useEffect(() => {
    if (!isSupported || permission !== 'granted') return;

    let unsubscribe = () => {};
    let isCancelled = false;

    const setupListener = async () => {
      const messaging = await getMessagingInstance();
      if (messaging && !isCancelled) {
        unsubscribe = setupForegroundMessageHandler(messaging, (payload) => {
          if (typeof foregroundCallbackRef.current === 'function') {
            foregroundCallbackRef.current(payload);
          }
        });
      }
    };

    setupListener();

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  }, [isSupported, permission]);

  // 3. Explicit Subscribe Action (Triggered on User Click)
  const subscribe = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      if (isInAppBrowser()) {
        setIsLoading(false);
        const inAppMsg = 'Push notifications cannot be enabled inside in-app browsers (WhatsApp/Telegram/Instagram). Please open this link in Google Chrome or your default device browser.';
        setError(inAppMsg);
        return { success: false, error: inAppMsg };
      }

      const permResult = await requestNotificationPermission();
      setPermission(permResult);

      if (permResult !== 'granted') {
        setIsLoading(false);
        const permError = permResult === 'denied'
          ? 'Notification permission was denied. Please allow notifications in site permissions.'
          : 'Notification permission was dismissed.';
        setError(permError);
        return { success: false, permission: permResult, error: permError };
      }

      // Generate FCM Token with auto-retry & active SW resolution
      const token = await getDeviceFcmToken({ vapidKey });
      if (!token) {
        const lastErr = getLastFcmError();
        let userMsg = 'Failed to generate device token.';
        if (lastErr?.code === 'in-app-browser') {
          userMsg = 'Push notifications cannot be enabled inside in-app browsers (WhatsApp/Telegram/Instagram). Please open this link in Google Chrome or your default device browser.';
        } else if (lastErr?.message) {
          if (lastErr.message.toLowerCase().includes('push service error')) {
            userMsg = 'Push service temporarily unavailable (Google Play Services / Android background sync). "Fix Connection" par tap karein ya page refresh karein.';
          } else if (lastErr.message.includes('default service worker') || lastErr.message.includes('not registered') || lastErr.message.includes('no active Service Worker')) {
            userMsg = 'Service worker is still activating on your device. Please wait a second and tap Enable again.';
          } else if (lastErr.message.includes('indexedDb') || lastErr.message.includes('IndexedDB')) {
            userMsg = 'Push notifications are not supported in Private/Incognito browsing mode.';
          } else {
            userMsg = lastErr.message;
          }
        }

        setIsLoading(false);
        setError(userMsg);
        return { success: false, error: userMsg };
      }

      tokenRef.current = token;
      try {
        localStorage.setItem(STORAGE_LAST_TOKEN_KEY, token);
      } catch {}

      // Get Active Supabase Session for Authenticated Registration
      const { data: { session } } = await supabase.auth.getSession();

      if (session?.access_token) {
        const regRes = await registerTokenWithBackend({
          token,
          accessToken: session.access_token,
          reauthorize: true,
        });

        if (!regRes.success) {
          setError(regRes.error || 'Failed to register token with server.');
          setIsLoading(false);
          return { success: false, error: regRes.error };
        }
      }

      try {
        localStorage.setItem(STORAGE_REGISTERED_KEY, 'true');
      } catch {}

      setIsSubscribed(true);
      setIsLoading(false);
      return { success: true, token };
    } catch (err) {
      setError(err.message || 'Unexpected subscription error');
      setIsLoading(false);
      return { success: false, error: err.message };
    }
  }, [vapidKey]);

  // 4. Explicit Unsubscribe Action
  const unsubscribe = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const token = tokenRef.current || localStorage.getItem(STORAGE_LAST_TOKEN_KEY);

    try {
      if (token) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          await revokeTokenWithBackend({
            token,
            accessToken: session.access_token,
          });
        }
      }

      try {
        localStorage.removeItem(STORAGE_REGISTERED_KEY);
        localStorage.removeItem(STORAGE_LAST_TOKEN_KEY);
      } catch {}

      tokenRef.current = null;
      setIsSubscribed(false);
      setIsLoading(false);
      return { success: true };
    } catch (err) {
      setError(err.message || 'Failed to unsubscribe');
      setIsLoading(false);
      return { success: false, error: err.message };
    }
  }, []);

  // 5. Explicit Repair & Resubscribe Action (Clears stale subscriptions to fix push service errors)
  const repairPush = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await repairPushRegistration();
      const res = await subscribe();
      return res;
    } catch (err) {
      const msg = err?.message || 'Failed to repair push connection';
      setError(msg);
      setIsLoading(false);
      return { success: false, error: msg };
    }
  }, [subscribe]);

  // 6. Synchronize Token Registration on Auth State Change and Page Load
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        // Token revocation is handled before sign-out via revokePushTokenBeforeSignOut
        tokenRef.current = null;
        setIsSubscribed(false);
        try {
          localStorage.removeItem(STORAGE_REGISTERED_KEY);
          localStorage.removeItem(STORAGE_LAST_TOKEN_KEY);
        } catch {}
        return;
      }

      const isEligibleEvent = event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED';
      if (!isEligibleEvent || !session?.access_token) return;

      const currentPerm = typeof Notification !== 'undefined' ? Notification.permission : 'default';
      if (currentPerm !== 'granted') return;

      const storedToken = tokenRef.current || localStorage.getItem(STORAGE_LAST_TOKEN_KEY);

      if (storedToken) {
        const syncKey = `${session.user?.id || ''}:${storedToken}`;
        if (syncKey === globalLastSyncedKey || syncKey === lastSyncedKeyRef.current) return;
        globalLastSyncedKey = syncKey;
        lastSyncedKeyRef.current = syncKey;

        if (activeSyncPromise) {
          await activeSyncPromise;
          return;
        }

        // Passive auth-sync registration MUST NEVER silently reauthorize a revoked endpoint (reauthorize: false)
        activeSyncPromise = (async () => {
          try {
            const syncRes = await registerTokenWithBackend({
              token: storedToken,
              accessToken: session.access_token,
              reauthorize: false,
            });
            if (syncRes?.success) {
              localStorage.setItem(STORAGE_REGISTERED_KEY, 'true');
              setIsSubscribed(true);
              return;
            }

            // If the token was revoked on server (e.g. UNREGISTERED / permissions reset), automatically re-register a fresh FCM token
            if (syncRes?.status === 409) {
              console.log('[usePushNotifications] Stored device token was revoked or expired; reauthorizing endpoint...');
              const directReauth = await registerTokenWithBackend({
                token: storedToken,
                accessToken: session.access_token,
                reauthorize: true,
              });
              if (directReauth?.success) {
                localStorage.setItem(STORAGE_REGISTERED_KEY, 'true');
                setIsSubscribed(true);
                return;
              }

              const freshToken = await getDeviceFcmToken({ vapidKey });
              if (freshToken) {
                tokenRef.current = freshToken;
                localStorage.setItem(STORAGE_LAST_TOKEN_KEY, freshToken);
                const reauthRes = await registerTokenWithBackend({
                  token: freshToken,
                  accessToken: session.access_token,
                  reauthorize: true,
                });
                if (reauthRes?.success) {
                  localStorage.setItem(STORAGE_REGISTERED_KEY, 'true');
                  setIsSubscribed(true);
                  return;
                }
              }
              localStorage.removeItem(STORAGE_REGISTERED_KEY);
              setIsSubscribed(false);
            }
          } catch (err) {
            console.warn('[usePushNotifications] Auth sync register failed:', err?.message);
          } finally {
            activeSyncPromise = null;
          }
        })();
        await activeSyncPromise;
      } else {
        // Permission is granted but no token stored yet: automatically register fresh token
        try {
          const freshToken = await getDeviceFcmToken({ vapidKey });
          if (freshToken) {
            tokenRef.current = freshToken;
            localStorage.setItem(STORAGE_LAST_TOKEN_KEY, freshToken);
            const regRes = await registerTokenWithBackend({
              token: freshToken,
              accessToken: session.access_token,
              reauthorize: true,
            });
            if (regRes?.success) {
              localStorage.setItem(STORAGE_REGISTERED_KEY, 'true');
              setIsSubscribed(true);
            }
          }
        } catch (err) {
          console.warn('[usePushNotifications] Auto-registration failed:', err?.message);
        }
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [vapidKey]);

  return {
    permission,
    isSupported,
    isSubscribed,
    isLoading,
    error,
    subscribe,
    unsubscribe,
    repairPush,
  };
}

