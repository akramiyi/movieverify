import React, { useState, useEffect, useRef } from 'react';
import { Share2, Check, MessageCircle, Link as LinkIcon } from 'lucide-react';

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

  // Canonical unambiguous URL format: /?type=movie&id=550 or /?type=tv&id=71446
  const shareUrl = `${window.location.origin}/?type=${type}&id=${cleanId}`;
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

  const handleCopyLink = async () => {
    const success = await copyToClipboard(shareUrl);
    if (success) {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setShowMenu(false);
      }, 2000);
    }
  };

  const handleWhatsAppShare = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(
      `${shareText} ${shareUrl}`
    )}`;
    window.open(url, '_blank');
    setShowMenu(false);
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
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
      setShowMenu((prev) => !prev);
    }
  };

  return (
    <div className="relative inline-block" ref={menuRef}>
      <button
        onClick={handleNativeShare}
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
                        rounded-lg shadow-xl p-2 z-50 w-48 border border-white/10">
          <button
            onClick={handleWhatsAppShare}
            className="flex items-center gap-2 w-full px-3 py-2
                       text-white text-sm hover:bg-[#333]
                       rounded-lg transition cursor-pointer"
          >
            <MessageCircle className="w-4 h-4 text-green-500" />
            WhatsApp
          </button>
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-2 w-full px-3 py-2
                       text-white text-sm hover:bg-[#333]
                       rounded-lg transition cursor-pointer"
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <LinkIcon className="w-4 h-4 text-gray-400" />
            )}
            {copied ? 'Copied Link!' : 'Copy Link'}
          </button>
        </div>
      )}
    </div>
  );
};

export default ShareButton;
