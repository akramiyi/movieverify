// MovieVerify - Canonical Firebase Messaging Service Worker Fallback
// If Firebase SDK attempts default service worker resolution, delegate directly to the root /sw.js
importScripts('/sw.js');
