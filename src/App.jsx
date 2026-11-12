import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, useNavigate, useLocation, useParams } from 'react-router-dom';
import { Bell, X, Download } from 'lucide-react';
import SiteLockScreen from './components/SiteLockScreen';
import { supabase } from './data/supabaseClient';

import Navbar from './components/Navbar';
import FeaturedCarousel from './components/FeaturedCarousel';
import MovieRow from './components/MovieRow';
import MovieCard from './components/MovieCard';
import MovieDetailsModal from './components/MovieDetailsModal';
import Footer from './components/Footer';
import AdminPanel from './components/AdminPanel';
import AuthModal from './components/AuthModal';
import { getFeaturedMovies, getTrendingMovies, getMoviesByCategory } from './data/movies';
import IntroAnimation from './components/IntroAnimation';
import SearchFilters from './components/SearchFilters';
import SupportSection from './components/SupportSection';

import { useTMDB, searchTMDB, fetchMovieOrTVById, getMediaTypeFromId } from './hooks/useTMDB';
import Toast from './components/Toast';
import { useLatestIndiaRelease } from './hooks/useLatestIndiaRelease';
import InstallPWA from './components/InstallPWA';
import NotificationPrompt from './components/NotificationPrompt';
import ActorsRow from './components/ActorsRow';
import ActorModal from './components/ActorModal';
import { actors } from './data/actors';
import AllActorsPage from './pages/AllActorsPage';
import GenrePage from './pages/GenrePage';
import { useRecentlyViewed } from './hooks/useRecentlyViewed';
import { useDownloadHistory } from './hooks/useDownloadHistory';
import DownloadHistoryModal from './components/DownloadHistoryModal';
import NotificationCenter from './components/NotificationCenter';
import { usePushNotifications } from './hooks/usePushNotifications';
import { resolveNotificationTargetUrl, parseNotificationMovieLink } from './utils/notificationLinks';
import { reportNotificationTelemetry } from './utils/notificationTelemetry';

const getActors = () => actors.filter(a => a.type === 'actor');
const getActresses = () => actors.filter(a => a.type === 'actress');

const ShareRedirectHandler = () => {
  const { type, id } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    const cleanType = type === 'tv' ? 'tv' : 'movie';
    const cleanId = String(id || '').split('-')[0].trim();
    navigate(`/?type=${cleanType}&id=${cleanId}`, { replace: true });
  }, [type, id, navigate]);
  return null;
};

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { recentlyViewed, addToRecentlyViewed } = useRecentlyViewed();
  const { history, addToHistory, clearHistory } = useDownloadHistory();
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isNotificationCenterOpen, setIsNotificationCenterOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [inboxRefreshTrigger, setInboxRefreshTrigger] = useState(0);
  const [foregroundPushAlert, setForegroundPushAlert] = useState(null);
  const welcomeCheckedUsersRef = useRef(new Set());
  const [showIntro, setShowIntro] = useState(() => {
    return !localStorage.getItem('introShown');
  });
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [deepLinkLoading, setDeepLinkLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);

  const inFlightNotificationCheck = useRef(null);

  const refreshUnreadNotifications = useCallback(async () => {
    if (inFlightNotificationCheck.current) return inFlightNotificationCheck.current;

    inFlightNotificationCheck.current = (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          setUnreadNotifications(0);
          return;
        }

        const res = await fetch('/api/notifications/user', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const json = await res.json();
          setUnreadNotifications(json.unread_count || 0);
        }
      } catch {
        // Preserve current unread count on transient network failure
      } finally {
        inFlightNotificationCheck.current = null;
      }
    })();

    return inFlightNotificationCheck.current;
  }, []);

  const handleForegroundMessage = useCallback(
    (payload) => {
      const notification = payload?.notification || {};
      const data = payload?.data || {};
      const title = notification.title || data.title || 'New MovieVerify Alert';
      const body = notification.body || data.body || 'Tap to view details.';
      const targetUrl = resolveNotificationTargetUrl({
        action_url: data.action_url || data.url || payload?.fcmOptions?.link,
        url: data.url,
      });

      const deliveryId = data.delivery_id || null;
      const imageUrl =
        notification.image ||
        notification.imageUrl ||
        data.image ||
        data.image_url ||
        payload?.webpush?.notification?.image ||
        null;

      setForegroundPushAlert({
        id: deliveryId || `${Date.now()}`,
        deliveryId,
        title,
        body,
        image: imageUrl,
        url: targetUrl,
      });
      if (deliveryId) {
        reportNotificationTelemetry({
          deliveryId,
          eventType: 'displayed',
          eventNonce: `fg-display-${deliveryId}`,
          metadata: { surface: 'foreground_toast' },
        });
      }
      setInboxRefreshTrigger((prev) => prev + 1);
      refreshUnreadNotifications();
    },
    [refreshUnreadNotifications]
  );

  usePushNotifications({ onForegroundMessage: handleForegroundMessage });

  useEffect(() => {
    const triggerWelcomeForSession = async (session, eventName = 'initial') => {
      const userId = session?.user?.id;
      const token = session?.access_token;
      if (!userId || !token || welcomeCheckedUsersRef.current.has(userId)) {
        return;
      }
      welcomeCheckedUsersRef.current.add(userId);
      try {
        const res = await fetch('/api/notifications/welcome', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ source: eventName === 'SIGNED_IN' ? 'signin' : 'api_signin' }),
        });
        if (res.ok) {
          const json = await res.json().catch(() => ({}));
          if (json.created) {
            setInboxRefreshTrigger((prev) => prev + 1);
            refreshUnreadNotifications();
          }
        }
      } catch {
        // Non-blocking welcome check
      }
    };

    refreshUnreadNotifications();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        triggerWelcomeForSession(session, 'initial');
      }
    }).catch(() => {});

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session?.user) {
        setUnreadNotifications(0);
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        refreshUnreadNotifications();
        triggerWelcomeForSession(session, event);
      }
    });
    return () => subscription?.unsubscribe();
  }, [refreshUnreadNotifications]);

  useEffect(() => {
    if (!foregroundPushAlert) return;
    const timer = setTimeout(() => {
      setForegroundPushAlert(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [foregroundPushAlert]);

  const handleMovieSelect = (movie) => {
    if (!movie) return;

    // Canonical deep-link URL format: /?type=movie&id=550 or /?type=tv&id=71446
    const cleanId = String(movie.id).split('-')[0];
    const resolvedMediaType = (
      movie.mediaType ||
      movie.media_type ||
      (String(movie.id).includes('-tv') ? 'tv' : null) ||
      (String(movie.id).includes('-movie') ? 'movie' : null) ||
      (movie.seasons && movie.seasons.length > 0 ? 'tv' : null) ||
      (movie.first_air_date ? 'tv' : null) ||
      (movie.genre && (movie.genre.toLowerCase().includes('web series') || movie.genre.toLowerCase().includes('tv series')) ? 'tv' : null) ||
      getMediaTypeFromId(cleanId) ||
      (movie.release_date ? 'movie' : null) ||
      null
    );

    const enrichedMovie = resolvedMediaType
      ? { ...movie, mediaType: resolvedMediaType, media_type: resolvedMediaType }
      : movie;

    setSelectedMovie(enrichedMovie);
    addToRecentlyViewed(enrichedMovie);

    // If poster/backdrop is missing, fetch full TMDB data to enrich the modal
    if (!movie.backdrop && !movie.poster) {
      fetchMovieOrTVById(cleanId, resolvedMediaType).then((details) => {
        if (details) {
          setSelectedMovie((prev) => (prev && String(prev.id).split('-')[0] === cleanId ? { ...prev, ...details } : prev));
        }
      }).catch(() => {});
    }

    const searchParams = new URLSearchParams(location.search);
    const currentId = searchParams.get('id') || searchParams.get('movie') || searchParams.get('tv');

    if (currentId !== cleanId) {
      if (resolvedMediaType) {
        searchParams.set('type', resolvedMediaType);
      }
      searchParams.set('id', cleanId);
      searchParams.delete('movie');
      searchParams.delete('tv');
      navigate({
        pathname: location.pathname,
        search: `?${searchParams.toString()}`
      }, { replace: false });
    }
  };

  const handleCloseMovieModal = () => {
    setSelectedMovie(null);
    const searchParams = new URLSearchParams(location.search);
    if (searchParams.has('id') || searchParams.has('movie') || searchParams.has('tv') || searchParams.has('type')) {
      searchParams.delete('id');
      searchParams.delete('type');
      searchParams.delete('movie');
      searchParams.delete('tv');
      const newSearch = searchParams.toString();
      navigate({
        pathname: location.pathname,
        search: newSearch ? `?${newSearch}` : ''
      }, { replace: true });
    }
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('home');
  const [seeAllSection, setSeeAllSection] = useState(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [selectedActor, setSelectedActor] = useState(null);
  const [isActorModalOpen, setIsActorModalOpen] = useState(false);
  const [siteLocked, setSiteLocked] = useState(false);
  const [checkingLock, setCheckingLock] = useState(true);

  const handleActorSelect = (actor) => {
    setSelectedActor(actor);
    setIsActorModalOpen(true);
  };

  const [authPopupDismissed, setAuthPopupDismissed] = useState(false);

  const handleOpenAdmin = () => {
    setShowAuthModal(false);
    setShowAdmin(true);
    try {
      sessionStorage.setItem('movieverify_auth_popup_dismissed', 'true');
    } catch {}
  };

  const handleOpenAuthModal = () => {
    setShowAdmin(false);
    setShowAuthModal(true);
  };

  const handleCloseAuthModal = () => {
    setShowAuthModal(false);
    setAuthPopupDismissed(true);
    try {
      sessionStorage.setItem('movieverify_auth_popup_dismissed', 'true');
    } catch {}
  };

  const handleCloseAdmin = () => {
    setShowAdmin(false);
    if (location.pathname === '/admin') {
      navigate('/');
    }
  };

  // Immediate Google Sign-In / Signup welcome popup for unauthenticated visitors on website open
  useEffect(() => {
    if (showIntro || siteLocked || showAdmin || location.pathname === '/admin') return;

    // Do not show if dismissed during this active browsing session
    if (authPopupDismissed) return;

    // If visitor opened a shared deep link, prioritize title viewing without immediate popup
    const initialParams = new URLSearchParams(location.search);
    if (initialParams.has('id') || initialParams.has('movie') || initialParams.has('tv')) return;

    let isMounted = true;

    const initAuth = async () => {
      try {
        // Asynchronously check Supabase session
        const { data: { session } } = await supabase.auth.getSession();

        // Authenticated users must never see the automatic login popup
        if (!isMounted || session?.user || showAdmin || location.pathname === '/admin') {
          return;
        }

        // Open signup modal immediately on website open from any link
        setShowAuthModal(true);
      } catch (err) {
        console.warn('Auth check error for immediate signup popup:', err?.message);
        if (isMounted && !showAdmin && location.pathname !== '/admin') {
          setShowAuthModal(true);
        }
      }
    };

    initAuth();

    // Listen for auth state changes: automatically dismiss modal on OAuth sign-in
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        // Dismiss welcome auth popup automatically only for OAuth sign-ins (e.g. Google),
        // leaving AuthModal's admin password check to manage its own lifecycle.
        if (event === 'SIGNED_IN' && session.user.app_metadata?.provider !== 'email') {
          setShowAuthModal(false);
        }
      }
    });

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, [showIntro, siteLocked, showAdmin, location.pathname, authPopupDismissed]);

  useEffect(() => {
    const checkLock = async () => {
      try {
        const { data, error } = await supabase
          .from('site_settings')
          .select('is_locked')
          .eq('id', 1)
          .single();

        if (error) {
          setCheckingLock(false);
          return;
        }

        const alreadyUnlocked = sessionStorage.getItem('movieverify_unlocked');

        if (data?.is_locked && !alreadyUnlocked) {
          setSiteLocked(true);
        }
      } catch {
        // Silently continue if database is paused/unreachable
      } finally {
        setCheckingLock(false);
      }
    };
    checkLock();
  }, []);

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

  // Handle URL deep-linking on initial load, refresh, and browser back/forward navigation
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const rawId = searchParams.get('id') || searchParams.get('movie') || searchParams.get('tv');

    // If no deep link in URL and a movie is currently open, close it (e.g. browser back button)
    if (!rawId) {
      if (selectedMovie) {
        setSelectedMovie(null);
      }
      return;
    }

    const cleanId = String(rawId).split('-')[0].trim();
    const parsedId = parseInt(cleanId, 10);

    // Handle invalid TMDB ID
    if (isNaN(parsedId) || parsedId <= 0) {
      setToastMessage('Invalid title link.');
      setShowToast(true);
      const cleanParams = new URLSearchParams(location.search);
      cleanParams.delete('id');
      cleanParams.delete('movie');
      cleanParams.delete('tv');
      cleanParams.delete('type');
      const newSearch = cleanParams.toString();
      navigate({
        pathname: location.pathname,
        search: newSearch ? `?${newSearch}` : ''
      }, { replace: true });
      return;
    }

    // If already displaying this movie with media, avoid redundant fetches
    if (selectedMovie && String(selectedMovie.id).split('-')[0] === String(parsedId)) {
      if (selectedMovie.backdrop || selectedMovie.poster) {
        return;
      }
    }

    let requestedType = searchParams.get('type');
    if (requestedType) {
      requestedType = requestedType.toLowerCase().trim();
      if (requestedType !== 'tv' && requestedType !== 'movie') {
        requestedType = null;
      }
    } else if (searchParams.has('tv')) {
      requestedType = 'tv';
    }

    let isCancelled = false;

    const loadDeepLink = async () => {
      setDeepLinkLoading(true);

      // Check in-memory pool first for instant loading
      const inMemoryPool = [
        ...(featured || []),
        ...(trending || []),
        ...(popular || []),
        ...(bollywood || []),
        ...(southIndian || []),
        ...(webSeries || []),
        ...(downloadAvailable || []),
        ...(myList || []),
        ...(recentlyViewed || [])
      ];

      const foundInMemory = inMemoryPool.find((m) => {
        const mId = String(m.id).split('-')[0];
        if (mId !== String(parsedId)) return false;
        const itemType = m.mediaType || m.media_type || (m.first_air_date ? 'tv' : (m.release_date ? 'movie' : getMediaTypeFromId(mId)));
        if (requestedType && itemType && itemType !== requestedType) return false;
        return true;
      });

      if (foundInMemory && !isCancelled) {
        if (foundInMemory.backdrop || foundInMemory.poster) {
          const itemType = foundInMemory.mediaType || foundInMemory.media_type || requestedType || getMediaTypeFromId(parsedId);
          const enriched = itemType
            ? { ...foundInMemory, mediaType: itemType, media_type: itemType }
            : foundInMemory;
          setSelectedMovie(enriched);
          addToRecentlyViewed(enriched);
          setDeepLinkLoading(false);
          return;
        }
      }

      try {
        const titleData = await fetchMovieOrTVById(parsedId, requestedType);
        if (isCancelled) return;

        if (titleData) {
          const itemType = titleData.mediaType || titleData.media_type || requestedType || getMediaTypeFromId(parsedId);
          const enriched = itemType
            ? { ...titleData, mediaType: itemType, media_type: itemType }
            : titleData;
          setSelectedMovie(enriched);
          addToRecentlyViewed(enriched);
        } else {
          setToastMessage('Title not found or unavailable.');
          setShowToast(true);
          const cleanParams = new URLSearchParams(location.search);
          cleanParams.delete('id');
          cleanParams.delete('movie');
          cleanParams.delete('tv');
          cleanParams.delete('type');
          const newSearch = cleanParams.toString();
          navigate({
            pathname: location.pathname,
            search: newSearch ? `?${newSearch}` : ''
          }, { replace: true });
        }
      } catch (err) {
        console.error('Deep link fetch error:', err);
        if (!isCancelled) {
          setToastMessage('Error loading title details.');
          setShowToast(true);
        }
      } finally {
        if (!isCancelled) {
          setDeepLinkLoading(false);
        }
      }
    };

    loadDeepLink();

    return () => {
      isCancelled = true;
    };
  }, [location.search]);

  const { currentMovie: latestIndiaMovie, pool: latestIndiaPool } = useLatestIndiaRelease();

  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchFilters, setSearchFilters] = useState({
    genre: 'All',
    language: 'All',
    minRating: 0,
    sortBy: 'relevance',
  });

  const handleFilterChange = (key, value) => {
    setSearchFilters((prev) => ({ ...prev, [key]: value }));
  };

  const resetFilters = () => {
    setSearchFilters({
      genre: 'All',
      language: 'All',
      minRating: 0,
      sortBy: 'relevance',
    });
  };

  const displayedSearchResults = React.useMemo(() => {
    let result = [...searchResults];

    if (searchFilters.genre !== 'All') {
      result = result.filter((m) =>
        !m.genre || m.genre.toLowerCase().includes(searchFilters.genre.toLowerCase())
      );
    }

    if (searchFilters.language !== 'All') {
      result = result.filter((m) =>
        m.language?.toLowerCase().includes(searchFilters.language.toLowerCase())
      );
    }

    if (searchFilters.minRating > 0) {
      result = result.filter((m) =>
        parseFloat(m.rating) >= searchFilters.minRating
      );
    }

    if (searchFilters.sortBy === 'rating_desc') {
      result.sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating));
    } else if (searchFilters.sortBy === 'rating_asc') {
      result.sort((a, b) => parseFloat(a.rating) - parseFloat(b.rating));
    } else if (searchFilters.sortBy === 'year_desc') {
      result.sort((a, b) => (b.year || 0) - (a.year || 0));
    } else if (searchFilters.sortBy === 'year_asc') {
      result.sort((a, b) => (a.year || 0) - (b.year || 0));
    }

    return result;
  }, [searchResults, searchFilters]);
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

  const appLoading = isTMDBLoading;

  const displayFeatured = (tmdbError || !featured || featured.length === 0) ? getFeaturedMovies() : featured;
  const displayTrending = (tmdbError || trending.length === 0) ? getTrendingMovies() : trending;
  const displayPopular = (tmdbError || popular.length === 0) ? getTrendingMovies() : popular;
  const displayBollywood = (tmdbError || bollywood.length === 0) ? getMoviesByCategory('Bollywood') : bollywood;
  const displaySouthIndian = (tmdbError || southIndian.length === 0) ? getMoviesByCategory('South Indian') : southIndian;
  const displayWebSeries = (tmdbError || webSeries.length === 0) ? getMoviesByCategory('Web Series') : webSeries;
  const displayDownloadAvailable = (tmdbError || !downloadAvailable) ? [] : downloadAvailable;

  useEffect(() => {
    if (displayFeatured && displayFeatured.length > 0 && displayFeatured[0].backdrop) {
      const href = displayFeatured[0].backdrop;
      if (!document.querySelector(`link[href="${href}"]`)) {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'image';
        link.href = href;
        document.head.appendChild(link);
      }
    }
  }, [displayFeatured]);

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

  if (siteLocked) {
    return <SiteLockScreen onUnlock={() => setSiteLocked(false)} />;
  }

  return (
    <div className="min-h-screen bg-[#141414] text-white">
      <Routes>
        <Route path="/" element={
          <>
            <Navbar
              onSearch={setSearchQuery}
              searchQuery={searchQuery}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              onProfileClick={handleOpenAuthModal}
              onAdminClick={handleOpenAdmin}
              onHistoryClick={() => setIsHistoryModalOpen(true)}
              onNotificationClick={() => setIsNotificationCenterOpen(true)}
              unreadNotificationCount={unreadNotifications}
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
                    onClick={() => handleMovieSelect(movie)}
                    myList={myList}
                    onToggleMyList={toggleMyList}
                  />
                ))}
              </div>
            </div>
          ) : (
            <>
              <FeaturedCarousel
                movies={displayFeatured}
                onPlayTrailer={handleMovieSelect}
              />

              <div className="relative z-20 pb-10">
                {/* Render My List row if user has saved items */}
                {myList.length > 0 && (activeTab === 'home' || activeTab === 'mylist') && (
                  <MovieRow
                    title="My List"
                    movies={myList}
                    onMovieClick={handleMovieSelect}
                    isLoading={appLoading}
                    myList={myList}
                    onToggleMyList={toggleMyList}
                    onSeeAll={(title, list) => setSeeAllSection({ title, movies: list })}
                  />
                )}

                {/* Continue Browsing */}
                {recentlyViewed.length > 0 && (
                  <MovieRow
                    title="Continue Browsing"
                    movies={recentlyViewed}
                    onMovieClick={handleMovieSelect}
                    isLoading={false}
                    myList={myList}
                    onToggleMyList={toggleMyList}
                  />
                )}

                {/* Browse by Genre */}
                <div className="px-4 md:px-12 mb-8 mt-4">
                  <h2 className="text-sm font-semibold text-[#e5e5e5]
                                 md:text-2xl mb-4">
                    Browse by Genre
                  </h2>
                  <div className="flex flex-wrap gap-3">
                    {Object.entries({
                      action: 'Action', comedy: 'Comedy', drama: 'Drama',
                      horror: 'Horror', romance: 'Romance', scifi: 'Sci-Fi',
                      thriller: 'Thriller', animation: 'Animation',
                      crime: 'Crime', fantasy: 'Fantasy',
                    }).map(([slug, label]) => (
                      <button
                        key={slug}
                        onClick={() => navigate(`/genre/${slug}`)}
                        className="px-4 py-2 bg-[#242424] hover:bg-[#E50914]
                                   text-white text-sm font-medium rounded-full
                                   transition"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Download Available Section */}
                {(activeTab === 'home') && (
                  (displayDownloadAvailable.length === 0 && !appLoading) ? (
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
                      onMovieClick={handleMovieSelect}
                      isLoading={appLoading && displayDownloadAvailable.length === 0}
                      myList={myList}
                      onToggleMyList={toggleMyList}
                      onSeeAll={(title, movies) => setSeeAllSection({ title, movies })}
                    />
                  )
                )}

                {/* Trending Now */}
                {(activeTab === 'home' || activeTab === 'movies' || activeTab === 'popular') && (
                  <MovieRow title="Trending Now" movies={displayTrending} onMovieClick={handleMovieSelect} isLoading={appLoading} myList={myList} onToggleMyList={toggleMyList} onSeeAll={(title, list) => setSeeAllSection({ title, movies: list })} />
                )}

                {latestIndiaPool.length > 0 && (
                  <MovieRow
                    title="India's Latest Releases (This Week's Pick First)"
                    movies={latestIndiaMovie ? [latestIndiaMovie, ...latestIndiaPool.filter(m => m.id !== latestIndiaMovie.id)] : latestIndiaPool}
                    onMovieClick={handleMovieSelect}
                    isLoading={false}
                    myList={myList}
                    onToggleMyList={toggleMyList}
                    onSeeAll={(title, list) => setSeeAllSection({ title, movies: list })}
                  />
                )}

                {/* Popular Actors */}
                <ActorsRow
                  title="Popular Actors"
                  actors={getActors()}
                  onActorSelect={handleActorSelect}
                  onSeeAll={() => navigate('/actors')}
                />

                {/* Popular Actresses */}
                <ActorsRow
                  title="Popular Actresses"
                  actors={getActresses()}
                  onActorSelect={handleActorSelect}
                  onSeeAll={() => navigate('/actresses')}
                />

                {/* Bollywood Hits */}
                {(activeTab === 'home' || activeTab === 'movies') && (
                  <MovieRow title="Bollywood Hits" movies={displayBollywood} onMovieClick={handleMovieSelect} isLoading={appLoading} myList={myList} onToggleMyList={toggleMyList} onSeeAll={(title, list) => setSeeAllSection({ title, movies: list })} />
                )}

                {/* South Indian Action */}
                {(activeTab === 'home' || activeTab === 'movies') && (
                  <MovieRow title="South Indian Action" movies={displaySouthIndian} onMovieClick={handleMovieSelect} isLoading={appLoading} myList={myList} onToggleMyList={toggleMyList} onSeeAll={(title, list) => setSeeAllSection({ title, movies: list })} />
                )}

                {/* Web Series / TV Shows */}
                {(activeTab === 'home' || activeTab === 'tv') && (
                  <MovieRow title="Web Series" movies={displayWebSeries} onMovieClick={handleMovieSelect} isLoading={appLoading} myList={myList} onToggleMyList={toggleMyList} onSeeAll={(title, list) => setSeeAllSection({ title, movies: list })} />
                )}

                {/* Popular Movies */}
                {(activeTab === 'home' || activeTab === 'movies' || activeTab === 'popular') && (
                  <MovieRow title="Popular Movies" movies={displayPopular} onMovieClick={handleMovieSelect} isLoading={appLoading} myList={myList} onToggleMyList={toggleMyList} onSeeAll={(title, list) => setSeeAllSection({ title, movies: list })} />
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
              <>
                <SearchFilters
                  filters={searchFilters}
                  onFilterChange={handleFilterChange}
                  onReset={resetFilters}
                  resultCount={displayedSearchResults.length}
                />
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {displayedSearchResults.map(movie => (
                    <div key={movie.id} onClick={() => handleMovieSelect(movie)} className="cursor-pointer hover:scale-105 transition flex flex-col items-center">
                      <img
                        src={movie.poster}
                        alt={movie.title}
                        className="w-full aspect-[2/3] object-cover rounded-md"
                        loading="lazy"
                        onError={(e) => { e.target.onerror = null; e.target.src = 'https://placehold.co/300x450/141414/E50914?text=No+Poster' }}
                      />
                      <div className="mt-2 text-sm font-semibold truncate w-full text-center text-gray-200 hover:text-white">
                        {movie.title}
                      </div>
                    </div>
                  ))}
                  {displayedSearchResults.length === 0 && (
                    <p className="text-gray-400 col-span-full">No titles found.</p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </main>

      <SupportSection />
      <Footer onAdminClick={handleOpenAdmin} />

      <MovieDetailsModal
        movie={selectedMovie}
        isOpen={!!selectedMovie || deepLinkLoading}
        isLoading={deepLinkLoading}
        onClose={handleCloseMovieModal}
        onSelectMovie={handleMovieSelect}
        myList={myList}
        onToggleMyList={toggleMyList}
        onDownloadTracked={addToHistory}
        onRequireAuth={handleOpenAuthModal}
      />

      <DownloadHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        history={history}
        onClear={clearHistory}
      />

      <NotificationCenter
        isOpen={isNotificationCenterOpen}
        onClose={() => setIsNotificationCenterOpen(false)}
        onSelectMovie={handleMovieSelect}
        onSelectActor={(actor) => {
          setSelectedActor(actor);
          setIsActorModalOpen(true);
        }}
        onUnreadCountChange={setUnreadNotifications}
        refreshTrigger={inboxRefreshTrigger}
      />

      <ActorModal
        actor={selectedActor}
        isOpen={isActorModalOpen}
        onClose={() => setIsActorModalOpen(false)}
        onMovieClick={(movie) => {
          setIsActorModalOpen(false);
          handleMovieSelect(movie);
        }}
      />

          </>
        } />
        <Route path="/admin" element={<AdminPanel onClose={handleCloseAdmin} />} />
        <Route path="/actors" element={<AllActorsPage onMovieSelect={handleMovieSelect} type="actors" />} />
        <Route path="/actresses" element={<AllActorsPage onMovieSelect={handleMovieSelect} type="actresses" />} />
        <Route
          path="/genre/:genreSlug"
          element={
            <GenrePage
              onMovieClick={handleMovieSelect}
              myList={myList}
              onToggleMyList={toggleMyList}
            />
          }
        />
      </Routes>

      <AuthModal
        isOpen={showAuthModal && !showAdmin && location.pathname !== '/admin'}
        onClose={handleCloseAuthModal}
        onOpenAdmin={handleOpenAdmin}
      />

      {showAdmin && (
        <AdminPanel onClose={handleCloseAdmin} />
      )}
      <InstallPWA />
      {!showIntro && !siteLocked && !showAdmin && location.pathname !== '/admin' && (
        <NotificationPrompt
          onSubscribeSuccess={() => {
            setToastMessage('Notifications enabled! You will receive new release alerts.');
            setShowToast(true);
          }}
        />
      )}
      {foregroundPushAlert && (
        <div
          role="status"
          data-testid="foreground-push-toast"
          className="fixed top-20 right-4 md:right-8 z-[220] max-w-sm w-[calc(100vw-2rem)] bg-[#0d0d12]/95 backdrop-blur-xl border border-[#E50914]/60 rounded-2xl p-4 shadow-[0_0_30px_rgba(229,9,20,0.35)] flex flex-col transition-all duration-300 animate-in fade-in slide-in-from-top-4"
        >
          {/* Header */}
          <div className="flex items-center justify-between w-full pb-2 border-b border-white/5">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-md bg-gradient-to-br from-[#FF3445] to-[#E50914] flex items-center justify-center text-white font-black text-[10px] shadow-[0_0_8px_rgba(229,9,20,0.7)] shrink-0">
                M
              </div>
              <span className="text-white text-xs font-bold tracking-tight">MovieVerify</span>
              <span className="text-gray-400 text-[11px]">• now</span>
            </div>
            <button
              type="button"
              onClick={() => {
                const deliveryId = foregroundPushAlert.deliveryId;
                setForegroundPushAlert(null);
                if (deliveryId) {
                  reportNotificationTelemetry({
                    deliveryId,
                    eventType: 'dismissed',
                    eventNonce: `fg-dismiss-${deliveryId}-${Date.now()}`,
                    metadata: { surface: 'foreground_toast' },
                  });
                }
              }}
              aria-label="Dismiss foreground notification"
              className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Title & Body */}
          <div className="mt-2.5">
            <p className="text-white text-sm font-extrabold leading-snug">{foregroundPushAlert.title}</p>
            {foregroundPushAlert.body && (
              <p className="text-gray-300 text-xs mt-1 leading-relaxed line-clamp-2">{foregroundPushAlert.body}</p>
            )}
          </div>

          {/* Cinematic Movie Banner */}
          {foregroundPushAlert.image && (
            <div className="mt-2.5 overflow-hidden rounded-xl border border-white/10 shadow-lg relative aspect-video bg-black/50">
              <img
                src={foregroundPushAlert.image}
                alt={foregroundPushAlert.title}
                className="w-full h-full object-cover"
                loading="eager"
              />
            </div>
          )}

          {/* Action Button: Download Now */}
          <button
            type="button"
            onClick={() => {
              const targetUrl = foregroundPushAlert.url;
              const title = foregroundPushAlert.title;
              const deliveryId = foregroundPushAlert.deliveryId;
              setForegroundPushAlert(null);
              if (deliveryId) {
                reportNotificationTelemetry({
                  deliveryId,
                  eventType: 'clicked',
                  eventNonce: `fg-click-${deliveryId}-${Date.now()}`,
                  metadata: { surface: 'foreground_toast', target_url: targetUrl },
                });
              }
              if (targetUrl) {
                const movieTarget = parseNotificationMovieLink(targetUrl, title);
                if (movieTarget) {
                  handleMovieSelect(movieTarget);
                  return;
                }
              }
              setIsNotificationCenterOpen(true);
            }}
            className="w-full mt-3 py-2.5 px-4 bg-gradient-to-r from-[#b80710] to-[#E50914] hover:from-[#c90812] hover:to-[#ff1f2d] shadow-[0_0_15px_rgba(229,9,20,0.5)] border border-[#E50914]/40 rounded-xl text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-white" />
            Download Now
          </button>
        </div>
      )}
      <Toast message={toastMessage} isVisible={showToast} onClose={() => setShowToast(false)} />
    </div>
  );
}

export default App;
