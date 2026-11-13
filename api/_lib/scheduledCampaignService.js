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

  // Attempt 1: Standard RPC with p_limit parameter
  let rpcRes = await supabase.rpc('promote_due_scheduled_campaigns', {
    p_limit: safeLimit,
  });

  // Attempt 2: If parameter name mismatch, try limit_count parameter
  if (rpcRes?.error && /argument|parameter|limit_count/i.test(rpcRes.error.message || '')) {
    rpcRes = await supabase.rpc('promote_due_scheduled_campaigns', {
      limit_count: safeLimit,
    });
  }

  // Attempt 3: Parameterless fallback if function takes default or 0 args
  if (rpcRes?.error && /argument|parameter/i.test(rpcRes.error.message || '')) {
    const noArgRes = await supabase.rpc('promote_due_scheduled_campaigns');
    if (!noArgRes.error) {
      rpcRes = noArgRes;
    }
  }

  if (rpcRes?.error) {
    throw new Error(`Scheduled campaign promotion failed: ${rpcRes.error.message}`);
  }

  let promotedCount = 0;
  let campaigns = [];
  if (typeof rpcRes?.data === 'number') {
    promotedCount = rpcRes.data;
  } else if (rpcRes?.data && typeof rpcRes.data === 'object') {
    promotedCount = rpcRes.data.promoted_count ?? 0;
    campaigns = Array.isArray(rpcRes.data.campaigns) ? rpcRes.data.campaigns : [];
  }

  return {
    promoted_count: promotedCount,
    campaigns,
  };
}

/**
 * Direct Service-Role Fallback Promotion
 * Used when promote_due_scheduled_campaigns RPC is uninstalled or unavailable in database.
 */
export async function promoteDueScheduledCampaignsFallback(customSupabase = null, limit = 20) {
  const supabase = getSupabaseServerClient(customSupabase);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

  if (typeof supabase?.from !== 'function') {
    return { promoted_count: 0, campaigns: [], fallback_skipped: true };
  }

  const nowIso = new Date().toISOString();
  const { data: dueCampaigns, error: fetchErr } = await supabase
    .from('notification_campaigns')
    .select('id, title, body, category, target_type, target_criteria, scheduled_for')
    .eq('status', 'scheduled')
    .not('scheduled_for', 'is', null)
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(safeLimit);

  if (fetchErr || !Array.isArray(dueCampaigns) || dueCampaigns.length === 0) {
    return { promoted_count: 0, campaigns: [] };
  }

  const promotedCampaigns = [];

  for (const campaign of dueCampaigns) {
    try {
      const matRpc = await supabase.rpc('_materialize_notification_campaign', {
        p_campaign_id: campaign.id,
      });

      if (!matRpc?.error && matRpc?.data) {
        promotedCampaigns.push(matRpc.data);
        continue;
      }

      // If _materialize is also missing, create deliveries directly
      const { data: activeEndpoints } = await supabase
        .from('notification_endpoints')
        .select('id, user_id, channel_type')
        .eq('is_active', true)
        .is('revoked_at', null);

      const endpoints = Array.isArray(activeEndpoints) ? activeEndpoints : [];
      let deliveryCount = 0;

      if (endpoints.length > 0) {
        const deliveryRows = endpoints.map((ep) => ({
          campaign_id: campaign.id,
          recipient_type: ep.user_id ? 'user' : 'guest',
          recipient_id: ep.user_id || null,
          endpoint_id: ep.id,
          channel_type: ep.channel_type || 'fcm',
          delivery_status: 'pending',
        }));

        const { error: insertErr } = await supabase
          .from('notification_deliveries')
          .insert(deliveryRows);

        if (!insertErr) {
          deliveryCount = deliveryRows.length;
        }
      }

      await supabase
        .from('notification_campaigns')
        .update({
          status: 'processing',
          total_recipients: deliveryCount,
          total_deliveries: deliveryCount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaign.id);

      promotedCampaigns.push({
        campaign_id: campaign.id,
        status: 'processing',
        total_recipients: deliveryCount,
        total_deliveries: deliveryCount,
      });
    } catch (itemErr) {
      console.warn(`[ScheduledCampaignService] Fallback item error for ${campaign.id}:`, itemErr.message);
    }
  }

  return {
    promoted_count: promotedCampaigns.length,
    campaigns: promotedCampaigns,
    fallback_executed: true,
  };
}



