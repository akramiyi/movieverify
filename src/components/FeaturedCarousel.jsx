import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Plus, Info, Play } from 'lucide-react';
import { fetchTMDBDetails } from '../hooks/useTMDB';
import ImageWithFallback from './ImageWithFallback';

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

  return (
    <div className="relative w-full h-[80vh] md:h-[90vh] overflow-hidden bg-background">
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
            />
          </motion.div>
          
          {/* Netflix signature dark gradients */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/40 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#141414] via-[#141414]/50 to-transparent w-full md:w-[70%]" />

          {/* Content */}
          <div className="absolute inset-0 flex flex-col justify-end px-4 md:px-16 pb-20 md:pb-32">
            <motion.div 
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5, duration: 0.8 }}
              className="max-w-2xl"
            >
              {/* Fake Netflix Series/Movie badge */}
              <div className="flex items-center gap-2 mb-4">
                <div className="flex items-center text-primary font-bold tracking-widest text-sm md:text-base">
                  <span className="mr-1">N</span>
                  <span className="text-gray-300 text-xs tracking-[0.2em]">FILM</span>
                </div>
              </div>
              
              <h1 className="text-5xl md:text-7xl font-extrabold text-white mb-6 uppercase tracking-tight drop-shadow-2xl">
                {currentMovie.title}
              </h1>

              {/* Tags */}
              <div className="flex items-center gap-3 text-sm md:text-base font-semibold text-white mb-6 drop-shadow-md">
                <span className="text-green-500">{Math.round(currentMovie.rating * 10)}% Match</span>
                <span>{currentMovie.year}</span>
                <span className="border border-white/40 px-1 rounded text-xs">{currentMovie.quality}</span>
                <span>{currentMovie.genre.split(',')[0]}</span>
              </div>
              
              <p className="text-gray-200 text-sm md:text-lg mb-8 max-w-xl line-clamp-3 md:line-clamp-4 drop-shadow-md font-medium">
                {currentMovie.description}
              </p>

              <div className="flex flex-wrap items-center gap-4">
                <button 
                  onClick={() => onPlayTrailer(currentMovie)}
                  className="px-6 md:px-8 py-2 md:py-3 bg-white text-black rounded font-bold transition-all hover:bg-white/80 flex items-center gap-2 text-base md:text-xl"
                >
                  <Download className="w-6 h-6 stroke-[3]" />
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
                  className="px-6 md:px-8 py-2 md:py-3 bg-[#6d6d6eb3] hover:bg-[#6d6d6e66] text-white rounded font-bold transition-all flex items-center gap-2 text-base md:text-xl"
                >
                  <Play className="w-6 h-6 fill-current" />
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
