import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Notification icon assets (/logo192.png and /favicon.ico) exist with valid headers', () => {
  const pngPath = path.resolve('public/logo192.png');
  const icoPath = path.resolve('public/favicon.ico');

  assert.equal(fs.existsSync(pngPath), true, 'public/logo192.png must exist');
  assert.equal(fs.existsSync(icoPath), true, 'public/favicon.ico must exist');

  const pngBytes = fs.readFileSync(pngPath);
  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  assert.deepEqual(
    [...pngBytes.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  );

  const icoBytes = fs.readFileSync(icoPath);
  // ICO header reserved=0, type=1
  assert.equal(icoBytes.readUInt16LE(0), 0);
  assert.equal(icoBytes.readUInt16LE(2), 1);
  assert.ok(icoBytes.readUInt16LE(4) >= 1);
});

test('Navbar connects Bell to onNotificationClick, displays unread count, and revokes push token before signOut', () => {
  const navbarCode = fs.readFileSync(path.resolve('src/components/Navbar.jsx'), 'utf-8');

  assert.match(navbarCode, /onClick=\{\(\)\s*=>\s*onNotificationClick\s*&&\s*onNotificationClick\(\)\}/);
  assert.match(navbarCode, /displayedUnreadCount\s*>\s*0/);
  assert.match(navbarCode, /revokePushTokenBeforeSignOut/);

  const signOutFnStart = navbarCode.indexOf('const handleSignOut');
  const revokeIdx = navbarCode.indexOf('revokePushTokenBeforeSignOut()', signOutFnStart);
  const supabaseSignOutIdx = navbarCode.indexOf('supabase.auth.signOut()', signOutFnStart);
  assert.ok(revokeIdx !== -1 && supabaseSignOutIdx !== -1);
  assert.ok(revokeIdx < supabaseSignOutIdx, 'Token revocation must execute before supabase.auth.signOut()');
});

test('MovieDetailsModal uses Supabase-backed useSubscriptions instead of useNotifyList and shows sign-in prompt when logged out', () => {
  const modalCode = fs.readFileSync(path.resolve('src/components/MovieDetailsModal.jsx'), 'utf-8');
  const subsCode = fs.readFileSync(path.resolve('src/hooks/useSubscriptions.js'), 'utf-8');

  assert.doesNotMatch(modalCode, /useNotifyList/);
  assert.match(modalCode, /useSubscriptions/);
  assert.match(modalCode, /onRequireAuth/);
  assert.match(modalCode, /notify-signin-prompt/);
  assert.match(subsCode, /movie_notify_requests/);
  assert.match(subsCode, /requiresAuth:\s*true/);
});

test('App wires foreground FCM toast/unread refresh and NotificationCenter propagates unread updates', () => {
  const appCode = fs.readFileSync(path.resolve('src/App.jsx'), 'utf-8');
  const ncCode = fs.readFileSync(path.resolve('src/components/NotificationCenter.jsx'), 'utf-8');
  const prefsCode = fs.readFileSync(path.resolve('src/components/NotificationPreferences.jsx'), 'utf-8');

  assert.match(appCode, /usePushNotifications\(\{\s*onForegroundMessage:\s*handleForegroundMessage\s*\}\)/);
  assert.match(appCode, /unreadNotificationCount=\{unreadNotifications\}/);
  assert.match(appCode, /onUnreadCountChange=\{setUnreadNotifications\}/);
  assert.match(appCode, /onRequireAuth=\{handleOpenAuthModal\}/);

  assert.match(ncCode, /onUnreadCountChange/);
  assert.match(prefsCode, /device-push-toggle-btn/);
  assert.match(prefsCode, /notify_new_series/);
  assert.match(prefsCode, /opt_in_all/);
});

