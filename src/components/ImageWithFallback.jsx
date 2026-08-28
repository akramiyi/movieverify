import React, { useState } from 'react';
import { motion } from 'framer-motion';

const ImageWithFallback = ({ src, backdropSrc, alt, className, style, onClick, ...props }) => {
  const [errorLevel, setErrorLevel] = useState(0);

  const getSrc = () => {
    if (errorLevel === 0 && src) return src;
    if (errorLevel <= 1 && backdropSrc) return backdropSrc;
    return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  };

  const currentSrc = getSrc();
  const isFallback = errorLevel >= 2 || (!src && !backdropSrc);
  const combinedClassName = `${className || ''} ${isFallback ? 'bg-[#1a1a1a]' : ''}`.trim();

  return (
    <motion.img
      src={currentSrc}
      alt={alt}
      className={combinedClassName}
      style={style}
      onClick={onClick}
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
