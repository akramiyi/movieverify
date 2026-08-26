import React from 'react';

const SkeletonCard = () => {
  return (
    <div className="relative flex-none w-[160px] md:w-[240px] h-[90px] md:h-[135px] bg-[#2a2a2a] rounded-md animate-pulse overflow-hidden border border-white/5" />
  );
};

export default SkeletonCard;
