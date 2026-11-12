import React, { useState, useEffect } from 'react';
import { Search, Save, Trash2, Key, Lock, Film, AlertCircle, CheckCircle, ArrowLeft, LogOut, X, Clock, ExternalLink, RefreshCw, ShieldAlert, AlertTriangle, ArrowLeftRight } from 'lucide-react';
import { supabase } from '../data/supabaseClient';
import { searchTMDB, fetchMovieOrTVById, activeLinks } from '../hooks/useTMDB';
import ReportsPanel from './ReportsPanel';
import AnalyticsDashboard from './AnalyticsDashboard';
import CampaignManager from './CampaignManager';
import { buildContentUpdateIdempotencyKey } from '../utils/notificationLinks';

const MAX_ADMIN_ATTEMPTS = 5;
const DEFAULT_ADMIN_LOCKOUT_SECONDS = 15 * 60; // 15 minutes
const STORAGE_KEY_ADMIN_ATTEMPTS = 'movieverify_admin_attempts';
const STORAGE_KEY_ADMIN_BLOCKED_UNTIL = 'movieverify_admin_blocked_until';

const AdminLiveClock = () => {
  const [now, setNow] = useState(new Date());
  const [showEpoch, setShowEpoch] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10);
    return () => clearInterval(timer);
  }, []);

  const h = now.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const time = `${String(h12).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}.${String(now.getMilliseconds()).padStart(3,'0')} ${ampm}`;
  const date = now.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const epochMs = now.getTime();
  const epochSec = Math.floor(epochMs / 1000);

  return (
    <div className="flex items-center gap-2 bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-1.5 shadow-sm">
      <div className="w-7 h-7 rounded-full bg-[#E50914]/15 border border-[#E50914]/30 flex items-center justify-center shrink-0">
        <Clock className="w-3.5 h-3.5 text-[#E50914]" />
      </div>
      <div className="flex flex-col min-w-[135px]">
        {showEpoch ? (
          <>
            <span className="font-mono text-xs font-bold text-amber-400 tracking-wider">
              {epochMs}
            </span>
            <span className="text-[9px] text-gray-400 font-mono">
              Epoch ({epochSec}s)
            </span>
          </>
        ) : (
          <>
            <span className="font-mono text-xs font-bold text-white tracking-wider">
              {time}
            </span>
            <span className="text-[9px] text-gray-400">
              {date}
            </span>
          </>
        )}
      </div>

      {/* Exchange / Switch Button */}
      <button
        type="button"
        onClick={() => setShowEpoch((prev) => !prev)}
        className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-md transition border border-white/5 active:scale-95 cursor-pointer ml-1"
        title={showEpoch ? 'Switch to Standard Time' : 'Switch to Epoch Time'}
      >
        <ArrowLeftRight className="w-3.5 h-3.5 text-gray-300 hover:text-[#E50914]" />
      </button>
    </div>
  );
};

const AdminPanel = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState('manager'); // 'manager' | 'reports'
  // Login State
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [emailVal, setEmailVal] = useState('');
  const [passVal, setPassVal] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Admin Rate Limiting / Lockout State
  const [adminAttemptsRemaining, setAdminAttemptsRemaining] = useState(MAX_ADMIN_ATTEMPTS);
  const [adminBlockedUntil, setAdminBlockedUntil] = useState(0);
  const [adminCountdownSeconds, setAdminCountdownSeconds] = useState(0);

  // Movie Search/Form State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedMovie, setSelectedMovie] = useState(null);
  
  // Link Quality Fields
  const [link480, setLink480] = useState('');
  const [link720, setLink720] = useState('');
  const [link1080, setLink1080] = useState('');
  const [descriptionVal, setDescriptionVal] = useState('');
  
  // Seasons Data for TV Shows
  const [seasonsData, setSeasonsData] = useState([]);

  // Status/Feedbacks
  const [actionStatus, setActionStatus] = useState({ type: '', message: '' });
  const [activeDbList, setActiveDbList] = useState([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [qualityFilter, setQualityFilter] = useState('all');
  const [broadcastToAll, setBroadcastToAll] = useState(true);

  const [siteLockStatus, setSiteLockStatus] = useState(false);
  const [lockKeyInput, setLockKeyInput] = useState('');
  const [lockToggling, setLockToggling] = useState(false);
  const [lockKeyUpdating, setLockKeyUpdating] = useState(false);
  const [lockMessage, setLockMessage] = useState(null);

  // Fetch all link configurations from Supabase
  const fetchCurrentLinks = async () => {
    setIsLoadingList(true);
    try {
      const { data, error } = await supabase
        .from('download_links')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      if (data) {
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

      setActiveDbList(data || []);
    } catch (e) {
      console.warn('Failed to load links from Supabase:', e.message);
    } finally {
      setIsLoadingList(false);
    }
  };

  const fetchSiteLockStatus = async () => {
    try {
      const { data } = await supabase
        .from('site_settings')
        .select('is_locked')
        .eq('id', 1)
        .single();
      if (data) {
        setSiteLockStatus(Boolean(data.is_locked));
      }
    } catch (e) {
      console.warn('Failed to fetch site lock status:', e.message);
    }
  };

  const handleToggleSiteLock = async () => {
    setLockToggling(true);
    setLockMessage(null);
    const newStatus = !siteLockStatus;
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      let handled = false;

      // 1. Primary path: Call serverless endpoint using service_role with admin JWT
      if (token) {
        try {
          const res = await fetch('/api/site-lock/verify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
              action: 'toggle',
              is_locked: newStatus,
              lock_password: lockKeyInput.trim() || undefined
            })
          });

          const data = await res.json().catch(() => ({}));
          if (res.ok && data.success) {
            setSiteLockStatus(newStatus);
            handled = true;
            setLockMessage({
              type: 'success',
              text: newStatus 
                ? (lockKeyInput.trim() ? '🔒 Site locked and access key updated successfully!' : '🔒 Site is now locked! Visitors will need the access key to enter.') 
                : '🔓 Site unlocked successfully! The site is now open to the public.'
            });
            if (newStatus) {
              sessionStorage.removeItem('movieverify_unlocked');
              localStorage.removeItem('movieverify_site_unlocked');
            }
            if (lockKeyInput.trim()) {
              setLockKeyInput('');
            }
          } else {
            console.warn('[SiteLock] Serverless endpoint returned error:', data.error);
          }
        } catch (fetchErr) {
          console.warn('[SiteLock] Serverless network error:', fetchErr.message);
        }
      }

      // 2. Fallback: Direct client supabase update (is_locked only to avoid column permission errors)
      if (!handled) {
        const { error } = await supabase
          .from('site_settings')
          .update({ is_locked: newStatus, updated_at: new Date().toISOString() })
          .eq('id', 1);

        if (!error) {
          setSiteLockStatus(newStatus);
          setLockMessage({
            type: 'success',
            text: newStatus ? '🔒 Site locked successfully.' : '🔓 Site unlocked successfully.'
          });
          if (newStatus) {
            sessionStorage.removeItem('movieverify_unlocked');
            localStorage.removeItem('movieverify_site_unlocked');
          }
        } else {
          setLockMessage({
            type: 'error',
            text: `Failed to update site lock: ${error.message}`
          });
        }
      }
    } catch (e) {
      setLockMessage({
        type: 'error',
        text: `Error updating site lock: ${e.message}`
      });
    } finally {
      setLockToggling(false);
    }
  };

  const handleSaveLockKey = async () => {
    if (!lockKeyInput.trim()) {
      setLockMessage({ type: 'error', text: 'Please enter an access key before saving.' });
      return;
    }

    setLockKeyUpdating(true);
    setLockMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        setLockMessage({ type: 'error', text: 'Admin session expired. Please sign in again.' });
        setLockKeyUpdating(false);
        return;
      }

      const res = await fetch('/api/site-lock/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          action: 'update',
          lock_password: lockKeyInput.trim()
        })
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setLockMessage({
          type: 'success',
          text: '🔑 Access key updated and saved successfully!'
        });
        setLockKeyInput('');
      } else {
        setLockMessage({
          type: 'error',
          text: data.error || 'Failed to update access key.'
        });
      }
    } catch (e) {
      setLockMessage({
        type: 'error',
        text: `Network error saving access key: ${e.message}`
      });
    } finally {
      setLockKeyUpdating(false);
    }
  };

  // Initialize lockout state from localStorage on mount
  useEffect(() => {
    try {
      const storedBlockedUntil = parseInt(localStorage.getItem(STORAGE_KEY_ADMIN_BLOCKED_UNTIL) || '0', 10);
      const now = Date.now();
      if (storedBlockedUntil && storedBlockedUntil > now) {
        setAdminBlockedUntil(storedBlockedUntil);
        setAdminCountdownSeconds(Math.ceil((storedBlockedUntil - now) / 1000));
        setAdminAttemptsRemaining(0);
      } else {
        const storedAttempts = parseInt(localStorage.getItem(STORAGE_KEY_ADMIN_ATTEMPTS) || '0', 10);
        setAdminAttemptsRemaining(Math.max(0, MAX_ADMIN_ATTEMPTS - storedAttempts));
      }
    } catch {}
  }, []);

  // Countdown timer effect for lockout
  useEffect(() => {
    if (!adminBlockedUntil) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const diff = Math.ceil((adminBlockedUntil - now) / 1000);

      if (diff <= 0) {
        setAdminBlockedUntil(0);
        setAdminCountdownSeconds(0);
        setAdminAttemptsRemaining(MAX_ADMIN_ATTEMPTS);
        setLoginError('');
        try {
          localStorage.removeItem(STORAGE_KEY_ADMIN_BLOCKED_UNTIL);
          localStorage.removeItem(STORAGE_KEY_ADMIN_ATTEMPTS);
        } catch {}
      } else {
        setAdminCountdownSeconds(diff);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [adminBlockedUntil]);

  const formatAdminCountdown = (totalSeconds) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Google OAuth sign in for Admin
  const handleGoogleAdminLogin = async () => {
    if (adminBlockedUntil > Date.now()) return;
    setIsAuthenticating(true);
    setLoginError('');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/admin`
        }
      });
      if (error) {
        setLoginError(error.message);
        setIsAuthenticating(false);
      }
    } catch (e) {
      setLoginError('Failed to initiate Google sign-in.');
      setIsAuthenticating(false);
    }
  };

  // Clear stale auth tokens from localStorage
  const handleClearSession = () => {
    try {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('sb-') || key.includes('supabase')) {
          localStorage.removeItem(key);
        }
      });
    } catch {}
    window.location.reload();
  };

  // Check active session on mount
  useEffect(() => {
    let isMounted = true;
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const { data: adminData, error: adminErr } = await supabase
            .from('admin_users')
            .select('user_id')
            .eq('user_id', session.user.id)
            .maybeSingle();

          if (!isMounted) return;

          if (adminErr) {
            console.warn('Admin check skipped due to network/database error:', adminErr.message);
            setIsCheckingSession(false);
            return;
          }

          if (adminData) {
            setIsLoggedIn(true);
            fetchCurrentLinks();
            fetchSiteLockStatus();
          } else {
            setIsLoggedIn(false);
            setLoginError(`Signed in as viewer (${session.user.email}). Administrator credentials required.`);
          }
        }
      } catch (err) {
        console.warn('Session check failed:', err.message);
      } finally {
        if (isMounted) {
          setIsCheckingSession(false);
        }
      }
    };
    checkSession();
    return () => {
      isMounted = false;
    };
  }, []);

  // Authenticate Admin Credentials using Supabase Auth
  const handleLogin = async (e) => {
    e.preventDefault();
    if (adminBlockedUntil > Date.now()) return;
    setLoginError('');
    setIsAuthenticating(true);

    try {
      // 1. Sign in using email/password
      const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
        email: emailVal.trim(),
        password: passVal.trim()
      });

      if (authErr) {
        const msg = authErr.message || '';
        const isNetworkErr = 
          msg.toLowerCase().includes('failed to fetch') ||
          msg.toLowerCase().includes('network') ||
          msg.toLowerCase().includes('load failed') ||
          msg.toLowerCase().includes('resolve') ||
          msg.toLowerCase().includes('abort');

        if (isNetworkErr) {
          setLoginError('database_unreachable');
        } else {
          const nextRemaining = Math.max(0, adminAttemptsRemaining - 1);
          setAdminAttemptsRemaining(nextRemaining);

          try {
            const currentFailed = MAX_ADMIN_ATTEMPTS - nextRemaining;
            localStorage.setItem(STORAGE_KEY_ADMIN_ATTEMPTS, String(currentFailed));

            if (nextRemaining <= 0) {
              const lockUntilTimestamp = Date.now() + DEFAULT_ADMIN_LOCKOUT_SECONDS * 1000;
              setAdminBlockedUntil(lockUntilTimestamp);
              setAdminCountdownSeconds(DEFAULT_ADMIN_LOCKOUT_SECONDS);
              localStorage.setItem(STORAGE_KEY_ADMIN_BLOCKED_UNTIL, String(lockUntilTimestamp));
              setLoginError('Reached maximum attempt limit! Admin access temporarily blocked for 15 minutes.');
              setIsAuthenticating(false);
              return;
            }
          } catch {}

          setLoginError(`Invalid login credentials. ${nextRemaining} attempt${nextRemaining === 1 ? '' : 's'} remaining.`);
        }
        setIsAuthenticating(false);
        return;
      }

      if (authData?.user) {
        // 2. Ensure session is established
        const { data: { user }, error: getUserErr } = await supabase.auth.getUser();
        
        if (getUserErr || !user) {
          setLoginError('Authentication session failed to establish.');
          setIsAuthenticating(false);
          return;
        }

        const { data: adminData, error: adminErr } = await supabase
          .from('admin_users')
          .select('user_id')
          .eq('user_id', user.id)
          .maybeSingle();

        if (adminErr) {
          console.warn('Admin authorization query failed:', adminErr.message);
          setLoginError('Unable to verify admin access. Check database status.');
          setIsAuthenticating(false);
          return;
        }

        if (!adminData) {
          setLoginError('You are not authorized to access the Admin Panel.');
          await supabase.auth.signOut();
          setIsAuthenticating(false);
          return;
        }

        // Clear any previous failed attempt locks upon success
        try {
          localStorage.removeItem(STORAGE_KEY_ADMIN_BLOCKED_UNTIL);
          localStorage.removeItem(STORAGE_KEY_ADMIN_ATTEMPTS);
        } catch {}
        setAdminAttemptsRemaining(MAX_ADMIN_ATTEMPTS);
        setAdminBlockedUntil(0);

        setIsLoggedIn(true);
        fetchCurrentLinks();
        fetchSiteLockStatus();
      }
    } catch (err) {
      const msg = err?.message || '';
      const isNetworkErr = 
        msg.toLowerCase().includes('failed to fetch') ||
        msg.toLowerCase().includes('network') ||
        msg.toLowerCase().includes('load failed') ||
        msg.toLowerCase().includes('resolve') ||
        msg.toLowerCase().includes('abort');

      if (isNetworkErr) {
        setLoginError('database_unreachable');
      } else {
        setLoginError(msg || 'Server authentication error. Please try again.');
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Sign out admin session
  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      setIsLoggedIn(false);
      setSelectedMovie(null);
      setEmailVal('');
      setPassVal('');
    } catch (e) {
      console.warn('Logout failed:', e.message);
    }
  };

  // Search TMDB when typing movie title
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const delayDebounce = setTimeout(async () => {
      try {
        const results = await searchTMDB(searchQuery);
        setSearchResults(results);
      } catch (err) {
        console.error('TMDB Search error in Admin:', err);
      }
    }, 400);

    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);

  // Load item into form for editing
  const handleEditItem = async (item) => {
    const movieObj = {
      id: item.tmdb_id || item.id,
      title: item.title,
      mediaType: item.media_type,
      poster: null,
      backdrop: null,
    };
    handleSelectMovie(movieObj);
    try {
      const details = await fetchMovieOrTVById(movieObj.id, movieObj.mediaType);
      if (details) {
        setSelectedMovie((prev) => (prev && String(prev.id) === String(movieObj.id) ? { ...prev, ...details } : prev));
      }
    } catch {}
  };

  // Handle movie selection from dropdown
  const handleSelectMovie = async (movie) => {
    setSelectedMovie(movie);
    setSearchQuery('');
    setSearchResults([]);

    if (!movie.poster && !movie.backdrop) {
      try {
        const details = await fetchMovieOrTVById(movie.id, movie.mediaType || movie.media_type);
        if (details) {
          setSelectedMovie((prev) => (prev && String(prev.id) === String(movie.id) ? { ...prev, ...details } : prev));
        }
      } catch {}
    }

    // Check if it already exists in Supabase to pre-fill links
    const existing = activeDbList.find(item => String(item.id) === String(movie.id) || String(item.tmdb_id) === String(movie.id));
    if (existing) {
      setLink480(existing.download480p || '');
      setLink720(existing.download720p || '');
      setLink1080(existing.download1080p || '');
      setDescriptionVal(existing.description || '');
      setSeasonsData(existing.seasons || []);
    } else {
      setLink480('');
      setLink720('');
      setLink1080('');
      setDescriptionVal('');
      setSeasonsData([]);
    }
  };

  // TV Shows dynamic handlers
  const handleAddSeason = () => setSeasonsData([...seasonsData, { season: seasonsData.length + 1, parts: [] }]);
  const handleRemoveSeason = (sIdx) => { const u = [...seasonsData]; u.splice(sIdx, 1); setSeasonsData(u); };
  const handleUpdateSeason = (sIdx, val) => { const u = [...seasonsData]; u[sIdx].season = Number(val); setSeasonsData(u); };
  const handleAddPart = (sIdx) => { const u = [...seasonsData]; u[sIdx].parts.push({ name: `Episode ${u[sIdx].parts.length + 1}`, download480p: '', download720p: '', download1080p: '' }); setSeasonsData(u); };
  const handleRemovePart = (sIdx, pIdx) => { const u = [...seasonsData]; u[sIdx].parts.splice(pIdx, 1); setSeasonsData(u); };
  const handleUpdatePart = (sIdx, pIdx, f, val) => { const u = [...seasonsData]; u[sIdx].parts[pIdx][f] = val; setSeasonsData(u); };

  // Save/Upsert links to Supabase
  const handleSave = async (e) => {
    e.preventDefault();
    if (!selectedMovie) return;

    setActionStatus({ type: '', message: '' });

    const cleanId = String(selectedMovie.id);
    const mediaType = selectedMovie.mediaType || selectedMovie.media_type || (seasonsData.length > 0 ? 'tv' : 'movie');
    const isTv = mediaType === 'tv' || mediaType === 'series' || seasonsData.length > 0;
    const previousRecord = activeDbList.find(
      (item) => item.id === `${cleanId}-${mediaType}` || String(item.tmdb_id) === cleanId
    );
    const prevSeasons = Array.isArray(previousRecord?.seasons) ? previousRecord.seasons : [];

    try {
      const { error } = await supabase
        .from('download_links')
        .upsert({
          id: `${selectedMovie.id}-${selectedMovie.mediaType || 'movie'}`,
          tmdb_id: String(selectedMovie.id),
          media_type: selectedMovie.mediaType || 'movie',
          title: selectedMovie.title,
          download480p: link480.trim() || null,
          download720p: link720.trim() || null,
          download1080p: link1080.trim() || null,
          description: descriptionVal.trim() || null,
          seasons: seasonsData.length > 0 ? seasonsData : null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

      if (error) throw error;

      const successMessage = `Links for "${selectedMovie.title}" successfully updated!`;
      setActionStatus({ type: 'success', message: successMessage });

      // Non-blocking release automation: never fail or roll back successful catalog saves
      const hasAnyLinks = Boolean(
        link480.trim() || link720.trim() || link1080.trim() ||
        seasonsData.some((s) => Array.isArray(s.parts) && s.parts.length > 0)
      );

      if (hasAnyLinks) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.access_token) {
            let movieImage =
              selectedMovie?.backdrop ||
              selectedMovie?.poster ||
              (selectedMovie?.backdrop_path ? `https://image.tmdb.org/t/p/w780${selectedMovie.backdrop_path}` : null) ||
              (selectedMovie?.poster_path ? `https://image.tmdb.org/t/p/w780${selectedMovie.poster_path}` : null) ||
              null;

            if (!movieImage) {
              try {
                const details = await fetchMovieOrTVById(cleanId, mediaType);
                if (details) {
                  movieImage = details.backdrop || details.poster || null;
                }
              } catch {}
            }

            let eventPayload = null;

            if (isTv) {
              const prevSeasonNums = new Set(prevSeasons.map((s) => Number(s.season)));
              const addedSeasons = seasonsData
                .map((s) => Number(s.season))
                .filter((num) => Number.isFinite(num) && num > 0 && !prevSeasonNums.has(num));

              if (!previousRecord) {
                eventPayload = {
                  event_type: 'series_release',
                  tmdb_id: cleanId,
                  media_type: 'tv',
                  title: selectedMovie.title,
                  image_url: movieImage,
                  url: `/?type=tv&id=${cleanId}`,
                };
              } else if (addedSeasons.length > 0) {
                const highestSeason = Math.max(...addedSeasons);
                eventPayload = {
                  event_type: 'season_release',
                  tmdb_id: cleanId,
                  media_type: 'tv',
                  season_number: highestSeason,
                  title: selectedMovie.title,
                  image_url: movieImage,
                  url: `/?type=tv&id=${cleanId}`,
                };
              } else {
                eventPayload = {
                  event_type: 'content_update',
                  tmdb_id: cleanId,
                  media_type: 'tv',
                  title: selectedMovie.title,
                  image_url: movieImage,
                  url: `/?type=tv&id=${cleanId}`,
                };
              }
            } else {
              const qualityLabel = link1080.trim() ? '1080p' : link720.trim() ? '720p' : '480p';
              eventPayload = !previousRecord
                ? {
                    event_type: 'movie_release',
                    tmdb_id: cleanId,
                    media_type: 'movie',
                    title: selectedMovie.title,
                    release_quality: qualityLabel,
                    image_url: movieImage,
                    url: `/?type=movie&id=${cleanId}`,
                  }
                : {
                    event_type: 'content_update',
                    tmdb_id: cleanId,
                    media_type: 'movie',
                    title: selectedMovie.title,
                    release_quality: qualityLabel,
                    image_url: movieImage,
                    url: `/?type=movie&id=${cleanId}`,
                  };
            }

            if (eventPayload) {
              const saveTimestamp = Date.now();
              if (broadcastToAll) {
                eventPayload.target_type = 'all';
                eventPayload.broadcast_all = true;
                eventPayload.idempotency_key = `catalog:save:${cleanId}:broadcast:${saveTimestamp}`;
              } else {
                eventPayload.idempotency_key = `catalog:save:${cleanId}:targeted:${saveTimestamp}`;
              }

              const notifyRes = await fetch('/api/notifications/events', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify(eventPayload),
              });

              if (!notifyRes.ok) {
                const notifyErr = await notifyRes.json().catch(() => ({}));
                setActionStatus({
                  type: 'success',
                  message: `${successMessage} (Notification queueing skipped: ${notifyErr.error || notifyRes.status})`,
                });
              } else {
                const notifyData = await notifyRes.json().catch(() => ({}));
                const pushSent = notifyData.immediate_dispatch?.sent ?? notifyData.push_deliveries ?? 0;
                const totalRecip = notifyData.total_recipients ?? 0;
                if (pushSent > 0) {
                  setActionStatus({
                    type: 'success',
                    message: `${successMessage} • 🔔 Sent push alert to ${pushSent} subscriber(s)!`,
                  });
                } else if (totalRecip === 0) {
                  setActionStatus({
                    type: 'success',
                    message: `${successMessage} (0 users were subscribed to this title. Keep "Broadcast to all" enabled to notify everyone).`,
                  });
                }
              }
            }
          }
        } catch (notifyErr) {
          console.warn('[AdminPanel] Non-blocking notification trigger failed:', notifyErr.message);
        }
      }

      setSelectedMovie(null);
      setLink480('');
      setLink720('');
      setLink1080('');
      setSeasonsData([]);
      fetchCurrentLinks();
    } catch (err) {
      console.error('Supabase save error details:', {
        code: err?.code,
        message: err?.message,
        details: err?.details,
        hint: err?.hint
      });
      setActionStatus({ 
        type: 'error', 
        message: `DB Error: ${err?.message || err?.code || 'Failed to update links'}` 
      });
    }
  };

  // Delete configuration from Supabase
  const handleDelete = async (id, title) => {
    if (!window.confirm(`Are you sure you want to delete download links for "${title}"?`)) return;

    try {
      const { error } = await supabase
        .from('download_links')
        .delete()
        .eq('id', String(id));

      if (error) throw error;

      delete activeLinks[String(id)];
      setActionStatus({ type: 'success', message: `Links for "${title}" deleted.` });
      fetchCurrentLinks();
    } catch (err) {
      console.error('Delete failed:', err);
      setActionStatus({ type: 'error', message: 'Failed to delete configuration.' });
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 4 && hour < 12) return 'Good Morning, Akram 🌅';
    if (hour >= 12 && hour < 17) return 'Good Afternoon, Akram ☀️';
    if (hour >= 17 && hour < 21) return 'Good Evening, Akram 🌇';
    return 'Good Night, Akram 🌙';
  };

  const [greeting, setGreeting] = useState(() => getGreeting());

  useEffect(() => {
    setGreeting(getGreeting());
    const timer = setInterval(() => {
      setGreeting(getGreeting());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  if (isCheckingSession) {
    return (
      <div className="fixed inset-0 z-[150] bg-black/95 flex items-center justify-center p-4 backdrop-blur-md">
        <div className="flex flex-col items-center justify-center gap-3">
          <div className="w-9 h-9 border-2 border-[#E50914] border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-xs font-medium tracking-wide">Checking administrator session...</p>
        </div>
      </div>
    );
  }

  const isBlocked = adminBlockedUntil > Date.now();

  if (!isLoggedIn) {
    return (
      <div className="fixed inset-0 z-[150] bg-black/95 flex items-center justify-center p-4 backdrop-blur-md">
        <div className="w-full max-w-sm bg-[#181818] border border-white/10 rounded-lg p-6 shadow-2xl relative overflow-hidden">
          
          {/* Top glowing bar */}
          <div
            className={`absolute top-0 left-0 right-0 h-1 ${
              isBlocked ? 'bg-amber-500 animate-pulse' : 'bg-[#E50914]'
            }`}
          />

          <button 
            type="button"
            onClick={onClose}
            className="absolute top-4 left-4 text-gray-400 hover:text-white transition text-xs font-semibold flex items-center gap-1.5 focus:outline-none cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Site
          </button>

          <div className="flex flex-col items-center mt-6 mb-6 text-center">
            <div
              className={`w-12 h-12 border flex items-center justify-center rounded-full mb-3 transition-colors ${
                isBlocked
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-500'
                  : 'bg-[#E50914]/20 border-[#E50914] text-[#E50914]'
              }`}
            >
              {isBlocked ? (
                <ShieldAlert className="w-6 h-6 animate-pulse" />
              ) : (
                <Key className="w-6 h-6" />
              )}
            </div>
            <h2 className="text-2xl font-black text-white leading-tight">
              {isBlocked ? 'Limit Reached' : greeting}
            </h2>
            <p className="text-gray-400 text-xs mt-1.5">
              {isBlocked ? (
                <span className="text-amber-400 font-medium">
                  Too many failed attempts. Admin access is locked for 15 minutes.
                </span>
              ) : (
                'Sign in to MovieVerify Admin'
              )}
            </p>
          </div>

          {/* Active Lockout Timer Card */}
          {isBlocked && (
            <div className="mb-4 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex items-center justify-center gap-2.5 text-amber-400 text-sm font-semibold">
              <Clock className="w-4 h-4 animate-spin" />
              <span>Try again in {formatAdminCountdown(adminCountdownSeconds)}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Admin Email</label>
              <input 
                type="email" 
                required
                disabled={isBlocked || isAuthenticating}
                value={emailVal}
                onChange={e => setEmailVal(e.target.value)}
                placeholder="admin@movieverify.com"
                className={`w-full bg-black/50 border rounded p-3 text-white outline-none transition text-sm ${
                  isBlocked
                    ? 'border-amber-500/30 opacity-50 cursor-not-allowed text-gray-500'
                    : 'border-white/10 focus:border-[#E50914]'
                }`}
              />
            </div>
            <div>
              <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Password</label>
              <input 
                type="password" 
                required
                disabled={isBlocked || isAuthenticating}
                value={passVal}
                onChange={e => setPassVal(e.target.value)}
                placeholder="••••••••••••"
                className={`w-full bg-black/50 border rounded p-3 text-white outline-none transition text-sm ${
                  isBlocked
                    ? 'border-amber-500/30 opacity-50 cursor-not-allowed text-gray-500'
                    : 'border-white/10 focus:border-[#E50914]'
                }`}
              />
            </div>

            {loginError === 'database_unreachable' ? (
              <div className="bg-red-950/40 border border-red-500/50 p-3.5 rounded-lg text-left space-y-2.5">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold text-red-400">Database Connection Failed (ERR_NAME_NOT_RESOLVED)</h4>
                    <p className="text-[11px] text-gray-300 mt-0.5 leading-relaxed">
                      Supabase server se connect nahi ho pa raha hai. Free Tier inactivity ki wajah se Supabase project <strong>PAUSED</strong> ho gaya hai.
                    </p>
                  </div>
                </div>
                
                <div className="bg-black/50 border border-white/10 rounded p-2.5 text-[11px] text-gray-300 space-y-1.5">
                  <div className="font-semibold text-white">Theek karne ke steps:</div>
                  <ol className="list-decimal list-inside space-y-1 text-gray-300 text-[10px]">
                    <li>Supabase Dashboard kholein:</li>
                    <a 
                      href="https://supabase.com/dashboard/project/jbfqwxcymldhyembzjpv" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[#E50914] hover:underline font-mono text-[10px] break-all my-0.5 font-bold"
                    >
                      <span>supabase.com/dashboard/project/jbfqwxcymldhyembzjpv</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <li>Wahan <strong className="text-green-400">"Restore project"</strong> par click karein (1-2 min me active ho jayega).</li>
                    <li>Ya agar aapne naya project banaya hai, to Vercel settings me URL update karein.</li>
                  </ol>
                </div>

                <button
                  type="button"
                  onClick={handleClearSession}
                  className="w-full text-center py-1.5 bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white rounded text-[11px] font-medium transition flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className="w-3 h-3" /> Clear Stored Session & Refresh
                </button>
              </div>
            ) : loginError && (
              <div className="space-y-1.5 text-center">
                <div className="flex items-center gap-2 text-red-500 text-xs bg-red-950/30 border border-red-900/50 p-3 rounded text-left">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{loginError}</span>
                </div>
                {!isBlocked && adminAttemptsRemaining < MAX_ADMIN_ATTEMPTS && (
                  <div className="inline-block px-2.5 py-0.5 rounded-full bg-red-950/40 border border-red-500/30 text-[11px] font-semibold text-red-300">
                    {adminAttemptsRemaining} of {MAX_ADMIN_ATTEMPTS} attempts left
                  </div>
                )}
              </div>
            )}

            <button 
              type="submit"
              disabled={isBlocked || isAuthenticating}
              className={`w-full py-3 rounded font-bold transition text-sm shadow-lg mt-2 focus:outline-none ${
                isBlocked
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-60'
                  : 'bg-[#E50914] hover:bg-[#b80710] disabled:bg-red-800 disabled:opacity-50 text-white'
              }`}
            >
              {isBlocked
                ? `Blocked (${formatAdminCountdown(adminCountdownSeconds)})`
                : isAuthenticating
                ? 'Signing In...'
                : 'Sign In'}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-4 flex items-center justify-center">
            <div className="border-t border-white/10 w-full" />
            <span className="bg-[#181818] px-3 text-[10px] text-gray-400 font-semibold uppercase tracking-wider">or</span>
            <div className="border-t border-white/10 w-full" />
          </div>

          {/* Google OAuth Login for Admin */}
          <button
            type="button"
            onClick={handleGoogleAdminLogin}
            disabled={isBlocked || isAuthenticating}
            className="w-full py-2.5 bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white rounded font-medium text-xs transition flex items-center justify-center gap-2 border border-white/5 cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/>
              <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.7-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"/>
              <path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15.2c0 2.8.7 5.5 1.9 7.9l3.7-2.9z"/>
              <path fill="#34A853" d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2-6.4-4.8L1.9 16.9C3.7 20.6 7.5 23.5 12 23.5z"/>
            </svg>
            Continue with Google (Admin)
          </button>
        </div>
      </div>
    );
  }

  const filteredSavedMovies = activeDbList
    .filter(m => m.title?.toLowerCase().includes(searchFilter.toLowerCase()))
    .filter(m => {
      if (qualityFilter === 'missing1080p') return !m.download1080p || m.download1080p === '#';
      if (qualityFilter === 'missing720p') return !m.download720p || m.download720p === '#';
      if (qualityFilter === 'complete') 
        return m.download480p && m.download720p && m.download1080p && 
               m.download480p !== '#' && m.download720p !== '#' && m.download1080p !== '#';
      return true;
    });

  // Calculate Stats
  const totalMovies = activeDbList.length;
  const missing1080p = activeDbList.filter(m => !m.download1080p || m.download1080p === '#').length;
  const missing720p = activeDbList.filter(m => !m.download720p || m.download720p === '#').length;
  const latestUpdatedMovie = [...activeDbList].sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))[0];
  const lastUpdated = latestUpdatedMovie ? new Date(latestUpdatedMovie.updated_at || latestUpdatedMovie.created_at || 0).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'N/A';

  return (
    <div className="fixed inset-0 z-[150] bg-black/95 flex flex-col p-4 md:p-8 overflow-y-auto backdrop-blur-md">
      <div className="w-full max-w-4xl mx-auto bg-[#181818] border border-white/10 rounded-lg p-6 md:p-8 shadow-2xl relative mt-12 flex flex-col">
        
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-6 px-4 md:px-0">
          <AdminLiveClock />
          <div className="flex flex-wrap items-center gap-2">
          <button 
            onClick={() => setActiveTab(activeTab === 'analytics' ? 'manager' : 'analytics')}
            className="bg-purple-600/20 hover:bg-purple-600 text-purple-300 hover:text-white transition text-xs font-bold px-3 py-2 rounded-full flex items-center gap-1 focus:outline-none"
          >
            {activeTab === 'analytics' ? 'Back to Manager' : 'View Analytics'}
          </button>
          <button 
            onClick={() => setActiveTab(activeTab === 'campaigns' ? 'manager' : 'campaigns')}
            className="bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white transition text-xs font-bold px-3 py-2 rounded-full flex items-center gap-1 focus:outline-none"
          >
            {activeTab === 'campaigns' ? 'Back to Manager' : 'Campaigns'}
          </button>
          <button 
            onClick={() => setActiveTab(activeTab === 'reports' ? 'manager' : 'reports')}
            className="bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white transition text-xs font-bold px-3 py-2 rounded-full flex items-center gap-1 focus:outline-none"
          >
            {activeTab === 'reports' ? 'Back to Manager' : 'View Reports'}
          </button>
          <button 
            onClick={handleLogout}
            className="bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition text-xs font-bold px-3 py-2 rounded-full flex items-center gap-1 focus:outline-none"
          >
            <LogOut className="w-3.5 h-3.5" /> Logout
          </button>
          <button 
            onClick={onClose}
            className="bg-white/10 hover:bg-white/20 text-white transition text-xs font-bold px-4 py-2 rounded-full focus:outline-none"
          >
            Close Manager
          </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex flex-col md:flex-row gap-8 w-full">
          {activeTab === 'campaigns' ? (
            <div className="w-full flex-1">
              <CampaignManager />
            </div>
          ) : activeTab === 'reports' ? (
            <div className="w-full flex-1">
              <ReportsPanel />
            </div>
          ) : activeTab === 'analytics' ? (
            <div className="w-full flex-1">
              <AnalyticsDashboard />
            </div>
          ) : (
            <>
              {/* Left Form Panel */}
              <div className="flex-1 space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="bg-[#1a1a1a] border border-white/5 rounded-xl p-4 text-center">
              <div className="text-3xl font-black text-white">{totalMovies}</div>
              <div className="text-xs text-gray-400 mt-1">Total Movies</div>
            </div>
            <div className="bg-[#1a1a1a] border border-white/5 rounded-xl p-4 text-center">
              <div className="text-3xl font-black text-[#E50914]">{missing1080p}</div>
              <div className="text-xs text-gray-400 mt-1">Missing 1080p</div>
            </div>
            <div className="bg-[#1a1a1a] border border-white/5 rounded-xl p-4 text-center">
              <div className="text-3xl font-black text-yellow-400">{missing720p}</div>
              <div className="text-xs text-gray-400 mt-1">Missing 720p</div>
            </div>
            <div className="bg-[#1a1a1a] border border-white/5 rounded-xl p-4 text-center flex flex-col justify-center">
              <div className="text-xl font-black text-green-400">{lastUpdated}</div>
              <div className="text-xs text-gray-400 mt-1">Last Updated</div>
            </div>
          </div>

          <div className={`bg-[#1a1a1a] border rounded-xl p-4 mb-6 transition-all duration-300 ${
            siteLockStatus ? 'border-red-500/40 bg-gradient-to-r from-red-950/20 via-[#1a1a1a] to-[#1a1a1a]' : 'border-white/5'
          }`}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-white font-bold text-sm">Site Lock</h4>
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase ${
                    siteLockStatus 
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30' 
                      : 'bg-green-500/20 text-green-400 border border-green-500/30'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${siteLockStatus ? 'bg-red-400 animate-ping' : 'bg-green-400'}`} />
                    {siteLockStatus ? 'Locked (Private)' : 'Public (Active)'}
                  </span>
                </div>
                <p className="text-gray-400 text-xs mt-1">
                  {siteLockStatus 
                    ? 'Site is currently password-protected. Visitors must enter the access key.' 
                    : 'Site is open and accessible to all visitors without restrictions.'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleToggleSiteLock}
                disabled={lockToggling || lockKeyUpdating}
                className={`px-4 py-2 rounded-full text-xs font-bold transition flex items-center gap-1.5 shadow-md ${
                  siteLockStatus 
                    ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-900/40' 
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/40'
                } disabled:opacity-50`}
              >
                {lockToggling ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Updating...</span>
                  </>
                ) : siteLockStatus ? (
                  <>
                    <Lock className="w-3.5 h-3.5" />
                    <span>Unlock Site</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-3.5 h-3.5" />
                    <span>Lock Site</span>
                  </>
                )}
              </button>
            </div>
            
            <div className="space-y-2 pt-2 border-t border-white/5">
              <label className="text-xs text-gray-300 font-medium flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-red-400" />
                Access Key Management
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Set or change access key..."
                  value={lockKeyInput}
                  onChange={(e) => setLockKeyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveLockKey();
                    }
                  }}
                  className="flex-1 bg-black/50 border border-white/10 rounded px-3 py-2 text-white text-sm outline-none focus:border-[#E50914] transition"
                />
                <button
                  type="button"
                  onClick={handleSaveLockKey}
                  disabled={lockKeyUpdating || lockToggling || !lockKeyInput.trim()}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-white/10 text-white rounded text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap"
                >
                  {lockKeyUpdating ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Save Key</span>
                    </>
                  )}
                </button>
              </div>
              <p className="text-gray-500 text-[11px]">
                {siteLockStatus 
                  ? 'Visitors will need to enter this key to unlock and browse the catalog.' 
                  : 'Enter a key and click "Lock Site" to lock immediately with this key, or click "Save Key" to update it in advance.'}
              </p>

              {lockMessage && (
                <div className={`flex items-center gap-2 p-2.5 rounded text-xs border mt-2 transition ${
                  lockMessage.type === 'success' 
                    ? 'bg-green-950/40 border-green-800/60 text-green-300' 
                    : 'bg-red-950/40 border-red-800/60 text-red-300'
                }`}>
                  {lockMessage.type === 'success' ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                  <span>{lockMessage.text}</span>
                </div>
              )}
            </div>
          </div>

          <div>
            <h2 className="text-xl md:text-2xl font-black text-[#E50914] mb-4">{getGreeting()}</h2>
            <h3 className="text-lg md:text-xl font-bold text-white">Manage Downloads</h3>
            <p className="text-gray-400 text-xs mt-1">Search TMDB movies/series and assign download URLs</p>
          </div>

          {actionStatus.message && (
            <div className={`flex items-center gap-2 p-3 rounded text-xs border ${
              actionStatus.type === 'success' ? 'bg-green-950/20 border-green-900/50 text-green-400' : 'bg-red-950/20 border-red-900/50 text-red-400'
            }`}>
              {actionStatus.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              <span>{actionStatus.message}</span>
            </div>
          )}

          {/* TMDB Search */}
          <div className="relative">
            <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Search TMDB Movie/Series</label>
            <div className="relative">
              <Search className="absolute left-3 top-3.5 text-gray-400 w-4 h-4" />
              <input 
                type="text"
                placeholder="Type movie name to search TMDB..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded p-3 pl-10 text-white focus:border-[#E50914] outline-none transition text-sm"
              />
            </div>

            {/* Results Dropdown */}
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 bg-[#222] border border-white/10 rounded-b shadow-2xl z-50 max-h-60 overflow-y-auto">
                {searchResults.map(item => (
                  <div 
                    key={item.id}
                    onClick={() => handleSelectMovie(item)}
                    className="p-3 border-b border-white/5 hover:bg-white/5 cursor-pointer transition flex items-center gap-3 text-sm text-gray-200"
                  >
                    {item.poster ? (
                      <img src={item.poster} alt={item.title} className="w-8 h-12 object-cover rounded" loading="lazy" />
                    ) : (
                      <div className="w-8 h-12 bg-white/5 rounded flex items-center justify-center"><Film className="w-4 h-4 text-gray-500" /></div>
                    )}
                    <div>
                      <div className="font-bold text-white">{item.title} ({item.year})</div>
                      <div className="text-xs text-gray-400 capitalize">{item.mediaType}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Form details once a movie is selected */}
          {selectedMovie ? (
            <form onSubmit={handleSave} className="space-y-4 border-t border-white/5 pt-4">
              <div className="flex items-center gap-3 bg-white/5 p-3 rounded">
                {selectedMovie.poster && (
                  <img src={selectedMovie.poster} alt={selectedMovie.title} className="w-10 h-15 object-cover rounded" loading="lazy" />
                )}
                <div>
                  <h3 className="font-bold text-white">{selectedMovie.title}</h3>
                  <p className="text-xs text-[#E50914] capitalize font-semibold">{selectedMovie.mediaType} • TMDB ID: {selectedMovie.id}</p>
                </div>
              </div>

              {selectedMovie.mediaType === 'tv' ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-white font-bold">Seasons & Episodes</h4>
                    <button type="button" onClick={handleAddSeason} className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded text-white font-bold transition">+ Add Season</button>
                  </div>
                  {seasonsData.map((s, sIdx) => (
                    <div key={sIdx} className="bg-black/30 p-4 border border-white/5 rounded-lg space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-bold text-sm">Season</span>
                          <input type="number" value={s.season} onChange={(e) => handleUpdateSeason(sIdx, e.target.value)} className="w-16 bg-black/50 border border-white/10 p-1 text-white text-center rounded outline-none" min="1" />
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => handleAddPart(sIdx)} className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 bg-blue-900/20 rounded transition font-bold">+ Add Episode</button>
                          <button type="button" onClick={() => handleRemoveSeason(sIdx)} className="text-xs text-red-500 hover:text-red-400 p-1.5 bg-red-900/20 rounded transition"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                      
                      {s.parts.map((p, pIdx) => (
                        <div key={pIdx} className="bg-white/5 p-3 rounded-lg space-y-3 border border-white/5 relative mt-3">
                          <button type="button" onClick={() => handleRemovePart(sIdx, pIdx)} className="absolute top-2 right-2 text-red-500 hover:text-red-400 p-1"><X className="w-4 h-4" /></button>
                          <div className="pr-8">
                            <label className="block text-gray-400 text-[10px] uppercase mb-1 font-semibold tracking-wider">Episode Title</label>
                            <input type="text" value={p.name} onChange={(e) => handleUpdatePart(sIdx, pIdx, 'name', e.target.value)} placeholder="e.g. S01E01 - Pilot" className="w-full bg-black/50 border border-white/10 p-2 text-white text-sm rounded outline-none focus:border-[#E50914] transition" />
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-gray-400 text-[10px] uppercase mb-1 font-semibold tracking-wider">480p URL</label>
                              <input type="url" value={p.download480p} onChange={(e) => handleUpdatePart(sIdx, pIdx, 'download480p', e.target.value)} placeholder="URL" className="w-full bg-black/50 border border-white/10 p-2 text-white text-sm rounded outline-none focus:border-[#E50914] transition" />
                            </div>
                            <div>
                              <label className="block text-gray-400 text-[10px] uppercase mb-1 font-semibold tracking-wider">720p URL</label>
                              <input type="url" value={p.download720p} onChange={(e) => handleUpdatePart(sIdx, pIdx, 'download720p', e.target.value)} placeholder="URL" className="w-full bg-black/50 border border-white/10 p-2 text-white text-sm rounded outline-none focus:border-[#E50914] transition" />
                            </div>
                            <div>
                              <label className="block text-gray-400 text-[10px] uppercase mb-1 font-semibold tracking-wider">1080p URL</label>
                              <input type="url" value={p.download1080p} onChange={(e) => handleUpdatePart(sIdx, pIdx, 'download1080p', e.target.value)} placeholder="URL" className="w-full bg-black/50 border border-white/10 p-2 text-white text-sm rounded outline-none focus:border-[#E50914] transition" />
                            </div>
                          </div>
                        </div>
                      ))}
                      {s.parts.length === 0 && <div className="text-gray-500 text-xs italic">No episodes added yet.</div>}
                    </div>
                  ))}
                  {seasonsData.length === 0 && (
                    <div className="text-center p-6 border border-white/10 border-dashed rounded text-gray-500 text-sm">No seasons added yet. Click "+ Add Season" to begin.</div>
                  )}
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">480p Download URL</label>
                    <input 
                      type="url"
                      placeholder="https://your-authorized-link.com/480p"
                      value={link480}
                      onChange={e => setLink480(e.target.value)}
                      className="w-full bg-black/50 border border-white/10 rounded p-3 text-white focus:border-[#E50914] outline-none transition text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">720p Download URL</label>
                    <input 
                      type="url"
                      placeholder="https://your-authorized-link.com/720p"
                      value={link720}
                      onChange={e => setLink720(e.target.value)}
                      className="w-full bg-black/50 border border-white/10 rounded p-3 text-white focus:border-[#E50914] outline-none transition text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">1080p Download URL</label>
                    <input 
                      type="url"
                      placeholder="https://your-authorized-link.com/1080p"
                      value={link1080}
                      onChange={e => setLink1080(e.target.value)}
                      className="w-full bg-black/50 border border-white/10 rounded p-3 text-white focus:border-[#E50914] outline-none transition text-sm"
                    />
                  </div>
                </>
              )}

              <div className="mt-4">
                <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2">Custom Movie/Series Description (Optional)</label>
                <textarea 
                  placeholder="Enter custom description to override TMDB's default description..."
                  value={descriptionVal}
                  onChange={e => setDescriptionVal(e.target.value)}
                  rows={4}
                  className="w-full bg-black/50 border border-white/10 rounded p-3 text-white focus:border-[#E50914] outline-none transition text-sm resize-none"
                />
                <p className="text-gray-500 text-[10px] mt-1">If left empty, the default TMDB description will be shown to users.</p>
              </div>

              <div className="flex items-center gap-2.5 p-3 bg-white/5 border border-white/10 rounded-lg">
                <input
                  type="checkbox"
                  id="broadcastNotification"
                  checked={broadcastToAll}
                  onChange={(e) => setBroadcastToAll(e.target.checked)}
                  className="w-4 h-4 accent-[#E50914] cursor-pointer rounded"
                />
                <label htmlFor="broadcastNotification" className="text-xs text-gray-300 cursor-pointer select-none">
                  <span className="font-semibold text-white">Broadcast push notification to all subscribers</span>
                  <span className="block text-gray-400 text-[11px]">Send alert to all opted-in users immediately when saved</span>
                </label>
              </div>

              <div className="flex gap-2">
                <button 
                  type="submit"
                  className="flex-1 py-3 bg-[#E50914] hover:bg-[#b80710] text-white rounded font-bold transition text-sm flex items-center justify-center gap-2 focus:outline-none"
                >
                  <Save className="w-4 h-4" /> Save Configuration
                </button>
                <button 
                  type="button"
                  onClick={() => setSelectedMovie(null)}
                  className="py-3 px-6 bg-white/10 hover:bg-white/20 text-white rounded font-bold transition text-sm focus:outline-none"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="border border-dashed border-white/10 rounded-lg p-8 text-center text-gray-500">
              <Film className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Search and select a movie above to configure download links.</p>
            </div>
          )}
        </div>

        {/* Right Active Configurations Panel */}
        <div className="w-full md:w-[350px] border-t md:border-t-0 md:border-l border-white/10 pt-6 md:pt-0 md:pl-6 flex flex-col">
          <div className="mb-4">
            <h3 className="font-extrabold text-white text-lg">Configured Downloads</h3>
            <p className="text-gray-400 text-xs">Total configured: {activeDbList.length}</p>
          </div>

          <input
            type="text"
            placeholder="Search movies..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="w-full bg-[#1a1a1a] border border-white/10 rounded-lg px-4 py-2 text-white text-sm outline-none focus:border-[#E50914] transition mb-3"
          />

          <div className="flex gap-2 mb-3 flex-wrap">
            <button
              onClick={() => setQualityFilter('all')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition ${qualityFilter === 'all' ? 'bg-[#E50914] text-white' : 'bg-[#2a2a2a] text-gray-400 hover:text-white'}`}
            >
              All Movies
            </button>
            <button
              onClick={() => setQualityFilter('missing1080p')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition ${qualityFilter === 'missing1080p' ? 'bg-[#E50914] text-white' : 'bg-[#2a2a2a] text-gray-400 hover:text-white'}`}
            >
              Missing 1080p
            </button>
            <button
              onClick={() => setQualityFilter('missing720p')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition ${qualityFilter === 'missing720p' ? 'bg-[#E50914] text-white' : 'bg-[#2a2a2a] text-gray-400 hover:text-white'}`}
            >
              Missing 720p
            </button>
            <button
              onClick={() => setQualityFilter('complete')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition ${qualityFilter === 'complete' ? 'bg-green-600 text-white' : 'bg-[#2a2a2a] text-gray-400 hover:text-white'}`}
            >
              ✓ Complete
            </button>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[350px] md:max-h-[500px] space-y-3 pr-2">
            {isLoadingList ? (
              <p className="text-gray-500 text-xs">Loading downloads database...</p>
            ) : filteredSavedMovies.length === 0 ? (
              <p className="text-gray-500 text-xs">No movies match your filters.</p>
            ) : (
              filteredSavedMovies.map(item => (
                <div key={item.id} className="flex items-center justify-between bg-[#1a1a1a] rounded-lg px-3 py-2 mb-2 group hover:bg-[#242424] transition border border-white/5">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate" title={item.title}>
                      {item.title}
                    </p>
                    <div className="flex gap-1 mt-1">
                      {item.download480p && item.download480p !== '#' && (
                        <span className="text-[10px] bg-green-900/50 text-green-400 px-1.5 py-0.5 rounded">480p</span>
                      )}
                      {item.download720p && item.download720p !== '#' && (
                        <span className="text-[10px] bg-blue-900/50 text-blue-400 px-1.5 py-0.5 rounded">720p</span>
                      )}
                      {item.download1080p && item.download1080p !== '#' && (
                        <span className="text-[10px] bg-purple-900/50 text-purple-400 px-1.5 py-0.5 rounded">1080p</span>
                      )}
                    </div>
                    <div className="text-[9px] text-gray-500 mt-1.5 font-medium">
                      Uploaded: {(() => { const ts = item.created_at || item.updated_at; if (!ts) return 'N/A'; const d = new Date(ts); if (isNaN(d.getTime())) return 'N/A'; const h = d.getHours(); const ampm = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 || 12; return `${d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })} ${String(h12).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}.${String(d.getMilliseconds()).padStart(3,'0')} ${ampm}`; })()}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-2">
                    <button
                      onClick={() => handleEditItem(item)}
                      className="w-7 h-7 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white flex items-center justify-center transition"
                      title="Edit"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDelete(item.id, item.title)}
                      className="w-7 h-7 rounded-lg bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white flex items-center justify-center transition"
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
