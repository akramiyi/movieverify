import React, { useState } from 'react';
import { Share2, Check, MessageCircle, Link as LinkIcon } from 'lucide-react';

const ShareButton = ({ movieTitle, movieId }) => {
  const [copied, setCopied] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const shareUrl = `${window.location.origin}/?movie=${movieId}`;
  const shareText = `Check out "${movieTitle}" on MovieVerify!`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Copy failed:', err.message);
    }
  };

  const handleWhatsAppShare = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(
      `${shareText} ${shareUrl}`
    )}`;
    window.open(url, '_blank');
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: movieTitle,
          text: shareText,
          url: shareUrl,
        });
      } catch (err) {
        // user cancelled share - ignore
      }
    } else {
      setShowMenu(!showMenu);
    }
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={handleNativeShare}
        className="flex items-center gap-2 text-gray-300 
                   hover:text-[#E50914] text-sm font-medium 
                   transition group"
      >
        <Share2 className="w-[18px] h-[18px] flex-shrink-0 
                           group-hover:scale-110 transition-transform" />
        <span>Share</span>
      </button>

      {showMenu && (
        <div className="absolute top-full left-0 mt-2 bg-[#242424] 
                        rounded-lg shadow-xl p-2 z-50 w-48">
          <button
            onClick={handleWhatsAppShare}
            className="flex items-center gap-2 w-full px-3 py-2 
                       text-white text-sm hover:bg-[#333] 
                       rounded-lg transition"
          >
            <MessageCircle className="w-4 h-4 text-green-500" />
            WhatsApp
          </button>
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-2 w-full px-3 py-2 
                       text-white text-sm hover:bg-[#333] 
                       rounded-lg transition"
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <LinkIcon className="w-4 h-4 text-gray-400" />
            )}
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
        </div>
      )}
    </div>
  );
};

export default ShareButton;
