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
  Film,
  Plus,
  Trash2,
  Save,
  Search,
  Check,
  Globe,
  BellRing,
  Send,
  Users,
  ShieldCheck,
} from 'lucide-react';
import useScrollLock from '../hooks/useScrollLock';
import { supabase } from '../data/supabaseClient';
import { searchTMDB, activeLinks } from '../hooks/useTMDB';

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

  // Admin Verification state
  const [adminUser, setAdminUser] = useState(null);
  const [isAdminVerified, setIsAdminVerified] = useState(false);
  const [isVerifyingAdmin, setIsVerifyingAdmin] = useState(true);
  const [adminError, setAdminError] = useState('');

  // PIN & Vault States
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
  const [activeTab, setActiveTab] = useState('manager'); // 'manager' | 'cloud' | 'system' | 'security'
  const inputRef = useRef(null);

  // Custom Quick Content Manager State (Direct DB insert/update from inside Premium X)
  const [tmdbSearch, setTmdbSearch] = useState('');
  const [tmdbResults, setTmdbResults] = useState([]);
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [customTitle, setCustomTitle] = useState('');
  const [customMediaType, setCustomMediaType] = useState('movie');
  const [link480, setLink480] = useState('');
  const [link720, setLink720] = useState('');
  const [link1080, setLink1080] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [activeDbList, setActiveDbList] = useState([]);
  const [isLoadingLinks, setIsLoadingLinks] = useState(false);
  const [savingLink, setSavingLink] = useState(false);

  // 1. Strictly verify that the currently logged-in user belongs to admin_users table
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setIsVerifyingAdmin(true);
    setAdminError('');

    const verifyAdmin = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || !session.user) {
          if (isMounted) {
            setIsAdminVerified(false);
            setAdminError('Access Denied: Please sign in with your verified administrator email.');
            setIsVerifyingAdmin(false);
          }
          return;
        }

        const user = session.user;
        const { data: adminData, error: adminErr } = await supabase
          .from('admin_users')
          .select('user_id, email, role')
          .eq('user_id', user.id)
          .maybeSingle();

        if (adminErr || !adminData) {
          if (isMounted) {
            setIsAdminVerified(false);
            setAdminError(`Access Denied: ${user.email} is not authorized in admin_users database.`);
            setIsVerifyingAdmin(false);
          }
          return;
        }

        if (isMounted) {
          setAdminUser(adminData);
          setIsAdminVerified(true);
          setIsVerifyingAdmin(false);
        }
      } catch (err) {
        if (isMounted) {
          setIsAdminVerified(false);
          setAdminError(`Verification Error: ${err.message}`);
          setIsVerifyingAdmin(false);
        }
      }
    };

    verifyAdmin();

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  // 2. Check existing PIN configuration on mount/open
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
        loadDbLinks();
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

  // Load database links
  const loadDbLinks = async () => {
    setIsLoadingLinks(true);
    try {
      const { data, error } = await supabase
        .from('download_links')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);

      if (!error && data) {
        setActiveDbList(data);
        data.forEach(row => {
          activeLinks[row.id] = {
            download480p: row.download480p || null,
            download720p: row.download720p || null,
            download1080p: row.download1080p || null,
            description: row.description || null,
            seasons: row.seasons || null
          };
        });
      }
    } catch (e) {
      console.warn('Failed to load database links:', e.message);
    } finally {
      setIsLoadingLinks(false);
    }
  };

  // Search TMDB
  const handleTmdbSearch = async (query) => {
    setTmdbSearch(query);
    if (!query || query.trim().length < 2) {
      setTmdbResults([]);
      return;
    }
    try {
      const res = await searchTMDB(query.trim());
      setTmdbResults(res.slice(0, 6));
    } catch {
      setTmdbResults([]);
    }
  };

  const handleSelectTmdbMovie = (item) => {
    setSelectedMovie(item);
    setCustomTitle(item.title || item.name || '');
    setCustomMediaType(item.mediaType || item.media_type || 'movie');
    setCustomDesc(item.overview || '');
    setTmdbResults([]);
    setTmdbSearch('');

    const targetId = `${item.id}-${item.mediaType || item.media_type || 'movie'}`;
    const existing = activeDbList.find(r => r.id === targetId || String(r.tmdb_id) === String(item.id));
    if (existing) {
      setLink480(existing.download480p || '');
      setLink720(existing.download720p || '');
      setLink1080(existing.download1080p || '');
    } else {
      setLink480('');
      setLink720('');
      setLink1080('');
    }
  };

  const handleSaveCustomContent = async (e) => {
    if (e) e.preventDefault();
    if (!selectedMovie && !customTitle.trim()) {
      alert('Please select or name a title first.');
      return;
    }

    setSavingLink(true);
    const mId = selectedMovie ? String(selectedMovie.id) : `custom-${Date.now()}`;
    const rowId = `${mId}-${customMediaType}`;

    try {
      const { error } = await supabase
        .from('download_links')
        .upsert({
          id: rowId,
          tmdb_id: mId,
          media_type: customMediaType,
          title: customTitle.trim() || selectedMovie?.title || 'Untitled',
          download480p: link480.trim() || null,
          download720p: link720.trim() || null,
          download1080p: link1080.trim() || null,
          description: customDesc.trim() || null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

      if (error) throw error;

      setSuccessMsg(`"${customTitle}" successfully stored in database!`);
      setTimeout(() => setSuccessMsg(''), 4000);
      loadDbLinks();
      setSelectedMovie(null);
      setCustomTitle('');
      setLink480('');
      setLink720('');
      setLink1080('');
      setCustomDesc('');
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setSavingLink(false);
    }
  };

  const handleDeleteLink = async (id, title) => {
    if (!window.confirm(`Delete links for "${title}" from live database?`)) return;
    try {
      const { error } = await supabase.from('download_links').delete().eq('id', id);
      if (error) throw error;
      delete activeLinks[id];
      setActiveDbList(prev => prev.filter(item => item.id !== id));
      setSuccessMsg(`Deleted "${title}" successfully.`);
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      alert(`Delete error: ${err.message}`);
    }
  };

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
        sessionStorage.setItem(STORAGE_SESSION_AUTH, String(Date.now() + 2 * 60 * 60 * 1000));
        setSuccessMsg('Access Granted: Premium X Vault Unlocked');
        setTimeout(() => setSuccessMsg(''), 3000);
        loadDbLinks();
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
      loadDbLinks();
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
        className="relative w-full max-w-4xl bg-[#0e0e13] border border-red-500/30 rounded-3xl overflow-hidden shadow-[0_0_80px_rgba(229,9,20,0.25)] my-auto max-h-[92vh] flex flex-col"
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
                    Master Admin Panel
                  </span>
                </h2>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {adminUser ? `Signed as ${adminUser.email}` : 'Restricted to Verified Administrator Email'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isUnlocked && isAdminVerified && (
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
          {/* STEP 1: Verify Admin Email Check */}
          {isVerifyingAdmin ? (
            <div className="py-16 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-red-500 animate-spin mx-auto" />
              <p className="text-sm font-semibold text-gray-300">
                Verifying Administrator Email Credentials...
              </p>
            </div>
          ) : !isAdminVerified ? (
            <div className="max-w-md mx-auto py-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-red-950/60 border border-red-500/40 mx-auto flex items-center justify-center shadow-[0_0_30px_rgba(229,9,20,0.3)]">
                <ShieldAlert className="w-8 h-8 text-red-400" />
              </div>
              <h3 className="text-lg font-bold text-white">Administrator Verification Required</h3>
              <p className="text-xs text-red-300 bg-red-950/40 p-3.5 rounded-xl border border-red-500/30 leading-relaxed">
                {adminError || 'Yeh section sirf verified admin email ke liye reserved hai.'}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition"
              >
                Close Vault
              </button>
            </div>
          ) : !isUnlocked ? (
            /* STEP 2: 6-Digit PIN Security Gate */
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
                    ? 'Pehli baar setup ke liye apna 6-digit access code banayein. Iske baad aapka poora control panel unlock ho jayega.'
                    : `Verified Admin: ${adminUser?.email}. Access ke liye apna 6-digit master access code daalein.`}
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

                  {/* 6 Digit Indicator Dots */}
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
            /* STEP 3: UNLOCKED MASTER ADMIN INTERIOR WITH FULL CUSTOMIZABILITY */
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Top Banner Alert */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-red-950/40 via-black/40 to-black/40 border border-red-500/30 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#E50914] to-red-900 text-white flex items-center justify-center shrink-0 shadow-lg shadow-red-600/30">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white flex items-center gap-2">
                      <span>Premium X Master Control Active</span>
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-500/30">
                        Full Access
                      </span>
                    </h4>
                    <p className="text-[11px] text-gray-400">
                      Direct cloud database writer, link customization, and instant catalog dispatch enabled.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      if (onLaunchAdminPanel) onLaunchAdminPanel();
                    }}
                    className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border border-white/10"
                  >
                    <span>Full Admin Suite</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Notification Banner */}
              {successMsg && (
                <div className="p-3.5 rounded-2xl bg-green-950/40 border border-green-500/40 text-green-300 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-green-400" />
                  <span>{successMsg}</span>
                </div>
              )}

              {/* Tabs */}
              <div className="flex items-center gap-2 overflow-x-auto border-b border-white/10 pb-2">
                {[
                  { id: 'manager', label: 'Movie & Link Customizer', icon: Film },
                  { id: 'cloud', label: 'Cloud Table Inspector', icon: Database },
                  { id: 'system', label: 'Architecture Diagnostics', icon: Cpu },
                  { id: 'security', label: 'PIN & Master Code', icon: KeyRound },
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
                          ? 'bg-red-600/20 text-red-300 border border-red-500/40 shadow-sm'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* TAB 1: MOVIE & LINK CUSTOMIZER (FULL CONTROL & STORE) */}
              {activeTab === 'manager' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                  {/* Left: Search & Edit Box */}
                  <div className="lg:col-span-7 bg-[#141419] p-5 rounded-2xl border border-white/10 space-y-4">
                    <h5 className="text-xs font-bold text-white uppercase tracking-wider flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <Plus className="w-4 h-4 text-[#E50914]" />
                        <span>Add & Customize Movie / Web Series</span>
                      </span>
                      {selectedMovie && (
                        <button
                          type="button"
                          onClick={() => setSelectedMovie(null)}
                          className="text-[10px] text-red-400 hover:underline"
                        >
                          Clear Selection
                        </button>
                      )}
                    </h5>

                    {/* Quick Search */}
                    <div className="relative">
                      <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Search TMDB to auto-fill title, poster & backdrop..."
                        value={tmdbSearch}
                        onChange={(e) => handleTmdbSearch(e.target.value)}
                        className="w-full bg-black/50 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-red-500 transition"
                      />

                      {/* Dropdown Results */}
                      {tmdbResults.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-[#1a1a24] border border-white/15 rounded-xl shadow-2xl z-30 max-h-52 overflow-y-auto divide-y divide-white/5">
                          {tmdbResults.map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => handleSelectTmdbMovie(m)}
                              className="w-full p-2.5 flex items-center gap-3 hover:bg-white/10 transition text-left cursor-pointer"
                            >
                              <img
                                src={m.poster || m.backdrop || 'https://placehold.co/40x55/222/white?text=No+Img'}
                                alt=""
                                className="w-8 h-11 object-cover rounded shadow"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-bold text-white truncate">{m.title || m.name}</div>
                                <div className="text-[10px] text-gray-400">
                                  {m.year} &bull; {m.mediaType || 'movie'}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Custom Title Input */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-gray-300">Title Name</label>
                      <input
                        type="text"
                        value={customTitle}
                        onChange={(e) => setCustomTitle(e.target.value)}
                        placeholder="e.g. Jawan, Inception, Mirzapur Season 3"
                        className="w-full bg-black/40 border border-white/10 focus:border-red-500 rounded-xl px-3.5 py-2 text-xs text-white outline-none"
                      />
                    </div>

                    {/* Media Type Switcher */}
                    <div className="flex items-center gap-3">
                      <label className="text-[11px] font-semibold text-gray-300">Media Type:</label>
                      <div className="flex items-center gap-2">
                        {['movie', 'tv'].map((type) => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => setCustomMediaType(type)}
                            className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                              customMediaType === type
                                ? 'bg-[#E50914] text-white shadow'
                                : 'bg-white/5 text-gray-400 hover:text-white'
                            }`}
                          >
                            {type === 'movie' ? '🎬 Movie' : '📺 Web Series'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Download Quality Links */}
                    <div className="space-y-3 pt-1">
                      <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
                        Direct Download Links (Verified CDNs)
                      </span>

                      <div>
                        <span className="text-[10px] text-gray-400 block mb-1">480p High Speed Link</span>
                        <input
                          type="url"
                          value={link480}
                          onChange={(e) => setLink480(e.target.value)}
                          placeholder="https://..."
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:border-red-500 outline-none font-mono"
                        />
                      </div>

                      <div>
                        <span className="text-[10px] text-gray-400 block mb-1">720p HD Link</span>
                        <input
                          type="url"
                          value={link720}
                          onChange={(e) => setLink720(e.target.value)}
                          placeholder="https://..."
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:border-red-500 outline-none font-mono"
                        />
                      </div>

                      <div>
                        <span className="text-[10px] text-gray-400 block mb-1">1080p FHD Link</span>
                        <input
                          type="url"
                          value={link1080}
                          onChange={(e) => setLink1080(e.target.value)}
                          placeholder="https://..."
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:border-red-500 outline-none font-mono"
                        />
                      </div>
                    </div>

                    {/* Synopsis */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-gray-300">Description / Synopsis</label>
                      <textarea
                        rows={2}
                        value={customDesc}
                        onChange={(e) => setCustomDesc(e.target.value)}
                        placeholder="Short overview..."
                        className="w-full bg-black/40 border border-white/10 focus:border-red-500 rounded-xl px-3.5 py-2 text-xs text-white outline-none resize-none"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={savingLink}
                      onClick={handleSaveCustomContent}
                      className="w-full bg-[#E50914] hover:bg-[#b80710] disabled:opacity-50 text-white font-bold text-xs sm:text-sm py-3 rounded-xl shadow-lg transition flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Save className="w-4 h-4" />
                      <span>{savingLink ? 'Saving to Database...' : 'Save & Publish to Live Website'}</span>
                    </button>
                  </div>

                  {/* Right: Active Live Database Items */}
                  <div className="lg:col-span-5 bg-[#141419] p-5 rounded-2xl border border-white/10 space-y-3 flex flex-col">
                    <div className="flex items-center justify-between">
                      <h5 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                        <Database className="w-4 h-4 text-emerald-400" />
                        <span>Stored In Database ({activeDbList.length})</span>
                      </h5>
                      <button
                        type="button"
                        onClick={loadDbLinks}
                        disabled={isLoadingLinks}
                        className="text-gray-400 hover:text-white transition p-1"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isLoadingLinks ? 'animate-spin' : ''}`} />
                      </button>
                    </div>

                    <div className="overflow-y-auto max-h-[380px] space-y-2 pr-1 divide-y divide-white/5">
                      {activeDbList.length === 0 ? (
                        <div className="py-12 text-center text-xs text-gray-500">
                          No customized links yet in database.
                        </div>
                      ) : (
                        activeDbList.map((item) => (
                          <div key={item.id} className="pt-2.5 first:pt-0 flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-white truncate">{item.title}</div>
                              <div className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-1.5">
                                <span className="uppercase text-red-400 font-semibold">{item.media_type || 'movie'}</span>
                                <span>&bull;</span>
                                <span className="text-emerald-400">
                                  {[item.download480p && '480p', item.download720p && '720p', item.download1080p && '1080p'].filter(Boolean).join(', ') || 'No links'}
                                </span>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleDeleteLink(item.id, item.title)}
                              className="p-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-400 hover:text-red-200 transition cursor-pointer shrink-0"
                              title="Delete from Live Database"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: CLOUD TABLE INSPECTOR */}
              {activeTab === 'cloud' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-[#141419] border border-white/10 space-y-3">
                    <h5 className="text-xs font-bold text-white uppercase tracking-wider">
                      Supabase Cloud Storage & Active Tables
                    </h5>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      {[
                        'admin_users',
                        'download_links',
                        'notification_campaigns',
                        'movie_reports',
                        'user_reviews',
                        'user_download_history',
                        'user_my_list',
                        'user_subscriptions',
                        'site_settings'
                      ].map((tbl) => (
                        <div key={tbl} className="p-2.5 rounded-xl bg-black/40 border border-white/5 font-mono text-gray-300">
                          &bull; {tbl}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-red-950/20 border border-red-500/20 text-xs text-gray-300 leading-relaxed">
                    <strong>Direct SQL Access Policy:</strong> Sensitive administrative operations strictly require Service Role or Verified Admin UID. Live link records added via Premium X immediately overwrite static fallbacks.
                  </div>
                </div>
              )}

              {/* TAB 3: ARCHITECTURE DIAGNOSTICS */}
              {activeTab === 'system' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-2xl bg-[#141419] border border-white/10 space-y-2">
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
                      Production Frontend
                    </span>
                    <div className="text-lg font-black text-white flex items-center gap-2">
                      <Server className="w-5 h-5 text-red-500" />
                      <span>Cloudflare Pages &bull; Global CDN</span>
                    </div>
                    <p className="text-xs text-gray-400">
                      Edge delivery across 300+ global locations with instant cache invalidation.
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl bg-[#141419] border border-white/10 space-y-2">
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
                      Backend Service
                    </span>
                    <div className="text-lg font-black text-white flex items-center gap-2">
                      <Zap className="w-5 h-5 text-amber-400" />
                      <span>Render Node.js & Telegram Bot</span>
                    </div>
                    <p className="text-xs text-gray-400">
                      Handles TMDB proxies, notifications, automated digests, and bot automation.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 4: PIN & MASTER SECURITY CODE MANAGEMENT */}
              {activeTab === 'security' && (
                <div className="p-5 rounded-2xl bg-[#141419] border border-white/10 space-y-4">
                  <h5 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-red-500" />
                    <span>Manage Master 6-Digit Access Code</span>
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
