import React, { useState } from 'react';

const ImageWithFallback = ({ src, backdropSrc, alt, className, style, onClick, lazy = false, ...props }) => {
  const [errorLevel, setErrorLevel] = useState(0);

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

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={combinedClassName}
      style={style}
      onClick={onClick}
      loading={lazy ? "lazy" : undefined}
      decoding={lazy ? "async" : undefined}
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
