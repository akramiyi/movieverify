import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import FeaturedCarousel from './components/FeaturedCarousel';
import CategoryFilter from './components/CategoryFilter';
import MovieGrid from './components/MovieGrid';
import MovieDetailsModal from './components/MovieDetailsModal';
import Footer from './components/Footer';
import Toast from './components/Toast';
import { movies, getFeaturedMovies, getMoviesByCategory, getLatestMovies, getTrendingMovies } from './data/movies';

const categories = ['All', 'Bollywood', 'Hollywood', 'South Indian', 'Web Series', 'Action', 'Sci-Fi'];

function App() {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [toastMessage, setToastMessage] = useState('');
  const [isToastVisible, setIsToastVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const featuredMovies = getFeaturedMovies();

  // Fake loading screen
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  const handleSearch = (query) => {
    setSearchQuery(query);
  };

  const showToast = (message) => {
    setToastMessage(message);
    setIsToastVisible(true);
  };

  const scrollToMovies = () => {
    const element = document.getElementById('movie-section');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Filter movies based on category and search query
  const filteredMovies = useMemo(() => {
    let result = getMoviesByCategory(selectedCategory);
    
    if (searchQuery.trim() !== '') {
      const query = searchQuery.toLowerCase();
      result = result.filter(m => 
        m.title.toLowerCase().includes(query) || 
        m.genre.toLowerCase().includes(query)
      );
    }
    
    return result;
  }, [selectedCategory, searchQuery]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center blur-md absolute"
        />
        <h1 className="text-4xl font-bold tracking-wider text-glow relative z-10">
          Movie<span className="text-primary">Verfy</span>
        </h1>
        <div className="mt-8 w-48 h-1 bg-white/10 rounded-full overflow-hidden">
          <motion.div 
            initial={{ x: '-100%' }}
            animate={{ x: '100%' }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="w-1/2 h-full bg-primary"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-gray-200 font-sans selection:bg-primary/30">
      <Navbar 
        categories={categories}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        onSearch={handleSearch}
      />

      <main className="pb-20">
        {!searchQuery && <Hero onExplore={scrollToMovies} />}

        <div id="movie-section" className="container mx-auto px-4 md:px-6 pt-24">
          
          {/* Show Featured Movie only when not searching and on 'All' category */}
          {!searchQuery && selectedCategory === 'All' && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <FeaturedCarousel 
                movies={featuredMovies}
                onPlayTrailer={setSelectedMovie}
                onDownload={setSelectedMovie}
              />
            </motion.div>
          )}

          <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
            <div>
              <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">
                {searchQuery ? `Search Results for "${searchQuery}"` : 
                 selectedCategory === 'All' ? 'Trending Movies' : `${selectedCategory} Movies`}
              </h2>
              <p className="text-gray-400 text-sm">
                Discover the best movies and web series in high quality.
              </p>
            </div>
          </div>

          <CategoryFilter 
            categories={categories}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
          />

          <MovieGrid 
            movies={filteredMovies} 
            onMovieClick={setSelectedMovie}
          />
        </div>
      </main>

      <Footer />

      <MovieDetailsModal 
        movie={selectedMovie} 
        onClose={() => setSelectedMovie(null)} 
        onShowToast={showToast}
      />

      <Toast 
        message={toastMessage} 
        isVisible={isToastVisible} 
        onClose={() => setIsToastVisible(false)} 
      />
    </div>
  );
}

export default App;
