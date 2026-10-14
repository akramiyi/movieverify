const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = require('./config');

// Service Role client — bypasses RLS (server-side only, NEVER expose)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  db: {
    schema: 'public'
  }
});

/**
 * Get download config for a specific movie/TV show
 * @param {string|number} tmdbId 
 * @param {string} mediaType - 'movie' or 'tv'
 * @returns {object|null}
 */
const getDownloadConfig = async (tmdbId, mediaType) => {
  try {
    const id = `${tmdbId}-${mediaType}`;
    const { data, error } = await supabase
      .from('download_links')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Supabase getDownloadConfig error:', error.message);
    }
    return data || null;
  } catch (err) {
    console.error('Supabase getDownloadConfig network error:', err.message);
    return null;
  }
};

/**
 * Upsert (insert or update) a download config
 * Uses the same schema as the website AdminPanel
 */
const upsertDownloadConfig = async ({ tmdbId, mediaType, title, download480p, download720p, download1080p, description, seasons }) => {
  try {
    const id = `${tmdbId}-${mediaType}`;
    const { data, error } = await supabase
      .from('download_links')
      .upsert({
        id,
        tmdb_id: String(tmdbId),
        media_type: mediaType,
        title: title || 'Untitled',
        download480p: download480p || null,
        download720p: download720p || null,
        download1080p: download1080p || null,
        description: description || null,
        seasons: seasons || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

    if (error) {
      console.error('Supabase upsert error:', error.message);
      throw error;
    }
    return data;
  } catch (err) {
    console.error('Supabase upsert network error:', err.message);
    throw err;
  }
};

/**
 * Delete a download config by id
 */
const deleteDownloadConfig = async (id) => {
  try {
    const { error } = await supabase
      .from('download_links')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Supabase delete error:', error.message);
      throw error;
    }
  } catch (err) {
    console.error('Supabase delete network error:', err.message);
    throw err;
  }
};

/**
 * List all configured download links
 * @param {number} page - 1-indexed page number
 * @param {number} perPage - items per page
 */
const listAllConfigs = async (page = 1, perPage = 10) => {
  try {
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    const { data, error, count } = await supabase
      .from('download_links')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      console.error('Supabase list error:', error.message);
      throw error;
    }

    return { data: data || [], total: count || 0 };
  } catch (err) {
    console.error('Supabase list network error:', err.message);
    return { data: [], total: 0 };
  }
};

/**
 * Get statistics about all download configs
 */
const getStats = async () => {
  try {
    const { data, error } = await supabase
      .from('download_links')
      .select('*');

    if (error) {
      console.error('Supabase stats error:', error.message);
      throw error;
    }

    const rows = data || [];
    const stats = {
      total: rows.length,
      movies: rows.filter(r => r.media_type === 'movie').length,
      tvShows: rows.filter(r => r.media_type === 'tv').length,
      has480p: rows.filter(r => r.download480p).length,
      has720p: rows.filter(r => r.download720p).length,
      has1080p: rows.filter(r => r.download1080p).length,
    };

    return stats;
  } catch (err) {
    console.error('Supabase stats network error:', err.message);
    return { total: 0, movies: 0, tvShows: 0, has480p: 0, has720p: 0, has1080p: 0 };
  }
};

module.exports = {
  getDownloadConfig,
  upsertDownloadConfig,
  deleteDownloadConfig,
  listAllConfigs,
  getStats
};
