import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Film, AlertCircle, Globe, ExternalLink, Zap } from 'lucide-react';
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
  const [videoSource, setVideoSource] = useState('piped');
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
      setVideoSource('piped');
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const ytId = extractYouTubeId(trailerUrl);
  // Uses piped.video by default for fast, geo-block free streaming without bot walls
  const embedUrl = ytId
    ? videoSource === 'piped'
      ? `https://piped.video/embed/${ytId}`
      : videoSource === 'yewtube'
      ? `https://yewtu.be/embed/${ytId}?autoplay=1`
      : `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&rel=0&modestbranding=1&enablejsapi=1`
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

            {/* Multi-Server Bypass Controls */}
            <div className="flex items-center gap-1.5 ml-auto flex-wrap">
              {ytId && (
                <>
                  <div className="flex items-center bg-black/60 rounded-full p-0.5 border border-white/20 backdrop-blur-md shadow-lg">
                    <button
                      type="button"
                      onClick={() => setVideoSource('piped')}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition cursor-pointer flex items-center gap-1 ${
                        videoSource === 'piped'
                          ? 'bg-emerald-600 text-white shadow'
                          : 'text-emerald-300 hover:text-white'
                      }`}
                      title="Server 1: Piped Video Global Proxy (Ultra Fast & No Bot Wall)"
                    >
                      <Zap className="w-2.5 h-2.5" />
                      <span>Server 1 (Bypass)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setVideoSource('yewtube')}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition cursor-pointer flex items-center gap-1 ${
                        videoSource === 'yewtube'
                          ? 'bg-emerald-600 text-white shadow'
                          : 'text-gray-300 hover:text-white'
                      }`}
                      title="Server 2: Yewtube Europe Privacy Server"
                    >
                      <Globe className="w-2.5 h-2.5" />
                      <span>Server 2</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setVideoSource('youtube')}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition cursor-pointer flex items-center gap-1 ${
                        videoSource === 'youtube'
                          ? 'bg-red-600 text-white shadow'
                          : 'text-gray-300 hover:text-white'
                      }`}
                      title="Direct YouTube"
                    >
                      <Film className="w-2.5 h-2.5" />
                      <span>YouTube</span>
                    </button>
                  </div>

                  <a
                    href={`https://www.dailymotion.com/search/${encodeURIComponent((movieTitle || '') + ' trailer')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hidden sm:flex px-2.5 py-1 rounded-full bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 text-xs font-bold border border-cyan-500/40 items-center gap-1 transition"
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
                      <span className="truncate">"Video unavailable in India / Govt order"? Click <strong>Server 1 Bypass</strong></span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setVideoSource('piped')}
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
