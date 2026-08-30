import React, { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import MovieCard from './MovieCard';
import SkeletonCard from './SkeletonCard';

const MovieRow = ({ title, movies, onMovieClick, isLoading, myList, onToggleMyList, onSeeAll }) => {
  const rowRef = useRef(null);
  const [isMoved, setIsMoved] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

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

  const [multiplier, setMultiplier] = useState(2);

  React.useEffect(() => {
    if (!movies || movies.length === 0) return;
    const updateMultiplier = () => {
      const cardWidth = 240; // Approx max width of MovieCard
      const singleSetWidth = movies.length * cardWidth;
      const viewportWidth = window.innerWidth;
      
      // To loop seamlessly with translateX(-50%), the container must shift by an integer number of sets.
      // Therefore, the multiplier must be EVEN.
      // And 50% of the container (minSets) must be >= viewport width so it doesn't show empty space.
      const minSets = Math.max(1, Math.ceil(viewportWidth / singleSetWidth));
      setMultiplier(minSets * 2);
    };
    
    updateMultiplier();
    window.addEventListener('resize', updateMultiplier);
    return () => window.removeEventListener('resize', updateMultiplier);
  }, [movies]);

  if (!isLoading && (!movies || movies.length === 0)) return null;

  const marqueeMovies = movies && movies.length > 0 
    ? Array.from({ length: multiplier }).flatMap(() => movies)
    : [];

  const scrollDuration = movies && movies.length > 0 ? `${movies.length * 6.5}s` : '50s';

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
      
      <div className="overflow-hidden w-full relative md:-ml-2">
        <div 
          className={`${!isLoading ? 'animate-marquee' : 'flex'} flex items-center space-x-2 py-10 px-4 md:px-12 overflow-x-auto hide-scrollbar`}
          style={{ 
            animationDuration: scrollDuration,
            animationPlayState: isPaused ? 'paused' : 'running'
          }}
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
          onTouchStart={() => setIsPaused(true)}
          onTouchEnd={() => setTimeout(() => setIsPaused(false), 3000)}
        >
          {isLoading ? (
            Array.from({ length: 6 }).map((_, index) => (
              <SkeletonCard key={index} />
            ))
          ) : (
            marqueeMovies.map((movie, idx) => (
              <div key={`${movie.id}-${idx}`} className="flex-shrink-0">
                <MovieCard 
                  movie={movie} 
                  onClick={() => onMovieClick(movie)} 
                  myList={myList}
                  onToggleMyList={onToggleMyList}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default MovieRow;
