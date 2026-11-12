import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { X, Loader2, Bell, BellRing, Search } from 'lucide-react';
import { useSubscriptions } from '../hooks/useSubscriptions';
import { formatMovie } from '../hooks/useTMDB';

const TMDB_GENRE_MAP = {
  action: 28,
  comedy: 35,
  drama: 18,
  horror: 27,
  romance: 10749,
  scifi: 878,
  'sci-fi': 878,
  thriller: 53,
  animation: 16,
  crime: 80,
  fantasy: 14,
  adventure: 12,
  family: 10751,
  mystery: 9648,
  war: 10752,
  history: 36,
  music: 10402,
  documentary: 99,
  western: 37,
};

const GENRE_LABELS = {
  action: 'Action',
  comedy: 'Comedy',
  drama: 'Drama',
  horror: 'Horror',
  romance: 'Romance',
  scifi: 'Sci-Fi',
  'sci-fi': 'Sci-Fi',
  thriller: 'Thriller',
  animation: 'Animation',
  crime: 'Crime',
  fantasy: 'Fantasy',
  adventure: 'Adventure',
  family: 'Family',
  mystery: 'Mystery',
  war: 'War',
  history: 'History',
  music: 'Music',
  documentary: 'Documentary',
  western: 'Western',
};

const API_URL = import.meta.env.VITE_API_URL || 'https://movieverify-backend.onrender.com';
const BASE_URL = `${API_URL}/api/tmdb`;

const GenrePage = ({ onMovieClick, myList, onToggleMyList }) => {
  const { genreSlug } = useParams();
  const navigate = useNavigate();
  const [movies, setMovies] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // 1. Initialize genre properties first to prevent TDZ ReferenceError
  const normalizedSlug = (genreSlug || '').toLowerCase();
  const genreId = TMDB_GENRE_MAP[normalizedSlug];
  const genreLabel = GENRE_LABELS[normalizedSlug] || (genreSlug ? genreSlug.charAt(0).toUpperCase() + genreSlug.slice(1) : 'Genre');

  // 2. Safely subscribe to notifications after genreId is initialized
  const { isGenreNotifying, toggleGenreNotify } = useSubscriptions();
  const isSubscribed = isGenreNotifying(genreId || normalizedSlug);

  const fetchMovies = useCallback(async (pageNum, append = false) => {
    if (!genreId) {
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    if (append) setLoadingMore(true); else setLoading(true);

    try {
      const res = await fetch(
        `${BASE_URL}/discover/movie?with_genres=${genreId}&sort_by=popularity.desc&page=${pageNum}`,
        {
          headers: {
            'Content-Type': 'application/json',
            ...(import.meta.env.VITE_TMDB_TOKEN ? { Authorization: `Bearer ${import.meta.env.VITE_TMDB_TOKEN}` } : {})
          },
        }
      );
      const data = await res.json();
      const formatted = (data.results || []).map(formatMovie);

      setMovies((prev) => (append ? [...prev, ...formatted] : formatted));
      setTotalPages(data.total_pages || 1);
    } catch (err) {
      console.warn('Genre fetch failed:', err.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [genreId]);

  useEffect(() => {
    setPage(1);
    setSearchTerm('');
    fetchMovies(1, false);
  }, [genreSlug, fetchMovies]);

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchMovies(nextPage, true);
  };

  // Instant filter within genre
  const displayedMovies = useMemo(() => {
    if (!searchTerm.trim()) return movies;
    const term = searchTerm.toLowerCase().trim();
    return movies.filter((m) =>
      (m.title && m.title.toLowerCase().includes(term)) ||
      (m.year && String(m.year).includes(term))
    );
  }, [movies, searchTerm]);

  return (
    <div className="min-h-screen bg-[#141414] pt-24 pb-10">
      <div className="px-4 md:px-12">
        {/* Header with Title, Notification Subscription & Search */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="text-3xl md:text-5xl font-black text-white">
              {genreLabel} Movies
            </h1>
            <button
              onClick={() => toggleGenreNotify({ id: genreId || normalizedSlug, name: genreLabel })}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition shadow-md ${
                isSubscribed 
                  ? 'bg-[#E50914] text-white' 
                  : 'bg-white/10 text-gray-300 hover:bg-white/20 hover:text-white'
              }`}
            >
              {isSubscribed ? <BellRing className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
              {isSubscribed ? 'Subscribed' : 'Notify on New'}
            </button>
          </div>

          <div className="flex items-center gap-3">
            {/* Quick Search within Genre */}
            <div className="relative flex items-center">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 pointer-events-none" />
              <input
                type="text"
                placeholder={`Search in ${genreLabel}...`}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-[#242424] text-white text-sm pl-9 pr-8 py-2 rounded-full border border-white/10 focus:border-[#E50914] outline-none transition w-44 sm:w-60"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 text-gray-400 hover:text-white"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              onClick={() => navigate('/')}
              className="w-10 h-10 bg-[#2a2a2a] hover:bg-[#E50914] 
                         rounded-full flex items-center justify-center 
                         text-white transition shrink-0"
              title="Back to Home"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 
                          md:grid-cols-4 lg:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] bg-[#2a2a2a] 
                                       rounded-lg animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {displayedMovies.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <p className="text-white text-lg font-semibold mb-2">No movies found</p>
                <p className="text-gray-400 text-sm mb-4">
                  {searchTerm
                    ? `No titles found matching "${searchTerm}" in ${genreLabel}.`
                    : `No titles available in ${genreLabel} right now.`}
                </p>
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="px-4 py-2 bg-[#E50914] text-white text-xs font-bold rounded-full hover:bg-red-700 transition"
                  >
                    Clear Search
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 
                              md:grid-cols-4 lg:grid-cols-6 gap-4">
                {displayedMovies.map((movie) => (
                  <div key={movie.id} className="cursor-pointer group">
                    <div
                      onClick={() => onMovieClick(movie)}
                      className="aspect-[2/3] rounded-lg overflow-hidden 
                                 group-hover:ring-2 
                                 group-hover:ring-[#E50914] transition"
                    >
                      <img
                        src={movie.poster}
                        alt={movie.title}
                        loading="lazy"
                        className="w-full h-full object-cover object-top 
                                   group-hover:scale-105 transition 
                                   duration-300"
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.src = `https://placehold.co/342x513/141414/E50914?text=${encodeURIComponent(movie.title)}`;
                        }}
                      />
                    </div>
                    <p className="text-white text-xs font-medium 
                                  truncate mt-1">
                      {movie.title}
                    </p>
                    <p className="text-gray-500 text-[10px]">
                      {movie.year}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {!searchTerm && page < totalPages && (
              <div className="flex justify-center mt-8">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="flex items-center gap-2 bg-[#242424] 
                             hover:bg-[#E50914] text-white 
                             font-semibold px-6 py-3 rounded-full 
                             transition disabled:opacity-50"
                >
                  {loadingMore && (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                  {loadingMore ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default GenrePage;
