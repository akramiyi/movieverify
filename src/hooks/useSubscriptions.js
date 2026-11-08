import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../data/supabaseClient';

const STORAGE_MOVIES_KEY = 'movieverify_notify_list';
const STORAGE_ACTORS_KEY = 'movieverify_notify_actors';
const STORAGE_GENRES_KEY = 'movieverify_notify_genres';

export function useSubscriptions() {
  const [movieSubs, setMovieSubs] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_MOVIES_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [actorSubs, setActorSubs] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_ACTORS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [genreSubs, setGenreSubs] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_GENRES_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [isLoading, setIsLoading] = useState(false);

  // Sync with Supabase on mount / auth change
  const syncWithSupabase = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const [moviesRes, actorsRes, genresRes] = await Promise.all([
        supabase.from('movie_notify_requests').select('*').eq('user_id', session.user.id),
        supabase.from('actor_notify_requests').select('*').eq('user_id', session.user.id),
        supabase.from('genre_notify_requests').select('*').eq('user_id', session.user.id),
      ]);

      if (moviesRes.data) {
        const mapped = moviesRes.data.map(m => ({ id: m.movie_id, title: m.movie_title || m.movie_id }));
        setMovieSubs(mapped);
        localStorage.setItem(STORAGE_MOVIES_KEY, JSON.stringify(mapped));
      }
      if (actorsRes.data) {
        const mapped = actorsRes.data.map(a => ({ id: a.actor_id, name: a.actor_name || a.actor_id }));
        setActorSubs(mapped);
        localStorage.setItem(STORAGE_ACTORS_KEY, JSON.stringify(mapped));
      }
      if (genresRes.data) {
        const mapped = genresRes.data.map(g => ({ id: g.genre_id, name: g.genre_name || g.genre_id }));
        setGenreSubs(mapped);
        localStorage.setItem(STORAGE_GENRES_KEY, JSON.stringify(mapped));
      }
    } catch (err) {
      console.warn('[useSubscriptions] Sync failed:', err.message);
    }
  }, []);

  useEffect(() => {
    syncWithSupabase();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') syncWithSupabase();
    });
    return () => subscription?.unsubscribe();
  }, [syncWithSupabase]);

  // Toggle Movie Subscription
  const toggleMovieNotify = useCallback(async (movie) => {
    if (!movie || !movie.id) return;
    const movieId = String(movie.id);
    const movieTitle = movie.title || movie.name || movieId;
    const exists = movieSubs.some((m) => String(m.id) === movieId);

    const updated = exists
      ? movieSubs.filter((m) => String(m.id) !== movieId)
      : [...movieSubs, { id: movieId, title: movieTitle, addedAt: Date.now() }];

    setMovieSubs(updated);
    try {
      localStorage.setItem(STORAGE_MOVIES_KEY, JSON.stringify(updated));
    } catch {}

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      if (exists) {
        await supabase.from('movie_notify_requests').delete().eq('user_id', session.user.id).eq('movie_id', movieId);
      } else {
        await supabase.from('movie_notify_requests').upsert({
          user_id: session.user.id,
          movie_id: movieId,
          movie_title: movieTitle,
        });
      }
    }
  }, [movieSubs]);

  // Toggle Actor Subscription
  const toggleActorNotify = useCallback(async (actor) => {
    if (!actor || (!actor.id && !actor.tmdb_id)) return;
    const actorId = String(actor.tmdb_id || actor.id);
    const actorName = actor.name || actorId;
    const exists = actorSubs.some((a) => String(a.id) === actorId);

    const updated = exists
      ? actorSubs.filter((a) => String(a.id) !== actorId)
      : [...actorSubs, { id: actorId, name: actorName, addedAt: Date.now() }];

    setActorSubs(updated);
    try {
      localStorage.setItem(STORAGE_ACTORS_KEY, JSON.stringify(updated));
    } catch {}

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      if (exists) {
        await supabase.from('actor_notify_requests').delete().eq('user_id', session.user.id).eq('actor_id', actorId);
      } else {
        await supabase.from('actor_notify_requests').upsert({
          user_id: session.user.id,
          actor_id: actorId,
          actor_name: actorName,
        });
      }
    }
  }, [actorSubs]);

  // Toggle Genre Subscription
  const toggleGenreNotify = useCallback(async (genre) => {
    if (!genre || (!genre.id && !genre.slug)) return;
    const genreId = String(genre.id || genre.slug);
    const genreName = genre.name || genre.label || genreId;
    const exists = genreSubs.some((g) => String(g.id) === genreId);

    const updated = exists
      ? genreSubs.filter((g) => String(g.id) !== genreId)
      : [...genreSubs, { id: genreId, name: genreName, addedAt: Date.now() }];

    setGenreSubs(updated);
    try {
      localStorage.setItem(STORAGE_GENRES_KEY, JSON.stringify(updated));
    } catch {}

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      if (exists) {
        await supabase.from('genre_notify_requests').delete().eq('user_id', session.user.id).eq('genre_id', genreId);
      } else {
        await supabase.from('genre_notify_requests').upsert({
          user_id: session.user.id,
          genre_id: genreId,
          genre_name: genreName,
        });
      }
    }
  }, [genreSubs]);

  return {
    movieSubs,
    actorSubs,
    genreSubs,
    toggleMovieNotify,
    toggleActorNotify,
    toggleGenreNotify,
    isMovieNotifying: (id) => movieSubs.some((m) => String(m.id) === String(id)),
    isActorNotifying: (id) => actorSubs.some((a) => String(a.id) === String(id)),
    isGenreNotifying: (id) => genreSubs.some((g) => String(g.id) === String(id)),
    refreshSubscriptions: syncWithSupabase,
  };
}

