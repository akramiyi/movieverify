import React, { useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Plus, ThumbsUp, ChevronDown, Check } from 'lucide-react';

const MovieCard = ({ movie, onClick, myList = [], onToggleMyList }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [cardPos, setCardPos] = useState(null);
  const cardRef = useRef(null);
  const isAddedToList = myList.some((m) => m.id === movie.id);

  const handleMouseEnter = () => {
    setIsHovered(true);
    if(cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect();
      setCardPos({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      });
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  let transformOrigin = 'center center';
  if (cardPos) {
    if (cardPos.left < 100) {
      transformOrigin = 'left center';
    } else if (window.innerWidth - (cardPos.left + cardPos.width) < 100) {
      transformOrigin = 'right center';
    }
  }

  const hasDownloadLink = !!(movie.download480p || movie.download720p || movie.download1080p || movie.seasons);

  return (
    <div 
      className="flex flex-col flex-none w-[160px] md:w-[240px] cursor-pointer overflow-visible gap-1.5"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={() => {
        setIsHovered(false);
        onClick(movie);
      }}
    >
      <div 
        ref={cardRef}
        className="relative w-full h-[90px] md:h-[135px] overflow-visible rounded-md"
      >
        <img
          src={movie.backdrop || movie.poster}
          alt={movie.title}
          className={`w-full h-full object-cover rounded-md ${movie.title.toLowerCase().includes('pushpa') ? 'object-bottom' : 'object-top'}`}
          onError={(e) => {
            if (!e.target.dataset.triedFallback) {
              e.target.dataset.triedFallback = 'true';
              if (movie.poster) {
                e.target.src = movie.poster;
                return;
              }
            }
            e.target.onerror = null;
            e.target.src = `https://placehold.co/500x280/141414/E50914?text=${encodeURIComponent(movie.title)}`;
          }}
        />
        {hasDownloadLink && (
          <div className="absolute top-1.5 right-1.5 bg-green-600/90 text-white text-[9px] md:text-[10px] font-bold px-1.5 py-0.5 rounded shadow-md uppercase tracking-wider backdrop-blur-sm z-10 flex items-center gap-0.5">
            <Download className="w-2.5 h-2.5 stroke-[3]" />
            Available
          </div>
        )}
      </div>

      <span className="text-[11px] md:text-xs font-semibold tracking-wider uppercase text-neutral-400 group-hover:text-[#E50914] transition-colors duration-300 mt-1 truncate px-1">
        {movie.title}
      </span>
      
      {isHovered && cardPos && ReactDOM.createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1.25 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3, delay: 0.4 }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={handleMouseLeave}
            className="bg-[#181818] rounded-md shadow-2xl overflow-hidden"
            style={{
              position: 'fixed',
              top: cardPos.top - 20,
              left: cardPos.left - (cardPos.width * 0.15),
              width: cardPos.width * 1.3,
              zIndex: 999,
              transformOrigin: transformOrigin,
            }}
          >
            <div className="relative aspect-video">
              <img
                src={movie.backdrop || movie.poster}
                alt={movie.title}
                className={`w-full h-full object-cover ${movie.title.toLowerCase().includes('pushpa') ? 'object-bottom' : 'object-top'}`}
                onError={(e) => {
                  if (!e.target.dataset.triedFallback) {
                    e.target.dataset.triedFallback = 'true';
                    if (movie.poster) {
                      e.target.src = movie.poster;
                      return;
                    }
                  }
                  e.target.onerror = null;
                  e.target.src = `https://placehold.co/500x280/141414/E50914?text=${encodeURIComponent(movie.title)}`;
                }}
              />
              <div className="absolute inset-0 bg-black/20" />
            </div>

            <div className="p-3 md:p-4 text-white">
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

              <h3 className="font-bold text-xs md:text-sm mb-1 truncate text-white">{movie.title}</h3>

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
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};

export default MovieCard;
