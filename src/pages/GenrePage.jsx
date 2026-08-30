import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { X, Loader2 } from 'lucide-react';
import MovieCard from '../components/MovieCard';
import { formatMovie } from '../hooks/useTMDB';

const TMDB_GENRE_MAP = {
  action: 28,
  comedy: 35,
  drama: 18,
  horror: 27,
  romance: 10749,
  scifi: 878,
  thriller: 53,
  animation: 16,
  crime: 80,
  fantasy: 14,
  adventure: 12,
  family: 10751,
  mystery: 9648,
};

const GENRE_LABELS = {
  action: 'Action',
  comedy: 'Comedy',
  drama: 'Drama',
  horror: 'Horror',
  romance: 'Romance',
  scifi: 'Sci-Fi',
  thriller: 'Thriller',
  animation: 'Animation',
  crime: 'Crime',
  fantasy: 'Fantasy',
  adventure: 'Adventure',
  family: 'Family',
  mystery: 'Mystery',
};

const TOKEN = import.meta.env.VITE_TMDB_TOKEN;

const GenrePage = ({ onMovieClick, myList, onToggleMyList }) => {
  const { genreSlug } = useParams();
  const navigate = useNavigate();
  const [movies, setMovies] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const genreId = TMDB_GENRE_MAP[genreSlug];
  const genreLabel = GENRE_LABELS[genreSlug] || genreSlug;

  const fetchMovies = useCallback(async (pageNum, append = false) => {
    if (!genreId) return;
    if (append) setLoadingMore(true); else setLoading(true);

    try {
      const res = await fetch(
        `https://api.themoviedb.org/3/discover/movie?with_genres=${genreId}&sort_by=popularity.desc&page=${pageNum}`,
        {
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            'Content-Type': 'application/json',
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
    fetchMovies(1, false);
  }, [genreSlug, fetchMovies]);

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchMovies(nextPage, true);
  };

  return (
    <div className="min-h-screen bg-[#141414] pt-24 pb-10">
      <div className="px-4 md:px-12">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl md:text-5xl font-black text-white">
            {genreLabel} Movies
          </h1>
          <button
            onClick={() => navigate('/')}
            className="w-10 h-10 bg-[#2a2a2a] hover:bg-[#E50914] 
                       rounded-full flex items-center justify-center 
                       text-white transition"
          >
            <X className="w-6 h-6" />
          </button>
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
            <div className="grid grid-cols-2 sm:grid-cols-3 
                            md:grid-cols-4 lg:grid-cols-6 gap-4">
              {movies.map((movie) => (
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

            {page < totalPages && (
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
