import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Play } from 'lucide-react';
import { IMG_BASE } from '../hooks/useTMDB';

const ActorMovieCard = ({ actor, onActorClick }) => {
  const [isHovered, setIsHovered] = useState(false);
  const tmdbId = actor.tmdb_id || actor.id;

  // Route actor TMDB image through Cloudflare edge image proxy
  const rawImage = actor.image || (actor.profile_path ? `${IMG_BASE}/w342${actor.profile_path}` : null);
  const imageUrl = rawImage
    ? (rawImage.includes('image.tmdb.org/t/p') ? rawImage.replace('https://image.tmdb.org/t/p', IMG_BASE) : rawImage)
    : `https://placehold.co/150x225/141414/E50914?text=${encodeURIComponent((actor.name || 'A')[0])}`;

  const handleClick = () => {
    if (!tmdbId) return;
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
        <img
          src={imageUrl}
          alt={actor.name}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover object-top"
          onError={(e) => {
            e.target.onerror = null;
            e.target.src = `https://placehold.co/150x225/141414/E50914?text=${encodeURIComponent((actor.name || 'A')[0])}`;
          }}
        />

        {/* Overlay on hover */}
        {isHovered && (
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
        50+ Movies
      </p>
    </motion.div>
  );
};

export default React.memo(ActorMovieCard);
