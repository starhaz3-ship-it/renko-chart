/* Renko On-Device — service worker (bundle). Caches the app shell for install + fast launch;
   live Binance data + the chart-lib CDN always go to the network. */
const CACHE = 'renko-app-v1';
const SHELL = ['./', 'index.html', 'renko_compute.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => {})); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;                 // Binance + CDN -> network
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
