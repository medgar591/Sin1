// Sin1 service worker. Lets the game work offline after one visit.
//   - /assets/* are content-hashed, so immutable: cache-first (precached at install, stored on a miss).
//   - Navigations (index.html): network-first with a short timeout, falling back to
//     the cached shell; stored only on success.
//   - Everything else (manifest, icons): cache-first too; a new build gets a fresh cache.
// The build (see vite.config.ts) fills in PRECACHE_ASSETS and BUILD, so every
// deploy gets its own cache and old ones are deleted on activate.

const CACHE_VERSION = 'v2';
const BUILD = /*__BUILD__*/ 'dev';
const PRECACHE_ASSETS = /*__PRECACHE_ASSETS__*/ [];
const CACHE_NAME = `sin1-${CACHE_VERSION}-${BUILD}`;
const NAV_TIMEOUT_MS = 3000;

const scoped = (p) => new URL(p, self.registration.scope).href;
const SHELL_URL = scoped('./index.html');
const PRECACHE = [
  './', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', ...PRECACHE_ASSETS,
].map(scoped);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sin1-') && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const cacheable = (response) => response && response.ok && response.type === 'basic';

async function cacheFirst(event, request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (cacheable(response)) event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
  return response;
}

async function navigate(event, request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(SHELL_URL);
  const network = fetch(request).then((response) => {
    // Every navigation is the same single-page shell: store it under one key.
    if (cacheable(response)) event.waitUntil(cache.put(SHELL_URL, response.clone()).catch(() => {}));
    return response;
  });
  if (!cached) return network;
  const timeout = new Promise((_, reject) => setTimeout(reject, NAV_TIMEOUT_MS));
  // Offline or slow: serve the cached shell.
  return Promise.race([network, timeout]).catch(() => cached);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const handler = request.mode === 'navigate' ? navigate : cacheFirst;
  event.respondWith(handler(event, request).catch(() => Response.error()));
});
