/**
 * Helpers for resolving and parsing notification deep-link URLs.
 * Supports canonical `action_url` from `public.user_notifications` while
 * preserving backward compatibility with legacy `url` properties.
 */

/**
 * Resolve the navigation target URL from a notification inbox item.
 * @param {object|null|undefined} item Notification item
 * @returns {string|null} Trimmed URL string or null if absent
 */
export function resolveNotificationTargetUrl(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  for (const candidate of [item.action_url, item.url]) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return null;
}

/**
 * Parse a notification deep-link URL into a title selection object for `onSelectMovie`.
 * @param {string} targetUrl Deep-link URL string
 * @param {string} [title=''] Notification title fallback
 * @returns {{ id: string, title: string, mediaType?: 'movie'|'tv', media_type?: 'movie'|'tv' } | null}
 */
export function parseNotificationMovieLink(targetUrl, title = '') {
  if (!targetUrl || typeof targetUrl !== 'string') {
    return null;
  }

  try {
    const parsed = new URL(targetUrl, 'https://movieverify.local');
    if (parsed.origin !== 'https://movieverify.local') {
      return null;
    }

    const rawId = parsed.searchParams.get('id');
    if (!rawId) {
      return null;
    }

    const cleanId = rawId.split('-')[0].trim();
    if (!/^[0-9a-zA-Z_]+$/.test(cleanId)) {
      return null;
    }

    const rawType = parsed.searchParams.get('type')?.toLowerCase().trim();
    const mediaType = rawType === 'movie' || rawType === 'tv' ? rawType : null;

    return {
      id: cleanId,
      title,
      ...(mediaType ? { mediaType, media_type: mediaType } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Derive a deterministic idempotency key for catalog content updates from the saved snapshot.
 * Ensures duplicate clicks/network retries with identical links deduplicate, while distinct
 * link/season edits produce distinct campaign keys regardless of timestamp proximity.
 */
export function buildContentUpdateIdempotencyKey({
  tmdbId,
  mediaType = 'movie',
  link480 = '',
  link720 = '',
  link1080 = '',
  description = '',
  seasons = [],
} = {}) {
  const cleanId = String(tmdbId || '').split('-')[0].trim();
  const snapshot = JSON.stringify({
    mediaType: mediaType === 'tv' || mediaType === 'series' ? 'tv' : 'movie',
    link480: String(link480 || '').trim(),
    link720: String(link720 || '').trim(),
    link1080: String(link1080 || '').trim(),
    description: String(description || '').trim(),
    seasons: Array.isArray(seasons) ? seasons : [],
  });

  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < snapshot.length; i += 1) {
    const ch = snapshot.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (ch + i), 0x85ebca6b) >>> 0;
  }

  const digest = `${h1.toString(36).padStart(7, '0')}${h2.toString(36).padStart(7, '0')}`;
  return `catalog:content_update:${cleanId}:${digest}`.slice(0, 128);
}
