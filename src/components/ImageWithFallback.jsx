import React, { useState, useEffect } from 'react';
import { DEFAULT_POSTER } from '../hooks/useTMDB';

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

  // Fallback progression: src -> backdropSrc -> DEFAULT_POSTER (guarantees no grey boxes)
  let currentSrc = DEFAULT_POSTER;
  if (errorLevel === 0) {
    currentSrc = src || backdropSrc || DEFAULT_POSTER;
  } else if (errorLevel === 1) {
    currentSrc = (backdropSrc && backdropSrc !== src) ? backdropSrc : DEFAULT_POSTER;
  } else {
    currentSrc = DEFAULT_POSTER;
  }

  // Trigger onLoad immediately for inline SVG data URI to unblock parent skeletons
  useEffect(() => {
    if (currentSrc && currentSrc.startsWith('data:') && onLoad) {
      onLoad();
    }
  }, [currentSrc, onLoad]);

  // Generate responsive srcSet for image proxy/TMDB images
  const getSrcSet = (url) => {
    if (!url || typeof url !== 'string' || url.startsWith('data:') || !url.includes('/w500/')) {
      return undefined;
    }
    const cleanUrl = url.replace(/([^:]\/)\/+/g, '$1');
    const w342Url = cleanUrl.replace('/w500/', '/w342/');
    const w780Url = cleanUrl.replace('/w500/', '/w780/');
    return `${w342Url} 342w, ${cleanUrl} 500w, ${w780Url} 780w`;
  };

  const srcSet = getSrcSet(currentSrc);
  const sizes = srcSet ? '(max-width: 640px) 120px, (max-width: 1024px) 180px, 240px' : undefined;

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
