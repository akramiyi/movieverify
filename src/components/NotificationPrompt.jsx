import React, { useState, useEffect } from 'react';
import { Bell, X } from 'lucide-react';
import { usePushNotifications } from '../hooks/usePushNotifications';

const STORAGE_DISMISSED_KEY = 'movieverify_push_prompt_dismissed';

export const NotificationPrompt = ({ onSubscribeSuccess = null, onVisibilityChange = null }) => {
  const { isSupported, permission, isSubscribed, isLoading, subscribe } = usePushNotifications();
  const [isDismissed, setIsDismissed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_DISMISSED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const isVisible = isSupported && !isSubscribed && permission !== 'denied' && !isDismissed;

  useEffect(() => {
    if (typeof onVisibilityChange === 'function') {
      onVisibilityChange(isVisible);
    }
    return () => {
      if (typeof onVisibilityChange === 'function') {
        onVisibilityChange(false);
      }
    };
  }, [isVisible, onVisibilityChange]);

  // Strict Policy: Never prompt if unsupported, already subscribed, denied, or dismissed
  if (!isVisible) {
    return null;
  }

  const handleDismiss = () => {
    setIsDismissed(true);
    if (typeof onVisibilityChange === 'function') {
      onVisibilityChange(false);
    }
    try {
      localStorage.setItem(STORAGE_DISMISSED_KEY, 'true');
    } catch {}
  };

  const handleEnable = async () => {
    const res = await subscribe();
    if (res?.success) {
      if (typeof onVisibilityChange === 'function') {
        onVisibilityChange(false);
      }
      if (typeof onSubscribeSuccess === 'function') {
        onSubscribeSuccess();
      }
    }
  };

  return (
    <aside 
      aria-label="Notification Updates"
      className="fixed bottom-4 sm:bottom-6 right-4 sm:right-6 left-4 sm:left-auto z-40 max-w-sm w-[calc(100vw-2rem)] sm:w-[380px] bg-[#1a1a1a]/95 backdrop-blur-md border border-white/10 rounded-2xl p-4 shadow-2xl transition-all duration-300 animate-in fade-in slide-in-from-bottom-4"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-red-600/20 border border-red-500/30 flex items-center justify-center flex-shrink-0 text-red-500">
          <Bell className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-bold text-white tracking-wide">Get Release Alerts</h4>
            <button
              onClick={handleDismiss}
              aria-label="Dismiss notification prompt"
              className="text-gray-400 hover:text-white transition p-1 -mr-1 -mt-1 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
            Get instant updates on OTT releases, trending movies, and new verify links.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={handleEnable}
              disabled={isLoading}
              className="px-3.5 py-1.5 bg-[#E50914] hover:bg-[#b81d24] active:bg-[#991b1b] text-white text-xs font-semibold rounded-lg transition shadow-md disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? 'Enabling...' : 'Enable Alerts'}
            </button>
            <button
              onClick={handleDismiss}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition font-medium cursor-pointer"
            >
              Not Now
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default NotificationPrompt;

