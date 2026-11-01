import { useState, useCallback } from 'react';
import { getMediaTypeFromId } from './useTMDB';

const STORAGE_KEY = 'movieverify_recently_viewed';
const MAX_ITEMS = 15;

const resolveItemMediaType = (item) => {
  if (!item) return null;
  if (item.mediaType === 'tv' || item.mediaType === 'movie') return item.mediaType;
  if (item.media_type === 'tv' || item.media_type === 'movie') return item.media_type;
  const idStr = String(item.id || '');
  if (idStr.includes('-tv')) return 'tv';
  if (idStr.includes('-movie')) return 'movie';
  if (item.seasons && item.seasons.length > 0) return 'tv';
  if (item.first_air_date) return 'tv';
  if (item.genre && (item.genre.toLowerCase().includes('web series') || item.genre.toLowerCase().includes('tv series'))) return 'tv';
  const cleanId = idStr.split('-')[0];
  const fromId = getMediaTypeFromId(cleanId);
  if (fromId) return fromId;
  if (item.release_date) return 'movie';
  return null;
};

export const useRecentlyViewed = () => {
  const [recentlyViewed, setRecentlyViewed] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((item) => {
        const mediaType = resolveItemMediaType(item);
        return {
          ...item,
          mediaType: mediaType || item.mediaType || null,
          media_type: mediaType || item.media_type || null
        };
      });
    } catch (e) {
      console.warn('Failed to load recently viewed:', e.message);
      return [];
    }
  });

  const addToRecentlyViewed = useCallback((movie) => {
    if (!movie || !movie.id) return;

    const resolvedType = resolveItemMediaType(movie);

    setRecentlyViewed((prev) => {
      const filtered = prev.filter((m) => m.id !== movie.id);
      const updated = [
        {
          id: movie.id,
          title: movie.title || movie.name,
          poster: movie.poster,
          backdrop: movie.backdrop,
          year: movie.year,
          rating: movie.rating,
          quality: movie.quality,
          genre: movie.genre,
          language: movie.language,
          seasons: movie.seasons || null,
          mediaType: resolvedType,
          media_type: resolvedType,
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
