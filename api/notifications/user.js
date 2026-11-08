/**
 * GET /api/notifications/user
 * PATCH /api/notifications/user
 * 
 * Secure endpoint for Authenticated User Notifications:
 * - GET: Fetch notification inbox history and unread count.
 * - PATCH: Mark single notification or all notifications as read.
 */

import { requireAuth } from '../_lib/authMiddleware.js';
import { parseJsonBody, sendJson } from '../_lib/requestUtils.js';
import { getSupabaseServerClient } from '../_lib/supabaseServer.js';

export default async function handler(req, res, customSupabase = null) {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'PATCH') {
    res.setHeader('Allow', 'GET, PATCH');
    return sendJson(res, 405, { error: 'Method Not Allowed. Use GET or PATCH.' });
  }

  // 1. Authenticate Request
  const user = await requireAuth(req, res, customSupabase);
  if (!user) {
    return; // Handled by requireAuth
  }

  const supabase = getSupabaseServerClient(customSupabase);

  // 2. Handle GET: Retrieve inbox & unread counter
  if (method === 'GET') {
    try {
      const { data: notifications, error } = await supabase
        .from('user_notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('[UserNotifications API] Error fetching notifications:', error.message);
        return sendJson(res, 500, { error: 'Failed to retrieve notifications.' });
      }

      const unreadCount = (notifications || []).filter((n) => !n.is_read).length;

      return sendJson(res, 200, {
        unread_count: unreadCount,
        notifications: notifications || [],
      });
    } catch (err) {
      console.error('[UserNotifications API] Unexpected error on GET:', err.message);
      return sendJson(res, 500, { error: 'Internal Server Error' });
    }
  }

  // 3. Handle PATCH: Mark as read / Mark all as read
  if (method === 'PATCH') {
    const body = (await parseJsonBody(req)) || {};
    const { notification_id, mark_all = false } = body;

    try {
      if (mark_all) {
        const { error } = await supabase
          .from('user_notifications')
          .update({ is_read: true, read_at: new Date().toISOString() })
          .eq('user_id', user.id)
          .eq('is_read', false);

        if (error) {
          console.error('[UserNotifications API] Error marking all read:', error.message);
          return sendJson(res, 500, { error: 'Failed to mark all as read.' });
        }

        return sendJson(res, 200, { success: true, message: 'All notifications marked as read.' });
      }

      if (!notification_id) {
        return sendJson(res, 400, { error: 'notification_id or mark_all:true is required.' });
      }

      const { data, error } = await supabase
        .from('user_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notification_id)
        .eq('user_id', user.id)
        .select()
        .single();

      if (error) {
        console.error('[UserNotifications API] Error marking notification read:', error.message);
        return sendJson(res, 500, { error: 'Failed to mark notification as read.' });
      }

      return sendJson(res, 200, { success: true, notification: data });
    } catch (err) {
      console.error('[UserNotifications API] Unexpected error on PATCH:', err.message);
      return sendJson(res, 500, { error: 'Internal Server Error' });
    }
  }
}

