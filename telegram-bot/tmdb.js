const { TMDB_TOKEN } = require('./config');

const BASE_URL = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p';

const headers = {
  Authorization: `Bearer ${TMDB_TOKEN}`,
  'Content-Type': 'application/json'
};

// Simple in-memory cache (key → { data, timestamp })
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const getCached = (key) => {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data;
  }
  cache.delete(key);
  return null;
};

const setCache = (key, data) => {
  cache.set(key, { data, timestamp: Date.now() });
  // Prevent unbounded growth
  if (cache.size > 500) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
};

/**
 * Search TMDB for movies and TV shows
 * @param {string} query 
 * @returns {Array} formatted results
 */
const searchMoviesAndTV = async (query) => {
  if (!query?.trim()) return [];

  const cacheKey = `search:${query.trim().toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/search/multi?query=${encodeURIComponent(query.trim())}&language=en-US&page=1&include_adult=false`;

  try {
    const res = await fetch(url, { headers });

    if (res.status === 429) {
      console.warn('TMDB rate limited. Waiting 2s...');
      await new Promise(r => setTimeout(r, 2000));
      const retryRes = await fetch(url, { headers });
      if (!retryRes.ok) return [];
      const retryData = await retryRes.json();
      const results = formatResults(retryData.results);
      setCache(cacheKey, results);
      return results;
    }

    if (!res.ok) {
      console.error('TMDB search error:', res.status);
      return [];
    }

    const data = await res.json();
    const results = formatResults(data.results);
    setCache(cacheKey, results);
    return results;
  } catch (err) {
    console.error('TMDB search failed:', err.message);
    return [];
  }
};

/**
 * Get details for a specific movie or TV show
 * @param {number|string} tmdbId 
 * @param {string} mediaType - 'movie' or 'tv'
 */
const getDetails = async (tmdbId, mediaType) => {
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  const cacheKey = `details:${type}:${tmdbId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const url = `${BASE_URL}/${type}/${tmdbId}?language=en-US`;
    const res = await fetch(url, { headers });

    if (!res.ok) {
      console.error(`TMDB details error for ${type}/${tmdbId}:`, res.status);
      return null;
    }

    const data = await res.json();
    const result = {
      id: data.id,
      title: data.title || data.name || 'Untitled',
      year: (data.release_date || data.first_air_date || '').slice(0, 4) || 'N/A',
      mediaType: type,
      overview: data.overview || '',
      rating: data.vote_average ? data.vote_average.toFixed(1) : 'N/A',
      poster: data.poster_path ? `${IMG_BASE}/w342${data.poster_path}` : null,
      language: data.original_language ? data.original_language.toUpperCase() : 'N/A'
    };

    setCache(cacheKey, result);
    return result;
  } catch (err) {
    console.error('TMDB details failed:', err.message);
    return null;
  }
};

/**
 * Format raw TMDB search results into clean objects
 */
const formatResults = (results) => {
  if (!Array.isArray(results)) return [];

  return results
    .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
    .slice(0, 8) // Limit results for Telegram display
    .map(item => ({
      id: item.id,
      title: item.title || item.name || 'Untitled',
      year: (item.release_date || item.first_air_date || '').slice(0, 4) || 'N/A',
      mediaType: item.media_type,
      poster: item.poster_path ? `${IMG_BASE}/w342${item.poster_path}` : null,
      rating: item.vote_average ? item.vote_average.toFixed(1) : 'N/A',
      overview: (item.overview || '').slice(0, 200),
      language: item.original_language ? item.original_language.toUpperCase() : 'N/A'
    }));
};

module.exports = {
  searchMoviesAndTV,
  getDetails,
  IMG_BASE
};
