import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Routes, Route, useNavigate, useLocation, useParams } from 'react-router-dom';
import { Bell, X, Download, Sparkles, Check, Bookmark } from 'lucide-react';
import SiteLockScreen from './components/SiteLockScreen';
import { supabase, getCachedAuthUser } from './data/supabaseClient';

import Navbar from './components/Navbar';
import FeaturedCarousel from './components/FeaturedCarousel';
import MovieRow from './components/MovieRow';
import MovieCard from './components/MovieCard';
import MovieDetailsModal from './components/MovieDetailsModal';
import Footer from './components/Footer';
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
import NewUserGuide from './components/NewUserGuide';
import TodayReleasesView from './components/TodayReleasesView';
import ActorsRow from './components/ActorsRow';
import { actors } from './data/actors';
import { useRecentlyViewed } from './hooks/useRecentlyViewed';
import { useDownloadHistory } from './hooks/useDownloadHistory';
import { usePushNotifications } from './hooks/usePushNotifications';
import { resolveNotificationTargetUrl, parseNotificationMovieLink } from './utils/notificationLinks';
import { reportNotificationTelemetry } from './utils/notificationTelemetry';

// Lazy-loaded routes and heavy modal components for optimal initial bundle performance
const AdminPanel = lazy(() => import('./components/AdminPanel'));
const ActorModal = lazy(() => import('./components/ActorModal'));
const AllActorsPage = lazy(() => import('./pages/AllActorsPage'));
const GenrePage = lazy(() => import('./pages/GenrePage'));
const DownloadHistoryModal = lazy(() => import('./components/DownloadHistoryModal'));
const NotificationCenter = lazy(() => import('./components/NotificationCenter'));

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
  const handleLogOutResetRef = useRef(null);
  const [showIntro, setShowIntro] = useState(() => {
    return !localStorage.getItem('introShown');
  });
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [deepLinkLoading, setDeepLinkLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [hasNotificationPrompt, setHasNotificationPrompt] = useState(false);
  const [showNewUserGuide, setShowNewUserGuide] = useState(() => {
    try {
      return localStorage.getItem('movieverify_new_user_guide_completed') !== 'true';
    } catch {
      return false;
    }
  });

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

      const welcomeStorageKey = `movieverify_welcome_shown_${userId}`;
      const hasSeenWelcome = (() => {
        try {
          return localStorage.getItem(welcomeStorageKey) === 'true';
        } catch {
          return false;
        }
      })();

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
          const isFirstWelcome = Boolean(json.created || json.is_first_welcome);

          if (json.created) {
            setInboxRefreshTrigger((prev) => prev + 1);
            refreshUnreadNotifications();
          }

          // Trigger the beautiful welcome celebration if first-time welcome and not yet shown
          if ((isFirstWelcome || !hasSeenWelcome) && eventName === 'SIGNED_IN') {
            try {
              localStorage.setItem(welcomeStorageKey, 'true');
            } catch {}

            const rawName =
              session?.user?.user_metadata?.full_name ||
              session?.user?.user_metadata?.name ||
              session?.user?.email?.split('@')[0] ||
              'Viewer';
            const firstName = rawName.split(' ')[0];
            const userAvatar =
              session?.user?.user_metadata?.avatar_url ||
              session?.user?.user_metadata?.picture ||
              null;

            setForegroundPushAlert({
              id: json.delivery_id || `welcome-${userId}-${Date.now()}`,
              deliveryId: json.delivery_id || null,
              title: `Welcome, ${firstName}! 🎉`,
              body: 'Your account is verified! Enjoy instant HD downloads, fast 1080p links, and new movie release alerts.',
              avatar: userAvatar,
              isWelcome: true,
              actionLabel: 'Explore Movies 🍿',
              url: '/?section=notifications',
            });
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
      if (event === 'SIGNED_OUT') {
        if (handleLogOutResetRef.current) {
          handleLogOutResetRef.current();
        } else {
          setUnreadNotifications(0);
        }
      } else if (!session?.user) {
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
    const duration = foregroundPushAlert.isWelcome ? 8000 : 6000;
    const timer = setTimeout(() => {
      setForegroundPushAlert(null);
    }, duration);
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

  const [authPopupDismissed, setAuthPopupDismissed] = useState(() => {
    try {
      if (typeof window === 'undefined') return false;
      const cached = getCachedAuthUser();
      if (cached) return true;
      return (
        sessionStorage.getItem('movieverify_auth_popup_dismissed') === 'true' ||
        localStorage.getItem('movieverify_auth_popup_dismissed') === 'true'
      );
    } catch {
      return false;
    }
  });

  const handleOpenAdmin = () => {
    setShowAuthModal(false);
    setShowAdmin(true);
    try {
      sessionStorage.setItem('movieverify_auth_popup_dismissed', 'true');
      localStorage.setItem('movieverify_auth_popup_dismissed', 'true');
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
      localStorage.setItem('movieverify_auth_popup_dismissed', 'true');
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

    // Do not show if dismissed during this active browsing session or already authenticated
    if (authPopupDismissed) return;

    // Fast synchronous check: If user is cached in local storage, do not popup
    if (getCachedAuthUser()) {
      setAuthPopupDismissed(true);
      return;
    }

    // If visitor opened a shared deep link, OAuth callback, or hash token, prioritize title viewing without popup
    const initialParams = new URLSearchParams(location.search);
    if (
      initialParams.has('id') ||
      initialParams.has('movie') ||
      initialParams.has('tv') ||
      initialParams.has('code') ||
      initialParams.has('error') ||
      (typeof window !== 'undefined' && window.location.hash.includes('access_token'))
    ) {
      return;
    }

    let isMounted = true;

    const initAuth = async () => {
      try {
        // Asynchronously check Supabase session
        const { data: { session } } = await supabase.auth.getSession();

        // Authenticated users must never see the automatic login popup
        if (!isMounted || session?.user || showAdmin || location.pathname === '/admin') {
          if (session?.user) {
            setAuthPopupDismissed(true);
            try {
              sessionStorage.setItem('movieverify_auth_popup_dismissed', 'true');
              localStorage.setItem('movieverify_auth_popup_dismissed', 'true');
            } catch {}
          }
          return;
        }

        // Open signup modal immediately on website open for unauthenticated visitor
        setShowAuthModal(true);
      } catch (err) {
        console.warn('Auth check error for immediate signup popup:', err?.message);
        // Do not force showAuthModal on transient check or network errors
      }
    };

    initAuth();

    // Listen for auth state changes: automatically dismiss modal on sign-in
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        setShowAuthModal(false);
        setAuthPopupDismissed(true);
        try {
          sessionStorage.setItem('movieverify_auth_popup_dismissed', 'true');
          localStorage.setItem('movieverify_auth_popup_dismissed', 'true');
        } catch {}
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

  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
    setSeeAllSection(null);
    setSearchQuery('');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  const handleLogOutReset = useCallback(() => {
    setActiveTab('home');
    setSeeAllSection(null);
    setSearchQuery('');
    setSelectedMovie(null);
    setSelectedActor(null);
    setIsActorModalOpen(false);
    setIsHistoryModalOpen(false);
    setIsNotificationCenterOpen(false);
    setShowAdmin(false);
    setShowAuthModal(false);
    setUnreadNotifications(0);
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    } catch {}
    navigate('/', { replace: true });
  }, [navigate]);

  handleLogOutResetRef.current = handleLogOutReset;

  if (showIntro) {
    return <IntroAnimation onComplete={() => setShowIntro(false)} />;
  }

  const isAdminRoute = location.pathname.startsWith('/admin');
  if (siteLocked && !isAdminRoute) {
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
              setActiveTab={handleTabChange}
              onProfileClick={handleOpenAuthModal}
              onAdminClick={handleOpenAdmin}
              onHistoryClick={() => setIsHistoryModalOpen(true)}
              onNotificationClick={() => setIsNotificationCenterOpen(true)}
              unreadNotificationCount={unreadNotifications}
              onLogOut={handleLogOutReset}
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
          ) : activeTab === 'mylist' ? (
            <div className="pt-32 px-4 md:px-12 min-h-[70vh]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-4 border-b border-white/10">
                <div>
                  <h2 className="text-2xl md:text-3xl font-black text-white flex items-center gap-3">
                    <span>My List</span>
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-white/10 text-rose-400 border border-white/15">
                      {myList.length} {myList.length === 1 ? 'title' : 'titles'}
                    </span>
                  </h2>
                  <p className="text-gray-400 text-xs md:text-sm mt-1">
                    Your personal collection of saved movies, web series, and shows.
                  </p>
                </div>
                {myList.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('Are you sure you want to clear your list?')) {
                        setMyList([]);
                        localStorage.removeItem('movieverify_mylist');
                      }
                    }}
                    className="text-xs text-gray-400 hover:text-rose-400 transition flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {myList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center bg-[#18181d]/50 border border-white/10 rounded-3xl p-8 max-w-xl mx-auto shadow-2xl">
                  <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-rose-500 mb-4 shadow-lg">
                    <Bookmark className="w-8 h-8 opacity-80" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Your List is Empty</h3>
                  <p className="text-gray-400 text-sm max-w-sm mb-6 leading-relaxed">
                    You haven't added any movies or TV shows to your list yet. Tap the bookmark or plus button on any title to save it here.
                  </p>
                  <div className="flex items-center gap-3 flex-wrap justify-center">
                    <button
                      type="button"
                      onClick={() => handleTabChange('home')}
                      className="px-6 py-2.5 rounded-full bg-[#E50914] hover:bg-rose-700 text-white text-xs font-bold transition shadow-lg cursor-pointer"
                    >
                      Browse Movies
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTabChange('releases')}
                      className="px-6 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition border border-white/15 cursor-pointer"
                    >
                      View Today Releases
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                  {myList.map((movie) => (
                    <MovieCard
                      key={movie.id}
                      movie={movie}
                      onClick={() => handleMovieSelect(movie)}
                      myList={myList}
                      onToggleMyList={toggleMyList}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : activeTab === 'releases' ? (
            <TodayReleasesView
              onRequireAuth={() => setShowAuthModal(true)}
            />
          ) : (
            <>
              <FeaturedCarousel
                movies={activeTab === 'tv' && displayWebSeries.length > 0 ? displayWebSeries : displayFeatured}
                onPlayTrailer={handleMovieSelect}
              />

              <div className="relative z-20 pb-10">
                {/* Active Tab Category Pill Header */}
                {activeTab === 'tv' && (
                  <div className="px-4 md:px-12 pt-6 pb-2">
                    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-purple-950/70 border border-purple-500/40 text-purple-300 text-xs font-bold shadow-md">
                      <span>📺</span>
                      <span>TV Shows & Web Series</span>
                    </div>
                  </div>
                )}
                {activeTab === 'movies' && (
                  <div className="px-4 md:px-12 pt-6 pb-2">
                    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-950/70 border border-blue-500/40 text-blue-300 text-xs font-bold shadow-md">
                      <span>🎬</span>
                      <span>Movies Collection</span>
                    </div>
                  </div>
                )}
                {activeTab === 'popular' && (
                  <div className="px-4 md:px-12 pt-6 pb-2">
                    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-950/70 border border-amber-500/40 text-amber-300 text-xs font-bold shadow-md">
                      <span>🔥</span>
                      <span>New & Popular Releases</span>
                    </div>
                  </div>
                )}

                {/* Continue Browsing (all non-empty tabs) */}
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

                {/* Download Available Section (Home only) */}
                {activeTab === 'home' && (
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

                {/* Web Series Row (TV Shows gets this on top; Home also has it) */}
                {(activeTab === 'home' || activeTab === 'tv') && (
                  <MovieRow
                    title={activeTab === 'tv' ? 'Trending Web Series & TV Shows' : 'Web Series'}
                    movies={displayWebSeries}
                    onMovieClick={handleMovieSelect}
                    isLoading={appLoading}
                    myList={myList}
                    onToggleMyList={toggleMyList}
                    onSeeAll={(title, list) => setSeeAllSection({ title, movies: list })}
                  />
                )}

                {/* Extra TV Web Series Row for TV tab */}
                {activeTab === 'tv' && displayWebSeries.length > 3 && (
                  <MovieRow
                    title="Popular OTT & Drama Series"
                    movies={[...displayWebSeries].reverse()}
                    onMovieClick={handleMovieSelect}
                    isLoading={appLoading}
                    myList={myList}
                    onToggleMyList={toggleMyList}
                    onSeeAll={(title, list) => setSeeAllSection({ title, movies: list })}
                  />
                )}

                {/* Trending Now (Home, Movies, Popular) */}
                {(activeTab === 'home' || activeTab === 'movies' || activeTab === 'popular') && (
                  <MovieRow
                    title={activeTab === 'popular' ? 'Top 10 Trending Now' : 'Trending Now'}
                    movies={displayTrending}
                    onMovieClick={handleMovieSelect}
                    isLoading={appLoading}
                    myList={myList}
                    onToggleMyList={toggleMyList}
                    onSeeAll={(title, list) => setSeeAllSection({ title, movies: list })}
                  />
                )}

                {/* India's Latest Releases (Home, Movies, Popular) */}
                {(activeTab === 'home' || activeTab === 'movies' || activeTab === 'popular') && latestIndiaPool.length > 0 && (
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

                {/* Browse by Genre */}
                <div className="px-4 md:px-12 mb-8 mt-4">
                  <h2 className="text-sm font-semibold text-[#e5e5e5] md:text-2xl mb-4">
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
                        className="px-4 py-2 bg-[#242424] hover:bg-[#E50914] text-white text-sm font-medium rounded-full transition cursor-pointer"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

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

                {/* Bollywood Hits (Home, Movies) */}
                {(activeTab === 'home' || activeTab === 'movies') && (
                  <MovieRow title="Bollywood Hits" movies={displayBollywood} onMovieClick={handleMovieSelect} isLoading={appLoading} myList={myList} onToggleMyList={toggleMyList} onSeeAll={(title, list) => setSeeAllSection({ title, movies: list })} />
                )}

                {/* South Indian Action (Home, Movies) */}
                {(activeTab === 'home' || activeTab === 'movies') && (
                  <MovieRow title="South Indian Action" movies={displaySouthIndian} onMovieClick={handleMovieSelect} isLoading={appLoading} myList={myList} onToggleMyList={toggleMyList} onSeeAll={(title, list) => setSeeAllSection({ title, movies: list })} />
                )}

                {/* Popular Movies (Home, Movies, Popular) */}
                {(activeTab === 'home' || activeTab === 'movies' || activeTab === 'popular') && (
                  <MovieRow title="Popular Movies" movies={displayPopular} onMovieClick={handleMovieSelect} isLoading={appLoading} myList={myList} onToggleMyList={toggleMyList} onSeeAll={(title, list) => setSeeAllSection({ title, movies: list })} />
                )}

                {/* Extra TV Web Series for Popular tab */}
                {activeTab === 'popular' && (
                  <MovieRow title="Top Rated Web Series" movies={displayWebSeries} onMovieClick={handleMovieSelect} isLoading={appLoading} myList={myList} onToggleMyList={toggleMyList} onSeeAll={(title, list) => setSeeAllSection({ title, movies: list })} />
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

      <Suspense fallback={null}>
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
      </Suspense>

          </>
        } />
        <Route path="/admin" element={<Suspense fallback={null}><AdminPanel onClose={handleCloseAdmin} /></Suspense>} />
        <Route path="/actors" element={<Suspense fallback={null}><AllActorsPage onMovieSelect={handleMovieSelect} type="actors" /></Suspense>} />
        <Route path="/actresses" element={<Suspense fallback={null}><AllActorsPage onMovieSelect={handleMovieSelect} type="actresses" /></Suspense>} />
        <Route
          path="/genre/:genreSlug"
          element={
            <Suspense fallback={null}>
              <GenrePage
                onMovieClick={handleMovieSelect}
                myList={myList}
                onToggleMyList={toggleMyList}
              />
            </Suspense>
          }
        />
      </Routes>

      {/* Global Movie Details Modal (accessible across Home, Genre, and Actor pages) */}
      {location.pathname !== '/admin' && (
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
      )}

      {/* Global Actor Modal */}
      {location.pathname !== '/admin' && (
        <Suspense fallback={null}>
          <ActorModal
            actor={selectedActor}
            isOpen={isActorModalOpen}
            onClose={() => setIsActorModalOpen(false)}
            onMovieClick={(movie) => {
              setIsActorModalOpen(false);
              handleMovieSelect(movie);
            }}
          />
        </Suspense>
      )}

      <AuthModal
        isOpen={showAuthModal && !showAdmin && location.pathname !== '/admin'}
        onClose={handleCloseAuthModal}
        onOpenAdmin={handleOpenAdmin}
      />

      {showAdmin && (
        <Suspense fallback={null}>
          <AdminPanel onClose={handleCloseAdmin} />
        </Suspense>
      )}
      <InstallPWA hasNotificationPrompt={hasNotificationPrompt || showNewUserGuide} />
      {!showIntro && !siteLocked && !showAdmin && location.pathname !== '/admin' && (
        <>
          <NewUserGuide
            isOpen={showNewUserGuide}
            onClose={() => setShowNewUserGuide(false)}
            onNotificationSubscribeSuccess={() => {
              setToastMessage('Release alerts enabled! You will receive updates.');
              setShowToast(true);
            }}
          />
          {!showNewUserGuide && (
            <NotificationPrompt
              onVisibilityChange={setHasNotificationPrompt}
              onSubscribeSuccess={() => {
                setHasNotificationPrompt(false);
                setToastMessage('Notifications enabled! You will receive new release alerts.');
                setShowToast(true);
              }}
            />
          )}
        </>
      )}
      {foregroundPushAlert && (
        <div
          role="status"
          data-testid="foreground-push-toast"
          className={`fixed top-20 right-4 md:right-8 z-[220] max-w-sm w-[calc(100vw-2rem)] bg-[#0d0d12]/95 backdrop-blur-xl rounded-2xl p-4 shadow-[0_0_30px_rgba(229,9,20,0.35)] flex flex-col transition-all duration-300 animate-in fade-in slide-in-from-top-4 ${
            foregroundPushAlert.isWelcome
              ? 'border border-amber-500/60 shadow-[0_0_35px_rgba(245,158,11,0.3)]'
              : 'border border-[#E50914]/60'
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between w-full pb-2 border-b border-white/5">
            <div className="flex items-center gap-2">
              {foregroundPushAlert.isWelcome ? (
                <div className="w-5 h-5 rounded-md bg-gradient-to-br from-amber-400 to-[#E50914] flex items-center justify-center text-white font-black text-[10px] shadow-[0_0_8px_rgba(245,158,11,0.8)] shrink-0">
                  <Sparkles className="w-3 h-3 text-white" />
                </div>
              ) : (
                <div className="w-5 h-5 rounded-md bg-gradient-to-br from-[#FF3445] to-[#E50914] flex items-center justify-center text-white font-black text-[10px] shadow-[0_0_8px_rgba(229,9,20,0.7)] shrink-0">
                  M
                </div>
              )}
              <span className="text-white text-xs font-bold tracking-tight">
                {foregroundPushAlert.isWelcome ? 'Welcome to MovieVerify' : 'MovieVerify'}
              </span>
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

          {/* Title & Body with Avatar or Icon */}
          <div className="mt-2.5 flex items-start gap-3">
            {foregroundPushAlert.avatar ? (
              <div className="relative shrink-0">
                <img
                  src={foregroundPushAlert.avatar}
                  alt="Profile"
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-full border-2 border-emerald-500 shadow-md object-cover"
                />
                <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center text-black">
                  <Check className="w-2.5 h-2.5 stroke-[3]" />
                </div>
              </div>
            ) : foregroundPushAlert.isWelcome ? (
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#E50914] to-red-800 flex items-center justify-center text-white font-bold text-sm shadow-md shrink-0 border border-white/20">
                🎉
              </div>
            ) : null}
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-extrabold leading-snug">{foregroundPushAlert.title}</p>
              {foregroundPushAlert.body && (
                <p className="text-gray-300 text-xs mt-1 leading-relaxed line-clamp-2">{foregroundPushAlert.body}</p>
              )}
            </div>
          </div>

          {/* Feature Badges for Welcome */}
          {foregroundPushAlert.isWelcome && (
            <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/10 text-gray-200 border border-white/10">
                ⚡ 1080p / 720p HD
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
                ✓ Verified
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-950/60 text-red-300 border border-red-800/40">
                🔔 Release Alerts
              </span>
            </div>
          )}

          {/* Cinematic Movie Banner (when image provided and not welcome) */}
          {!foregroundPushAlert.isWelcome && foregroundPushAlert.image && (
            <div className="mt-2.5 overflow-hidden rounded-xl border border-white/10 shadow-lg relative aspect-video bg-black/50">
              <img
                src={foregroundPushAlert.image}
                alt={foregroundPushAlert.title}
                className="w-full h-full object-cover"
                loading="eager"
              />
            </div>
          )}

          {/* Action Button */}
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
            {foregroundPushAlert.actionLabel ? (
              <span>{foregroundPushAlert.actionLabel}</span>
            ) : (
              <>
                <Download className="w-3.5 h-3.5 text-white" />
                <span>Download Now</span>
              </>
            )}
          </button>
        </div>
      )}
      <Toast message={toastMessage} isVisible={showToast} onClose={() => setShowToast(false)} />
    </div>
  );
}

export default App;
