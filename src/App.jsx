import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Navbar from './components/Navbar';
import FeaturedCarousel from './components/FeaturedCarousel';
import MovieRow from './components/MovieRow';
import MovieDetailsModal from './components/MovieDetailsModal';
import Footer from './components/Footer';
import { movies, getFeaturedMovies, getTrendingMovies, getMoviesByCategory } from './data/movies';

function App() {
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [myList, setMyList] = useState(() => {
    try {
      const saved = localStorage.getItem('movieverify_mylist');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Failed to load My List from localStorage:', e);
      return [];
    }
  });

  const featuredMovies = getFeaturedMovies();
  const trendingMovies = getTrendingMovies();
  const bollywoodMovies = getMoviesByCategory('Bollywood');
  const southIndianMovies = getMoviesByCategory('South Indian');
  const webSeries = getMoviesByCategory('Web Series');
  const actionMovies = getMoviesByCategory('Action');

  useEffect(() => {
    // Snappy loading screen
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  const toggleMyList = (movie) => {
    if (!movie) return;
    setMyList((prev) => {
      const exists = prev.some((m) => m.id === movie.id);
      let updated;
      if (exists) {
        updated = prev.filter((m) => m.id !== movie.id);
      } else {
        updated = [...prev, movie];
      }
      try {
        localStorage.setItem('movieverify_mylist', JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to save My List to localStorage:', e);
      }
      return updated;
    });
  };

  // Filter movies for search
  const allFilteredMovies = movies.filter(m => 
    m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.genre.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#141414] text-white">
      <AnimatePresence>
        {isLoading && (
          <motion.div 
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="fixed inset-0 z-[100] bg-[#141414] flex items-center justify-center"
          >
            {/* Netflix style loading spinner */}
            <div className="w-16 h-16 border-4 border-t-primary border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin"></div>
          </motion.div>
        )}
      </AnimatePresence>

      <Navbar onSearch={setSearchQuery} searchQuery={searchQuery} />

      <main className="pb-20 min-h-screen">
        {!searchQuery ? (
          <>
            {isLoading ? (
              <div className="relative w-full h-[80vh] md:h-[90vh] bg-[#181818] animate-pulse overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-transparent to-transparent" />
              </div>
            ) : (
              <FeaturedCarousel 
                movies={featuredMovies}
                onPlayTrailer={setSelectedMovie}
              />
            )}
            
            <div className="relative z-20 -mt-24 md:-mt-32 pb-10">
              {/* Render My List row if user has saved items */}
              {myList.length > 0 && (
                <MovieRow 
                  title="My List" 
                  movies={myList} 
                  onMovieClick={setSelectedMovie} 
                  isLoading={isLoading} 
                  myList={myList} 
                  onToggleMyList={toggleMyList} 
                />
              )}

              <MovieRow title="Trending Now" movies={trendingMovies} onMovieClick={setSelectedMovie} isLoading={isLoading} myList={myList} onToggleMyList={toggleMyList} />
              <MovieRow title="Bollywood Hits" movies={bollywoodMovies} onMovieClick={setSelectedMovie} isLoading={isLoading} myList={myList} onToggleMyList={toggleMyList} />
              <MovieRow title="South Indian Action" movies={southIndianMovies} onMovieClick={setSelectedMovie} isLoading={isLoading} myList={myList} onToggleMyList={toggleMyList} />
              <MovieRow title="Web Series" movies={webSeries} onMovieClick={setSelectedMovie} isLoading={isLoading} myList={myList} onToggleMyList={toggleMyList} />
              <MovieRow title="Action Movies" movies={actionMovies} onMovieClick={setSelectedMovie} isLoading={isLoading} myList={myList} onToggleMyList={toggleMyList} />
            </div>
          </>
        ) : (
          <div className="pt-32 px-4 md:px-12">
            <h2 className="text-2xl font-bold mb-6">Search Results for "{searchQuery}"</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {allFilteredMovies.map(movie => (
                <div key={movie.id} onClick={() => setSelectedMovie(movie)} className="cursor-pointer hover:scale-105 transition">
                  <img src={movie.poster} alt={movie.title} className="w-full h-auto rounded-md" />
                </div>
              ))}
              {allFilteredMovies.length === 0 && (
                <p className="text-gray-400 col-span-full">No titles found.</p>
              )}
            </div>
          </div>
        )}
      </main>

      <Footer />

      <MovieDetailsModal 
        movie={selectedMovie} 
        isOpen={!!selectedMovie} 
        onClose={() => setSelectedMovie(null)} 
        myList={myList}
        onToggleMyList={toggleMyList}
      />
    </div>
  );
}

export default App;
