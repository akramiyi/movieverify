import { useState, useEffect } from 'react';
import { formatMovie } from './useTMDB';

const TOKEN = import.meta.env.VITE_TMDB_TOKEN;
const ROTATION_DAYS = 7;

export const useLatestIndiaRelease = () => {
  const [pool, setPool] = useState([]);
  const [currentMovie, setCurrentMovie] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLatest = async () => {
      try {
        const today = new Date();
        const sixtyDaysAgo = new Date(today);
        sixtyDaysAgo.setDate(today.getDate() - 60);
        
        const fromDate = sixtyDaysAgo.toISOString().split('T')[0];
        const toDate = today.toISOString().split('T')[0];

        const languages = ['hi', 'te', 'ta', 'kn', 'ml'];
        
        const requests = languages.map((lang) =>
          fetch(
            `https://api.themoviedb.org/3/discover/movie?with_original_language=${lang}&region=IN&primary_release_date.gte=${fromDate}&primary_release_date.lte=${toDate}&sort_by=primary_release_date.desc&page=1`,
            {
              headers: {
                Authorization: `Bearer ${TOKEN}`,
                'Content-Type': 'application/json',
              },
            }
          ).then((r) => r.json())
        );

        const responses = await Promise.all(requests);
        const merged = responses.flatMap((r) => r.results || []);

        const uniqueMap = new Map();
        merged.forEach((m) => {
          if (m.backdrop_path && m.overview) {
            uniqueMap.set(m.id, m);
          }
        });

        const sorted = Array.from(uniqueMap.values())
          .sort((a, b) => 
            new Date(b.release_date) - new Date(a.release_date)
          )
          .slice(0, 15)
          .map(formatMovie);

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
      } catch (err) {
        console.warn('Latest India release fetch failed:', err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchLatest();
  }, []);

  return { currentMovie, pool, loading };
};
