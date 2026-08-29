import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search } from 'lucide-react';

const TMDB_IMG = 'https://image.tmdb.org/t/p/w342';
const TMDB_BACKDROP = 'https://image.tmdb.org/t/p/w1280';

const ActorMoviesModal = ({ actor, isOpen, onClose, onMovieClick }) => {
  const [movies, setMovies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!actor || !isOpen) return;
    setLoading(true);
    
    fetch(
      `https://api.themoviedb.org/3/person/${actor.tmdb_id}/combined_credits`,
      {
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_TMDB_TOKEN}`
        }
      }
    )
    .then(r => r.json())
    .then(data => {
      const sorted = (data.cast || [])
        .filter(m => m.poster_path && m.vote_count > 100)
        .sort((a, b) => b.popularity - a.popularity)
        .slice(0, 20)
        .map(m => ({
          id: m.id,
          title: m.title || m.name,
          poster: m.poster_path ? `${TMDB_IMG}${m.poster_path}` : null,
          backdrop: m.backdrop_path ? `${TMDB_BACKDROP}${m.backdrop_path}` : null,
          year: new Date(m.release_date || m.first_air_date).getFullYear(),
          rating: m.vote_average?.toFixed(1),
          quality: '1080p',
          genre: '',
          language: '',
          description: m.overview,
          download480p: '#',
          download720p: '#',
          download1080p: '#',
          mediaType: m.media_type
        }));
      setMovies(sorted);
      setLoading(false);
    })
    .catch(() => setLoading(false));
  }, [actor, isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto pt-10 pb-10"
        >
          {/* Overlay */}
          <div 
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ scale: 0.95, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 20 }}
            className="relative w-full max-w-5xl bg-[#141414] rounded-2xl overflow-hidden shadow-2xl z-10 mx-4"
          >
            {/* Header */}
            <div className="relative h-48 md:h-64 overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#141414]" />
              <div className="absolute inset-0 bg-[#E50914]/10" />
              
              {/* Actor Info */}
              <div className="absolute bottom-6 left-6 flex items-end gap-4">
                <img
                  src={actor.image}
                  alt={actor.name}
                  className="w-20 h-20 md:w-28 md:h-28 rounded-full object-cover object-top border-2 border-[#E50914]"
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = `https://placehold.co/112x112/141414/E50914?text=${actor.name[0]}`;
                  }}
                />
                <div>
                  <h2 className="text-3xl md:text-4xl font-black text-white">
                    {actor.name}
                  </h2>
                  <p className="text-gray-400 text-sm">
                    {movies.length} Movies & Shows
                  </p>
                </div>
              </div>

              {/* Close */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 w-10 h-10 bg-black/60 rounded-full flex items-center justify-center text-white hover:bg-[#E50914] transition z-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Movies Grid */}
            <div className="p-6">
              <h3 className="text-xl font-bold text-white mb-4">
                All Movies & Shows
              </h3>
              
              {loading ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                  {Array.from({length: 10}).map((_, i) => (
                    <div key={i} className="aspect-[2/3] bg-[#2a2a2a] rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 max-h-[60vh] overflow-y-auto pr-2">
                  {movies.map(movie => (
                    <div
                      key={movie.id}
                      onClick={() => {
                        onMovieClick(movie);
                        onClose();
                      }}
                      className="cursor-pointer group"
                    >
                      <div className="aspect-[2/3] rounded-lg overflow-hidden mb-1 group-hover:ring-2 group-hover:ring-[#E50914] transition">
                        <img
                          src={movie.poster}
                          alt={movie.title}
                          loading="lazy"
                          className="w-full h-full object-cover object-top group-hover:scale-105 transition duration-300"
                          onError={(e) => {
                            e.target.onerror = null;
                            e.target.src = `https://placehold.co/342x513/141414/E50914?text=${encodeURIComponent(movie.title)}`;
                          }}
                        />
                      </div>
                      <p className="text-white text-xs font-medium truncate">
                        {movie.title}
                      </p>
                      <p className="text-gray-500 text-[10px]">
                        {movie.year}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ActorMoviesModal;
