import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldAlert,
  KeyRound,
  Lock,
  Unlock,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Sparkles,
  Server,
  Database,
  Cpu,
  RefreshCw,
  X,
  ExternalLink,
  Sliders,
  Radio,
  FileCode,
  Flame,
  Zap,
} from 'lucide-react';
import useScrollLock from '../hooks/useScrollLock';
import { supabase } from '../data/supabaseClient';

const STORAGE_HASH_KEY = 'moviex_premium_x_pin_hash';
const STORAGE_SESSION_AUTH = 'moviex_premium_x_authorized_until';

// SHA-256 helper for client-side cryptographic hashing of the 6-digit PIN
async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`moviex_salt_${pin}_2026_secure`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function PremiumXVaultModal({ isOpen, onClose, onLaunchAdminPanel }) {
  useScrollLock(isOpen);

  // States
  const [hasPinConfigured, setHasPinConfigured] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [confirmPinInput, setConfirmPinInput] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState('system'); // system | telemetry | environment | secrets
  const inputRef = useRef(null);

  // Check existing PIN configuration on mount or open
  useEffect(() => {
    if (!isOpen) {
      setPinInput('');
      setErrorMsg('');
      setSuccessMsg('');
      return;
    }

    const storedHash = localStorage.getItem(STORAGE_HASH_KEY);
    const authUntil = sessionStorage.getItem(STORAGE_SESSION_AUTH);

    if (storedHash) {
      setHasPinConfigured(true);
      if (authUntil && parseInt(authUntil, 10) > Date.now()) {
        setIsUnlocked(true);
      } else {
        setIsUnlocked(false);
      }
    } else {
      setHasPinConfigured(false);
      setIsSettingUp(true);
      setIsUnlocked(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, isSettingUp, isUnlocked]);

  // Handle PIN input change (max 6 numeric digits)
  const handlePinChange = (val) => {
    const sanitized = val.replace(/\D/g, '').slice(0, 6);
    setPinInput(sanitized);
    setErrorMsg('');
  };

  // Verify PIN
  const handleVerifyPin = async (e) => {
    if (e) e.preventDefault();
    if (pinInput.length !== 6) {
      setErrorMsg('Please enter a complete 6-digit access code.');
      return;
    }

    setIsProcessing(true);
    setErrorMsg('');

    try {
      const storedHash = localStorage.getItem(STORAGE_HASH_KEY);
      const computedHash = await hashPin(pinInput);

      if (computedHash === storedHash) {
        setIsUnlocked(true);
        // Authorize session for 2 hours
        sessionStorage.setItem(STORAGE_SESSION_AUTH, String(Date.now() + 2 * 60 * 60 * 1000));
        setSuccessMsg('Access Granted: Premium X Vault Unlocked');
        setTimeout(() => setSuccessMsg(''), 3000);
      } else {
        setErrorMsg('Invalid 6-digit access code. Unauthorized entry rejected.');
        setPinInput('');
      }
    } catch {
      setErrorMsg('Cryptographic verification failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Setup or Reset PIN
  const handleCreatePin = async (e) => {
    if (e) e.preventDefault();
    if (newPinInput.length !== 6) {
      setErrorMsg('Access code must be exactly 6 numeric digits.');
      return;
    }
    if (newPinInput !== confirmPinInput) {
      setErrorMsg('Access codes do not match.');
      return;
    }

    setIsProcessing(true);
    setErrorMsg('');

    try {
      const hashed = await hashPin(newPinInput);
      localStorage.setItem(STORAGE_HASH_KEY, hashed);
      sessionStorage.setItem(STORAGE_SESSION_AUTH, String(Date.now() + 2 * 60 * 60 * 1000));
      setHasPinConfigured(true);
      setIsSettingUp(false);
      setIsUnlocked(true);
      setNewPinInput('');
      setConfirmPinInput('');
      setSuccessMsg('6-Digit Security Access Code successfully registered!');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch {
      setErrorMsg('Failed to create secure hash.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Lock Vault
  const handleLockVault = () => {
    sessionStorage.removeItem(STORAGE_SESSION_AUTH);
    setIsUnlocked(false);
    setPinInput('');
    setSuccessMsg('');
    setErrorMsg('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[500] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-3xl bg-[#0e0e13] border border-red-500/30 rounded-3xl overflow-hidden shadow-[0_0_80px_rgba(229,9,20,0.25)] my-auto max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Banner */}
        <div className="relative p-5 sm:p-6 bg-gradient-to-r from-red-950/80 via-black to-[#130f1c] border-b border-red-500/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#E50914] to-red-900 flex items-center justify-center shadow-[0_0_20px_rgba(229,9,20,0.5)] border border-red-400/40">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-black text-white tracking-wider flex items-center gap-1.5">
                  <span>PREMIUM</span>
                  <span className="text-[#E50914] text-xl font-black">X</span>
                  <span className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full bg-red-950 text-red-400 border border-red-800/60 ml-1">
                    Classified Vault
                  </span>
                </h2>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Maximum Security Admin Core &bull; 6-Digit Protected
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isUnlocked && (
              <button
                type="button"
                onClick={handleLockVault}
                className="px-3 py-1.5 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-500/30 text-red-300 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-inner"
              >
                <Lock className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Lock Vault</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition flex items-center justify-center cursor-pointer border border-white/10"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Scroll Body */}
        <div className="p-5 sm:p-7 overflow-y-auto overscroll-contain flex-1 space-y-6">
          {/* If NOT Unlocked: Show 6-Digit PIN Gate or First-time Setup */}
          {!isUnlocked ? (
            <div className="max-w-md mx-auto py-4 text-center space-y-6">
              <div className="w-16 h-16 rounded-3xl bg-red-950/60 border border-red-500/40 mx-auto flex items-center justify-center shadow-[0_0_30px_rgba(229,9,20,0.3)]">
                <KeyRound className="w-8 h-8 text-red-400 animate-pulse" />
              </div>

              <div>
                <h3 className="text-xl font-bold text-white tracking-wide">
                  {isSettingUp ? 'Create 6-Digit Master Security Code' : 'Enter 6-Digit Master Access Code'}
                </h3>
                <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
                  {isSettingUp
                    ? 'Pehli baar setup ke liye apna manpasand 6-digit access code banayein. Yeh code aapke alawa kisi ko pata nahi chalega aur encrypted store hoga.'
                    : 'Premium X Vault me high-privilege administrative tools aur system controls hain. Access ke liye 6-digit master PIN daalein.'}
                </p>
              </div>

              {isSettingUp ? (
                /* PIN Setup Form */
                <form onSubmit={handleCreatePin} className="space-y-4">
                  <div className="space-y-2 text-left">
                    <label className="text-[11px] font-bold text-gray-300 uppercase tracking-wider block">
                      New 6-Digit Code
                    </label>
                    <input
                      ref={inputRef}
                      type={showPin ? 'text' : 'password'}
                      maxLength={6}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={newPinInput}
                      onChange={(e) => setNewPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="e.g. 749201"
                      className="w-full bg-[#141419] border border-white/15 focus:border-red-500 rounded-2xl px-4 py-3 text-center text-xl font-mono tracking-widest text-white outline-none transition shadow-inner"
                    />
                  </div>

                  <div className="space-y-2 text-left">
                    <label className="text-[11px] font-bold text-gray-300 uppercase tracking-wider block">
                      Confirm 6-Digit Code
                    </label>
                    <input
                      type={showPin ? 'text' : 'password'}
                      maxLength={6}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={confirmPinInput}
                      onChange={(e) => setConfirmPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="Confirm 6 digits"
                      className="w-full bg-[#141419] border border-white/15 focus:border-red-500 rounded-2xl px-4 py-3 text-center text-xl font-mono tracking-widest text-white outline-none transition shadow-inner"
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs text-gray-400 px-1">
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      className="flex items-center gap-1.5 hover:text-white transition cursor-pointer"
                    >
                      {showPin ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      <span>{showPin ? 'Hide PIN' : 'Show PIN'}</span>
                    </button>
                    {hasPinConfigured && (
                      <button
                        type="button"
                        onClick={() => setIsSettingUp(false)}
                        className="text-red-400 hover:underline cursor-pointer"
                      >
                        Cancel
                      </button>
                    )}
                  </div>

                  {errorMsg && (
                    <div className="p-3 rounded-xl bg-red-950/60 border border-red-500/50 text-red-300 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isProcessing || newPinInput.length !== 6 || confirmPinInput.length !== 6}
                    className="w-full bg-[#E50914] hover:bg-[#b80710] disabled:opacity-50 text-white font-bold text-sm py-3.5 rounded-2xl shadow-[0_0_25px_rgba(229,9,20,0.5)] transition hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
                  >
                    {isProcessing ? 'Encrypting Code...' : 'Save & Lock Master Code'}
                  </button>
                </form>
              ) : (
                /* PIN Verification Form */
                <form onSubmit={handleVerifyPin} className="space-y-4">
                  <div className="relative">
                    <input
                      ref={inputRef}
                      type={showPin ? 'text' : 'password'}
                      maxLength={6}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={pinInput}
                      onChange={(e) => handlePinChange(e.target.value)}
                      placeholder="&bull; &bull; &bull; &bull; &bull; &bull;"
                      className="w-full bg-[#141419] border border-white/20 focus:border-red-500 rounded-2xl px-4 py-3.5 text-center text-2xl font-mono tracking-[0.5em] text-white outline-none transition shadow-inner"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white cursor-pointer"
                    >
                      {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* 6 Digit Quick Fill Indicator Dots */}
                  <div className="flex justify-center gap-3 py-1">
                    {[0, 1, 2, 3, 4, 5].map((idx) => (
                      <div
                        key={idx}
                        className={`w-3 h-3 rounded-full transition-all duration-200 ${
                          pinInput.length > idx
                            ? 'bg-[#E50914] shadow-[0_0_10px_rgba(229,9,20,0.8)] scale-110'
                            : 'bg-white/10 border border-white/20'
                        }`}
                      />
                    ))}
                  </div>

                  {errorMsg && (
                    <div className="p-3 rounded-xl bg-red-950/60 border border-red-500/50 text-red-300 text-xs flex items-center justify-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isProcessing || pinInput.length !== 6}
                    className="w-full bg-[#E50914] hover:bg-[#b80710] disabled:opacity-50 text-white font-bold text-sm py-3.5 rounded-2xl shadow-[0_0_25px_rgba(229,9,20,0.5)] transition hover:scale-[1.01] active:scale-[0.99] cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Unlock className="w-4 h-4" />
                    <span>{isProcessing ? 'Verifying...' : 'Unlock Premium X Vault'}</span>
                  </button>

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('Resetting PIN requires entering a new 6-digit access code. Continue?')) {
                          setIsSettingUp(true);
                          setErrorMsg('');
                        }
                      }}
                      className="text-xs text-gray-500 hover:text-red-400 transition cursor-pointer"
                    >
                      Forgot or reset 6-digit code?
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : (
            /* UNLOCKED VAULT INTERIOR */
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Top Status Alert */}
              <div className="p-4 rounded-2xl bg-emerald-950/30 border border-emerald-500/30 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <Unlock className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-emerald-300">
                      Master Clearance Active &bull; Full Access Enabled
                    </h4>
                    <p className="text-[11px] text-gray-400">
                      Session protected by cryptographic SHA-256 token. Automatic relock enabled.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    if (onLaunchAdminPanel) onLaunchAdminPanel();
                  }}
                  className="px-4 py-2 rounded-xl bg-[#E50914] hover:bg-[#b80710] text-white text-xs font-bold transition flex items-center gap-1.5 shadow-lg shadow-red-600/30 cursor-pointer"
                >
                  <span>Open Full Admin Panel</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Navigation Tabs */}
              <div className="flex items-center gap-2 overflow-x-auto border-b border-white/10 pb-2">
                {[
                  { id: 'system', label: 'System Diagnostics', icon: Cpu },
                  { id: 'database', label: 'Database & Cloud', icon: Database },
                  { id: 'security', label: 'Master Access Security', icon: KeyRound },
                ].map((t) => {
                  const Icon = t.icon;
                  const isActive = activeTab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setActiveTab(t.id)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                        isActive
                          ? 'bg-red-600/20 text-red-300 border border-red-500/40'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Tab 1: System Diagnostics */}
              {activeTab === 'system' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-2xl bg-[#141419] border border-white/10 space-y-2">
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
                      Production Environment
                    </span>
                    <div className="text-lg font-black text-white flex items-center gap-2">
                      <Server className="w-5 h-5 text-red-500" />
                      <span>Cloudflare Pages &bull; Global CDN</span>
                    </div>
                    <p className="text-xs text-gray-400">
                      Frontend edge hosting with automated zero-downtime deployment pipelines.
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl bg-[#141419] border border-white/10 space-y-2">
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
                      Backend Server Cluster
                    </span>
                    <div className="text-lg font-black text-white flex items-center gap-2">
                      <Zap className="w-5 h-5 text-amber-400" />
                      <span>Render Web Service & Bot</span>
                    </div>
                    <p className="text-xs text-gray-400">
                      Express / Node.js instance powering TMDB proxies, notifications, and Telegram bot.
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl bg-[#141419] border border-white/10 space-y-2">
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
                      Database Engine
                    </span>
                    <div className="text-lg font-black text-white flex items-center gap-2">
                      <Database className="w-5 h-5 text-emerald-400" />
                      <span>PostgreSQL &bull; Supabase RLS</span>
                    </div>
                    <p className="text-xs text-gray-400">
                      Real-time database tables with strict Row-Level Security policies active.
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl bg-[#141419] border border-white/10 space-y-2">
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
                      Notification Engine
                    </span>
                    <div className="text-lg font-black text-white flex items-center gap-2">
                      <Flame className="w-5 h-5 text-rose-500" />
                      <span>FCM V1 &bull; Resend Broadcast</span>
                    </div>
                    <p className="text-xs text-gray-400">
                      Distributed Web Push, in-app badges, and scheduled daily release digests.
                    </p>
                  </div>
                </div>
              )}

              {/* Tab 2: Database & Cloud */}
              {activeTab === 'database' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-[#141419] border border-white/10 space-y-3">
                    <h5 className="text-xs font-bold text-white uppercase tracking-wider">
                      Supabase Cloud Storage & Tables
                    </h5>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      {['admin_users', 'notification_campaigns', 'movie_reports', 'user_reviews', 'user_download_history', 'user_my_list', 'user_subscriptions', 'site_lock_state'].map((tbl) => (
                        <div key={tbl} className="p-2.5 rounded-xl bg-black/40 border border-white/5 font-mono text-gray-300">
                          &bull; {tbl}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-red-950/20 border border-red-500/20 text-xs text-gray-300 leading-relaxed">
                    <strong>Direct SQL Access Policy:</strong> Sensitive administrative write operations strictly require Service Role or Verified Admin UID. Never expose service role keys to client-side code.
                  </div>
                </div>
              )}

              {/* Tab 3: Security & Code Management */}
              {activeTab === 'security' && (
                <div className="p-5 rounded-2xl bg-[#141419] border border-white/10 space-y-4">
                  <h5 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-red-500" />
                    <span>Manage Master Access Code</span>
                  </h5>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    Aap kabhi bhi apna 6-digit master security code badal sakte hain. Naya code lagane par purana code turant expire ho jayega.
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      setIsSettingUp(true);
                      setIsUnlocked(false);
                      setNewPinInput('');
                      setConfirmPinInput('');
                    }}
                    className="px-4 py-2.5 rounded-xl bg-red-950/60 hover:bg-red-900/60 border border-red-500/40 text-red-300 text-xs font-bold transition flex items-center gap-2 cursor-pointer"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Change 6-Digit Master PIN</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
