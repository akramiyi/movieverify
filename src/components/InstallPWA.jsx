import { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';

const InstallPWA = ({ hasNotificationPrompt = false }) => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showButton, setShowButton] = useState(false);
  const [isDismissed, setIsDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('movieverify_pwa_dismissed') === 'true';
    } catch {
      return false;
    }
  });

  // Check if push notification prompt is currently active for a new visitor
  const [internalHasPrompt, setInternalHasPrompt] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const isPushDismissed = localStorage.getItem('movieverify_push_prompt_dismissed') === 'true';
      const isPushSubscribed = localStorage.getItem('movieverify_push_subscribed') === 'true';
      const hasNotification = 'Notification' in window;
      const permission = hasNotification ? Notification.permission : 'denied';
      return hasNotification && permission === 'default' && !isPushDismissed && !isPushSubscribed;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowButton(true);
    });
    window.addEventListener('appinstalled', () => {
      setShowButton(false);
    });
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setShowButton(false);
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    try {
      sessionStorage.setItem('movieverify_pwa_dismissed', 'true');
    } catch {}
  };

  if (!showButton || isDismissed) return null;

  const isPromptActive = hasNotificationPrompt || internalHasPrompt;

  return (
    <div
      className={`fixed ${
        isPromptActive
          ? 'bottom-[180px] sm:bottom-6'
          : 'bottom-4 sm:bottom-6'
      } left-4 sm:left-6 z-50 flex items-center gap-1.5 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2`}
    >
      <button
        onClick={handleInstall}
        className="bg-[#E50914] hover:bg-[#b81d24] active:bg-[#991b1b] 
                   text-white rounded-full px-4 py-2.5 sm:px-5 sm:py-3 
                   flex items-center gap-2 shadow-2xl 
                   hover:shadow-red-600/30 transition-all font-bold text-xs sm:text-sm cursor-pointer border border-white/10"
      >
        <Download className="w-4 h-4" />
        <span>Install App</span>
      </button>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss install button"
        className="w-7 h-7 rounded-full bg-[#1a1a1a]/90 hover:bg-[#2a2a2a] text-gray-400 hover:text-white border border-white/10 flex items-center justify-center transition cursor-pointer shadow-lg"
        title="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export default InstallPWA;
