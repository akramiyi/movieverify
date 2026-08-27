import React, { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import MovieCard from './MovieCard';
import SkeletonCard from './SkeletonCard';

const MovieRow = ({ title, movies, onMovieClick, isLoading, myList, onToggleMyList, onSeeAll }) => {
  const rowRef = useRef(null);
  const [isMoved, setIsMoved] = useState(false);

  const handleClick = (direction) => {
    setIsMoved(true);
    if (rowRef.current) {
      const { scrollLeft, clientWidth } = rowRef.current;
      const scrollTo = direction === 'left' 
        ? scrollLeft - clientWidth 
        : scrollLeft + clientWidth;
      
      rowRef.current.scrollTo({ left: scrollTo, behavior: 'smooth' });
    }
  };

  if (!isLoading && (!movies || movies.length === 0)) return null;

  return (
    <div className="space-y-2 md:space-y-4 mb-8 overflow-visible">
      <div className="flex items-center justify-between px-4 md:px-12">
        <h2 className="whitespace-nowrap cursor-pointer text-sm font-semibold text-[#e5e5e5] transition duration-200 hover:text-white md:text-2xl">
          {title}
        </h2>
        {!isLoading && movies && movies.length > 0 && onSeeAll && (
          <button 
            onClick={() => onSeeAll(title, movies)}
            className="text-xs md:text-sm font-semibold text-gray-400 hover:text-[#E50914] transition duration-300 flex items-center gap-1 focus:outline-none"
          >
            See All <span className="text-[10px] md:text-xs">▸</span>
          </button>
        )}
      </div>
      
      <div className="group relative md:-ml-2 overflow-visible">
        {!isLoading && (
          <ChevronLeft 
            className={`absolute top-0 bottom-0 left-2 z-40 m-auto h-9 w-9 cursor-pointer opacity-0 transition hover:scale-125 group-hover:opacity-100 ${!isMoved && 'hidden'}`}
            onClick={() => handleClick('left')}
          />
        )}
        
        <div 
          ref={rowRef}
          className="flex items-center space-x-2 overflow-x-scroll hide-scrollbar px-4 md:px-12 py-12"
        >
          {isLoading ? (
            Array.from({ length: 6 }).map((_, index) => (
              <SkeletonCard key={index} />
            ))
          ) : (
            movies.map((movie) => (
              <MovieCard 
                key={movie.id} 
                movie={movie} 
                onClick={() => onMovieClick(movie)} 
                myList={myList}
                onToggleMyList={onToggleMyList}
              />
            ))
          )}
        </div>

        {!isLoading && (
          <ChevronRight 
            className="absolute top-0 bottom-0 right-2 z-40 m-auto h-9 w-9 cursor-pointer opacity-0 transition hover:scale-125 group-hover:opacity-100"
            onClick={() => handleClick('right')}
          />
        )}
      </div>
    </div>
  );
};

export default MovieRow;
