import React from 'react';
import { SlidersHorizontal, X } from 'lucide-react';

const GENRES = ['All', 'Action', 'Comedy', 'Drama', 'Horror', 
                'Romance', 'Thriller', 'Sci-Fi', 'Crime'];
const LANGUAGES = ['All', 'Hindi', 'English', 'Telugu', 'Tamil', 
                    'Kannada'];
const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'rating_desc', label: 'Rating: High to Low' },
  { value: 'rating_asc', label: 'Rating: Low to High' },
  { value: 'year_desc', label: 'Newest First' },
  { value: 'year_asc', label: 'Oldest First' },
];

const SearchFilters = ({ filters, onFilterChange, onReset, 
                          resultCount }) => {
  const [isOpen, setIsOpen] = React.useState(false);

  const hasActiveFilters = 
    filters.genre !== 'All' || 
    filters.language !== 'All' || 
    filters.minRating > 0 ||
    filters.sortBy !== 'relevance';

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <p className="text-gray-400 text-sm">
          {resultCount} results found
        </p>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 text-white text-sm 
                     font-medium bg-[#242424] hover:bg-[#333] 
                     px-4 py-2 rounded-full transition"
        >
          <SlidersHorizontal className="w-4 h-4" />
          Filters
          {hasActiveFilters && (
            <span className="w-2 h-2 bg-[#E50914] rounded-full" />
          )}
        </button>
      </div>

      {isOpen && (
        <div className="bg-[#1a1a1a] rounded-xl p-4 mb-4 
                        grid grid-cols-1 sm:grid-cols-2 
                        md:grid-cols-4 gap-4">
          {/* Genre */}
          <div>
            <label className="text-gray-400 text-xs mb-1 block">
              Genre
            </label>
            <select
              value={filters.genre}
              onChange={(e) => onFilterChange('genre', e.target.value)}
              className="w-full bg-[#242424] border border-white/10 
                         rounded-lg px-3 py-2 text-white text-sm 
                         outline-none focus:border-[#E50914]"
            >
              {GENRES.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>

          {/* Language */}
          <div>
            <label className="text-gray-400 text-xs mb-1 block">
              Language
            </label>
            <select
              value={filters.language}
              onChange={(e) => onFilterChange('language', e.target.value)}
              className="w-full bg-[#242424] border border-white/10 
                         rounded-lg px-3 py-2 text-white text-sm 
                         outline-none focus:border-[#E50914]"
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>

          {/* Min Rating */}
          <div>
            <label className="text-gray-400 text-xs mb-1 block">
              Min Rating: {filters.minRating}+
            </label>
            <input
              type="range"
              min="0"
              max="9"
              step="1"
              value={filters.minRating}
              onChange={(e) => onFilterChange('minRating', 
                Number(e.target.value))}
              className="w-full accent-[#E50914]"
            />
          </div>

          {/* Sort */}
          <div>
            <label className="text-gray-400 text-xs mb-1 block">
              Sort By
            </label>
            <select
              value={filters.sortBy}
              onChange={(e) => onFilterChange('sortBy', e.target.value)}
              className="w-full bg-[#242424] border border-white/10 
                         rounded-lg px-3 py-2 text-white text-sm 
                         outline-none focus:border-[#E50914]"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {hasActiveFilters && (
            <button
              onClick={onReset}
              className="flex items-center gap-1 text-[#E50914] 
                         hover:text-white text-sm font-medium 
                         sm:col-span-2 md:col-span-4 justify-center 
                         mt-2"
            >
              <X className="w-4 h-4" />
              Clear All Filters
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default SearchFilters;
