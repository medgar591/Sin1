// Sin1 service worker: caches the app shell on install, then serves
// same-origin GETs network-first with a cache fallback so the game works
// offline after one successful visit. Bump CACHE_VERSION to ship a new shell.

const CACHE_VERSION = 'v1';
const CACHE_NAME = `sin1-${CACHE_VERSION}`;

const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  const urls = SHELL.map((p) => new URL(p, self.registration.scope).href);
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(urls))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('sin1-') && k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response && response.ok && response.type === 'basic') {
          cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      } catch {
        const cached = await cache.match(request, { ignoreSearch: false });
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const shell = await cache.match(new URL('./index.html', self.registration.scope).href);
          if (shell) return shell;
        }
        return Response.error();
      }
    })(),
  );
});
