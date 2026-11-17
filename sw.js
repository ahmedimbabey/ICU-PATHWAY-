// Service worker: offline support for ICU Pathways.
// IMPORTANT: bump CACHE_VERSION whenever any app file listed below changes,
// otherwise returning users keep the old cached copies.
const CACHE_VERSION = 'v2';
const CACHE_PREFIX = 'icu-pathways-app-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
// Pathway files live in a separate, unversioned cache so bumping CACHE_VERSION never wipes them.
const DATA_CACHE = 'icu-pathways-data';
const NETWORK_TIMEOUT_MS = 4000;
const APP_FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'src/ui.js',
  'src/library.js',
  'src/store.js',
  'src/engine.js',
  'src/validate.js',
  'src/strings.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((c) => c.addAll(APP_FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(precachePathways)
      .then(() => self.skipWaiting())
  );
});

// Fetch pathways/index.json and every file it lists. Individual failures are tolerated.
async function precachePathways() {
  try {
    const cache = await caches.open(DATA_CACHE);
    const res = await fetch(new Request('pathways/index.json', { cache: 'reload' }));
    if (!res.ok) return;
    const files = await res.clone().json();
    await cache.put('pathways/index.json', res);
    if (!Array.isArray(files)) return;
    await Promise.all(files.filter((f) => typeof f === 'string').map(async (f) => {
      try {
        const r = await fetch(new Request('pathways/' + f, { cache: 'reload' }));
        if (r.ok) await cache.put('pathways/' + f, r);
      } catch (e) { /* ignore: one bad file must not abort install */ }
    }));
  } catch (e) { /* offline or malformed index at install: skip */ }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function inPathways(url) {
  const base = new URL('pathways/', self.registration.scope).href;
  return url.href.startsWith(base);
}

function offlineCopy(hit) {
  const headers = new Headers(hit.headers);
  headers.set('x-offline-copy', '1');
  return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
}

// A redirect (opaqueredirect for page loads) is passed on; 4xx/5xx and other errors are not.
const usable = (res) => res.ok || res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400);

const timeout = () => new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));

// Network first with a time limit. A network error, a timeout or a non-OK (404/5xx) answer
// falls back to the saved copy when there is one. Only OK answers are saved.
//   network: promise of the network Response (it saves OK answers itself)
//   saved:   () => promise of the cached Response or undefined
//   mark:    turns a cached Response into the one sent to the page
async function withFallback(event, network, saved, mark) {
  let res;
  try {
    res = await Promise.race([network, timeout()]);
  } catch (err) {
    const hit = await saved();
    if (hit) return mark(hit);
    throw err;
  }
  if (res && usable(res)) return res;
  const hit = await saved();
  if (hit) {
    // Timed out: let the slow request finish in the background so the cache is refreshed.
    if (!res) event.waitUntil(network.then(() => {}, () => {}));
    return mark(hit);
  }
  return res || network; // nothing saved: pass the bad answer on, or keep waiting
}

function networkFirst(event, request) {
  const cache = caches.open(DATA_CACHE);
  const network = fetch(request).then(async (res) => {
    if (res && res.ok) await (await cache).put(request, res.clone());
    return res;
  });
  return withFallback(event, network,
    async () => (await cache).match(request, { ignoreSearch: true }), offlineCopy);
}

function isAppPage(url) {
  const scope = new URL(self.registration.scope);
  return url.origin === scope.origin &&
    (url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html');
}

// Page loads: same time limit as pathways, falling back to the saved index.html.
function navigate(event, request) {
  const cache = caches.open(CACHE_NAME);
  const network = fetch(request).then(async (res) => {
    if (res && res.ok && !res.redirected && isAppPage(new URL(request.url))) {
      const c = await cache;
      await Promise.all([c.put('index.html', res.clone()), c.put('./', res.clone())]);
    }
    return res;
  });
  return withFallback(event, network, async () => (await cache).match('index.html'), (hit) => hit);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (inPathways(url)) {
    event.respondWith(networkFirst(event, req));
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(navigate(event, req));
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      return hit || fetch(req);
    })
  );
});
