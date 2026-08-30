import React, { useState, useEffect } from 'react';
import { Search, Bell, User, Menu, X, Clock } from 'lucide-react';

const LiveTime = () => {
  const [time, setTime] = useState(new Date());
  
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 50);
    return () => clearInterval(timer);
  }, []);

  // Format: HH:MM:SS:MS AM/PM
  const timeString = time.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const ms = time.getMilliseconds().toString().padStart(3, '0');
  const [timePart, ampm] = timeString.split(' ');
  const formattedTime = `${timePart}:${ms} ${ampm}`;

  return (
    <div className="hidden sm:flex items-center gap-1.5 text-gray-300 font-mono text-sm tracking-wider mr-2 w-40">
      <Clock className="w-4 h-4 text-[#E50914]" />
      {formattedTime}
    </div>
  );
};

const Navbar = ({ onSearch, searchQuery, activeTab = 'home', setActiveTab, onAdminClick }) => {
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

          <div 
            onClick={() => { setActiveTab('home'); onSearch(''); }}
            className="flex items-center gap-1.5 cursor-pointer select-none font-black text-lg md:text-2xl"
          >
            <div className="flex items-center justify-center w-7 h-7 md:w-8 md:h-8 bg-gradient-to-br from-[#FF3445] to-[#E50914] rounded-md shadow-[0_0_10px_rgba(229,9,20,0.5)] text-white text-sm md:text-base font-black">
              M
            </div>
            <span className="text-white tracking-tighter font-sans uppercase">
              Ovie<span className="text-[#E50914]">verify</span>
            </span>
          </div>
          
          <div className="hidden lg:flex items-center gap-5 text-sm font-medium text-gray-300">
            <button 
              onClick={() => { setActiveTab('home'); onSearch(''); }}
              className={`transition ${activeTab === 'home' ? 'text-white font-extrabold' : 'text-gray-400 hover:text-white'}`}
            >
              Home
            </button>
            <button 
              onClick={() => { setActiveTab('tv'); onSearch(''); }}
              className={`transition ${activeTab === 'tv' ? 'text-white font-extrabold' : 'text-gray-400 hover:text-white'}`}
            >
              TV Shows
            </button>
            <button 
              onClick={() => { setActiveTab('movies'); onSearch(''); }}
              className={`transition ${activeTab === 'movies' ? 'text-white font-extrabold' : 'text-gray-400 hover:text-white'}`}
            >
              Movies
            </button>
            <button 
              onClick={() => { setActiveTab('popular'); onSearch(''); }}
              className={`transition ${activeTab === 'popular' ? 'text-white font-extrabold' : 'text-gray-400 hover:text-white'}`}
            >
              New & Popular
            </button>
            <button 
              onClick={() => { setActiveTab('mylist'); onSearch(''); }}
              className={`transition ${activeTab === 'mylist' ? 'text-white font-extrabold' : 'text-gray-400 hover:text-white'}`}
            >
              My List
            </button>
          </div>
        </div>

        {/* Right Side - Search & Profile */}
        <div className="flex items-center gap-4 md:gap-6">
          <div className={`flex items-center transition-all duration-300 ${isSearchExpanded ? 'bg-black border border-white px-3 py-1.5' : 'bg-transparent'}`}>
            <button 
              onClick={() => setIsSearchExpanded(!isSearchExpanded)}
              className="text-white focus:outline-none flex items-center justify-center"
            >
              <Search className="w-5 h-5 md:w-6 md:h-6 stroke-[2.5]" />
            </button>
            <input 
              type="text"
              placeholder="Titles, genres"
              value={searchQuery}
              onChange={(e) => {
                if(!isSearchExpanded) setIsSearchExpanded(true);
                onSearch(e.target.value);
              }}
              className={`bg-transparent text-white text-sm outline-none transition-all duration-300 placeholder-gray-400 ${
                isSearchExpanded ? 'w-36 md:w-52 ml-3 opacity-100' : 'w-0 opacity-0'
              }`}
            />
          </div>
          
          <LiveTime />

          <button className="text-white hidden sm:block">
            <Bell className="w-5 h-5 md:w-6 md:h-6" />
          </button>
          
          <button 
            type="button"
            onClick={(e) => {
              e.preventDefault();
              console.log('MOVIEVERIFY ADMIN ICON CLICKED');
              if (onAdminClick) onAdminClick();
            }} 
            className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity focus:outline-none"
          >
            <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center text-white pointer-events-none">
              <User className="w-5 h-5" />
            </div>
            <span className="hidden sm:block text-white text-xs pointer-events-none">&#9662;</span>
          </button>
        </div>
      </div>

      {/* Mobile Menu Dropdown Links */}
      {isMobileMenuOpen && (
        <div className="lg:hidden bg-[#141414] border-t border-white/10 px-6 py-4 flex flex-col gap-4 text-sm font-medium text-gray-300 transition-all duration-300">
          <button 
            onClick={() => { setActiveTab('home'); onSearch(''); setIsMobileMenuOpen(false); }}
            className={`text-left transition ${activeTab === 'home' ? 'text-white font-extrabold' : 'text-gray-400 hover:text-white'}`}
          >
            Home
          </button>
          <button 
            onClick={() => { setActiveTab('tv'); onSearch(''); setIsMobileMenuOpen(false); }}
            className={`text-left transition ${activeTab === 'tv' ? 'text-white font-extrabold' : 'text-gray-400 hover:text-white'}`}
          >
            TV Shows
          </button>
          <button 
            onClick={() => { setActiveTab('movies'); onSearch(''); setIsMobileMenuOpen(false); }}
            className={`text-left transition ${activeTab === 'movies' ? 'text-white font-extrabold' : 'text-gray-400 hover:text-white'}`}
          >
            Movies
          </button>
          <button 
            onClick={() => { setActiveTab('popular'); onSearch(''); setIsMobileMenuOpen(false); }}
            className={`text-left transition ${activeTab === 'popular' ? 'text-white font-extrabold' : 'text-gray-400 hover:text-white'}`}
          >
            New & Popular
          </button>
          <button 
            onClick={() => { setActiveTab('mylist'); onSearch(''); setIsMobileMenuOpen(false); }}
            className={`text-left transition ${activeTab === 'mylist' ? 'text-white font-extrabold' : 'text-gray-400 hover:text-white'}`}
          >
            My List
          </button>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
