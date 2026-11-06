/**
 * GET /api/notifications/preferences
 * POST /api/notifications/preferences
 * 
 * Secure endpoint for managing user notification opt-outs and channel preferences.
 * Supports categories: 'movie_release', 'content_update', 'user_alert', 'admin_announcement', 'promotional'.
 */

import { requireAuth } from '../_lib/authMiddleware.js';
import { parseJsonBody, sendJson } from '../_lib/requestUtils.js';
import { getSupabaseServerClient } from '../_lib/supabaseServer.js';

const ALLOWED_CATEGORIES = [
  'movie_release',
  'content_update',
  'user_alert',
  'admin_announcement',
  'promotional',
];

export default async function handler(req, res, customSupabase = null) {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { error: 'Method Not Allowed. Use GET or POST.' });
  }

  // 1. Authenticate Request
  const user = await requireAuth(req, res, customSupabase);
  if (!user) {
    return; // Handled by requireAuth
  }

  const supabase = getSupabaseServerClient(customSupabase);

  // 2. GET: Retrieve user opt-outs
  if (method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('notification_opt_outs')
        .select('*')
        .eq('user_id', user.id);

      if (error) {
        console.error('[Preferences API] Error fetching opt-outs:', error.message);
        return sendJson(res, 500, { error: 'Failed to retrieve notification preferences.' });
      }

      const optOutCategories = (data || []).map((row) => row.category);

      return sendJson(res, 200, {
        opt_outs: optOutCategories,
        categories: ALLOWED_CATEGORIES.map((cat) => ({
          category: cat,
          enabled: !optOutCategories.includes(cat),
        })),
      });
    } catch (err) {
      console.error('[Preferences API] Unexpected error on GET:', err.message);
      return sendJson(res, 500, { error: 'Internal Server Error' });
    }
  }

  // 3. POST: Toggle or update category preference
  if (method === 'POST') {
    const body = (await parseJsonBody(req)) || {};
    const { category, enabled } = body;

    if (!category || !ALLOWED_CATEGORIES.includes(category)) {
      return sendJson(res, 400, {
        error: `Invalid category "${category}". Allowed: ${ALLOWED_CATEGORIES.join(', ')}`,
      });
    }

    try {
      if (enabled) {
        // Remove opt-out (user wants notifications)
        const { error } = await supabase
          .from('notification_opt_outs')
          .delete()
          .eq('user_id', user.id)
          .eq('category', category);

        if (error) {
          console.error('[Preferences API] Error removing opt-out:', error.message);
          return sendJson(res, 500, { error: error.message });
        }

        return sendJson(res, 200, { success: true, category, enabled: true });
      } else {
        // Insert opt-out (user disables notifications for this category)
        const { data, error } = await supabase
          .from('notification_opt_outs')
          .upsert(
            { user_id: user.id, category, reason: 'user_preference' },
            { onConflict: 'user_id,category' }
          )
          .select()
          .single();

        if (error) {
          console.error('[Preferences API] Error creating opt-out:', error.message);
          return sendJson(res, 500, { error: error.message });
        }

        return sendJson(res, 200, { success: true, category, enabled: false, data });
      }
    } catch (err) {
      console.error('[Preferences API] Unexpected error on POST:', err.message);
      return sendJson(res, 500, { error: 'Internal Server Error' });
    }
  }
}

