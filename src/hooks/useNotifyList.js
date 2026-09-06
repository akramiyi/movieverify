import { useState, useCallback } from 'react';

const STORAGE_KEY = 'movieverify_notify_list';

export const useNotifyList = () => {
  const [notifyList, setNotifyList] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.warn('Failed to load notify list:', e.message);
      return [];
    }
  });

  const toggleNotify = useCallback((movie) => {
    if (!movie || !movie.id) return;
    setNotifyList((prev) => {
      const exists = prev.some((m) => m.id === movie.id);
      const updated = exists
        ? prev.filter((m) => m.id !== movie.id)
        : [...prev, { id: movie.id, title: movie.title, addedAt: Date.now() }];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (e) {
        console.warn('Failed to save notify list:', e.message);
      }
      return updated;
    });
  }, []);

  const isNotifying = useCallback(
    (movieId) => notifyList.some((m) => m.id === movieId),
    [notifyList]
  );

  return { notifyList, toggleNotify, isNotifying };
};
