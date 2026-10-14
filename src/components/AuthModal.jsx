import React, { useState, useEffect } from 'react';
import { X, ShieldCheck, AlertCircle, Loader2, Lock, User, Mail, Eye, EyeOff } from 'lucide-react';
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

import { movies as localMovies } from '../data/movies';

// High-resolution fallback posters matching reference collage composition (All verified 200 OK)
const FALLBACK_COLUMN_1 = [
  { title: 'Jawan', img: 'https://image.tmdb.org/t/p/w500/4Y1WNkd88JXmGfhtWR7dmDAo1T2.jpg' },
  { title: 'Casino', img: 'https://image.tmdb.org/t/p/w500/gziIkUSnYuj9ChCi8qOu2ZunpSC.jpg' },
  { title: 'Inception', img: 'https://image.tmdb.org/t/p/w500/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg' },
  { title: 'Oppenheimer', img: 'https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg' },
  { title: 'The Dark Knight', img: 'https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg' },
  { title: 'Avengers', img: 'https://image.tmdb.org/t/p/w500/or06FN3Dka5tukK1e9sl16pB3iy.jpg' },
];

const FALLBACK_COLUMN_2 = [
  { title: 'Dune Part Two', img: 'https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg' },
  { title: 'Animal', img: 'https://image.tmdb.org/t/p/w500/zqFuriKJ6pYDvf72kXNLONnuE8k.jpg' },
  { title: 'Spider-Man', img: 'https://image.tmdb.org/t/p/w500/1g0dhYtq4irTY1GPXvft6k4YLjm.jpg' },
  { title: 'Salaar', img: 'https://image.tmdb.org/t/p/w500/siduVKgOnABO4WH4lOwPQwaGwJp.jpg' },
  { title: 'Toxic', img: 'https://image.tmdb.org/t/p/w500/s5KZqIvyjwKpTRESCVrVGkT1JX3.jpg' },
  { title: 'Pushpa', img: 'https://image.tmdb.org/t/p/w500/h6Pd89ngvl9quPVsx3KoJlQsvk9.jpg' },
];

const FALLBACK_COLUMN_3 = [
  { title: 'The Boys', img: 'https://image.tmdb.org/t/p/w500/in1R2dDc421JxsoRWaIIAqVI2KE.jpg' },
  { title: 'Stranger Things', img: 'https://image.tmdb.org/t/p/w500/uOOtwVbSr4QDjAGIifLDwpb2Pdl.jpg' },
  { title: 'John Wick 4', img: 'https://image.tmdb.org/t/p/w500/vZloFAK7NmvMGKE7VkF5UHaz0I.jpg' },
  { title: 'Fight Club', img: 'https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg' },
  { title: 'The Godfather', img: 'https://image.tmdb.org/t/p/w500/3bhkrj58Vtu7enYsRolD1fZdja1.jpg' },
  { title: 'Ratsasan', img: 'https://image.tmdb.org/t/p/w500/velWPhVMQeQKcxggNEU8YmIo52R.jpg' },
];

// Module-level cache for TMDB movie posters so we never re-parse or re-fetch during animation
let cachedTMDBPosterPool = null;

const getAvailableTMDBPosters = () => {
  if (cachedTMDBPosterPool && cachedTMDBPosterPool.length > 50) {
    return cachedTMDBPosterPool;
  }

  const pool = [];
  const seen = new Set();

  const add = (title, img) => {
    if (!img || typeof img !== 'string') return;
    const fullUrl = img.startsWith('http')
      ? img
      : `https://image.tmdb.org/t/p/w500${img}`;
    if (!seen.has(fullUrl)) {
      seen.add(fullUrl);
      pool.push({ title: title || 'Movie', img: fullUrl });
    }
  };

  // 1. Read existing TMDB data cached in sessionStorage by useTMDB
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith('tmdb_cache_')) {
        const raw = sessionStorage.getItem(k);
        if (raw) {
          const parsed = JSON.parse(raw);
          const list = Array.isArray(parsed) ? parsed : (parsed?.results || []);
          list.forEach((m) => {
            if (m && (m.poster_path || m.poster)) {
              add(m.title || m.name, m.poster_path || m.poster);
            }
          });
        }
      }
    }
  } catch {
    // sessionStorage read failed or disabled
  }

  // 2. Add local movie database posters
  if (Array.isArray(localMovies)) {
    localMovies.forEach((m) => {
      if (m && (m.poster || m.poster_path)) {
        add(m.title, m.poster || m.poster_path);
      }
    });
  }

  // 3. Add existing verified fallback posters
  FALLBACK_COLUMN_1.forEach((m) => add(m.title, m.img));
  FALLBACK_COLUMN_2.forEach((m) => add(m.title, m.img));
  FALLBACK_COLUMN_3.forEach((m) => add(m.title, m.img));

  if (pool.length >= 18) {
    cachedTMDBPosterPool = pool;
  }

  return pool;
};

// Shuffles pool and returns 3 distinct columns of 6 posters each (18 unique posters)
const getRandomPosterColumns = () => {
  const pool = getAvailableTMDBPosters();
  if (pool.length < 18) {
    return {
      col1: FALLBACK_COLUMN_1,
      col2: FALLBACK_COLUMN_2,
      col3: FALLBACK_COLUMN_3,
    };
  }

  // Fisher-Yates shuffle
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return {
    col1: shuffled.slice(0, 6),
    col2: shuffled.slice(6, 12),
    col3: shuffled.slice(12, 18),
  };
};

const PosterCard = ({ title, img }) => {
  const [hasError, setHasError] = useState(false);

  return (
    <div className="w-24 xs:w-28 sm:w-32 md:w-36 aspect-[2/3] rounded-xl overflow-hidden shadow-2xl border border-white/10 flex-shrink-0 bg-neutral-900 group">
      {hasError ? (
        <div className="w-full h-full bg-gradient-to-br from-neutral-800 to-neutral-950 flex flex-col items-center justify-center p-2 text-center">
          <div className="w-6 h-6 rounded-full bg-red-600/30 flex items-center justify-center text-red-500 mb-1">MV</div>
          <span className="text-[10px] font-bold text-gray-300 line-clamp-2">{title}</span>
        </div>
      ) : (
        <img
          src={img}
          alt={title}
          loading="lazy"
          onError={() => setHasError(true)}
          className="w-full h-full object-cover select-none pointer-events-none"
        />
      )}
    </div>
  );
};

// Continuous vertical scrolling poster collage (from top to bottom)
const MoviePosterCollage = ({ columns }) => {
  const { col1, col2, col3 } = columns || {
    col1: FALLBACK_COLUMN_1,
    col2: FALLBACK_COLUMN_2,
    col3: FALLBACK_COLUMN_3,
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-black select-none pointer-events-none flex items-start justify-center">
      {/* Edge gradient overlays for seamless blending into form & edges */}
      <div className="hidden md:block absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#0e0e0e] via-[#0e0e0e]/80 to-transparent z-10" />
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#0e0e0e] to-transparent z-10" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0e0e0e] to-transparent z-10" />

      {/* Angled and scaled collage container anchored at top */}
      <div className="transform -rotate-12 origin-top scale-105 xs:scale-110 sm:scale-125 flex gap-3.5 sm:gap-4 -mt-6">
        {/* Column 1: Smooth continuous vertical scroll */}
        <div className="flex flex-col gap-4 poster-scroll-col-1">
          {[...col1, ...col1, ...col1, ...col1].map((poster, idx) => (
            <PosterCard key={`c1-${idx}`} title={poster.title} img={poster.img} />
          ))}
        </div>

        {/* Column 2: Smooth continuous vertical scroll */}
        <div className="flex flex-col gap-4 poster-scroll-col-2">
          {[...col2, ...col2, ...col2, ...col2].map((poster, idx) => (
            <PosterCard key={`c2-${idx}`} title={poster.title} img={poster.img} />
          ))}
        </div>

        {/* Column 3: Smooth continuous vertical scroll */}
        <div className="flex flex-col gap-4 poster-scroll-col-3">
          {[...col3, ...col3, ...col3, ...col3].map((poster, idx) => (
            <PosterCard key={`c3-${idx}`} title={poster.title} img={poster.img} />
          ))}
        </div>
      </div>
    </div>
  );
};

// Time-based dynamic greeting for Akram (Morning, Afternoon, Evening, Night)
export const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour >= 4 && hour < 12) return 'Good Morning, Akram 🌅';
  if (hour >= 12 && hour < 17) return 'Good Afternoon, Akram ☀️';
  if (hour >= 17 && hour < 21) return 'Good Evening, Akram 🌇';
  return 'Good Night, Akram 🌙';
};

const AuthModal = ({ isOpen, onClose, onOpenAdmin }) => {
  const [activeTab, setActiveTab] = useState('user'); // 'user' | 'admin'
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [animKey, setAnimKey] = useState(0);
  const [posterColumns, setPosterColumns] = useState(() => getRandomPosterColumns());
  const [greeting, setGreeting] = useState(() => getGreeting());

  // Update greeting every minute and whenever modal opens
  useEffect(() => {
    setGreeting(getGreeting());
    const interval = setInterval(() => {
      setGreeting(getGreeting());
    }, 60000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // Restart poster animation from t=0 and randomize poster collection whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setAnimKey((prev) => prev + 1);
      setPosterColumns(getRandomPosterColumns());
    }
  }, [isOpen]);

  // Admin login credentials
  const [emailVal, setEmailVal] = useState('');
  const [passVal, setPassVal] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

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

  // Google OAuth flow for regular users
  const handleGoogleSignIn = async () => {
    setLoading(true);
    setErrorMessage('');

    try {
      const redirectUri = 
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
          ? window.location.origin
          : 'https://movieverify.vercel.app/';

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
            'Google Sign-In is awaiting provider configuration in Supabase Dashboard. Use Admin Login if you are a staff member.'
          );
        } else {
          setErrorMessage(error.message || 'Google authentication failed. Please try again.');
        }
        setLoading(false);
      }
    } catch (err) {
      setErrorMessage(err?.message || 'An unexpected error occurred during Google sign in.');
      setLoading(false);
    }
  };

  // Direct Admin login within the modal
  const handleAdminLogin = async (e) => {
    e.preventDefault();
    if (!emailVal.trim() || !passVal.trim()) {
      setErrorMessage('Please enter both admin email and password.');
      return;
    }

    setLoading(true);
    setErrorMessage('');

    try {
      // 1. Sign in with admin credentials
      const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
        email: emailVal.trim(),
        password: passVal.trim(),
      });

      if (authErr) {
        setErrorMessage(authErr.message || 'Invalid administrator credentials.');
        setLoading(false);
        return;
      }

      // 2. Strictly verify admin authorization against admin_users table
      if (authData?.user) {
        const { data: adminData, error: adminErr } = await supabase
          .from('admin_users')
          .select('user_id')
          .eq('user_id', authData.user.id)
          .maybeSingle();

        if (adminErr || !adminData) {
          setErrorMessage('You are not authorized to access the Admin Panel.');
          await supabase.auth.signOut();
          setLoading(false);
          return;
        }

        // Successfully authenticated as an authorized administrator
        setLoading(false);
        onClose();
        if (onOpenAdmin) {
          onOpenAdmin();
        }
      }
    } catch (err) {
      setErrorMessage(err?.message || 'Server authentication error. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[160] flex items-center justify-start md:justify-center p-0 md:p-4 bg-black/90 md:bg-black/85 backdrop-blur-md transition-opacity animate-in fade-in duration-200 overflow-hidden"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div 
        className="w-full h-full md:max-w-4xl lg:max-w-[920px] md:h-[580px] md:max-h-[92vh] md:bg-[#0e0e0e] md:border md:border-white/10 md:rounded-3xl md:shadow-2xl relative overflow-hidden flex flex-row items-center md:items-stretch justify-start md:justify-between text-white animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top-Right Close Button (Desktop) */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="hidden md:flex absolute top-4 right-4 z-30 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 items-center justify-center text-gray-300 hover:text-white transition focus:outline-none focus:ring-2 focus:ring-white/30 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* AUTHENTICATION FORM CARD:
            On mobile: floating translucent card on the left leaving right poster strip visible
            On desktop: left column (48% width)
        */}
        <div className="relative z-20 w-[calc(100%-3.75rem)] xs:w-[calc(100%-4.5rem)] sm:w-[calc(100%-5.5rem)] max-w-[340px] sm:max-w-[370px] ml-2 xs:ml-3 sm:ml-4 my-auto bg-[#0e0e0e]/95 backdrop-blur-xl border border-white/10 rounded-2xl sm:rounded-3xl shadow-2xl p-4 xs:p-5 sm:p-6 md:p-8 lg:p-10 md:w-[48%] md:max-w-none md:ml-0 md:my-0 md:h-full md:self-stretch md:border-0 md:rounded-none md:shadow-none md:bg-[#0e0e0e] flex flex-col justify-between overflow-y-auto max-h-[92vh] md:max-h-none">
          <div>
            {/* Header: Logo and Mobile Close Button */}
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <div className="flex items-center gap-2 sm:gap-2.5">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-[#E50914] flex items-center justify-center shadow-lg shadow-red-900/40 flex-shrink-0">
                  <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-white ml-0.5" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
                <div className="flex flex-col">
                  <span className="text-base sm:text-lg font-black tracking-tight text-white leading-none">
                    Movie<span className="text-white">Verify</span>
                  </span>
                  <span className="text-[8px] sm:text-[9px] font-bold tracking-[0.2em] text-gray-400 uppercase mt-0.5">
                    SEARCH • VERIFY • DOWNLOAD
                  </span>
                </div>
              </div>

              {/* Mobile-only Close Button */}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="md:hidden w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 flex items-center justify-center text-gray-300 hover:text-white transition focus:outline-none focus:ring-2 focus:ring-white/30 cursor-pointer flex-shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Heading */}
            {activeTab === 'admin' ? (
              <div className="mb-6 animate-in fade-in duration-200">
                <h2 id="auth-modal-title" className="text-2xl sm:text-3xl font-black tracking-tight text-white mb-1.5">
                  {greeting}
                </h2>
                <p className="text-xs sm:text-sm text-gray-400">
                  Sign in to MovieVerify Admin Control Panel
                </p>
              </div>
            ) : (
              <div className="mb-6 animate-in fade-in duration-200">
                <h2 id="auth-modal-title" className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-1.5">
                  Sign in to <span className="text-[#E50914]">continue</span>
                </h2>
                <p className="text-xs sm:text-sm text-gray-400">
                  Get access to exclusive content, verified links and more.
                </p>
              </div>
            )}

            {/* Segmented Toggle: User Login / Admin Login */}
            <div className="bg-[#141414] border border-white/10 rounded-xl p-1 flex items-center gap-1 mb-6 max-w-sm">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('user');
                  setErrorMessage('');
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-semibold transition-all duration-200 cursor-pointer focus:outline-none ${
                  activeTab === 'user'
                    ? 'bg-[#E50914] text-white shadow-lg shadow-red-900/40'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <User className="w-3.5 h-3.5" />
                <span>User Login</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('admin');
                  setErrorMessage('');
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-semibold transition-all duration-200 cursor-pointer focus:outline-none ${
                  activeTab === 'admin'
                    ? 'bg-[#E50914] text-white shadow-lg shadow-red-900/40'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Admin Login</span>
              </button>
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className="mb-4 p-3 bg-red-950/40 border border-red-800/60 rounded-xl flex items-start gap-2.5 text-red-200 text-xs leading-relaxed animate-in fade-in">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">{errorMessage}</div>
              </div>
            )}

            {/* VIEW A: USER LOGIN */}
            {activeTab === 'user' ? (
              <div className="space-y-5 animate-in fade-in duration-150">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 active:bg-gray-200 text-[#3c4043] font-semibold text-sm py-3 px-4 rounded-xl transition duration-150 shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-white/40 disabled:opacity-60 cursor-pointer group"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-gray-600" />
                      <span className="text-gray-700 text-xs">Connecting to Google...</span>
                    </>
                  ) : (
                    <>
                      <GoogleIcon />
                      <span className="text-gray-800 font-medium tracking-tight">Continue with Google</span>
                    </>
                  )}
                </button>

                {/* Divider */}
                <div className="relative flex items-center justify-center my-4">
                  <div className="w-full border-t border-white/10" />
                  <span className="absolute bg-[#0e0e0e] px-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
                    OR
                  </span>
                </div>

                {/* Terms of Service notice */}
                <p className="text-[11px] text-gray-500 text-center leading-relaxed">
                  By continuing, you agree to our{' '}
                  <a href="#" className="underline text-gray-400 hover:text-gray-300">
                    Privacy Policy
                  </a>{' '}
                  and{' '}
                  <a href="#" className="underline text-gray-400 hover:text-gray-300">
                    Terms of Service
                  </a>
                </p>
              </div>
            ) : (
              /* VIEW B: ADMIN LOGIN */
              <form onSubmit={handleAdminLogin} className="space-y-3.5 animate-in fade-in duration-150">
                {/* Email / Mobile */}
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    required
                    value={emailVal}
                    onChange={(e) => setEmailVal(e.target.value)}
                    placeholder="Email address or mobile number"
                    className="w-full bg-[#161616] border border-white/10 rounded-xl py-3 pl-10 pr-3 text-xs sm:text-sm text-white placeholder-gray-500 focus:border-[#E50914] focus:ring-1 focus:ring-[#E50914] outline-none transition"
                  />
                </div>

                {/* Password with eye toggle */}
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={passVal}
                    onChange={(e) => setPassVal(e.target.value)}
                    placeholder="Password"
                    className="w-full bg-[#161616] border border-white/10 rounded-xl py-3 pl-10 pr-10 text-xs sm:text-sm text-white placeholder-gray-500 focus:border-[#E50914] focus:ring-1 focus:ring-[#E50914] outline-none transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition focus:outline-none"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Remember me & Forgot password */}
                <div className="flex items-center justify-between text-xs pt-0.5">
                  <label className="flex items-center gap-2 text-gray-400 hover:text-gray-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="rounded bg-black/60 border border-white/20 accent-[#E50914] w-3.5 h-3.5 cursor-pointer"
                    />
                    <span>Remember me</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setErrorMessage('Please contact system administrator to reset credentials.')}
                    className="text-gray-400 hover:text-white transition focus:outline-none cursor-pointer"
                  >
                    Forgot password?
                  </button>
                </div>

                {/* Submit Sign In button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-[#E50914] hover:bg-[#b80710] active:bg-[#90050c] disabled:opacity-50 text-white font-bold rounded-xl text-sm transition shadow-lg shadow-red-900/30 flex items-center justify-center gap-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-600/50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>Verifying credentials...</span>
                    </>
                  ) : (
                    <span>Sign In</span>
                  )}
                </button>
              </form>
            )}
          </div>

          {/* Bottom dismiss option: Continue browsing without signing in */}
          <div className="mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-white/5 text-center">
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] sm:text-xs text-gray-400 hover:text-white transition duration-150 py-1 sm:py-1.5 px-2.5 sm:px-3 rounded-lg hover:bg-white/5 focus:outline-none focus:ring-1 focus:ring-white/20 cursor-pointer font-medium"
            >
              Continue browsing without signing in &rarr;
            </button>
          </div>
        </div>

        {/* POSTER COLLAGE:
            On mobile: absolute inset-0 z-0 (spans full background of the modal, clearly visible on the right strip & surrounding the card)
            On desktop: relative w-[52%] h-[580px] z-0 (standard right column)
        */}
        <div className="absolute inset-0 md:relative md:inset-auto md:w-[52%] md:h-[580px] md:self-stretch z-0 overflow-hidden bg-black flex items-start justify-center select-none pointer-events-none">
          <MoviePosterCollage key={`collage-${animKey}`} columns={posterColumns} />
        </div>
      </div>
    </div>
  );
};

export default AuthModal;
