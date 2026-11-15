/**
 * Release Scheduler & Real-Time Countdown Utilities
 *
 * 4 Morning Release Staggering Slots (Indian Standard Time - IST / UTC+05:30):
 * - 07:00 AM IST -> 01:30:00.000Z UTC
 * - 08:00 AM IST -> 02:30:00.000Z UTC
 * - 09:00 AM IST -> 03:30:00.000Z UTC
 * - 10:00 AM IST -> 04:30:00.000Z UTC
 *
 * Automatically assigns same-day movie & web series releases across these 4 distinct
 * morning slots to prevent notification spam, running 1-day countdown timers that
 * auto-dispatch alerts without requiring manual admin approval.
 */

export const MORNING_SLOTS_IST = [
  { hourIST: 7, minuteIST: 0, timeStr: '07:00 AM IST', utcSlot: '01:30:00.000Z' },
  { hourIST: 8, minuteIST: 0, timeStr: '08:00 AM IST', utcSlot: '02:30:00.000Z' },
  { hourIST: 9, minuteIST: 0, timeStr: '09:00 AM IST', utcSlot: '03:30:00.000Z' },
  { hourIST: 10, minuteIST: 0, timeStr: '10:00 AM IST', utcSlot: '04:30:00.000Z' },
];

/**
 * Assigns one of the 4 morning release slots to a movie on a given release date
 * based on how many releases are already scheduled on that date.
 *
 * @param {string} releaseDate 'YYYY-MM-DD'
 * @param {Array} existingCampaigns Array of existing campaigns
 * @returns {{ scheduled_for: string, slot_time: string, slot_index: number }}
 */
export const getSlotForRelease = (releaseDate, existingCampaigns = []) => {
  const cleanDate = (releaseDate || new Date().toISOString().split('T')[0]).split('T')[0];
  const countOnDate = (existingCampaigns || []).filter(
    (c) => c && c.scheduled_for && String(c.scheduled_for).split('T')[0] === cleanDate && c.status !== 'cancelled'
  ).length;

  const slotIndex = countOnDate % MORNING_SLOTS_IST.length;
  const slot = MORNING_SLOTS_IST[slotIndex];

  return {
    scheduled_for: `${cleanDate}T${slot.utcSlot}`,
    slot_time: slot.timeStr,
    slot_index: slotIndex,
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
