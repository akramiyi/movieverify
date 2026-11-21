import { useState, useEffect } from 'react';
import { formatMovie, fetchHomeFeed } from './useTMDB';
import { movies as localMovies } from '../data/movies';

const ROTATION_DAYS = 7;

export const useLatestIndiaRelease = () => {
  const [pool, setPool] = useState([]);
  const [currentMovie, setCurrentMovie] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const fetchLatest = async () => {
      try {
        // Step 1: Read directly from consolidated home feed (zero separate requests)
        const feed = await fetchHomeFeed();
        if (feed && Array.isArray(feed.indiaLatest) && feed.indiaLatest.length > 0) {
          const uniqueMap = new Map();
          feed.indiaLatest.forEach((m) => uniqueMap.set(m.id, m));

          const sorted = Array.from(uniqueMap.values())
            .sort((a, b) => new Date(b.release_date || 0) - new Date(a.release_date || 0))
            .map(formatMovie);

          if (isMounted) {
            setPool(sorted);
            if (sorted.length > 0) {
              const epoch = new Date('2024-01-01').getTime();
              const daysSinceEpoch = Math.floor((Date.now() - epoch) / (1000 * 60 * 60 * 24));
              const rotationIndex = Math.floor(daysSinceEpoch / ROTATION_DAYS) % sorted.length;
              setCurrentMovie(sorted[rotationIndex]);
            }
          }
          return;
        }

        // Step 2: Instant zero-request fallback to local catalog
        const indianLocal = localMovies
          .filter((m) => m.genre === 'Bollywood' || m.genre === 'South Indian')
          .map(formatMovie);

        if (isMounted && indianLocal.length > 0) {
          setPool(indianLocal);
          setCurrentMovie(indianLocal[0]);
        }
      } catch (err) {
        console.warn('Latest India release fetch failed:', err.message);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchLatest();
    return () => { isMounted = false; };
  }, []);

  return { currentMovie, pool, loading };
};
