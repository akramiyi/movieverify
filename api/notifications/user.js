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
      const now = new Date();
      const visibleNotifications = [];
      const PAGE_SIZE = 50;
      const MAX_SCAN = 250;
      let offset = 0;

      while (visibleNotifications.length < PAGE_SIZE && offset < MAX_SCAN) {
        let query = supabase
          .from('user_notifications')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false });

        if (typeof query.range === 'function') {
          query = query.range(offset, offset + PAGE_SIZE - 1);
        } else if (typeof query.limit === 'function') {
          query = query.limit(PAGE_SIZE);
        }

        const { data: batch, error } = await query;

        if (error) {
          console.error('[UserNotifications API] Error fetching notifications:', error.message);
          return sendJson(res, 500, { error: 'Failed to retrieve notifications.' });
        }

        if (!batch || batch.length === 0) {
          break;
        }

        // Filter out deleted and expired items
        const nonExpired = batch.filter((item) => {
          if (item.is_deleted === true) return false;
          if (item.expires_at && new Date(item.expires_at) <= now) return false;
          return true;
        });

        // Collect campaign IDs needing status resolution
        const campaignIds = [
          ...new Set(
            nonExpired
              .map((item) => item.campaign_id)
              .filter((id) => Boolean(id))
          ),
        ];

        let campaignStatusMap = new Map();
        let deliveredCampaignIds = new Set();

        if (campaignIds.length > 0) {
          try {
            const { data: campaigns, error: campaignError } = await supabase
              .from('notification_campaigns')
              .select('id, status')
              .in('id', campaignIds);

            if (campaignError) {
              console.warn('[UserNotifications API] Failed to fetch campaign statuses:', campaignError.message);
            } else if (Array.isArray(campaigns)) {
              for (const c of campaigns) {
                if (c && c.id) {
                  campaignStatusMap.set(c.id, c.status);
                }
              }
            }
          } catch (err) {
            console.warn('[UserNotifications API] Unexpected error fetching campaigns:', err.message);
          }

          // Find which campaigns are cancelled
          const cancelledCampaignIds = campaignIds.filter(
            (id) => campaignStatusMap.get(id) === 'cancelled'
          );

          if (cancelledCampaignIds.length > 0) {
            try {
              const { data: deliveries, error: deliveryError } = await supabase
                .from('notification_deliveries')
                .select('campaign_id, delivery_status')
                .eq('recipient_id', user.id)
                .in('campaign_id', cancelledCampaignIds)
                .in('delivery_status', ['sent', 'delivered']);

              if (deliveryError) {
                console.warn('[UserNotifications API] Failed to fetch deliveries for cancelled campaigns:', deliveryError.message);
              } else if (Array.isArray(deliveries)) {
                for (const d of deliveries) {
                  if (d && d.campaign_id) {
                    deliveredCampaignIds.add(d.campaign_id);
                  }
                }
              }
            } catch (err) {
              console.warn('[UserNotifications API] Unexpected error fetching deliveries:', err.message);
            }
          }
        }

        // Determine visibility for each item in the batch
        for (const item of nonExpired) {
          if (!item.campaign_id) {
            // Standalone notification -> visible
            visibleNotifications.push(item);
          } else {
            // Must have a known status in notification_campaigns
            const status = campaignStatusMap.get(item.campaign_id);
            if (!status) {
              // Unknown campaign or lookup failed -> fail safe (hide)
              continue;
            }

            if (status !== 'cancelled') {
              // Active / non-cancelled campaign -> visible
              visibleNotifications.push(item);
            } else {
              // Cancelled campaign: only visible if user has sent/delivered delivery
              if (deliveredCampaignIds.has(item.campaign_id)) {
                visibleNotifications.push(item);
              }
            }
          }

          if (visibleNotifications.length >= PAGE_SIZE) {
            break;
          }
        }

        if (batch.length < PAGE_SIZE) {
          break;
        }

        offset += PAGE_SIZE;
      }

      const finalNotifications = visibleNotifications.slice(0, PAGE_SIZE);
      const unreadCount = finalNotifications.filter((n) => !n.is_read).length;

      return sendJson(res, 200, {
        unread_count: unreadCount,
        notifications: finalNotifications,
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

