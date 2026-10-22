#!/usr/bin/env node
/* Araña · servidor de ajedrez para Linux sin entorno gráfico (Arch, systemd).
   - Abre la sala de ajedrez en un Chromium sin ventana (headless) que entrena 24 horas: hilos de verdad, Stockfish y
     la memoria (IndexedDB) guardada en disco. Es la misma sala que la web y las apps: no hay código aparte.
   - En ARANA_PUERTO (8733) sirve un visor: desde el móvil, por Tailscale, se ve la sala en directo y se toca como si fuera
     la de verdad (tocar, arrastrar para moverse, pellizcar para el zoom, escribir, descargar e importar archivos).
   - Solo acepta conexiones de Tailscale (100.64.0.0/10 y fd7a:115c:a1e0::/48) y del propio aparato.
   Requisitos: node 22 o posterior y chromium (pacman -S nodejs chromium). Sin paquetes de npm.
   Variables: ARANA_PUERTO, ARANA_DATOS (~/.local/share/arana), ARANA_CHROMIUM, ARANA_ABIERTO=1 (aceptar cualquier red). */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), { spawn, execFileSync } = require('child_process');

const PUERTO = +process.env.ARANA_PUERTO || 8733, PUERTO_SALA = PUERTO + 1;
const WEB = path.resolve(__dirname, '..');
const DATOS = process.env.ARANA_DATOS || path.join(os.homedir(), '.local/share/arana');
const DESCARGAS = path.join(DATOS, 'descargas'), SUBIDAS = path.join(DATOS, 'subidas');
for (const d of [DATOS, DESCARGAS, SUBIDAS]) fs.mkdirSync(d, { recursive: true });
const URL_SALA = `http://127.0.0.1:${PUERTO_SALA}/ajedrez/?plat=linux`;
const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);

if (typeof WebSocket === 'undefined') { console.error('Hace falta Node 22 o posterior (pacman -S nodejs).'); process.exit(1); }
function buscarChromium() {
  if (process.env.ARANA_CHROMIUM) return process.env.ARANA_CHROMIUM;
  for (const n of ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome']) { try { return execFileSync('which', [n]).toString().trim(); } catch (e) {} }
  console.error('No encuentro Chromium. Instálelo con: sudo pacman -S chromium'); process.exit(1);
}

/* ───── Archivos de la web (solo para el Chromium de dentro: origen fijo, así su memoria siempre es la misma) ───── */
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.md': 'text/plain; charset=utf-8' };
function servirArchivo(raiz, ruta, res) {
  let f = path.normalize(path.join(raiz, decodeURIComponent(ruta.split('?')[0])));
  if (!f.startsWith(raiz)) { res.writeHead(403); return res.end(); }
  try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch (e) {}
  fs.readFile(f, (err, b) => {
    if (err) { res.writeHead(404); return res.end('no está'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(b);
  });
}
http.createServer((req, res) => servirArchivo(WEB, req.url, res)).listen(PUERTO_SALA, '127.0.0.1');

/* ───── Chromium sin ventana y su protocolo de depuración (CDP) ───── */
let pagina = null, navegador = null, sigId = 0, ancho = 412, alto = 860, dpr = 2;
const espera = new Map();
function cdp(ws, metodo, params) { return new Promise((ok, ko) => { const id = ++sigId; espera.set(id, { ok, ko }); ws.send(JSON.stringify({ id, method: metodo, params: params || {} })); setTimeout(() => { if (espera.delete(id)) ko(new Error('sin respuesta: ' + metodo)); }, 30000); }); }
const P = (m, p) => pagina ? cdp(pagina, m, p).catch(e => log('cdp', m, e.message)) : Promise.resolve();
function conectar(url, alEvento) {
  return new Promise((ok, ko) => {
    const ws = new WebSocket(url);
    ws.onopen = () => ok(ws); ws.onerror = e => ko(new Error('websocket ' + url));
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && espera.has(m.id)) { const w = espera.get(m.id); espera.delete(m.id); m.error ? w.ko(new Error(m.error.message)) : w.ok(m.result); } else if (m.method) alEvento(m.method, m.params); };
    ws.onclose = () => { log('Chromium cerró la conexión; salgo para que systemd me reinicie.'); process.exit(1); };
  });
}
async function arrancar() {
  const perfil = path.join(DATOS, 'chromium');
  const args = ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--mute-audio', '--hide-scrollbars',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--disable-features=IntensiveWakeUpThrottling,CalculateNativeWinOcclusion', '--remote-allow-origins=*',
    `--user-data-dir=${perfil}`, '--remote-debugging-port=0', `--window-size=${ancho},${alto}`, URL_SALA];
  if (process.getuid && process.getuid() === 0) args.unshift('--no-sandbox');
  const ch = spawn(buscarChromium(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  ch.on('exit', c => { log('Chromium terminó (' + c + '); salgo para que systemd me reinicie.'); process.exit(1); });
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { ch.kill('SIGTERM'); setTimeout(() => process.exit(0), 3000); });
  const wsNav = await new Promise((ok, ko) => { let b = ''; ch.stderr.on('data', d => { b += d; const m = b.match(/DevTools listening on (ws:\S+)/); if (m) ok(m[1]); }); setTimeout(() => ko(new Error('Chromium no arranca:\n' + b)), 30000); });
  const base = wsNav.replace(/^ws:/, 'http:').replace(/\/devtools\/.*/, '');
  navegador = await conectar(wsNav, eventoNavegador);
  await cdp(navegador, 'Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: DESCARGAS, eventsEnabled: true });
  let lista = []; for (let i = 0; i < 50 && !lista.find(t => t.type === 'page'); i++) { try { lista = await (await fetch(base + '/json/list')).json(); } catch (e) {} await new Promise(r => setTimeout(r, 200)); }
  const t = lista.find(t => t.type === 'page'); if (!t) throw new Error('sin página');
  pagina = await conectar(t.webSocketDebuggerUrl, eventoPagina);
  await P('Page.enable'); await P('Runtime.enable'); await P('Inspector.enable');
  await P('Page.setInterceptFileChooserDialog', { enabled: true });
  await metricas();
  log(`Sala abierta en el Chromium de dentro (${URL_SALA}).`);
  setInterval(vigilar, 60000);
}
const metricas = () => P('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: dpr, mobile: true });

/* ───── Eventos de la página ───── */
const nombresDesc = new Map();
function eventoNavegador(m, p) {
  if (m === 'Browser.downloadWillBegin') nombresDesc.set(p.guid, p.suggestedFilename || 'archivo');
  if (m === 'Browser.downloadProgress' && p.state === 'completed') {
    const nombre = (nombresDesc.get(p.guid) || 'archivo').replace(/[\/\\]/g, '_'), final = Date.now() + '-' + nombre;
    try { fs.renameSync(path.join(DESCARGAS, p.guid), path.join(DESCARGAS, final)); } catch (e) {}
    log('Descarga lista:', final); enviar('descarga', { nombre: final });
  }
}
let elegir = null;
function eventoPagina(m, p) {
  if (m === 'Page.screencastFrame') { P('Page.screencastFrameAck', { sessionId: p.sessionId }); ultimo = { data: p.data, w: p.metadata.deviceWidth, h: p.metadata.deviceHeight }; repartir(); }
  else if (m === 'Inspector.targetCrashed') { log('La página se ha caído; la recargo.'); setTimeout(() => P('Page.navigate', { url: URL_SALA }), 2000); }
  else if (m === 'Page.fileChooserOpened') { elegir = p.backendNodeId; enviar('elegir', {}); }
  else if (m === 'Runtime.consoleAPICalled' && p.type === 'error') log('consola:', p.args.map(a => a.value || a.description || '').join(' ').slice(0, 300));
}
async function vigilar() {   // si la página se ha ido de la sala (o se ha quedado en blanco), vuelve
  const r = await P('Runtime.evaluate', { expression: "location.pathname + '|' + (!!window.__sala)", returnByValue: true });
  const v = r && r.result && r.result.value;
  if (!v || !v.startsWith('/ajedrez/') || v.endsWith('false')) { log('La sala no está (' + v + '); la vuelvo a abrir.'); P('Page.navigate', { url: URL_SALA }); }
}
async function estado() {
  const r = await P('Runtime.evaluate', { returnByValue: true, expression: `(() => { const s = window.__sala; if (!s) return null; const e = s.estado(), c = s.campeona && s.campeona();
    return { gen: e.gen, entrena: document.querySelector('#go').textContent.includes('Pausar'), peldano: e.escalera && e.escalera.peldano, campeona: c ? c.nombre + ' (' + Math.round(c.elo) + ')' : null, texto: document.querySelector('#estado').textContent, rend: s.textoRend && s.textoRend() }; })()` });
  return r && r.result ? r.result.value : null;
}

/* ───── El visor: pantalla en directo por SSE, toques por POST ───── */
const clientes = new Set(); let ultimo = null, emitiendo = false;
function enviar(tipo, datos) { const l = `event: ${tipo}\ndata: ${JSON.stringify(datos)}\n\n`; for (const c of clientes) c.res.write(l); }
function repartir() { for (const c of clientes) if (!c.ocupado && ultimo) { c.ocupado = !c.res.write(`event: imagen\ndata: ${JSON.stringify(ultimo)}\n\n`); if (c.ocupado) c.res.once('drain', () => { c.ocupado = false; }); } }
async function emitir(si) {
  if (si === emitiendo) return; emitiendo = si;
  if (si) await P('Page.startScreencast', { format: 'jpeg', quality: 72, maxWidth: Math.round(ancho * dpr), maxHeight: Math.round(alto * dpr), everyNthFrame: 1 });
  else { await P('Page.stopScreencast'); ultimo = null; }   // la próxima vez, nada de imágenes viejas
}
const permitido = ip => process.env.ARANA_ABIERTO === '1' || /^(::ffff:)?127\./.test(ip) || ip === '::1' || /^(::ffff:)?100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) || /^fd7a:115c:a1e0:/i.test(ip);
const cuerpo = req => new Promise(ok => { const b = []; req.on('data', d => b.push(d)); req.on('end', () => ok(Buffer.concat(b))); });
async function entrada(e) {
  if (e.tipo === 'tamano') { ancho = Math.max(320, Math.min(1600, Math.round(e.w))); alto = Math.max(400, Math.min(2000, Math.round(e.h))); dpr = Math.max(1, Math.min(3, e.dpr || 2)); await metricas(); if (emitiendo) { emitiendo = false; await P('Page.stopScreencast'); emitir(true); } return; }
  if (e.tipo === 'toque') { for (const type of ['mousePressed', 'mouseReleased']) await P('Input.dispatchMouseEvent', { type, x: e.x, y: e.y, button: 'left', clickCount: 1 }); return; }
  if (e.tipo === 'mover') return P('Input.dispatchMouseEvent', { type: 'mouseWheel', x: e.x, y: e.y, deltaX: e.dx, deltaY: e.dy });
  if (e.tipo === 'zoom') return P('Input.dispatchMouseEvent', { type: 'mouseWheel', x: e.x, y: e.y, deltaX: 0, deltaY: e.dy, modifiers: 2 });   // como Ctrl + rueda: la sala hace zoom
  if (e.tipo === 'texto') return P('Input.insertText', { text: String(e.t || '').slice(0, 4000) });
  if (e.tipo === 'tecla') { const K = { Enter: 13, Backspace: 8, Escape: 27, Tab: 9, ' ': 32 }; for (const type of ['keyDown', 'keyUp']) await P('Input.dispatchKeyEvent', { type, key: e.key, code: e.key, windowsVirtualKeyCode: K[e.key] || 0, text: type === 'keyDown' && e.key === 'Enter' ? '\r' : undefined }); return; }
  if (e.tipo === 'recargar') return P('Page.navigate', { url: URL_SALA });
}
const visor = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || '';
  if (!permitido(ip)) { res.writeHead(403); return res.end('Solo por Tailscale.'); }
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/' || u.pathname === '/visor') return servirArchivo(__dirname, '/visor.html', res);
    if (u.pathname === '/eventos') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      const c = { res, ocupado: false }; clientes.add(c); res.write(': hola\n\n'); emitir(true); if (ultimo) repartir();
      const t = setInterval(async () => { res.write(`event: estado\ndata: ${JSON.stringify(await estado())}\n\n`); }, 5000);
      req.on('close', () => { clearInterval(t); clientes.delete(c); if (!clientes.size) emitir(false); });
      return;
    }
    if (u.pathname === '/entrada' && req.method === 'POST') { await entrada(JSON.parse((await cuerpo(req)).toString() || '{}')); res.writeHead(204); return res.end(); }
    if (u.pathname === '/estado') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(await estado())); }
    if (u.pathname === '/descargas') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(fs.readdirSync(DESCARGAS).filter(f => !/^[0-9a-f-]{36}$/.test(f)).sort().reverse())); }
    if (u.pathname.startsWith('/descargas/')) {
      const f = path.join(DESCARGAS, path.basename(decodeURIComponent(u.pathname.slice(11))));
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${path.basename(f).replace(/^\d+-/, '').replace(/"/g, '')}"` });
      return fs.createReadStream(f).pipe(res);
    }
    if (u.pathname === '/subir' && req.method === 'POST') {   // un archivo para el «Importar» de la sala
      const nombre = path.basename(u.searchParams.get('nombre') || 'archivo.json').replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]/g, '_'), f = path.join(SUBIDAS, Date.now() + '-' + nombre);
      fs.writeFileSync(f, await cuerpo(req));
      if (elegir) { await P('DOM.setFileInputFiles', { files: [f], backendNodeId: elegir }); elegir = null; }
      res.writeHead(204); return res.end();
    }
    res.writeHead(404); res.end();
  } catch (e) { log('visor', e.message); res.writeHead(500); res.end(e.message); }
});
let anunciado = false;
const anunciar = () => !anunciado && (anunciado = true) && log(`Visor en el puerto ${PUERTO}: ábralo desde el móvil con la dirección de Tailscale de este aparato (http://<nombre-del-aparato>:${PUERTO}).`);
visor.once('error', () => visor.listen(PUERTO, '0.0.0.0', anunciar));   // sin IPv6
visor.listen(PUERTO, '::', anunciar);

arrancar().catch(e => { log('No he podido arrancar:', e.message); process.exit(1); });
