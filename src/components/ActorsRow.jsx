import React, { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import ActorMovieCard from './ActorMovieCard';

const ActorsRow = ({ title, actors, onActorSelect }) => {
  const rowRef = useRef(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);

  const scroll = (dir) => {
    if (rowRef.current) {
      const scrollAmount = 400;
      rowRef.current.scrollBy({
        left: dir === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
      
      setTimeout(() => {
        if (rowRef.current) {
          setShowLeftArrow(rowRef.current.scrollLeft > 0);
          setShowRightArrow(
            rowRef.current.scrollLeft < 
            rowRef.current.scrollWidth - rowRef.current.clientWidth
          );
        }
      }, 100);
    }
  };

  const handleScroll = () => {
    if (rowRef.current) {
      setShowLeftArrow(rowRef.current.scrollLeft > 0);
      setShowRightArrow(
        rowRef.current.scrollLeft < 
        rowRef.current.scrollWidth - rowRef.current.clientWidth
      );
    }
  };

  if (!actors || actors.length === 0) return null;

  return (
    <div className="mb-8 md:mb-12 px-4 md:px-12">
      <h2 className="text-sm font-semibold text-[#e5e5e5] 
                     hover:text-white md:text-2xl mb-4 
                     cursor-pointer transition">
        {title}
      </h2>

      <div className="group relative">
        {/* Left Arrow */}
        {showLeftArrow && (
          <button
            onClick={() => scroll('left')}
            className="absolute -left-5 top-1/2 -translate-y-1/2 
                       z-40 w-10 h-10 rounded-full 
                       bg-black/70 hover:bg-[#E50914] 
                       text-white flex items-center justify-center 
                       transition opacity-100 lg:opacity-0 
                       lg:group-hover:opacity-100 duration-300"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {/* Scroll Container */}
        <div
          ref={rowRef}
          onScroll={handleScroll}
          className="flex items-center space-x-2 overflow-x-scroll 
                     hide-scrollbar py-4"
        >
          {actors.map(actor => (
            <ActorMovieCard
              key={actor.id}
              actor={actor}
              onActorClick={onActorSelect}
            />
          ))}
        </div>

        {/* Right Arrow */}
        {showRightArrow && (
          <button
            onClick={() => scroll('right')}
            className="absolute -right-5 top-1/2 -translate-y-1/2 
                       z-40 w-10 h-10 rounded-full 
                       bg-black/70 hover:bg-[#E50914] 
                       text-white flex items-center justify-center 
                       transition opacity-100 lg:opacity-0 
                       lg:group-hover:opacity-100 duration-300"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>
    </div>
  );
};

export default ActorsRow;
