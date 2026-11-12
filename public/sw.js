const CACHE_NAME = 'movieverify-v1';
const STATIC_ASSETS = ['/', '/index.html'];

// --- Service Worker Lifecycle: Install & Activate ---

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// --- Fetch Handler: Caching Strategy (Preserved Zero Regression) ---

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  
  // Only handle same-origin GET requests. Let all cross-origin 
  // requests (TMDB API, Supabase, image CDNs) pass through 
  // untouched by not calling respondWith at all.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME)
          .then(cache => cache.put(e.request, clone))
          .catch(() => {});
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(e.request);
        return cached || new Response('Network error', { 
          status: 503, 
          statusText: 'Service Unavailable' 
        });
      })
  );
});

// --- Push Notification Deduplication Store (IndexedDB with 24h retention) ---

const DEDUP_DB_NAME = 'movieverify_pwa_dedup';
const DEDUP_STORE_NAME = 'deliveries';
const DEDUP_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function openDedupDb() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      return resolve(null);
    }
    const req = indexedDB.open(DEDUP_DB_NAME, 1);
    req.onupgradeneeded = (evt) => {
      const db = evt.target.result;
      if (!db.objectStoreNames.contains(DEDUP_STORE_NAME)) {
        db.createObjectStore(DEDUP_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function isDeliveryDuplicateAndRecord(deliveryId) {
  if (!deliveryId) return false;
  const db = await openDedupDb();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction([DEDUP_STORE_NAME], 'readwrite');
      const store = tx.objectStore(DEDUP_STORE_NAME);
      const getReq = store.get(deliveryId);

      getReq.onsuccess = () => {
        if (getReq.result) {
          // Delivery has already been presented to the user
          resolve(true);
        } else {
          // Atomically record delivery ID without storing tokens
          store.put({ id: deliveryId, timestamp: Date.now() });
          resolve(false);
        }
      };

      getReq.onerror = () => resolve(false);

      // Clean up old entries exceeding retention
      tx.oncomplete = () => {
        try {
          const pruneTx = db.transaction([DEDUP_STORE_NAME], 'readwrite');
          const pruneStore = pruneTx.objectStore(DEDUP_STORE_NAME);
          const cursorReq = pruneStore.openCursor();
          const cutoff = Date.now() - DEDUP_MAX_AGE_MS;
          cursorReq.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              if (cursor.value.timestamp < cutoff) {
                cursor.delete();
              }
              cursor.continue();
            }
          };
        } catch {}
      };
    } catch {
      resolve(false);
    }
  });
}

// --- Background Push Notification Handler ---

self.addEventListener('push', (e) => {
  let payload = {};
  try {
    payload = e.data ? e.data.json() : {};
  } catch {
    payload = {
      notification: {
        title: 'MovieVerify',
        body: e.data ? e.data.text() : 'You have a new update.',
      },
    };
  }

  const notification = payload.notification || {};
  const data = payload.data || {};

  const deliveryId = data.delivery_id || payload.delivery_id || '';
  const title = notification.title || data.title || 'MovieVerify';
  const body = notification.body || data.body || 'You have a new update.';
  const imageUrl = notification.imageUrl || notification.image || data.image || null;
  const targetUrl = data.url || payload.fcmOptions?.link || '/';

  e.waitUntil(
    (async () => {
      // 1. Client-side Deduplication
      if (deliveryId) {
        const isDuplicate = await isDeliveryDuplicateAndRecord(deliveryId);
        if (isDuplicate) {
          console.log('[SW] Duplicate delivery suppressed:', deliveryId);
          return;
        }
      }

      // 2. Display Notification
      const options = {
        body,
        icon: '/logo192.png',
        badge: '/badge.png',
        vibrate: [200, 100, 200, 100, 200],
        silent: false,
        renotify: true,
        data: {
          delivery_id: deliveryId,
          url: targetUrl,
        },
        actions: [
          { action: 'open', title: '🎬 Watch Now' },
        ],
        tag: deliveryId || undefined, // Native OS deduplication tag
      };

      if (imageUrl) {
        options.image = imageUrl;
      }

      await self.registration.showNotification(title, options);
    })()
  );
});

// --- Notification Click Handler: Deep Link Navigation ---

self.addEventListener('notificationclick', (e) => {
  e.notification.close();

  if (e.action === 'close') {
    return;
  }

  let targetPath = e.notification.data?.url || '/';
  
  // Security guard: Validate internal deep-link path to prevent open redirects
  if (!targetPath.startsWith('/') && !targetPath.startsWith(self.location.origin)) {
    targetPath = '/';
  }

  const fullTargetUrl = new URL(targetPath, self.location.origin).href;

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 1. If an exact tab matches the destination, focus it
      for (const client of clientList) {
        if (client.url === fullTargetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // 2. If any client window is open, navigate and focus it
      for (const client of clientList) {
        if ('focus' in client && 'navigate' in client) {
          return client.navigate(fullTargetUrl)
            .then((c) => (c && 'focus' in c ? c.focus() : (self.clients.openWindow ? self.clients.openWindow(fullTargetUrl) : null)))
            .catch(() => (self.clients.openWindow ? self.clients.openWindow(fullTargetUrl) : null));
        }
      }
      // 3. If no window is open, open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(fullTargetUrl);
      }
    })
  );
});
