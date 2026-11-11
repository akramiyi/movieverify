import test from 'node:test';
import assert from 'node:assert/strict';
import preferencesHandler from '../../api/notifications/preferences.js';

function createMockResponse() {
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

function createInMemoryPrefsSupabase({ userId = 'usr-canon-1', initialCanonical = null, initialOptOuts = [] } = {}) {
  let canonicalRow = initialCanonical ? { user_id: userId, ...initialCanonical } : null;
  let optOutRows = initialOptOuts.map((category) => ({ user_id: userId, category, reason: 'user_preference' }));

  return {
    getState: () => ({ canonicalRow, optOutRows: [...optOutRows] }),
    auth: {
      getUser: async () => ({
        data: { user: { id: userId, email: 'user@test.com' } },
        error: null,
      }),
    },
    from: (table) => {
      if (table === 'user_notification_preferences') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: canonicalRow, error: null }),
            }),
          }),
          upsert: (payload) => {
            canonicalRow = { ...payload };
            return {
              select: () => ({
                single: async () => ({ data: canonicalRow, error: null }),
              }),
            };
          },
        };
      }

      if (table === 'notification_opt_outs') {
        return {
          select: () => ({
            eq: async () => ({ data: optOutRows, error: null }),
          }),
          delete: () => ({
            eq: () => ({
              eq: async (_col, cat) => {
                optOutRows = optOutRows.filter((r) => r.category !== cat);
                return { error: null };
              },
            }),
          }),
          upsert: async (payload) => {
            if (!optOutRows.some((r) => r.category === payload.category)) {
              optOutRows.push({ ...payload });
            }
            return { error: null };
          },
        };
      }

      throw new Error(`Unexpected table queried: ${table}`);
    },
  };
}

test('Canonical Preferences GET aligns promotional default (false) without drift', async () => {
  const mockSupabase = createInMemoryPrefsSupabase();
  const req = { method: 'GET', headers: { authorization: 'Bearer jwt' } };
  const res = createMockResponse();

  await preferencesHandler(req, res, mockSupabase);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.preferences.opt_in_all, true);
  assert.equal(res.body.preferences.notify_new_movies, true);
  assert.equal(res.body.preferences.notify_new_series, true);
  assert.equal(res.body.preferences.notify_promotions, false);

  const promoCat = res.body.categories.find((c) => c.category === 'promotional');
  assert.equal(promoCat.enabled, false);
  assert.ok(res.body.opt_outs.includes('promotional'));
});

test('Canonical Preferences POST updates canonical columns and synchronizes notification_opt_outs', async () => {
  const mockSupabase = createInMemoryPrefsSupabase();

  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer jwt' },
    body: {
      preferences: {
        opt_in_all: true,
        notify_new_series: false,
        notify_promotions: true,
        channel_push: false,
        quiet_hours_enabled: true,
        quiet_hours_start: '22:30',
        quiet_hours_end: '06:30',
        max_daily_push: 12,
      },
    },
  };
  const res = createMockResponse();

  await preferencesHandler(req, res, mockSupabase);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.preferences.notify_new_series, false);
  assert.equal(res.body.preferences.notify_promotions, true);
  assert.equal(res.body.preferences.channel_push, false);
  assert.equal(res.body.preferences.quiet_hours_enabled, true);
  assert.equal(res.body.preferences.quiet_hours_start, '22:30');
  assert.equal(res.body.preferences.quiet_hours_end, '06:30');
  assert.equal(res.body.preferences.max_daily_push, 12);

  // Check subsequent GET matches persisted canonical state identically
  const getRes = createMockResponse();
  await preferencesHandler({ method: 'GET', headers: { authorization: 'Bearer jwt' } }, getRes, mockSupabase);
  assert.equal(getRes.statusCode, 200);
  assert.deepEqual(getRes.body.preferences, res.body.preferences);
  assert.equal(
    getRes.body.categories.find((c) => c.category === 'promotional').enabled,
    true
  );
});

test('Canonical Preferences POST validates quiet hours and max_daily_push bounds', async () => {
  const mockSupabase = createInMemoryPrefsSupabase();

  const badQuietRes = createMockResponse();
  await preferencesHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer jwt' },
      body: { preferences: { quiet_hours_enabled: true } },
    },
    badQuietRes,
    mockSupabase
  );
  assert.equal(badQuietRes.statusCode, 400);

  const badCapRes = createMockResponse();
  await preferencesHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer jwt' },
      body: { preferences: { max_daily_push: 999 } },
    },
    badCapRes,
    mockSupabase
  );
  assert.equal(badCapRes.statusCode, 400);
});

