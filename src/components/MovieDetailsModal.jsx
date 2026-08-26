import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, Plus, ThumbsUp, Download, Check } from 'lucide-react';
import { movies } from '../data/movies';

const MovieDetailsModal = ({ movie, isOpen, onClose, myList = [], onToggleMyList, onSelectMovie }) => {
  if (!movie) return null;

  const isAddedToList = myList.some((m) => m.id === movie.id);

  // Get similar movies based on genre intersection (excluding current movie itself)
  const similarMovies = movies
    .filter(m => m.id !== movie.id && m.genre.split(',').some(g => movie.genre.includes(g.trim())))
    .slice(0, 3);

  const handleDownload = (quality, link) => {
    if(link && link !== "#") {
      window.open(link, "_blank");
    } else {
      alert(`${quality} download link is not available yet.`);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-0 md:pt-10 overflow-y-auto"
        >
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

          {/* Modal Container */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative w-full max-w-4xl bg-[#181818] rounded-xl shadow-2xl z-10 my-8 max-h-[90vh] flex flex-col overflow-hidden"
          >
            {/* Close Button */}
            <button 
              onClick={onClose}
              className="absolute top-4 right-4 z-50 w-10 h-10 bg-[#181818]/60 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-gray-800 transition shadow-lg border border-white/10"
            >
              <X className="w-6 h-6" />
            </button>

            {/* Scrollable Content Wrapper */}
            <div className="overflow-y-auto flex-1 hide-scrollbar">
              {/* Top Banner Area */}
              <div className="relative w-full h-[300px] md:h-[450px] flex-none">
              <img 
                src={movie.backdrop || movie.poster} 
                alt={movie.title}
                className={`w-full h-full object-cover ${movie.title.toLowerCase().includes('pushpa') ? 'object-bottom' : 'object-top'}`}
                onError={(e) => {
                  if (!e.target.dataset.triedFallback) {
                    e.target.dataset.triedFallback = 'true';
                    if (movie.poster) {
                      e.target.src = movie.poster;
                      return;
                    }
                  }
                  e.target.onerror = null;
                  e.target.src = `https://placehold.co/500x280/141414/E50914?text=${encodeURIComponent(movie.title)}`;
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#181818]/80 to-transparent w-3/4" />
              
              <div className="absolute bottom-10 left-10">
                <h2 className="text-4xl md:text-5xl font-bold text-white mb-6 drop-shadow-lg">{movie.title}</h2>
                <div className="flex gap-4">
                  <button 
                    onClick={() => {
                      document.getElementById('download-options')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="flex items-center gap-2 bg-white hover:bg-white/80 text-black px-6 py-2 md:px-8 md:py-3 rounded md:text-lg font-bold transition"
                  >
                    <Download className="w-6 h-6 stroke-[3]" /> Download
                  </button>
                  <button 
                    onClick={() => onToggleMyList(movie)}
                    className="w-10 h-10 md:w-12 md:h-12 border-2 border-gray-400 bg-[#2a2a2a]/50 hover:border-white rounded-full flex items-center justify-center text-white transition"
                  >
                    {isAddedToList ? <Check className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                  </button>
                  <button className="w-10 h-10 md:w-12 md:h-12 border-2 border-gray-400 bg-[#2a2a2a]/50 hover:border-white rounded-full flex items-center justify-center text-white transition">
                    <ThumbsUp className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Details Section */}
            <div className="p-10 grid grid-cols-1 md:grid-cols-3 gap-8 text-white">
              <div className="md:col-span-2">
                <div className="flex items-center gap-3 text-sm font-semibold mb-4">
                  <span className="text-green-500">{Math.round(movie.rating * 10)}% Match</span>
                  <span className="text-gray-300">{movie.year}</span>
                  <span className="border border-gray-500 text-gray-300 px-1 rounded text-xs">{movie.quality}</span>
                </div>
                <p className="text-gray-200 leading-relaxed text-base md:text-lg mb-8">
                  {movie.description}
                </p>

                {/* Download Options */}
                <div>
                  <h3 id="download-options" className="text-xl font-bold text-white mb-4">Download Options</h3>
                  {movie.seasons ? (
                     <div className="flex flex-col gap-4">
                       {movie.seasons.map((s, idx) => (
                         <div key={idx} className="bg-[#242424] p-4 rounded-lg">
                           <h4 className="font-bold text-gray-300 mb-3">Season {s.season}</h4>
                           <div className="flex flex-col gap-2">
                             {s.parts.map((part, pIdx) => (
                               <div key={pIdx} className="flex flex-col sm:flex-row justify-between items-center bg-[#181818] p-3 rounded">
                                 <span>{part.name}</span>
                                 <div className="flex gap-2 mt-2 sm:mt-0">
                                  <button onClick={() => handleDownload('480p', part.download480p)} className="px-3 py-1 bg-[#333] hover:bg-primary rounded text-sm transition">480p</button>
                                  <button onClick={() => handleDownload('720p', part.download720p)} className="px-3 py-1 bg-[#333] hover:bg-primary rounded text-sm transition">720p</button>
                                  <button onClick={() => handleDownload('1080p', part.download1080p)} className="px-3 py-1 bg-[#333] hover:bg-primary rounded text-sm transition">1080p</button>
                                 </div>
                               </div>
                             ))}
                           </div>
                         </div>
                       ))}
                     </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-4">
                      <button onClick={() => handleDownload('480p', movie.download480p)} className="flex flex-col items-center p-4 bg-[#242424] hover:bg-[#333] rounded-lg transition">
                        <span className="text-lg font-bold">480p</span>
                        <span className="text-xs text-gray-400 mt-1">~500 MB</span>
                      </button>
                      <button onClick={() => handleDownload('720p', movie.download720p)} className="flex flex-col items-center p-4 bg-[#242424] hover:bg-primary rounded-lg transition">
                        <span className="text-lg font-bold">720p</span>
                        <span className="text-xs text-white/70 mt-1">~1.2 GB</span>
                      </button>
                      <button onClick={() => handleDownload('1080p', movie.download1080p)} className="flex flex-col items-center p-4 bg-[#242424] hover:bg-[#333] rounded-lg transition">
                        <span className="text-lg font-bold">1080p</span>
                        <span className="text-xs text-gray-400 mt-1">~2.5 GB</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Cast & Info Column */}
              <div className="text-sm text-gray-400">
                <div className="mb-4">
                  <span className="text-gray-500">Cast: </span>
                  <span className="hover:underline cursor-pointer">Placeholder Actor 1</span>,{' '}
                  <span className="hover:underline cursor-pointer">Placeholder Actor 2</span>,{' '}
                  <span className="hover:underline cursor-pointer">Placeholder Actor 3</span>
                </div>
                <div className="mb-4">
                  <span className="text-gray-500">Genres: </span>
                  <span className="hover:underline cursor-pointer">{movie.genre}</span>
                </div>
                <div className="mb-4">
                  <span className="text-gray-500">Language: </span>
                  <span className="hover:underline cursor-pointer">{movie.language}</span>
                </div>
              </div>
            </div>

            {/* Similar Movies Section */}
            <div className="px-10 pb-10">
              <h3 className="text-2xl font-bold text-white mb-6">More Like This</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {similarMovies.map((simMovie) => (
                  <div 
                    key={simMovie.id} 
                    onClick={() => onSelectMovie && onSelectMovie(simMovie)}
                    className="bg-[#242424] rounded-lg overflow-hidden group cursor-pointer"
                  >
                    <div className="relative aspect-video">
                      <img 
                        src={simMovie.backdrop || simMovie.poster} 
                        alt={simMovie.title} 
                        className={`w-full h-full object-cover ${simMovie.title.toLowerCase().includes('pushpa') ? 'object-bottom' : 'object-top'}`} 
                        onError={(e) => {
                          if (!e.target.dataset.triedFallback) {
                            e.target.dataset.triedFallback = 'true';
                            if (simMovie.poster) {
                              e.target.src = simMovie.poster;
                              return;
                            }
                          }
                          e.target.onerror = null;
                          e.target.src = `https://placehold.co/500x280/141414/E50914?text=${encodeURIComponent(simMovie.title)}`;
                        }}
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                         <Play className="w-10 h-10 text-white fill-current" />
                      </div>
                    </div>
                    <div className="p-4 text-white">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-green-500 text-xs font-bold">{Math.round(simMovie.rating * 10)}% Match</span>
                        <span className="border border-gray-500 text-gray-300 px-1 rounded text-[10px] uppercase">{simMovie.quality}</span>
                      </div>
                      <p className="text-sm font-bold truncate mb-1">{simMovie.title}</p>
                      <p className="text-xs text-gray-400 line-clamp-3">
                        {simMovie.description}
                      </p>
                    </div>
                  </div>
                ))}
                {similarMovies.length === 0 && (
                  <p className="text-gray-400 col-span-full text-sm">No similar titles found.</p>
                )}
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
      )}
    </AnimatePresence>
  );
};

export default MovieDetailsModal;
