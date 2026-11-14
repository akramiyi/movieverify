import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Play,
  Plus,
  ThumbsUp,
  Download,
  Check,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  ExternalLink,
  Sparkles,
  Bell,
  BellRing,
  LogIn,
} from 'lucide-react';
import { movies } from '../data/movies';
import { fetchTMDBDetails, getDownloadLinks, getMediaTypeFromId } from '../hooks/useTMDB';
import ImageWithFallback from './ImageWithFallback';
import ReportProblemButton from './ReportProblemButton';
import ShareButton from './ShareButton';
import ReviewSection from './ReviewSection';
import { useSubscriptions } from '../hooks/useSubscriptions';

const getMatchPercent = (rating) => {
  const num = parseFloat(rating);
  return isNaN(num) ? 'N/A' : `${Math.round(num * 10)}%`;
};

const MovieDetailsModal = ({ movie, isOpen, isLoading = false, onClose, myList = [], onToggleMyList, onSelectMovie, onDownloadTracked, onRequireAuth }) => {
  const {
    isAuthenticated,
    isLoading: isSubUpdating,
    toggleMovieNotify,
    isMovieNotifying,
  } = useSubscriptions();
  const notifying = movie ? isMovieNotifying(movie) : false;
  const [notifyFeedback, setNotifyFeedback] = useState(null);
  const [downloadingState, setDownloadingState] = useState(null);
  const [isLiked, setIsLiked] = useState(false);
  const downloadTimerRef = useRef([]);
  const [details, setDetails] = useState({
    cast: 'Placeholder Actor 1, Placeholder Actor 2, Placeholder Actor 3',
    trailerUrl: '',
    runtime: null,
    backdrop: null,
    poster: null,
    title: null,
  });

  const clearDownloadTimers = () => {
    downloadTimerRef.current.forEach((t) => clearTimeout(t));
    downloadTimerRef.current = [];
  };

  useEffect(() => {
    return () => {
      clearDownloadTimers();
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      clearDownloadTimers();
      setDownloadingState(null);
    }
  }, [isOpen, movie?.id]);

  // Prevent background scroll bleed when modal is open
  useEffect(() => {
    if (!isOpen) return;

    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyOverflowY = document.body.style.overflowY;
    const prevHtmlOverflow = document.documentElement.style.overflow;

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.overflowY = 'hidden';

    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.overflowY = prevBodyOverflowY;
    };
  }, [isOpen]);

  useEffect(() => {
    setNotifyFeedback(null);
    setIsLiked(false);
  }, [movie?.id, isAuthenticated]);

  const liveLinks = movie ? getDownloadLinks(movie.id, movie.title) : {};
  const download480p = liveLinks.download480p || movie?.download480p;
  const download720p = liveLinks.download720p || movie?.download720p;
  const download1080p = liveLinks.download1080p || movie?.download1080p;
  const seasons = liveLinks.seasons || movie?.seasons;

  const idStr = movie ? String(movie.id) : '';
  const parsedId = movie ? parseInt(idStr.split('-')[0], 10) : NaN;
  const resolvedMediaType = movie ? (
    movie.mediaType ||
    movie.media_type ||
    (idStr.includes('-tv') ? 'tv' : null) ||
    (idStr.includes('-movie') ? 'movie' : null) ||
    (movie.seasons && movie.seasons.length > 0 ? 'tv' : null) ||
    (movie.first_air_date ? 'tv' : null) ||
    (movie.genre && (movie.genre.toLowerCase().includes('web series') || movie.genre.toLowerCase().includes('tv series')) ? 'tv' : null) ||
    getMediaTypeFromId(parsedId) ||
    (movie.release_date ? 'movie' : null) ||
    null
  ) : null;

  useEffect(() => {
    if (movie && movie.id) {
      if (!isNaN(parsedId) && resolvedMediaType) {
        fetchTMDBDetails(parsedId, resolvedMediaType).then((res) => {
          setDetails({
            cast: res.cast || movie.cast || 'Placeholder Actor 1, Placeholder Actor 2, Placeholder Actor 3',
            trailerUrl: res.trailerUrl || movie.trailerUrl || '',
            runtime: res.runtime || movie.runtime || null,
            backdrop: res.backdrop || movie.backdrop || null,
            poster: res.poster || movie.poster || null,
            title: res.title || null,
          });
        });
      } else {
        setDetails({
          cast: movie.cast || 'Placeholder Actor 1, Placeholder Actor 2, Placeholder Actor 3',
          trailerUrl: movie.trailerUrl || '',
          runtime: movie.runtime || null,
          backdrop: movie.backdrop || null,
          poster: movie.poster || null,
          title: movie.title || null,
        });
      }
    }
  }, [movie, parsedId, resolvedMediaType]);

  if (isLoading && !movie) {
    return (
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[1050] flex items-center justify-center p-4 overflow-y-auto"
          >
            <div className="fixed inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-md bg-[#181818] rounded-2xl shadow-2xl z-10 p-8 flex flex-col items-center justify-center border border-white/10 text-center"
            >
              <button
                onClick={onClose}
                className="absolute top-4 right-4 z-50 w-8 h-8 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-gray-300 hover:text-white transition cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="w-12 h-12 border-4 border-[#E50914] border-t-transparent rounded-full animate-spin mb-4" />
              <h3 className="text-white text-lg font-bold">Loading Title Details...</h3>
              <p className="text-gray-400 text-xs mt-1">Retrieving official TMDB information</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  if (!movie) return null;

  const isAddedToList = myList.some((m) => m.id === movie.id);
  const cleanTitle = (details.title || movie.title || '')
    .replace(/^(🎬|📺|🔥|✨)\s*/, '')
    .replace(/\s+is Now Available!.*$/i, '')
    .replace(/\s+Links Updated.*$/i, '')
    .replace(/\s+Series Added!.*$/i, '')
    .replace(/\s+—\s+Season\s+\d+\s+Out Now!.*$/i, '')
    .trim() || movie.title;

  // Get similar movies based on genre intersection (excluding current movie itself)
  const similarMovies = movies
    .filter(m => m.id !== movie.id && (m.genre || '').split(',').some(g => (movie.genre || '').includes(g.trim())))
    .slice(0, 3);

  const handleDownload = (quality, link, customLabel, size) => {
    if (!link || link === '#') {
      alert(`${quality} download link is not available yet.`);
      return;
    }

    if (downloadingState) return;

    clearDownloadTimers();

    const targetSize = size || (quality === '480p' ? '~500 MB' : quality === '720p' ? '~1.2 GB' : quality === '1080p' ? '~2.5 GB' : 'High Speed');
    const targetLabel = customLabel || movie?.title || 'Title';

    setDownloadingState({
      quality,
      link,
      label: targetLabel,
      size: targetSize,
      progress: 25,
      statusText: 'Connecting to high-speed CDN server...',
      isComplete: false,
    });

    const t1 = setTimeout(() => {
      setDownloadingState((prev) =>
        prev ? { ...prev, progress: 65, statusText: 'Verifying link security & high-speed token...' } : null
      );
    }, 600);

    const t2 = setTimeout(() => {
      setDownloadingState((prev) =>
        prev ? { ...prev, progress: 92, statusText: 'Generating verified download link...' } : null
      );
    }, 1200);

    const t3 = setTimeout(() => {
      setDownloadingState((prev) =>
        prev ? { ...prev, progress: 100, statusText: 'Link verified! Redirecting to download...', isComplete: true } : null
      );

      if (onDownloadTracked) {
        onDownloadTracked(movie?.title || targetLabel, quality);
      }

      try {
        const opened = window.open(link, '_blank', 'noopener,noreferrer');
        if (!opened || opened.closed || typeof opened.closed === 'undefined') {
          window.location.assign(link);
        }
      } catch {
        window.location.href = link;
      }

      const t4 = setTimeout(() => {
        setDownloadingState(null);
      }, 800);
      downloadTimerRef.current.push(t4);
    }, 1800);

    downloadTimerRef.current.push(t1, t2, t3);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[1050] flex items-center justify-center p-4 md:p-0 md:pt-10 overflow-y-auto overscroll-contain"
        >
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

          {/* Modal Container */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative w-full max-w-4xl bg-[#181818] rounded-xl shadow-2xl z-10 my-8 max-h-[90vh] flex flex-col overflow-hidden overscroll-contain"
          >
            {/* Close Button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 z-50 w-10 h-10 bg-[#181818]/60 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-gray-800 transition shadow-lg border border-white/10"
            >
              <X className="w-6 h-6" />
            </button>

            {/* Scrollable Content Wrapper */}
            <div className="overflow-y-auto overscroll-contain flex-1 hide-scrollbar">
              {/* Top Banner Area */}
              <div className="relative w-full aspect-video sm:h-[300px] md:h-[440px] flex-none overflow-hidden">
                <ImageWithFallback
                  src={movie.backdrop || details.backdrop}
                  backdropSrc={movie.poster || details.poster}
                  alt={cleanTitle}
                  className={`w-full h-full object-cover ${movie.title?.toLowerCase().includes('pushpa') ? 'object-bottom' : 'object-top'}`}
                />
                {/* Bottom and side gradients for seamless blend */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-[#181818]/40 to-transparent pointer-events-none" />
                <div className="hidden md:block absolute inset-0 bg-gradient-to-r from-[#181818]/80 via-[#181818]/30 to-transparent w-2/3 pointer-events-none" />

                {/* Desktop Hero Overlay (Only on md+ screens where space permits) */}
                <div className="hidden md:block absolute bottom-8 left-8 right-8 z-10">
                  <h2 className="text-3xl md:text-4xl lg:text-5xl font-black text-white mb-4 drop-shadow-md max-w-2xl leading-tight">
                    {cleanTitle}
                  </h2>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        document.getElementById('download-options')?.scrollIntoView({ behavior: 'smooth' });
                      }}
                      className="flex items-center gap-2 bg-white hover:bg-white/90 active:scale-95 text-black px-6 py-2.5 rounded-lg text-base font-bold transition shadow-lg cursor-pointer"
                    >
                      <Download className="w-5 h-5 stroke-[2.5]" />
                      <span>Download</span>
                    </button>
                    {details.trailerUrl && (
                      <button
                        type="button"
                        onClick={() => window.open(details.trailerUrl, '_blank')}
                        className="flex items-center gap-2 bg-white/20 hover:bg-white/30 active:scale-95 text-white px-5 py-2.5 rounded-lg text-base font-semibold backdrop-blur-md transition border border-white/10 cursor-pointer"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        <span>Watch Trailer</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onToggleMyList(movie)}
                      className="w-10 h-10 border border-white/20 bg-black/40 hover:bg-white/20 hover:border-white rounded-full flex items-center justify-center text-white backdrop-blur-md transition cursor-pointer"
                      title={isAddedToList ? 'Remove from My List' : 'Add to My List'}
                    >
                      {isAddedToList ? <Check className="w-5 h-5 text-green-400" /> : <Plus className="w-5 h-5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsLiked(!isLiked)}
                      className="w-10 h-10 border border-white/20 bg-black/40 hover:bg-white/20 hover:border-white rounded-full flex items-center justify-center text-white backdrop-blur-md transition cursor-pointer"
                      title="I like this"
                    >
                      <ThumbsUp className={`w-4 h-4 ${isLiked ? 'text-red-500 fill-current' : ''}`} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Mobile Movie Header & Action Bar (Cleanly displayed below the backdrop so the photo is 100% visible) */}
              <div className="block md:hidden px-4 sm:px-6 pt-3 pb-2 space-y-3">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-black text-white leading-tight">
                    {cleanTitle}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold mt-1.5 text-gray-300">
                    <span className="text-green-400 font-bold bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">
                      {getMatchPercent(movie.rating)} Match
                    </span>
                    <span className="text-gray-300">{movie.year}</span>
                    <span className="border border-white/20 text-gray-300 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase">
                      {movie.quality}
                    </span>
                    {details.runtime && (
                      <span className="text-gray-400">{details.runtime}</span>
                    )}
                  </div>
                </div>

                {/* Mobile Action Buttons */}
                <div className="flex flex-col gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      document.getElementById('download-options')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="w-full flex items-center justify-center gap-2 bg-white hover:bg-white/90 active:scale-[0.99] text-black py-2.5 px-4 rounded-lg font-bold text-sm shadow-md transition cursor-pointer"
                  >
                    <Download className="w-4 h-4 stroke-[2.5]" />
                    <span>Download</span>
                  </button>

                  <div className="flex items-center gap-2">
                    {details.trailerUrl && (
                      <button
                        type="button"
                        onClick={() => window.open(details.trailerUrl, '_blank')}
                        className="flex-1 flex items-center justify-center gap-2 bg-white/15 hover:bg-white/25 active:scale-[0.99] text-white py-2 px-3 rounded-lg font-semibold text-xs border border-white/10 transition cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Watch Trailer</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onToggleMyList(movie)}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-xs font-medium border border-white/10 transition cursor-pointer"
                      title={isAddedToList ? 'Remove from My List' : 'Add to My List'}
                    >
                      {isAddedToList ? <Check className="w-4 h-4 text-green-400" /> : <Plus className="w-4 h-4" />}
                      <span>{isAddedToList ? 'Listed' : 'My List'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsLiked(!isLiked)}
                      className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white border border-white/10 transition cursor-pointer"
                      title="I like this"
                    >
                      <ThumbsUp className={`w-4 h-4 ${isLiked ? 'text-red-500 fill-current' : ''}`} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Details Section */}
              <div className="p-4 sm:p-6 md:p-8 lg:p-10 grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 text-white">
                <div className="md:col-span-2">
                  <div className="hidden md:flex items-center gap-3 text-sm font-semibold mb-4">
                    <span className="text-green-500">{getMatchPercent(movie.rating)} Match</span>
                    <span className="text-gray-300">{movie.year}</span>
                    <span className="border border-gray-500 text-gray-300 px-1 rounded text-xs">{movie.quality}</span>
                    {details.runtime && <span className="text-gray-400">{details.runtime}</span>}
                  </div>
                  <p className="text-gray-200 leading-relaxed text-sm md:text-base lg:text-lg mb-6 md:mb-8">
                    {movie.description}
                </p>

                {/* Download Options */}
                <div>
                  <h3 id="download-options" className="text-xl font-bold text-white mb-4">Download Options</h3>
                  {(() => {
                    const hasAnySeasonLinks =
                      Array.isArray(seasons) &&
                      seasons.some(
                        (s) => Array.isArray(s.parts) && s.parts.some((p) => p.download480p || p.download720p || p.download1080p)
                      );
                    const hasAnyMovieLinks = Boolean(download480p || download720p || download1080p);

                    if (hasAnySeasonLinks) {
                      return (
                        <div className="flex flex-col gap-4">
                          {/* Dedicated Futuristic Download Generation Progress Banner for Series */}
                          <AnimatePresence>
                            {downloadingState && (
                              <motion.div
                                initial={{ opacity: 0, y: -10, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                                className="p-4 rounded-xl bg-gradient-to-r from-[#1f1212] via-[#241a1a] to-[#181818] border border-[#E50914]/40 shadow-[0_0_25px_rgba(229,9,20,0.2)]"
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    {downloadingState.isComplete ? (
                                      <CheckCircle2 className="w-5 h-5 text-green-500 animate-bounce" />
                                    ) : (
                                      <Loader2 className="w-5 h-5 text-[#E50914] animate-spin" />
                                    )}
                                    <span className="text-sm font-bold text-white tracking-wide">
                                      {downloadingState.isComplete
                                        ? 'Download Ready! Redirecting...'
                                        : 'Preparing High-Speed Download...'}
                                    </span>
                                  </div>
                                  <span className="bg-[#E50914] text-white text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                                    {downloadingState.quality}
                                  </span>
                                </div>

                                <div className="flex items-center justify-between text-xs text-gray-400 mb-2 font-medium">
                                  <span className="truncate max-w-[200px] sm:max-w-xs text-gray-300">
                                    {downloadingState.label}
                                  </span>
                                  <span className="font-mono text-[11px] text-gray-400">
                                    High Speed CDN
                                  </span>
                                </div>

                                <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden relative mb-2">
                                  <motion.div
                                    className="h-full bg-gradient-to-r from-[#E50914] via-red-500 to-amber-500 rounded-full"
                                    initial={{ width: '0%' }}
                                    animate={{ width: `${downloadingState.progress}%` }}
                                    transition={{ ease: 'easeInOut', duration: 0.4 }}
                                  />
                                </div>

                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-gray-300 flex items-center gap-1.5">
                                    <ShieldCheck className="w-3.5 h-3.5 text-green-400" />
                                    {downloadingState.statusText}
                                  </span>
                                  <span className="font-mono font-bold text-white">
                                    {downloadingState.progress}%
                                  </span>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          {seasons.map((s, idx) => {
                            const hasAnySeasonLink = s.parts.some(p => p.download480p || p.download720p || p.download1080p);
                            if (!hasAnySeasonLink) return null;

                            return (
                              <div key={idx} className="bg-[#242424] p-4 rounded-lg">
                                <h4 className="font-bold text-gray-300 mb-3">Season {s.season}</h4>
                                <div className="flex flex-col gap-2">
                                  {s.parts.map((part, pIdx) => (
                                    <div key={pIdx} className="flex flex-col sm:flex-row justify-between items-center bg-[#181818] p-3 rounded">
                                      <span>{part.name}</span>
                                      <div className="flex gap-2 mt-2 sm:mt-0">
                                        {part.download480p && (
                                          <button
                                            type="button"
                                            disabled={Boolean(downloadingState)}
                                            onClick={() => handleDownload('480p', part.download480p, `${part.name} (480p)`)}
                                            className="px-3 py-1 bg-[#333] hover:bg-primary rounded text-sm transition disabled:opacity-50 cursor-pointer"
                                          >
                                            {downloadingState?.quality === '480p' && downloadingState?.label?.includes(part.name) ? 'Preparing...' : '480p'}
                                          </button>
                                        )}
                                        {part.download720p && (
                                          <button
                                            type="button"
                                            disabled={Boolean(downloadingState)}
                                            onClick={() => handleDownload('720p', part.download720p, `${part.name} (720p)`)}
                                            className="px-3 py-1 bg-[#333] hover:bg-primary rounded text-sm transition disabled:opacity-50 cursor-pointer"
                                          >
                                            {downloadingState?.quality === '720p' && downloadingState?.label?.includes(part.name) ? 'Preparing...' : '720p'}
                                          </button>
                                        )}
                                        {part.download1080p && (
                                          <button
                                            type="button"
                                            disabled={Boolean(downloadingState)}
                                            onClick={() => handleDownload('1080p', part.download1080p, `${part.name} (1080p)`)}
                                            className="px-3 py-1 bg-[#333] hover:bg-primary rounded text-sm transition disabled:opacity-50 cursor-pointer"
                                          >
                                            {downloadingState?.quality === '1080p' && downloadingState?.label?.includes(part.name) ? 'Preparing...' : '1080p'}
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }

                    if (hasAnyMovieLinks) {
                      return (
                        <div className="flex flex-col gap-3">
                          {/* Dedicated Futuristic Download Generation Progress Banner */}
                          <AnimatePresence>
                            {downloadingState && (
                              <motion.div
                                initial={{ opacity: 0, y: -10, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                                className="p-4 rounded-xl bg-gradient-to-r from-[#1f1212] via-[#241a1a] to-[#181818] border border-[#E50914]/40 shadow-[0_0_25px_rgba(229,9,20,0.2)]"
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    {downloadingState.isComplete ? (
                                      <CheckCircle2 className="w-5 h-5 text-green-500 animate-bounce" />
                                    ) : (
                                      <Loader2 className="w-5 h-5 text-[#E50914] animate-spin" />
                                    )}
                                    <span className="text-sm font-bold text-white tracking-wide">
                                      {downloadingState.isComplete
                                        ? 'Download Ready! Redirecting...'
                                        : 'Preparing High-Speed Download...'}
                                    </span>
                                  </div>
                                  <span className="bg-[#E50914] text-white text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                                    {downloadingState.quality}
                                  </span>
                                </div>

                                <div className="flex items-center justify-between text-xs text-gray-400 mb-2 font-medium">
                                  <span className="truncate max-w-[200px] sm:max-w-xs text-gray-300">
                                    {downloadingState.label}
                                  </span>
                                  <span className="font-mono text-[11px] text-gray-400">
                                    {downloadingState.size} • High Speed CDN
                                  </span>
                                </div>

                                {/* Progress Bar */}
                                <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden relative mb-2">
                                  <motion.div
                                    className="h-full bg-gradient-to-r from-[#E50914] via-red-500 to-amber-500 rounded-full"
                                    initial={{ width: '0%' }}
                                    animate={{ width: `${downloadingState.progress}%` }}
                                    transition={{ ease: 'easeInOut', duration: 0.4 }}
                                  />
                                </div>

                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-gray-300 flex items-center gap-1.5">
                                    <ShieldCheck className="w-3.5 h-3.5 text-green-400" />
                                    {downloadingState.statusText}
                                  </span>
                                  <span className="font-mono font-bold text-white">
                                    {downloadingState.progress}%
                                  </span>
                                </div>

                                <div className="mt-2 text-right">
                                  <a
                                    href={downloadingState.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => {
                                      if (onDownloadTracked) onDownloadTracked(movie.title, downloadingState.quality);
                                    }}
                                    className="text-[10px] text-gray-400 hover:text-white underline inline-flex items-center gap-1"
                                  >
                                    Click here if redirect does not start <ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          <div className="grid grid-cols-3 gap-4">
                            {download480p && (
                              <button
                                type="button"
                                disabled={Boolean(downloadingState)}
                                onClick={() => handleDownload('480p', download480p, `${movie.title} (480p)`, '~500 MB')}
                                className={`flex flex-col items-center p-4 bg-[#242424] hover:bg-[#333] rounded-lg transition relative overflow-hidden ${
                                  downloadingState?.quality === '480p' ? 'ring-2 ring-[#E50914] bg-[#E50914]/10' : ''
                                } disabled:opacity-60 cursor-pointer`}
                              >
                                {downloadingState?.quality === '480p' ? (
                                  <div className="flex flex-col items-center justify-center py-0.5">
                                    <Loader2 className="w-5 h-5 text-[#E50914] animate-spin mb-1" />
                                    <span className="text-xs font-bold text-white">Preparing...</span>
                                  </div>
                                ) : (
                                  <>
                                    <span className="text-lg font-bold">480p</span>
                                    <span className="text-xs text-gray-400 mt-1">~500 MB</span>
                                  </>
                                )}
                              </button>
                            )}
                            {download720p && (
                              <button
                                type="button"
                                disabled={Boolean(downloadingState)}
                                onClick={() => handleDownload('720p', download720p, `${movie.title} (720p)`, '~1.2 GB')}
                                className={`flex flex-col items-center p-4 bg-[#242424] hover:bg-primary rounded-lg transition relative overflow-hidden ${
                                  downloadingState?.quality === '720p' ? 'ring-2 ring-[#E50914] bg-[#E50914]/10' : ''
                                } disabled:opacity-60 cursor-pointer`}
                              >
                                {downloadingState?.quality === '720p' ? (
                                  <div className="flex flex-col items-center justify-center py-0.5">
                                    <Loader2 className="w-5 h-5 text-[#E50914] animate-spin mb-1" />
                                    <span className="text-xs font-bold text-white">Preparing...</span>
                                  </div>
                                ) : (
                                  <>
                                    <span className="text-lg font-bold">720p</span>
                                    <span className="text-xs text-white/70 mt-1">~1.2 GB</span>
                                  </>
                                )}
                              </button>
                            )}
                            {download1080p && (
                              <button
                                type="button"
                                disabled={Boolean(downloadingState)}
                                onClick={() => handleDownload('1080p', download1080p, `${movie.title} (1080p)`, '~2.5 GB')}
                                className={`flex flex-col items-center p-4 bg-[#242424] hover:bg-[#333] rounded-lg transition relative overflow-hidden ${
                                  downloadingState?.quality === '1080p' ? 'ring-2 ring-[#E50914] bg-[#E50914]/10' : ''
                                } disabled:opacity-60 cursor-pointer`}
                              >
                                {downloadingState?.quality === '1080p' ? (
                                  <div className="flex flex-col items-center justify-center py-0.5">
                                    <Loader2 className="w-5 h-5 text-[#E50914] animate-spin mb-1" />
                                    <span className="text-xs font-bold text-white">Preparing...</span>
                                  </div>
                                ) : (
                                  <>
                                    <span className="text-lg font-bold">1080p</span>
                                    <span className="text-xs text-gray-400 mt-1">~2.5 GB</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    }

                    const handleNotifyClick = async () => {
                      if (!isAuthenticated) {
                        setNotifyFeedback({
                          type: 'auth',
                          message: 'Please sign in with Google to save release alerts to your account.',
                        });
                        return;
                      }
                      setNotifyFeedback(null);
                      const result = await toggleMovieNotify({
                        ...movie,
                        mediaType: resolvedMediaType,
                        media_type: resolvedMediaType,
                      });
                      if (result?.requiresAuth) {
                        setNotifyFeedback({
                          type: 'auth',
                          message: 'Please sign in with Google to save release alerts to your account.',
                        });
                      } else if (!result?.success) {
                        setNotifyFeedback({
                          type: 'error',
                          message: result?.error || 'Could not update alert subscription.',
                        });
                      } else {
                        setNotifyFeedback({
                          type: 'success',
                          message: result.subscribed
                            ? 'Release alert saved to your account.'
                            : 'Release alert removed.',
                        });
                      }
                    };

                    return (
                      <div className="py-2 space-y-3">
                        <p className="text-gray-400 text-sm">Download links unavailable yet</p>
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            disabled={isSubUpdating}
                            onClick={handleNotifyClick}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition cursor-pointer disabled:opacity-50 ${
                              isAuthenticated && notifying
                                ? 'bg-[#E50914]/20 text-[#E50914] border border-[#E50914]'
                                : 'bg-[#242424] text-gray-300 hover:bg-[#333]'
                            }`}
                          >
                            {isAuthenticated && notifying ? <BellRing className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                            {isAuthenticated && notifying ? "You'll be notified" : 'Notify Me When Available'}
                          </button>

                          {!isAuthenticated && (
                            <button
                              type="button"
                              onClick={() => onRequireAuth && onRequireAuth()}
                              data-testid="notify-signin-btn"
                              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-[#E50914] hover:bg-[#b80710] text-white transition cursor-pointer"
                            >
                              <LogIn className="w-3.5 h-3.5" />
                              Sign In to Notify
                            </button>
                          )}
                        </div>

                        {(!isAuthenticated || notifyFeedback?.type === 'auth') && (
                          <div
                            data-testid="notify-signin-prompt"
                            className="p-3 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-300 flex items-center justify-between gap-3"
                          >
                            <span>
                              {notifyFeedback?.message || 'Sign in to save release notifications and sync alerts across your devices.'}
                            </span>
                            {onRequireAuth && (
                              <button
                                type="button"
                                onClick={onRequireAuth}
                                className="shrink-0 text-[#E50914] hover:underline font-bold cursor-pointer"
                              >
                                Sign In
                              </button>
                            )}
                          </div>
                        )}

                        {notifyFeedback && notifyFeedback.type !== 'auth' && (
                          <p
                            className={`text-xs ${
                              notifyFeedback.type === 'error' ? 'text-rose-400' : 'text-emerald-400'
                            }`}
                          >
                            {notifyFeedback.message}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div className="flex items-center gap-8 mt-4 pb-6 border-b border-white/10">
                  <ReportProblemButton
                    movieId={movie.id}
                    movieTitle={movie.title}
                  />
                  <ShareButton
                    movieId={movie.id}
                    movieTitle={movie.title}
                    mediaType={resolvedMediaType}
                    movie={{
                      ...movie,
                      mediaType: resolvedMediaType || movie.mediaType || null,
                      media_type: resolvedMediaType || movie.media_type || null
                    }}
                  />
                </div>
                <ReviewSection
                  movieId={movie.id}
                  movieTitle={movie.title}
                />
              </div>

              {/* Cast & Info Column */}
              <div className="text-sm text-gray-400">
                <div className="mb-4">
                  <span className="text-gray-500">Cast: </span>
                  <span className="text-gray-300">{details.cast}</span>
                </div>
                <div className="mb-4">
                  <span className="text-gray-500">Genres: </span>
                  <span className="hover:underline cursor-pointer">{movie.genre}</span>
                </div>
                <div className="mb-4">
                  <span className="text-gray-500">Language: </span>
                  <span className="hover:underline cursor-pointer">{movie.language}</span>
                </div>
              </div>
            </div>

            {/* Similar Movies Section */}
            <div className="px-4 sm:px-6 md:px-8 lg:px-10 pb-10">
              <h3 className="text-2xl font-bold text-white mb-6">More Like This</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {similarMovies.map((simMovie) => (
                  <div
                    key={simMovie.id}
                    onClick={() => onSelectMovie && onSelectMovie(simMovie)}
                    className="bg-[#242424] rounded-lg overflow-hidden group cursor-pointer"
                  >
                    <div className="relative aspect-video">
                      <ImageWithFallback
                        src={simMovie.backdrop}
                        backdropSrc={simMovie.poster}
                        alt={simMovie.title}
                        lazy={true}
                        className={`w-full h-full object-cover ${simMovie.title.toLowerCase().includes('pushpa') ? 'object-bottom' : 'object-top'}`}
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                         <Play className="w-10 h-10 text-white fill-current" />
                      </div>
                    </div>
                    <div className="p-4 text-white">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-green-500 text-xs font-bold">{getMatchPercent(simMovie.rating)} Match</span>
                        <span className="border border-gray-500 text-gray-300 px-1 rounded text-[10px] uppercase">{simMovie.quality}</span>
                      </div>
                      <p className="text-sm font-bold truncate mb-1">{simMovie.title}</p>
                      <p className="text-xs text-gray-400 line-clamp-3">
                        {simMovie.description}
                      </p>
                    </div>
                  </div>
                ))}
                {similarMovies.length === 0 && (
                  <p className="text-gray-400 col-span-full text-sm">No similar titles found.</p>
                )}
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
      )}
    </AnimatePresence>
  );
};

export default MovieDetailsModal;
