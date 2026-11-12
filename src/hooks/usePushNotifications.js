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
      const permResult = await requestNotificationPermission();
      setPermission(permResult);

      if (permResult !== 'granted') {
        setIsLoading(false);
        return { success: false, permission: permResult, error: 'Permission denied or dismissed' };
      }

      // Generate FCM Token
      const token = await getDeviceFcmToken({ vapidKey });
      if (!token) {
        setIsLoading(false);
        setError('Failed to generate device token.');
        return { success: false, error: 'Token generation failed' };
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

  // 5. Synchronize Token Registration on Auth State Change and Page Load
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
        if (syncKey === lastSyncedKeyRef.current) return;
        lastSyncedKeyRef.current = syncKey;

        // Passive auth-sync registration MUST NEVER silently reauthorize a revoked endpoint (reauthorize: false)
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
            console.log('[usePushNotifications] Stored device token was revoked or expired; requesting fresh token from Google FCM...');
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
        }
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
  };
}

