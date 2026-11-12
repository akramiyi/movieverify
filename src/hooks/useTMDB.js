import { useState, useEffect } from 'react';
import { supabase } from '../data/supabaseClient';
import staticDownloadLinks from '../data/downloadLinks';
import { movies as localMovies } from '../data/movies';

const API_URL = import.meta.env.VITE_API_URL || 'https://movieverify-backend.onrender.com';
const BASE_URL = `${API_URL}/api/tmdb`;
// Support optional Backend/Cloudflare Image Proxy or direct TMDB CDN
const IMG_BASE = import.meta.env.VITE_USE_IMAGE_PROXY === 'true'
  ? `${API_URL}/api/image`
  : 'https://image.tmdb.org/t/p';

const GENRE_MAP = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Science Fiction",
  10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
  10759: "Action & Adventure", 10762: "Kids", 10763: "News", 10764: "Reality",
  10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics"
};

const headers = {
  'Content-Type': 'application/json',
  ...(import.meta.env.VITE_TMDB_TOKEN ? { Authorization: `Bearer ${import.meta.env.VITE_TMDB_TOKEN}` } : {})
};



export const activeLinks = { ...staticDownloadLinks };

export const getMediaTypeFromId = (id) => {
  const parsedId = parseInt(String(id).split('-')[0], 10);
  if (isNaN(parsedId) || parsedId <= 0) return null;

  const idStr = String(id || '');
  const hasTvSuffix = idStr.includes('-tv');
  const hasMovieSuffix = idStr.includes('-movie');
  if (hasTvSuffix && hasMovieSuffix) return null;
  if (hasTvSuffix) return 'tv';
  if (hasMovieSuffix) return 'movie';

  // Check download-link keys: if both TV and Movie entries exist for one ID, treat as ambiguous
  const hasTvLink = !!(activeLinks && activeLinks[`${parsedId}-tv`]);
  const hasMovieLink = !!(activeLinks && activeLinks[`${parsedId}-movie`]);
  if (hasTvLink && hasMovieLink) {
    return null;
  }
  if (hasTvLink) return 'tv';
  if (hasMovieLink) return 'movie';

  const localMatch = localMovies.find(m => String(m.id) === String(parsedId) || String(m.id) === `${parsedId}-tv` || String(m.id) === `${parsedId}-movie`);
  if (localMatch) {
    if (localMatch.mediaType === 'tv' || localMatch.mediaType === 'movie') return localMatch.mediaType;
    if (localMatch.media_type === 'tv' || localMatch.media_type === 'movie') return localMatch.media_type;
    if (localMatch.seasons && Array.isArray(localMatch.seasons) && localMatch.seasons.length > 0) return 'tv';
    if (localMatch.genre && (
      localMatch.genre.toLowerCase().includes('web series') ||
      localMatch.genre.toLowerCase().includes('tv series')
    )) {
      return 'tv';
    }
    // Fail-closed: untyped local catalog records return null (no implicit fallback)
    return null;
  }

  return null;
};

const tmdbCache = new Map();
let supabaseCachePromise = null;
let supabaseCacheData = null;

// Helper to merge local download links with priority
export const getDownloadLinks = (movieId, movieTitle) => {
  if (activeLinks[movieId]) {
    return activeLinks[movieId];
  }
  if (activeLinks[`${movieId}-movie`]) {
    return activeLinks[`${movieId}-movie`];
  }
  if (activeLinks[`${movieId}-tv`]) {
    return activeLinks[`${movieId}-tv`];
  }

  const localMatch = localMovies.find(
    (m) => String(m.id) === String(movieId) || (m.title && movieTitle && m.title.toLowerCase() === movieTitle.toLowerCase())
  );
  if (localMatch) {
    return {
      download480p: localMatch.download480p || null,
      download720p: localMatch.download720p || null,
      download1080p: localMatch.download1080p || null,
      seasons: localMatch.seasons || null
    };
  }

  return {
    download480p: null,
    download720p: null,
    download1080p: null
  };
};

export const formatMovie = (m) => {
  const id = m.id;
  const title = m.title || m.name || 'Untitled';

  const poster = m.poster_path
    ? `${IMG_BASE}/w342${m.poster_path}`
    : null;

  const backdrop = m.backdrop_path
    ? `${IMG_BASE}/w1280${m.backdrop_path}`
    : null;

  const original_backdrop = m.backdrop_path
    ? `${IMG_BASE}/w1280${m.backdrop_path}`
    : null;

  const year =
    m.release_date?.slice(0, 4) ||
    m.first_air_date?.slice(0, 4) ||
    'N/A';

  const language = m.original_language
    ? m.original_language.toUpperCase()
    : 'N/A';

  const quality = '1080p';

  let genre = '';
  if (Array.isArray(m.genres)) {
    genre = m.genres.map(g => g.name || g).filter(Boolean).join(', ');
  } else if (Array.isArray(m.genre_names)) {
    genre = m.genre_names.join(', ');
  } else if (Array.isArray(m.genre_ids)) {
    genre = m.genre_ids.map(id => GENRE_MAP[id]).filter(Boolean).join(', ');
  } else if (typeof m.genre === 'string') {
    genre = m.genre;
  }

  const rating =
    typeof m.vote_average === 'number'
      ? m.vote_average.toFixed(1)
      : 'N/A';
  const links = getDownloadLinks(id, title);

  const description = links.description || m.overview || '';

  const resolvedMediaType = (
    m.media_type ||
    m.mediaType ||
    (String(id).includes('-tv') ? 'tv' : null) ||
    (String(id).includes('-movie') ? 'movie' : null) ||
    (m.first_air_date ? 'tv' : null) ||
    (m.release_date ? 'movie' : null) ||
    getMediaTypeFromId(id) ||
    null
  );

  return {
    id,
    title,
    poster,
    backdrop,
    original_backdrop,
    year,
    language,
    quality,
    genre,
    rating,
    description,
    trailerUrl: null,
    download480p: links.download480p || null,
    download720p: links.download720p || null,
    download1080p: links.download1080p || null,
    seasons: links.seasons || null,
    featured: false,
    trending: false,
    latest: false,
    mediaType: resolvedMediaType
  };
};

const prioritizeDownloads = (list) => {
  return list.sort((a, b) => {
    const aHas = !!(a.download480p || a.download720p || a.download1080p || a.seasons);
    const bHas = !!(b.download480p || b.download720p || b.download1080p || b.seasons);
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    return 0;
  });
};

// In-memory feed promise & cache to deduplicate concurrent requests across hooks
let homeFeedPromise = null;
let inMemoryFeed = null;

export const fetchHomeFeed = async () => {
  if (inMemoryFeed) return inMemoryFeed;
  if (homeFeedPromise) return homeFeedPromise;

  homeFeedPromise = (async () => {
    // 1. Try localStorage / sessionStorage cache first (4h TTL)
    try {
      let stored = null;
      if (typeof localStorage !== 'undefined') {
        stored = localStorage.getItem('movieverify_home_feed_v1');
      }
      if (!stored && typeof sessionStorage !== 'undefined') {
        stored = sessionStorage.getItem('movieverify_home_feed_v1');
      }
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.data && (Date.now() - parsed.timestamp < 14400000)) {
          inMemoryFeed = parsed.data;
          return parsed.data;
        }
      }
    } catch {}

    // 2. Fetch single consolidated home feed (with 4.5s resilience timeout for slow networks)
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), 4500) : null;

      let res = await fetch('/api/home-feed', controller ? { signal: controller.signal } : {}).catch(() => null);
      if (!res || !res.ok) {
        res = await fetch(`${API_URL}/api/home-feed`, controller ? { signal: controller.signal } : {}).catch(() => null);
      }
      if (timeoutId) clearTimeout(timeoutId);

      if (res && res.ok) {
        const feed = await res.json();
        if (feed && (feed.trending || feed.popular)) {
          inMemoryFeed = feed;
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('movieverify_home_feed_v1', JSON.stringify({
                timestamp: Date.now(),
                data: feed
              }));
            }
          } catch {}
          try {
            if (typeof sessionStorage !== 'undefined') {
              sessionStorage.setItem('movieverify_home_feed_v1', JSON.stringify({
                timestamp: Date.now(),
                data: feed
              }));
            }
          } catch {}
          return feed;
        }
      }
    } catch (e) {
      console.warn('Bundled home-feed fetch failed or timed out, will fallback gracefully:', e);
    }
    return null;
  })();

  const result = await homeFeedPromise;
  homeFeedPromise = null;
  return result;
};

// Reusable fetch helper
const fetchTMDB = async (endpoint) => {
  const cacheKey = `tmdb_cache_${endpoint}`;

  if (tmdbCache.has(endpoint)) {
    return tmdbCache.get(endpoint);
  }

  try {
    if (typeof sessionStorage !== 'undefined') {
      const sessionCached = sessionStorage.getItem(cacheKey);
      if (sessionCached) {
        const data = JSON.parse(sessionCached);
        tmdbCache.set(endpoint, data);
        return data;
      }
    }
  } catch (e) {
    console.error('sessionStorage read failed', e);
  }

  const reqHeaders = {
    'Content-Type': 'application/json'
  };
  const token = import.meta.env?.VITE_TMDB_TOKEN;
  if (token) {
    reqHeaders['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: reqHeaders
  });

  if (!response.ok) {
    if (response.status === 404) {
      console.warn(`TMDB ID not found at ${endpoint}, skipping`);
      return null;
    }
    throw new Error(`TMDB request failed with status: ${response.status}`);
  }

  const data = await response.json();
  tmdbCache.set(endpoint, data);

  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(cacheKey, JSON.stringify(data));
    }
  } catch (e) {
    console.warn('sessionStorage set failed (quota exceeded?)', e);
  }

  return data;
};

const fetchMetadataForIds = async (ids, alreadyFetchedList) => {
  const results = [];
  const idsToFetch = [];

  for (const idStr of ids) {
    const parsedId = parseInt(idStr.split('-')[0], 10);
    if (isNaN(parsedId)) continue;

    const existing = alreadyFetchedList.find(m => String(m.id) === String(parsedId))
      || localMovies.find(m => String(m.id) === String(parsedId));

    if (existing) {
      results.push(existing.quality ? existing : formatMovie(existing));
    } else {
      idsToFetch.push(idStr);
    }
  }

  // Guard: Cap external individual metadata fetches to at most 6 to prevent N+1 network storms on homepage
  const cappedBatch = idsToFetch.slice(0, 6);

  if (cappedBatch.length > 0) {
    const batchResults = await Promise.all(
      cappedBatch.map(async (idStr) => {
        const parsedId = parseInt(idStr.split('-')[0], 10);
        const mediaType = idStr.includes('-tv')
          ? 'tv'
          : (idStr.includes('-movie')
            ? 'movie'
            : getMediaTypeFromId(parsedId));

        if (!mediaType) {
          return null;
        }

        try {
          let item = await fetchTMDB(`/${mediaType}/${parsedId}`);
          if (item) {
            item.media_type = mediaType;
            return formatMovie(item);
          }
        } catch (e) {
          console.warn(`Failed to fetch metadata for TMDB ID: ${parsedId} (${mediaType})`, e.message);
        }
        return null;
      })
    );

    results.push(...batchResults.filter(Boolean));
  }

  return results;
};

const getInitialTMDBData = () => {
  let stored = null;
  try {
    if (typeof localStorage !== 'undefined') {
      stored = localStorage.getItem('movieverify_home_feed_v1');
    }
  } catch {}
  if (!stored) {
    try {
      if (typeof sessionStorage !== 'undefined') {
        stored = sessionStorage.getItem('movieverify_home_feed_v1');
      }
    } catch {}
  }

  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.data && (Date.now() - parsed.timestamp < 14400000)) {
        const feed = parsed.data;
        const trendingList = (feed.trending || []).map(item => {
          const mType = item.media_type || (item.first_air_date ? 'tv' : (item.release_date ? 'movie' : getMediaTypeFromId(item.id)));
          return formatMovie({ ...item, media_type: mType });
        });
        const popularList = (feed.popular || []).map(item => formatMovie({ ...item, media_type: 'movie' }));
        const bollywoodList = (feed.bollywood || []).map(item => formatMovie({ ...item, media_type: 'movie' }));
        const southIndianList = (feed.southIndian || []).map(item => formatMovie({ ...item, media_type: 'movie' }));
        const webSeriesList = (feed.webSeries || []).map(item => formatMovie({ ...item, media_type: 'tv' }));

        const allItems = [...trendingList, ...popularList, ...bollywoodList];
        const seenIds = new Set();
        const featuredList = [];
        allItems.forEach(m => {
          if (m.backdrop && m.description && !seenIds.has(String(m.id))) {
            seenIds.add(String(m.id));
            featuredList.push(m);
          }
        });
        featuredList.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

        if (trendingList.length > 0 || featuredList.length > 0) {
          return {
            data: {
              trending: trendingList,
              popular: popularList,
              bollywood: bollywoodList,
              southIndian: southIndianList,
              webSeries: webSeriesList,
              featured: featuredList.slice(0, 8),
              downloadAvailable: []
            },
            isLoading: false
          };
        }
      }
    } catch {}
  }
  return {
    data: {
      trending: [],
      popular: [],
      bollywood: [],
      southIndian: [],
      webSeries: [],
      featured: [],
      downloadAvailable: []
    },
    isLoading: true
  };
};

export const useTMDB = () => {
  const initial = getInitialTMDBData();
  const [data, setData] = useState(initial.data);
  const [isLoading, setIsLoading] = useState(initial.isLoading);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    const fetchAllData = async () => {
      try {
        setIsLoading(true);

        try {
          if (!supabaseCachePromise && !supabaseCacheData) {
            supabaseCachePromise = supabase.from('download_links').select('*');
          }

          const { data: dbData, error: dbErr } = supabaseCacheData
            ? { data: supabaseCacheData, error: null }
            : await supabaseCachePromise;

          if (!dbErr && dbData) {
            supabaseCacheData = dbData;
            dbData.forEach(row => {
              activeLinks[row.id] = {
                download480p: row.download480p || null,
                download720p: row.download720p || null,
                download1080p: row.download1080p || null,
                description: row.description || null,
                seasons: row.seasons || null
              };
            });
          }
        } catch {
          // Gracefully relying on static local download links
        }

        let trendingRaw = [];
        let popularRaw = [];
        let bollywoodRaw = [];
        let teluguRaw = [];
        let tamilRaw = [];
        let kannadaRaw = [];
        let malayalamRaw = [];
        let webSeriesRaw = [];

        const feed = await fetchHomeFeed();
        if (feed) {
          trendingRaw = feed.trending || [];
          popularRaw = feed.popular || [];
          bollywoodRaw = feed.bollywood || [];
          teluguRaw = feed.telugu || [];
          tamilRaw = feed.tamil || [];
          kannadaRaw = feed.kannada || [];
          malayalamRaw = feed.malayalam || [];
          webSeriesRaw = feed.webSeries || [];
        } else {
          const [
            trendingRes,
            popularRes,
            bollywoodRes,
            teluguRes,
            tamilRes,
            kannadaRes,
            malayalamRes,
            webSeriesRes
          ] = await Promise.all([
            fetchTMDB('/trending/all/week'),
            fetchTMDB('/movie/popular?language=en-US&page=1'),
            fetchTMDB('/discover/movie?with_original_language=hi&sort_by=popularity.desc&page=1'),
            fetchTMDB('/discover/movie?with_original_language=te&sort_by=popularity.desc&page=1'),
            fetchTMDB('/discover/movie?with_original_language=ta&sort_by=popularity.desc&page=1'),
            fetchTMDB('/discover/movie?with_original_language=kn&sort_by=popularity.desc&page=1'),
            fetchTMDB('/discover/movie?with_original_language=ml&sort_by=popularity.desc&page=1'),
            fetchTMDB('/tv/popular?language=en-US&page=1')
          ]);
          trendingRaw = trendingRes?.results || [];
          popularRaw = popularRes?.results || [];
          bollywoodRaw = bollywoodRes?.results || [];
          teluguRaw = teluguRes?.results || [];
          tamilRaw = tamilRes?.results || [];
          kannadaRaw = kannadaRes?.results || [];
          malayalamRaw = malayalamRes?.results || [];
          webSeriesRaw = webSeriesRes?.results || [];
        }

        const trendingList = trendingRaw.map(item => {
          const mType = item.media_type || (item.first_air_date ? 'tv' : (item.release_date ? 'movie' : getMediaTypeFromId(item.id)));
          return formatMovie({ ...item, media_type: mType });
        });
        const popularList = popularRaw.map(item => formatMovie({ ...item, media_type: 'movie' }));
        const bollywoodList = bollywoodRaw.map(item => formatMovie({ ...item, media_type: 'movie' }));

        const mergedSouth = [
          ...teluguRaw,
          ...tamilRaw,
          ...kannadaRaw,
          ...malayalamRaw
        ];

        const uniqueSouthMap = new Map();
        mergedSouth.forEach(item => {
          uniqueSouthMap.set(item.id, item);
        });

        const southIndianList = Array.from(uniqueSouthMap.values())
          .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
          .map(item => formatMovie({ ...item, media_type: 'movie' }));

        const webSeriesList = webSeriesRaw.map(item => formatMovie({ ...item, media_type: 'tv' }));

        const allFetchedSoFar = [
          ...trendingList,
          ...popularList,
          ...bollywoodList,
          ...southIndianList,
          ...webSeriesList
        ];

        // Deduplicate and filter master pool of all categories for Hero Section
        const uniqueHeroPool = [];
        const seenHeroIds = new Set();
        allFetchedSoFar.forEach(m => {
          if (m.backdrop && m.description) {
            const key = String(m.id);
            if (!seenHeroIds.has(key)) {
              seenHeroIds.add(key);
              uniqueHeroPool.push(m);
            }
          }
        });

        // Consistent featured sorting: prioritize highest popularity to eliminate hero flickers
        const featuredList = uniqueHeroPool
          .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
          .slice(0, 8);

        // Resolve Download Available Movies (combines activeLinks keys + local movies with links)
        const downloadAvailableIds = Object.keys(activeLinks).filter(id => {
          const links = activeLinks[id];
          return !!(links.download480p || links.download720p || links.download1080p || links.seasons);
        });

        // Also add any local movies from movies.js that have download links to the fetch list
        localMovies.forEach(m => {
          const hasLocalLink = !!(m.download480p || m.download720p || m.download1080p || m.seasons);
          if (hasLocalLink && !downloadAvailableIds.some(id => String(id) === String(m.id) || String(id).startsWith(String(m.id) + '-'))) {
            const mType = (
              m.mediaType ||
              m.media_type ||
              (String(m.id).includes('-tv') ? 'tv' : null) ||
              (String(m.id).includes('-movie') ? 'movie' : null) ||
              (m.seasons && m.seasons.length > 0 ? 'tv' : null) ||
              (m.first_air_date ? 'tv' : null) ||
              (m.genre && (m.genre.toLowerCase().includes('web series') || m.genre.toLowerCase().includes('tv series')) ? 'tv' : null) ||
              getMediaTypeFromId(m.id) ||
              (m.release_date ? 'movie' : null) ||
              null
            );
            if (mType) {
              downloadAvailableIds.push(`${m.id}-${mType}`);
            }
          }
        });

        // Unblock UI immediately by setting the core lists
        if (active) {
          setData({
            trending: prioritizeDownloads(trendingList),
            popular: prioritizeDownloads(popularList),
            bollywood: prioritizeDownloads(bollywoodList),
            southIndian: prioritizeDownloads(southIndianList),
            webSeries: prioritizeDownloads(webSeriesList),
            featured: prioritizeDownloads(featuredList),
            downloadAvailable: []
          });
          setIsLoading(false);
        }

        const resolvedList = await fetchMetadataForIds(downloadAvailableIds, allFetchedSoFar);

        // Inject the download links for the local movies that were just fetched
        localMovies.forEach(m => {
          const hasLocalLink = !!(m.download480p || m.download720p || m.download1080p || m.seasons);
          if (hasLocalLink) {
            const mType = m.mediaType || (m.seasons && m.seasons.length > 0 ? 'tv' : null) || getMediaTypeFromId(m.id);
            const fetchedItem = resolvedList.find(r => String(r.id) === String(m.id) && (!mType || r.mediaType === mType));
            if (fetchedItem) {
              fetchedItem.download480p = m.download480p || fetchedItem.download480p;
              fetchedItem.download720p = m.download720p || fetchedItem.download720p;
              fetchedItem.download1080p = m.download1080p || fetchedItem.download1080p;
              fetchedItem.seasons = m.seasons || fetchedItem.seasons;
              if (mType) {
                fetchedItem.mediaType = mType;
              }
            }
          }
        });

        // Deduplicate resolvedList by id
        const deduplicatedDownloads = [];
        const seenIds = new Set();
        resolvedList.forEach(movie => {
          const key = String(movie.id);
          if (!seenIds.has(key)) {
            seenIds.add(key);
            deduplicatedDownloads.push(movie);
          }
        });

        if (active) {
          setData(prev => ({
            ...prev,
            downloadAvailable: deduplicatedDownloads
          }));
          setError(null);
        }
      } catch (err) {
        console.error('Error fetching TMDB data:', err);
        if (active) {
          setError('Unable to load movie data. Please try again.');
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    fetchAllData();

    return () => {
      active = false;
    };
  }, []);

  return { ...data, isLoading, error };
};

// Search Helper with debugging logs
export const searchTMDB = async (query) => {
  if (!query?.trim()) return [];

  const url =
    `${BASE_URL}/search/multi?query=${encodeURIComponent(query.trim())}` +
    `&language=en-US&page=1&include_adult=false`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.warn('TMDB Search Warning:', res.status, errorText);
      return [];
    }

    const data = await res.json();

    if (!Array.isArray(data.results)) {
      return [];
    }

    const results = data.results
      .filter(item =>
        item.media_type === 'movie' ||
        item.media_type === 'tv'
      )
      .map(item => {
        const mType = item.media_type || (item.first_air_date ? 'tv' : (item.release_date ? 'movie' : null));
        return formatMovie({
          ...item,
          media_type: mType
        });
      });

    return prioritizeDownloads(results);

  } catch (error) {
    console.error('TMDB search request failed:', error);
    return [];
  }
};

// Details Fetch Helper
export const fetchTMDBDetails = async (id, mediaType) => {
  const parsedId = parseInt(String(id).split('-')[0], 10);
  if (isNaN(parsedId) || parsedId <= 0) {
    return {
      runtime: null,
      cast: 'Placeholder Actor 1, Placeholder Actor 2',
      trailerUrl: ''
    };
  }

  // Accept only explicitly verified 'movie' or 'tv', or attempt trusted ID/catalog resolution
  let resolvedType = null;
  if (mediaType === 'tv' || mediaType === 'movie') {
    resolvedType = mediaType;
  } else {
    const fromId = getMediaTypeFromId(id);
    if (fromId === 'tv' || fromId === 'movie') {
      resolvedType = fromId;
    }
  }

  // If still ambiguous, return safe empty details without making a speculative TMDB request
  if (!resolvedType) {
    return {
      runtime: null,
      cast: 'Placeholder Actor 1, Placeholder Actor 2',
      trailerUrl: ''
    };
  }

  try {
    const endpoint = `/${resolvedType}/${parsedId}?append_to_response=credits,videos&include_video_language=en,hi,te,ta,ml,null`;

    const res = await fetchTMDB(endpoint);
    if (!res) {
      return {
        runtime: null,
        cast: 'Placeholder Actor 1, Placeholder Actor 2',
        trailerUrl: ''
      };
    }

    let trailerUrl = '';
    if (res.videos && res.videos.results && res.videos.results.length > 0) {
      const youtubeVideos = res.videos.results.filter(v => v.site === 'YouTube');
      if (youtubeVideos.length > 0) {
        const trailer = youtubeVideos.find(v => v.type === 'Trailer') ||
                        youtubeVideos.find(v => v.type === 'Teaser') ||
                        youtubeVideos[0];
        trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
      }
    }

    const castList = (res.credits && res.credits.cast && res.credits.cast.length > 0)
      ? res.credits.cast.slice(0, 5).map(c => c.name).join(', ')
      : 'Placeholder Actor 1, Placeholder Actor 2';

    return {
      runtime: res.runtime || (res.episode_run_time ? res.episode_run_time[0] : null),
      cast: castList,
      trailerUrl,
      title: res.title || res.name || null,
      overview: res.overview || null,
      backdrop: res.backdrop_path ? `${IMG_BASE}/w1280${res.backdrop_path}` : null,
      poster: res.poster_path ? `${IMG_BASE}/w780${res.poster_path}` : null,
    };
  } catch (err) {
    console.error('Error fetching TMDB details:', err);
    return {
      runtime: null,
      cast: 'Placeholder Actor 1, Placeholder Actor 2',
      trailerUrl: '',
      title: null,
      overview: null,
      backdrop: null,
      poster: null,
    };
  }
};

// Fetch individual Movie or TV title by ID and media type for deep linking
export const fetchMovieOrTVById = async (id, requestedType = null) => {
  const parsedId = parseInt(String(id).split('-')[0], 10);
  if (isNaN(parsedId) || parsedId <= 0) return null;

  let primaryType = null;
  let secondaryType = null;

  if (requestedType === 'tv') {
    primaryType = 'tv';
    secondaryType = null;
  } else if (requestedType === 'movie') {
    primaryType = 'movie';
    secondaryType = null;
  } else {
    // Legacy link or un-typed link (e.g. ?movie=71446 or ?id=71446)
    const knownType = getMediaTypeFromId(parsedId);
    if (knownType === 'tv') {
      primaryType = 'tv';
      secondaryType = 'movie';
    } else if (knownType === 'movie') {
      primaryType = 'movie';
      secondaryType = 'tv';
    } else {
      primaryType = 'movie';
      secondaryType = 'tv';
    }
  }

  let item = null;
  let resolvedType = primaryType;

  try {
    item = await fetchTMDB(`/${primaryType}/${parsedId}`);
  } catch (e) {
    console.warn(`Failed to fetch /${primaryType}/${parsedId}:`, e.message);
  }

  if (!item && secondaryType) {
    try {
      item = await fetchTMDB(`/${secondaryType}/${parsedId}`);
      if (item) {
        resolvedType = secondaryType;
      }
    } catch (e) {
      console.warn(`Failed fallback fetch /${secondaryType}/${parsedId}:`, e.message);
    }
  }

  if (!item) {
    const localMatch = localMovies.find(m => {
      const cleanLocalId = String(m.id).split('-')[0];
      if (cleanLocalId !== String(parsedId)) return false;
      const isTv = m.mediaType === 'tv' || (m.seasons && m.seasons.length > 0) || (m.genre && (m.genre.toLowerCase().includes('web series') || m.genre.toLowerCase().includes('tv series')));
      const localType = m.mediaType || (isTv ? 'tv' : 'movie');
      if (requestedType && localType !== requestedType) return false;
      return true;
    });
    if (localMatch) {
      const isTv = localMatch.mediaType === 'tv' || (localMatch.seasons && localMatch.seasons.length > 0) || (localMatch.genre && (localMatch.genre.toLowerCase().includes('web series') || localMatch.genre.toLowerCase().includes('tv series')));
      const finalType = localMatch.mediaType || (isTv ? 'tv' : 'movie');
      return {
        ...localMatch,
        mediaType: finalType,
        media_type: finalType
      };
    }
    return null;
  }

  item.media_type = resolvedType;
  const formatted = formatMovie(item);
  return {
    ...formatted,
    mediaType: resolvedType,
    media_type: resolvedType
  };
};
