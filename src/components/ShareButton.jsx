import React, { useState, useEffect, useRef } from 'react';
import { Share2, Check, MessageCircle, Link as LinkIcon, MoreHorizontal } from 'lucide-react';

const ShareButton = ({ movieTitle, movieId, mediaType, movie }) => {
  const [copied, setCopied] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);

  // Derive canonical media type and clean numeric ID
  const resolvedType = (
    mediaType ||
    movie?.mediaType ||
    movie?.media_type ||
    (String(movieId || movie?.id).includes('-tv') ? 'tv' : null) ||
    (movie?.seasons && movie.seasons.length > 0 ? 'tv' : null) ||
    (movie?.genre && movie.genre.toLowerCase().includes('web series') ? 'tv' : null) ||
    'movie'
  );
  const type = resolvedType === 'tv' ? 'tv' : 'movie';
  const cleanId = String(movieId || movie?.id || '').split('-')[0].trim();
  const title = movieTitle || movie?.title || movie?.name || 'this title';

  // Dynamic Open Graph share URL format: /share/movie/{id} or /share/tv/{id}
  const baseOrigin = (typeof window !== 'undefined' && window.location.origin && !window.location.origin.includes('localhost'))
    ? window.location.origin
    : 'https://movieverify.vercel.app';
  const shareUrl = `${baseOrigin}/share/${type}/${cleanId}`;
  const shareText = `Check out "${title}" on MovieVerify!`;

  // Close menu on click outside
  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showMenu]);

  const copyToClipboard = async (text) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      textArea.remove();
      return successful;
    } catch {
      return false;
    }
  };

  const handleCopyLink = async (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    const success = await copyToClipboard(shareUrl);
    if (success) {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setShowMenu(false);
      }, 1500);
    }
  };

  const handleWhatsAppShare = (e) => {
    e.stopPropagation();
    // Direct WhatsApp compose flow (bypasses Windows/OS native share sheet)
    const textPayload = `${shareText}\n${shareUrl}`;
    const url = `https://wa.me/?text=${encodeURIComponent(textPayload)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setShowMenu(false);
  };

  const handleNativeShare = async (e) => {
    e.stopPropagation();
    setShowMenu(false);
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title,
          text: shareText,
          url: shareUrl,
        });
      } catch (err) {
        // User cancelled share - ignore
      }
    } else {
      // Fallback to Copy Link when navigator.share is not supported
      await handleCopyLink(e);
    }
  };

  const handleToggleMenu = (e) => {
    e.stopPropagation();
    setShowMenu((prev) => !prev);
  };

  return (
    <div className="relative inline-block" ref={menuRef}>
      <button
        onClick={handleToggleMenu}
        aria-expanded={showMenu}
        aria-haspopup="true"
        className="flex items-center gap-2 text-gray-300
                   hover:text-[#E50914] text-sm font-medium
                   transition group cursor-pointer"
        title="Share this title"
      >
        <Share2 className="w-[18px] h-[18px] flex-shrink-0
                           group-hover:scale-110 transition-transform" />
        <span>Share</span>
      </button>

      {showMenu && (
        <div className="absolute top-full left-0 mt-2 bg-[#242424]
                        rounded-lg shadow-xl p-2 z-50 w-52 border border-white/10
                        animate-in fade-in zoom-in-95 duration-100">
          {/* Action 1: Direct WhatsApp compose flow */}
          <button
            onClick={handleWhatsAppShare}
            className="flex items-center gap-2.5 w-full px-3 py-2
                       text-white text-sm hover:bg-[#333]
                       rounded-lg transition cursor-pointer text-left"
          >
            <MessageCircle className="w-4 h-4 text-[#25D366] flex-shrink-0" />
            <span>WhatsApp</span>
          </button>

          {/* Action 2: Copy link */}
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-2.5 w-full px-3 py-2
                       text-white text-sm hover:bg-[#333]
                       rounded-lg transition cursor-pointer text-left"
          >
            {copied ? (
              <Check className="w-4 h-4 text-[#25D366] flex-shrink-0" />
            ) : (
              <LinkIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
            )}
            <span className={copied ? "text-[#25D366] font-medium" : ""}>
              {copied ? 'Copied Link!' : 'Copy Link'}
            </span>
          </button>

          {/* Action 3: More options (navigator.share with Copy Link fallback) */}
          <button
            onClick={handleNativeShare}
            className="flex items-center gap-2.5 w-full px-3 py-2
                       text-gray-300 hover:text-white text-sm hover:bg-[#333]
                       rounded-lg transition cursor-pointer text-left
                       border-t border-white/5 mt-1 pt-2"
          >
            <MoreHorizontal className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span>More options...</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default ShareButton;
