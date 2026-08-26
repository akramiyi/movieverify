import React from 'react';
import { motion } from 'framer-motion';

const CategoryFilter = ({ categories, selectedCategory, onSelectCategory }) => {
  return (
    <div className="mb-8 overflow-x-auto pb-4 scrollbar-hide">
      <div className="flex items-center gap-3 min-w-max">
        {categories.map((category) => {
          const isSelected = selectedCategory === category;
          
          return (
            <button
              key={category}
              onClick={() => onSelectCategory(category)}
              className={`relative px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-300 ${
                isSelected 
                  ? 'text-white shadow-[0_0_15px_rgba(59,130,246,0.5)]' 
                  : 'text-gray-400 hover:text-white hover:bg-white/5 bg-transparent border border-white/10'
              }`}
            >
              {isSelected && (
                <motion.div
                  layoutId="activeCategory"
                  className="absolute inset-0 bg-primary rounded-full -z-10"
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
              <span className="relative z-10">{category}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CategoryFilter;
