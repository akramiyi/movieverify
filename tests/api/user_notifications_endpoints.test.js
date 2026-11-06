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
              order: () => ({
                limit: async () => ({
                  data: [
                    { id: 'n-1', title: 'Movie Alert', is_read: false },
                    { id: 'n-2', title: 'System Notice', is_read: true },
                  ],
                  error: null,
                }),
              }),
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
  let deleted = false;
  const mockSupabase = {
    auth: {
      getUser: async () => ({
        data: { user: { id: 'usr-789' } },
        error: null,
      }),
    },
    from: (table) => {
      assert.equal(table, 'notification_opt_outs');
      return {
        delete: () => ({
          eq: (col1, val1) => {
            assert.equal(col1, 'user_id');
            assert.equal(val1, 'usr-789');
            return {
              eq: async (col2, val2) => {
                assert.equal(col2, 'category');
                assert.equal(val2, 'movie_release');
                deleted = true;
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
  assert.equal(deleted, true);
});
