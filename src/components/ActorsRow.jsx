import React, { useState, useRef, useEffect } from 'react';
import ActorMovieCard from './ActorMovieCard';

const ActorsRow = ({ title, actors, onActorSelect, onSeeAll, priority = false }) => {
  const [isPaused, setIsPaused] = useState(false);
  const [multiplier, setMultiplier] = useState(2);
  const rowRef = useRef(null);
  const [hasEnteredView, setHasEnteredView] = useState(priority);
  const [isInView, setIsInView] = useState(priority);

  // Performance: Only run marquee animation and load actors when row is near viewport
  useEffect(() => {
    if (!rowRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasEnteredView(true);
        }
        setIsInView(entry.isIntersecting);
      },
      { root: null, rootMargin: '350px 0px 350px 0px', threshold: 0 }
    );
    observer.observe(rowRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!actors || actors.length === 0) return;
    const updateMultiplier = () => {
      const cardWidth = 150; // Max width of ActorMovieCard
      const singleSetWidth = actors.length * cardWidth;
      const viewportWidth = window.innerWidth;
      
      const minSets = Math.max(1, Math.ceil(viewportWidth / singleSetWidth));
      setMultiplier(Math.min(2, minSets * 2));
    };
    
    updateMultiplier();
    window.addEventListener('resize', updateMultiplier);
    return () => window.removeEventListener('resize', updateMultiplier);
  }, [actors]);

  if (!actors || actors.length === 0) return null;

  const marqueeActors = Array.from({ length: multiplier }).flatMap(() => actors);
  const cardPixelWidth = 140;
  const shiftDistancePx = Math.max(1, ((multiplier || 2) / 2) * (actors?.length || 1) * cardPixelWidth);
  const computedSeconds = Math.max(50, Math.round(shiftDistancePx / 25));
  const scrollDuration = `${computedSeconds}s`;

  return (
    <div ref={rowRef} className="movie-row-container space-y-2 md:space-y-4 mb-8 overflow-visible">
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

      <div 
        className="overflow-x-auto hide-scrollbar w-full relative md:-ml-2"
        onTouchStart={() => setIsPaused(true)}
        onTouchEnd={() => setTimeout(() => setIsPaused(false), 3000)}
      >
        <div 
          className="animate-marquee flex items-center space-x-2 py-4 px-4 md:px-12"
          style={{ 
            animationDuration: scrollDuration,
            animationPlayState: isPaused || !isInView ? 'paused' : 'running'
          }}
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
        >
          {!hasEnteredView ? (
            Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex-none w-[100px] md:w-[150px] aspect-[2/3] rounded-lg bg-[#222] animate-pulse" />
            ))
          ) : (
            marqueeActors.map((actor, index) => (
              <ActorMovieCard
                key={`${actor.id}-${index}`}
                actor={actor}
                onActorClick={onActorSelect}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default React.memo(ActorsRow);
