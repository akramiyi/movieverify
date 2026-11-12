import React, { useState, useEffect } from 'react';
import { Lock, ShieldAlert, Clock, AlertTriangle } from 'lucide-react';

const MAX_CLIENT_ATTEMPTS = 5;
const DEFAULT_LOCKOUT_SECONDS = 15 * 60; // 15 minutes
const STORAGE_KEY_ATTEMPTS = 'movieverify_sitelock_attempts';
const STORAGE_KEY_BLOCKED_UNTIL = 'movieverify_sitelock_blocked_until';

const SiteLockScreen = ({ onUnlock }) => {
  const [keyInput, setKeyInput] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState(MAX_CLIENT_ATTEMPTS);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [countdownSeconds, setCountdownSeconds] = useState(0);

  // Initialize lockout state from localStorage on mount
  useEffect(() => {
    try {
      const storedBlockedUntil = parseInt(localStorage.getItem(STORAGE_KEY_BLOCKED_UNTIL) || '0', 10);
      const now = Date.now();
      if (storedBlockedUntil && storedBlockedUntil > now) {
        setBlockedUntil(storedBlockedUntil);
        setCountdownSeconds(Math.ceil((storedBlockedUntil - now) / 1000));
        setAttemptsRemaining(0);
      } else {
        const storedAttempts = parseInt(localStorage.getItem(STORAGE_KEY_ATTEMPTS) || '0', 10);
        setAttemptsRemaining(Math.max(0, MAX_CLIENT_ATTEMPTS - storedAttempts));
      }
    } catch {
      // Storage fallback
    }
  }, []);

  // Countdown timer effect
  useEffect(() => {
    if (!blockedUntil) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const diff = Math.ceil((blockedUntil - now) / 1000);

      if (diff <= 0) {
        setBlockedUntil(0);
        setCountdownSeconds(0);
        setAttemptsRemaining(MAX_CLIENT_ATTEMPTS);
        setError('');
        try {
          localStorage.removeItem(STORAGE_KEY_BLOCKED_UNTIL);
          localStorage.removeItem(STORAGE_KEY_ATTEMPTS);
        } catch {}
      } else {
        setCountdownSeconds(diff);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [blockedUntil]);

  const formatCountdown = (totalSeconds) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleUnlock = async (e) => {
    e.preventDefault();
    if (!keyInput.trim() || blockedUntil > Date.now()) return;

    setChecking(true);
    setError('');

    try {
      const res = await fetch('/api/site-lock/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password: keyInput.trim() })
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        // Clear lockout tracking
        try {
          localStorage.removeItem(STORAGE_KEY_BLOCKED_UNTIL);
          localStorage.removeItem(STORAGE_KEY_ATTEMPTS);
        } catch {}
        sessionStorage.setItem('movieverify_unlocked', 'true');
        onUnlock();
        return;
      }

      // Check for rate limit / reached limit (429 or 0 attempts remaining)
      if (res.status === 429 || data.attempts_remaining === 0) {
        const lockoutDuration = (data.retry_after_seconds || DEFAULT_LOCKOUT_SECONDS) * 1000;
        const lockUntilTimestamp = Date.now() + lockoutDuration;
        setBlockedUntil(lockUntilTimestamp);
        setCountdownSeconds(Math.ceil(lockoutDuration / 1000));
        setAttemptsRemaining(0);
        setError(data.error || 'Reached maximum attempt limit! Access temporarily blocked.');
        try {
          localStorage.setItem(STORAGE_KEY_BLOCKED_UNTIL, String(lockUntilTimestamp));
          localStorage.setItem(STORAGE_KEY_ATTEMPTS, String(MAX_CLIENT_ATTEMPTS));
        } catch {}
        return;
      }

      // Decrement attempts
      const remaining = typeof data.attempts_remaining === 'number'
        ? data.attempts_remaining
        : Math.max(0, attemptsRemaining - 1);

      setAttemptsRemaining(remaining);

      // Record in localStorage
      try {
        const currentFailed = MAX_CLIENT_ATTEMPTS - remaining;
        localStorage.setItem(STORAGE_KEY_ATTEMPTS, String(currentFailed));

        if (remaining <= 0) {
          const lockUntilTimestamp = Date.now() + DEFAULT_LOCKOUT_SECONDS * 1000;
          setBlockedUntil(lockUntilTimestamp);
          setCountdownSeconds(DEFAULT_LOCKOUT_SECONDS);
          localStorage.setItem(STORAGE_KEY_BLOCKED_UNTIL, String(lockUntilTimestamp));
          setError('Reached maximum attempt limit! Access temporarily blocked for 15 minutes.');
          return;
        }
      } catch {}

      setError(
        data.error ||
        `Incorrect access key. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
      );
    } catch {
      setError('Connection failed. Please check your network and try again.');
    } finally {
      setChecking(false);
    }
  };

  const isBlocked = blockedUntil > Date.now();

  return (
    <div className="fixed inset-0 z-[9999] bg-[#0a0a0a] flex items-center justify-center p-4 selection:bg-red-600 selection:text-white">
      <div className="w-full max-w-sm bg-[#141414] border border-white/10 rounded-xl p-8 text-center shadow-2xl relative overflow-hidden">
        {/* Top glowing bar */}
        <div
          className={`absolute top-0 left-0 right-0 h-1 ${
            isBlocked ? 'bg-amber-500 animate-pulse' : 'bg-[#E50914]'
          }`}
        />

        {/* Icon */}
        <div
          className={`w-14 h-14 border flex items-center justify-center rounded-full mb-4 mx-auto transition-colors ${
            isBlocked
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-500'
              : 'bg-[#E50914]/15 border-[#E50914]/40 text-[#E50914]'
          }`}
        >
          {isBlocked ? (
            <ShieldAlert className="w-6 h-6 animate-pulse" />
          ) : (
            <Lock className="w-6 h-6" />
          )}
        </div>

        {/* Title */}
        <h2 className="text-2xl font-black text-white mb-2 tracking-tight">
          {isBlocked ? 'Limit Reached' : 'Site Locked'}
        </h2>

        {/* Subtitle / Description */}
        <p className="text-gray-400 text-sm mb-6 leading-relaxed">
          {isBlocked ? (
            <span className="text-amber-400 font-medium">
              Too many failed attempts. Access is locked for security.
            </span>
          ) : (
            'This site is currently private. Enter the access key to continue.'
          )}
        </p>

        {/* Active Lockout Timer Card */}
        {isBlocked && (
          <div className="mb-6 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex items-center justify-center gap-2.5 text-amber-400 text-sm font-semibold">
            <Clock className="w-4 h-4 animate-spin" />
            <span>Try again in {formatCountdown(countdownSeconds)}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleUnlock} className="space-y-4">
          <div className="relative">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={isBlocked ? 'Locked due to limit' : 'Enter access key'}
              disabled={isBlocked || checking}
              className={`w-full bg-black/60 border rounded-lg p-3.5 text-white text-center outline-none transition text-sm ${
                isBlocked
                  ? 'border-amber-500/30 opacity-50 cursor-not-allowed text-gray-500'
                  : 'border-white/10 focus:border-[#E50914] focus:ring-1 focus:ring-[#E50914]'
              }`}
              required={!isBlocked}
            />
          </div>

          {/* Error & Attempts Badge */}
          {error && (
            <div className="space-y-1.5">
              <p className="text-red-400 text-xs flex items-center justify-center gap-1.5 font-medium">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{error}</span>
              </p>
              {!isBlocked && attemptsRemaining < MAX_CLIENT_ATTEMPTS && (
                <div className="inline-block px-2.5 py-0.5 rounded-full bg-red-950/40 border border-red-500/30 text-[11px] font-semibold text-red-300">
                  {attemptsRemaining} of {MAX_CLIENT_ATTEMPTS} attempts left
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={isBlocked || checking || !keyInput.trim()}
            className={`w-full py-3.5 rounded-lg font-bold transition text-sm flex items-center justify-center gap-2 ${
              isBlocked
                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-60'
                : 'bg-[#E50914] hover:bg-[#b80710] disabled:opacity-40 text-white shadow-lg shadow-red-900/20'
            }`}
          >
            {isBlocked
              ? `Blocked (${formatCountdown(countdownSeconds)})`
              : checking
              ? 'Verifying...'
              : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default SiteLockScreen;
