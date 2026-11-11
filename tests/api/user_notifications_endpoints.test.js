import test from 'node:test';
import assert from 'node:assert/strict';
import userHandler from '../../api/notifications/user.js';
import subscriptionsHandler from '../../api/notifications/subscriptions.js';
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

test('User Notifications API - GET /api/notifications/user', async () => {
  const mockSupabase = {
    auth: {
      getUser: async () => ({
        data: { user: { id: 'usr-123', email: 'user@test.com' } },
        error: null,
      }),
    },
    from: (table) => {
      assert.equal(table, 'user_notifications');
      return {
        select: () => ({
          eq: (col, val) => {
            assert.equal(col, 'user_id');
            assert.equal(val, 'usr-123'); // Proves caller can only query own user_id
            return {
              order: function order() {
                return {
                  order,
                  limit: async () => ({
                    data: [
                      { id: 'n-1', title: 'Movie Alert', is_read: false },
                      { id: 'n-2', title: 'System Notice', is_read: true },
                    ],
                    error: null,
                  }),
                };
              },
            };
          },
        }),
      };
    },
  };

  const req = {
    method: 'GET',
    headers: { authorization: 'Bearer mock-jwt' },
  };
  const res = createMockResponse();

  await userHandler(req, res, mockSupabase);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.unread_count, 1);
  assert.equal(res.body.notifications.length, 2);
});

test('Subscriptions API - POST /api/notifications/subscriptions', async () => {
  const mockSupabase = {
    auth: {
      getUser: async () => ({
        data: { user: { id: 'usr-456' } },
        error: null,
      }),
    },
    from: (table) => {
      assert.equal(table, 'actor_notify_requests');
      return {
        upsert: (payload) => {
          assert.equal(payload.user_id, 'usr-456'); // Proves user_id is forced to verified caller
          return {
            select: () => ({
              single: async () => ({
                data: { user_id: 'usr-456', actor_id: '500', actor_name: 'Tom Cruise' },
                error: null,
              }),
            }),
          };
        },
      };
    },
  };

  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer mock-jwt' },
    body: { type: 'actor', target_id: '500', target_name: 'Tom Cruise' },
  };
  const res = createMockResponse();

  await subscriptionsHandler(req, res, mockSupabase);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.subscription.actor_name, 'Tom Cruise');
});

test('Preferences API - POST /api/notifications/preferences toggle', async () => {
  let deletedOptOut = false;
  let canonicalUpserted = null;
  const mockSupabase = {
    auth: {
      getUser: async () => ({
        data: { user: { id: 'usr-789' } },
        error: null,
      }),
    },
    from: (table) => {
      if (table === 'user_notification_preferences') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  user_id: 'usr-789',
                  opt_in_all: true,
                  notify_new_movies: false,
                  notify_new_series: true,
                  notify_movie_updates: true,
                  notify_promotions: false,
                  notify_system: true,
                },
                error: null,
              }),
            }),
          }),
          upsert: (payload) => {
            canonicalUpserted = payload;
            return {
              select: () => ({
                single: async () => ({
                  data: payload,
                  error: null,
                }),
              }),
            };
          },
        };
      }
      assert.equal(table, 'notification_opt_outs');
      return {
        select: () => ({
          eq: async (col, val) => {
            assert.equal(col, 'user_id');
            assert.equal(val, 'usr-789');
            return { data: [{ category: 'movie_release' }], error: null };
          },
        }),
        delete: () => ({
          eq: (col1, val1) => {
            assert.equal(col1, 'user_id');
            assert.equal(val1, 'usr-789');
            return {
              eq: async (col2, val2) => {
                assert.equal(col2, 'category');
                assert.equal(val2, 'movie_release');
                deletedOptOut = true;
                return { error: null };
              },
            };
          },
        }),
      };
    },
  };

  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer mock-jwt' },
    body: { category: 'movie_release', enabled: true },
  };
  const res = createMockResponse();

  await preferencesHandler(req, res, mockSupabase);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(deletedOptOut, true);
  assert.equal(canonicalUpserted.notify_new_movies, true);
});

// ============================================================================
// Phase A: Safe Notification Inbox Cleanup Tests
// ============================================================================

function createInboxMockSupabase({
  user = { id: 'usr-123', email: 'user@test.com' },
  userNotifications = [],
  campaigns = [],
  deliveries = [],
  campaignsError = null,
  deliveriesError = null,
  notificationsError = null,
} = {}) {
  return {
    auth: {
      getUser: async (token) => {
        if (!token || !user) {
          return { data: { user: null }, error: { message: 'Invalid JWT' } };
        }
        return { data: { user }, error: null };
      },
    },
    from: (table) => {
      if (table === 'user_notifications') {
        return {
          select: () => ({
            eq: (col, val) => {
              assert.equal(col, 'user_id');
              assert.equal(val, user.id);
              return {
                order: (orderCol, { ascending } = {}) => {
                  const orderClauses = [{ col: orderCol, ascending }];
                  const chain = {
                    order: (col2, { ascending: asc2 } = {}) => {
                      orderClauses.push({ col: col2, ascending: asc2 });
                      return chain;
                    },
                    range: async (from, to) => {
                      if (notificationsError) {
                        return { data: null, error: notificationsError };
                      }
                      const sorted = [...userNotifications].sort((a, b) => {
                        for (const clause of orderClauses) {
                          const valA = a[clause.col];
                          const valB = b[clause.col];
                          if (valA === valB) continue;
                          if (clause.ascending) {
                            return valA > valB ? 1 : valA < valB ? -1 : 0;
                          } else {
                            return valA < valB ? 1 : valA > valB ? -1 : 0;
                          }
                        }
                        return 0;
                      });
                      const sliced = sorted.slice(from, to + 1);
                      return { data: sliced, error: null };
                    },
                    limit: async (lim) => {
                      if (notificationsError) {
                        return { data: null, error: notificationsError };
                      }
                      const sorted = [...userNotifications].sort((a, b) => {
                        for (const clause of orderClauses) {
                          const valA = a[clause.col];
                          const valB = b[clause.col];
                          if (valA === valB) continue;
                          if (clause.ascending) {
                            return valA > valB ? 1 : valA < valB ? -1 : 0;
                          } else {
                            return valA < valB ? 1 : valA > valB ? -1 : 0;
                          }
                        }
                        return 0;
                      });
                      const sliced = sorted.slice(0, lim);
                      return { data: sliced, error: null };
                    },
                  };
                  return chain;
                },
              };
            },
          }),
          update: (updatePayload) => {
            const filters = {};
            const chain = {
              eq: (col, val) => {
                filters[col] = val;
                return chain;
              },
              select: () => ({
                single: async () => ({
                  data: { id: filters.id, ...updatePayload },
                  error: null,
                }),
              }),
              // Allows awaiting directly for mark_all
              then: (resolve, reject) => Promise.resolve({ error: null }).then(resolve, reject),
            };
            return chain;
          },
        };
      }

      if (table === 'notification_campaigns') {
        return {
          select: (fields) => {
            assert.equal(fields, 'id, status');
            return {
              in: async (col, ids) => {
                assert.equal(col, 'id');
                if (campaignsError) {
                  return { data: null, error: campaignsError };
                }
                const matched = campaigns.filter((c) => ids.includes(c.id));
                return { data: matched, error: null };
              },
            };
          },
        };
      }

      if (table === 'notification_deliveries') {
        return {
          select: (fields) => {
            assert.equal(fields, 'campaign_id, delivery_status');
            return {
              eq: (col1, val1) => {
                assert.equal(col1, 'recipient_id');
                assert.equal(val1, user.id);
                return {
                  in: (col2, ids) => {
                    assert.equal(col2, 'campaign_id');
                    return {
                      in: async (col3, statuses) => {
                        assert.equal(col3, 'delivery_status');
                        if (deliveriesError) {
                          return { data: null, error: deliveriesError };
                        }
                        const matched = deliveries.filter(
                          (d) =>
                            d.recipient_id === val1 &&
                            ids.includes(d.campaign_id) &&
                            statuses.includes(d.delivery_status)
                        );
                        return { data: matched, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table queried in mock: ${table}`);
    },
  };
}

test('Phase A Case 1: Normal active campaign notifications remain visible', async () => {
  const mockSupabase = createInboxMockSupabase({
    userNotifications: [
      { id: 'n-active-1', campaign_id: 'c-active', title: 'Active Alert', is_read: false },
    ],
    campaigns: [{ id: 'c-active', status: 'completed' }],
  });

  const req = { method: 'GET', headers: { authorization: 'Bearer mock-jwt' } };
  const res = createMockResponse();

  await userHandler(req, res, mockSupabase);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.unread_count, 1);
  assert.equal(res.body.notifications.length, 1);
  assert.equal(res.body.notifications[0].id, 'n-active-1');
});

test('Phase A Case 2: Standalone notifications remain visible', async () => {
  const mockSupabase = createInboxMockSupabase({
    userNotifications: [
      { id: 'n-std-1', created_at: '2026-11-10T12:00:00Z', campaign_id: null, title: 'Standalone 1', is_read: false },
      { id: 'n-std-2', created_at: '2026-11-10T11:00:00Z', title: 'Standalone 2 (no campaign_id prop)', is_read: true },
    ],
  });

  const req = { method: 'GET', headers: { authorization: 'Bearer mock-jwt' } };
  const res = createMockResponse();

  await userHandler(req, res, mockSupabase);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.unread_count, 1);
  assert.equal(res.body.notifications.length, 2);
  assert.equal(res.body.notifications[0].id, 'n-std-1');
  assert.equal(res.body.notifications[1].id, 'n-std-2');
});

test('Phase A Case 3: Cancelled campaign notifications with only cancelled/pending/failed deliveries are hidden', async () => {
  const mockSupabase = createInboxMockSupabase({
    userNotifications: [
      { id: 'n-canc-1', campaign_id: 'c-canc-1', title: 'Cancelled alert 1', is_read: false },
      { id: 'n-canc-2', campaign_id: 'c-canc-2', title: 'Cancelled alert 2', is_read: false },
    ],
    campaigns: [
      { id: 'c-canc-1', status: 'cancelled' },
      { id: 'c-canc-2', status: 'cancelled' },
    ],
    deliveries: [
      { recipient_id: 'usr-123', campaign_id: 'c-canc-1', delivery_status: 'cancelled' },
      { recipient_id: 'usr-123', campaign_id: 'c-canc-2', delivery_status: 'failed' },
    ],
  });

  const req = { method: 'GET', headers: { authorization: 'Bearer mock-jwt' } };
  const res = createMockResponse();

  await userHandler(req, res, mockSupabase);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.unread_count, 0);
  assert.equal(res.body.notifications.length, 0);
});

test('Phase A Case 4: Cancelled campaign notifications with a sent or delivered record for the same recipient remain visible', async () => {
  const mockSupabase = createInboxMockSupabase({
    userNotifications: [
      { id: 'n-sent', campaign_id: 'c-sent', title: 'Sent Alert', is_read: false },
      { id: 'n-deliv', campaign_id: 'c-deliv', title: 'Delivered Alert', is_read: true },
      { id: 'n-unsent', campaign_id: 'c-unsent', title: 'Unsent Alert', is_read: false },
    ],
    campaigns: [
      { id: 'c-sent', status: 'cancelled' },
      { id: 'c-deliv', status: 'cancelled' },
      { id: 'c-unsent', status: 'cancelled' },
    ],
    deliveries: [
      { recipient_id: 'usr-123', campaign_id: 'c-sent', delivery_status: 'sent' },
      { recipient_id: 'usr-123', campaign_id: 'c-deliv', delivery_status: 'delivered' },
      { recipient_id: 'usr-123', campaign_id: 'c-unsent', delivery_status: 'pending' },
    ],
  });

  const req = { method: 'GET', headers: { authorization: 'Bearer mock-jwt' } };
  const res = createMockResponse();

  await userHandler(req, res, mockSupabase);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.unread_count, 1);
  assert.equal(res.body.notifications.length, 2);
  assert.equal(res.body.notifications[0].id, 'n-sent');
  assert.equal(res.body.notifications[1].id, 'n-deliv');
});

test('Phase A Case 5: A delivery belonging to another recipient does not preserve the current user cancelled notification', async () => {
  const mockSupabase = createInboxMockSupabase({
    user: { id: 'usr-123', email: 'user@test.com' },
    userNotifications: [
      { id: 'n-canc-other', campaign_id: 'c-other-deliv', title: 'Alert', is_read: false },
    ],
    campaigns: [{ id: 'c-other-deliv', status: 'cancelled' }],
    deliveries: [
      { recipient_id: 'other-user-999', campaign_id: 'c-other-deliv', delivery_status: 'delivered' },
    ],
  });

  const req = { method: 'GET', headers: { authorization: 'Bearer mock-jwt' } };
  const res = createMockResponse();

  await userHandler(req, res, mockSupabase);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.unread_count, 0);
  assert.equal(res.body.notifications.length, 0);
});

test('Phase A Case 6: Deleted and expired notifications are excluded', async () => {
  const mockSupabase = createInboxMockSupabase({
    userNotifications: [
      { id: 'n-del', title: 'Deleted Item', is_deleted: true, is_read: false },
      { id: 'n-exp', title: 'Expired Item', expires_at: new Date(Date.now() - 3600000).toISOString(), is_read: false },
      { id: 'n-valid', title: 'Valid Item', expires_at: new Date(Date.now() + 3600000).toISOString(), is_read: false },
    ],
  });

  const req = { method: 'GET', headers: { authorization: 'Bearer mock-jwt' } };
  const res = createMockResponse();

  await userHandler(req, res, mockSupabase);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.unread_count, 1);
  assert.equal(res.body.notifications.length, 1);
  assert.equal(res.body.notifications[0].id, 'n-valid');
});

test('Phase A Case 7: Pagination continues after a page containing only hidden notifications', async () => {
  // 50 items on page 1 that are cancelled without deliveries
  const page1Hidden = Array.from({ length: 50 }, (_, i) => ({
    id: `hidden-${i}`,
    campaign_id: 'c-canc',
    is_read: false,
  }));
  // 1 item on page 2 that is standalone (visible)
  const page2Visible = [{ id: 'visible-page2', campaign_id: null, is_read: false }];

  const mockSupabase = createInboxMockSupabase({
    userNotifications: [...page1Hidden, ...page2Visible],
    campaigns: [{ id: 'c-canc', status: 'cancelled' }],
    deliveries: [],
  });

  const req = { method: 'GET', headers: { authorization: 'Bearer mock-jwt' } };
  const res = createMockResponse();

  await userHandler(req, res, mockSupabase);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.unread_count, 1);
  assert.equal(res.body.notifications.length, 1);
  assert.equal(res.body.notifications[0].id, 'visible-page2');
});

test('Phase A Case 8: Maximum visible response remains 50 records', async () => {
  const manyNotifications = Array.from({ length: 65 }, (_, i) => ({
    id: `notif-${i}`,
    campaign_id: null,
    is_read: false,
  }));

  const mockSupabase = createInboxMockSupabase({
    userNotifications: manyNotifications,
  });

  const req = { method: 'GET', headers: { authorization: 'Bearer mock-jwt' } };
  const res = createMockResponse();

  await userHandler(req, res, mockSupabase);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.unread_count, 50);
  assert.equal(res.body.notifications.length, 50);
});

test('Phase A Case 9: Unread count includes only visible unread records', async () => {
  const mockSupabase = createInboxMockSupabase({
    userNotifications: [
      { id: 'n-vis-unread', campaign_id: null, is_read: false },
      { id: 'n-vis-read', campaign_id: null, is_read: true },
      { id: 'n-hidden-unread-1', campaign_id: 'c-canc', is_read: false },
      { id: 'n-hidden-unread-2', is_deleted: true, is_read: false },
    ],
    campaigns: [{ id: 'c-canc', status: 'cancelled' }],
    deliveries: [],
  });

  const req = { method: 'GET', headers: { authorization: 'Bearer mock-jwt' } };
  const res = createMockResponse();

  await userHandler(req, res, mockSupabase);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.unread_count, 1);
  assert.equal(res.body.notifications.length, 2);
});

test('Phase A Case 10: Campaign lookup or delivery lookup errors fail safely', async () => {
  // 10a: Campaign lookup fails
  const mockCampaignError = createInboxMockSupabase({
    userNotifications: [
      { id: 'n-camp', campaign_id: 'c-1', is_read: false },
      { id: 'n-stand', campaign_id: null, is_read: false },
    ],
    campaignsError: { message: 'Database connection failed' },
  });

  const reqA = { method: 'GET', headers: { authorization: 'Bearer mock-jwt' } };
  const resA = createMockResponse();

  await userHandler(reqA, resA, mockCampaignError);

  assert.equal(resA.statusCode, 200);
  // Standalone remains visible, failed campaign lookup fails closed (hidden)
  assert.equal(resA.body.notifications.length, 1);
  assert.equal(resA.body.notifications[0].id, 'n-stand');
  assert.equal(resA.body.unread_count, 1);

  // 10b: Delivery lookup fails for cancelled campaign
  const mockDeliveryError = createInboxMockSupabase({
    userNotifications: [
      { id: 'n-canc', campaign_id: 'c-canc', is_read: false },
      { id: 'n-stand-2', campaign_id: null, is_read: false },
    ],
    campaigns: [{ id: 'c-canc', status: 'cancelled' }],
    deliveriesError: { message: 'Delivery table query failed' },
  });

  const reqB = { method: 'GET', headers: { authorization: 'Bearer mock-jwt' } };
  const resB = createMockResponse();

  await userHandler(reqB, resB, mockDeliveryError);

  assert.equal(resB.statusCode, 200);
  assert.equal(resB.body.notifications.length, 1);
  assert.equal(resB.body.notifications[0].id, 'n-stand-2');
  assert.equal(resB.body.unread_count, 1);
});

test('Phase A Case 11: Existing user-scoped authorization remains intact', async () => {
  // Missing authorization header
  const reqNoAuth = { method: 'GET', headers: {} };
  const resNoAuth = createMockResponse();
  await userHandler(reqNoAuth, resNoAuth);
  assert.equal(resNoAuth.statusCode, 401);

  // Invalid authorization token
  const mockInvalidAuth = createInboxMockSupabase({ user: null });
  const reqInvalid = { method: 'GET', headers: { authorization: 'Bearer invalid' } };
  const resInvalid = createMockResponse();
  await userHandler(reqInvalid, resInvalid, mockInvalidAuth);
  assert.equal(resInvalid.statusCode, 401);
});

test('Phase A Case 12: Existing PATCH mark-read behavior remains unchanged', async () => {
  const mockSupabase = createInboxMockSupabase();

  // 12a: Mark single notification
  const reqSingle = {
    method: 'PATCH',
    headers: { authorization: 'Bearer mock-jwt' },
    body: { notification_id: 'n-999' },
  };
  const resSingle = createMockResponse();
  await userHandler(reqSingle, resSingle, mockSupabase);

  assert.equal(resSingle.statusCode, 200);
  assert.equal(resSingle.body.success, true);
  assert.equal(resSingle.body.notification.id, 'n-999');
  assert.equal(resSingle.body.notification.is_read, true);

  // 12b: Mark all as read
  const reqAll = {
    method: 'PATCH',
    headers: { authorization: 'Bearer mock-jwt' },
    body: { mark_all: true },
  };
  const resAll = createMockResponse();
  await userHandler(reqAll, resAll, mockSupabase);

  assert.equal(resAll.statusCode, 200);
  assert.equal(resAll.body.success, true);
  assert.equal(resAll.body.message, 'All notifications marked as read.');

  // 12c: Missing parameters
  const reqMissing = {
    method: 'PATCH',
    headers: { authorization: 'Bearer mock-jwt' },
    body: {},
  };
  const resMissing = createMockResponse();
  await userHandler(reqMissing, resMissing, mockSupabase);

  assert.equal(resMissing.statusCode, 400);
  assert.equal(resMissing.body.error, 'notification_id or mark_all:true is required.');
});

test('Phase A Case 13: Stable pagination ordering with identical created_at across multiple pages', async () => {
  const fixedTimestamp = '2026-11-10T10:00:00.000Z';

  // 70 notifications all sharing the exact same created_at timestamp
  // notif-070 down to notif-041 (30 items) are cancelled without delivery (hidden)
  // notif-040 down to notif-001 (40 items) are standalone (visible)
  const allNotifications = [];
  const expectedVisibleIds = [];

  for (let i = 1; i <= 70; i++) {
    const id = `notif-${String(i).padStart(3, '0')}`;
    if (i > 40) {
      // 30 items with higher IDs: cancelled without delivery
      allNotifications.push({
        id,
        campaign_id: 'c-canc',
        created_at: fixedTimestamp,
        is_read: false,
      });
    } else {
      // 40 items with lower IDs: standalone visible
      allNotifications.push({
        id,
        campaign_id: null,
        created_at: fixedTimestamp,
        is_read: false,
      });
      expectedVisibleIds.push(id);
    }
  }

  // Shuffle the initial list to verify database ordering clauses do the sorting
  const shuffled = [...allNotifications].reverse();

  // Stable expected order: created_at DESC (all equal), id DESC ('notif-040' down to 'notif-001')
  expectedVisibleIds.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  const mockSupabase = createInboxMockSupabase({
    userNotifications: shuffled,
    campaigns: [{ id: 'c-canc', status: 'cancelled' }],
    deliveries: [],
  });

  const req = { method: 'GET', headers: { authorization: 'Bearer mock-jwt' } };
  const res = createMockResponse();

  await userHandler(req, res, mockSupabase);

  assert.equal(res.statusCode, 200);

  const returnedIds = res.body.notifications.map((n) => n.id);

  // 1. Spanned at least two pagination pages:
  // Page 1 (offset 0..49) had 30 hidden items + 20 visible items ('notif-040' to 'notif-021').
  // Page 2 (offset 50..69) had 20 visible items ('notif-020' to 'notif-001').
  // Total collected visible items = 40.
  assert.equal(returnedIds.length, 40);

  // 2. Stable ordering across pages: strictly descending by id
  for (let i = 0; i < returnedIds.length - 1; i++) {
    assert.ok(
      returnedIds[i] > returnedIds[i + 1],
      `Expected stable order: ${returnedIds[i]} > ${returnedIds[i + 1]}`
    );
  }

  // 3. No duplicated notification IDs
  const uniqueIds = new Set(returnedIds);
  assert.equal(uniqueIds.size, returnedIds.length);

  // 4. No skipped expected notification IDs
  assert.deepEqual(returnedIds, expectedVisibleIds);
});
