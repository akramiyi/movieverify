import React, { useState, useEffect, useRef } from 'react';
import { Share2, Check, MessageCircle, Link as LinkIcon, MoreHorizontal, Loader2 } from 'lucide-react';
import { getMediaTypeFromId } from '../hooks/useTMDB';

// Module-level prewarm cache mapping canonicalShareUrl -> Promise<{ ok, data, error }>
const prewarmCache = new Map();

export async function prewarmShareUrl(canonicalShareUrl, timeoutMs = 4000) {
  if (!canonicalShareUrl) return null;

  if (prewarmCache.has(canonicalShareUrl)) {
    return prewarmCache.get(canonicalShareUrl);
  }

  const promise = (async () => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = setTimeout(() => {
      if (controller) controller.abort();
    }, timeoutMs);

    try {
      const res = await fetch(canonicalShareUrl, {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: controller ? controller.signal : undefined
      });

      if (!res.ok) {
        throw new Error(`Prewarm fetch returned status ${res.status}`);
      }

      const html = await res.text();

      const titleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
                         html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:title["']/i);
      const descMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i) ||
                        html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:description["']/i);
      const imageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                         html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);
      const urlMatch = html.match(/<meta\s+property=["']og:url["']\s+content=["']([^"']+)["']/i) ||
                       html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:url["']/i);

      const ogTitle = titleMatch ? titleMatch[1] : null;
      const ogDescription = descMatch ? descMatch[1] : null;
      const ogImage = imageMatch ? imageMatch[1] : null;
      const ogUrl = urlMatch ? urlMatch[1] : null;

      if (!ogTitle || !ogImage) {
        throw new Error('Incomplete Open Graph metadata');
      }

      // Preload & decode poster image in browser environment
      if (typeof window !== 'undefined' && typeof Image !== 'undefined' && ogImage) {
        try {
          await new Promise((resolve) => {
            const img = new Image();
            const imgTimeout = setTimeout(resolve, 2500);

            img.onload = () => {
              clearTimeout(imgTimeout);
              if (typeof img.decode === 'function') {
                img.decode().then(resolve).catch(resolve);
              } else {
                resolve();
              }
            };
            img.onerror = () => {
              clearTimeout(imgTimeout);
              resolve();
            };
            img.src = ogImage;
          });
        } catch {
          // Non-fatal image preload failure
        }
      }

      return {
        ok: true,
        ogTitle,
        ogDescription,
        ogImage,
        ogUrl
      };
    } catch (err) {
      return {
        ok: false,
        error: err.message
      };
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  prewarmCache.set(canonicalShareUrl, promise);
  return promise;
}

const ShareButton = ({ movieTitle, movieId, mediaType, movie }) => {
  const [copied, setCopied] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [prewarmReady, setPrewarmReady] = useState(false);
  const menuRef = useRef(null);

  const cleanId = String(movieId || movie?.id || '').split('-')[0].trim();
  const title = movieTitle || movie?.title || movie?.name || 'this title';

  // Authoritative media type resolver:
  // 1. Movie object's own mediaType takes precedence over external/inherited props
  // 2. Explicit mediaType prop
  // 3. ID suffix hints (-tv vs -movie)
  // 4. Seasons / TV-specific metadata
  // 5. Catalog / local reference lookup
  // 6. Release date metadata
  // Never silently defaults to 'movie'
  const deriveMediaType = () => {
    const objType = movie?.mediaType || movie?.media_type;
    if (objType === 'tv' || objType === 'movie') return objType;

    if (mediaType === 'tv' || mediaType === 'movie') return mediaType;

    const rawIdStr = String(movieId || movie?.id || '');
    if (rawIdStr.includes('-tv')) return 'tv';
    if (rawIdStr.includes('-movie')) return 'movie';

    if (movie?.seasons && Array.isArray(movie.seasons) && movie.seasons.length > 0) return 'tv';
    if (movie?.first_air_date) return 'tv';
    if (movie?.genre && (
      movie.genre.toLowerCase().includes('web series') ||
      movie.genre.toLowerCase().includes('tv series')
    )) {
      return 'tv';
    }

    if (cleanId) {
      const fromCatalog = getMediaTypeFromId(cleanId);
      if (fromCatalog === 'tv' || fromCatalog === 'movie') return fromCatalog;
    }

    if (movie?.release_date) return 'movie';

    return null;
  };

  const type = deriveMediaType();
  const hasValidMediaType = !!type;

  // Dynamic Open Graph share URL format: /share/movie/{id} or /share/tv/{id}
  const baseOrigin = (typeof window !== 'undefined' && window.location.origin && !window.location.origin.includes('localhost'))
    ? window.location.origin
    : 'https://movieverify.vercel.app';
  const shareUrl = hasValidMediaType ? `${baseOrigin}/share/${type}/${cleanId}` : '';
  const shareText = `Check out "${title}" on MovieVerify!`;

  // Start preparing the exact canonical share URL as soon as component/details are available
  useEffect(() => {
    if (!hasValidMediaType || !shareUrl) {
      setPrewarmReady(false);
      return;
    }

    let isMounted = true;
    prewarmShareUrl(shareUrl)
      .then((res) => {
        if (!isMounted) return;
        if (res && res.ok) {
          setPrewarmReady(true);
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setPrewarmReady(false);
      });

    return () => {
      isMounted = false;
    };
  }, [hasValidMediaType, shareUrl]);

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
    if (!hasValidMediaType || !shareUrl) return;
    const success = await copyToClipboard(shareUrl);
    if (success) {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setShowMenu(false);
      }, 1500);
    }
  };

  const handleWhatsAppShare = async (e) => {
    e.stopPropagation();
    if (!hasValidMediaType || !shareUrl) return;

    // Direct WhatsApp compose flow (bypasses Windows/OS native share sheet)
    const textPayload = `${shareText}\n${shareUrl}`;
    const waUrl = `https://wa.me/?text=${encodeURIComponent(textPayload)}`;

    // 1. If prewarming has already completed, launch immediately and synchronously
    if (prewarmReady) {
      window.open(waUrl, '_blank', 'noopener,noreferrer');
      setShowMenu(false);
      return;
    }

    // 2. Otherwise, show 'Preparing poster...' feedback while prewarming finishes
    setIsPreparing(true);

    const isMobile = typeof window !== 'undefined' && (
      'ontouchstart' in window ||
      (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
      /android|iphone|ipad|ipod/i.test(navigator.userAgent || '')
    );

    // Open placeholder synchronously on desktop to prevent popup blockers
    const win = (!isMobile && typeof window !== 'undefined')
      ? window.open('about:blank', '_blank')
      : null;

    try {
      await Promise.race([
        prewarmShareUrl(shareUrl),
        new Promise((resolve) => setTimeout(resolve, 2500))
      ]);
    } catch (err) {
      console.warn('Prewarm fallback error:', err);
    } finally {
      setIsPreparing(false);
      setShowMenu(false);

      if (win && !win.closed) {
        win.location.href = waUrl;
      } else {
        if (isMobile) {
          window.location.href = waUrl;
        } else {
          window.open(waUrl, '_blank', 'noopener,noreferrer');
        }
      }
    }
  };

  const handleNativeShare = async (e) => {
    e.stopPropagation();
    setShowMenu(false);
    if (!hasValidMediaType || !shareUrl) return;
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
        <div className="absolute top-full right-0 left-auto sm:right-auto sm:left-0 mt-2 bg-[#242424]
                        rounded-lg shadow-2xl p-2 z-50 w-56 border border-white/10
                        animate-in fade-in zoom-in-95 duration-100">
          {!hasValidMediaType ? (
            <div className="p-3 text-xs text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded-lg text-center leading-relaxed">
              Media type could not be verified. Sharing is disabled for this title.
            </div>
          ) : (
            <>
              {/* Action 1: Direct WhatsApp compose flow with prewarming feedback */}
              <button
                onClick={handleWhatsAppShare}
                disabled={isPreparing}
                className="flex items-center gap-2.5 w-full px-3 py-2
                           text-white text-sm hover:bg-[#333]
                           rounded-lg transition cursor-pointer text-left whitespace-nowrap
                           disabled:opacity-80"
              >
                {isPreparing ? (
                  <>
                    <Loader2 className="w-4 h-4 text-[#25D366] flex-shrink-0 animate-spin" />
                    <span className="text-[#25D366] font-medium">Preparing poster...</span>
                  </>
                ) : (
                  <>
                    <MessageCircle className="w-4 h-4 text-[#25D366] flex-shrink-0" />
                    <span>WhatsApp</span>
                  </>
                )}
              </button>

              {/* Action 2: Copy link */}
              <button
                onClick={handleCopyLink}
                className="flex items-center gap-2.5 w-full px-3 py-2
                           text-white text-sm hover:bg-[#333]
                           rounded-lg transition cursor-pointer text-left whitespace-nowrap"
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
                           rounded-lg transition cursor-pointer text-left whitespace-nowrap
                           border-t border-white/5 mt-1 pt-2"
              >
                <MoreHorizontal className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span>More options...</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ShareButton;
