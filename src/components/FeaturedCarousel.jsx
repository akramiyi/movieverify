import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Plus, Info, Play } from 'lucide-react';
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

  useEffect(() => {
    if (!movies || movies.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % movies.length);
    }, 7000); // Netflix usually lingers a bit longer
    return () => clearInterval(timer);
  }, [movies]);

  if (!movies || movies.length === 0) return null;

  const currentMovie = movies[currentIndex];
  const isTvSeries = Boolean(
    currentMovie.mediaType === 'tv' ||
    currentMovie.media_type === 'tv' ||
    currentMovie.isTv ||
    (currentMovie.genre && currentMovie.genre.toLowerCase().includes('series')) ||
    (currentMovie.seasons && currentMovie.seasons.length > 0)
  );

  return (
    <div className="relative w-full h-[80vh] min-h-[580px] md:h-[88vh] md:min-h-[640px] max-h-[860px] overflow-hidden bg-[#141414]">
      <AnimatePresence initial={false}>
        <motion.div
          key={currentIndex}
          initial={{ opacity: 0, x: 80 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -80 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0"
        >
          {/* Backdrop Image with dynamic zoom effect */}
          <motion.div
            initial={{ scale: 1.08 }}
            animate={{ scale: 1.02 }}
            transition={{ duration: 6, ease: "easeOut" }}
            className="absolute inset-0 w-full h-full"
          >
            <ImageWithFallback 
              className="w-full h-full object-cover"
              src={currentMovie.backdrop}
              backdropSrc={currentMovie.poster}
              alt={currentMovie.title}
              lazy={false}
              priority={true}
              shouldLoad={true}
            />
          </motion.div>
          
          {/* Netflix signature dark gradients */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-transparent to-transparent pointer-events-none z-10" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/50 to-transparent pointer-events-none z-10" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#141414] via-[#141414]/60 to-transparent w-full md:w-[75%] pointer-events-none z-10" />

          {/* Content */}
          <div className="absolute inset-0 flex flex-col justify-end px-4 sm:px-8 md:px-16 pt-24 sm:pt-28 md:pt-32 pb-16 sm:pb-20 md:pb-24 z-20 pointer-events-none">
            <motion.div 
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5, duration: 0.8 }}
              className="max-w-2xl lg:max-w-3xl w-full pointer-events-auto"
            >
              {/* Fake Netflix Series/Movie badge */}
              <div className="flex items-center gap-2 mb-3">
                <div className="flex items-center text-primary font-bold tracking-widest text-sm md:text-base">
                  <span className="mr-1">N</span>
                  <span className="text-gray-300 text-xs tracking-[0.2em]">{isTvSeries ? 'SERIES' : 'FILM'}</span>
                </div>
              </div>
              
              <h1 className={`font-black text-white mb-3 sm:mb-4 uppercase tracking-tight drop-shadow-[0_4px_20px_rgba(0,0,0,0.9)] leading-[1.08] ${getTitleClass(currentMovie.title)}`}>
                {currentMovie.title}
              </h1>

              {/* Tags */}
              <div className="flex items-center gap-3 text-xs sm:text-sm md:text-base font-semibold text-white mb-4 drop-shadow-md">
                <span className="text-green-500">{getMatchPercent(currentMovie.rating)} Match</span>
                <span>{currentMovie.year}</span>
                <span className="border border-white/40 px-1 rounded text-xs">{currentMovie.quality}</span>
                <span>{(currentMovie.genre || 'N/A').split(',')[0]}</span>
              </div>
              
              <p className="text-gray-200 text-xs sm:text-sm md:text-base mb-6 max-w-xl line-clamp-2 sm:line-clamp-3 md:line-clamp-3 drop-shadow-md font-medium leading-relaxed">
                {currentMovie.description}
              </p>

              <div className="flex flex-wrap items-center gap-3 md:gap-4 relative z-50 mt-2">
                <button 
                  onClick={() => onPlayTrailer(currentMovie)}
                  className="px-6 md:px-8 py-2 md:py-3 bg-white text-black rounded font-bold transition-all hover:bg-white/80 flex items-center gap-2 text-sm sm:text-base md:text-lg active:scale-95 shadow-lg cursor-pointer"
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
                  className="px-6 md:px-8 py-2 md:py-3 bg-[#6d6d6eb3] hover:bg-[#6d6d6e66] text-white rounded font-bold transition-all flex items-center gap-2 text-sm sm:text-base md:text-lg cursor-pointer"
                >
                  <Play className="w-5 h-5 sm:w-6 sm:h-6 fill-current" />
                  Trailer
                </button>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </AnimatePresence>
      
      {/* Bottom fade into the rows */}
      <div className="absolute bottom-0 w-full h-32 bg-gradient-to-t from-[#141414] to-transparent z-10" />
    </div>
  );
};

export default FeaturedCarousel;
