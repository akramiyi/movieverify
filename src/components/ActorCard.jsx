import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const ActorCard = ({ actor, onClick }) => {
  const [profile, setProfile] = useState(actor.image);
  const [movieCount, setMovieCount] = useState(actor.movies?.length || 0);

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

  return (
    <motion.div
      whileHover={{ scale: 1.05 }}
      transition={{ duration: 0.2 }}
      onClick={() => onClick(actor)}
      className="relative flex-none w-[100px] md:w-[140px] 
                 cursor-pointer text-center"
    >
      {/* Circular Photo */}
      <div className="w-[90px] h-[90px] md:w-[130px] md:h-[130px] 
                      mx-auto rounded-full overflow-hidden border-2 
                      border-[#E50914] mb-2 hover:border-white 
                      transition-all duration-300">
        <img
          src={profile}
          alt={actor.name}
          loading="lazy"
          className="w-full h-full object-cover object-top"
          onError={(e) => {
            e.target.onerror = null;
            e.target.src = `https://placehold.co/130x130/141414/E50914?text=${encodeURIComponent(actor.name[0])}`;
          }}
        />
      </div>
      
      {/* Name */}
      <p className="text-white text-xs md:text-sm font-semibold 
                    truncate px-1">
        {actor.name}
      </p>
      
      {/* Movie count */}
      <p className="text-gray-400 text-[10px] md:text-xs">
        {movieCount} Movies & Shows
      </p>
    </motion.div>
  );
};

export default ActorCard;
