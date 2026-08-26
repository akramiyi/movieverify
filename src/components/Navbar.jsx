import React, { useState, useEffect } from 'react';
import { Search, Menu, X, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const Navbar = ({ onSearch, categories, selectedCategory, onSelectCategory }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleSearch = (e) => {
    setSearchQuery(e.target.value);
    onSearch(e.target.value);
  };

  return (
    <>
      <header 
        className={`fixed top-0 w-full z-50 transition-all duration-300 ${
          isScrolled ? 'glass py-3' : 'bg-transparent py-5'
        }`}
      >
        <div className="container mx-auto px-4 md:px-6 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2 cursor-pointer">
            <Download className="text-primary w-8 h-8" />
            <h1 className="text-2xl font-bold tracking-wider text-glow">
              Movie<span className="text-primary">Verfy</span>
            </h1>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            {categories.slice(0, 5).map(category => (
              <button
                key={category}
                onClick={() => onSelectCategory(category)}
                className={`text-sm font-medium transition-colors hover:text-primary ${
                  selectedCategory === category ? 'text-primary' : 'text-gray-300'
                }`}
              >
                {category}
              </button>
            ))}
          </nav>

          {/* Search & Actions Desktop */}
          <div className="hidden md:flex items-center gap-4">
            <div className="relative group">
              <input
                type="text"
                placeholder="Search movies..."
                value={searchQuery}
                onChange={handleSearch}
                className="glass-input pl-10 pr-4 py-2 rounded-full w-64 text-sm text-gray-200 placeholder-gray-400"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary transition-colors" />
            </div>
          </div>

          {/* Mobile Menu Toggle */}
          <button 
            className="md:hidden text-gray-200 hover:text-primary transition-colors"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed inset-0 z-40 pt-24 px-4 bg-background/95 backdrop-blur-xl md:hidden"
          >
            <div className="flex flex-col gap-6">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search movies..."
                  value={searchQuery}
                  onChange={handleSearch}
                  className="glass-input w-full pl-10 pr-4 py-3 rounded-xl text-lg text-gray-200 placeholder-gray-400"
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              </div>
              
              <div className="flex flex-col gap-4">
                {categories.map(category => (
                  <button
                    key={category}
                    onClick={() => {
                      onSelectCategory(category);
                      setIsMobileMenuOpen(false);
                    }}
                    className={`text-xl font-medium text-left py-2 border-b border-white/10 ${
                      selectedCategory === category ? 'text-primary' : 'text-gray-300'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default Navbar;
