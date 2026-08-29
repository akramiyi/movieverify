import React from 'react';

const SkeletonCard = () => {
  return (
    <div className="relative flex-none w-[120px] md:w-[180px] h-[180px] md:h-[270px] bg-[#2a2a2a] rounded-md animate-pulse overflow-hidden border border-white/5" />
  );
};

export default SkeletonCard;
