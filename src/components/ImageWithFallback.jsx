import React, { useState, useEffect } from 'react';
import { imageManager } from '../utils/imageManager';

const ImageWithFallback = ({ src, backdropSrc, alt, className, style, onClick, lazy = true, shouldLoad = true, priority = false, ...props }) => {
  const [errorLevel, setErrorLevel] = useState(0);
  const [imageState, setImageState] = useState('NOT_REQUESTED');

  const isFallback = errorLevel >= 2 || (!src && !backdropSrc);
  const combinedClassName = `${className || ''} ${isFallback ? 'bg-[#1a1a1a]' : ''}`.trim();

  if (isFallback) {
    return (
      <div 
        className={combinedClassName} 
        style={style} 
        onClick={onClick}
        {...props}
      />
    );
  }

  const currentSrc = errorLevel === 0 && src ? src : backdropSrc;

  useEffect(() => {
    if (shouldLoad && currentSrc) {
      return imageManager.subscribe(currentSrc, (state) => {
        setImageState(state);
      });
    }
  }, [shouldLoad, currentSrc]);

  useEffect(() => {
    if (shouldLoad && currentSrc) {
      imageManager.requestImage(currentSrc);
    }
  }, [shouldLoad, currentSrc]);

  // If not supposed to load yet and not globally loaded, show placeholder structure
  if (!shouldLoad && imageState !== 'LOADED') {
    return (
      <div 
        className={combinedClassName} 
        style={style} 
        onClick={onClick}
        {...props}
      />
    );
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={combinedClassName}
      style={style}
      onClick={onClick}
      loading={lazy && !priority ? "lazy" : "eager"}
      decoding={lazy && !priority ? "async" : "auto"}
      fetchpriority={priority ? "high" : "auto"}
      onError={() => {
        if (errorLevel < 2) {
          setErrorLevel(prev => prev + 1);
        }
      }}
      {...props}
    />
  );
};

export default ImageWithFallback;
