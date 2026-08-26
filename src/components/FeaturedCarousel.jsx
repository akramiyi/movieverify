import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Download, Star, ChevronLeft, ChevronRight } from 'lucide-react';

const FeaturedCarousel = ({ movies, onPlayTrailer, onDownload }) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!movies || movies.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % movies.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [movies]);

  if (!movies || movies.length === 0) return null;

  const currentMovie = movies[currentIndex];

  const nextSlide = () => {
    setCurrentIndex((prev) => (prev + 1) % movies.length);
  };

  const prevSlide = () => {
    setCurrentIndex((prev) => (prev - 1 + movies.length) % movies.length);
  };

  return (
    <div className="relative w-full h-[60vh] md:h-[80vh] overflow-hidden bg-black mt-20">
      <AnimatePresence initial={false}>
        <motion.div
          key={currentIndex}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1 }}
          className="absolute inset-0"
        >
          {/* Backdrop Image */}
          <div 
            className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-transform duration-[10000ms] ease-linear hover:scale-105 scale-100"
            style={{ 
              backgroundImage: `url(${currentMovie.backdrop})`,
            }}
          />
          
          {/* Gradients */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />

          {/* Content */}
          <div className="absolute inset-0 flex flex-col justify-end pb-20 md:pb-32 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="max-w-2xl"
            >
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className="px-3 py-1 bg-primary/20 text-primary border border-primary/30 rounded-full text-xs font-semibold backdrop-blur-md">
                  Featured
                </span>
                <span className="px-3 py-1 bg-white/10 text-white rounded-full text-xs font-semibold backdrop-blur-md">
                  {currentMovie.quality}
                </span>
                <span className="flex items-center gap-1 px-3 py-1 bg-white/10 text-white rounded-full text-xs font-semibold backdrop-blur-md">
                  <Star className="w-3 h-3 text-yellow-500 fill-current" />
                  {currentMovie.rating}
                </span>
                <span className="px-3 py-1 bg-white/10 text-white rounded-full text-xs font-semibold backdrop-blur-md">
                  {currentMovie.year}
                </span>
              </div>
              
              <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-4 leading-tight">
                {currentMovie.title}
              </h1>
              
              <p className="text-sm md:text-base text-gray-300 font-medium mb-4 flex items-center gap-2">
                <span>{currentMovie.genre}</span>
                <span className="w-1 h-1 rounded-full bg-gray-500"></span>
                <span>{currentMovie.language}</span>
              </p>

              <p className="text-gray-400 text-sm md:text-lg mb-8 max-w-xl line-clamp-3">
                {currentMovie.description}
              </p>

              <div className="flex flex-wrap items-center gap-4">
                <button 
                  onClick={() => onDownload(currentMovie)}
                  className="px-6 md:px-8 py-3 md:py-4 bg-primary hover:bg-primary/90 text-white rounded-xl font-semibold transition-all duration-300 flex items-center gap-2 group hover:shadow-[0_0_20px_rgba(59,130,246,0.4)]"
                >
                  <Download className="w-5 h-5 group-hover:-translate-y-1 transition-transform" />
                  Download Now
                </button>
                <button 
                  onClick={() => onPlayTrailer(currentMovie)}
                  className="px-6 md:px-8 py-3 md:py-4 bg-white/10 hover:bg-white/20 text-white rounded-xl font-semibold transition-all duration-300 flex items-center gap-2 backdrop-blur-md border border-white/10"
                >
                  <Play className="w-5 h-5 text-primary" />
                  Watch Trailer
                </button>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Navigation Controls */}
      {movies.length > 1 && (
        <>
          <button 
            onClick={prevSlide}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 md:w-12 md:h-12 rounded-full bg-black/30 hover:bg-black/60 border border-white/10 flex items-center justify-center text-white backdrop-blur-md transition-all z-10 hidden md:flex"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          
          <button 
            onClick={nextSlide}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 md:w-12 md:h-12 rounded-full bg-black/30 hover:bg-black/60 border border-white/10 flex items-center justify-center text-white backdrop-blur-md transition-all z-10 hidden md:flex"
          >
            <ChevronRight className="w-6 h-6" />
          </button>

          {/* Indicators */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 z-10">
            {movies.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentIndex(idx)}
                className={`transition-all duration-300 rounded-full ${
                  idx === currentIndex 
                    ? 'w-8 h-2 bg-primary shadow-[0_0_10px_rgba(59,130,246,0.6)]' 
                    : 'w-2 h-2 bg-white/30 hover:bg-white/50'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default FeaturedCarousel;
