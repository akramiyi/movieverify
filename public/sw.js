const CACHE_NAME = 'movieverify-v1';
const STATIC_ASSETS = ['/', '/index.html'];

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
