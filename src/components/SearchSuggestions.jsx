import React from 'react';
import { Search } from 'lucide-react';

const SearchSuggestions = ({ suggestions, onSelect, visible }) => {
  if (!visible || suggestions.length === 0) return null;

  return (
    <div className="absolute top-full left-0 right-0 mt-2 bg-[#181818] 
                    border border-white/10 rounded-lg shadow-2xl 
                    overflow-hidden z-50 max-h-80 overflow-y-auto">
      {suggestions.map((movie) => (
        <div
          key={movie.id}
          onClick={() => onSelect(movie)}
          className="flex items-center gap-3 px-4 py-2.5 
                     hover:bg-white/5 cursor-pointer transition 
                     border-b border-white/5 last:border-b-0"
        >
          <Search className="w-4 h-4 text-gray-500 flex-shrink-0" />
          {movie.poster && (
            <img 
              src={movie.poster} 
              alt={movie.title}
              className="w-8 h-11 object-cover rounded flex-shrink-0"
              loading="lazy"
            />
          )}
          <div className="min-w-0">
            <p className="text-white text-sm font-medium truncate">
              {movie.title}
            </p>
            <p className="text-gray-500 text-xs">{movie.year}</p>
          </div>
        </div>
      ))}
    </div>
  );
};

export default SearchSuggestions;
