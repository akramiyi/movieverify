import { useState, useEffect } from 'react';

// Using a wide rootMargin to proactively load images before they come into the visible viewport
export const useViewportIntersection = (ref, rootMargin = '0px 1000px 0px 1000px') => {
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    if (!ref.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsNearViewport(true);
          // Once it intersects, we can stop observing if we just want it to load once
          observer.disconnect();
        }
      },
      {
        root: null,
        rootMargin,
        threshold: 0, // Trigger as soon as any part intersects the expanded margin
      }
    );

    observer.observe(ref.current);

    return () => {
      observer.disconnect();
    };
  }, [ref, rootMargin]);

  return isNearViewport;
};
