import { useState, useEffect } from 'react';
import { formatMovie, fetchHomeFeed } from './useTMDB';

const API_URL = import.meta.env.VITE_API_URL || 'https://movieverify-backend.onrender.com';
const BASE_URL = `${API_URL}/api/tmdb`;
const ROTATION_DAYS = 7;

export const useLatestIndiaRelease = () => {
  const [pool, setPool] = useState([]);
  const [currentMovie, setCurrentMovie] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const fetchLatest = async () => {
      try {
        // Step 1: Check if consolidated home feed already provided indiaLatest
        const feed = await fetchHomeFeed();
        if (feed && Array.isArray(feed.indiaLatest) && feed.indiaLatest.length > 0) {
          const uniqueMap = new Map();
          feed.indiaLatest.forEach((m) => uniqueMap.set(m.id, m));

          const sorted = Array.from(uniqueMap.values())
            .sort((a, b) => new Date(b.release_date) - new Date(a.release_date))
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

        // Step 2: Fallback to individual language queries if bundled feed unavailable
        const today = new Date();
        const sixtyDaysAgo = new Date(today);
        sixtyDaysAgo.setDate(today.getDate() - 60);
        
        const fromDate = sixtyDaysAgo.toISOString().split('T')[0];
        const toDate = today.toISOString().split('T')[0];

        const languages = ['hi', 'te', 'ta', 'kn', 'ml'];
        
        const requests = languages.map((lang) =>
          fetch(
            `${BASE_URL}/discover/movie?with_original_language=${lang}&region=IN&primary_release_date.gte=${fromDate}&primary_release_date.lte=${toDate}&sort_by=primary_release_date.desc&page=1`,
            {
              headers: {
                'Content-Type': 'application/json',
                ...(import.meta.env.VITE_TMDB_TOKEN ? { Authorization: `Bearer ${import.meta.env.VITE_TMDB_TOKEN}` } : {}),
              },
            }
          ).then((r) => r.json())
        );

        const responses = await Promise.all(requests);

        const perLanguageTop = responses.map((r) => 
          (r.results || [])
            .filter((m) => m.backdrop_path && m.overview)
            .sort((a, b) => new Date(b.release_date) - new Date(a.release_date))
            .slice(0, 4)
        );

        const merged = perLanguageTop.flat();

        const uniqueMap = new Map();
        merged.forEach((m) => {
          uniqueMap.set(m.id, m);
        });

        const sorted = Array.from(uniqueMap.values())
          .sort((a, b) => 
            new Date(b.release_date) - new Date(a.release_date)
          )
          .map(formatMovie);

        if (isMounted) {
          setPool(sorted);

          if (sorted.length > 0) {
            // Calculate which movie's "turn" it is based on real date
            const epoch = new Date('2024-01-01').getTime();
            const daysSinceEpoch = Math.floor(
              (Date.now() - epoch) / (1000 * 60 * 60 * 24)
            );
            const rotationIndex = Math.floor(daysSinceEpoch / ROTATION_DAYS) % sorted.length;
            setCurrentMovie(sorted[rotationIndex]);
          }
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
