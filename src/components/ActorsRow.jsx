import React, { useState } from 'react';
import ActorMovieCard from './ActorMovieCard';

const ActorsRow = ({ title, actors, onActorSelect, onSeeAll }) => {
  const [isPaused, setIsPaused] = useState(false);
  const [multiplier, setMultiplier] = useState(2);

  React.useEffect(() => {
    if (!actors || actors.length === 0) return;
    const updateMultiplier = () => {
      const cardWidth = 150; // Max width of ActorMovieCard
      const singleSetWidth = actors.length * cardWidth;
      const viewportWidth = window.innerWidth;
      
      const minSets = Math.max(1, Math.ceil(viewportWidth / singleSetWidth));
      setMultiplier(minSets * 2);
    };
    
    updateMultiplier();
    window.addEventListener('resize', updateMultiplier);
    return () => window.removeEventListener('resize', updateMultiplier);
  }, [actors]);

  if (!actors || actors.length === 0) return null;

  const marqueeActors = Array.from({ length: multiplier }).flatMap(() => actors);
  const scrollDuration = `${actors.length * 6.5}s`;

  return (
    <div className="space-y-2 md:space-y-4 mb-8 overflow-visible">
      <div className="flex items-center justify-between px-4 md:px-12">
        <h2 className="whitespace-nowrap cursor-pointer text-sm font-semibold text-[#e5e5e5] transition duration-200 hover:text-white md:text-2xl">
          {title}
        </h2>
        <button 
          onClick={onSeeAll}
          className="text-xs md:text-sm font-semibold text-gray-400 hover:text-[#E50914] transition duration-300 flex items-center gap-1 focus:outline-none"
        >
          See All <span className="text-[10px] md:text-xs">▸</span>
        </button>
      </div>

      <div className="overflow-hidden w-full relative md:-ml-2">
        <div 
          className="animate-marquee flex items-center space-x-2 py-4 px-4 md:px-12"
          style={{ 
            animationDuration: scrollDuration,
            animationPlayState: isPaused ? 'paused' : 'running'
          }}
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
        >
          {marqueeActors.map((actor, index) => (
            <ActorMovieCard
              key={`${actor.id}-${index}`}
              actor={actor}
              onActorClick={onActorSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default ActorsRow;
