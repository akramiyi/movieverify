import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, Plus, ThumbsUp, Download, Check } from 'lucide-react';
import { movies } from '../data/movies';
import { fetchTMDBDetails, getDownloadLinks, getMediaTypeFromId } from '../hooks/useTMDB';
import ImageWithFallback from './ImageWithFallback';
import ReportProblemButton from './ReportProblemButton';
import ShareButton from './ShareButton';
import ReviewSection from './ReviewSection';
import { useSubscriptions } from '../hooks/useSubscriptions';
import { Bell, BellRing, LogIn } from 'lucide-react';

const getMatchPercent = (rating) => {
  const num = parseFloat(rating);
  return isNaN(num) ? 'N/A' : `${Math.round(num * 10)}%`;
};

const MovieDetailsModal = ({ movie, isOpen, isLoading = false, onClose, myList = [], onToggleMyList, onSelectMovie, onDownloadTracked, onRequireAuth }) => {
  const {
    isAuthenticated,
    isLoading: isSubUpdating,
    toggleMovieNotify,
    isMovieNotifying,
  } = useSubscriptions();
  const notifying = movie ? isMovieNotifying(movie) : false;
  const [notifyFeedback, setNotifyFeedback] = useState(null);
  const [details, setDetails] = useState({
    cast: 'Placeholder Actor 1, Placeholder Actor 2, Placeholder Actor 3',
    trailerUrl: '',
    runtime: null
  });

  useEffect(() => {
    setNotifyFeedback(null);
  }, [movie?.id, isAuthenticated]);

  const liveLinks = movie ? getDownloadLinks(movie.id, movie.title) : {};
  const download480p = liveLinks.download480p || movie?.download480p;
  const download720p = liveLinks.download720p || movie?.download720p;
  const download1080p = liveLinks.download1080p || movie?.download1080p;
  const seasons = liveLinks.seasons || movie?.seasons;

  const idStr = movie ? String(movie.id) : '';
  const parsedId = movie ? parseInt(idStr.split('-')[0], 10) : NaN;
  const resolvedMediaType = movie ? (
    movie.mediaType ||
    movie.media_type ||
    (idStr.includes('-tv') ? 'tv' : null) ||
    (idStr.includes('-movie') ? 'movie' : null) ||
    (movie.seasons && movie.seasons.length > 0 ? 'tv' : null) ||
    (movie.first_air_date ? 'tv' : null) ||
    (movie.genre && (movie.genre.toLowerCase().includes('web series') || movie.genre.toLowerCase().includes('tv series')) ? 'tv' : null) ||
    getMediaTypeFromId(parsedId) ||
    (movie.release_date ? 'movie' : null) ||
    null
  ) : null;

  useEffect(() => {
    if (movie && movie.id) {
      if (!isNaN(parsedId) && resolvedMediaType) {
        fetchTMDBDetails(parsedId, resolvedMediaType).then((res) => {
          setDetails({
            cast: res.cast || movie.cast || 'Placeholder Actor 1, Placeholder Actor 2, Placeholder Actor 3',
            trailerUrl: res.trailerUrl || movie.trailerUrl || '',
            runtime: res.runtime || movie.runtime || null
          });
        });
      } else {
        setDetails({
          cast: movie.cast || 'Placeholder Actor 1, Placeholder Actor 2, Placeholder Actor 3',
          trailerUrl: movie.trailerUrl || '',
          runtime: movie.runtime || null
        });
      }
    }
  }, [movie, parsedId, resolvedMediaType]);

  if (isLoading && !movie) {
    return (
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[1050] flex items-center justify-center p-4 overflow-y-auto"
          >
            <div className="fixed inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-md bg-[#181818] rounded-2xl shadow-2xl z-10 p-8 flex flex-col items-center justify-center border border-white/10 text-center"
            >
              <button
                onClick={onClose}
                className="absolute top-4 right-4 z-50 w-8 h-8 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-gray-300 hover:text-white transition cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="w-12 h-12 border-4 border-[#E50914] border-t-transparent rounded-full animate-spin mb-4" />
              <h3 className="text-white text-lg font-bold">Loading Title Details...</h3>
              <p className="text-gray-400 text-xs mt-1">Retrieving official TMDB information</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  if (!movie) return null;

  const isAddedToList = myList.some((m) => m.id === movie.id);

  // Get similar movies based on genre intersection (excluding current movie itself)
  const similarMovies = movies
    .filter(m => m.id !== movie.id && (m.genre || '').split(',').some(g => (movie.genre || '').includes(g.trim())))
    .slice(0, 3);

  const handleDownload = (quality, link) => {
    if(link && link !== "#") {
      window.open(link, "_blank");
      if (onDownloadTracked) onDownloadTracked(movie.title, quality);
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
          className="fixed inset-0 z-[1050] flex items-center justify-center p-4 md:p-0 md:pt-10 overflow-y-auto"
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
              <ImageWithFallback
                src={movie.backdrop}
                backdropSrc={movie.poster}
                alt={movie.title}
                className={`w-full h-full object-cover ${movie.title.toLowerCase().includes('pushpa') ? 'object-bottom' : 'object-top'}`}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#181818]/80 to-transparent w-3/4" />

              <div className="absolute bottom-10 left-10">
                <h2 className="text-4xl md:text-5xl font-bold text-white mb-6 drop-shadow-lg">{movie.title}</h2>
                <div className="flex flex-wrap items-center gap-4">
                  <button
                    onClick={() => {
                      document.getElementById('download-options')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="flex items-center gap-2 bg-white hover:bg-white/80 text-black px-6 py-2 md:px-8 md:py-3 rounded md:text-lg font-bold transition"
                  >
                    <Download className="w-6 h-6 stroke-[3]" /> Download
                  </button>
                  {details.trailerUrl && (
                    <button
                      onClick={() => window.open(details.trailerUrl, '_blank')}
                      className="flex items-center gap-2 bg-[#6d6d6eb3] hover:bg-[#6d6d6e66] text-white px-6 py-2 md:px-8 md:py-3 rounded md:text-lg font-bold transition"
                    >
                      <Play className="w-5 h-5 fill-current" /> Watch Trailer
                    </button>
                  )}
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
                  <span className="text-green-500">{getMatchPercent(movie.rating)} Match</span>
                  <span className="text-gray-300">{movie.year}</span>
                  <span className="border border-gray-500 text-gray-300 px-1 rounded text-xs">{movie.quality}</span>
                </div>
                <p className="text-gray-200 leading-relaxed text-base md:text-lg mb-8">
                  {movie.description}
                </p>

                {/* Download Options */}
                <div>
                  <h3 id="download-options" className="text-xl font-bold text-white mb-4">Download Options</h3>
                  {(() => {
                    const hasAnySeasonLinks =
                      Array.isArray(seasons) &&
                      seasons.some(
                        (s) => Array.isArray(s.parts) && s.parts.some((p) => p.download480p || p.download720p || p.download1080p)
                      );
                    const hasAnyMovieLinks = Boolean(download480p || download720p || download1080p);

                    if (hasAnySeasonLinks) {
                      return (
                        <div className="flex flex-col gap-4">
                          {seasons.map((s, idx) => {
                            const hasAnySeasonLink = s.parts.some(p => p.download480p || p.download720p || p.download1080p);
                            if (!hasAnySeasonLink) return null;

                            return (
                              <div key={idx} className="bg-[#242424] p-4 rounded-lg">
                                <h4 className="font-bold text-gray-300 mb-3">Season {s.season}</h4>
                                <div className="flex flex-col gap-2">
                                  {s.parts.map((part, pIdx) => (
                                    <div key={pIdx} className="flex flex-col sm:flex-row justify-between items-center bg-[#181818] p-3 rounded">
                                      <span>{part.name}</span>
                                      <div className="flex gap-2 mt-2 sm:mt-0">
                                        {part.download480p && <button onClick={() => handleDownload('480p', part.download480p)} className="px-3 py-1 bg-[#333] hover:bg-primary rounded text-sm transition">480p</button>}
                                        {part.download720p && <button onClick={() => handleDownload('720p', part.download720p)} className="px-3 py-1 bg-[#333] hover:bg-primary rounded text-sm transition">720p</button>}
                                        {part.download1080p && <button onClick={() => handleDownload('1080p', part.download1080p)} className="px-3 py-1 bg-[#333] hover:bg-primary rounded text-sm transition">1080p</button>}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }

                    if (hasAnyMovieLinks) {
                      return (
                        <div className="grid grid-cols-3 gap-4">
                          {download480p && (
                            <button onClick={() => handleDownload('480p', download480p)} className="flex flex-col items-center p-4 bg-[#242424] hover:bg-[#333] rounded-lg transition">
                              <span className="text-lg font-bold">480p</span>
                              <span className="text-xs text-gray-400 mt-1">~500 MB</span>
                            </button>
                          )}
                          {download720p && (
                            <button onClick={() => handleDownload('720p', download720p)} className="flex flex-col items-center p-4 bg-[#242424] hover:bg-primary rounded-lg transition">
                              <span className="text-lg font-bold">720p</span>
                              <span className="text-xs text-white/70 mt-1">~1.2 GB</span>
                            </button>
                          )}
                          {download1080p && (
                            <button onClick={() => handleDownload('1080p', download1080p)} className="flex flex-col items-center p-4 bg-[#242424] hover:bg-[#333] rounded-lg transition">
                              <span className="text-lg font-bold">1080p</span>
                              <span className="text-xs text-gray-400 mt-1">~2.5 GB</span>
                            </button>
                          )}
                        </div>
                      );
                    }

                    const handleNotifyClick = async () => {
                      if (!isAuthenticated) {
                        setNotifyFeedback({
                          type: 'auth',
                          message: 'Please sign in with Google to save release alerts to your account.',
                        });
                        return;
                      }
                      setNotifyFeedback(null);
                      const result = await toggleMovieNotify({
                        ...movie,
                        mediaType: resolvedMediaType,
                        media_type: resolvedMediaType,
                      });
                      if (result?.requiresAuth) {
                        setNotifyFeedback({
                          type: 'auth',
                          message: 'Please sign in with Google to save release alerts to your account.',
                        });
                      } else if (!result?.success) {
                        setNotifyFeedback({
                          type: 'error',
                          message: result?.error || 'Could not update alert subscription.',
                        });
                      } else {
                        setNotifyFeedback({
                          type: 'success',
                          message: result.subscribed
                            ? 'Release alert saved to your account.'
                            : 'Release alert removed.',
                        });
                      }
                    };

                    return (
                      <div className="py-2 space-y-3">
                        <p className="text-gray-400 text-sm">Download links unavailable yet</p>
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            disabled={isSubUpdating}
                            onClick={handleNotifyClick}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition cursor-pointer disabled:opacity-50 ${
                              isAuthenticated && notifying
                                ? 'bg-[#E50914]/20 text-[#E50914] border border-[#E50914]'
                                : 'bg-[#242424] text-gray-300 hover:bg-[#333]'
                            }`}
                          >
                            {isAuthenticated && notifying ? <BellRing className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                            {isAuthenticated && notifying ? "You'll be notified" : 'Notify Me When Available'}
                          </button>

                          {!isAuthenticated && (
                            <button
                              type="button"
                              onClick={() => onRequireAuth && onRequireAuth()}
                              data-testid="notify-signin-btn"
                              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-[#E50914] hover:bg-[#b80710] text-white transition cursor-pointer"
                            >
                              <LogIn className="w-3.5 h-3.5" />
                              Sign In to Notify
                            </button>
                          )}
                        </div>

                        {(!isAuthenticated || notifyFeedback?.type === 'auth') && (
                          <div
                            data-testid="notify-signin-prompt"
                            className="p-3 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-300 flex items-center justify-between gap-3"
                          >
                            <span>
                              {notifyFeedback?.message || 'Sign in to save release notifications and sync alerts across your devices.'}
                            </span>
                            {onRequireAuth && (
                              <button
                                type="button"
                                onClick={onRequireAuth}
                                className="shrink-0 text-[#E50914] hover:underline font-bold cursor-pointer"
                              >
                                Sign In
                              </button>
                            )}
                          </div>
                        )}

                        {notifyFeedback && notifyFeedback.type !== 'auth' && (
                          <p
                            className={`text-xs ${
                              notifyFeedback.type === 'error' ? 'text-rose-400' : 'text-emerald-400'
                            }`}
                          >
                            {notifyFeedback.message}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div className="flex items-center gap-8 mt-4 pb-6 border-b border-white/10">
                  <ReportProblemButton
                    movieId={movie.id}
                    movieTitle={movie.title}
                  />
                  <ShareButton
                    movieId={movie.id}
                    movieTitle={movie.title}
                    mediaType={resolvedMediaType}
                    movie={{
                      ...movie,
                      mediaType: resolvedMediaType || movie.mediaType || null,
                      media_type: resolvedMediaType || movie.media_type || null
                    }}
                  />
                </div>
                <ReviewSection
                  movieId={movie.id}
                  movieTitle={movie.title}
                />
              </div>

              {/* Cast & Info Column */}
              <div className="text-sm text-gray-400">
                <div className="mb-4">
                  <span className="text-gray-500">Cast: </span>
                  <span className="text-gray-300">{details.cast}</span>
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
                      <ImageWithFallback
                        src={simMovie.backdrop}
                        backdropSrc={simMovie.poster}
                        alt={simMovie.title}
                        lazy={true}
                        className={`w-full h-full object-cover ${simMovie.title.toLowerCase().includes('pushpa') ? 'object-bottom' : 'object-top'}`}
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                         <Play className="w-10 h-10 text-white fill-current" />
                      </div>
                    </div>
                    <div className="p-4 text-white">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-green-500 text-xs font-bold">{getMatchPercent(simMovie.rating)} Match</span>
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
