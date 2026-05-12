const CACHE_VERSION = 'v6';
const CACHE_NAME = `cronoapp-offline-${CACHE_VERSION}`;
// Assets are content-addressed (hashed filenames) — safe to keep across SW versions
const RUNTIME_CACHE = `cronoapp-assets`;
const KEEP_CACHES = new Set([CACHE_NAME, RUNTIME_CACHE]);

const PRECACHE_URLS = [
  '/offline.html',
  '/admin/dashboard/',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.map((key) => (!KEEP_CACHES.has(key) ? caches.delete(key) : null))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Nunca interceptar el propio sw.js ni rutas de Firebase Auth
  if (url.pathname === '/sw.js' || url.hostname.includes('firebaseapp.com')) return;

  // Activos estáticos con hash en el nombre (_next/static/) → cache-first (el hash garantiza frescura)
  const isHashedAsset =
    url.origin === self.location.origin &&
    url.pathname.startsWith('/_next/static/');

  if (isHashedAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          return response;
        });
      })
    );
    return;
  }

  // Páginas HTML → network-first; si falla sirve desde caché
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          // 1. Página exacta en caché
          const cached = await caches.match(request);
          if (cached) return cached;
          // 2. Para cualquier ruta admin intentar el dashboard (siempre pre-cacheado)
          if (url.pathname.startsWith('/admin/') || url.pathname === '/') {
            const dashboard = await caches.match('/admin/dashboard/');
            if (dashboard) return dashboard;
          }
          // 3. Fallback final
          return caches.match('/offline.html');
        })
    );
    return;
  }
});
