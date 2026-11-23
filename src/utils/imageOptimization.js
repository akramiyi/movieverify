/**
 * Cloudflare Image Resizing & WebP Optimization Helper
 * Routes TMDB images through Cloudflare Image Resizing (https://moviex.sbs/cdn-cgi/image/...)
 * Automatically compresses, converts to modern WebP, and reduces transfer weight by 80%+.
 */

const CF_RESIZING_BASE = 'https://moviex.sbs/cdn-cgi/image';

export function getOptimizedImageUrl(rawUrl, { width = 800, format = 'webp', quality = 80 } = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';

  // Return data URIs, local assets, or SVG directly
  if (rawUrl.startsWith('data:') || rawUrl.startsWith('/') || rawUrl.endsWith('.svg')) {
    return rawUrl;
  }

  // Already transformed by Cloudflare
  if (rawUrl.includes('/cdn-cgi/image/')) {
    return rawUrl;
  }

  // Normalize TMDB URLs
  let targetSource = rawUrl;
  if (rawUrl.includes('image.tmdb.org/t/p/')) {
    // Extract relative path after size e.g. /t/p/w500/xyz.jpg -> /xyz.jpg
    const match = rawUrl.match(/\/t\/p\/[^/]+(\/.+)$/);
    if (match && match[1]) {
      targetSource = `https://image.tmdb.org/t/p/original${match[1]}`;
    }
  }

  // Build Cloudflare Image Resizing URL
  return `${CF_RESIZING_BASE}/width=${width},format=${format},quality=${quality}/${targetSource}`;
}

/**
 * Responsive picture sources helper for Hero and High-Performance Components
 */
export function getHeroBackdropSources(movie) {
  if (!movie) return { mobile: '', desktop: '', fallback: '' };

  const raw = movie.backdrop || movie.original_backdrop || movie.poster || '';
  if (!raw || raw.startsWith('data:')) {
    return { mobile: raw, desktop: raw, fallback: raw };
  }

  // Extract TMDB clean path if available
  let imgPath = '';
  if (movie.backdrop_path) {
    imgPath = '/' + movie.backdrop_path.replace(/^\/+/, '');
  } else if (raw.includes('/t/p/')) {
    const match = raw.match(/\/t\/p\/[^/]+(\/.+)$/);
    if (match) imgPath = match[1];
  }

  const tmdbMobile = imgPath ? `https://image.tmdb.org/t/p/w780${imgPath}` : raw;
  const tmdbDesktop = imgPath ? `https://image.tmdb.org/t/p/w1280${imgPath}` : raw;

  return {
    mobile: getOptimizedImageUrl(tmdbMobile, { width: 780, format: 'webp', quality: 80 }),
    desktop: getOptimizedImageUrl(tmdbDesktop, { width: 1280, format: 'webp', quality: 82 }),
    fallback: tmdbDesktop,
  };
}
