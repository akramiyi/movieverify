import React, { useState, useEffect } from 'react';
import { 
  X, 
  Bell, 
  Film, 
  Sparkles, 
  ChevronRight, 
  ChevronLeft, 
  Check, 
  ExternalLink,
  Flame,
  Calendar
} from 'lucide-react';
import { usePushNotifications } from '../hooks/usePushNotifications';

const STORAGE_GUIDE_SEEN_KEY = 'movieverify_new_user_guide_completed';
const STORAGE_PUSH_DISMISSED_KEY = 'movieverify_push_prompt_dismissed';

export const NewUserGuide = ({ 
  isOpen = false, 
  onClose, 
  onNotificationSubscribeSuccess 
}) => {
  const [step, setStep] = useState(1);
  const { isSupported, permission, isSubscribed, isLoading, subscribe } = usePushNotifications();
  const [subscribeStatus, setSubscribeStatus] = useState(null); // 'success' | 'error' | null

  // Keyboard navigation & escape listener
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleDismiss();
      } else if (e.key === 'ArrowRight' && step < 3) {
        setStep(prev => Math.min(3, prev + 1));
      } else if (e.key === 'ArrowLeft' && step > 1) {
        setStep(prev => Math.max(1, prev - 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, step]);

  if (!isOpen) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(STORAGE_GUIDE_SEEN_KEY, 'true');
    } catch {}
    if (typeof onClose === 'function') {
      onClose();
    }
  };

  const handleEnableAlerts = async () => {
    try {
      const res = await subscribe();
      if (res?.success) {
        setSubscribeStatus('success');
        try {
          localStorage.setItem(STORAGE_PUSH_DISMISSED_KEY, 'true');
        } catch {}
        if (typeof onNotificationSubscribeSuccess === 'function') {
          onNotificationSubscribeSuccess();
        }
      } else {
        setSubscribeStatus('error');
      }
    } catch {
      setSubscribeStatus('error');
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[150] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 select-none animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDismiss();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-title"
    >
      {/* Modal Card */}
      <div className="relative w-full max-w-md bg-[#111116] border border-white/10 rounded-3xl p-6 sm:p-7 shadow-[0_0_50px_rgba(0,0,0,0.9)] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Ambient Top Glows */}
        <div className="absolute -top-16 -left-16 w-36 h-36 bg-red-600/25 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -top-16 -right-16 w-36 h-36 bg-[#229ED9]/25 rounded-full blur-3xl pointer-events-none" />

        {/* Top Header: Badge, Step Indicator & Close */}
        <div className="flex items-center justify-between pb-3.5 border-b border-white/5 relative z-10">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-[#E50914] text-[11px] font-bold uppercase tracking-wider">
              <Sparkles className="w-3 h-3" /> Quick Guide
            </span>
            <span className="text-xs font-semibold text-gray-400">
              Step {step} of 3
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDismiss}
              className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded-lg hover:bg-white/5 transition cursor-pointer"
            >
              Skip
            </button>
            <button
              onClick={handleDismiss}
              aria-label="Close guide"
              className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 3-Step Interactive Progress Tabs */}
        <div className="grid grid-cols-3 gap-1.5 my-4 relative z-10">
          {[
            { id: 1, label: '1. Features' },
            { id: 2, label: '2. Alerts' },
            { id: 3, label: '3. Telegram' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStep(tab.id)}
              className={`py-1.5 px-2 rounded-xl text-[11px] font-bold text-center transition-all cursor-pointer ${
                step === tab.id
                  ? 'bg-gradient-to-r from-[#E50914] to-red-600 text-white shadow-[0_0_12px_rgba(229,9,20,0.5)]'
                  : 'bg-white/5 text-gray-400 hover:text-gray-200 hover:bg-white/10'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Step Content */}
        <div className="min-h-[260px] flex flex-col justify-between relative z-10">
          
          {/* STEP 1: Features & Today Releases */}
          {step === 1 && (
            <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-right-4 duration-200">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-600/30 to-amber-600/20 border border-red-500/30 flex items-center justify-center text-[#E50914] shrink-0">
                  <Film className="w-6 h-6" />
                </div>
                <div>
                  <h3 id="guide-title" className="text-base sm:text-lg font-black text-white leading-tight">
                    Welcome to MovieVerify 🎬
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Your hub for fast, verified OTT movies & series.
                  </p>
                </div>
              </div>

              {/* Feature Highlights */}
              <div className="space-y-2 mt-1 bg-white/[0.03] border border-white/5 rounded-2xl p-3.5">
                <div className="flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-md bg-red-500/20 text-[#E50914] flex items-center justify-center shrink-0 mt-0.5">
                    <Calendar className="w-3 h-3" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white">Today Releases Tracker</p>
                    <p className="text-[11px] text-gray-400">
                      Check out the <span className="text-red-400 font-semibold">Today Releases</span> tab in the navbar to catch movies streaming today.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-md bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Check className="w-3 h-3" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white">1080p & 720p Verified Links</p>
                    <p className="text-[11px] text-gray-400">
                      Fast, direct download links tested and verified daily with zero broken links.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-md bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Flame className="w-3 h-3" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white">Official Trailers & Cast Details</p>
                    <p className="text-[11px] text-gray-400">
                      Watch YouTube trailers directly before downloading and browse films by your favorite actors.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Release Alerts & Notifications */}
          {step === 2 && (
            <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-right-4 duration-200">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-600/30 to-purple-600/20 border border-red-500/30 flex items-center justify-center text-[#E50914] shrink-0">
                  <Bell className="w-6 h-6 animate-bounce" />
                </div>
                <div>
                  <h3 id="guide-title" className="text-base sm:text-lg font-black text-white leading-tight">
                    Never Miss a Release 🔔
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Instant alerts for OTT drops & trending titles.
                  </p>
                </div>
              </div>

              <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-3.5 space-y-2 mt-1">
                <p className="text-xs text-gray-300 leading-relaxed">
                  Turn on <span className="text-white font-bold">Release Alerts</span> to receive instant browser notifications when new Bollywood, South, or Hollywood films arrive.
                </p>
                <div className="flex items-center gap-2 text-[11px] text-gray-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  <span>100% free • Zero spam • Easily managed in Notification Center</span>
                </div>
              </div>

              {/* In-Guide Subscribe Action */}
              <div className="mt-1">
                {isSubscribed || subscribeStatus === 'success' ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>Release alerts are active on this device!</span>
                  </div>
                ) : permission === 'denied' ? (
                  <div className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs leading-relaxed">
                    Browser notifications are currently blocked. You can still check alerts anytime using the <span className="font-bold text-white">Bell (🔔)</span> icon in the navbar.
                  </div>
                ) : (
                  <button
                    onClick={handleEnableAlerts}
                    disabled={isLoading}
                    className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#E50914] to-red-700 hover:from-red-600 hover:to-[#E50914] text-white text-xs font-bold shadow-[0_0_15px_rgba(229,9,20,0.4)] flex items-center justify-center gap-2 transition disabled:opacity-50 cursor-pointer"
                  >
                    <Bell className="w-4 h-4 text-white" />
                    <span>{isLoading ? 'Enabling Alerts...' : 'Allow Release Alerts'}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: Telegram Movie Bot */}
          {step === 3 && (
            <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-right-4 duration-200">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-[#229ED9]/20 border border-[#229ED9]/30 flex items-center justify-center text-[#229ED9] shrink-0">
                  {/* Telegram paper plane with subtle pulse */}
                  <svg className="w-6 h-6 animate-telegram-scale-pulse fill-current text-[#229ED9]" viewBox="0 0 24 24">
                    <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/>
                  </svg>
                </div>
                <div>
                  <h3 id="guide-title" className="text-base sm:text-lg font-black text-white leading-tight">
                    Movie Find ⚡ on Telegram
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Official Bot: <span className="text-[#229ED9] font-bold">@movieverify_bot</span>
                  </p>
                </div>
              </div>

              <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-3.5 space-y-2 mt-1">
                <p className="text-xs text-gray-300 leading-relaxed">
                  Search movies, get fast download links, and receive upcoming release updates directly inside your Telegram app!
                </p>
                <div className="flex items-center gap-2 text-[11px] text-gray-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#229ED9]"></span>
                  <span>Direct links • Always online • Also accessible via the navbar icon</span>
                </div>
              </div>

              {/* Telegram Button */}
              <a
                href="https://t.me/movieverify_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#229ED9] to-[#1d82b4] hover:from-[#2bb0f0] hover:to-[#229ED9] text-white text-xs font-bold shadow-[0_0_15px_rgba(34,158,217,0.4)] flex items-center justify-center gap-2 transition group mt-1"
              >
                <svg className="w-4 h-4 fill-current text-white" viewBox="0 0 24 24">
                  <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/>
                </svg>
                <span>Open Telegram Bot (@movieverify_bot)</span>
                <ExternalLink className="w-3.5 h-3.5 opacity-80 group-hover:translate-x-0.5 transition" />
              </a>
            </div>
          )}

          {/* Bottom Navigation Buttons */}
          <div className="pt-4 mt-4 border-t border-white/10 flex items-center justify-between">
            {step > 1 ? (
              <button
                onClick={() => setStep(prev => prev - 1)}
                className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-white px-3 py-1.5 rounded-xl hover:bg-white/5 transition cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
            ) : (
              <button
                onClick={handleDismiss}
                className="text-xs text-gray-400 hover:text-gray-200 px-3 py-1.5 cursor-pointer"
              >
                Skip Tour
              </button>
            )}

            {step < 3 ? (
              <button
                onClick={() => setStep(prev => prev + 1)}
                className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-gray-100 text-black text-xs font-bold rounded-xl transition shadow-md cursor-pointer"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleDismiss}
                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-[#E50914] to-red-600 hover:from-red-600 hover:to-[#E50914] text-white text-xs font-bold rounded-xl transition shadow-[0_0_15px_rgba(229,9,20,0.5)] cursor-pointer"
              >
                Start Exploring ✓
              </button>
            )}
          </div>

        </div>

      </div>
    </div>
  );
};

export default NewUserGuide;
