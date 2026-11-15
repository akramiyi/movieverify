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

        // Also populate in-app user notifications for registered recipients
        const userEndpoints = endpoints.filter((ep) => ep.user_id);
        if (userEndpoints.length > 0) {
          const userRows = userEndpoints.map((ep) => ({
            user_id: ep.user_id,
            campaign_id: campaign.id,
            title: campaign.title,
            body: campaign.body,
            category: campaign.category || 'movie_release',
            url: campaign.url || '/',
            is_read: false,
          }));
          await supabase.from('user_notifications').insert(userRows).catch(() => {});
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

/**
 * Smart Distributed Notification Slots (IST / UTC+05:30)
 * Designed to eliminate spam bursts by distributing notifications across waking daytime hours
 * with 3.5 to 5.5 hours of breathing space.
 *
 * Quiet Hours: 10:00 PM to 08:00 AM IST (Strict DND - No pushes sent!)
 *
 * Slots:
 * - 08:30 AM IST (Morning Spotlight) -> 03:00 UTC
 * - 01:30 PM IST (Afternoon Premiere) -> 08:00 UTC
 * - 06:00 PM IST (Evening Prime) -> 12:30 UTC
 * - 08:45 PM IST (Night Watchlist) -> 15:15 UTC
 */
export const SMART_DAYTIME_SLOTS_IST = [
  { id: 'morning', hourIST: 8, minuteIST: 30, timeStr: '08:30 AM IST', utcSlot: '03:00:00.000Z', label: 'Morning Spotlight' },
  { id: 'afternoon', hourIST: 13, minuteIST: 30, timeStr: '01:30 PM IST', utcSlot: '08:00:00.000Z', label: 'Afternoon Premiere' },
  { id: 'evening', hourIST: 18, minuteIST: 0, timeStr: '06:00 PM IST', utcSlot: '12:30:00.000Z', label: 'Evening Prime' },
  { id: 'night', hourIST: 20, minuteIST: 45, timeStr: '08:45 PM IST', utcSlot: '15:15:00.000Z', label: 'Night Watchlist' },
];

export const MORNING_SLOTS_IST = SMART_DAYTIME_SLOTS_IST;
export const MAX_DAILY_NOTIFICATIONS = 3;

export const CATEGORY_CONFIG_CAMPAIGN_ID = '00000000-0000-4000-8000-000000000002';

export const DEFAULT_CATEGORY_SETTINGS = Object.freeze({
  south_movie: true,
  bollywood_movie: true,
  hollywood_movie: true,
  hindi_series: true,
  hollywood_series: true,
});

/**
 * Retrieve admin category notification access settings from Supabase.
 *
 * @param {object|null} customSupabase
 * @returns {Promise<{ categories: object, disabled_categories: string[] }>}
 */
export async function getAdminCategorySettings(customSupabase = null) {
  const supabase = getSupabaseServerClient(customSupabase);
  try {
    if (typeof supabase?.from === 'function') {
      const { data, error } = await supabase
        .from('notification_campaigns')
        .select('target_criteria')
        .eq('id', CATEGORY_CONFIG_CAMPAIGN_ID)
        .maybeSingle();

      if (!error && data?.target_criteria?.categories) {
        const disabled = Array.isArray(data.target_criteria.disabled_categories)
          ? data.target_criteria.disabled_categories
          : Object.keys(data.target_criteria.categories).filter((k) => data.target_criteria.categories[k] === false);

        return {
          categories: { ...DEFAULT_CATEGORY_SETTINGS, ...data.target_criteria.categories },
          disabled_categories: disabled,
        };
      }
    }
  } catch (err) {
    console.warn('[CategorySettings] Error fetching category settings:', err.message);
  }

  return {
    categories: { ...DEFAULT_CATEGORY_SETTINGS },
    disabled_categories: [],
  };
}

/**
 * Update admin category notification access settings in Supabase.
 * When a category is disabled, automatically cancels any existing scheduled/queued
 * campaigns matching that category to prevent further push alerts.
 *
 * @param {object|null} customSupabase
 * @param {{ disabledCategories?: string[], categories?: object }} params
 * @returns {Promise<{ categories: object, disabled_categories: string[], cancelled_campaigns_count: number }>}
 */
export async function updateAdminCategorySettings(customSupabase = null, { disabledCategories, categories = {} } = {}) {
  const supabase = getSupabaseServerClient(customSupabase);
  const normalizedCategories = { ...DEFAULT_CATEGORY_SETTINGS, ...(categories || {}) };

  const disabledList = Array.isArray(disabledCategories)
    ? [...new Set(disabledCategories)]
    : Object.keys(normalizedCategories).filter((k) => normalizedCategories[k] === false);

  for (const cat of Object.keys(normalizedCategories)) {
    normalizedCategories[cat] = !disabledList.includes(cat);
  }

  const payload = {
    disabled_categories: disabledList,
    categories: normalizedCategories,
    updated_at: new Date().toISOString(),
  };

  if (typeof supabase?.from === 'function') {
    const { error: upsertErr } = await supabase
      .from('notification_campaigns')
      .upsert(
        {
          id: CATEGORY_CONFIG_CAMPAIGN_ID,
          title: 'Auto Release Notification Category Settings',
          body: 'System setting for enabled/disabled release alert categories',
          category: 'system',
          target_type: 'all',
          target_criteria: payload,
          status: 'completed',
          priority: 0,
          total_recipients: 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );

    if (upsertErr) {
      console.warn('[CategorySettings] Error saving category settings:', upsertErr.message);
    }
  }

  // If any categories were disabled, cancel matching active scheduled campaigns
  let cancelledCount = 0;
  if (disabledList.length > 0 && typeof supabase?.from === 'function') {
    try {
      const { data: matched } = await supabase
        .from('notification_campaigns')
        .select('id, target_criteria')
        .in('status', ['scheduled', 'queued']);

      const idsToCancel = (matched || [])
        .filter((c) => c.target_criteria && disabledList.includes(c.target_criteria.release_category))
        .map((c) => c.id);

      if (idsToCancel.length > 0) {
        cancelledCount = idsToCancel.length;
        await supabase
          .from('notification_campaigns')
          .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
          .in('id', idsToCancel);

        await supabase
          .from('notification_deliveries')
          .update({ delivery_status: 'cancelled', updated_at: new Date().toISOString() })
          .in('campaign_id', idsToCancel)
          .eq('delivery_status', 'pending');
      }
    } catch (cancelErr) {
      console.warn('[CategorySettings] Error cancelling scheduled campaigns for disabled categories:', cancelErr.message);
    }
  }

  return {
    categories: normalizedCategories,
    disabled_categories: disabledList,
    cancelled_campaigns_count: cancelledCount,
  };
}

/**
 * Returns today's date formatted as 'YYYY-MM-DD' in Indian Standard Time (UTC+05:30)
 * @param {Date} [refDate]
 * @returns {string}
 */
export function getTodayIST(refDate = new Date()) {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(refDate.getTime() + istOffsetMs);
  return istDate.toISOString().split('T')[0];
}

/**
 * Checks if current time is within Quiet Hours (10:00 PM to 08:00 AM IST)
 * @param {Date} [refDate]
 * @returns {boolean}
 */
export function isQuietHoursIST(refDate = new Date()) {
  const istHours = (refDate.getUTCHours() + 5 + Math.floor((refDate.getUTCMinutes() + 30) / 60)) % 24;
  return istHours >= 22 || istHours < 8; // 10 PM to 8 AM IST
}

/**
 * Calculate scheduled ISO timestamp for a release date and slot index
 *
 * @param {string} releaseDateStr 'YYYY-MM-DD'
 * @param {number} slotIndex 0-based index of movie on that release date
 * @returns {{ scheduled_for: string, slot_index: number, slot_time: string, slot_label: string, hour_ist: number, minute_ist: number }}
 */
export function getScheduledSlotForRelease(releaseDateStr, slotIndex = 0) {
  if (!releaseDateStr || typeof releaseDateStr !== 'string') {
    throw new Error('releaseDateStr must be a non-empty string in YYYY-MM-DD format.');
  }
  const cleanDate = releaseDateStr.trim().split('T')[0];
  const safeIndex = Math.min(Math.abs(parseInt(slotIndex, 10) || 0), SMART_DAYTIME_SLOTS_IST.length - 1);
  const slot = SMART_DAYTIME_SLOTS_IST[safeIndex];
  const scheduledIso = `${cleanDate}T${slot.utcSlot}`;

  return {
    scheduled_for: scheduledIso,
    slot_index: safeIndex,
    slot_time: slot.timeStr,
    slot_label: slot.label,
    hour_ist: slot.hourIST,
    minute_ist: slot.minuteIST,
  };
}

/**
 * Fetches upcoming releases across Bollywood, South Indian, Hollywood, and Web Series
 *
 * @param {object} options Optional custom fetcher or release items (for testing/overrides)
 * @returns {Promise<Array<object>>}
 */
export async function fetchServerUpcomingReleases(options = {}) {
  if (typeof options.fetchUpcomingReleases === 'function') {
    return options.fetchUpcomingReleases();
  }
  if (Array.isArray(options.releases)) {
    return options.releases;
  }

  const serverToken =
    process.env.TMDB_READ_TOKEN ||
    process.env.TMDB_TOKEN ||
    process.env.TMDB_API_KEY ||
    process.env.VITE_TMDB_API_KEY ||
    process.env.VITE_TMDB_READ_TOKEN;

  const isBearer = serverToken && serverToken.length > 50;
  const headers = {
    Accept: 'application/json',
    ...(isBearer ? { Authorization: `Bearer ${serverToken}` } : {}),
  };

  const fetchJson = async (endpoint) => {
    try {
      const sep = endpoint.includes('?') ? '&' : '?';
      const url = isBearer
        ? `https://api.themoviedb.org/3${endpoint}`
        : (serverToken
          ? `https://api.themoviedb.org/3${endpoint}${sep}api_key=${encodeURIComponent(serverToken)}`
          : `https://movieverify-backend.onrender.com/api/tmdb${endpoint}`);

      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), 6000) : null;

      const r = await fetch(url, {
        headers,
        signal: controller ? controller.signal : undefined,
      }).catch(() => null);

      if (timeoutId) clearTimeout(timeoutId);
      if (!r || !r.ok) return { results: [] };
      return await r.json();
    } catch {
      return { results: [] };
    }
  };

  const today = getTodayIST();
  const future = new Date(Date.now() + 5.5 * 3600 * 1000 + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const queries = [
    {
      endpoint: `/discover/movie?with_original_language=hi&region=IN&primary_release_date.gte=${today}&primary_release_date.lte=${future}&sort_by=primary_release_date.asc&page=1`,
      mediaType: 'movie',
      cat: 'bollywood_movie',
      label: 'Bollywood',
    },
    {
      endpoint: `/discover/movie?with_original_language=te&region=IN&primary_release_date.gte=${today}&primary_release_date.lte=${future}&sort_by=primary_release_date.asc&page=1`,
      mediaType: 'movie',
      cat: 'south_movie',
      label: 'South Movies',
    },
    {
      endpoint: `/discover/movie?with_original_language=ta&region=IN&primary_release_date.gte=${today}&primary_release_date.lte=${future}&sort_by=primary_release_date.asc&page=1`,
      mediaType: 'movie',
      cat: 'south_movie',
      label: 'South Movies',
    },
    {
      endpoint: `/discover/movie?with_original_language=en&region=US&primary_release_date.gte=${today}&primary_release_date.lte=${future}&sort_by=primary_release_date.asc&page=1`,
      mediaType: 'movie',
      cat: 'hollywood_movie',
      label: 'Hollywood',
    },
    {
      endpoint: `/discover/tv?with_original_language=hi&first_air_date.gte=${today}&first_air_date.lte=${future}&sort_by=first_air_date.asc&page=1`,
      mediaType: 'tv',
      cat: 'hindi_series',
      label: 'Hindi Web Series',
    },
    {
      endpoint: `/discover/tv?with_original_language=en&first_air_date.gte=${today}&first_air_date.lte=${future}&sort_by=first_air_date.asc&page=1`,
      mediaType: 'tv',
      cat: 'hollywood_series',
      label: 'Hollywood Series',
    },
  ];

  try {
    const results = await Promise.all(
      queries.map(async (q) => {
        const data = await fetchJson(q.endpoint);
        return (data.results || []).map((item) => ({
          ...item,
          media_type: q.mediaType,
          release_category: q.cat,
          industry_label: q.label,
          release_date: item.release_date || item.first_air_date,
        }));
      })
    );

    const flat = results.flat();
    const seen = new Set();
    const deduped = [];

    for (const item of flat) {
      const key = `${item.media_type}_${item.id}`;
      if (item.id && !seen.has(key) && (item.title || item.name) && item.release_date) {
        seen.add(key);
        deduped.push({
          id: item.id,
          title: item.title || item.name,
          release_date: item.release_date,
          media_type: item.media_type,
          release_category: item.release_category,
          industry_label: item.industry_label,
          overview: item.overview || '',
          poster_path: item.poster_path,
          backdrop_path: item.backdrop_path,
        });
      }
    }

    return deduped.sort((a, b) => new Date(a.release_date) - new Date(b.release_date));
  } catch (err) {
    console.warn('[ScheduledCampaignService] fetchServerUpcomingReleases error:', err.message);
    return [];
  }
}

/**
 * Automatically ingests upcoming movie & web series releases into the notification queue
 * with 4-slot morning staggering (7, 8, 9, 10 AM IST) without requiring admin approval.
 *
 * @param {object|null} customSupabase Optional Supabase client override
 * @param {object} options Optional fetcher or settings override
 * @returns {Promise<{ ingested_count: number, skipped_count: number, releases: Array<object>, error?: string }>}
 */
export async function autoIngestUpcomingReleases(customSupabase = null, options = {}) {
  const supabase = getSupabaseServerClient(customSupabase);

  // 1. Fetch upcoming releases from TMDB (or injected test options)
  let releases = [];
  try {
    releases = await fetchServerUpcomingReleases(options);
  } catch (err) {
    console.warn('[AutoIngest] Error fetching upcoming releases:', err.message);
    return { ingested_count: 0, skipped_count: 0, releases: [], error: err.message };
  }

  if (!Array.isArray(releases) || releases.length === 0) {
    return { ingested_count: 0, skipped_count: 0, releases: [] };
  }

  // 2. Query existing campaigns to prevent duplicates and calculate slot distribution
  let existingCampaigns = [];
  try {
    if (typeof supabase?.from === 'function') {
      const { data, error } = await supabase
        .from('notification_campaigns')
        .select('id, target_criteria, scheduled_for, status')
        .neq('status', 'cancelled')
        .limit(500);

      if (!error && Array.isArray(data)) {
        existingCampaigns = data;
      }
    }
  } catch (err) {
    console.warn('[AutoIngest] Error querying existing campaigns:', err.message);
  }

  const existingKeys = new Set();
  const moviesPerDateCount = {};

  for (const c of existingCampaigns) {
    const crit = c.target_criteria || {};
    if (crit.idempotency_key) {
      existingKeys.add(String(crit.idempotency_key));
    }
    const mediaType = crit.media_type || (crit.series_id ? 'tv' : 'movie');
    const targetId = crit.tmdb_id || crit.movie_id || crit.series_id;
    if (targetId && c.scheduled_for) {
      const dateStr = String(c.scheduled_for).split('T')[0];
      existingKeys.add(`auto_rel_${mediaType}_${targetId}_${dateStr}`);
    }
    if (c.scheduled_for) {
      const dateStr = String(c.scheduled_for).split('T')[0];
      moviesPerDateCount[dateStr] = (moviesPerDateCount[dateStr] || 0) + 1;
    }
  }

  const ingested = [];
  let skippedCount = 0;
  const todayIST = getTodayIST();

  // Load Admin Category Settings (which categories are enabled vs disabled)
  let disabledCategories = new Set(options.disabledCategories || []);
  if (options.disabledCategories === undefined && options.categorySettings?.disabled_categories) {
    disabledCategories = new Set(options.categorySettings.disabled_categories);
  } else if (options.disabledCategories === undefined && typeof supabase?.from === 'function') {
    try {
      const catSettings = await getAdminCategorySettings(supabase);
      disabledCategories = new Set(catSettings.disabled_categories || []);
    } catch (catErr) {
      console.warn('[AutoIngest] Error reading category settings:', catErr.message);
    }
  }

  for (const item of releases) {
    const mediaType = item.media_type || (item.first_air_date ? 'tv' : 'movie');
    const releaseDate = (item.release_date || item.first_air_date || '').split('T')[0];
    const itemId = String(item.id);
    const category = item.release_category || (mediaType === 'tv' ? 'hindi_series' : 'bollywood_movie');

    if (!releaseDate || !itemId) {
      continue;
    }

    // Strict Future-Release Guard: Never schedule or send retrospective push alerts for past dates!
    if (releaseDate < todayIST) {
      skippedCount++;
      continue;
    }

    // Category Filter Guard: Skip release alerts for categories muted by Admin!
    if (disabledCategories.has(category)) {
      skippedCount++;
      continue;
    }

    // Anti-Spam Daily Cap: Never schedule more than MAX_DAILY_NOTIFICATIONS (3) individual alerts per date
    const countOnDate = moviesPerDateCount[releaseDate] || 0;
    if (countOnDate >= MAX_DAILY_NOTIFICATIONS) {
      skippedCount++;
      continue;
    }

    const idempotencyKey = `auto_rel_${mediaType}_${itemId}_${releaseDate}`;
    if (existingKeys.has(idempotencyKey)) {
      skippedCount++;
      continue;
    }

    // Determine distributed daytime slot (08:30 AM, 01:30 PM, 06:00 PM, 08:45 PM IST)
    const slotInfo = getScheduledSlotForRelease(releaseDate, countOnDate);
    moviesPerDateCount[releaseDate] = countOnDate + 1;
    existingKeys.add(idempotencyKey);

    const isTv = mediaType === 'tv';
    const title = item.title || item.name || 'Untitled';
    const isTodayOrPast = releaseDate <= new Date().toISOString().split('T')[0];
    const actionText = isTv ? 'Streaming' : 'Releasing';
    const alertHeader = isTv ? 'New Web Series Alert' : 'Big Screen Alert';
    const catLabel = item.industry_label || (isTv ? 'Web Series' : 'Movie');

    const posterImage = item.backdrop_path
      ? `https://image.tmdb.org/t/p/w780${String(item.backdrop_path).startsWith('/') ? '' : '/'}${item.backdrop_path}`
      : (item.poster_path
        ? `https://image.tmdb.org/t/p/w500${String(item.poster_path).startsWith('/') ? '' : '/'}${item.poster_path}`
        : 'https://movieverify.vercel.app/og-fallback.jpg');

    const campaignPayload = {
      title: `${isTv ? '📺' : '🎬'} ${title} - ${actionText} ${isTodayOrPast ? 'Today!' : 'Soon'}`,
      body: `${alertHeader}: ${title} (${catLabel}) is scheduled for ${isTv ? 'streaming' : 'theatrical release'} on ${releaseDate}. Add it to your watchlist now to verify and watch instantly!`,
      category: isTv ? 'content_update' : 'movie_release',
      url: `/?type=${mediaType}&id=${itemId}`,
      image_url: posterImage,
      scheduled_for: slotInfo.scheduled_for,
      target_criteria: {
        type: 'all',
        tmdb_id: itemId,
        movie_id: itemId,
        series_id: itemId,
        media_type: mediaType,
        release_category: category,
        industry_label: catLabel,
        idempotency_key: idempotencyKey,
        release_slot: slotInfo.slot_time,
        auto_scheduled: true,
      },
    };

    let insertedId = null;
    let insertStatus = 'scheduled';

    // Try canonical RPC ingest_notification_campaign first
    if (typeof supabase.rpc === 'function') {
      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('ingest_notification_campaign', {
          p_title: campaignPayload.title,
          p_body: campaignPayload.body,
          p_category: campaignPayload.category,
          p_url: campaignPayload.url,
          p_image_url: campaignPayload.image_url,
          p_target_criteria: campaignPayload.target_criteria,
          p_scheduled_for: campaignPayload.scheduled_for,
          p_created_by: null,
        });

        if (!rpcErr && rpcData?.campaign_id) {
          insertedId = rpcData.campaign_id;
          insertStatus = rpcData.status || 'scheduled';
        }
      } catch {
        // Fallback to direct table insert
      }
    }

    // Direct table insert fallback if RPC is uninstalled or failed
    if (!insertedId && typeof supabase.from === 'function') {
      try {
        const { data: tblData, error: tblErr } = await supabase
          .from('notification_campaigns')
          .insert({
            title: campaignPayload.title,
            body: campaignPayload.body,
            category: campaignPayload.category,
            action_url: campaignPayload.url,
            image_url: campaignPayload.image_url,
            target_type: 'all',
            target_criteria: campaignPayload.target_criteria,
            status: 'scheduled',
            scheduled_for: campaignPayload.scheduled_for,
          })
          .select('id, status')
          .single();

        if (!tblErr && tblData?.id) {
          insertedId = tblData.id;
          insertStatus = tblData.status || 'scheduled';
        }
      } catch (insertErr) {
        console.warn(`[AutoIngest] Table insert failed for ${title}:`, insertErr.message);
      }
    }

    if (insertedId) {
      ingested.push({
        id: itemId,
        campaign_id: insertedId,
        title,
        media_type: mediaType,
        release_category: category,
        release_date: releaseDate,
        scheduled_for: slotInfo.scheduled_for,
        slot_time: slotInfo.slot_time,
        slot_label: slotInfo.slot_label,
        status: insertStatus,
      });
    }
  }

  return {
    ingested_count: ingested.length,
    skipped_count: skippedCount,
    releases: ingested,
  };
}




