import { useState, useEffect } from 'react';
import { supabase } from '../data/supabaseClient';
import staticDownloadLinks from '../data/downloadLinks';
import { movies as localMovies } from '../data/movies';

const BASE_URL = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p';

const GENRE_MAP = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Science Fiction",
  10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
  10759: "Action & Adventure", 10762: "Kids", 10763: "News", 10764: "Reality",
  10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics"
};

const headers = {
  Authorization: `Bearer ${import.meta.env.VITE_TMDB_TOKEN}`,
  'Content-Type': 'application/json'
};

// Console audit for production credentials validation
console.log(
  'TMDB token configured:',
  Boolean(import.meta.env.VITE_TMDB_TOKEN)
);

export const activeLinks = { ...staticDownloadLinks };

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
    ? `${IMG_BASE}/w500${m.poster_path}`
    : null;

  const backdrop = m.backdrop_path
    ? `${IMG_BASE}/original${m.backdrop_path}`
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
  if (Array.isArray(m.genre_names)) {
    genre = m.genre_names.join(', ');
  } else if (Array.isArray(m.genre_ids)) {
    genre = m.genre_ids.map(id => GENRE_MAP[id]).filter(Boolean).join(', ');
  }

  const rating =
    typeof m.vote_average === 'number'
      ? m.vote_average.toFixed(1)
      : 'N/A';

  const description = m.overview || '';

  const links = getDownloadLinks(id, title);

  return {
    id,
    title,
    poster,
    backdrop,
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
    mediaType: m.media_type || (m.first_air_date ? 'tv' : 'movie')
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

// Reusable fetch helper
const fetchTMDB = async (endpoint) => {
  const token = import.meta.env.VITE_TMDB_TOKEN;
  if (!token) {
    throw new Error('VITE_TMDB_TOKEN environment variable is not defined.');
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers
  });

  if (!response.ok) {
    throw new Error(`TMDB request failed with status: ${response.status}`);
  }

  return response.json();
};

const fetchMetadataForIds = async (ids, alreadyFetchedList) => {
  const result = [];
  for (const idStr of ids) {
    const parsedId = parseInt(idStr.split('-')[0], 10);
    const mediaType = idStr.includes('-tv') ? 'tv' : 'movie';
    
    if (isNaN(parsedId)) continue;
    
    const existing = alreadyFetchedList.find(m => String(m.id) === String(parsedId));
    if (existing) {
      result.push(existing);
      continue;
    }
    
    try {
      let item = await fetchTMDB(`/${mediaType}/${parsedId}`);
      if (item) {
        item.media_type = mediaType;
        result.push(formatMovie(item));
      }
    } catch (e) {
      console.error(`Failed to fetch metadata for TMDB ID: ${parsedId} (${mediaType})`, e);
    }
  }
  return result;
};

export const useTMDB = () => {
  const [data, setData] = useState({
    trending: [],
    popular: [],
    bollywood: [],
    southIndian: [],
    webSeries: [],
    featured: [],
    downloadAvailable: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    const fetchAllData = async () => {
      try {
        setIsLoading(true);

        try {
          const { data: dbData, error: dbErr } = await supabase
            .from('download_links')
            .select('*');
          
          if (dbErr) {
            console.error('Supabase load error:', dbErr);
          } else if (dbData) {
            dbData.forEach(row => {
              activeLinks[row.id] = {
                download480p: row.download480p || null,
                download720p: row.download720p || null,
                download1080p: row.download1080p || null,
                seasons: row.seasons || null
              };
            });
          }
        } catch (e) {
          console.error('Supabase fetch failed, relying on local config:', e);
        }
        
        const trendingRes = await fetchTMDB('/trending/all/week');
        const trendingList = (trendingRes.results || []).map(formatMovie);

        const popularRes = await fetchTMDB('/movie/popular?language=en-US&page=1');
        const popularList = (popularRes.results || []).map(formatMovie);

        const bollywoodRes = await fetchTMDB('/discover/movie?with_original_language=hi&sort_by=popularity.desc&page=1');
        const bollywoodList = (bollywoodRes.results || []).map(formatMovie);

        const [teluguRes, tamilRes, kannadaRes, malayalamRes] = await Promise.all([
          fetchTMDB('/discover/movie?with_original_language=te&sort_by=popularity.desc&page=1'),
          fetchTMDB('/discover/movie?with_original_language=ta&sort_by=popularity.desc&page=1'),
          fetchTMDB('/discover/movie?with_original_language=kn&sort_by=popularity.desc&page=1'),
          fetchTMDB('/discover/movie?with_original_language=ml&sort_by=popularity.desc&page=1')
        ]);
        
        const mergedSouth = [
          ...(teluguRes.results || []),
          ...(tamilRes.results || []),
          ...(kannadaRes.results || []),
          ...(malayalamRes.results || [])
        ];
        
        const uniqueSouthMap = new Map();
        mergedSouth.forEach(item => {
          uniqueSouthMap.set(item.id, item);
        });
        
        const southIndianList = Array.from(uniqueSouthMap.values())
          .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
          .map(formatMovie);

        const webSeriesRes = await fetchTMDB('/tv/popular?language=en-US&page=1');
        const webSeriesList = (webSeriesRes.results || []).map(formatMovie);

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

        // Randomly shuffle to give a diverse cinematic layout
        const featuredList = uniqueHeroPool
          .sort(() => 0.5 - Math.random())
          .slice(0, 8);

        // Resolve Download Available Movies (combines activeLinks keys + local movies with links)
        const downloadAvailableIds = Object.keys(activeLinks).filter(id => {
          const links = activeLinks[id];
          return !!(links.download480p || links.download720p || links.download1080p || links.seasons);
        });

        const resolvedList = await fetchMetadataForIds(downloadAvailableIds, allFetchedSoFar);

        // Also add any local movies from movies.js that have download links
        localMovies.forEach(m => {
          const hasLocalLink = !!(m.download480p || m.download720p || m.download1080p || m.seasons);
          if (hasLocalLink && !resolvedList.some(r => String(r.id) === String(m.id) || r.title.toLowerCase() === m.title.toLowerCase())) {
            resolvedList.push({
              ...m,
              mediaType: m.seasons ? 'tv' : 'movie'
            });
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
          setData({
            trending: prioritizeDownloads(trendingList),
            popular: prioritizeDownloads(popularList),
            bollywood: prioritizeDownloads(bollywoodList),
            southIndian: prioritizeDownloads(southIndianList),
            webSeries: prioritizeDownloads(webSeriesList),
            featured: prioritizeDownloads(featuredList),
            downloadAvailable: deduplicatedDownloads
          });
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

  console.log('TMDB search query:', query);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers
    });

    console.log('TMDB response status:', res.status);

    if (!res.ok) {
      const errorText = await res.text();
      console.error('TMDB Search Error:', res.status, errorText);
      return [];
    }

    const data = await res.json();

    console.log('TMDB results count:', data.results?.length);

    if (!Array.isArray(data.results)) {
      console.error('Invalid TMDB search response:', data);
      return [];
    }

    const results = data.results
      .filter(item =>
        item.media_type === 'movie' ||
        item.media_type === 'tv'
      )
      .map(formatMovie);

    return prioritizeDownloads(results);

  } catch (error) {
    console.error('TMDB search request failed:', error);
    return [];
  }
};

// Details Fetch Helper
export const fetchTMDBDetails = async (id, mediaType) => {
  try {
    const type = mediaType === 'tv' ? 'tv' : 'movie';
    const response = await fetch(`${BASE_URL}/${type}/${id}?append_to_response=credits,videos&include_video_language=en,hi,te,ta,ml,null`, {
      headers
    });
    
    if (!response.ok) {
      throw new Error(`Details fetch failed: ${response.status}`);
    }
    
    const res = await response.json();
    
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

    const castList = (res.credits && res.credits.cast) 
      ? res.credits.cast.slice(0, 5).map(c => c.name).join(', ') 
      : 'Placeholder Actor 1, Placeholder Actor 2';

    return {
      runtime: res.runtime || (res.episode_run_time ? res.episode_run_time[0] : null),
      cast: castList,
      trailerUrl
    };
  } catch (err) {
    console.error('Error fetching TMDB details:', err);
    return {
      runtime: null,
      cast: 'Placeholder Actor 1, Placeholder Actor 2',
      trailerUrl: ''
    };
  }
};
