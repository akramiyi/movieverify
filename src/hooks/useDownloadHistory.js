import { useState, useCallback } from 'react';

const STORAGE_KEY = 'movieverify_download_history';
const MAX_ITEMS = 50;

export const useDownloadHistory = () => {
  const [history, setHistory] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.warn('Failed to load download history:', e.message);
      return [];
    }
  });

  const addToHistory = useCallback((movieTitle, quality) => {
    const entry = {
      id: `${movieTitle}-${quality}-${Date.now()}`,
      movieTitle,
      quality,
      downloadedAt: Date.now(),
    };

    setHistory((prev) => {
      const updated = [entry, ...prev].slice(0, MAX_ITEMS);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (e) {
        console.warn('Failed to save download history:', e.message);
      }
      return updated;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to clear download history:', e.message);
    }
  }, []);

  return { history, addToHistory, clearHistory };
};
