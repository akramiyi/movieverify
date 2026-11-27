import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Play, Plus, Check, Info, ChevronLeft, ChevronRight, Volume2, VolumeX } from 'lucide-react';
import { fetchTMDBDetails } from '../hooks/useTMDB';
import TrailerModal from './TrailerModal';
import { getHeroBackdropSources } from '../utils/imageOptimization';

const getMatchPercent = (rating) => {
  const num = parseFloat(rating);
  return isNaN(num) ? '98%' : `${Math.round(num * 10)}% Match`;
};

const getTitleClass = (title = '') => {
  const len = (title || '').length;
  if (len > 35) {
    return 'text-2xl sm:text-3xl md:text-4xl lg:text-5xl';
  }
  if (len > 22) {
    return 'text-3xl sm:text-4xl md:text-5xl lg:text-6xl';
  }
  return 'text-4xl sm:text-5xl md:text-6xl lg:text-7xl';
};

// Clean YouTube video key extractor
const extractYouTubeKey = (urlOrKey) => {
  if (!urlOrKey || typeof urlOrKey !== 'string') return null;
  const trimmed = urlOrKey.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return match ? match[1] : null;
};

const FeaturedCarousel = ({
  movies,
  onPlayTrailer,
  onSelectMovie,
  myList = [],
  onToggleMyList = () => {},
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [activeTrailerModal, setActiveTrailerModal] = useState(null);
  const [trailerKeys, setTrailerKeys] = useState({}); // Cache movie_id -> youtubeKey
  const [isMuted, setIsMuted] = useState(true);
  const [videoReady, setVideoReady] = useState(false);

  const touchStartX = useRef(0);
  const touchEndX = useRef(0);
  const pauseTimeoutRef = useRef(null);

  const totalMovies = movies && Array.isArray(movies) ? movies.length : 0;
  const safeIndex = totalMovies > 0 ? (currentIndex % totalMovies) : 0;
  const currentMovie = totalMovies > 0 ? movies[safeIndex] : null;

  const isInMyList = currentMovie
    ? myList.some((m) => String(m.id).split('-')[0] === String(currentMovie.id).split('-')[0])
    : false;

  // Safe pause with auto-resume on interaction
  const pauseTemporarily = useCallback((durationMs = 9000) => {
    setIsPaused(true);
    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
    }
    pauseTimeoutRef.current = setTimeout(() => {
      setIsPaused(false);
    }, durationMs);
  }, []);

  useEffect(() => {
    return () => {
      if (pauseTimeoutRef.current) clearTimeout(pauseTimeoutRef.current);
    };
  }, []);

  // Reset video ready state on slide transition
  useEffect(() => {
    setVideoReady(false);
  }, [safeIndex]);

  // Keep index within bounds
  useEffect(() => {
    if (totalMovies > 0 && currentIndex >= totalMovies) {
      setCurrentIndex(0);
    }
  }, [totalMovies, currentIndex]);

  // Tab visibility wakeup
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setIsPaused(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Fetch YouTube trailer dynamically from TMDB or object
  useEffect(() => {
    if (!currentMovie || !currentMovie.id) return;

    const movieId = String(currentMovie.id);
    if (trailerKeys[movieId] !== undefined) return;

    let isCancelled = false;
    const loadTrailer = async () => {
      try {
        if (currentMovie.trailerUrl && currentMovie.trailerUrl !== '#') {
          const directKey = extractYouTubeKey(currentMovie.trailerUrl);
          if (directKey) {
            if (!isCancelled) {
              setTrailerKeys((prev) => ({ ...prev, [movieId]: directKey }));
            }
            return;
          }
        }

        const details = await fetchTMDBDetails(currentMovie.id, currentMovie.mediaType || currentMovie.media_type);
        if (isCancelled) return;

        const resolvedKey = extractYouTubeKey(details?.trailerUrl);
        setTrailerKeys((prev) => ({ ...prev, [movieId]: resolvedKey || null }));
      } catch {
        if (!isCancelled) {
          setTrailerKeys((prev) => ({ ...prev, [movieId]: null }));
        }
      }
    };

    loadTrailer();
    return () => {
      isCancelled = true;
    };
  }, [currentMovie?.id, currentMovie?.trailerUrl, currentMovie?.mediaType, trailerKeys]);

  // Preload next slide's backdrop
  useEffect(() => {
    if (totalMovies <= 1) return;
    const nextIdx = (safeIndex + 1) % totalMovies;
    const nextItem = movies[nextIdx];
    if (nextItem) {
      const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
      const sources = getHeroBackdropSources(nextItem);
      const targetSrc = isMobile ? sources.mobile : sources.desktop;
      if (targetSrc) {
        const img = new Image();
        img.src = targetSrc;
      }
    }
  }, [safeIndex, totalMovies, movies]);

  const handleNext = useCallback(() => {
    if (totalMovies <= 1) return;
    setCurrentIndex((prev) => (prev + 1) % totalMovies);
  }, [totalMovies]);

  const handlePrev = useCallback(() => {
    if (totalMovies <= 1) return;
    setCurrentIndex((prev) => (prev - 1 + totalMovies) % totalMovies);
  }, [totalMovies]);

  // Auto-rotation timer: 12 seconds per slide
  useEffect(() => {
    if (totalMovies <= 1 || isPaused) return;
    const timer = setInterval(() => {
      handleNext();
    }, 12000);
    return () => clearInterval(timer);
  }, [totalMovies, isPaused, handleNext]);

  // Mobile swipe gestures
  const handleTouchStart = (e) => {
    if (!e.touches || !e.touches[0]) return;
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = e.touches[0].clientX;
    pauseTemporarily(7000);
  };

  const handleTouchMove = (e) => {
    if (!e.touches || !e.touches[0]) return;
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (touchStartX.current && touchEndX.current) {
      const diff = touchStartX.current - touchEndX.current;
      if (Math.abs(diff) > 50) {
        if (diff > 0) handleNext();
        else handlePrev();
      }
    }
    pauseTemporarily(5000);
    touchStartX.current = 0;
    touchEndX.current = 0;
  };

  if (!currentMovie) return null;

  const heroSources = getHeroBackdropSources(currentMovie);
  const currentTrailerKey = currentMovie?.id ? trailerKeys[String(currentMovie.id)] : null;

  const isTvSeries = Boolean(
    currentMovie.mediaType === 'tv' ||
    currentMovie.media_type === 'tv' ||
    currentMovie.isTv ||
    (currentMovie.genre && currentMovie.genre.toLowerCase().includes('series')) ||
    (currentMovie.seasons && currentMovie.seasons.length > 0)
  );

  const backdropImageUrl = heroSources.desktop || heroSources.mobile || currentMovie.backdrop || currentMovie.poster;

  return (
    <div
      className="relative w-full h-[85vh] min-h-[600px] md:h-[92vh] md:min-h-[680px] max-h-[920px] overflow-hidden bg-black select-none group"
      onMouseEnter={() => pauseTemporarily(12000)}
      onMouseLeave={() => {
        if (pauseTimeoutRef.current) clearTimeout(pauseTimeoutRef.current);
        setIsPaused(false);
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* 1. CINEMATIC FULL-SCREEN VIDEO & BACKDROP CONTAINER (PRIME VIDEO STYLE) */}
      <AnimatePresence mode="sync" initial={false}>
        <motion.div
          key={`hero-slide-${safeIndex}-${currentMovie.id || currentMovie.title}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.0, ease: 'easeInOut' }}
          className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none"
        >
          {/* Base Layer: High-Res Backdrop Image with Subtle Ken Burns Zoom */}
          <motion.img
            src={backdropImageUrl}
            alt=""
            aria-hidden="true"
            loading="eager"
            fetchpriority="high"
            decoding="async"
            initial={{ scale: 1.0 }}
            animate={{ scale: currentTrailerKey ? 1.0 : 1.05 }}
            transition={{ duration: 10, ease: 'easeOut' }}
            className="absolute inset-0 w-full h-full object-cover object-center transform-gpu"
          />

          {/* Video Layer: Full-screen looping YouTube background scene */}
          {currentTrailerKey && (
            <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none flex items-center justify-center">
              {/* Scaled & 16:9 padded wrapper to ensure full edge-to-edge coverage and crop YouTube branding */}
              <iframe
                key={`bg-video-${safeIndex}-${currentTrailerKey}`}
                src={`https://www.youtube-nocookie.com/embed/${currentTrailerKey}?autoplay=1&mute=${isMuted ? 1 : 0}&loop=1&playlist=${currentTrailerKey}&controls=0&showinfo=0&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&playsinline=1&enablejsapi=1&origin=${typeof window !== 'undefined' ? window.location.origin : ''}`}
                title="Cinematic Background Video"
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                onLoad={() => setVideoReady(true)}
                className={`w-[140vw] h-[140vh] min-w-[100%] min-h-[100%] max-w-none pointer-events-none transition-opacity duration-1000 transform-gpu ${
                  videoReady ? 'opacity-90' : 'opacity-0'
                }`}
                style={{
                  objectFit: 'cover',
                }}
              />
            </div>
          )}

          {/* 4. EXACT AMAZON PRIME VIDEO GRADIENT OVERLAYS */}
          {/* Heavy black-to-transparent gradient on the left for maximum text readability */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/75 to-transparent w-full md:w-[65%] lg:w-[55%] z-10 pointer-events-none" />

          {/* Secondary subtle full-screen base tint to avoid harsh high-key scenes */}
          <div className="absolute inset-0 bg-black/25 z-10 pointer-events-none" />

          {/* Cinematic bottom gradient fading seamlessly into catalog rows */}
          <div className="absolute bottom-0 inset-x-0 h-40 bg-gradient-to-t from-[#141414] via-[#141414]/80 to-transparent z-10 pointer-events-none" />
        </motion.div>
      </AnimatePresence>

      {/* 2. FOREGROUND CONTENT & PRIME VIDEO ACTION BUTTONS */}
      <div className="relative z-20 w-full h-full max-w-7xl mx-auto px-4 sm:px-8 md:px-12 flex flex-col justify-end pb-20 sm:pb-24 md:pb-28">
        <AnimatePresence mode="wait">
          <motion.div
            key={`hero-meta-${safeIndex}-${currentMovie.id}`}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-xl md:max-w-2xl space-y-3 sm:space-y-4"
          >
            {/* Prime Video Badge & Series Flag */}
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded text-[11px] font-extrabold uppercase tracking-widest bg-[#00A8E1] text-black shadow-md">
                Prime Video
              </span>
              <span className="text-gray-300 text-xs font-semibold tracking-wider uppercase">
                {isTvSeries ? 'Series' : 'Feature Film'}
              </span>
            </div>

            {/* Movie Title */}
            <h1
              className={`font-black text-white uppercase tracking-tight leading-[1.05] ${getTitleClass(currentMovie.title)} drop-shadow-[0_4px_16px_rgba(0,0,0,0.95)]`}
            >
              {currentMovie.title}
            </h1>

            {/* Metadata Badges (Match %, Year, Quality, Genre) */}
            <div className="flex items-center gap-3 text-xs sm:text-sm font-semibold text-gray-200 flex-wrap drop-shadow-md">
              <span className="text-[#46d369] font-bold">{getMatchPercent(currentMovie.rating)}</span>
              <span>{currentMovie.year || '2026'}</span>
              <span className="border border-white/40 px-1.5 py-0.5 rounded text-[11px] font-bold bg-white/10 backdrop-blur-xs">
                {currentMovie.quality || '1080p'}
              </span>
              <span className="text-gray-300">{(currentMovie.genre || 'Action').split(',')[0]}</span>
            </div>

            {/* Description */}
            <p className="text-gray-200 text-xs sm:text-sm md:text-base line-clamp-3 font-normal leading-relaxed text-shadow max-w-xl drop-shadow-lg">
              {currentMovie.description || 'Watch now with high-speed verified stream and download options.'}
            </p>

            {/* 3. PRIME VIDEO STYLE ACTION BUTTONS */}
            <div className="flex flex-wrap items-center gap-3 pt-2 sm:pt-4">
              {/* Primary Button: Watch Now / Download */}
              <button
                type="button"
                onClick={() => {
                  if (onPlayTrailer) onPlayTrailer(currentMovie);
                  else if (onSelectMovie) onSelectMovie(currentMovie);
                }}
                className="px-6 py-2.5 sm:px-7 sm:py-3 bg-white hover:bg-white/90 text-black font-extrabold rounded-md transition-all flex items-center gap-2 text-sm sm:text-base active:scale-95 shadow-2xl cursor-pointer"
              >
                <Download className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
                <span>Download</span>
              </button>

              {/* Secondary Button: Trailer Modal Trigger */}
              <button
                type="button"
                onClick={async () => {
                  if (currentTrailerKey) {
                    setActiveTrailerModal({
                      url: `https://www.youtube.com/watch?v=${currentTrailerKey}`,
                      title: currentMovie.title,
                    });
                  } else if (currentMovie.trailerUrl && currentMovie.trailerUrl !== '#') {
                    setActiveTrailerModal({ url: currentMovie.trailerUrl, title: currentMovie.title });
                  } else {
                    const res = await fetchTMDBDetails(currentMovie.id, currentMovie.mediaType);
                    if (res?.trailerUrl) {
                      setActiveTrailerModal({ url: res.trailerUrl, title: currentMovie.title });
                    } else {
                      alert('Trailer not available for this title.');
                    }
                  }
                }}
                className="px-5 py-2.5 sm:px-6 sm:py-3 bg-white/20 hover:bg-white/30 text-white font-bold rounded-md transition-all flex items-center gap-2 text-sm sm:text-base backdrop-blur-md active:scale-95 cursor-pointer border border-white/10"
              >
                <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-current" />
                <span>Trailer</span>
              </button>

              {/* Add to List Icon Button (+) */}
              <button
                type="button"
                onClick={() => onToggleMyList(currentMovie)}
                className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center transition-all border cursor-pointer active:scale-90 shadow-lg ${
                  isInMyList
                    ? 'bg-[#00A8E1] border-[#00A8E1] text-black'
                    : 'bg-black/40 hover:bg-black/60 border-white/30 text-white hover:border-white'
                }`}
                title={isInMyList ? 'Remove from Watchlist' : 'Add to Watchlist'}
                aria-label={isInMyList ? 'Remove from Watchlist' : 'Add to Watchlist'}
              >
                {isInMyList ? (
                  <Check className="w-5 h-5 stroke-[2.5]" />
                ) : (
                  <Plus className="w-5 h-5 stroke-[2.5]" />
                )}
              </button>

              {/* Info Icon Button (i) */}
              <button
                type="button"
                onClick={() => {
                  if (onSelectMovie) onSelectMovie(currentMovie);
                  else if (onPlayTrailer) onPlayTrailer(currentMovie);
                }}
                className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-black/40 hover:bg-black/60 border border-white/30 hover:border-white text-white flex items-center justify-center transition-all cursor-pointer active:scale-90 shadow-lg"
                title="More Details"
                aria-label="More Details"
              >
                <Info className="w-5 h-5" />
              </button>

              {/* Video Audio Mute / Unmute Button (When Trailer is playing) */}
              {currentTrailerKey && (
                <button
                  type="button"
                  onClick={() => setIsMuted((prev) => !prev)}
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-black/40 hover:bg-black/60 border border-white/30 hover:border-white text-white flex items-center justify-center transition-all cursor-pointer active:scale-90 shadow-lg ml-auto md:ml-2"
                  title={isMuted ? 'Unmute background trailer' : 'Mute background trailer'}
                  aria-label="Toggle background trailer audio"
                >
                  {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5 text-[#00A8E1]" />}
                </button>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Hero Slide Indicator Pills (Bottom Right) */}
      {totalMovies > 1 && (
        <div className="absolute bottom-6 right-4 sm:right-8 md:right-12 z-30 flex items-center gap-1.5 sm:gap-2">
          {movies.slice(0, 8).map((_, idx) => (
            <button
              key={`dot-${idx}`}
              onClick={() => {
                setCurrentIndex(idx);
                pauseTemporarily(9000);
              }}
              className={`transition-all duration-300 rounded-full cursor-pointer ${
                safeIndex === idx
                  ? 'w-7 sm:w-9 h-1.5 bg-[#00A8E1] shadow-[0_0_12px_rgba(0,168,225,0.8)]'
                  : 'w-2 h-1.5 bg-white/30 hover:bg-white/70'
              }`}
              title={`Go to slide ${idx + 1}`}
              aria-label={`Go to slide ${idx + 1}`}
            />
          ))}
        </div>
      )}

      {/* Desktop Previous / Next Navigation Arrows */}
      {totalMovies > 1 && (
        <>
          <button
            type="button"
            onClick={() => {
              handlePrev();
              pauseTemporarily(9000);
            }}
            className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 z-30 w-11 h-11 items-center justify-center rounded-full bg-black/50 hover:bg-black/80 text-white/80 hover:text-white backdrop-blur-md border border-white/10 opacity-0 group-hover:opacity-100 transition-all duration-300 active:scale-90 cursor-pointer shadow-2xl"
            title="Previous Featured Title"
            aria-label="Previous Featured Title"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            type="button"
            onClick={() => {
              handleNext();
              pauseTemporarily(9000);
            }}
            className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 z-30 w-11 h-11 items-center justify-center rounded-full bg-black/50 hover:bg-black/80 text-white/80 hover:text-white backdrop-blur-md border border-white/10 opacity-0 group-hover:opacity-100 transition-all duration-300 active:scale-90 cursor-pointer shadow-2xl"
            title="Next Featured Title"
            aria-label="Next Featured Title"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </>
      )}

      {/* Full-Screen Cinema Trailer Modal */}
      <TrailerModal
        isOpen={Boolean(activeTrailerModal)}
        onClose={() => setActiveTrailerModal(null)}
        trailerUrl={activeTrailerModal?.url}
        movieTitle={activeTrailerModal?.title}
      />
    </div>
  );
};

export default FeaturedCarousel;
