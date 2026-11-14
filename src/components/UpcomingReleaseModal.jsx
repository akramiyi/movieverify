import React, { useState, useEffect } from 'react';
import {
  X,
  Calendar,
  Film,
  Play,
  Zap,
  Clock,
  CheckCircle2,
  Edit3,
  ArrowUpRight,
  Star,
  Users,
  Video,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import { fetchTMDBDetails } from '../hooks/useTMDB';

const getYouTubeKey = (url) => {
  if (!url) return null;
  const match = url.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/);
  return match ? match[1] : null;
};

export default function UpcomingReleaseModal({
  item,
  isOpen,
  onClose,
  onAutoSchedule,
  onCustomize,
  existingCampaign = null,
  isScheduling = false,
}) {
  const [details, setDetails] = useState({
    cast: '',
    trailerUrl: '',
    runtime: null,
    overview: '',
    backdrop: null,
    poster: null,
  });
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [isPlayingTrailer, setIsPlayingTrailer] = useState(false);

  useEffect(() => {
    if (!isOpen || !item) {
      setIsPlayingTrailer(false);
      return;
    }

    let isMounted = true;
    setLoadingDetails(true);

    const mType = item.media_type || (item.release_category?.includes('series') ? 'tv' : 'movie');

    fetchTMDBDetails(item.id, mType)
      .then((res) => {
        if (!isMounted) return;
        setDetails({
          cast: res?.cast || '',
          trailerUrl: res?.trailerUrl || '',
          runtime: res?.runtime || null,
          overview: res?.overview || item.overview || '',
          backdrop: res?.backdrop || item.backdrop || null,
          poster: res?.poster || item.poster || null,
        });
      })
      .catch((err) => {
        console.warn('Failed to load TMDB details in preview modal:', err.message);
      })
      .finally(() => {
        if (isMounted) setLoadingDetails(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, item]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !item) return null;

  const isTv = item.media_type === 'tv' || item.release_category?.includes('series');
  const youtubeKey = getYouTubeKey(details.trailerUrl);
  const hasTrailer = Boolean(youtubeKey);

  const displayBackdrop =
    details.backdrop ||
    item.backdrop ||
    (item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null) ||
    details.poster ||
    item.poster;

  const isAlreadyScheduled = Boolean(existingCampaign);
  const isAlreadySent =
    existingCampaign &&
    (existingCampaign.status === 'completed' ||
      ((existingCampaign.sent_count || 0) > 0 &&
        (existingCampaign.sent_count || 0) >= (existingCampaign.total_recipients || 1)));

  // Countdown calculation
  const getCountdown = (dateStr) => {
    if (!dateStr) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const relDate = new Date(dateStr + 'T00:00:00');
    const diffDays = Math.ceil((relDate - today) / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return { text: 'Releases Today!', isUrgent: true };
    if (diffDays === 1) return { text: 'Releases Tomorrow!', isUrgent: true };
    return { text: `Releases in ${diffDays} days`, isUrgent: false };
  };

  const countdown = getCountdown(item.release_date);

  return (
    <div
      className="fixed inset-0 z-[250] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl bg-[#141419]/95 border border-white/15 rounded-3xl overflow-hidden shadow-[0_25px_70px_rgba(0,0,0,0.85)] my-auto max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Media Banner */}
        <div className="relative aspect-video w-full bg-black shrink-0 overflow-hidden">
          {isPlayingTrailer && youtubeKey ? (
            <div className="relative w-full h-full">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${youtubeKey}?autoplay=1&rel=0`}
                title={`${item.title} Trailer`}
                className="w-full h-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
              <button
                type="button"
                onClick={() => setIsPlayingTrailer(false)}
                className="absolute top-3 left-3 px-3 py-1.5 rounded-full bg-black/80 hover:bg-black text-white text-xs font-semibold backdrop-blur-md border border-white/20 flex items-center gap-1.5 shadow-lg transition cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Close Video</span>
              </button>
            </div>
          ) : (
            <>
              {displayBackdrop ? (
                <img
                  src={displayBackdrop}
                  alt={item.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 bg-gradient-to-br from-white/10 to-white/0">
                  <Film className="w-12 h-12 mb-2 text-rose-500 opacity-60" />
                  <span className="text-sm font-semibold text-gray-400">{item.title}</span>
                </div>
              )}

              {/* Gradient Scrim */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#141419] via-[#141419]/40 to-transparent pointer-events-none" />

              {/* Floating Top Header Badges */}
              <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2 pointer-events-none">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full backdrop-blur-md bg-black/70 text-rose-400 border border-rose-500/30 shadow-md">
                    {item.industry_name || 'Release Radar'}
                  </span>
                  <span className="text-[11px] font-bold px-2 py-1 rounded-full backdrop-blur-md bg-black/70 text-gray-300 border border-white/15">
                    {isTv ? '📺 Web Series' : '🎬 Movie'}
                  </span>
                  {countdown && (
                    <span
                      className={`text-[11px] font-bold px-2.5 py-1 rounded-full backdrop-blur-md shadow-md ${
                        countdown.isUrgent
                          ? 'bg-rose-600 text-white animate-pulse font-black'
                          : 'bg-black/70 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      {countdown.text}
                    </span>
                  )}
                </div>
              </div>

              {/* Trailer Play Pill Button in Center of Banner */}
              {hasTrailer && (
                <button
                  type="button"
                  onClick={() => setIsPlayingTrailer(true)}
                  className="absolute inset-0 m-auto w-fit h-fit px-4 py-2.5 rounded-full bg-black/75 hover:bg-rose-600 text-white text-xs font-bold backdrop-blur-md border border-white/25 shadow-2xl flex items-center gap-2 transition hover:scale-105 active:scale-95 cursor-pointer group"
                >
                  <Play className="w-4 h-4 text-rose-500 group-hover:text-white fill-rose-500 group-hover:fill-white transition" />
                  <span>Watch Official Trailer</span>
                </button>
              )}
            </>
          )}

          {/* Close Modal Button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/75 hover:bg-white/20 text-gray-300 hover:text-white border border-white/20 backdrop-blur-md flex items-center justify-center transition cursor-pointer shadow-lg z-10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-5 sm:p-6 space-y-5 overflow-y-auto flex-1">
          {/* Title & Key Specs */}
          <div>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-xl sm:text-2xl font-black text-white leading-tight tracking-wide">
                {item.title}
              </h2>
              {item.vote_average > 0 && (
                <div className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 font-bold text-xs shrink-0">
                  <Star className="w-3.5 h-3.5 fill-amber-400" />
                  <span>{Number(item.vote_average).toFixed(1)}</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-400 font-medium">
              <span className="flex items-center gap-1.5 text-amber-300 font-mono">
                <Calendar className="w-3.5 h-3.5 text-amber-400" />
                <span>{item.release_date}</span>
              </span>
              {details.runtime && (
                <span className="flex items-center gap-1 text-gray-400">
                  <Clock className="w-3.5 h-3.5 text-gray-500" />
                  <span>{details.runtime} mins</span>
                </span>
              )}
              {item.original_lang_code && (
                <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 uppercase tracking-wider text-[10px] font-bold text-gray-300">
                  Lang: {item.original_lang_code}
                </span>
              )}
              <a
                href={`https://www.themoviedb.org/${isTv ? 'tv' : 'movie'}/${item.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-gray-500 hover:text-rose-400 transition flex items-center gap-1 text-[11px]"
                title="View on TMDB"
              >
                TMDB #{item.id} <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* Synopsis / Overview */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-bold text-gray-300 uppercase tracking-wider">
              Plot Synopsis
            </h4>
            <p className="text-gray-300 text-xs sm:text-sm leading-relaxed font-normal bg-white/[0.03] border border-white/5 rounded-2xl p-4">
              {details.overview || item.overview || (
                <span className="text-gray-500 italic">
                  Plot synopsis will be published closer to release date on TMDB.
                </span>
              )}
            </p>
          </div>

          {/* Cast Details */}
          {details.cast && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-rose-400" />
                <span>Starring Cast</span>
              </h4>
              <p className="text-xs text-gray-400 leading-relaxed bg-white/[0.03] border border-white/5 rounded-xl px-3.5 py-2.5">
                {details.cast}
              </p>
            </div>
          )}

          {/* Admin Campaign Actions Card */}
          <div className="bg-gradient-to-br from-rose-950/30 via-black/40 to-amber-950/30 border border-rose-500/25 rounded-2xl p-4 sm:p-5 space-y-3 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Admin Notification Dispatcher
                </h4>
              </div>
              {isAlreadyScheduled && (
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  ⏳ In Queue
                </span>
              )}
              {isAlreadySent && (
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  ✅ Sent
                </span>
              )}
            </div>

            <p className="text-xs text-gray-400 leading-relaxed">
              Dispatch a push notification to subscribers for this release. You can schedule it with 1-click for release day at 09:00 AM, or customize the title and target audience.
            </p>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
              {isAlreadySent ? (
                <div className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Notification Already Dispatched to Users</span>
                </div>
              ) : isAlreadyScheduled ? (
                <div className="flex-1 py-2.5 px-4 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-amber-400" />
                    <span>Scheduled in Queue for Release Day</span>
                  </span>
                  <span className="text-[10px] text-gray-400 font-normal font-mono">
                    9:00 AM
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onAutoSchedule(item)}
                  disabled={isScheduling}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white text-xs font-bold shadow-lg shadow-rose-600/20 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Zap className={`w-4 h-4 ${isScheduling ? 'animate-spin' : ''}`} />
                  <span>
                    {isScheduling ? 'Scheduling Notification...' : '⚡ 1-Click Auto-Schedule Alert'}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => onCustomize(item)}
                className="py-2.5 px-4 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] text-white text-xs font-bold border border-white/15 transition flex items-center justify-center gap-2 cursor-pointer"
                title="Open Campaign Dispatcher with this movie pre-filled"
              >
                <Edit3 className="w-3.5 h-3.5 text-amber-400" />
                <span>Customize & Send</span>
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-[#0d0d12]/90 border-t border-white/10 flex items-center justify-between text-xs text-gray-400">
          <span className="text-[11px]">
            Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white font-mono text-[10px]">ESC</kbd> to close
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition font-medium cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
