import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Film, AlertCircle, Globe, ExternalLink } from 'lucide-react';
import useScrollLock from '../hooks/useScrollLock';

/**
 * Extracts a standard 11-character YouTube video ID from various YouTube URL formats
 * (e.g. youtube.com/watch?v=XYZ, youtu.be/XYZ, youtube.com/embed/XYZ)
 */
function extractYouTubeId(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/i);
  return match ? match[1] : null;
}

const TrailerModal = ({ isOpen, onClose, trailerUrl, movieTitle }) => {
  const [videoSource, setVideoSource] = useState('youtube');
  useScrollLock(isOpen);

  // Close modal on Escape key press
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      setVideoSource('youtube');
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const ytId = extractYouTubeId(trailerUrl);
  // Uses youtube-nocookie.com by default, with overseas proxy mirror for geo-blocked Indian govt order videos
  const embedUrl = ytId
    ? videoSource === 'youtube'
      ? `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&rel=0&modestbranding=1&enablejsapi=1`
      : videoSource === 'global_mirror'
      ? `https://inv.nadeko.net/embed/${ytId}?autoplay=1`
      : `https://yewtu.be/embed/${ytId}?autoplay=1`
    : null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[1200] flex items-center justify-center p-3 sm:p-6 overflow-hidden">
        {/* Dark cinematic backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-black/90 backdrop-blur-md"
          onClick={onClose}
        />

        {/* Modal Player Container */}
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 20 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-4xl bg-[#141414] rounded-2xl shadow-2xl z-10 border border-white/10 overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header Bar */}
          <div className="flex items-center justify-between px-3 sm:px-6 py-3 bg-[#181818] border-b border-white/10 flex-wrap gap-2">
            <div className="flex items-center gap-2.5 min-w-0 pr-2">
              <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-[#E50914]/20 text-[#E50914] flex-shrink-0">
                <Film className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <h3 className="text-white text-sm sm:text-base font-bold truncate">
                  {movieTitle || 'Official Trailer'}
                </h3>
                <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  Official Trailer • In-App Cinema
                </span>
              </div>
            </div>

            {/* Quick Geo-Bypass & Mirror Actions */}
            <div className="flex items-center gap-1.5 sm:gap-2 ml-auto">
              {ytId && (
                <>
                  <button
                    type="button"
                    onClick={() => setVideoSource((prev) => (prev === 'youtube' ? 'global_mirror' : 'youtube'))}
                    className={`px-2.5 sm:px-3 py-1 rounded-full text-xs font-bold backdrop-blur-md border flex items-center gap-1.5 transition cursor-pointer ${
                      videoSource !== 'youtube'
                        ? 'bg-emerald-600 text-white border-emerald-400'
                        : 'bg-white/10 hover:bg-white/20 text-amber-300 border-amber-500/40'
                    }`}
                    title="Bypass YouTube Indian Government geo-blocking using overseas proxy mirror"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>{videoSource === 'youtube' ? 'Bypass Geo-Block' : 'Active: Global Mirror'}</span>
                  </button>

                  <a
                    href={`https://www.youtube.com/results?search_query=${encodeURIComponent((movieTitle || '') + ' official trailer')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hidden sm:flex px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-gray-300 text-xs font-semibold border border-white/10 items-center gap-1 transition"
                    title="Search alternative uploads on YouTube"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Search Mirror</span>
                  </a>

                  <a
                    href={`https://www.dailymotion.com/search/${encodeURIComponent((movieTitle || '') + ' trailer')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hidden sm:flex px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-cyan-300 text-xs font-semibold border border-cyan-500/30 items-center gap-1 transition"
                    title="Watch on Dailymotion (Free & Unblocked in India)"
                  >
                    <span>Dailymotion</span>
                  </a>
                </>
              )}

              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-[#E50914] text-gray-300 hover:text-white flex items-center justify-center transition cursor-pointer flex-shrink-0 shadow-md ml-1"
                title="Close Trailer (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Video Player Area (16:9 Aspect Ratio) */}
          <div className="relative w-full aspect-video bg-black flex items-center justify-center">
            {embedUrl ? (
              <>
                <iframe
                  key={videoSource}
                  src={embedUrl}
                  title={`${movieTitle || 'Movie'} Official Trailer`}
                  className="w-full h-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />

                {/* In-player Helper Ribbon if YouTube geo-blocks the video */}
                {videoSource === 'youtube' && (
                  <div className="absolute bottom-2 left-3 right-3 bg-black/85 backdrop-blur-md border border-amber-500/40 rounded-xl px-3 py-2 flex items-center justify-between text-[11px] text-amber-200 pointer-events-auto shadow-xl z-20">
                    <span className="flex items-center gap-1.5 truncate mr-2">
                      <span className="text-sm">⚠️</span>
                      <span className="truncate">"Video unavailable in India / Govt order"? Click <strong>Bypass Geo-Block</strong></span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setVideoSource('global_mirror')}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shrink-0 cursor-pointer shadow transition"
                    >
                      Bypass Now
                    </button>
                  </div>
                )}
              </>
            ) : trailerUrl && (trailerUrl.endsWith('.mp4') || trailerUrl.endsWith('.webm')) ? (
              <video
                src={trailerUrl}
                controls
                autoPlay
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <AlertCircle className="w-12 h-12 text-yellow-500 mb-3" />
                <h4 className="text-white font-bold text-base mb-1">Trailer Stream Unavailable</h4>
                <p className="text-gray-400 text-xs sm:text-sm max-w-md mb-4">
                  The official video feed for this title cannot be streamed inside the player.
                </p>
                {trailerUrl && trailerUrl !== '#' && (
                  <a
                    href={trailerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-[#E50914] hover:bg-[#b80710] text-white text-xs sm:text-sm font-bold rounded-lg transition"
                  >
                    Open Trailer in New Tab
                  </a>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default TrailerModal;
