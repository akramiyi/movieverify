import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download } from 'lucide-react';
import { getDownloadLinks } from '../hooks/useTMDB';

const ActorModal = ({ actor, isOpen, onClose }) => {
  const [movies, setMovies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!actor || !isOpen) return;
    
    setLoading(true);
    
    fetch(
      `https://api.themoviedb.org/3/person/${actor.tmdb_id}/movie_credits`,
      {
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_TMDB_TOKEN}`
        }
      }
    )
    .then(r => r.json())
    .then(data => {
      const sorted = (data.cast || [])
        .filter(m => m.poster_path)
        .sort((a, b) => b.popularity - a.popularity)
        .slice(0, 100) // Changed to 100 to support large uploads like the 80 Salman Khan movies
        .map(m => {
          const links = getDownloadLinks(m.id, m.title || m.name);
          return {
            ...m,
            download480p: links?.download480p || null,
            download720p: links?.download720p || null,
            download1080p: links?.download1080p || null,
          };
        });
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
          className="fixed inset-0 z-[200] flex items-center 
                     justify-center p-4"
        >
          <div 
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.95 }}
            className="relative w-full max-w-4xl max-h-[90vh] bg-[#141414] 
                       rounded-2xl overflow-hidden flex flex-col z-10"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-[#E50914] 
                            to-[#E50914]/50 p-6 md:p-8 shrink-0 relative">
              <button
                onClick={onClose}
                className="absolute top-4 right-4 w-10 h-10 
                           bg-black/60 rounded-full flex items-center 
                           justify-center text-white hover:bg-[#E50914] 
                           transition"
              >
                <X className="w-5 h-5" />
              </button>
              
              <h2 className="text-3xl md:text-4xl font-black 
                             text-white pr-12">
                {actor.name}
              </h2>
              <p className="text-white/80 text-sm mt-1">
                {movies.length} Movies & Shows
              </p>
            </div>

            {/* Movies Grid */}
            <div className="p-6 md:p-8 overflow-y-auto">
              {loading ? (
                <p className="text-gray-400 text-center py-8">
                  Loading filmography...
                </p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 
                                md:grid-cols-5 lg:grid-cols-6 gap-3">
                  {movies.map(m => (
                    <div key={m.id} className="cursor-pointer group">
                      <div className="relative rounded-lg overflow-hidden">
                        <img
                          src={`https://image.tmdb.org/t/p/w342${m.poster_path}`}
                          alt={m.title || m.name}
                          className="w-full aspect-[2/3] object-cover 
                                     group-hover:scale-110 
                                     transition duration-300"
                          onError={(e) => {
                            e.target.onerror = null;
                            e.target.src = `https://placehold.co/342x513/1a1a1a/E50914?text=${encodeURIComponent((m.title||m.name)[0])}`;
                          }}
                        />
                        {!!(m.download480p || m.download720p || m.download1080p) && (
                          <div className="absolute top-1.5 right-1.5 bg-green-600/90 text-white text-[8px] md:text-[9px] font-bold px-1 py-0.5 rounded shadow-md uppercase tracking-wider backdrop-blur-sm z-10 flex items-center gap-0.5">
                            <Download className="w-2 h-2 stroke-[3]" />
                            Available
                          </div>
                        )}
                      </div>
                      <p className="text-white text-xs truncate mt-1 
                                    font-medium">
                        {m.title || m.name}
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

export default ActorModal;
