import React, { useState, useEffect } from 'react';
import { Search, Bell, User, Menu, X } from 'lucide-react';

const Navbar = ({ onSearch, searchQuery }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 0) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <nav 
      className={`fixed top-0 w-full z-50 transition-colors duration-500 ease-in-out ${
        isScrolled || isMobileMenuOpen ? 'bg-[#141414]' : 'bg-gradient-to-b from-black/80 to-transparent'
      }`}
    >
      <div className="px-4 md:px-12 py-4 flex items-center justify-between">
        
        {/* Left Side - Logo & Links */}
        <div className="flex items-center gap-4 md:gap-8">
          {/* Hamburger Menu Icon for Mobile */}
          <button 
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="lg:hidden text-white focus:outline-none"
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>

          <div className="flex items-center gap-1.5 cursor-pointer select-none font-black text-lg md:text-2xl">
            <div className="flex items-center justify-center w-7 h-7 md:w-8 md:h-8 bg-gradient-to-br from-[#FF3445] to-[#E50914] rounded-md shadow-[0_0_10px_rgba(229,9,20,0.5)] text-white text-sm md:text-base font-black">
              M
            </div>
            <span className="text-white tracking-tighter font-sans uppercase">
              Ovie<span className="text-[#E50914]">verify</span>
            </span>
          </div>
          
          <div className="hidden lg:flex items-center gap-5 text-sm font-medium text-gray-300">
            <a href="#" className="text-white hover:text-gray-300 transition">Home</a>
            <a href="#" className="hover:text-gray-300 transition">TV Shows</a>
            <a href="#" className="hover:text-gray-300 transition">Movies</a>
            <a href="#" className="hover:text-gray-300 transition">New & Popular</a>
            <a href="#" className="hover:text-gray-300 transition">My List</a>
          </div>
        </div>

        {/* Right Side - Search & Profile */}
        <div className="flex items-center gap-4 md:gap-6">
          <div className={`flex items-center transition-all duration-300 ${isSearchExpanded ? 'bg-black/80 border border-white/80 px-2 py-1' : 'bg-transparent'}`}>
            <button 
              onClick={() => setIsSearchExpanded(!isSearchExpanded)}
              className="text-white focus:outline-none"
            >
              <Search className="w-5 h-5 md:w-6 md:h-6" />
            </button>
            <input 
              type="text"
              placeholder="Titles, genres"
              value={searchQuery}
              onChange={(e) => {
                if(!isSearchExpanded) setIsSearchExpanded(true);
                onSearch(e.target.value);
              }}
              className={`bg-transparent text-white text-xs md:text-sm outline-none transition-all duration-300 ${isSearchExpanded ? 'w-28 sm:w-48 md:w-64 ml-2 opacity-100' : 'w-0 opacity-0'}`}
            />
          </div>
          
          <button className="text-white hidden sm:block">
            <Bell className="w-5 h-5 md:w-6 md:h-6" />
          </button>
          
          <div className="flex items-center gap-2 cursor-pointer">
            <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center text-white">
              <User className="w-5 h-5" />
            </div>
            <span className="hidden sm:block text-white text-xs">&#9662;</span>
          </div>
        </div>
      </div>

      {/* Mobile Menu Dropdown Links */}
      {isMobileMenuOpen && (
        <div className="lg:hidden bg-[#141414] border-t border-white/10 px-6 py-4 flex flex-col gap-4 text-sm font-medium text-gray-300 transition-all duration-300">
          <a href="#" onClick={() => setIsMobileMenuOpen(false)} className="text-white hover:text-gray-300 transition">Home</a>
          <a href="#" onClick={() => setIsMobileMenuOpen(false)} className="hover:text-gray-300 transition">TV Shows</a>
          <a href="#" onClick={() => setIsMobileMenuOpen(false)} className="hover:text-gray-300 transition">Movies</a>
          <a href="#" onClick={() => setIsMobileMenuOpen(false)} className="hover:text-gray-300 transition">New & Popular</a>
          <a href="#" onClick={() => setIsMobileMenuOpen(false)} className="hover:text-gray-300 transition">My List</a>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
