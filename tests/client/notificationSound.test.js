import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  isNotificationSoundEnabled,
  setNotificationSoundEnabled,
  playNotificationSound,
  NOTIFICATION_SOUND_STORAGE_KEY,
} from '../../src/utils/notificationSound.js';

test('Custom Notification Sound Suite', async (t) => {
  await t.test('1. Static audio assets (/notification.mp3 & /notification.aac) exist in public directory', () => {
    const mp3Path = path.resolve('public/notification.mp3');
    const aacPath = path.resolve('public/notification.aac');

    assert.ok(fs.existsSync(mp3Path), 'public/notification.mp3 must exist');
    assert.ok(fs.existsSync(aacPath), 'public/notification.aac must exist');

    const mp3Stat = fs.statSync(mp3Path);
    const aacStat = fs.statSync(aacPath);

    assert.ok(mp3Stat.size > 1000, 'public/notification.mp3 size must be valid (>1KB)');
    assert.ok(aacStat.size > 1000, 'public/notification.aac size must be valid (>1KB)');
  });

  await t.test('2. Service Worker (public/sw.js) registers custom notification sound in showNotification options', () => {
    const swPath = path.resolve('public/sw.js');
    const swCode = fs.readFileSync(swPath, 'utf8');

    assert.match(
      swCode,
      /sound:\s*['"]\/notification\.mp3['"]/,
      'public/sw.js must configure sound: /notification.mp3 in notification options'
    );
  });

  await t.test('3. isNotificationSoundEnabled and setNotificationSoundEnabled manage localStorage state', () => {
    const storage = new Map();
    const mockLocalStorage = {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    };

    const origWindow = globalThis.window;
    globalThis.window = { localStorage: mockLocalStorage };

    try {
      // Default should be true (sound enabled by default)
      assert.equal(isNotificationSoundEnabled(), true);

      // Disable sound
      setNotificationSoundEnabled(false);
      assert.equal(mockLocalStorage.getItem(NOTIFICATION_SOUND_STORAGE_KEY), 'false');
      assert.equal(isNotificationSoundEnabled(), false);

      // Re-enable sound
      setNotificationSoundEnabled(true);
      assert.equal(mockLocalStorage.getItem(NOTIFICATION_SOUND_STORAGE_KEY), 'true');
      assert.equal(isNotificationSoundEnabled(), true);
    } finally {
      if (origWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = origWindow;
      }
    }
  });

  await t.test('4. playNotificationSound respects mute state and force preview flag', () => {
    const storage = new Map();
    let playedSrc = null;

    class MockAudio {
      constructor(src) {
        this.src = src;
        this.volume = 1;
      }
      play() {
        playedSrc = this.src;
        return Promise.resolve();
      }
    }

    const origWindow = globalThis.window;
    const origAudio = globalThis.Audio;

    globalThis.window = {
      localStorage: {
        getItem: (k) => (storage.has(k) ? storage.get(k) : null),
        setItem: (k, v) => storage.set(k, String(v)),
      },
      Audio: MockAudio,
    };
    globalThis.Audio = MockAudio;

    try {
      // When enabled, plays sound
      playedSrc = null;
      setNotificationSoundEnabled(true);
      const audio1 = playNotificationSound(false);
      assert.ok(audio1, 'playNotificationSound should return an audio instance');
      assert.equal(playedSrc, '/notification.mp3');

      // When muted, does not play unless forced
      playedSrc = null;
      setNotificationSoundEnabled(false);
      const audio2 = playNotificationSound(false);
      assert.equal(audio2, null, 'playNotificationSound should return null when muted');
      assert.equal(playedSrc, null);

      // When forced (Preview / Test button), plays even if muted
      playedSrc = null;
      const audio3 = playNotificationSound(true);
      assert.ok(audio3);
      assert.equal(playedSrc, '/notification.mp3');
    } finally {
      if (origWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = origWindow;
      }
      if (origAudio === undefined) {
        delete globalThis.Audio;
      } else {
        globalThis.Audio = origAudio;
      }
    }
  });

  await t.test('5. NotificationPreferences.jsx renders sound controls with preview and mute toggles', () => {
    const prefPath = path.resolve('src/components/NotificationPreferences.jsx');
    const prefCode = fs.readFileSync(prefPath, 'utf8');

    assert.match(
      prefCode,
      /data-testid=["']notification-sound-control["']/,
      'NotificationPreferences must render notification-sound-control container'
    );
    assert.match(
      prefCode,
      /handlePreviewSound/,
      'NotificationPreferences must support previewing the notification sound'
    );
    assert.match(
      prefCode,
      /handleToggleSound/,
      'NotificationPreferences must support toggling notification sound'
    );
  });

  await t.test('6. App.jsx calls playNotificationSound on incoming foreground messages', () => {
    const appPath = path.resolve('src/App.jsx');
    const appCode = fs.readFileSync(appPath, 'utf8');

    assert.match(
      appCode,
      /import\s*\{[^}]*playNotificationSound[^}]*\}\s*from\s*['"]\.\/utils\/notificationSound['"]/,
      'App.jsx must import playNotificationSound'
    );
    assert.match(
      appCode,
      /playNotificationSound\(\)/,
      'App.jsx must invoke playNotificationSound inside handleForegroundMessage'
    );
  });
});
