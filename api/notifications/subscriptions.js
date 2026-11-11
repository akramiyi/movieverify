/**
 * GET /api/notifications/subscriptions
 * POST /api/notifications/subscriptions
 * DELETE /api/notifications/subscriptions
 * 
 * Secure endpoint to manage movie, actor, and genre notifications subscriptions.
 * Supports types: 'movie', 'actor', 'genre'.
 * Strictly enforces user ownership based on verified Supabase JWT auth token.
 */

import { requireAuth } from '../_lib/authMiddleware.js';
import { parseJsonBody, sendJson } from '../_lib/requestUtils.js';
import { getSupabaseServerClient } from '../_lib/supabaseServer.js';

const TABLE_MAP = {
  movie: 'movie_notify_requests',
  series: 'movie_notify_requests',
  season: 'movie_notify_requests',
  actor: 'actor_notify_requests',
  genre: 'genre_notify_requests',
};

const ID_COLUMN_MAP = {
  movie: 'movie_id',
  series: 'movie_id',
  season: 'movie_id',
  actor: 'actor_id',
  genre: 'genre_id',
};

export default async function handler(req, res, customSupabase = null) {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return sendJson(res, 405, { error: 'Method Not Allowed. Use GET, POST, or DELETE.' });
  }

  // 1. Authenticate Request
  const user = await requireAuth(req, res, customSupabase);
  if (!user) {
    return; // Handled by requireAuth
  }

  const supabase = getSupabaseServerClient(customSupabase);

  // 2. GET: List all user subscriptions across movies, actors, and genres
  if (method === 'GET') {
    try {
      const [moviesRes, actorsRes, genresRes] = await Promise.all([
        supabase.from('movie_notify_requests').select('*').eq('user_id', user.id),
        supabase.from('actor_notify_requests').select('*').eq('user_id', user.id),
        supabase.from('genre_notify_requests').select('*').eq('user_id', user.id),
      ]);

      return sendJson(res, 200, {
        movies: moviesRes.data || [],
        actors: actorsRes.data || [],
        genres: genresRes.data || [],
      });
    } catch (err) {
      console.error('[Subscriptions API] GET error:', err.message);
      return sendJson(res, 500, { error: 'Failed to retrieve subscriptions.' });
    }
  }

  // 3. POST: Create subscription
  if (method === 'POST') {
    const body = (await parseJsonBody(req)) || {};
    const { type, target_id, target_name } = body;

    if (!type || !TABLE_MAP[type]) {
      return sendJson(res, 400, { error: 'Invalid or missing type. Allowed: movie, series, season, actor, genre.' });
    }
    if (!target_id) {
      return sendJson(res, 400, { error: 'target_id is required.' });
    }

    const table = TABLE_MAP[type];
    const idCol = ID_COLUMN_MAP[type];

    try {
      const cleanTargetId = String(target_id).split('-')[0].trim();
      const rowData = {
        user_id: user.id,
        [idCol]: cleanTargetId,
      };
      if (type === 'movie' || type === 'series' || type === 'season') {
        rowData.movie_title = target_name || null;
        rowData.media_type =
          type === 'movie'
            ? (body.media_type === 'tv' || body.media_type === 'series' ? 'tv' : 'movie')
            : 'tv';
        if (type === 'season') {
          const parsedSeason = parseInt(body.season_number, 10);
          if (!Number.isInteger(parsedSeason) || parsedSeason <= 0) {
            return sendJson(res, 400, { error: 'Positive integer season_number is required for season subscriptions.' });
          }
          rowData.target_season = parsedSeason;
          rowData.season_scope = parsedSeason;
        } else {
          rowData.target_season = null;
          rowData.season_scope = 0;
        }
      } else if (type === 'actor') {
        rowData.actor_name = target_name || null;
      } else if (type === 'genre') {
        rowData.genre_name = target_name || null;
      }

      const conflictTarget =
        type === 'movie' || type === 'series' || type === 'season'
          ? `user_id,${idCol},season_scope`
          : `user_id,${idCol}`;

      const { data, error } = await supabase
        .from(table)
        .upsert(rowData, { onConflict: conflictTarget })
        .select()
        .single();

      if (error) {
        console.error(`[Subscriptions API] Error adding ${type} subscription:`, error.message);
        return sendJson(res, 500, { error: error.message });
      }

      return sendJson(res, 201, { success: true, subscription: data });
    } catch (err) {
      console.error(`[Subscriptions API] Unexpected error on POST:`, err.message);
      return sendJson(res, 500, { error: 'Internal Server Error' });
    }
  }

  // 4. DELETE: Remove subscription
  if (method === 'DELETE') {
    const body = (await parseJsonBody(req)) || {};
    let type = body.type;
    let target_id = body.target_id;

    if (!type && req.query) type = req.query.type;
    if (!target_id && req.query) target_id = req.query.target_id;
    const rawSeasonNumber = body.season_number ?? req.query?.season_number;

    if (!type || !TABLE_MAP[type]) {
      return sendJson(res, 400, { error: 'Invalid or missing type. Allowed: movie, series, season, actor, genre.' });
    }
    if (!target_id) {
      return sendJson(res, 400, { error: 'target_id is required.' });
    }

    const table = TABLE_MAP[type];
    const idCol = ID_COLUMN_MAP[type];
    const cleanTargetId = type === 'movie' || type === 'series' || type === 'season'
      ? String(target_id).split('-')[0].trim()
      : String(target_id);

    try {
      let query = supabase
        .from(table)
        .delete()
        .eq('user_id', user.id)
        .eq(idCol, cleanTargetId);

      if (type === 'season') {
        if (rawSeasonNumber !== undefined && rawSeasonNumber !== null && String(rawSeasonNumber).trim() !== '') {
          const parsedSeason = parseInt(rawSeasonNumber, 10);
          if (!Number.isInteger(parsedSeason) || parsedSeason <= 0) {
            return sendJson(res, 400, { error: 'Positive integer season_number is required when deleting a season subscription.' });
          }
          query = query.eq('season_scope', parsedSeason);
        } else {
          query = query.gt('season_scope', 0);
        }
      } else if (type === 'movie' || type === 'series') {
        query = query.eq('season_scope', 0);
      }

      const { error } = await query;

      if (error) {
        console.error(`[Subscriptions API] Error removing ${type} subscription:`, error.message);
        return sendJson(res, 500, { error: error.message });
      }

      return sendJson(res, 200, { success: true, message: `${type} subscription removed.` });
    } catch (err) {
      console.error(`[Subscriptions API] Unexpected error on DELETE:`, err.message);
      return sendJson(res, 500, { error: 'Internal Server Error' });
    }
  }
}

