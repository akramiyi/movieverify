import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SMART_DAYTIME_SLOTS_IST,
  MORNING_SLOTS_IST,
  MAX_DAILY_NOTIFICATIONS,
  getTodayIST,
  isQuietHoursIST,
  getScheduledSlotForRelease,
  autoIngestUpcomingReleases,
  getAdminCategorySettings,
  updateAdminCategorySettings,
  DEFAULT_CATEGORY_SETTINGS,
} from '../../api/_lib/scheduledCampaignService.js';
import dispatchHandler from '../../api/notifications/dispatch.js';
import { getCountdownDetails, getMovieReleaseCountdown } from '../../src/utils/releaseSchedulerUtils.js';

function createMockRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(payload) {
      if (payload) {
        try {
          this.body = JSON.parse(payload);
        } catch {
          this.body = payload;
        }
      }
      return this;
    },
  };
}

test('1. Smart Distributed Time Slots - accurately configured for 8:30 AM, 1:30 PM, 6:00 PM, 8:45 PM IST', () => {
  assert.equal(SMART_DAYTIME_SLOTS_IST.length, 4);
  assert.deepEqual(
    SMART_DAYTIME_SLOTS_IST.map((s) => s.timeStr),
    ['08:30 AM IST', '01:30 PM IST', '06:00 PM IST', '08:45 PM IST']
  );
  // UTC Equivalencies for IST (UTC+05:30)
  assert.equal(SMART_DAYTIME_SLOTS_IST[0].utcSlot, '03:00:00.000Z'); // 8:30 AM IST
  assert.equal(SMART_DAYTIME_SLOTS_IST[1].utcSlot, '08:00:00.000Z'); // 1:30 PM IST
  assert.equal(SMART_DAYTIME_SLOTS_IST[2].utcSlot, '12:30:00.000Z'); // 6:00 PM IST
  assert.equal(SMART_DAYTIME_SLOTS_IST[3].utcSlot, '15:15:00.000Z'); // 8:45 PM IST
});

test('2. getScheduledSlotForRelease - staggers same-day movie releases across daytime slots with max clamping', () => {
  const releaseDate = '2026-11-20';

  const slot0 = getScheduledSlotForRelease(releaseDate, 0);
  assert.equal(slot0.slot_time, '08:30 AM IST');
  assert.equal(slot0.scheduled_for, '2026-11-20T03:00:00.000Z');

  const slot1 = getScheduledSlotForRelease(releaseDate, 1);
  assert.equal(slot1.slot_time, '01:30 PM IST');
  assert.equal(slot1.scheduled_for, '2026-11-20T08:00:00.000Z');

  const slot2 = getScheduledSlotForRelease(releaseDate, 2);
  assert.equal(slot2.slot_time, '06:00 PM IST');
  assert.equal(slot2.scheduled_for, '2026-11-20T12:30:00.000Z');

  const slot3 = getScheduledSlotForRelease(releaseDate, 3);
  assert.equal(slot3.slot_time, '08:45 PM IST');
  assert.equal(slot3.scheduled_for, '2026-11-20T15:15:00.000Z');

  // Slot 4 clamps to the last slot (8:45 PM IST)
  const slot4 = getScheduledSlotForRelease(releaseDate, 4);
  assert.equal(slot4.slot_time, '08:45 PM IST');
  assert.equal(slot4.scheduled_for, '2026-11-20T15:15:00.000Z');
});

test('3. autoIngestUpcomingReleases - automatically ingests releases with zero approval required and staggers same-day releases', async () => {
  const mockInsertedCampaigns = [];

  const mockSupabase = {
    from: (table) => {
      if (table === 'notification_campaigns') {
        return {
          select: () => ({
            neq: () => ({
              limit: async () => ({ data: [...mockInsertedCampaigns], error: null }),
            }),
          }),
          insert: (row) => ({
            select: () => ({
              single: async () => {
                const inserted = { id: `camp-${mockInsertedCampaigns.length + 1}`, ...row };
                mockInsertedCampaigns.push(inserted);
                return { data: inserted, error: null };
              },
            }),
          }),
        };
      }
      return { select: () => ({ error: null }) };
    },
  };

  const sampleReleases = [
    {
      id: 101,
      title: 'South Movie 1',
      release_date: '2026-11-25',
      media_type: 'movie',
      industry_label: 'South Movies',
      poster_path: '/poster1.jpg',
    },
    {
      id: 102,
      title: 'South Movie 2 (Same Date)',
      release_date: '2026-11-25',
      media_type: 'movie',
      industry_label: 'South Movies',
      backdrop_path: '/backdrop2.jpg',
    },
    {
      id: 103,
      title: 'Bollywood Movie 3 (Same Date)',
      release_date: '2026-11-25',
      media_type: 'movie',
      industry_label: 'Bollywood',
      poster_path: '/poster3.jpg',
    },
  ];

  // Pass 1: Initial auto-ingest
  const res1 = await autoIngestUpcomingReleases(mockSupabase, { releases: sampleReleases });
  assert.equal(res1.ingested_count, 3);
  assert.equal(res1.skipped_count, 0);

  // Movie 1 assigned Slot 0 (08:30 AM IST)
  assert.equal(res1.releases[0].slot_time, '08:30 AM IST');
  assert.equal(res1.releases[0].scheduled_for, '2026-11-25T03:00:00.000Z');

  // Movie 2 assigned Slot 1 (01:30 PM IST)
  assert.equal(res1.releases[1].slot_time, '01:30 PM IST');
  assert.equal(res1.releases[1].scheduled_for, '2026-11-25T08:00:00.000Z');

  // Movie 3 assigned Slot 2 (06:00 PM IST)
  assert.equal(res1.releases[2].slot_time, '06:00 PM IST');
  assert.equal(res1.releases[2].scheduled_for, '2026-11-25T12:30:00.000Z');

  // Pass 2: Replay auto-ingest (Idempotency test)
  const res2 = await autoIngestUpcomingReleases(mockSupabase, { releases: sampleReleases });
  assert.equal(res2.ingested_count, 0);
  assert.equal(res2.skipped_count, 3); // All skipped, 0 duplicates!
});

test('4. dispatchHandler - executes autoIngest and returns auto_ingested_count when autoIngest: true', async () => {
  const prevSecret = process.env.INTERNAL_WORKER_SECRET;
  const prevDispatch = process.env.NOTIFICATION_DISPATCH_ENABLED;
  process.env.INTERNAL_WORKER_SECRET = 'test-worker-secret-release';
  process.env.NOTIFICATION_DISPATCH_ENABLED = 'true';

  try {
    const mockDbCampaigns = [];
    const mockSupabase = {
      from: (table) => {
        if (table === 'notification_campaigns') {
          return {
            select: () => ({
              neq: () => ({
                limit: async () => ({ data: [...mockDbCampaigns], error: null }),
              }),
            }),
            insert: (row) => ({
              select: () => ({
                single: async () => {
                  const inserted = { id: `auto-${mockDbCampaigns.length + 1}`, ...row };
                  mockDbCampaigns.push(inserted);
                  return { data: inserted, error: null };
                },
              }),
            }),
          };
        }
        return { select: () => ({ error: null }) };
      },
      rpc: async (fn) => {
        if (fn === 'promote_due_scheduled_campaigns') {
          return { data: { promoted_count: 0, campaigns: [] }, error: null };
        }
        if (fn === 'reserve_notification_deliveries') {
          return { data: [], error: null };
        }
        return { data: null, error: null };
      },
    };

    const res = createMockRes();
    const req = {
      method: 'GET',
      headers: {
        'x-worker-secret': 'test-worker-secret-release',
      },
      url: '/api/notifications/dispatch',
    };

    await dispatchHandler(req, res, {
      supabase: mockSupabase,
      messaging: { send: async () => 'mock-msg' },
      autoIngest: true,
      releases: [
        {
          id: 555,
          title: 'Kidney - Automatic Alert',
          release_date: '2026-11-28',
          media_type: 'movie',
          industry_label: 'Bollywood',
          poster_path: '/kidney.jpg',
        },
      ],
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.auto_ingested_count, 1);
    assert.equal(res.body.auto_ingested_releases[0].title, 'Kidney - Automatic Alert');
    assert.equal(res.body.auto_ingested_releases[0].slot_time, '08:30 AM IST');
  } finally {
    if (prevSecret === undefined) delete process.env.INTERNAL_WORKER_SECRET;
    else process.env.INTERNAL_WORKER_SECRET = prevSecret;
    if (prevDispatch === undefined) delete process.env.NOTIFICATION_DISPATCH_ENABLED;
    else process.env.NOTIFICATION_DISPATCH_ENABLED = prevDispatch;
  }
});

test('5. getCountdownDetails - live ticking countdown calculations and 1-day threshold detection', () => {
  const baseTime = new Date('2026-11-19T00:00:00.000Z').getTime();

  // Case A: Movie scheduled 14 hours away (within 24 hours -> 1-day final timer)
  const scheduledTime1 = new Date('2026-11-19T14:22:15.000Z').getTime();
  const cd1 = getCountdownDetails(new Date(scheduledTime1).toISOString(), baseTime);
  assert.equal(cd1.isDue, false);
  assert.equal(cd1.isFinalDay, true);
  assert.equal(cd1.hours, 14);
  assert.equal(cd1.mins, 22);
  assert.equal(cd1.secs, 15);
  assert.equal(cd1.formattedTime, '14:22:15');
  assert.match(cd1.label, /1-Day Final Timer: 14h 22m 15s/);

  // Case B: Movie scheduled 3 days away (> 24 hours)
  const scheduledTime2 = new Date('2026-11-22T04:30:00.000Z').getTime();
  const cd2 = getCountdownDetails(new Date(scheduledTime2).toISOString(), baseTime);
  assert.equal(cd2.isDue, false);
  assert.equal(cd2.isFinalDay, false);
  assert.equal(cd2.days, 3);
  assert.match(cd2.label, /Auto-Sends in 3d/);

  // Case C: Release slot has arrived or passed (diff <= 0 -> isDue)
  const pastTime = new Date('2026-11-18T23:59:00.000Z').getTime();
  const cd3 = getCountdownDetails(new Date(pastTime).toISOString(), baseTime);
  assert.equal(cd3.isDue, true);
  assert.match(cd3.label, /Release Time Reached/);
});

test('6. Anti-Spam Protection - Quiet Hours, Daily Cap (Max 3/Day), and Past Date Skipping', async () => {
  // Test Quiet Hours check (10:00 PM to 08:00 AM IST)
  const midnightUtc = new Date('2026-11-16T20:31:00.000Z'); // 02:01 AM IST
  assert.equal(isQuietHoursIST(midnightUtc), true);

  const daytimeUtc = new Date('2026-11-16T08:30:00.000Z'); // 02:00 PM IST
  assert.equal(isQuietHoursIST(daytimeUtc), false);

  const lateNightUtc = new Date('2026-11-16T17:00:00.000Z'); // 10:30 PM IST
  assert.equal(isQuietHoursIST(lateNightUtc), true);

  const earlyMorningUtc = new Date('2026-11-16T01:30:00.000Z'); // 07:00 AM IST
  assert.equal(isQuietHoursIST(earlyMorningUtc), true);

  // Test Past Date Skip and Daily Capping
  const mockInsertedCampaigns = [];
  const mockSupabase = {
    from: (table) => {
      if (table === 'notification_campaigns') {
        return {
          select: () => ({
            neq: () => ({
              limit: async () => ({ data: [...mockInsertedCampaigns], error: null }),
            }),
          }),
          insert: (row) => ({
            select: () => ({
              single: async () => {
                const inserted = { id: `camp-${mockInsertedCampaigns.length + 1}`, ...row };
                mockInsertedCampaigns.push(inserted);
                return { data: inserted, error: null };
              },
            }),
          }),
        };
      }
      return { select: () => ({ error: null }) };
    },
  };

  // 1 past release + 5 same-day future releases (testing max daily cap = 3)
  const burstReleases = [
    {
      id: 999,
      title: 'Past Movie (Should be Skipped)',
      release_date: '2026-11-01', // definitely past
      media_type: 'movie',
      industry_label: 'Hollywood',
    },
    ...Array.from({ length: 5 }, (_, i) => ({
      id: 200 + i,
      title: `Blockbuster Part ${i + 1}`,
      release_date: '2026-11-30',
      media_type: 'movie',
      industry_label: 'Hollywood',
    })),
  ];

  const result = await autoIngestUpcomingReleases(mockSupabase, { releases: burstReleases });
  // Past movie skipped (1) + 2 extra movies capped (total 5 - 3 = 2 skipped) -> total skipped = 3
  assert.equal(result.ingested_count, 3); // Capped at MAX_DAILY_NOTIFICATIONS (3)
  assert.equal(result.skipped_count, 3); // 1 past + 2 capped
  assert.equal(mockInsertedCampaigns.length, 3);
});

test('7. Admin Category Access Controls - toggling categories suppresses automated alerts for muted categories', async () => {
  const mockInsertedCampaigns = [];
  const mockDbState = new Map();

  const mockSupabase = {
    from: (table) => {
      if (table === 'notification_campaigns') {
        return {
          select: () => ({
            neq: () => ({
              limit: async () => ({ data: [...mockInsertedCampaigns], error: null }),
            }),
            eq: (col, val) => ({
              maybeSingle: async () => ({
                data: mockDbState.get(val) || null,
                error: null,
              }),
            }),
            in: () => ({
              data: [...mockInsertedCampaigns],
              error: null,
            }),
          }),
          insert: (row) => ({
            select: () => ({
              single: async () => {
                const inserted = { id: `camp-${mockInsertedCampaigns.length + 1}`, ...row };
                mockInsertedCampaigns.push(inserted);
                return { data: inserted, error: null };
              },
            }),
          }),
          upsert: (row) => ({
            select: () => ({
              single: async () => {
                mockDbState.set(row.id, row);
                return { data: row, error: null };
              },
            }),
          }),
          update: () => ({
            in: async () => ({ data: [], error: null }),
          }),
        };
      }
      return { select: () => ({ error: null }) };
    },
  };

  // 1. Admin turns OFF Hindi Web Series and Hollywood Movies (User scenario)
  const updatedSettings = await updateAdminCategorySettings(mockSupabase, {
    disabledCategories: ['hindi_series', 'hollywood_movie'],
    categories: {
      ...DEFAULT_CATEGORY_SETTINGS,
      hindi_series: false,
      hollywood_movie: false,
    },
  });

  assert.equal(updatedSettings.categories.hindi_series, false);
  assert.equal(updatedSettings.categories.hollywood_movie, false);
  assert.equal(updatedSettings.categories.bollywood_movie, true);
  assert.equal(updatedSettings.categories.south_movie, true);
  assert.deepEqual(updatedSettings.disabled_categories.sort(), ['hindi_series', 'hollywood_movie'].sort());

  // 2. Incoming releases contains Bollywood, Hindi Series, Hollywood, and South releases
  const mixedReleases = [
    {
      id: 501,
      title: 'Stree 3',
      release_date: '2026-11-28',
      media_type: 'movie',
      release_category: 'bollywood_movie',
      industry_label: 'Bollywood',
    },
    {
      id: 502,
      title: 'Panchayat Season 4',
      release_date: '2026-11-28',
      media_type: 'tv',
      release_category: 'hindi_series',
      industry_label: 'Hindi Web Series',
    },
    {
      id: 503,
      title: 'Avatar 3',
      release_date: '2026-11-28',
      media_type: 'movie',
      release_category: 'hollywood_movie',
      industry_label: 'Hollywood',
    },
    {
      id: 504,
      title: 'Pushpa 3',
      release_date: '2026-11-28',
      media_type: 'movie',
      release_category: 'south_movie',
      industry_label: 'South Movies',
    },
  ];

  // 3. Ingestion respects the disabled categories!
  const ingestResult = await autoIngestUpcomingReleases(mockSupabase, {
    releases: mixedReleases,
    disabledCategories: updatedSettings.disabled_categories,
  });

  // Only Bollywood (Stree 3) and South (Pushpa 3) should be ingested!
  // Hindi Series and Hollywood Movie must be skipped as requested!
  assert.equal(ingestResult.ingested_count, 2);
  assert.equal(ingestResult.skipped_count, 2);
  const ingestedTitles = ingestResult.releases.map((r) => r.title);
  assert.ok(ingestedTitles.includes('Stree 3'));
  assert.ok(ingestedTitles.includes('Pushpa 3'));
  assert.ok(!ingestedTitles.includes('Panchayat Season 4'));
  assert.ok(!ingestedTitles.includes('Avatar 3'));
});

test('8. getMovieReleaseCountdown - accurately classifies past, today, tomorrow, and future days without false Releases Today', () => {
  const fixedNow = new Date('2026-11-16T12:00:00Z');

  // Past release (Yesterday: 2026-11-15) - Must NOT be 'Releases Today!'
  const pastResult = getMovieReleaseCountdown('2026-11-15', fixedNow);
  assert.equal(pastResult.isPast, true);
  assert.equal(pastResult.isUrgent, false);
  assert.equal(pastResult.text, 'Released');

  // Today release (2026-11-16)
  const todayResult = getMovieReleaseCountdown('2026-11-16', fixedNow);
  assert.equal(todayResult.isPast, false);
  assert.equal(todayResult.isUrgent, true);
  assert.equal(todayResult.text, 'Releases Today!');

  // Tomorrow release (2026-11-17)
  const tomorrowResult = getMovieReleaseCountdown('2026-11-17', fixedNow);
  assert.equal(tomorrowResult.isPast, false);
  assert.equal(tomorrowResult.isUrgent, true);
  assert.equal(tomorrowResult.text, 'Releases Tomorrow!');

  // Future release (2026-11-19)
  const futureResult = getMovieReleaseCountdown('2026-11-19', fixedNow);
  assert.equal(futureResult.isPast, false);
  assert.equal(futureResult.isUrgent, false);
  assert.equal(futureResult.text, 'In 3 days');
});

test('9. Live Countdown Timer & Due Expiration - flags isDue: true when timer reaches 00:00:00', () => {
  const nowMs = new Date('2026-11-16T08:30:00.000Z').getTime();

  // Exactly due
  const dueCd = getCountdownDetails('2026-11-16T08:30:00.000Z', nowMs);
  assert.equal(dueCd.isDue, true);
  assert.equal(dueCd.formattedTime, '00:00:00');
  assert.ok(dueCd.label.includes('Release Time Reached'));

  // 1-day final timer (e.g. 5 hours left)
  const futureCd = getCountdownDetails('2026-11-16T13:30:00.000Z', nowMs);
  assert.equal(futureCd.isDue, false);
  assert.equal(futureCd.isFinalDay, true);
  assert.equal(futureCd.hours, 5);
  assert.equal(futureCd.mins, 0);
  assert.equal(futureCd.secs, 0);
  assert.equal(futureCd.formattedTime, '05:00:00');
  assert.ok(futureCd.label.includes('1-Day Final Timer'));
});
