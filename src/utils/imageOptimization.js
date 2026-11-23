/**
 * Direct TMDB Image Optimization Helper
 *
 * Exclusively uses direct TMDB CDN URLs (https://image.tmdb.org/t/p/...) with exact responsive sizes.
 * Never calls Cloudflare /cdn-cgi/image/ (requires paid plan).
 *
 * Rules:
 * - Desktop Hero: w1280
 * - Mobile Hero: w780
 * - Movie Posters: w342 or w500
 * - Thumbnails: w185
 */

const TMDB_CDN_BASE = 'https://image.tmdb.org/t/p';

/**
 * Maps requested pixel width to the most appropriate TMDB width tier.
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
  return 'w780';
}

/**
 * Returns a direct TMDB URL with exact size tier (w342, w500, w780, w1280).
 * Strips any legacy /cdn-cgi/image/ or /api/image prefixes and ensures clean paths.
 */
export function getOptimizedImageUrl(rawUrl, { width = 500, isBackdrop = false } = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';

  // Return data URIs, local assets, or SVG directly
  if (rawUrl.startsWith('data:') || rawUrl.startsWith('/') && !rawUrl.startsWith('/api/image') || rawUrl.endsWith('.svg')) {
    return rawUrl;
  }

  // Strip legacy Cloudflare /cdn-cgi/image/ prefix if present
  let cleanUrl = rawUrl;
  if (cleanUrl.includes('/cdn-cgi/image/')) {
    const cfMatch = cleanUrl.match(/\/https?:\/\/.+$/);
    if (cfMatch) {
      cleanUrl = cfMatch[0].replace(/^\//, '');
    }
  }

  // Strip /api/image/ prefix if present to route directly to image.tmdb.org
  if (cleanUrl.includes('/api/image/')) {
    cleanUrl = cleanUrl.replace(/.*?\/api\/image\//, 'https://image.tmdb.org/t/p/');
  }

  // Handle TMDB URLs: extract path and apply ideal size tier
  if (cleanUrl.includes('image.tmdb.org/t/p/')) {
    const match = cleanUrl.match(/\/t\/p\/[^/]+(\/.+)$/);
    if (match && match[1]) {
      const tmdbSize = getTmdbSizeByWidth(width, isBackdrop);
      return `${TMDB_CDN_BASE}/${tmdbSize}${match[1]}`;
    }
  }

  return cleanUrl;
}

/**
 * Responsive backdrop sources helper for Hero Carousel:
 * Mobile (<768px): w780 direct from TMDB
 * Desktop (>=769px): w1280 direct from TMDB
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
  } else if (raw.includes('/api/image/')) {
    const match = raw.match(/\/api\/image\/[^/]+(\/.+)$/);
    if (match) imgPath = match[1];
  }

  const mobileUrl = imgPath ? `${TMDB_CDN_BASE}/w780${imgPath}` : raw;
  const desktopUrl = imgPath ? `${TMDB_CDN_BASE}/w1280${imgPath}` : raw;

  return {
    mobile: mobileUrl,
    desktop: desktopUrl,
    fallback: desktopUrl,
  };
}
