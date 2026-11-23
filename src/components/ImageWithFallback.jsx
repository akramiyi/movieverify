import React, { useState, useEffect } from 'react';
import { DEFAULT_POSTER } from '../hooks/useTMDB';
import { getOptimizedImageUrl } from '../utils/imageOptimization';

const ImageWithFallback = ({
  src,
  backdropSrc,
  alt,
  className,
  style,
  onClick,
  lazy = true,
  shouldLoad = true,
  priority = false,
  onLoad,
  ...props
}) => {
  const [errorLevel, setErrorLevel] = useState(0);

  // Reset errorLevel whenever src or backdropSrc changes
  useEffect(() => {
    setErrorLevel(0);
  }, [src, backdropSrc]);

  // Fallback progression: src -> backdropSrc -> DEFAULT_POSTER (guarantees no grey boxes)
  let rawSrc = DEFAULT_POSTER;
  if (errorLevel === 0) {
    rawSrc = src || backdropSrc || DEFAULT_POSTER;
  } else if (errorLevel === 1) {
    rawSrc = (backdropSrc && backdropSrc !== src) ? backdropSrc : DEFAULT_POSTER;
  } else {
    rawSrc = DEFAULT_POSTER;
  }

  // Trigger onLoad immediately for inline SVG data URI to unblock parent skeletons
  useEffect(() => {
    if (rawSrc && rawSrc.startsWith('data:') && onLoad) {
      onLoad();
    }
  }, [rawSrc, onLoad]);

  // If using Cloudflare image optimization, route external TMDB URLs
  const currentSrc = (rawSrc && !rawSrc.startsWith('data:') && !rawSrc.startsWith('/'))
    ? getOptimizedImageUrl(rawSrc, { width: priority ? 1280 : 500, format: 'webp', quality: 80 })
    : rawSrc;

  // Generate responsive srcSet for posters
  const getSrcSet = (url) => {
    if (!url || typeof url !== 'string' || url.startsWith('data:') || url.startsWith('/')) {
      return undefined;
    }
    const w200 = getOptimizedImageUrl(url, { width: 200, format: 'webp', quality: 75 });
    const w342 = getOptimizedImageUrl(url, { width: 342, format: 'webp', quality: 80 });
    const w500 = getOptimizedImageUrl(url, { width: 500, format: 'webp', quality: 80 });
    const w780 = getOptimizedImageUrl(url, { width: 780, format: 'webp', quality: 80 });
    return `${w200} 200w, ${w342} 342w, ${w500} 500w, ${w780} 780w`;
  };

  const srcSet = getSrcSet(rawSrc);
  const sizes = srcSet ? '(max-width: 640px) 160px, (max-width: 1024px) 240px, 350px' : undefined;

  return (
    <img
      src={currentSrc}
      srcSet={srcSet}
      sizes={sizes}
      alt={alt || 'Movie'}
      className={className}
      style={style}
      onClick={onClick}
      loading={lazy && !priority ? "lazy" : "eager"}
      decoding="async"
      fetchpriority={priority ? "high" : "auto"}
      onLoad={(e) => {
        if (onLoad) onLoad(e);
      }}
      onError={() => {
        if (errorLevel === 0 && backdropSrc && backdropSrc !== src) {
          setErrorLevel(1);
        } else if (errorLevel < 2) {
          setErrorLevel(2);
          if (onLoad) onLoad(); // unblock parent skeleton so crisp fallback is visible
        }
      }}
      {...props}
    />
  );
};

export default ImageWithFallback;
