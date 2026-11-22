import React, { useState, useEffect, useCallback } from 'react';
import { Settings, Bell, BellOff, Loader2, Moon, Smartphone, AlertCircle, Send, CheckCircle2, ChevronDown, ChevronUp, Radio, RefreshCw } from 'lucide-react';
import { supabase } from '../data/supabaseClient';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { isInAppBrowser } from '../services/firebaseClient';
import { playNotificationSound } from '../utils/notificationSound';

const CANONICAL_TOGGLES = [
  {
    field: 'notify_new_movies',
    label: 'New Movie Releases',
    desc: 'Alerts when subscribed movies, actors, or genres become available.',
  },
  {
    field: 'notify_new_series',
    label: 'New TV Series & Seasons',
    desc: 'Notifies you when new series episodes or season links are published.',
  },
  {
    field: 'notify_movie_updates',
    label: 'Content Updates & Links',
    desc: 'Notifies you when higher-quality 1080p/4K download links are added.',
  },
  {
    field: 'notify_system',
    label: 'Account & System Announcements',
    desc: 'Critical account alerts, security notices, and platform updates.',
  },
  {
    field: 'notify_promotions',
    label: 'Recommendations & Discoveries',
    desc: 'Curated recommendations and trending collections.',
  },
];

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

function getTimeZoneOptions(configuredTz) {
  let detectedTz = null;
  try {
    detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {}
  return Array.from(
    new Set([configuredTz, detectedTz, ...COMMON_TIMEZONES].filter(Boolean))
  );
}

export default function NotificationPreferences({ onClose }) {
  const [preferences, setPreferences] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [updatingField, setUpdatingField] = useState(null);
  const [statusMessage, setStatusMessage] = useState(null);
  const [isTestingPush, setIsTestingPush] = useState(false);
  const [testPushResult, setTestPushResult] = useState(null);
  const [deviceDiagnostics, setDeviceDiagnostics] = useState(null);
  const [showAndroidGuide, setShowAndroidGuide] = useState(false);

  const {
    isSupported: isPushSupported,
    permission: pushPermission,
    isSubscribed: isDevicePushSubscribed,
    isLoading: isPushLoading,
    error: pushError,
    subscribe: subscribePush,
    unsubscribe: unsubscribePush,
    repairPush,
  } = usePushNotifications();

  const fetchPrefs = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setIsSignedIn(false);
        setPreferences(null);
        setDeviceDiagnostics(null);
        return;
      }

      setIsSignedIn(true);
      const res = await fetch('/api/notifications/preferences', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setPreferences(json.preferences || null);
      } else {
        setStatusMessage({ type: 'error', text: 'Failed to load preferences.' });
      }

      // Query active registered devices diagnostics
      try {
        const diagRes = await fetch('/api/notifications/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ action: 'diagnostics' }),
        });
        if (diagRes.ok) {
          const diagJson = await diagRes.json();
          setDeviceDiagnostics(diagJson);
        }
      } catch {}
    } catch (err) {
      console.warn('Failed to load notification preferences:', err.message);
      setStatusMessage({ type: 'error', text: 'Unable to reach notification preferences API.' });
    } finally {
      setLoading(false);
    }
  }, []);

  const handleTestPush = async () => {
    setIsTestingPush(true);
    setTestPushResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setTestPushResult({ type: 'error', text: 'Please sign in to test push delivery.' });
        return;
      }

      const res = await fetch('/api/notifications/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: 'test_push' }),
      });

      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        // Play custom notification sound directly on test alert
        playNotificationSound(true);
        setTestPushResult({
          type: 'success',
          text: '🔔 Test alert sent! Check your notification bar or drawer.',
        });
      } else {
        setTestPushResult({
          type: 'error',
          text: json.error || 'Failed to dispatch test notification.',
        });
      }
    } catch (err) {
      setTestPushResult({
        type: 'error',
        text: 'Network error while triggering test push: ' + err.message,
      });
    } finally {
      setIsTestingPush(false);
    }
  };

  useEffect(() => {
    fetchPrefs();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        fetchPrefs();
      }
    });
    return () => subscription?.unsubscribe();
  }, [fetchPrefs]);

  const updateCanonicalPreferences = async (patch, fieldKey = 'bulk') => {
    if (!preferences) return;
    setUpdatingField(fieldKey);
    setStatusMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setIsSignedIn(false);
        return;
      }

      const res = await fetch('/api/notifications/preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ preferences: patch }),
      });

      const json = await res.json().catch(() => ({}));
      if (res.ok && json.preferences) {
        setPreferences(json.preferences);
      } else {
        setStatusMessage({ type: 'error', text: json.error || 'Failed to save preference.' });
      }
    } catch (err) {
      console.warn('Failed to update preference:', err.message);
      setStatusMessage({ type: 'error', text: 'Network error while saving preferences.' });
    } finally {
      setUpdatingField(null);
    }
  };

  const handleToggleDevicePush = async () => {
    setStatusMessage(null);
    if (isDevicePushSubscribed) {
      const res = await unsubscribePush();
      if (res?.success) {
        setStatusMessage({ type: 'success', text: 'Push notifications disabled for this device.' });
      } else {
        setStatusMessage({ type: 'error', text: res?.error || 'Failed to disable push alerts.' });
      }
    } else {
      const res = await subscribePush();
      if (res?.success) {
        setStatusMessage({ type: 'success', text: 'Push notifications enabled for this device.' });
      } else {
        setStatusMessage({ type: 'error', text: res?.error || 'Could not enable push alerts.' });
      }
    }
  };

  const handleRepairPush = async () => {
    setStatusMessage(null);
    if (repairPush) {
      const res = await repairPush();
      if (res?.success) {
        setStatusMessage({ type: 'success', text: '🔔 Push connection fixed! Notifications enabled for this device.' });
      } else {
        setStatusMessage({ type: 'error', text: res?.error || 'Could not auto-repair push connection.' });
      }
    }
  };

  const renderSwitch = (checked, onClick, disabled, testId) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={`w-12 h-6 flex items-center rounded-full p-1 transition duration-300 focus:outline-none cursor-pointer disabled:opacity-50 ${
        checked ? 'bg-[#E50914]' : 'bg-gray-700'
      }`}
    >
      <div
        className={`bg-white w-4 h-4 rounded-full shadow-md transform transition duration-300 flex items-center justify-center ${
          checked ? 'translate-x-6' : 'translate-x-0'
        }`}
      >
        {disabled && <Loader2 className="w-2.5 h-2.5 animate-spin text-gray-700" />}
      </div>
    </button>
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-[#E50914]" />
          <h3 className="text-white font-bold text-base">Notification Preferences</h3>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-gray-400 hover:text-white transition cursor-pointer"
          >
            Back to Inbox
          </button>
        )}
      </div>

      {/* Device Push Subscription Control */}
      <div
        data-testid="device-push-control"
        className="p-3.5 rounded-xl bg-white/5 border border-white/10 space-y-2"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Smartphone className="w-4 h-4 text-[#E50914] mt-0.5 shrink-0" />
            <div>
              <p className="text-white text-sm font-semibold">This Device Push Alerts</p>
              <p className="text-gray-400 text-xs mt-0.5">
                {isInAppBrowser()
                  ? 'In-app browser detected (WhatsApp/Telegram). Tap the 3 dots and choose "Open in Chrome" to enable alerts.'
                  : !isPushSupported
                  ? 'Push notifications are not supported in this browser.'
                  : pushPermission === 'denied'
                  ? 'Blocked by browser settings. Allow notifications in site permissions.'
                  : isDevicePushSubscribed
                  ? 'Push alerts are active on this browser.'
                  : 'Enable browser push alerts to receive instant release notifications.'}
              </p>
            </div>
          </div>

          {isPushSupported && pushPermission !== 'denied' && (
            <button
              type="button"
              data-testid="device-push-toggle-btn"
              disabled={isPushLoading}
              onClick={handleToggleDevicePush}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer disabled:opacity-50 ${
                isDevicePushSubscribed
                  ? 'bg-white/10 hover:bg-white/20 text-white border border-white/15'
                  : 'bg-[#E50914] hover:bg-[#b80710] text-white'
              }`}
            >
              {isPushLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : isDevicePushSubscribed ? (
                <BellOff className="w-3.5 h-3.5" />
              ) : (
                <Bell className="w-3.5 h-3.5" />
              )}
              {isPushLoading
                ? 'Updating...'
                : isDevicePushSubscribed
                ? 'Disable Push'
                : 'Enable Push'}
            </button>
          )}
        </div>

        {/* Device Diagnostics & Actions */}
        {isDevicePushSubscribed && (
          <div className="pt-2.5 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] text-gray-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
              <span>Token Registered</span>
              {deviceDiagnostics && deviceDiagnostics.device_count > 0 && (
                <span className="bg-white/10 px-2 py-0.5 rounded text-[10px] text-gray-300">
                  {deviceDiagnostics.device_count} device(s) linked
                </span>
              )}
            </div>

            <button
              type="button"
              disabled={isTestingPush}
              onClick={handleTestPush}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 transition cursor-pointer disabled:opacity-50"
            >
              {isTestingPush ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Send className="w-3 h-3" />
              )}
              {isTestingPush ? 'Sending Test...' : '⚡ Test Alert to This Device'}
            </button>
          </div>
        )}

        {testPushResult && (
          <p
            className={`text-xs px-2.5 py-1.5 rounded-lg border mt-2 flex items-center gap-1.5 ${
              testPushResult.type === 'error'
                ? 'bg-rose-950/40 border-rose-500/30 text-rose-300'
                : 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
            }`}
          >
            {testPushResult.type === 'error' ? (
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            )}
            {testPushResult.text}
          </p>
        )}

        {/* Android Push Delay Troubleshooting Helper */}
        <div className="pt-2 border-t border-white/5">
          <button
            type="button"
            onClick={() => setShowAndroidGuide((prev) => !prev)}
            className="text-[11px] text-gray-400 hover:text-white flex items-center justify-between w-full transition cursor-pointer py-0.5"
          >
            <span>📱 Android Phone: SMS / Alert late ya Chrome kholne par aata hai?</span>
            <span>{showAndroidGuide ? '▲' : '▼'}</span>
          </button>
          {showAndroidGuide && (
            <div className="mt-2 p-2.5 rounded-lg bg-black/40 border border-white/10 text-[11px] text-gray-300 space-y-1.5">
              <p className="font-semibold text-amber-400">Android Doze Mode / Background Freeze Fix:</p>
              <ol className="list-decimal list-inside space-y-1 text-gray-300 text-[11px]">
                <li><strong>Chrome Notification:</strong> Chrome icon par long-press karein &gt; App Info &gt; Notifications &gt; Sites &gt; MovieVerify par click karke <em>"Pop on screen / Allow Sound"</em> on karein.</li>
                <li><strong>Status Bar Icon (MIUI / HyperOS):</strong> Chrome App Info &gt; Notifications &gt; Sites &gt; MovieVerify &gt; <em>"Show in status bar / Badge"</em> ON karein taaki top status bar me icon dikhe.</li>
                <li><strong>Battery Saver:</strong> App Info &gt; Battery / Battery Saver &gt; <em>"No restrictions" (Unrestricted)</em> select karein taaki Android Chrome ko freeze na kare.</li>
                <li><strong>Push Service Sync Error:</strong> Agar "Registration failed - push service error" ya temporary issue dikhe, toh niche <em>"Fix & Re-enable Connection"</em> button par click karein. Yeh connection ko instantly heal kar deta hai.</li>
                <li><strong>Install App (PWA):</strong> Niche <em>"Install App"</em> button se PWA install karein. Isse MovieVerify standalone Android app ban jati hai aur Flipkart/X ki tarah direct native status bar icon aata hai.</li>
              </ol>
            </div>
          )}
        </div>

        {pushError && (
          <div className="space-y-2.5 pt-2 border-t border-white/5">
            <p className="text-xs text-rose-400 flex items-center gap-1.5 font-medium">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{pushError}</span>
            </p>
            {(pushError.toLowerCase().includes('push service') || pushError.toLowerCase().includes('google play') || pushError.toLowerCase().includes('fix connection')) && (
              <div className="p-2.5 rounded-lg bg-rose-950/30 border border-rose-500/20 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-gray-300 font-semibold">1-Tap Auto Repair:</span>
                  <button
                    type="button"
                    onClick={handleRepairPush}
                    disabled={isPushLoading}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500 hover:bg-rose-600 text-white transition cursor-pointer disabled:opacity-50 shadow"
                  >
                    {isPushLoading ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )}
                    <span>{isPushLoading ? 'Repairing Connection...' : '🔄 Fix & Re-enable Connection'}</span>
                  </button>
                </div>
                <div className="text-[11px] text-gray-400 pt-1.5 border-t border-white/5 space-y-1">
                  <p className="text-amber-300/90 font-medium">Agar "Fix" tap karne ke baad bhi stale endpoint rahe (Chrome Site Reset 5 sec):</p>
                  <p>1. Upar address bar me <strong>movieverify.vercel.app ke bagal me tune/lock icon</strong> par tap karein.</p>
                  <p>2. <strong>Permissions / Site data</strong> par tap karke <em>"Delete data" / "Reset permissions"</em> karein.</p>
                  <p>3. Page reload karke 'Enable Push' dabayein — turant fresh token ban jayega!</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {statusMessage && (!pushError || statusMessage.text !== pushError) && (
        <div
          className={`text-xs px-3 py-2 rounded-lg border space-y-2 ${
            statusMessage.type === 'error'
              ? 'bg-rose-950/40 border-rose-500/30 text-rose-300'
              : 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
          }`}
        >
          <p>{statusMessage.text}</p>
        </div>
      )}

      {loading ? (
        <div className="py-8 flex justify-center text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin text-[#E50914]" />
        </div>
      ) : !isSignedIn || !preferences ? (
        <p className="text-gray-400 text-xs text-center py-4">
          Please sign in to manage your account notification preferences.
        </p>
      ) : (
        <div className="space-y-4">
          {/* Master Opt-In & Delivery Channels */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
              Global & Delivery Channels
            </h4>

            <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
              <div className="pr-4">
                <p className="text-white text-sm font-semibold">All Notifications</p>
                <p className="text-gray-400 text-xs mt-0.5">
                  Master switch across all MovieVerify alerts.
                </p>
              </div>
              {renderSwitch(
                Boolean(preferences.opt_in_all),
                () => updateCanonicalPreferences({ opt_in_all: !preferences.opt_in_all }, 'opt_in_all'),
                updatingField === 'opt_in_all',
                'pref-toggle-opt_in_all'
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
                <span className="text-white text-xs font-semibold">Push Channel</span>
                {renderSwitch(
                  Boolean(preferences.channel_push),
                  () => updateCanonicalPreferences({ channel_push: !preferences.channel_push }, 'channel_push'),
                  updatingField === 'channel_push',
                  'pref-toggle-channel_push'
                )}
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
                <span className="text-white text-xs font-semibold">In-App Inbox</span>
                {renderSwitch(
                  Boolean(preferences.channel_in_app),
                  () => updateCanonicalPreferences({ channel_in_app: !preferences.channel_in_app }, 'channel_in_app'),
                  updatingField === 'channel_in_app',
                  'pref-toggle-channel_in_app'
                )}
              </div>
            </div>

            <div
              data-testid="channel-email-status"
              className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition"
            >
              <div className="pr-3">
                <p className="text-white text-xs font-semibold flex items-center gap-1.5">
                  <span>Email Channel</span>
                  <span className="text-[10px] bg-green-500/20 text-green-400 border border-green-500/30 px-1.5 py-0.2 rounded font-mono uppercase">
                    Active
                  </span>
                </p>
                <p className="text-gray-400 text-[11px] mt-0.5">
                  Receive daily release updates and trending alerts directly in your Gmail inbox.
                </p>
              </div>
              {renderSwitch(
                Boolean(preferences.channel_email),
                () => updateCanonicalPreferences({ channel_email: !preferences.channel_email }, 'channel_email'),
                updatingField === 'channel_email',
                'pref-toggle-channel_email'
              )}
            </div>
          </div>

          {/* Canonical Categories */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
              Alert Categories
            </h4>
            {CANONICAL_TOGGLES.map((item) => {
              const enabled = Boolean(preferences[item.field]);
              const isUpdating = updatingField === item.field;

              return (
                <div
                  key={item.field}
                  className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition"
                >
                  <div className="pr-4">
                    <p className="text-white text-sm font-semibold">{item.label}</p>
                    <p className="text-gray-400 text-xs mt-0.5">{item.desc}</p>
                  </div>
                  {renderSwitch(
                    enabled,
                    () => updateCanonicalPreferences({ [item.field]: !enabled }, item.field),
                    isUpdating,
                    `pref-toggle-${item.field}`
                  )}
                </div>
              );
            })}
          </div>

          {/* Quiet Hours & Daily Cap */}
          <div className="p-3 rounded-xl bg-white/5 border border-white/10 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Moon className="w-4 h-4 text-[#E50914]" />
                <div>
                  <p className="text-white text-sm font-semibold">Quiet Hours</p>
                  <p className="text-gray-400 text-xs">
                    Mute push deliveries during your rest hours ({preferences.quiet_hours_tz || 'UTC'}).
                  </p>
                </div>
              </div>
              {renderSwitch(
                Boolean(preferences.quiet_hours_enabled),
                () => {
                  const nextEnabled = !preferences.quiet_hours_enabled;
                  let browserTz = null;
                  try {
                    browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
                  } catch {}
                  const targetTz = preferences.quiet_hours_tz || browserTz || 'UTC';
                  updateCanonicalPreferences(
                    {
                      quiet_hours_enabled: nextEnabled,
                      quiet_hours_start: preferences.quiet_hours_start || '22:00',
                      quiet_hours_end: preferences.quiet_hours_end || '07:00',
                      quiet_hours_tz: targetTz,
                    },
                    'quiet_hours_enabled'
                  );
                },
                updatingField === 'quiet_hours_enabled',
                'pref-toggle-quiet_hours_enabled'
              )}
            </div>

            {preferences.quiet_hours_enabled && (
              <div className="space-y-2 pt-1">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-gray-300 space-y-1">
                    <span>Start</span>
                    <input
                      type="time"
                      value={(preferences.quiet_hours_start || '22:00').slice(0, 5)}
                      onChange={(e) =>
                        updateCanonicalPreferences(
                          {
                            quiet_hours_enabled: true,
                            quiet_hours_start: e.target.value,
                            quiet_hours_end: (preferences.quiet_hours_end || '07:00').slice(0, 5),
                            quiet_hours_tz: preferences.quiet_hours_tz || 'UTC',
                          },
                          'quiet_hours_start'
                        )
                      }
                      className="w-full bg-[#141414] border border-white/15 rounded-lg px-2.5 py-1.5 text-white text-xs"
                    />
                  </label>
                  <label className="text-xs text-gray-300 space-y-1">
                    <span>End</span>
                    <input
                      type="time"
                      value={(preferences.quiet_hours_end || '07:00').slice(0, 5)}
                      onChange={(e) =>
                        updateCanonicalPreferences(
                          {
                            quiet_hours_enabled: true,
                            quiet_hours_start: (preferences.quiet_hours_start || '22:00').slice(0, 5),
                            quiet_hours_end: e.target.value,
                            quiet_hours_tz: preferences.quiet_hours_tz || 'UTC',
                          },
                          'quiet_hours_end'
                        )
                      }
                      className="w-full bg-[#141414] border border-white/15 rounded-lg px-2.5 py-1.5 text-white text-xs"
                    />
                  </label>
                </div>
                <label className="flex items-center justify-between text-xs text-gray-300 pt-1">
                  <span>Timezone</span>
                  <select
                    data-testid="quiet-hours-tz-select"
                    value={preferences.quiet_hours_tz || 'UTC'}
                    disabled={updatingField === 'quiet_hours_tz'}
                    onChange={(e) =>
                      updateCanonicalPreferences(
                        {
                          quiet_hours_enabled: true,
                          quiet_hours_start: (preferences.quiet_hours_start || '22:00').slice(0, 5),
                          quiet_hours_end: (preferences.quiet_hours_end || '07:00').slice(0, 5),
                          quiet_hours_tz: e.target.value,
                        },
                        'quiet_hours_tz'
                      )
                    }
                    className="bg-[#141414] border border-white/15 rounded-lg px-2.5 py-1 text-white text-xs max-w-[190px]"
                  >
                    {getTimeZoneOptions(preferences.quiet_hours_tz).map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <span className="text-xs text-gray-300 font-medium">Max daily push alerts</span>
              <select
                value={preferences.max_daily_push || 50}
                disabled={updatingField === 'max_daily_push'}
                onChange={(e) =>
                  updateCanonicalPreferences({ max_daily_push: Number(e.target.value) }, 'max_daily_push')
                }
                className="bg-[#141414] border border-white/15 rounded-lg px-2.5 py-1 text-white text-xs cursor-pointer"
              >
                {[1, 3, 5, 10, 20, 50].map((val) => (
                  <option key={val} value={val}>
                    {val} / day
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

