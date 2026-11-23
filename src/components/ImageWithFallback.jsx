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

  // Native TMDB direct sizing (w342 default, w500/w780 for priority)
  const currentSrc = (rawSrc && !rawSrc.startsWith('data:') && !rawSrc.startsWith('/'))
    ? getOptimizedImageUrl(rawSrc, { width: priority ? 500 : 342 })
    : rawSrc;

  // Generate responsive srcSet for posters with native TMDB sizes
  const getSrcSet = (url) => {
    if (!url || typeof url !== 'string' || url.startsWith('data:') || url.startsWith('/')) {
      return undefined;
    }
    const w185 = getOptimizedImageUrl(url, { width: 185 });
    const w342 = getOptimizedImageUrl(url, { width: 342 });
    const w500 = getOptimizedImageUrl(url, { width: 500 });
    return `${w185} 185w, ${w342} 342w, ${w500} 500w`;
  };

  const srcSet = getSrcSet(rawSrc);
  const sizes = srcSet ? '(max-width: 640px) 154px, (max-width: 1024px) 200px, 342px' : undefined;

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
