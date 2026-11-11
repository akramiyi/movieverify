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

export function useSubscriptions() {
  const [movieSubs, setMovieSubs] = useState([]);
  const [actorSubs, setActorSubs] = useState([]);
  const [genreSubs, setGenreSubs] = useState([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const clearCachedSubs = useCallback(() => {
    setMovieSubs([]);
    setActorSubs([]);
    setGenreSubs([]);
    try {
      localStorage.removeItem(STORAGE_MOVIES_KEY);
      localStorage.removeItem(STORAGE_ACTORS_KEY);
      localStorage.removeItem(STORAGE_GENRES_KEY);
    } catch {}
  }, []);

  // Sync with Supabase on mount / auth change
  const syncWithSupabase = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setIsAuthenticated(false);
        clearCachedSubs();
        return;
      }

      setIsAuthenticated(true);

      const [moviesRes, actorsRes, genresRes] = await Promise.all([
        supabase.from('movie_notify_requests').select('*').eq('user_id', session.user.id),
        supabase.from('actor_notify_requests').select('*').eq('user_id', session.user.id),
        supabase.from('genre_notify_requests').select('*').eq('user_id', session.user.id),
      ]);

      if (moviesRes.data) {
        const mapped = moviesRes.data.map(m => ({
          id: m.movie_id,
          title: m.movie_title || m.movie_id,
          mediaType: m.media_type || 'movie',
          targetSeason: m.target_season || null,
        }));
        setMovieSubs(mapped);
        try {
          localStorage.setItem(STORAGE_MOVIES_KEY, JSON.stringify(mapped));
        } catch {}
      }
      if (actorsRes.data) {
        const mapped = actorsRes.data.map(a => ({ id: a.actor_id, name: a.actor_name || a.actor_id }));
        setActorSubs(mapped);
        try {
          localStorage.setItem(STORAGE_ACTORS_KEY, JSON.stringify(mapped));
        } catch {}
      }
      if (genresRes.data) {
        const mapped = genresRes.data.map(g => ({ id: g.genre_id, name: g.genre_name || g.genre_id }));
        setGenreSubs(mapped);
        try {
          localStorage.setItem(STORAGE_GENRES_KEY, JSON.stringify(mapped));
        } catch {}
      }
    } catch (err) {
      console.warn('[useSubscriptions] Sync failed:', err.message);
    }
  }, [clearCachedSubs]);

  useEffect(() => {
    syncWithSupabase();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session?.user) {
        setIsAuthenticated(false);
        clearCachedSubs();
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        syncWithSupabase();
      }
    });
    return () => subscription?.unsubscribe();
  }, [syncWithSupabase, clearCachedSubs]);

  // Toggle Movie Subscription (requires authenticated Supabase session)
  const toggleMovieNotify = useCallback(async (movie) => {
    if (!movie || !movie.id) {
      return { success: false, error: 'Missing movie details' };
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      setIsAuthenticated(false);
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
        setMovieSubs(updated);
        try {
          localStorage.setItem(STORAGE_MOVIES_KEY, JSON.stringify(updated));
        } catch {}
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
        setMovieSubs(updated);
        try {
          localStorage.setItem(STORAGE_MOVIES_KEY, JSON.stringify(updated));
        } catch {}
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
      setIsAuthenticated(false);
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
      setActorSubs(updated);
      try {
        localStorage.setItem(STORAGE_ACTORS_KEY, JSON.stringify(updated));
      } catch {}
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
      setActorSubs(updated);
      try {
        localStorage.setItem(STORAGE_ACTORS_KEY, JSON.stringify(updated));
      } catch {}
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
      setIsAuthenticated(false);
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
      setGenreSubs(updated);
      try {
        localStorage.setItem(STORAGE_GENRES_KEY, JSON.stringify(updated));
      } catch {}
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
      setGenreSubs(updated);
      try {
        localStorage.setItem(STORAGE_GENRES_KEY, JSON.stringify(updated));
      } catch {}
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
    refreshSubscriptions: syncWithSupabase,
  };
}

