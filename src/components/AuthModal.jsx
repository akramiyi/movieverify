import React, { useState, useEffect } from 'react';
import { X, ShieldCheck, AlertCircle, Loader2, Lock, ArrowRight } from 'lucide-react';
import { supabase } from '../data/supabaseClient';

const GoogleIcon = () => (
  <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
    />
  </svg>
);

const AuthModal = ({ isOpen, onClose, onOpenAdmin }) => {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setErrorMessage('');

    try {
      const redirectUri = window.location.origin;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUri,
          queryParams: {
            access_type: 'offline',
            prompt: 'select_account',
          },
        },
      });

      if (error) {
        if (
          error.message?.toLowerCase().includes('provider is not enabled') ||
          error.message?.toLowerCase().includes('unsupported provider')
        ) {
          setErrorMessage(
            'Google Sign-In is awaiting provider configuration in the Supabase Dashboard. If you are an administrator, use Admin Login below.'
          );
        } else {
          setErrorMessage(error.message || 'Google authentication failed. Please try again.');
        }
        setLoading(false);
      }
      // If no error, browser redirects to Google OAuth
    } catch (err) {
      setErrorMessage(err?.message || 'An unexpected error occurred during Google sign in.');
      setLoading(false);
    }
  };

  const handleAdminSelect = () => {
    onClose();
    if (onOpenAdmin) {
      onOpenAdmin();
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[160] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div 
        className="w-full max-w-md bg-[#181818] border border-white/10 rounded-2xl shadow-2xl p-6 sm:p-8 relative text-white transition-all transform animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute top-5 right-5 w-8 h-8 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center text-gray-400 hover:text-white transition focus:outline-none focus:ring-2 focus:ring-white/20"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#E50914] to-[#80050b] flex items-center justify-center shadow-lg shadow-red-900/30 mb-3">
            <span className="text-xl font-black tracking-tighter text-white">MV</span>
          </div>
          <h2 id="auth-modal-title" className="text-xl sm:text-2xl font-bold tracking-tight text-white">
            Sign In to MovieVerify
          </h2>
          <p className="text-xs sm:text-sm text-gray-400 mt-1.5 max-w-xs">
            Sign in to personalize your viewing experience or access authorized administrator controls.
          </p>
        </div>

        {/* Error Alert Box */}
        {errorMessage && (
          <div className="mb-5 p-3.5 bg-red-950/40 border border-red-800/60 rounded-xl flex items-start gap-3 text-red-200 text-xs leading-relaxed animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">{errorMessage}</div>
          </div>
        )}

        {/* Option A: Google Sign-in */}
        <div className="space-y-3">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 active:bg-gray-200 text-[#3c4043] font-semibold text-sm sm:text-base py-3.5 px-4 rounded-xl transition duration-150 shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-white/40 disabled:opacity-60 disabled:cursor-not-allowed group cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin text-gray-600" />
                <span className="text-gray-700">Connecting to Google...</span>
              </>
            ) : (
              <>
                <GoogleIcon />
                <span className="text-gray-800 font-medium tracking-tight">Continue with Google</span>
              </>
            )}
          </button>
          
          <p className="text-[11px] text-center text-gray-500">
            For movie buffs, personalized history, and fast viewer access.
          </p>
        </div>

        {/* Modern Divider */}
        <div className="relative my-6 flex items-center justify-center">
          <div className="w-full border-t border-white/10"></div>
          <span className="absolute bg-[#181818] px-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            Or Administrator
          </span>
        </div>

        {/* Option B: Admin Login */}
        <div className="space-y-3">
          <button
            type="button"
            onClick={handleAdminSelect}
            className="w-full flex items-center justify-between p-3.5 bg-white/5 hover:bg-white/10 active:bg-white/15 border border-white/10 hover:border-red-600/50 rounded-xl transition group text-left cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-600/50"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-red-950/50 border border-red-700/40 flex items-center justify-center text-red-400 group-hover:bg-red-900/60 group-hover:text-red-300 transition">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-200 group-hover:text-white flex items-center gap-1.5">
                  <span>Admin Login</span>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-red-950/70 text-red-400 border border-red-900/40">
                    Staff
                  </span>
                </div>
                <div className="text-[11px] text-gray-400">
                  Authorized administrators with verified credentials
                </div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-red-400 group-hover:translate-x-0.5 transition-all flex-shrink-0 ml-2" />
          </button>
        </div>

        {/* Security Note */}
        <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-center gap-1.5 text-[11px] text-gray-500">
          <Lock className="w-3 h-3 text-gray-400" />
          <span>Admin privileges strictly require verified backend authorization.</span>
        </div>
      </div>
    </div>
  );
};

export default AuthModal;
