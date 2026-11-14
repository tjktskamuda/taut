// Taut — service worker: aplikasi tetap bisa dibuka walau koneksi tidak stabil
const V = '1.1.1';
const CACHE = 'taut-v' + V;
const SHELL = [
  './', 'index.html', 'css/app.css?v=' + V, 'js/app.js?v=' + V, 'js/net.js?v=' + V, 'js/util.js?v=' + V, 'js/icons.js?v=' + V,
  'lib/qrcode.js?v=' + V, 'lib/jsQR.js', 'manifest.webmanifest',
  'js/boot.js?v=' + V, 'icons/favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Utamakan jaringan (agar pembaruan langsung terlihat), jatuh ke cache saat luring
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('./');
  }));
});
