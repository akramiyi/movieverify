/**
 * GET /api/notifications/preferences
 * POST /api/notifications/preferences
 * 
 * Secure endpoint for managing canonical user notification preferences (`user_notification_preferences`)
 * while keeping legacy `notification_opt_outs` synchronized without state drift.
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

const CATEGORY_TO_COLUMN = {
  movie_release: 'notify_new_movies',
  content_update: 'notify_movie_updates',
  user_alert: 'notify_system',
  admin_announcement: 'notify_system',
  promotional: 'notify_promotions',
};

const BOOLEAN_PREFERENCE_FIELDS = [
  'opt_in_all',
  'notify_new_movies',
  'notify_new_series',
  'notify_movie_updates',
  'notify_promotions',
  'notify_system',
  'channel_in_app',
  'channel_push',
  'channel_email',
  'quiet_hours_enabled',
];

export const DEFAULT_PREFERENCES = Object.freeze({
  opt_in_all: true,
  notify_new_movies: true,
  notify_new_series: true,
  notify_movie_updates: true,
  notify_promotions: false,
  notify_system: true,
  channel_in_app: true,
  channel_push: true,
  channel_email: false,
  quiet_hours_enabled: false,
  quiet_hours_start: null,
  quiet_hours_end: null,
  quiet_hours_tz: 'UTC',
  max_daily_push: 5,
});

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function isValidIanaTimeZone(tz) {
  if (typeof tz !== 'string') return false;
  const trimmed = tz.trim();
  if (!trimmed || trimmed.length > 64) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

function normalizePreferencesRow(row, legacyOptOutCategories = []) {
  const base = { ...DEFAULT_PREFERENCES };

  if (row) {
    for (const key of BOOLEAN_PREFERENCE_FIELDS) {
      if (typeof row[key] === 'boolean') {
        base[key] = row[key];
      }
    }
    base.quiet_hours_start = row.quiet_hours_start ?? null;
    base.quiet_hours_end = row.quiet_hours_end ?? null;
    base.quiet_hours_tz = typeof row.quiet_hours_tz === 'string' && row.quiet_hours_tz.trim()
      ? row.quiet_hours_tz.trim()
      : 'UTC';
    if (Number.isInteger(row.max_daily_push) && row.max_daily_push >= 1 && row.max_daily_push <= 50) {
      base.max_daily_push = row.max_daily_push;
    }
    return base;
  }

  for (const cat of legacyOptOutCategories) {
    const col = CATEGORY_TO_COLUMN[cat];
    if (col) {
      base[col] = false;
    }
  }
  return base;
}

function deriveCategories(preferences, optOutCategories = []) {
  const optOutSet = new Set(optOutCategories);
  return ALLOWED_CATEGORIES.map((cat) => {
    const col = CATEGORY_TO_COLUMN[cat];
    let enabled = Boolean(preferences[col]);
    if ((cat === 'user_alert' || cat === 'admin_announcement') && optOutSet.has(cat)) {
      enabled = false;
    }
    return {
      category: cat,
      enabled,
    };
  });
}

function buildOptOutState(preferences, currentOptOuts = []) {
  const currentSet = new Set(currentOptOuts);
  const toDelete = [];
  const toUpsert = [];

  for (const cat of ['movie_release', 'content_update', 'promotional']) {
    const col = CATEGORY_TO_COLUMN[cat];
    if (preferences[col]) {
      if (currentSet.has(cat)) toDelete.push(cat);
    } else if (!currentSet.has(cat)) {
      toUpsert.push(cat);
    }
  }

  for (const cat of ['user_alert', 'admin_announcement']) {
    if (preferences.notify_system) {
      if (currentSet.has(cat)) toDelete.push(cat);
    } else if (!currentSet.has(cat)) {
      toUpsert.push(cat);
    }
  }

  return { toDelete, toUpsert };
}

async function syncOptOutRows(supabase, userId, toDelete, toUpsert) {
  for (const cat of toDelete) {
    const { error } = await supabase
      .from('notification_opt_outs')
      .delete()
      .eq('user_id', userId)
      .eq('category', cat);
    if (error) return error;
  }

  for (const cat of toUpsert) {
    const { error } = await supabase
      .from('notification_opt_outs')
      .upsert(
        { user_id: userId, category: cat, reason: 'user_preference' },
        { onConflict: 'user_id,category' }
      );
    if (error) return error;
  }

  return null;
}

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

  // 2. GET: Retrieve canonical user preferences and synchronized category view
  if (method === 'GET') {
    try {
      const [prefResult, optOutResult] = await Promise.all([
        supabase
          .from('user_notification_preferences')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('notification_opt_outs')
          .select('category')
          .eq('user_id', user.id),
      ]);

      if (prefResult.error) {
        console.error('[Preferences API] Error fetching canonical preferences:', prefResult.error.message);
        return sendJson(res, 500, { error: 'Failed to retrieve notification preferences.' });
      }

      if (optOutResult.error) {
        console.error('[Preferences API] Error fetching opt-outs:', optOutResult.error.message);
        return sendJson(res, 500, { error: 'Failed to retrieve notification preferences.' });
      }

      const optOutCategories = (optOutResult.data || []).map((row) => row.category);
      const preferences = normalizePreferencesRow(prefResult.data, optOutCategories);
      const categories = deriveCategories(preferences, optOutCategories);
      const channelCapabilities = { in_app: true, push: true, email: false };
      const channelWarnings = preferences.channel_email
        ? ['Email notification delivery is not supported in this deployment; in-app inbox and push alerts remain active.']
        : [];

      return sendJson(res, 200, {
        preferences,
        opt_outs: categories.filter((c) => !c.enabled).map((c) => c.category),
        categories,
        channel_capabilities: channelCapabilities,
        warnings: channelWarnings,
      });
    } catch (err) {
      console.error('[Preferences API] Unexpected error on GET:', err.message);
      return sendJson(res, 500, { error: 'Internal Server Error' });
    }
  }

  // 3. POST: Update canonical preferences and/or toggle category preference without drift
  if (method === 'POST') {
    const body = (await parseJsonBody(req)) || {};
    const hasCategoryToggle = body.category !== undefined;
    const rawPatch = body.preferences && typeof body.preferences === 'object' ? body.preferences : body;

    if (hasCategoryToggle && !ALLOWED_CATEGORIES.includes(body.category)) {
      return sendJson(res, 400, {
        error: `Invalid category "${body.category}". Allowed: ${ALLOWED_CATEGORIES.join(', ')}`,
      });
    }

    if (hasCategoryToggle && typeof body.enabled !== 'boolean') {
      return sendJson(res, 400, {
        error: 'Field "enabled" must be a boolean when updating a category.',
      });
    }

    const patchKeys = Object.keys(rawPatch).filter(
      (k) =>
        BOOLEAN_PREFERENCE_FIELDS.includes(k) ||
        k === 'quiet_hours_start' ||
        k === 'quiet_hours_end' ||
        k === 'quiet_hours_tz' ||
        k === 'max_daily_push'
    );

    if (!hasCategoryToggle && patchKeys.length === 0) {
      return sendJson(res, 400, {
        error: 'Provide either { category, enabled } or canonical preference fields.',
      });
    }

    // Validate canonical patch fields
    for (const key of BOOLEAN_PREFERENCE_FIELDS) {
      if (rawPatch[key] !== undefined && typeof rawPatch[key] !== 'boolean') {
        return sendJson(res, 400, { error: `Field "${key}" must be a boolean.` });
      }
    }

    if (rawPatch.max_daily_push !== undefined) {
      const cap = Number(rawPatch.max_daily_push);
      if (!Number.isInteger(cap) || cap < 1 || cap > 50) {
        return sendJson(res, 400, {
          error: 'Field "max_daily_push" must be an integer between 1 and 50.',
        });
      }
    }

    if (rawPatch.quiet_hours_tz !== undefined) {
      if (!isValidIanaTimeZone(rawPatch.quiet_hours_tz)) {
        return sendJson(res, 400, {
          error: 'Field "quiet_hours_tz" must be a valid IANA timezone identifier (e.g. UTC, America/New_York).',
        });
      }
    }

    for (const timeField of ['quiet_hours_start', 'quiet_hours_end']) {
      if (rawPatch[timeField] !== undefined && rawPatch[timeField] !== null) {
        if (typeof rawPatch[timeField] !== 'string' || !TIME_REGEX.test(rawPatch[timeField].trim())) {
          return sendJson(res, 400, { error: `Field "${timeField}" must be a valid HH:MM time.` });
        }
      }
    }

    try {
      const [prefResult, optOutResult] = await Promise.all([
        supabase
          .from('user_notification_preferences')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('notification_opt_outs')
          .select('category')
          .eq('user_id', user.id),
      ]);

      if (prefResult.error) {
        console.error('[Preferences API] Error loading existing preferences:', prefResult.error.message);
        return sendJson(res, 500, { error: prefResult.error.message });
      }
      if (optOutResult.error) {
        console.error('[Preferences API] Error loading existing opt-outs:', optOutResult.error.message);
        return sendJson(res, 500, { error: optOutResult.error.message });
      }

      const existingOptOuts = (optOutResult.data || []).map((r) => r.category);
      const nextPrefs = normalizePreferencesRow(prefResult.data, existingOptOuts);

      for (const key of BOOLEAN_PREFERENCE_FIELDS) {
        if (rawPatch[key] !== undefined) {
          nextPrefs[key] = rawPatch[key];
        }
      }
      if (rawPatch.quiet_hours_start !== undefined) {
        nextPrefs.quiet_hours_start = rawPatch.quiet_hours_start ? rawPatch.quiet_hours_start.trim() : null;
      }
      if (rawPatch.quiet_hours_end !== undefined) {
        nextPrefs.quiet_hours_end = rawPatch.quiet_hours_end ? rawPatch.quiet_hours_end.trim() : null;
      }
      if (rawPatch.quiet_hours_tz !== undefined) {
        nextPrefs.quiet_hours_tz = rawPatch.quiet_hours_tz.trim();
      }
      if (rawPatch.max_daily_push !== undefined) {
        nextPrefs.max_daily_push = Number(rawPatch.max_daily_push);
      }

      let nextOptOuts = [...existingOptOuts];

      if (hasCategoryToggle) {
        const { category, enabled } = body;
        const mappedColumn = CATEGORY_TO_COLUMN[category];

        if (category === 'user_alert' || category === 'admin_announcement') {
          if (enabled) {
            nextOptOuts = nextOptOuts.filter((c) => c !== category);
            nextPrefs.notify_system = true;
          } else {
            if (!nextOptOuts.includes(category)) nextOptOuts.push(category);
            const otherSysCat = category === 'user_alert' ? 'admin_announcement' : 'user_alert';
            // Keep notify_system aligned only when no system category remains enabled
            if (nextOptOuts.includes(otherSysCat)) {
              nextPrefs.notify_system = false;
            }
          }
        } else {
          nextPrefs[mappedColumn] = enabled;
          nextOptOuts = enabled
            ? nextOptOuts.filter((c) => c !== category)
            : Array.from(new Set([...nextOptOuts, category]));
        }
      }

      if (nextPrefs.quiet_hours_enabled && (!nextPrefs.quiet_hours_start || !nextPrefs.quiet_hours_end)) {
        return sendJson(res, 400, {
          error: 'quiet_hours_start and quiet_hours_end are required when quiet_hours_enabled is true.',
        });
      }

      // Compute final opt-out reconciliation for legacy table, run BEFORE canonical upsert
      // so trg_sync_opt_out_to_preferences cannot overwrite canonical values.
      const { toDelete, toUpsert } = hasCategoryToggle
        ? {
            toDelete: existingOptOuts.filter((c) => !nextOptOuts.includes(c)),
            toUpsert: nextOptOuts.filter((c) => !existingOptOuts.includes(c)),
          }
        : buildOptOutState(nextPrefs, existingOptOuts);

      const optOutErr = await syncOptOutRows(supabase, user.id, toDelete, toUpsert);
      if (optOutErr) {
        console.error('[Preferences API] Error syncing opt-outs:', optOutErr.message);
        return sendJson(res, 500, { error: optOutErr.message });
      }

      const upsertPayload = {
        user_id: user.id,
        ...nextPrefs,
        updated_at: new Date().toISOString(),
      };

      const { data: savedRow, error: upsertError } = await supabase
        .from('user_notification_preferences')
        .upsert(upsertPayload, { onConflict: 'user_id' })
        .select()
        .single();

      if (upsertError) {
        console.error('[Preferences API] Error updating canonical preferences:', upsertError.message);
        return sendJson(res, 500, { error: upsertError.message });
      }

      const savedPrefs = normalizePreferencesRow(savedRow || upsertPayload, nextOptOuts);
      const finalOptOuts = hasCategoryToggle ? nextOptOuts : existingOptOuts.filter((c) => !toDelete.includes(c)).concat(toUpsert);
      const categories = deriveCategories(savedPrefs, finalOptOuts);

      const channelCapabilities = { in_app: true, push: true, email: false };
      const channelWarnings = savedPrefs.channel_email
        ? ['Email notification delivery is not supported in this deployment; in-app inbox and push alerts remain active.']
        : [];

      const responseBody = {
        success: true,
        preferences: savedPrefs,
        opt_outs: categories.filter((c) => !c.enabled).map((c) => c.category),
        categories,
        channel_capabilities: channelCapabilities,
        warnings: channelWarnings,
      };

      if (hasCategoryToggle) {
        responseBody.category = body.category;
        responseBody.enabled = body.enabled;
      }

      return sendJson(res, 200, responseBody);
    } catch (err) {
      console.error('[Preferences API] Unexpected error on POST:', err.message);
      return sendJson(res, 500, { error: 'Internal Server Error' });
    }
  }
}

