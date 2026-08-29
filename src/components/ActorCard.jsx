import React from 'react';
import { motion } from 'framer-motion';

const ActorCard = ({ actor, onClick }) => {
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
          src={actor.image}
          alt={actor.name}
          loading="lazy"
          className="w-full h-full object-cover object-top"
          onError={(e) => {
            e.target.onerror = null;
            e.target.src = `https://placehold.co/130x130/141414/E50914?text=${actor.name[0]}`;
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
        {actor.movies.length} Movies
      </p>
    </motion.div>
  );
};

export default ActorCard;
