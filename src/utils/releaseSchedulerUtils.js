/**
 * Smart Anti-Spam Release Scheduler & Real-Time Countdown Utilities
 *
 * Designed to prevent notification fatigue and spam bursts:
 * 1. Strict Future Ingestion Guard: Never sends retrospective push alerts for past releases.
 * 2. Quiet Hours (DND): 10:00 PM to 08:00 AM IST (No push notifications dispatched during sleep hours).
 * 3. 8 Daytime Distributed Windows:
 *    - 08:30 AM IST (Morning Spotlight)     -> 03:00 UTC
 *    - 10:30 AM IST (Late Morning Buzz)     -> 05:00 UTC
 *    - 12:15 PM IST (Midday Premiere)       -> 06:45 UTC
 *    - 02:00 PM IST (Afternoon Feature)     -> 08:30 UTC
 *    - 04:15 PM IST (Teatime Binge)         -> 10:45 UTC
 *    - 06:00 PM IST (Evening Prime)         -> 12:30 UTC
 *    - 07:45 PM IST (Sunset Blockbuster)    -> 14:15 UTC
 *    - 09:15 PM IST (Night Watchlist)       -> 15:45 UTC
 * 4. Multi-Movie Capping & Smart Distribution:
 *    - Max 8 push notifications per day distributed intelligently without overlap.
 */

export const SMART_DAYTIME_SLOTS_IST = [
  { id: 'morning_early', hourIST: 8, minuteIST: 30, timeStr: '08:30 AM IST', utcSlot: '03:00:00.000Z', label: 'Morning Spotlight' },
  { id: 'morning_late', hourIST: 10, minuteIST: 30, timeStr: '10:30 AM IST', utcSlot: '05:00:00.000Z', label: 'Late Morning Buzz' },
  { id: 'midday', hourIST: 12, minuteIST: 15, timeStr: '12:15 PM IST', utcSlot: '06:45:00.000Z', label: 'Midday Premiere' },
  { id: 'afternoon', hourIST: 14, minuteIST: 0, timeStr: '02:00 PM IST', utcSlot: '08:30:00.000Z', label: 'Afternoon Feature' },
  { id: 'teatime', hourIST: 16, minuteIST: 15, timeStr: '04:15 PM IST', utcSlot: '10:45:00.000Z', label: 'Teatime Binge' },
  { id: 'evening_prime', hourIST: 18, minuteIST: 0, timeStr: '06:00 PM IST', utcSlot: '12:30:00.000Z', label: 'Evening Prime' },
  { id: 'sunset', hourIST: 19, minuteIST: 45, timeStr: '07:45 PM IST', utcSlot: '14:15:00.000Z', label: 'Sunset Blockbuster' },
  { id: 'night_watchlist', hourIST: 21, minuteIST: 15, timeStr: '09:15 PM IST', utcSlot: '15:45:00.000Z', label: 'Night Watchlist' },
];

// Backward-compatible alias for 8 slots
export const MORNING_SLOTS_IST = SMART_DAYTIME_SLOTS_IST;

export const MAX_DAILY_NOTIFICATIONS = 8;

export const CATEGORY_CONFIG_CAMPAIGN_ID = '00000000-0000-4000-8000-000000000002';

export const DEFAULT_CATEGORY_SETTINGS = Object.freeze({
  south_movie: true,
  bollywood_movie: true,
  hollywood_movie: true,
  hindi_series: true,
  hollywood_series: true,
  anime: true,
  korean_drama: true,
  south_series: true,
  punjabi_movie: true,
  animated_family: true,
  turkish_pakistani_drama: true,
  documentary: true,
});

export const CATEGORY_METADATA = [
  {
    id: 'bollywood_movie',
    label: 'Bollywood Movies',
    sub: 'Hindi Cinema',
    icon: '🎬',
    color: 'from-orange-500/20 to-amber-500/20 border-orange-500/40 text-orange-300',
    description: 'Theatrical and direct-to-digital Hindi movie releases',
  },
  {
    id: 'hindi_series',
    label: 'Hindi Web Series',
    sub: 'Indian OTT Series',
    icon: '📺',
    color: 'from-purple-500/20 to-indigo-500/20 border-purple-500/40 text-purple-300',
    description: 'Hindi web series, OTT seasons and episodic premieres',
  },
  {
    id: 'south_movie',
    label: 'South Indian Movies',
    sub: 'Telugu, Tamil, Malayalam, Kannada',
    icon: '🎬',
    color: 'from-amber-500/20 to-yellow-500/20 border-amber-500/40 text-amber-300',
    description: 'Tollywood, Kollywood, Mollywood & Sandalwood big-screen releases',
  },
  {
    id: 'hollywood_movie',
    label: 'Hollywood Movies',
    sub: 'English & Global Cinema',
    icon: '🎬',
    color: 'from-blue-500/20 to-cyan-500/20 border-blue-500/40 text-blue-300',
    description: 'Global blockbusters, studio releases & Hollywood premieres',
  },
  {
    id: 'hollywood_series',
    label: 'Hollywood Web Series',
    sub: 'Global OTT Series',
    icon: '📺',
    color: 'from-emerald-500/20 to-teal-500/20 border-emerald-500/40 text-emerald-300',
    description: 'English international television, Netflix/HBO/Amazon originals',
  },
  {
    id: 'anime',
    label: 'Anime & Animation',
    sub: 'Japanese Anime Series & Films',
    icon: '🎌',
    color: 'from-pink-500/20 to-rose-500/20 border-pink-500/40 text-pink-300',
    description: 'Japanese anime premieres, trending manga adaptations and anime movies',
  },
  {
    id: 'korean_drama',
    label: 'Korean Dramas (K-Drama)',
    sub: 'K-Romance, Thrillers & Fantasy',
    icon: '🫰',
    color: 'from-violet-500/20 to-fuchsia-500/20 border-violet-500/40 text-violet-300',
    description: 'Korean series, K-Dramas and trending Korean web television',
  },
  {
    id: 'south_series',
    label: 'South Indian Web Series',
    sub: 'Telugu, Tamil, Malayalam & Kannada OTT',
    icon: '📺',
    color: 'from-lime-500/20 to-green-500/20 border-lime-500/40 text-lime-300',
    description: 'South Indian regional OTT series and multi-language episodic originals',
  },
  {
    id: 'punjabi_movie',
    label: 'Punjabi Movies (Pollywood)',
    sub: 'Punjabi Cinema & Comedy',
    icon: '👳',
    color: 'from-yellow-500/20 to-amber-500/20 border-yellow-500/40 text-yellow-300',
    description: 'Punjabi theatrical releases, Pollywood comedy and drama premieres',
  },
  {
    id: 'animated_family',
    label: 'Kids & Family Animated',
    sub: 'Disney, Pixar & 3D Animation',
    icon: '🧸',
    color: 'from-sky-500/20 to-cyan-500/20 border-sky-500/40 text-sky-300',
    description: 'Animated feature films, CGI adventures and family blockbusters',
  },
  {
    id: 'turkish_pakistani_drama',
    label: 'Turkish & Pakistani Dramas',
    sub: 'Urdu & Turkish Hit Series',
    icon: '🌙',
    color: 'from-teal-500/20 to-emerald-500/20 border-teal-500/40 text-teal-300',
    description: 'Urdu television dramas and Turkish historical and romantic series',
  },
  {
    id: 'documentary',
    label: 'Documentaries & True Crime',
    sub: 'Biopics, Nature & Mystery Docs',
    icon: '🕵️',
    color: 'from-zinc-500/20 to-neutral-500/20 border-zinc-500/40 text-zinc-300',
    description: 'True-crime investigations, nature series, sports and history documentaries',
  },
];

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
 * Assigns one of the distributed daytime slots (08:30 AM, 01:30 PM, 06:00 PM, 08:45 PM IST)
 * based on how many campaigns are already scheduled on that release date.
 *
 * @param {string} releaseDate 'YYYY-MM-DD'
 * @param {Array} existingCampaigns Array of existing campaigns
 * @returns {{ scheduled_for: string, slot_time: string, slot_index: number, slot_label: string }}
 */
export const getSlotForRelease = (releaseDate, existingCampaigns = []) => {
  const cleanDate = (releaseDate || getTodayIST()).split('T')[0];
  const countOnDate = (existingCampaigns || []).filter(
    (c) => c && c.scheduled_for && String(c.scheduled_for).split('T')[0] === cleanDate && c.status !== 'cancelled'
  ).length;

  const slotIndex = Math.min(countOnDate, SMART_DAYTIME_SLOTS_IST.length - 1);
  const slot = SMART_DAYTIME_SLOTS_IST[slotIndex];

  return {
    scheduled_for: `${cleanDate}T${slot.utcSlot}`,
    slot_time: slot.timeStr,
    slot_index: slotIndex,
    slot_label: slot.label,
  };
};

/**
 * Calculates live ticking countdown details for scheduled notifications.
 * Activates high-visibility 1-day timer when release is <= 24 hours away.
 *
 * @param {string} isoString Target schedule time ISO string
 * @param {number} nowMs Current timestamp in ms (defaults to Date.now())
 * @returns {object|null}
 */
export const getCountdownDetails = (isoString, nowMs = Date.now()) => {
  if (!isoString) return null;
  const target = new Date(isoString).getTime();
  if (Number.isNaN(target)) return null;

  const diffMs = target - nowMs;
  if (diffMs <= 0) {
    return {
      isDue: true,
      label: '⚡ Release Time Reached (Auto-Dispatching...)',
      isFinalDay: false,
      totalSec: 0,
      days: 0,
      hours: 0,
      mins: 0,
      secs: 0,
      formattedTime: '00:00:00',
    };
  }

  const totalSec = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');

  const isFinalDay = totalSec <= 86400; // <= 24 hours (1 day)

  return {
    isDue: false,
    isFinalDay,
    totalSec,
    days,
    hours,
    mins,
    secs,
    formattedTime: `${pad(hours)}:${pad(mins)}:${pad(secs)}`,
    label: isFinalDay
      ? `🔥 1-Day Final Timer: ${pad(hours)}h ${pad(mins)}m ${pad(secs)}s`
      : `⏳ Auto-Sends in ${days}d ${pad(hours)}h ${pad(mins)}m ${pad(secs)}s`,
  };
};

/**
 * Accurately determines whether a release date is past, today, tomorrow, or in the future.
 * Never labels a past release (e.g. yesterday) as "Releases Today!".
 *
 * @param {string} releaseDateStr 'YYYY-MM-DD'
 * @param {Date} [now]
 * @returns {{ text: string, isUrgent: boolean, isPast: boolean, diffDays: number } | null}
 */
export const getMovieReleaseCountdown = (releaseDateStr, now = new Date()) => {
  if (!releaseDateStr) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const relDate = new Date(releaseDateStr.split('T')[0] + 'T00:00:00');
  if (Number.isNaN(relDate.getTime())) return null;

  const diffDays = Math.round((relDate - today) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { text: 'Released', isUrgent: false, isPast: true, diffDays };
  }
  if (diffDays === 0) {
    return { text: 'Releases Today!', isUrgent: true, isPast: false, diffDays };
  }
  if (diffDays === 1) {
    return { text: 'Releases Tomorrow!', isUrgent: true, isPast: false, diffDays };
  }
  return { text: `In ${diffDays} days`, isUrgent: false, isPast: false, diffDays };
};
