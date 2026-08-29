import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import ActorCard from './ActorCard';

const ActorRow = ({ title, actors, onActorClick }) => {
  const rowRef = useRef(null);

  const scroll = (dir) => {
    if (rowRef.current) {
      rowRef.current.scrollBy({
        left: dir === 'left' ? -400 : 400,
        behavior: 'smooth'
      });
    }
  };

  if (!actors || actors.length === 0) return null;

  return (
    <div className="mb-8 md:mb-12">
      <h2 className="whitespace-nowrap text-sm font-semibold 
                     text-[#e5e5e5] hover:text-white md:text-2xl 
                     px-4 md:px-12 mb-4 cursor-pointer transition">
        {title}
      </h2>

      <div className="group relative">
        <ChevronLeft
          className="absolute left-2 top-1/2 -translate-y-1/2 
                     z-40 h-8 w-8 cursor-pointer opacity-0 
                     group-hover:opacity-100 transition 
                     hover:scale-125 text-white bg-black/50 
                     rounded-full p-1"
          onClick={() => scroll('left')}
        />

        <div
          ref={rowRef}
          className="flex items-center gap-4 overflow-x-scroll 
                     hide-scrollbar px-4 md:px-12 py-4"
        >
          {actors.map(actor => (
            <ActorCard
              key={actor.id}
              actor={actor}
              onClick={onActorClick}
            />
          ))}
        </div>

        <ChevronRight
          className="absolute right-2 top-1/2 -translate-y-1/2 
                     z-40 h-8 w-8 cursor-pointer opacity-0 
                     group-hover:opacity-100 transition 
                     hover:scale-125 text-white bg-black/50 
                     rounded-full p-1"
          onClick={() => scroll('right')}
        />
      </div>
    </div>
  );
};

export default ActorRow;
