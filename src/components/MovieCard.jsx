import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Plus, ThumbsUp, ChevronDown, Check } from 'lucide-react';

const MovieCard = ({ movie, onClick, myList = [], onToggleMyList }) => {
  const [isHovered, setIsHovered] = useState(false);
  const isAddedToList = myList.some((m) => m.id === movie.id);

  return (
    <div 
      className="relative flex-none w-[160px] md:w-[240px] h-[90px] md:h-[135px] cursor-pointer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onClick(movie)}
    >
      <img
        src={movie.backdrop || movie.poster}
        alt={movie.title}
        className="w-full h-full object-cover rounded-md"
      />
      
      <AnimatePresence>
        {isHovered && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1.25 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3, delay: 0.4 }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full bg-[#181818] rounded-md shadow-2xl z-50 overflow-hidden"
            style={{ transformOrigin: 'center center' }}
          >
            <div className="relative aspect-video">
              <img
                src={movie.backdrop || movie.poster}
                alt={movie.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/20" />
            </div>

            <div className="p-3 md:p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <button 
                    className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-white flex items-center justify-center hover:bg-gray-300 transition text-black"
                    onClick={(e) => { e.stopPropagation(); onClick(movie); }}
                  >
                    <Download className="w-3 h-3 md:w-4 md:h-4 stroke-[3.5]" />
                  </button>
                  <button 
                    className="w-6 h-6 md:w-8 md:h-8 rounded-full border-2 border-gray-500 bg-[#2a2a2a] flex items-center justify-center hover:border-white transition text-white"
                    onClick={(e) => { e.stopPropagation(); onToggleMyList(movie); }}
                  >
                    {isAddedToList ? <Check className="w-3 h-3 md:w-4 md:h-4" /> : <Plus className="w-3 h-3 md:w-4 md:h-4" />}
                  </button>
                  <button className="w-6 h-6 md:w-8 md:h-8 rounded-full border-2 border-gray-500 bg-[#2a2a2a] flex items-center justify-center hover:border-white transition text-white">
                    <ThumbsUp className="w-3 h-3 md:w-4 md:h-4" />
                  </button>
                </div>
                <button 
                  className="w-6 h-6 md:w-8 md:h-8 rounded-full border-2 border-gray-500 bg-[#2a2a2a] flex items-center justify-center hover:border-white transition text-white"
                  onClick={(e) => { e.stopPropagation(); onClick(movie); }}
                >
                  <ChevronDown className="w-3 h-3 md:w-4 md:h-4" />
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs md:text-sm mb-1">
                <span className="text-green-500 font-bold">{Math.round(movie.rating * 10)}% Match</span>
                <span className="text-gray-400">{movie.year}</span>
                <span className="border border-gray-600 text-gray-300 px-1 rounded text-[10px] uppercase">{movie.quality}</span>
              </div>
              
              <div className="flex items-center gap-1.5 text-[10px] md:text-xs text-white/90">
                {movie.genre.split(',').map((g, i, arr) => (
                  <React.Fragment key={i}>
                    <span>{g.trim()}</span>
                    {i < arr.length - 1 && <span className="text-gray-500">•</span>}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MovieCard;
