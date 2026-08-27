import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Navbar from './components/Navbar';
import FeaturedCarousel from './components/FeaturedCarousel';
import MovieRow from './components/MovieRow';
import MovieCard from './components/MovieCard';
import MovieDetailsModal from './components/MovieDetailsModal';
import Footer from './components/Footer';
import AdminPanel from './components/AdminPanel';
import { movies, getFeaturedMovies, getTrendingMovies, getMoviesByCategory } from './data/movies';
import IntroAnimation from './components/IntroAnimation';

import { useTMDB, searchTMDB } from './hooks/useTMDB';

function App() {
  const [showIntro, setShowIntro] = useState(() => {
    // return !sessionStorage.getItem('introShown');
    return true; // For testing on refresh
  });
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('home');
  const [seeAllSection, setSeeAllSection] = useState(null);
  const [showAdmin, setShowAdmin] = useState(false);

  useEffect(() => {
    setSeeAllSection(null);
  }, [activeTab, searchQuery]);
  
  const {
    trending,
    popular,
    bollywood,
    southIndian,
    webSeries,
    featured,
    downloadAvailable,
    isLoading: isTMDBLoading,
    error: tmdbError
  } = useTMDB();

  const [isTimerLoading, setIsTimerLoading] = useState(true);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [myList, setMyList] = useState(() => {
    try {
      const saved = localStorage.getItem('movieverify_mylist');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Failed to load My List from localStorage:', e);
      return [];
    }
  });

  useEffect(() => {
    // Snappy loading screen timer
    const timer = setTimeout(() => {
      setIsTimerLoading(false);
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const query = searchQuery.trim();

    if (!query) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;

    const timer = setTimeout(async () => {
      setSearchLoading(true);

      try {
        const results = await searchTMDB(query);

        if (!cancelled) {
          setSearchResults(results);
        }
      } catch (error) {
        console.error('Search failed:', error);

        if (!cancelled) {
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) {
          setSearchLoading(false);
        }
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const appLoading = isTMDBLoading || isTimerLoading;

  const displayFeatured = (tmdbError || !featured || featured.length === 0) ? getFeaturedMovies() : featured;
  const displayTrending = (tmdbError || trending.length === 0) ? getTrendingMovies() : trending;
  const displayPopular = (tmdbError || popular.length === 0) ? getTrendingMovies() : popular;
  const displayBollywood = (tmdbError || bollywood.length === 0) ? getMoviesByCategory('Bollywood') : bollywood;
  const displaySouthIndian = (tmdbError || southIndian.length === 0) ? getMoviesByCategory('South Indian') : southIndian;
  const displayWebSeries = (tmdbError || webSeries.length === 0) ? getMoviesByCategory('Web Series') : webSeries;
  const displayDownloadAvailable = (tmdbError || !downloadAvailable) ? [] : downloadAvailable;

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

  if (showIntro) {
    return <IntroAnimation onComplete={() => setShowIntro(false)} />;
  }

  return (
    <div className="min-h-screen bg-[#141414] text-white">
      <AnimatePresence>
        {appLoading && (
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

      <Navbar 
        onSearch={setSearchQuery} 
        searchQuery={searchQuery} 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
      />

      {tmdbError && (
        <div className="bg-red-950/80 border border-red-800 text-red-200 py-3 px-6 mx-4 md:mx-12 rounded mt-24 text-center text-sm md:text-base font-semibold shadow-lg">
          {tmdbError}
        </div>
      )}

      <main className="pb-20 min-h-screen">
        {!searchQuery ? (
          seeAllSection ? (
            <div className="pt-32 px-4 md:px-12">
              <div className="flex items-center gap-4 mb-8">
                <button 
                  onClick={() => setSeeAllSection(null)}
                  className="bg-white/10 hover:bg-white/20 text-white transition text-xs md:text-sm font-bold px-4 py-2 rounded-full flex items-center gap-1.5 focus:outline-none"
                >
                  <span>←</span> Back to Home
                </button>
                <h2 className="text-xl md:text-3xl font-extrabold text-white flex items-center gap-2">
                  {seeAllSection.title}
                </h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                {seeAllSection.movies.map((movie) => (
                  <MovieCard 
                    key={movie.id} 
                    movie={movie} 
                    onClick={() => setSelectedMovie(movie)} 
                    myList={myList}
                    onToggleMyList={toggleMyList}
                  />
                ))}
              </div>
            </div>
          ) : (
            <>
              {appLoading ? (
                <div className="relative w-full h-[80vh] md:h-[90vh] bg-[#181818] animate-pulse overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-transparent to-transparent" />
                </div>
              ) : (
                <FeaturedCarousel 
                  movies={displayFeatured}
                  onPlayTrailer={setSelectedMovie}
                />
              )}
              
              <div className="relative z-20 pb-10">
                {/* Render My List row if user has saved items */}
                {myList.length > 0 && (activeTab === 'home' || activeTab === 'mylist') && (
                  <MovieRow 
                    title="My List" 
                    movies={myList} 
                    onMovieClick={setSelectedMovie} 
                    isLoading={appLoading} 
                    myList={myList} 
                    onToggleMyList={toggleMyList} 
                    onSeeAll={(title, list) => setSeeAllSection({ title, movies: list })}
                  />
                )}

                {/* Download Available Section */}
                {(activeTab === 'home') && (
                  displayDownloadAvailable.length === 0 ? (
                    <div className="space-y-2 md:space-y-4 mb-8">
                      <h2 className="text-sm font-semibold text-[#e5e5e5] md:text-2xl px-4 md:px-12 flex items-center gap-2">
                        Download Available
                        <span className="inline-flex items-center gap-1 bg-green-950/50 border border-green-800 text-green-400 text-[10px] md:text-xs px-2 py-0.5 rounded-full font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                          Available
                        </span>
                      </h2>
                      <p className="text-gray-400 text-xs md:text-sm px-4 md:px-12 py-3">
                        No downloads available yet.
                      </p>
                    </div>
                  ) : (
                    <MovieRow 
                      title={
                        <span className="flex items-center gap-2">
                          Download Available
                          <span className="inline-flex items-center gap-1 bg-green-950/50 border border-green-800 text-green-400 text-[10px] md:text-xs px-2 py-0.5 rounded-full font-bold">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                            Available
                          </span>
                        </span>
                      }
                      movies={displayDownloadAvailable} 
                      onMovieClick={setSelectedMovie} 
                      isLoading={appLoading} 
                      myList={myList} 
                      onToggleMyList={toggleMyList} 
                      onSeeAll={(title, list) => setSeeAllSection({ title: "Download Available", movies: list })}
                    />
                  )
                )}

                {/* Trending Now */}
                {(activeTab === 'home' || activeTab === 'movies' || activeTab === 'popular') && (
                  <MovieRow title="Trending Now" movies={displayTrending} onMovieClick={setSelectedMovie} isLoading={appLoading} myList={myList} onToggleMyList={toggleMyList} onSeeAll={(title, list) => setSeeAllSection({ title, movies: list })} />
                )}

                {/* Bollywood Hits */}
                {(activeTab === 'home' || activeTab === 'movies') && (
                  <MovieRow title="Bollywood Hits" movies={displayBollywood} onMovieClick={setSelectedMovie} isLoading={appLoading} myList={myList} onToggleMyList={toggleMyList} onSeeAll={(title, list) => setSeeAllSection({ title, movies: list })} />
                )}

                {/* South Indian Action */}
                {(activeTab === 'home' || activeTab === 'movies') && (
                  <MovieRow title="South Indian Action" movies={displaySouthIndian} onMovieClick={setSelectedMovie} isLoading={appLoading} myList={myList} onToggleMyList={toggleMyList} onSeeAll={(title, list) => setSeeAllSection({ title, movies: list })} />
                )}

                {/* Web Series / TV Shows */}
                {(activeTab === 'home' || activeTab === 'tv') && (
                  <MovieRow title="Web Series" movies={displayWebSeries} onMovieClick={setSelectedMovie} isLoading={appLoading} myList={myList} onToggleMyList={toggleMyList} onSeeAll={(title, list) => setSeeAllSection({ title, movies: list })} />
                )}

                {/* Popular Movies */}
                {(activeTab === 'home' || activeTab === 'movies' || activeTab === 'popular') && (
                  <MovieRow title="Popular Movies" movies={displayPopular} onMovieClick={setSelectedMovie} isLoading={appLoading} myList={myList} onToggleMyList={toggleMyList} onSeeAll={(title, list) => setSeeAllSection({ title, movies: list })} />
                )}
              </div>
            </>
          )
        ) : (
          <div className="pt-32 px-4 md:px-12">
            <h2 className="text-2xl font-bold mb-6">Search Results for "{searchQuery}"</h2>
            {searchLoading ? (
              <p className="text-gray-400">Searching...</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {searchResults.map(movie => (
                  <div key={movie.id} onClick={() => setSelectedMovie(movie)} className="cursor-pointer hover:scale-105 transition flex flex-col items-center">
                    <img 
                      src={movie.poster} 
                      alt={movie.title} 
                      className="w-full aspect-[2/3] object-cover rounded-md"
                      onError={(e) => { e.target.onerror = null; e.target.src = 'https://placehold.co/300x450/141414/E50914?text=No+Poster' }}
                    />
                    <div className="mt-2 text-sm font-semibold truncate w-full text-center text-gray-200 hover:text-white">
                      {movie.title}
                    </div>
                  </div>
                ))}
                {searchResults.length === 0 && (
                  <p className="text-gray-400 col-span-full">No titles found.</p>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      <Footer onAdminClick={() => setShowAdmin(true)} />

      <MovieDetailsModal 
        movie={selectedMovie} 
        isOpen={!!selectedMovie} 
        onClose={() => setSelectedMovie(null)} 
        onSelectMovie={setSelectedMovie}
        myList={myList}
        onToggleMyList={toggleMyList}
      />

      {showAdmin && (
        <AdminPanel onClose={() => setShowAdmin(false)} />
      )}
    </div>
  );
}

export default App;
