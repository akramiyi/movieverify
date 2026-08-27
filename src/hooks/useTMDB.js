import { useState, useEffect } from 'react';
import downloadLinks from '../data/downloadLinks';
import { movies as localMovies } from '../data/movies';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const GENRE_MAP = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Science Fiction",
  10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
  10759: "Action & Adventure", 10762: "Kids", 10763: "News", 10764: "Reality",
  10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics"
};

const LANG_MAP = {
  en: "English", hi: "Hindi", te: "Telugu", ta: "Tamil", kn: "Kannada", ml: "Malayalam", es: "Spanish", ja: "Japanese", ko: "Korean"
};

// Helper to merge local download links with priority
export const getDownloadLinks = (movieId, movieTitle) => {
  // Priority 1: Manual downloadLinks.js (match by TMDB ID)
  if (downloadLinks[movieId]) {
    return downloadLinks[movieId];
  }
  
  // Priority 2: Existing movies.js download links (match by ID or Title case-insensitive)
  const localMatch = localMovies.find(
    (m) => String(m.id) === String(movieId) || (m.title && movieTitle && m.title.toLowerCase() === movieTitle.toLowerCase())
  );
  if (localMatch) {
    return {
      download480p: localMatch.download480p || null,
      download720p: localMatch.download720p || null,
      download1080p: localMatch.download1080p || null,
      seasons: localMatch.seasons || null // Support TV shows seasons links
    };
  }
  
  // Priority 3: No download links
  return {
    download480p: null,
    download720p: null,
    download1080p: null
  };
};

const normalizeMovie = (item) => {
  const isTV = item.media_type === 'tv' || !!item.first_air_date;
  const id = item.id;
  const title = isTV ? item.name : item.title;
  
  let year = '';
  const dateStr = isTV ? item.first_air_date : item.release_date;
  if (dateStr) {
    year = new Date(dateStr).getFullYear() || '';
  }
  
  const rating = item.vote_average || 0;
  const language = LANG_MAP[item.original_language] || item.original_language || 'English';
  const quality = "1080p"; // Default MovieVerify presentation quality
  const genres = (item.genre_ids || []).map(id => GENRE_MAP[id]).filter(Boolean).join(", ") || (isTV ? 'Web Series' : 'Movie');
  
  const poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '';
  const backdrop = item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : poster;
  
  const links = getDownloadLinks(id, title);
  
  return {
    id,
    title,
    poster,
    backdrop,
    year,
    language,
    quality,
    genre: genres,
    rating,
    description: item.overview || '',
    trailerUrl: '',
    mediaType: isTV ? 'tv' : 'movie',
    ...links,
    featured: false,
    trending: false,
    latest: false
  };
};

// Reusable fetch helper
const fetchTMDB = async (endpoint) => {
  const token = import.meta.env.VITE_TMDB_TOKEN;
  if (!token) {
    throw new Error('VITE_TMDB_TOKEN environment variable is not defined.');
  }

  const response = await fetch(`${TMDB_BASE_URL}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`TMDB request failed with status: ${response.status}`);
  }

  return response.json();
};

export const useTMDB = () => {
  const [data, setData] = useState({
    trending: [],
    popular: [],
    bollywood: [],
    southIndian: [],
    webSeries: [],
    featured: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    const fetchAllData = async () => {
      try {
        setIsLoading(true);
        
        // 1. Fetch Trending
        const trendingRes = await fetchTMDB('/trending/all/week');
        const trendingList = (trendingRes.results || []).map(normalizeMovie);

        // 2. Fetch Popular
        const popularRes = await fetchTMDB('/movie/popular?language=en-US&page=1');
        const popularList = (popularRes.results || []).map(normalizeMovie);

        // 3. Fetch Bollywood
        const bollywoodRes = await fetchTMDB('/discover/movie?with_original_language=hi&sort_by=popularity.desc&page=1');
        const bollywoodList = (bollywoodRes.results || []).map(normalizeMovie);

        // 4. Fetch South Indian (Telugu, Tamil, Kannada, Malayalam)
        const [teluguRes, tamilRes, kannadaRes, malayalamRes] = await Promise.all([
          fetchTMDB('/discover/movie?with_original_language=te&sort_by=popularity.desc&page=1'),
          fetchTMDB('/discover/movie?with_original_language=ta&sort_by=popularity.desc&page=1'),
          fetchTMDB('/discover/movie?with_original_language=kn&sort_by=popularity.desc&page=1'),
          fetchTMDB('/discover/movie?with_original_language=ml&sort_by=popularity.desc&page=1')
        ]);
        
        // Merge & deduplicate
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
          .map(normalizeMovie);

        // 5. Fetch Web Series
        const webSeriesRes = await fetchTMDB('/tv/popular?language=en-US&page=1');
        const webSeriesList = (webSeriesRes.results || []).map(normalizeMovie);

        // 6. Featured Movie (Find the best featured option from trending/popular)
        const featuredMovie = trendingList.find(m => m.backdrop && m.description) || trendingList[0] || null;

        if (active) {
          setData({
            trending: trendingList,
            popular: popularList,
            bollywood: bollywoodList,
            southIndian: southIndianList,
            webSeries: webSeriesList,
            featured: featuredMovie
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

// Search Helper
export const searchTMDB = async (query) => {
  if (!query || !query.trim()) return [];
  
  try {
    const res = await fetchTMDB(`/search/multi?query=${encodeURIComponent(query)}&language=en-US&page=1`);
    return (res.results || [])
      .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
      .map(normalizeMovie);
  } catch (err) {
    console.error('Error searching TMDB:', err);
    return [];
  }
};

// Details Fetch Helper
export const fetchTMDBDetails = async (id, mediaType) => {
  try {
    const type = mediaType === 'tv' ? 'tv' : 'movie';
    const res = await fetchTMDB(`/${type}/${id}?append_to_response=credits,videos`);
    
    // Find YouTube trailer
    let trailerUrl = '';
    if (res.videos && res.videos.results) {
      const trailer = res.videos.results.find(v => v.type === 'Trailer' && v.site === 'YouTube') || res.videos.results[0];
      if (trailer) {
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
