import React from 'react';
import { motion } from 'framer-motion';
import { Star, Download, PlayCircle } from 'lucide-react';

const MovieCard = ({ movie, onClick }) => {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      whileHover={{ y: -10 }}
      className="group relative rounded-2xl overflow-hidden glass cursor-pointer border border-white/5 hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_30px_rgba(59,130,246,0.3)]"
      onClick={() => onClick(movie)}
    >
      {/* Poster */}
      <div className="relative aspect-[2/3] overflow-hidden bg-gray-900">
        <img
          src={movie.poster}
          alt={movie.title}
          loading="lazy"
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 group-hover:opacity-60"
        />
        
        {/* Quality Badge */}
        <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-md px-2 py-1 rounded text-xs font-bold text-primary border border-primary/30 shadow-[0_0_10px_rgba(59,130,246,0.3)]">
          {movie.quality}
        </div>

        {/* Hover Overlay Content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-black/40">
          <PlayCircle className="w-16 h-16 text-white mb-2 transform scale-50 group-hover:scale-100 transition-transform duration-500 delay-100" />
          <p className="text-white font-medium transform translate-y-4 group-hover:translate-y-0 transition-transform duration-500 delay-150">
            View Details
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 relative z-10 bg-gradient-to-t from-background/90 to-background/40 backdrop-blur-sm">
        <div className="flex justify-between items-start mb-2">
          <h3 className="font-bold text-lg text-white truncate pr-2" title={movie.title}>
            {movie.title}
          </h3>
          <div className="flex items-center gap-1 text-yellow-500 shrink-0 bg-black/40 px-1.5 py-0.5 rounded backdrop-blur-sm">
            <Star className="w-3 h-3 fill-current" />
            <span className="text-xs font-bold">{movie.rating}</span>
          </div>
        </div>
        
        <div className="flex items-center justify-between text-sm text-gray-400 mb-4">
          <span>{movie.year}</span>
          <span className="truncate ml-2">{movie.genre}</span>
        </div>

        <button className="w-full py-2.5 rounded-xl glass-button text-white font-medium flex items-center justify-center gap-2 group-hover:bg-primary/20 transition-colors">
          <Download className="w-4 h-4 group-hover:-translate-y-1 transition-transform" />
          Download
        </button>
      </div>

      {/* Glass Shine Effect */}
      <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none" />
    </motion.div>
  );
};

export default MovieCard;
