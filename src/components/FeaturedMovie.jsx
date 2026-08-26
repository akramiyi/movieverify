import React from 'react';
import { motion } from 'framer-motion';
import { Play, Download, Star, Info } from 'lucide-react';

const FeaturedMovie = ({ movie, onDownloadClick }) => {
  if (!movie) return null;

  return (
    <div className="relative w-full h-[70vh] md:h-[80vh] min-h-[600px] overflow-hidden rounded-3xl group mb-12">
      {/* Background Image with Parallax Effect on Hover */}
      <motion.div
        className="absolute inset-0 z-0"
        whileHover={{ scale: 1.05 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      >
        <img
          src={movie.backdrop}
          alt={movie.title}
          className="w-full h-full object-cover"
        />
      </motion.div>

      {/* Cinematic Overlays */}
      <div className="absolute inset-0 z-10 bg-gradient-to-t from-background via-background/80 to-transparent" />
      <div className="absolute inset-0 z-10 bg-gradient-to-r from-background/90 via-background/50 to-transparent" />
      
      {/* Content */}
      <div className="absolute inset-0 z-20 flex flex-col justify-end p-6 md:p-12 lg:p-20">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="max-w-3xl"
        >
          {/* Badges */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <span className="px-3 py-1 bg-primary/20 border border-primary/50 text-primary rounded-full text-sm font-semibold shadow-[0_0_10px_rgba(59,130,246,0.3)]">
              Featured
            </span>
            <span className="px-3 py-1 glass-panel text-white rounded-full text-sm font-medium">
              {movie.quality}
            </span>
            <div className="flex items-center gap-1 glass-panel px-3 py-1 rounded-full text-yellow-500">
              <Star className="w-4 h-4 fill-current" />
              <span className="text-sm font-bold text-white">{movie.rating}</span>
            </div>
            <span className="px-3 py-1 glass-panel text-white rounded-full text-sm font-medium">
              {movie.year}
            </span>
          </div>

          <h2 className="text-4xl md:text-6xl lg:text-7xl font-bold text-white mb-4 drop-shadow-lg tracking-tight">
            {movie.title}
          </h2>
          
          <div className="flex items-center gap-4 text-gray-300 mb-6 font-medium">
            <span>{movie.genre}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
            <span>{movie.language}</span>
          </div>

          <p className="text-lg text-gray-300 mb-8 max-w-2xl line-clamp-3 drop-shadow-md">
            {movie.description}
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <button 
              onClick={() => onDownloadClick(movie)}
              className="px-8 py-3 bg-primary hover:bg-primary/90 text-white rounded-full font-bold transition-all duration-300 shadow-[0_0_20px_rgba(59,130,246,0.4)] hover:shadow-[0_0_30px_rgba(59,130,246,0.6)] flex items-center gap-2 group"
            >
              <Download className="w-5 h-5 group-hover:-translate-y-1 transition-transform" />
              Download Now
            </button>
            <a 
              href={movie.trailerUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="px-8 py-3 glass-button text-white rounded-full font-bold flex items-center gap-2 group"
            >
              <Play className="w-5 h-5 group-hover:text-primary transition-colors" />
              Watch Trailer
            </a>
            <button 
              onClick={() => onDownloadClick(movie)}
              className="w-12 h-12 rounded-full glass flex items-center justify-center text-gray-300 hover:text-white transition-colors"
              title="More Info"
            >
              <Info className="w-5 h-5" />
            </button>
          </div>
        </motion.div>
      </div>

      {/* Decorative Neon Accents */}
      <div className="absolute top-0 right-0 w-1/3 h-full bg-gradient-to-l from-primary/10 to-transparent pointer-events-none mix-blend-screen" />
    </div>
  );
};

export default FeaturedMovie;
