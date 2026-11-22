import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Shield, FileText, CheckCircle2 } from 'lucide-react';
import useScrollLock from '../hooks/useScrollLock';

export default function LegalModal({ isOpen, onClose, initialTab = 'privacy' }) {
  const [tab, setTab] = React.useState(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useScrollLock(isOpen);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[1200] flex items-center justify-center p-3 sm:p-6 overflow-hidden">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/85 backdrop-blur-md"
        />

        {/* Modal Box */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          className="relative w-full max-w-2xl bg-[#141414] border border-white/10 rounded-2xl shadow-2xl z-10 flex flex-col max-h-[85vh] overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 sm:p-5 border-b border-white/10 bg-[#181818]">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-red-600/20 border border-red-500/30 flex items-center justify-center text-[#E50914]">
                {tab === 'privacy' ? <Shield className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-black text-white">
                  {tab === 'privacy' ? 'Privacy Policy' : 'Terms of Service'}
                </h3>
                <p className="text-[11px] text-gray-400">MovieX Platform Legal Documentation</p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center text-gray-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tab Selector */}
          <div className="flex border-b border-white/10 bg-black/30 px-4 sm:px-5">
            <button
              onClick={() => setTab('privacy')}
              className={`py-3 px-4 text-xs font-bold border-b-2 transition ${
                tab === 'privacy'
                  ? 'border-[#E50914] text-white'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              Privacy Policy
            </button>
            <button
              onClick={() => setTab('terms')}
              className={`py-3 px-4 text-xs font-bold border-b-2 transition ${
                tab === 'terms'
                  ? 'border-[#E50914] text-white'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              Terms of Service
            </button>
          </div>

          {/* Body Content */}
          <div className="p-5 sm:p-6 overflow-y-auto space-y-4 text-xs sm:text-sm text-gray-300 leading-relaxed font-sans">
            {tab === 'privacy' ? (
              <>
                <section className="space-y-2">
                  <h4 className="text-white font-bold text-sm sm:text-base flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                    1. Information We Collect
                  </h4>
                  <p className="text-gray-400">
                    MovieX (moviex.sbs) is dedicated to safeguarding user privacy. We only collect the minimal information necessary to deliver services:
                  </p>
                  <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
                    <li>Account details (Email address and display name when you sign in via Google OAuth or Email).</li>
                    <li>Device push subscription tokens (FCM Web Push) if you grant notification permissions.</li>
                    <li>Anonymous usage telemetry (movie view counts and notification click feedback).</li>
                  </ul>
                </section>

                <section className="space-y-2">
                  <h4 className="text-white font-bold text-sm sm:text-base flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                    2. How Information is Used
                  </h4>
                  <p className="text-gray-400">
                    Collected data is used strictly for:
                  </p>
                  <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
                    <li>Delivering daily movie & series release alerts via email or push notifications based on your chosen preferences.</li>
                    <li>Synchronizing your personalized Watchlist across your mobile and desktop devices.</li>
                    <li>Keeping the platform secure, preventing abuse, and ensuring fast streaming quality.</li>
                  </ul>
                </section>

                <section className="space-y-2">
                  <h4 className="text-white font-bold text-sm sm:text-base flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                    3. No Third-Party Selling
                  </h4>
                  <p className="text-gray-400">
                    We do <strong>not</strong> sell, trade, or rent personal identification info to marketing agencies. You can opt out of email or push alerts at any time in Notification Preferences.
                  </p>
                </section>
              </>
            ) : (
              <>
                <section className="space-y-2">
                  <h4 className="text-white font-bold text-sm sm:text-base flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-red-400" />
                    1. Platform Usage & Disclaimer
                  </h4>
                  <p className="text-gray-400">
                    MovieX provides a discovery search engine and catalog for trending movies, television web series, and public trailers via official TMDB metadata and third-party media embeds.
                  </p>
                </section>

                <section className="space-y-2">
                  <h4 className="text-white font-bold text-sm sm:text-base flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-red-400" />
                    2. User Responsibilities
                  </h4>
                  <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
                    <li>Users agree not to disrupt or overload platform APIs, bot-scrapers, or reverse-proxy servers.</li>
                    <li>Users agree to provide constructive feedback when submitting broken link reports or community reviews.</li>
                  </ul>
                </section>

                <section className="space-y-2">
                  <h4 className="text-white font-bold text-sm sm:text-base flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-red-400" />
                    3. Termination & Modifications
                  </h4>
                  <p className="text-gray-400">
                    MovieX reserves the right to suspend accounts or adjust notification preferences that violate service integrity. Continued use of MovieX signifies acceptance of revised terms.
                  </p>
                </section>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-white/10 bg-[#181818] flex justify-end">
            <button
              onClick={onClose}
              className="px-5 py-2 bg-[#E50914] hover:bg-[#b80710] text-white text-xs font-bold rounded-xl transition cursor-pointer"
            >
              I Understand & Agree
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
