import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Play, ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchTMDBDetails } from '../hooks/useTMDB';
import ImageWithFallback from './ImageWithFallback';

const getMatchPercent = (rating) => {
  const num = parseFloat(rating);
  return isNaN(num) ? 'N/A' : `${Math.round(num * 10)}%`;
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

const FeaturedCarousel = ({ movies, onPlayTrailer }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);
  const pauseTimeoutRef = useRef(null);

  const totalMovies = movies && Array.isArray(movies) ? movies.length : 0;
  // Safe clamped index to completely prevent out-of-bounds undefined errors
  const safeIndex = totalMovies > 0 ? (currentIndex % totalMovies) : 0;
  const currentMovie = totalMovies > 0 ? movies[safeIndex] : null;

  // Safe temporary pause with guaranteed auto-resume to prevent permanent freeze on mobile
  const pauseTemporarily = useCallback((durationMs = 5000) => {
    setIsPaused(true);
    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
    }
    pauseTimeoutRef.current = setTimeout(() => {
      setIsPaused(false);
    }, durationMs);
  }, []);

  // Cleanup pause timeout on unmount
  useEffect(() => {
    return () => {
      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
      }
    };
  }, []);

  // Keep index within valid bounds if movies array updates
  useEffect(() => {
    if (totalMovies > 0 && currentIndex >= totalMovies) {
      setCurrentIndex(0);
    }
  }, [totalMovies, currentIndex]);

  // Wake up timer immediately on tab visibility / phone unlock
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setIsPaused(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Preload next movie's high-res backdrop and poster to eliminate blank box / image pop flash
  useEffect(() => {
    if (totalMovies <= 1) return;
    const nextIdx = (safeIndex + 1) % totalMovies;
    const nextItem = movies[nextIdx];
    if (nextItem) {
      const bannerSrc = nextItem.original_backdrop || nextItem.backdrop || nextItem.original_poster || nextItem.poster;
      if (bannerSrc) {
        const img = new Image();
        img.src = bannerSrc;
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

  // Auto-rotation timer: pauses on hover/touch so user isn't interrupted while clicking
  useEffect(() => {
    if (totalMovies <= 1 || isPaused) return;
    const timer = setInterval(() => {
      handleNext();
    }, 7000);
    return () => clearInterval(timer);
  }, [totalMovies, isPaused, handleNext]);

  // Touch gesture support for mobile swiping with tap-protection and auto-unpause
  const handleTouchStart = (e) => {
    if (!e.touches || !e.touches[0]) return;
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = e.touches[0].clientX; // initialize to same coordinate to prevent accidental tap jumps
    pauseTemporarily(6000);
  };

  const handleTouchMove = (e) => {
    if (!e.touches || !e.touches[0]) return;
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (touchStartX.current && touchEndX.current) {
      const diff = touchStartX.current - touchEndX.current;
      if (Math.abs(diff) > 50) {
        if (diff > 0) {
          handleNext();
        } else {
          handlePrev();
        }
      }
    }
    // Always auto-resume rotation after mobile touch ends
    pauseTemporarily(4000);
    touchStartX.current = 0;
    touchEndX.current = 0;
  };

  if (!currentMovie) return null;

  const isTvSeries = Boolean(
    currentMovie.mediaType === 'tv' ||
    currentMovie.media_type === 'tv' ||
    currentMovie.isTv ||
    (currentMovie.genre && currentMovie.genre.toLowerCase().includes('series')) ||
    (currentMovie.seasons && currentMovie.seasons.length > 0)
  );

  return (
    <div 
      className="relative w-full h-[80vh] min-h-[580px] md:h-[88vh] md:min-h-[640px] max-h-[860px] overflow-hidden bg-[#141414] select-none group"
      onMouseEnter={() => pauseTemporarily(7000)}
      onMouseLeave={() => {
        if (pauseTimeoutRef.current) clearTimeout(pauseTimeoutRef.current);
        setIsPaused(false);
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <AnimatePresence mode="sync" initial={false}>
        <motion.div
          key={`hero-slide-${safeIndex}-${currentMovie.id || currentMovie.title}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: 'easeInOut' }}
          className="absolute inset-0 w-full h-full"
        >
          {/* Backdrop Image with smooth, cinematic Ken Burns zoom (NO sideways jump or black edge gap) */}
          <motion.div
            initial={{ scale: 1.05 }}
            animate={{ scale: 1.0 }}
            transition={{ duration: 7.5, ease: 'easeOut' }}
            className="absolute inset-0 w-full h-full"
          >
            <ImageWithFallback 
              className="w-full h-full object-cover object-center"
              src={currentMovie.original_backdrop || currentMovie.backdrop || currentMovie.original_poster || currentMovie.poster}
              backdropSrc={currentMovie.backdrop || currentMovie.original_poster || currentMovie.poster}
              alt={currentMovie.title}
              lazy={false}
              priority={true}
              shouldLoad={true}
            />
          </motion.div>
          
          {/* Netflix signature dark gradients */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/85 via-transparent to-transparent pointer-events-none z-10" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/60 to-transparent pointer-events-none z-10" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#141414] via-[#141414]/70 to-transparent w-full md:w-[75%] pointer-events-none z-10" />

          {/* Content with elegant vertical entrance (NO conflicting sideways stutter) */}
          <div className="absolute inset-0 flex flex-col justify-end px-4 sm:px-8 md:px-16 pt-24 sm:pt-28 md:pt-32 pb-16 sm:pb-20 md:pb-24 z-20 pointer-events-none">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="max-w-2xl lg:max-w-3xl w-full pointer-events-auto"
            >
              {/* Fake Netflix Series/Movie badge */}
              <div className="flex items-center gap-2 mb-3">
                <div className="flex items-center text-primary font-bold tracking-widest text-sm md:text-base">
                  <span className="mr-1">N</span>
                  <span className="text-gray-300 text-xs tracking-[0.2em]">{isTvSeries ? 'SERIES' : 'FILM'}</span>
                </div>
              </div>
              
              <h1 className={`font-black text-white mb-3 sm:mb-4 uppercase tracking-tight drop-shadow-[0_4px_20px_rgba(0,0,0,0.95)] leading-[1.08] ${getTitleClass(currentMovie.title)}`}>
                {currentMovie.title}
              </h1>

              {/* Tags */}
              <div className="flex items-center gap-3 text-xs sm:text-sm md:text-base font-semibold text-white mb-4 drop-shadow-md flex-wrap">
                <span className="text-green-500 font-bold">{getMatchPercent(currentMovie.rating)} Match</span>
                <span>{currentMovie.year}</span>
                <span className="border border-white/40 px-1.5 py-0.5 rounded text-xs">{currentMovie.quality}</span>
                <span>{(currentMovie.genre || 'N/A').split(',')[0]}</span>
              </div>
              
              <p className="text-gray-200 text-xs sm:text-sm md:text-base mb-6 max-w-xl line-clamp-2 sm:line-clamp-3 md:line-clamp-3 drop-shadow-md font-medium leading-relaxed">
                {currentMovie.description}
              </p>

              <div className="flex flex-wrap items-center gap-3 md:gap-4 relative z-50 mt-2">
                <button 
                  onClick={() => onPlayTrailer(currentMovie)}
                  className="px-6 md:px-8 py-2 md:py-3 bg-white hover:bg-white/90 text-black rounded font-bold transition-all flex items-center gap-2 text-sm sm:text-base md:text-lg active:scale-95 shadow-lg cursor-pointer"
                >
                  <Download className="w-5 h-5 sm:w-6 sm:h-6 stroke-[3]" />
                  Download
                </button>
                <button 
                  onClick={async () => {
                    if (currentMovie.trailerUrl && currentMovie.trailerUrl !== '#') {
                      window.open(currentMovie.trailerUrl, '_blank');
                    } else if (currentMovie.id) {
                      const res = await fetchTMDBDetails(currentMovie.id, currentMovie.mediaType);
                      if (res.trailerUrl) {
                        window.open(res.trailerUrl, '_blank');
                      } else {
                        alert('Trailer link is not available yet.');
                      }
                    } else {
                      alert('Trailer link is not available yet.');
                    }
                  }}
                  className="px-6 md:px-8 py-2 md:py-3 bg-[#6d6d6eb3] hover:bg-[#6d6d6e66] text-white rounded font-bold transition-all flex items-center gap-2 text-sm sm:text-base md:text-lg cursor-pointer active:scale-95"
                >
                  <Play className="w-5 h-5 sm:w-6 sm:h-6 fill-current" />
                  Trailer
                </button>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </AnimatePresence>
      
      {/* Interactive Hero Slide Indicator Pills (Bottom Right) */}
      {totalMovies > 1 && (
        <div className="absolute bottom-6 right-4 sm:right-8 md:right-16 z-30 flex items-center gap-1.5 sm:gap-2">
          {movies.slice(0, 8).map((_, idx) => (
            <button
              key={`dot-${idx}`}
              onClick={() => {
                setCurrentIndex(idx);
                pauseTemporarily(7000);
              }}
              className={`transition-all duration-300 rounded-full cursor-pointer ${
                safeIndex === idx
                  ? 'w-6 sm:w-8 h-1.5 bg-[#E50914] shadow-[0_0_12px_rgba(229,9,20,0.8)]'
                  : 'w-1.5 sm:w-2 h-1.5 sm:h-2 bg-white/40 hover:bg-white/80'
              }`}
              title={`Go to slide ${idx + 1}`}
              aria-label={`Go to slide ${idx + 1}`}
            />
          ))}
        </div>
      )}

      {/* Desktop Previous / Next Navigation Arrows on Hover */}
      {totalMovies > 1 && (
        <>
          <button
            type="button"
            onClick={() => {
              handlePrev();
              pauseTemporarily(7000);
            }}
            className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 z-30 w-11 h-11 items-center justify-center rounded-full bg-black/40 hover:bg-black/70 text-white/80 hover:text-white backdrop-blur-md border border-white/10 opacity-0 group-hover:opacity-100 transition-all duration-300 active:scale-90 cursor-pointer shadow-xl"
            title="Previous Featured Title"
            aria-label="Previous Featured Title"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            type="button"
            onClick={() => {
              handleNext();
              pauseTemporarily(7000);
            }}
            className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 z-30 w-11 h-11 items-center justify-center rounded-full bg-black/40 hover:bg-black/70 text-white/80 hover:text-white backdrop-blur-md border border-white/10 opacity-0 group-hover:opacity-100 transition-all duration-300 active:scale-90 cursor-pointer shadow-xl"
            title="Next Featured Title"
            aria-label="Next Featured Title"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </>
      )}

      {/* Bottom fade into the rows */}
      <div className="absolute bottom-0 w-full h-32 bg-gradient-to-t from-[#141414] to-transparent z-10 pointer-events-none" />
    </div>
  );
};

export default FeaturedCarousel;
