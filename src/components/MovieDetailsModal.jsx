import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Play, Star, Clock, Calendar, Heart, Share2, Copy } from 'lucide-react';

const MovieDetailsModal = ({ movie, onClose, onShowToast }) => {
  const [isFavorite, setIsFavorite] = useState(() => {
    const saved = localStorage.getItem('favorites');
    if (saved) {
      const favs = JSON.parse(saved);
      return favs.some(f => f.id === movie.id);
    }
    return false;
  });

  if (!movie) return null;

  const toggleFavorite = () => {
    const saved = localStorage.getItem('favorites');
    let favs = saved ? JSON.parse(saved) : [];
    
    if (isFavorite) {
      favs = favs.filter(f => f.id !== movie.id);
      onShowToast('Removed from Favorites');
    } else {
      favs.push(movie);
      onShowToast('Added to Favorites');
    }
    
    localStorage.setItem('favorites', JSON.stringify(favs));
    setIsFavorite(!isFavorite);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    onShowToast('Link copied to clipboard!');
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Download ${movie.title}`,
          text: movie.description,
          url: window.location.href,
        });
      } catch (error) {
        console.error('Error sharing', error);
      }
    } else {
      handleCopyLink();
    }
  };

  const handleDownload = (quality) => {
    onShowToast(`Starting ${quality} download...`);
    // In a real app, this would trigger the actual download
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 pt-20"
      >
        {/* Backdrop */}
        <div 
          className="absolute inset-0 bg-background/90 backdrop-blur-xl"
          onClick={onClose}
        />

        {/* Modal Content */}
        <motion.div
          initial={{ y: 50, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 50, opacity: 0, scale: 0.95 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative w-full max-w-5xl max-h-[90vh] glass-panel rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row z-10"
        >
          {/* Close Button */}
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 z-50 w-10 h-10 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center text-white hover:bg-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Left Column - Poster */}
          <div className="w-full md:w-2/5 lg:w-1/3 relative shrink-0">
            <img 
              src={movie.poster} 
              alt={movie.title} 
              className="w-full h-64 md:h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent md:bg-gradient-to-r" />
          </div>

          {/* Right Column - Details & Downloads */}
          <div className="w-full md:w-3/5 lg:w-2/3 p-6 md:p-10 overflow-y-auto custom-scrollbar flex flex-col relative bg-background/50">
            
            {/* Header */}
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-3xl md:text-4xl font-bold text-white mb-2 tracking-tight">
                  {movie.title}
                </h2>
                <div className="flex flex-wrap items-center gap-3 text-sm text-gray-300">
                  <span className="flex items-center gap-1 bg-yellow-500/20 text-yellow-500 px-2 py-1 rounded">
                    <Star className="w-4 h-4 fill-current" />
                    <span className="font-bold">{movie.rating}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    {movie.year}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    120 min {/* Placeholder duration */}
                  </span>
                  <span className="px-2 py-1 border border-white/20 rounded text-white font-medium bg-white/5">
                    {movie.quality}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 shrink-0">
                <button 
                  onClick={toggleFavorite}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                    isFavorite ? 'bg-red-500/20 text-red-500' : 'glass hover:bg-white/10 text-white'
                  }`}
                >
                  <Heart className={`w-5 h-5 ${isFavorite ? 'fill-current' : ''}`} />
                </button>
                <button 
                  onClick={handleShare}
                  className="w-10 h-10 rounded-full glass hover:bg-white/10 text-white flex items-center justify-center transition-colors"
                >
                  <Share2 className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Info Tags */}
            <div className="flex flex-wrap gap-2 mb-6">
              <span className="px-3 py-1 glass rounded-full text-sm text-gray-300">
                Language: {movie.language}
              </span>
              <span className="px-3 py-1 glass rounded-full text-sm text-gray-300">
                Genre: {movie.genre}
              </span>
            </div>

            {/* Description */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-white mb-2">Synopsis</h3>
              <p className="text-gray-400 leading-relaxed text-sm md:text-base">
                {movie.description}
              </p>
            </div>

            {/* Download Options */}
            <div className="mt-auto">
              <h3 className="text-lg font-semibold text-white mb-4">Download Options</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <button 
                  onClick={() => handleDownload('480p')}
                  className="flex flex-col items-center justify-center p-4 rounded-2xl glass-button group"
                >
                  <span className="text-xl font-bold text-white mb-1 group-hover:text-primary transition-colors">480p</span>
                  <span className="text-xs text-gray-400 mb-3">~ 500 MB</span>
                  <div className="flex items-center gap-1 text-primary font-medium text-sm">
                    <Download className="w-4 h-4" /> Download
                  </div>
                </button>
                
                <button 
                  onClick={() => handleDownload('720p')}
                  className="flex flex-col items-center justify-center p-4 rounded-2xl glass-button group border-primary/30 bg-primary/5"
                >
                  <span className="text-xl font-bold text-white mb-1 group-hover:text-primary transition-colors">720p</span>
                  <span className="text-xs text-gray-400 mb-3">~ 1.2 GB</span>
                  <div className="flex items-center gap-1 text-primary font-medium text-sm">
                    <Download className="w-4 h-4" /> Download
                  </div>
                </button>

                <button 
                  onClick={() => handleDownload('1080p')}
                  className="flex flex-col items-center justify-center p-4 rounded-2xl glass-button group"
                >
                  <span className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary mb-1">1080p</span>
                  <span className="text-xs text-gray-400 mb-3">~ 2.5 GB</span>
                  <div className="flex items-center gap-1 text-primary font-medium text-sm">
                    <Download className="w-4 h-4" /> Download
                  </div>
                </button>
              </div>

              {/* Watch Online Button */}
              <button className="w-full mt-4 py-4 rounded-2xl border border-white/10 hover:border-white/30 bg-white/5 hover:bg-white/10 transition-all text-white font-semibold flex items-center justify-center gap-2">
                <Play className="w-5 h-5 text-primary" />
                Watch Online (Trailer)
              </button>
            </div>

          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default MovieDetailsModal;
