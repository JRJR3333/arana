// Guarda la app para que abra sin conexión. Cambie la versión al publicar cambios.
const V = 'arana-v29';
const FILES = ['./', './index.html', './ajedrez/', './ajedrez/index.html', './ajedrez/motor.js', './ajedrez/sala.js', './ajedrez/worker.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Red primero (para ver cambios), caché si no hay conexión
  const fresh = new URL(e.request.url).origin === location.origin ? new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : e.request;
  e.respondWith(fetch(fresh).then(r => { const copy = r.clone(); caches.open(V).then(c => c.put(e.request, copy)).catch(()=>{}); return r; }).catch(() => caches.match(e.request)));
});
