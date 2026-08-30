import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'movieverify_recently_viewed';
const MAX_ITEMS = 15;

export const useRecentlyViewed = () => {
  const [recentlyViewed, setRecentlyViewed] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.warn('Failed to load recently viewed:', e.message);
      return [];
    }
  });

  const addToRecentlyViewed = useCallback((movie) => {
    if (!movie || !movie.id) return;

    setRecentlyViewed((prev) => {
      const filtered = prev.filter((m) => m.id !== movie.id);
      const updated = [
        {
          id: movie.id,
          title: movie.title,
          poster: movie.poster,
          backdrop: movie.backdrop,
          year: movie.year,
          rating: movie.rating,
          quality: movie.quality,
          genre: movie.genre,
          language: movie.language,
          viewedAt: Date.now(),
        },
        ...filtered,
      ].slice(0, MAX_ITEMS);

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (e) {
        console.warn('Failed to save recently viewed:', e.message);
      }

      return updated;
    });
  }, []);

  const clearRecentlyViewed = useCallback(() => {
    setRecentlyViewed([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to clear recently viewed:', e.message);
    }
  }, []);

  return { recentlyViewed, addToRecentlyViewed, clearRecentlyViewed };
};
