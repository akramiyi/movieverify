import React, { useState, useEffect, useCallback } from 'react';
import { Settings, Bell, BellOff, Loader2, Moon, Smartphone, AlertCircle } from 'lucide-react';
import { supabase } from '../data/supabaseClient';
import { usePushNotifications } from '../hooks/usePushNotifications';

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

  const {
    isSupported: isPushSupported,
    permission: pushPermission,
    isSubscribed: isDevicePushSubscribed,
    isLoading: isPushLoading,
    error: pushError,
    subscribe: subscribePush,
    unsubscribe: unsubscribePush,
  } = usePushNotifications();

  const fetchPrefs = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setIsSignedIn(false);
        setPreferences(null);
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
    } catch (err) {
      console.warn('Failed to load notification preferences:', err.message);
      setStatusMessage({ type: 'error', text: 'Unable to reach notification preferences API.' });
    } finally {
      setLoading(false);
    }
  }, []);

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
                {!isPushSupported
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
        {pushError && (
          <p className="text-xs text-rose-400 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {pushError}
          </p>
        )}
      </div>

      {statusMessage && (
        <p
          className={`text-xs px-3 py-2 rounded-lg border ${
            statusMessage.type === 'error'
              ? 'bg-rose-950/40 border-rose-500/30 text-rose-300'
              : 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
          }`}
        >
          {statusMessage.text}
        </p>
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
              className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/10"
            >
              <div className="pr-3">
                <p className="text-gray-200 text-xs font-semibold">Email Channel</p>
                <p className="text-gray-400 text-[11px] mt-0.5">
                  Email delivery is not configured in this deployment; alerts arrive via in-app inbox and push.
                </p>
              </div>
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-white/10 text-gray-300 border border-white/10">
                Unavailable
              </span>
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
                value={preferences.max_daily_push || 5}
                disabled={updatingField === 'max_daily_push'}
                onChange={(e) =>
                  updateCanonicalPreferences({ max_daily_push: Number(e.target.value) }, 'max_daily_push')
                }
                className="bg-[#141414] border border-white/15 rounded-lg px-2.5 py-1 text-white text-xs"
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

