// Guarda la app para que abra sin conexión. Cambie la versión al publicar cambios.
const V = 'arana-v44';
const FILES = ['./', './index.html', './ajedrez/', './ajedrez/index.html', './ajedrez/motor.js', './ajedrez/sala.js', './ajedrez/worker.js', './ajedrez/gpu.js', './ajedrez/red.js', './ajedrez/mcts.js', './ajedrez/gpu.html', './ajedrez/piezas.js', './ajedrez/stockfish/stockfish-19-lite-single.js', './ajedrez/stockfish/stockfish-19-lite-single.wasm', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;   // Lichess y demás: siempre a la red
  // Stockfish y las piezas no cambian: primero lo guardado (no se vuelve a descargar 1,8 MB cada vez)
  if (/\/ajedrez\/(stockfish\/|piezas\.js)/.test(u.pathname)) {
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(x => { const c = x.clone(); caches.open(V).then(k => k.put(e.request, c)).catch(() => {}); return x; })));
    return;
  }
  // Red primero (para ver cambios), caché si no hay conexión
  const fresh = new URL(e.request.url).origin === location.origin ? new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : e.request;
  e.respondWith(fetch(fresh).then(r => { const copy = r.clone(); caches.open(V).then(c => c.put(e.request, copy)).catch(()=>{}); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
