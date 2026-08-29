import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Play, Plus } from 'lucide-react';

const ActorMovieCard = ({ actor, onActorClick }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [profile, setProfile] = useState(actor.image);
  const [movieCount, setMovieCount] = useState(actor.movieCount || actor.movies?.length || 0);

  useEffect(() => {
    const token = import.meta.env.VITE_TMDB_TOKEN;
    if (!token || !actor.tmdb_id) return;

    fetch(`https://api.themoviedb.org/3/person/${actor.tmdb_id}?append_to_response=combined_credits`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    .then(r => r.json())
    .then(data => {
      if (data.profile_path) {
        setProfile(`https://image.tmdb.org/t/p/w342${data.profile_path}`);
      }
      if (data.combined_credits && data.combined_credits.cast) {
        setMovieCount(data.combined_credits.cast.length);
      }
    })
    .catch(console.error);
  }, [actor.tmdb_id]);

  if (!actor) return null;

  return (
    <motion.div
      whileHover={{ scale: 1.05 }}
      transition={{ duration: 0.2 }}
      className="relative flex-none w-[100px] md:w-[150px] 
                 cursor-pointer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onActorClick(actor)}
    >
      {/* Portrait Poster Style */}
      <div className="relative w-full aspect-[2/3] 
                      rounded-lg overflow-hidden 
                      bg-[#2a2a2a] border border-white/10
                      hover:border-[#E50914] transition">
        
        <img
          src={profile}
          alt={actor.name}
          loading="lazy"
          className="w-full h-full object-cover object-top"
          onError={(e) => {
            e.target.onerror = null;
            e.target.src = `https://placehold.co/150x225/141414/E50914?text=${encodeURIComponent(actor.name[0])}`;
          }}
        />

        {/* Overlay on hover */}
        {isHovered && (
          <div className="absolute inset-0 bg-black/60 
                          flex flex-col items-center justify-center 
                          gap-2">
            <Play className="w-8 h-8 text-[#E50914] fill-current" />
            <p className="text-white text-xs font-bold text-center px-2">
              View Movies
            </p>
          </div>
        )}
      </div>

      {/* Actor Name */}
      <p className="text-white text-xs font-semibold 
                    truncate mt-1 text-center">
        {actor.name}
      </p>
      
      {/* Movie Count */}
      <p className="text-gray-500 text-[10px] text-center">
        {movieCount > 0 ? movieCount : '50+'} Movies
      </p>
    </motion.div>
  );
};

export default ActorMovieCard;
