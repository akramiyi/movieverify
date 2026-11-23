/**
 * Native TMDB Image Optimization Helper
 *
 * Uses direct TMDB CDN URLs (https://image.tmdb.org/t/p/...) with exact responsive sizes.
 * Avoids Cloudflare Paid Image Resizing (/cdn-cgi/image/) while delivering fast, CDN-cached
 * images in w342, w500, w780, and w1280.
 */

// TMDB supported standard widths
const TMDB_POSTER_SIZES = [92, 154, 185, 342, 500, 780];
const TMDB_BACKDROP_SIZES = [300, 780, 1280];

/**
 * Maps any requested target pixel width to the most appropriate TMDB width tier.
 */
export function getTmdbSizeByWidth(width, isBackdrop = false) {
  if (isBackdrop) {
    if (width <= 300) return 'w300';
    if (width <= 780) return 'w780';
    return 'w1280';
  }
  if (width <= 92) return 'w92';
  if (width <= 154) return 'w154';
  if (width <= 185) return 'w185';
  if (width <= 342) return 'w342';
  if (width <= 500) return 'w500';
  if (width <= 780) return 'w780';
  return 'w780';
}

/**
 * Returns a direct TMDB optimized image URL with exact size tier.
 * Never requests "original" unless explicitly required, saving up to 85% bandwidth.
 */
export function getOptimizedImageUrl(rawUrl, { width = 500, isBackdrop = false } = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';

  // Return data URIs, local assets, or SVG directly
  if (rawUrl.startsWith('data:') || rawUrl.startsWith('/') || rawUrl.endsWith('.svg')) {
    return rawUrl;
  }

  // Strip any old Cloudflare image resizing prefix if encountered
  let cleanUrl = rawUrl;
  if (cleanUrl.includes('/cdn-cgi/image/')) {
    const cfMatch = cleanUrl.match(/\/https?:\/\/.+$/);
    if (cfMatch) {
      cleanUrl = cfMatch[0].replace(/^\//, '');
    }
  }

  // Handle TMDB URLs
  if (cleanUrl.includes('image.tmdb.org/t/p/')) {
    const match = cleanUrl.match(/\/t\/p\/[^/]+(\/.+)$/);
    if (match && match[1]) {
      const tmdbSize = getTmdbSizeByWidth(width, isBackdrop);
      return `https://image.tmdb.org/t/p/${tmdbSize}${match[1]}`;
    }
  }

  return cleanUrl;
}

/**
 * Responsive backdrop sources helper for Hero Carousel:
 * Mobile: w780 directly from image.tmdb.org
 * Desktop: w1280 directly from image.tmdb.org
 * Fallback: w1280
 */
export function getHeroBackdropSources(movie) {
  if (!movie) return { mobile: '', desktop: '', fallback: '' };

  const raw = movie.backdrop || movie.original_backdrop || movie.poster || '';
  if (!raw || raw.startsWith('data:')) {
    return { mobile: raw, desktop: raw, fallback: raw };
  }

  // Extract clean TMDB relative path
  let imgPath = '';
  if (movie.backdrop_path) {
    imgPath = '/' + movie.backdrop_path.replace(/^\/+/, '');
  } else if (raw.includes('/t/p/')) {
    const match = raw.match(/\/t\/p\/[^/]+(\/.+)$/);
    if (match) imgPath = match[1];
  }

  const mobileUrl = imgPath ? `https://image.tmdb.org/t/p/w780${imgPath}` : raw;
  const desktopUrl = imgPath ? `https://image.tmdb.org/t/p/w1280${imgPath}` : raw;

  return {
    mobile: mobileUrl,
    desktop: desktopUrl,
    fallback: desktopUrl,
  };
}
