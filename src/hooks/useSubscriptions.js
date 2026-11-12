import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../data/supabaseClient';

const STORAGE_MOVIES_KEY = 'movieverify_notify_list';
const STORAGE_ACTORS_KEY = 'movieverify_notify_actors';
const STORAGE_GENRES_KEY = 'movieverify_notify_genres';

export function normalizeMovieSubscriptionId(movieOrId) {
  if (!movieOrId) return '';
  if (typeof movieOrId === 'object') {
    const raw = movieOrId.tmdb_id ?? movieOrId.id;
    return raw !== undefined && raw !== null ? String(raw).split('-')[0].trim() : '';
  }
  return String(movieOrId).split('-')[0].trim();
}

// Module-level singleton cache & listeners to prevent duplicate N+1 queries across hook instances
let globalState = {
  movieSubs: [],
  actorSubs: [],
  genreSubs: [],
  isAuthenticated: false,
  userId: null,
  lastSyncedAt: 0,
};

// Try to hydrate initial state from localStorage immediately
try {
  const cachedMovies = localStorage.getItem(STORAGE_MOVIES_KEY);
  const cachedActors = localStorage.getItem(STORAGE_ACTORS_KEY);
  const cachedGenres = localStorage.getItem(STORAGE_GENRES_KEY);
  if (cachedMovies) globalState.movieSubs = JSON.parse(cachedMovies);
  if (cachedActors) globalState.actorSubs = JSON.parse(cachedActors);
  if (cachedGenres) globalState.genreSubs = JSON.parse(cachedGenres);
} catch {}

const listeners = new Set();
let inFlightSyncPromise = null;
let globalAuthListenerInitialized = false;

function notifyListeners() {
  listeners.forEach((listener) => {
    try {
      listener({ ...globalState });
    } catch {}
  });
}

function clearCachedSubs() {
  globalState = {
    movieSubs: [],
    actorSubs: [],
    genreSubs: [],
    isAuthenticated: false,
    userId: null,
    lastSyncedAt: Date.now(),
  };
  try {
    localStorage.removeItem(STORAGE_MOVIES_KEY);
    localStorage.removeItem(STORAGE_ACTORS_KEY);
    localStorage.removeItem(STORAGE_GENRES_KEY);
  } catch {}
  notifyListeners();
}

// Global deduplicated sync function
async function syncSubscriptionsWithSupabase(force = false) {
  if (inFlightSyncPromise) {
    return inFlightSyncPromise;
  }

  inFlightSyncPromise = (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        if (globalState.isAuthenticated) {
          clearCachedSubs();
        }
        return;
      }

      const now = Date.now();
      // Cache valid for 30 seconds unless forced (eliminates duplicate initial auth & mount calls)
      if (!force && globalState.userId === session.user.id && (now - globalState.lastSyncedAt < 30000)) {
        return;
      }

      const [moviesRes, actorsRes, genresRes] = await Promise.all([
        supabase.from('movie_notify_requests').select('*').eq('user_id', session.user.id),
        supabase.from('actor_notify_requests').select('*').eq('user_id', session.user.id),
        supabase.from('genre_notify_requests').select('*').eq('user_id', session.user.id),
      ]);

      const movieSubs = moviesRes.data
        ? moviesRes.data.map(m => ({
            id: m.movie_id,
            title: m.movie_title || m.movie_id,
            mediaType: m.media_type || 'movie',
            targetSeason: m.target_season || null,
          }))
        : globalState.movieSubs;

      const actorSubs = actorsRes.data
        ? actorsRes.data.map(a => ({ id: a.actor_id, name: a.actor_name || a.actor_id }))
        : globalState.actorSubs;

      const genreSubs = genresRes.data
        ? genresRes.data.map(g => ({ id: g.genre_id, name: g.genre_name || g.genre_id }))
        : globalState.genreSubs;

      globalState = {
        movieSubs,
        actorSubs,
        genreSubs,
        isAuthenticated: true,
        userId: session.user.id,
        lastSyncedAt: Date.now(),
      };

      try {
        localStorage.setItem(STORAGE_MOVIES_KEY, JSON.stringify(movieSubs));
        localStorage.setItem(STORAGE_ACTORS_KEY, JSON.stringify(actorSubs));
        localStorage.setItem(STORAGE_GENRES_KEY, JSON.stringify(genreSubs));
      } catch {}

      notifyListeners();
    } catch (err) {
      console.warn('[useSubscriptions] Sync failed:', err.message);
    } finally {
      inFlightSyncPromise = null;
    }
  })();

  return inFlightSyncPromise;
}

// Initialize Supabase auth listener exactly ONCE at module level
function initGlobalAuthListener() {
  if (globalAuthListenerInitialized) return;
  globalAuthListenerInitialized = true;

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      clearCachedSubs();
    } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
      if (session?.user) {
        syncSubscriptionsWithSupabase(false);
      }
    }
  });
}

export function useSubscriptions() {
  const [state, setState] = useState(() => ({ ...globalState }));
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    initGlobalAuthListener();
    listeners.add(setState);

    // Initial sync (deduplicated across all hook instances)
    syncSubscriptionsWithSupabase(false);

    return () => {
      listeners.delete(setState);
    };
  }, []);

  const movieSubs = state.movieSubs;
  const actorSubs = state.actorSubs;
  const genreSubs = state.genreSubs;
  const isAuthenticated = state.isAuthenticated;

  // Toggle Movie Subscription (requires authenticated Supabase session)
  const toggleMovieNotify = useCallback(async (movie) => {
    if (!movie || !movie.id) {
      return { success: false, error: 'Missing movie details' };
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      clearCachedSubs();
      return { success: false, requiresAuth: true, error: 'Sign in required to save release alerts.' };
    }

    const movieId = normalizeMovieSubscriptionId(movie);
    const movieTitle = movie.title || movie.name || movieId;
    const rawMedia = String(movie.mediaType || movie.media_type || (Array.isArray(movie.seasons) && movie.seasons.length > 0 ? 'tv' : 'movie')).toLowerCase();
    const mediaType = rawMedia === 'tv' || rawMedia === 'series' ? 'tv' : 'movie';
    const targetSeason =
      movie.targetSeason !== undefined && movie.targetSeason !== null && Number(movie.targetSeason) > 0
        ? Number(movie.targetSeason)
        : null;
    const seasonScope = targetSeason || 0;
    const exists = movieSubs.some(
      (m) =>
        normalizeMovieSubscriptionId(m.id) === movieId &&
        Number(m.targetSeason || 0) === seasonScope
    );

    setIsLoading(true);
    try {
      if (exists) {
        const { error } = await supabase
          .from('movie_notify_requests')
          .delete()
          .eq('user_id', session.user.id)
          .eq('movie_id', movieId)
          .eq('season_scope', seasonScope);

        if (error) {
          return { success: false, error: error.message };
        }

        const updated = movieSubs.filter(
          (m) =>
            !(
              normalizeMovieSubscriptionId(m.id) === movieId &&
              Number(m.targetSeason || 0) === seasonScope
            )
        );
        globalState.movieSubs = updated;
        globalState.lastSyncedAt = Date.now();
        try {
          localStorage.setItem(STORAGE_MOVIES_KEY, JSON.stringify(updated));
        } catch {}
        notifyListeners();
        return { success: true, subscribed: false };
      } else {
        const { error } = await supabase
          .from('movie_notify_requests')
          .upsert(
            {
              user_id: session.user.id,
              movie_id: movieId,
              movie_title: movieTitle,
              media_type: mediaType,
              target_season: targetSeason,
              season_scope: seasonScope,
            },
            { onConflict: 'user_id,movie_id,season_scope' }
          );

        if (error) {
          return { success: false, error: error.message };
        }

        const updated = [
          ...movieSubs,
          { id: movieId, title: movieTitle, mediaType, targetSeason, addedAt: Date.now() },
        ];
        globalState.movieSubs = updated;
        globalState.lastSyncedAt = Date.now();
        try {
          localStorage.setItem(STORAGE_MOVIES_KEY, JSON.stringify(updated));
        } catch {}
        notifyListeners();
        return { success: true, subscribed: true };
      }
    } finally {
      setIsLoading(false);
    }
  }, [movieSubs]);

  // Toggle Actor Subscription
  const toggleActorNotify = useCallback(async (actor) => {
    if (!actor || (!actor.id && !actor.tmdb_id)) {
      return { success: false, error: 'Missing actor details' };
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      clearCachedSubs();
      return { success: false, requiresAuth: true, error: 'Sign in required to save actor alerts.' };
    }

    const actorId = String(actor.tmdb_id || actor.id);
    const actorName = actor.name || actorId;
    const exists = actorSubs.some((a) => String(a.id) === actorId);

    if (exists) {
      const { error } = await supabase
        .from('actor_notify_requests')
        .delete()
        .eq('user_id', session.user.id)
        .eq('actor_id', actorId);
      if (error) return { success: false, error: error.message };

      const updated = actorSubs.filter((a) => String(a.id) !== actorId);
      globalState.actorSubs = updated;
      globalState.lastSyncedAt = Date.now();
      try {
        localStorage.setItem(STORAGE_ACTORS_KEY, JSON.stringify(updated));
      } catch {}
      notifyListeners();
      return { success: true, subscribed: false };
    } else {
      const { error } = await supabase
        .from('actor_notify_requests')
        .upsert(
          {
            user_id: session.user.id,
            actor_id: actorId,
            actor_name: actorName,
          },
          { onConflict: 'user_id,actor_id' }
        );
      if (error) return { success: false, error: error.message };

      const updated = [...actorSubs, { id: actorId, name: actorName, addedAt: Date.now() }];
      globalState.actorSubs = updated;
      globalState.lastSyncedAt = Date.now();
      try {
        localStorage.setItem(STORAGE_ACTORS_KEY, JSON.stringify(updated));
      } catch {}
      notifyListeners();
      return { success: true, subscribed: true };
    }
  }, [actorSubs]);

  // Toggle Genre Subscription
  const toggleGenreNotify = useCallback(async (genre) => {
    if (!genre || (!genre.id && !genre.slug)) {
      return { success: false, error: 'Missing genre details' };
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      clearCachedSubs();
      return { success: false, requiresAuth: true, error: 'Sign in required to save genre alerts.' };
    }

    const genreId = String(genre.id || genre.slug);
    const genreName = genre.name || genre.label || genreId;
    const exists = genreSubs.some((g) => String(g.id) === genreId);

    if (exists) {
      const { error } = await supabase
        .from('genre_notify_requests')
        .delete()
        .eq('user_id', session.user.id)
        .eq('genre_id', genreId);
      if (error) return { success: false, error: error.message };

      const updated = genreSubs.filter((g) => String(g.id) !== genreId);
      globalState.genreSubs = updated;
      globalState.lastSyncedAt = Date.now();
      try {
        localStorage.setItem(STORAGE_GENRES_KEY, JSON.stringify(updated));
      } catch {}
      notifyListeners();
      return { success: true, subscribed: false };
    } else {
      const { error } = await supabase
        .from('genre_notify_requests')
        .upsert(
          {
            user_id: session.user.id,
            genre_id: genreId,
            genre_name: genreName,
          },
          { onConflict: 'user_id,genre_id' }
        );
      if (error) return { success: false, error: error.message };

      const updated = [...genreSubs, { id: genreId, name: genreName, addedAt: Date.now() }];
      globalState.genreSubs = updated;
      globalState.lastSyncedAt = Date.now();
      try {
        localStorage.setItem(STORAGE_GENRES_KEY, JSON.stringify(updated));
      } catch {}
      notifyListeners();
      return { success: true, subscribed: true };
    }
  }, [genreSubs]);

  return {
    movieSubs,
    actorSubs,
    genreSubs,
    isAuthenticated,
    isLoading,
    toggleMovieNotify,
    toggleActorNotify,
    toggleGenreNotify,
    isMovieNotifying: (id, targetSeason = undefined) => {
      const normalized = normalizeMovieSubscriptionId(id);
      if (!normalized) return false;
      if (targetSeason === undefined) {
        return movieSubs.some((m) => normalizeMovieSubscriptionId(m.id) === normalized);
      }
      const seasonScope = Number(targetSeason || 0);
      return movieSubs.some(
        (m) =>
          normalizeMovieSubscriptionId(m.id) === normalized &&
          Number(m.targetSeason || 0) === seasonScope
      );
    },
    isActorNotifying: (id) => actorSubs.some((a) => String(a.id) === String(id)),
    isGenreNotifying: (id) => genreSubs.some((g) => String(g.id) === String(id)),
    refreshSubscriptions: () => syncSubscriptionsWithSupabase(true),
  };
}
