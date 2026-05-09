// Knitwittage Service Worker — enables offline use and auto-updates
const CACHE_VERSION = 'knitwittage-v121';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/grid-view.js',
  './js/preview.js',
  './js/print.js',
  './js/instructions.js',
  './js/random.js',
  './js/image.js',
  './js/stitches.js',
  './js/stitch-editor.js',
  './js/cables.js',
  './js/gallery.js',
  './js/knit-mode.js',
  './js/tabs.js',
  './knitwittage_icon.png',
  './knitwittage_icon_192.png',
  './knitwittage_icon_512.png',
  './knitwittage_icon_Nobutton.png',
  './icon.svg',
  './manifest.json',
];

// Install: cache all app assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // Force network (bypass browser HTTP cache) so a new CACHE_VERSION always
      // picks up the latest asset bytes, even if HTTP responses would be reused.
      return Promise.all(ASSETS.map((url) =>
        fetch(url, { cache: 'reload' }).then((res) => {
          if (res.ok) return cache.put(url, res);
        })
      ));
    }).then(() => {
      // Activate immediately without waiting for old tabs to close
      return self.skipWaiting();
    })
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key))
      );
    }).then(() => {
      // Take control of all open tabs immediately
      return self.clients.claim();
    })
  );
});

// Fetch: serve from cache first, fall back to network, update cache
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      // Return cached version immediately
      const fetchPromise = fetch(event.request).then((response) => {
        // Update cache with fresh version for next time
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(() => {
        // Network failed — cached version is all we have
        return cached;
      });

      // Return cached immediately, but also fetch in background to update
      return cached || fetchPromise;
    })
  );
});
