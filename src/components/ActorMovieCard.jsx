import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Play } from 'lucide-react';
import { searchActorByName } from '../hooks/useActorSearch';

const ActorMovieCard = ({ actor, onActorClick }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [actorData, setActorData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    searchActorByName(actor.name).then(data => {
      setActorData(data);
      setLoading(false);
    });
  }, [actor.name]);

  const imageUrl = actorData?.image;
  const tmdbId = actorData?.tmdb_id;

  const handleClick = () => {
    if (!tmdbId) return; // don't open modal if actor lookup failed
    onActorClick({ ...actor, tmdb_id: tmdbId });
  };

  return (
    <motion.div
      whileHover={{ scale: 1.05 }}
      transition={{ duration: 0.2 }}
      className="relative flex-none w-[100px] md:w-[150px] cursor-pointer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
    >
      {/* Portrait Poster Style */}
      <div className="relative w-full aspect-[2/3] rounded-lg overflow-hidden bg-[#2a2a2a] border border-white/10 hover:border-[#E50914] transition">
        
        {loading ? (
          <div className="w-full h-full animate-pulse bg-[#333]" />
        ) : (
          <img
            src={imageUrl || `https://placehold.co/150x225/141414/E50914?text=${encodeURIComponent(actor.name[0])}`}
            alt={actor.name}
            loading="lazy"
            className="w-full h-full object-cover object-top"
            onError={(e) => {
              e.target.onerror = null;
              e.target.src = `https://placehold.co/150x225/141414/E50914?text=${encodeURIComponent(actor.name[0])}`;
            }}
          />
        )}

        {/* Overlay on hover */}
        {isHovered && !loading && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
            <Play className="w-8 h-8 text-[#E50914] fill-current" />
            <p className="text-white text-xs font-bold text-center px-2">
              View Movies
            </p>
          </div>
        )}
      </div>

      {/* Actor Name */}
      <p className="text-white text-xs font-semibold truncate mt-1 text-center">
        {actor.name}
      </p>
      
      {/* Movie Count */}
      <p className="text-gray-500 text-[10px] text-center">
        {!loading ? '50+ Movies' : '...'}
      </p>
    </motion.div>
  );
};

export default ActorMovieCard;
