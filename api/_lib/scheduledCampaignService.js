/**
 * Scheduled Campaign Promotion Helper
 *
 * Promotes due scheduled notification campaigns (`scheduled_for <= NOW()`)
 * into materialized deliveries and user inbox records without duplicating
 * the notification_deliveries dispatch queue.
 *
 * Architecture Note (Phase 5.2):
 * `notification_queue` is formally retired from worker polling and retained as
 * an ingestion/cancellation audit ledger. All push dispatching flows exclusively
 * through `notification_deliveries` via B5E `reserve_notification_deliveries`
 * and `authorize_notification_delivery_dispatch`.
 */

import { getSupabaseServerClient } from './supabaseServer.js';

/**
 * Promote due scheduled campaigns into actionable deliveries.
 *
 * @param {object|null} customSupabase Optional Supabase client override (for testing)
 * @param {number} limit Max scheduled campaigns to promote in one pass (1..100)
 * @returns {Promise<{ promoted_count: number, campaigns: Array, error?: string }>}
 */
export async function promoteDueScheduledCampaigns(customSupabase = null, limit = 20) {
  const supabase = getSupabaseServerClient(customSupabase);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

  const { data, error } = await supabase.rpc('promote_due_scheduled_campaigns', {
    p_limit: safeLimit,
  });

  if (error) {
    throw new Error(`Scheduled campaign promotion failed: ${error.message}`);
  }

  return {
    promoted_count: data?.promoted_count ?? 0,
    campaigns: Array.isArray(data?.campaigns) ? data.campaigns : [],
  };
}

