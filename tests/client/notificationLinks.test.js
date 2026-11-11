import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  resolveNotificationTargetUrl,
  parseNotificationMovieLink,
} from '../../src/utils/notificationLinks.js';

test('NotificationLinks - resolveNotificationTargetUrl supports action_url and legacy url', () => {
  assert.equal(
    resolveNotificationTargetUrl({
      action_url: '/?type=movie&id=550',
      url: '/?type=movie&id=999',
    }),
    '/?type=movie&id=550'
  );

  assert.equal(
    resolveNotificationTargetUrl({
      action_url: null,
      url: '/?type=tv&id=71446',
    }),
    '/?type=tv&id=71446'
  );

  assert.equal(
    resolveNotificationTargetUrl({ action_url: '   ', url: '/?type=movie&id=550' }),
    '/?type=movie&id=550'
  );

  assert.equal(resolveNotificationTargetUrl({ action_url: null, url: null }), null);
  assert.equal(resolveNotificationTargetUrl(null), null);
});

test('NotificationLinks - parseNotificationMovieLink parses canonical Test 8 N8 URL and rejects non-movie/external links', () => {
  const n8Target = resolveNotificationTargetUrl({
    id: 'ffffffff-0000-0000-0000-000000000080',
    title: 'Smoke Test In-App Notification',
    action_url: '/?type=movie&id=550',
    is_read: false,
  });

  assert.equal(n8Target, '/?type=movie&id=550');

  assert.deepEqual(parseNotificationMovieLink(n8Target, 'Smoke Test In-App Notification'), {
    id: '550',
    title: 'Smoke Test In-App Notification',
    mediaType: 'movie',
    media_type: 'movie',
  });

  assert.deepEqual(parseNotificationMovieLink('/?type=tv&id=71446', 'Money Heist'), {
    id: '71446',
    title: 'Money Heist',
    mediaType: 'tv',
    media_type: 'tv',
  });

  assert.deepEqual(parseNotificationMovieLink('/movies?id=123-smoke-test', 'Legacy Slug'), {
    id: '123',
    title: 'Legacy Slug',
  });

  assert.equal(parseNotificationMovieLink('/genre/action', 'Action'), null);
  assert.equal(parseNotificationMovieLink('https://evil.example/?type=movie&id=550', 'External'), null);
});

test('NotificationCenter - handles click with action_url for movie selection, URL sync, modal open, and read-state marking', () => {
  const componentCode = fs.readFileSync(
    path.resolve('src/components/NotificationCenter.jsx'),
    'utf-8'
  );

  assert.match(componentCode, /resolveNotificationTargetUrl\(item\)/);
  assert.match(componentCode, /parseNotificationMovieLink\(targetUrl,\s*item\.title\)/);
  assert.match(componentCode, /if\s*\(!item\.is_read\)\s*\{\s*handleMarkAsRead\(item\.id\);/);
  assert.match(componentCode, /onSelectMovie\(movieTarget\);[\s\S]*onClose\(\);/);
});

