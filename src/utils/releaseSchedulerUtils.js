/**
 * Smart Anti-Spam Release Scheduler & Real-Time Countdown Utilities
 *
 * Designed to prevent notification fatigue and spam bursts:
 * 1. Strict Future Ingestion Guard: Never sends retrospective push alerts for past releases.
 * 2. Quiet Hours (DND): 10:00 PM to 08:00 AM IST (No push notifications dispatched during sleep hours).
 * 3. Daytime Distributed Windows:
 *    - 08:30 AM IST (Morning Spotlight) -> 03:00 UTC
 *    - 01:30 PM IST (Afternoon Premiere) -> 08:00 UTC
 *    - 06:00 PM IST (Evening Prime) -> 12:30 UTC
 *    - 08:45 PM IST (Night Watchlist) -> 15:15 UTC
 * 4. Multi-Movie Capping & Smart Digest:
 *    - Max 3 push notifications per day.
 *    - If 4+ movies release on the same date (e.g. 10 movies), sends 1 morning Mega-Release Digest
 *      at 08:30 AM covering all 10 titles, plus afternoon & evening spotlights for top 2 blockbusters.
 */

export const SMART_DAYTIME_SLOTS_IST = [
  { id: 'morning', hourIST: 8, minuteIST: 30, timeStr: '08:30 AM IST', utcSlot: '03:00:00.000Z', label: 'Morning Spotlight' },
  { id: 'afternoon', hourIST: 13, minuteIST: 30, timeStr: '01:30 PM IST', utcSlot: '08:00:00.000Z', label: 'Afternoon Premiere' },
  { id: 'evening', hourIST: 18, minuteIST: 0, timeStr: '06:00 PM IST', utcSlot: '12:30:00.000Z', label: 'Evening Prime' },
  { id: 'night', hourIST: 20, minuteIST: 45, timeStr: '08:45 PM IST', utcSlot: '15:15:00.000Z', label: 'Night Watchlist' },
];

// Backward-compatible alias for 4 slots
export const MORNING_SLOTS_IST = SMART_DAYTIME_SLOTS_IST;

export const MAX_DAILY_NOTIFICATIONS = 3;

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
