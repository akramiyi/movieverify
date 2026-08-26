import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MovieCard from './MovieCard';

const MovieGrid = ({ movies, onMovieClick }) => {
  if (movies.length === 0) {
    return (
      <div className="min-h-[40vh] flex flex-col items-center justify-center text-center px-4">
        <div className="w-24 h-24 mb-6 rounded-full glass flex items-center justify-center">
          <span className="text-4xl">🎬</span>
        </div>
        <h3 className="text-2xl font-bold text-white mb-2">No Movies Found</h3>
        <p className="text-gray-400 max-w-md">
          We couldn't find any movies matching your current filters or search query. Try adjusting them to find what you're looking for.
        </p>
      </div>
    );
  }

  return (
    <motion.div 
      layout
      className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6"
    >
      <AnimatePresence mode="popLayout">
        {movies.map((movie) => (
          <MovieCard 
            key={movie.id} 
            movie={movie} 
            onClick={onMovieClick} 
          />
        ))}
      </AnimatePresence>
    </motion.div>
  );
};

export default MovieGrid;
