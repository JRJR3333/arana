/* La sala de partidas: reparte las partidas entre hilos, dibuja el plano con zoom,
   guarda cada generación en IndexedDB y enseña la ficha y las vistas de la evolución. */
(function () {
'use strict';
const M = window.AjedrezMotor, $ = s => document.querySelector(s);
const qs = new URLSearchParams(location.search);
const ORIGEN = qs.get('plat') || (/android/i.test(navigator.userAgent) || qs.get('app') === 'android' ? 'android' : /iphone|ipad|ipod/i.test(navigator.userAgent) ? 'iphone' : 'web');
const rng = M.mulberry((Math.random() * 4294967296) >>> 0);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const COLOR_ORIGEN = { iphone: '#5ee8ff', android: '#ffb340', web: '#a99bff', inmigrante: '#9a9aa8' };
const colorDe = p => p.mut && p.mut.nacio === 'inmigrante' ? COLOR_ORIGEN.inmigrante : COLOR_ORIGEN[p.origen] || '#9a9aa8';
const fmt = (v, d) => (+v).toFixed(d == null ? 1 : d).replace('.', ',');

/* ───── Opciones (se guardan en el aparato) ───── */
const OPC_DEF = { ms: 30, prof: 4, rondas: 4, maxPlies: 160, directo: true };
let opc = OPC_DEF;
try { opc = Object.assign({}, OPC_DEF, JSON.parse(localStorage.getItem('arana.ajedrez.opc') || '{}')); } catch (e) { opc = Object.assign({}, OPC_DEF); }
const guardarOpc = () => { try { localStorage.setItem('arana.ajedrez.opc', JSON.stringify(opc)); } catch (e) {} };

/* ───── Base de datos: memoria aparte de la del asistente ───── */
let db = null;
function abrirDB() {
  return new Promise((ok, ko) => {
    if (!window.indexedDB) return ok(null);
    const r = indexedDB.open('arana-ajedrez', 2);
    r.onupgradeneeded = e => {
      const d = r.result, viejo = e.oldVersion || 0;
      if (viejo < 1) {
        d.createObjectStore('estado');
        d.createObjectStore('individuos', { keyPath: 'id' });
        d.createObjectStore('generaciones', { keyPath: 'gen' });
        d.createObjectStore('partidas', { keyPath: 'gen' });
      }
      if (viejo < 2) r.transaction.objectStore('individuos').createIndex('gen', 'gen');
    };
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
}
const req = r => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
async function leer(store, key) { if (!db) return null; return req(db.transaction(store).objectStore(store).get(key)); }
async function todos(store) { if (!db) return []; return req(db.transaction(store).objectStore(store).getAll()); }
async function porGen(desde, hasta) { if (!db) return []; return req(db.transaction('individuos').objectStore('individuos').index('gen').getAll(IDBKeyRange.bound(desde, hasta))); }
function escribir(ops) {
  if (!db) return Promise.resolve();
  return new Promise((ok, ko) => {
    const tx = db.transaction(['estado', 'individuos', 'generaciones', 'partidas'], 'readwrite');
    for (const [s, v, k] of ops) k === undefined ? tx.objectStore(s).put(v) : tx.objectStore(s).put(v, k);
    tx.oncomplete = ok; tx.onerror = () => ko(tx.error); tx.onabort = () => ko(tx.error);
  });
}
const conHuella = p => { if (p.genes) p.huella = M.huella(p.genes); return p; };

/* ───── Estado de la evolución ───── */
let est = null, pop = [], byId = new Map(), historial = [];
async function cargar() {
  try { db = await abrirDB(); } catch (e) { db = null; }
  est = await leer('estado', 'actual');
  if (est && est.pop) {
    const inds = await Promise.all(est.pop.map(id => leer('individuos', id)));
    pop = inds.filter(Boolean);
    if (pop.length !== est.pop.length || pop.some(p => !p.genes)) pop = [];
  }
  if (!est || !pop.length) {
    est = { gen: 1, origen: ORIGEN, opc: {}, creada: new Date().toISOString(), hitos: {} };
    pop = M.poblacionInicial(rng, ORIGEN, M.OPC_EVO.poblacion);
    await guardarEstado();
  }
  est.hitos = est.hitos || {};
  historial = (await todos('generaciones')).sort((a, b) => a.gen - b.gen);
  byId = new Map(pop.map(p => [p.id, p]));
}
function guardarEstado(extra) {
  est.pop = pop.map(p => p.id);
  const ops = [['estado', est, 'actual']];
  for (const p of pop) ops.push(['individuos', conHuella(p)]);
  return escribir(ops.concat(extra || []));
}

/* ───── Hilos de partidas ───── */
const NHILOS = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
const hilos = [];
function crearHilos() {
  for (let i = 0; i < NHILOS; i++) {
    const w = new Worker('worker.js'); w.libre = true; w.onmessage = e => alRecibir(w, e.data);
    w.onerror = e => { console.warn('hilo', e.message); }; hilos.push(w);
  }
}
let juegos = [], enCurso = new Map(), entrenando = false, sigId = 0, ronda = 0;
function prepararGeneracion() {
  pop.forEach(p => { p.pts = 0; });
  juegos = M.emparejar(pop, opc.rondas, rng).map(j => Object.assign(j, { id: ++sigId, estado: 'cola', fenAhora: j.fen, ultima: null, res: null, eval: 0 }));
  ronda = 0;
  construirPlano();
}
function repartir() {
  if (!entrenando) return;
  for (const w of hilos) {
    if (!w.libre) continue;
    const j = juegos.find(x => x.estado === 'cola'); if (!j) break;
    j.estado = 'juega'; w.libre = false; enCurso.set(j.id, j);
    if (j.ronda !== ronda) { ronda = j.ronda; marcar(); }
    w.postMessage({ t: 'partida', id: j.id, w: { id: j.w, genes: byId.get(j.w).genes }, b: { id: j.b, genes: byId.get(j.b).genes }, fen: j.fen, opc: { ms: opc.ms, prof: opc.prof, maxPlies: opc.maxPlies }, directo: opc.directo });
  }
  marcar();
}
function alRecibir(w, d) {
  const j = enCurso.get(d.id); if (!j) return;
  if (d.t === 'jugada') { j.fenAhora = d.fen; j.ultima = d.uci; j.eval = d.eval; marcar(j); return; }
  if (d.t === 'fin') {
    w.libre = true; enCurso.delete(d.id);
    j.estado = 'fin'; j.res = d.res; j.motivo = d.motivo; j.jugadas = d.jugadas; j.fenAhora = d.fen; j.plies = d.plies;
    const a = byId.get(j.w), b = byId.get(j.b);
    a.pts += d.res; b.pts += 1 - d.res; M.actualizarElo(a, b, d.res);
    for (const [p, v] of [[a, d.res], [b, 1 - d.res]]) p.partidas[v === 1 ? 'g' : v === 0 ? 'p' : 'e']++;
    marcar(j);
    if (juegos.every(x => x.estado === 'fin')) cerrarGeneracion();
    else repartir();
  }
}
async function cerrarGeneracion() {
  const viejos = pop.slice(), mejorPartida = elegirPartida();
  const out = M.siguienteGeneracion(est, pop, rng);
  const elite = new Set(out.resumen.elite);
  const vivos = new Set(out.pop.map(p => p.id)), extra = [['generaciones', out.resumen]];
  if (mejorPartida) extra.push(['partidas', Object.assign({ gen: out.resumen.gen }, mejorPartida)]);
  for (const p of viejos) if (!vivos.has(p.id)) { conHuella(p); extra.push(['individuos', Object.assign({}, p, { genes: elite.has(p.id) ? p.genes : null })]); }
  est = out.est; pop = out.pop; byId = new Map(pop.map(p => [p.id, p])); historial.push(out.resumen);
  const nuevos = revisarHitos(out.resumen);
  try { await guardarEstado(extra); } catch (e) { console.warn('guardar', e); }
  juegos = []; sucio.clear();
  nuevos.forEach((h, i) => setTimeout(() => anunciarHito(h), i * 3200));
  pintarEstado();
  if (entrenando) { prepararGeneracion(); repartir(); } else construirPlano();
}
function elegirPartida() {   // la partida más larga de la mejor araña
  const fin = juegos.filter(j => j.estado === 'fin'); if (!fin.length) return null;
  const top = pop.slice().sort((a, b) => b.pts - a.pts)[0].id;
  const suyas = fin.filter(j => j.w === top || j.b === top).sort((a, b) => b.plies - a.plies);
  const j = suyas[0] || fin[0];
  return { w: j.w, b: j.b, wn: byId.get(j.w).nombre, bn: byId.get(j.b).nombre, fen: j.fen, jugadas: j.jugadas, res: j.res, motivo: j.motivo };
}

/* ───── Hitos: cada uno hace crecer la telaraña de Araña ───── */
const HITOS = [
  ...[2, 10, 25, 50, 100, 250, 500, 1000].map(g => ({ id: 'g' + g, texto: g === 2 ? 'Mi primera generación completa' : `Generación ${g} completada`, ok: r => r.gen + 1 >= g })),
  ...[1300, 1400, 1500, 1600, 1800, 2000].map(e => ({ id: 'e' + e, texto: `Una campeona llega a ${e} de Elo`, ok: r => r.mejor.elo >= e })),
  { id: 'sacudida', texto: 'Me estanqué y sacudí la mutación para explorar', ok: () => (est.sacudidas || 0) > 0 },
  { id: 'inmigrante', texto: 'Una inmigrante llega a la élite', ok: r => r.elite.some(id => { const p = byId.get(id); return p && p.mut && p.mut.nacio === 'inmigrante'; }) },
  { id: 'ligera', texto: 'Una campeona sin ningún detector caro', ok: r => { const p = byId.get(r.mejor.id); return p && p.genes && M.DET.every(d => d.coste < 2 ? true : !(p.genes['d' + d.n][0] > 0)); } },
];
function revisarHitos(r) {
  const nuevos = [];
  for (const h of HITOS) if (!est.hitos[h.id]) { let ok = false; try { ok = h.ok(r); } catch (e) {} if (ok) { est.hitos[h.id] = { fecha: new Date().toISOString(), gen: r.gen }; nuevos.push(h); } }
  return nuevos;
}
function anunciarHito(h) {
  const a = $('#aviso'); a.textContent = '✦ Hito: ' + h.texto; a.classList.add('on');
  clearTimeout(anunciarHito.t); anunciarHito.t = setTimeout(() => a.classList.remove('on'), 3000);
  if (window.parent !== window) window.parent.postMessage({ arana: 'ajedrez-hito', texto: h.texto }, '*');
}

/* ───── Mantener la pantalla encendida mientras entrena ───── */
let candado = null;
async function pedirCandado() { try { if (navigator.wakeLock && entrenando) candado = await navigator.wakeLock.request('screen'); } catch (e) { candado = null; } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pedirCandado(); });
function entrenar(si) {
  entrenando = si;
  $('#go').textContent = si ? '⏸ Pausar' : '▶ Entrenar';
  if (si) { pedirCandado(); if (!juegos.length) prepararGeneracion(); repartir(); }
  else if (candado) { candado.release().catch(() => {}); candado = null; }
  pintarEstado();
}

/* ═════════ El plano ═════════ */
const CW = 260, CH = 360, GAP = 24, PAD = 30, COLS = 4;
let W0 = 0, H0 = 0, esc0 = 1, nivel = '', mesas = [];
const plano = $('#plano'), tam = $('#tam'), lienzo = $('#lienzo');
function construirPlano() {
  const n = Math.max(1, Math.floor(pop.length / 2)), filas = Math.ceil(n / COLS);
  W0 = PAD * 2 + COLS * CW + (COLS - 1) * GAP;
  const yZ = PAD + filas * CH + (filas - 1) * GAP + 40;
  H0 = yZ + 210 + 24 + 160 + PAD;
  let h = '';
  for (let m = 0; m < n; m++) {
    const x = PAD + (m % COLS) * (CW + GAP), y = PAD + Math.floor(m / COLS) * (CH + GAP);
    h += `<div class="mesa" id="m${m}" data-mesa="${m}" style="left:${x}px;top:${y}px">
      <button class="pl" data-b></button><canvas width="240" height="240" aria-label="Tablero de la mesa ${m + 1}"></canvas><button class="pl" data-w></button>
      <div class="info"><div class="ev"><b style="width:50%"></b></div><div class="evt"></div><div class="chips"></div></div>
      <div class="res"></div>
      <div class="lejos" aria-hidden="true"><div class="o">${m + 1}</div><div class="t">MESA ${m + 1}</div></div></div>`;
  }
  const wz = W0 - PAD * 2;
  h += `<div class="zona" style="left:${PAD}px;top:${yZ}px;width:${wz}px;height:210px"><h3>Escalera de Stockfish</h3><p>Aquí subirán las mejores de cada generación, peldaño a peldaño. Llega en la fase 3.</p>
    <svg width="420" height="120" viewBox="0 0 420 120" aria-hidden="true">${Array.from({ length: 8 }, (_, i) => `<rect x="${i * 52}" y="${110 - (i + 1) * 13}" width="46" height="${(i + 1) * 13}" rx="4" fill="none" stroke="rgba(94,232,255,.35)"/>`).join('')}</svg></div>
    <div class="zona" style="left:${PAD}px;top:${yZ + 234}px;width:${Math.round(wz * .6)}px;height:160px"><h3>Rincón de las cazadoras</h3><p>Las arañas parásito que evolucionan para ganar a las suyas. Llega en la fase 4.</p></div>`;
  lienzo.innerHTML = h; lienzo.style.width = W0 + 'px'; lienzo.style.height = H0 + 'px';
  mesas = Array.from(lienzo.querySelectorAll('.mesa'));
  if (!esc0 || !nivel) verTodo(); else aplicarEscala(esc0, true);
  marcar();
}
const escMin = () => Math.min(1, (plano.clientWidth || 380) / (W0 || 1));
const ESC_MAX = 2.4;
const nivelDe = s => s < 0.5 ? 'lejos' : s < 1.15 ? 'medio' : 'cerca';
function aplicarEscala(s, redibujar) {
  s = Math.max(escMin(), Math.min(ESC_MAX, s)); esc0 = s;
  lienzo.style.transform = `scale(${s})`; lienzo.style.setProperty('--k', String(1 / s));
  tam.style.width = Math.round(W0 * s) + 'px'; tam.style.height = Math.round(H0 * s) + 'px';
  const nv = nivelDe(s);
  if (nv !== nivel) { nivel = nv; lienzo.className = nv; redibujar = true; }
  if (redibujar) { mesas.forEach((_, m) => sucio.add(m)); pedir(); }
}
function zoomEn(s, cx, cy) {   // cx, cy: punto del plano visible que se queda quieto
  const r = plano.getBoundingClientRect(), mx = cx == null ? r.width / 2 : cx, my = cy == null ? r.height / 2 : cy;
  const px = (plano.scrollLeft + mx) / esc0, py = (plano.scrollTop + my) / esc0;
  aplicarEscala(s);
  plano.scrollLeft = px * esc0 - mx; plano.scrollTop = py * esc0 - my;
}
function verTodo() { aplicarEscala(escMin(), true); plano.scrollLeft = 0; plano.scrollTop = 0; }
function acercarMesa(m) {
  const el = mesas[m]; if (!el) return;
  const s = Math.min(ESC_MAX, Math.max(1.2, (plano.clientWidth - 24) / CW));
  aplicarEscala(s, true);
  const x = parseFloat(el.style.left), y = parseFloat(el.style.top);
  plano.scrollLeft = (x + CW / 2) * esc0 - plano.clientWidth / 2; plano.scrollTop = (y + CH / 2) * esc0 - plano.clientHeight / 2;
}
/* Pellizco con dos dedos (y Ctrl + rueda en el ordenador) */
let pz = null;
plano.addEventListener('touchstart', e => {
  if (e.touches.length !== 2) return;
  const [a, b] = e.touches, r = plano.getBoundingClientRect();
  pz = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, s: esc0, mx: (a.clientX + b.clientX) / 2 - r.left, my: (a.clientY + b.clientY) / 2 - r.top };
  pz.px = (plano.scrollLeft + pz.mx) / esc0; pz.py = (plano.scrollTop + pz.my) / esc0;
}, { passive: true });
plano.addEventListener('touchmove', e => {
  if (!pz || e.touches.length !== 2) return;
  e.preventDefault();
  const [a, b] = e.touches, d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  aplicarEscala(pz.s * d / pz.d);
  plano.scrollLeft = pz.px * esc0 - pz.mx; plano.scrollTop = pz.py * esc0 - pz.my;
}, { passive: false });
plano.addEventListener('touchend', e => { if (pz && e.touches.length < 2) { pz = null; aplicarEscala(esc0, true); } });
document.addEventListener('gesturestart', e => e.preventDefault());
plano.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); const r = plano.getBoundingClientRect(); zoomEn(esc0 * Math.exp(-e.deltaY / 300), e.clientX - r.left, e.clientY - r.top); clearTimeout(zoomEn.t); zoomEn.t = setTimeout(() => aplicarEscala(esc0, true), 150); }, { passive: false });
plano.addEventListener('scroll', () => { if (!pz) { mesas.forEach((_, m) => sucio.add(m)); pedir(); } }, { passive: true });
window.addEventListener('resize', () => { if (Math.abs(esc0 - escMin()) < 0.02 || esc0 < escMin()) verTodo(); });
$('#zp').onclick = () => zoomEn(esc0 * 1.5);
$('#zm').onclick = () => zoomEn(esc0 / 1.5);
$('#zt').onclick = verTodo;

/* ───── Dibujo de cada mesa ───── */
const LET = { p: 'P', n: 'C', b: 'A', r: 'T', q: 'D', k: 'R' };
function visible(el) {
  const x = parseFloat(el.style.left) * esc0, y = parseFloat(el.style.top) * esc0;
  return x + CW * esc0 > plano.scrollLeft && x < plano.scrollLeft + plano.clientWidth && y + CH * esc0 > plano.scrollTop && y < plano.scrollTop + plano.clientHeight;
}
/* La araña de puntos y líneas: cuerpo, cabeza y ocho patas con su articulación */
function arana(g, x, y, r, color, hacia) {
  const ang = hacia ? Math.atan2(hacia[1] - y, hacia[0] - x) : -Math.PI / 2;
  g.save(); g.translate(x, y); g.rotate(ang + Math.PI / 2);
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = Math.max(1, r * .12); g.lineCap = 'round';
  for (const lado of [-1, 1]) for (let i = 0; i < 4; i++) {
    const a = (-0.9 + i * 0.6), kx = lado * r * 1.1 * Math.cos(a * .55), ky = r * 0.9 * Math.sin(a), fx = lado * r * 1.9, fy = ky * 1.6 + r * .2;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(kx, ky - r * .5); g.lineTo(fx, fy); g.stroke();
    g.beginPath(); g.arc(kx, ky - r * .5, r * .13, 0, 7); g.fill();
  }
  g.beginPath(); g.ellipse(0, r * .25, r * .55, r * .7, 0, 0, 7); g.fill();
  g.beginPath(); g.arc(0, -r * .6, r * .36, 0, 7); g.fill();
  g.restore();
}
function tablero(cv, fen, ultima, conAranas) {
  const s = Math.max(.6, esc0), dpr = Math.min(2, window.devicePixelRatio || 1), px = Math.round(240 * s * dpr);
  if (cv.width !== px) { cv.width = px; cv.height = px; }
  const g = cv.getContext('2d'); g.setTransform(px / 240, 0, 0, px / 240, 0, 0); g.clearRect(0, 0, 240, 240);
  const m = conAranas ? 26 : 0, L = 240 - m * 2, q = L / 8;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { g.fillStyle = (r + c) % 2 ? 'rgba(94,232,255,.05)' : 'rgba(94,232,255,.16)'; g.fillRect(m + c * q, m + r * q, q, q); }
  let hasta = null;
  if (ultima) {
    g.fillStyle = 'rgba(61,255,153,.22)';
    for (const sq of [ultima.slice(0, 2), ultima.slice(2, 4)]) { const c = sq.charCodeAt(0) - 97, r = 8 - +sq[1]; g.fillRect(m + c * q, m + r * q, q, q); }
    const c = ultima.charCodeAt(2) - 97, r = 8 - +ultima[3]; hasta = [m + c * q + q / 2, m + r * q + q / 2];
  }
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 ' + Math.round(q * .5) + 'px ui-monospace,Menlo,monospace';
  fen.split(' ')[0].split('/').forEach((f, r) => {
    let c = 0;
    for (const ch of f) {
      if (ch >= '1' && ch <= '8') { c += +ch; continue; }
      const blanca = ch !== ch.toLowerCase(), x = m + c * q + q / 2, y = m + r * q + q / 2;
      g.beginPath(); g.arc(x, y, q * .38, 0, Math.PI * 2);
      g.fillStyle = blanca ? '#e9f6ff' : '#1b1430'; g.fill();
      g.lineWidth = Math.max(1, q * .06); g.strokeStyle = blanca ? '#5ee8ff' : '#ff4fa3'; g.stroke();
      g.fillStyle = blanca ? '#0a0c15' : '#ffd6ea'; g.fillText(LET[ch.toLowerCase()], x, y + q * .03);
      c++;
    }
  });
  if (conAranas) {
    // Juega quien no tiene el turno: lanza su hilo a la casilla donde dejó la pieza
    const mueveNegra = fen.split(' ')[1] === 'w', pB = [14, 226], pN = [226, 14];
    if (hasta) {
      const o = mueveNegra ? pN : pB;
      g.strokeStyle = mueveNegra ? 'rgba(255,79,163,.85)' : 'rgba(94,232,255,.85)'; g.lineWidth = 1.2; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(o[0], o[1]); g.lineTo(hasta[0], hasta[1]); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.arc(hasta[0], hasta[1], 2.5, 0, 7); g.fillStyle = g.strokeStyle; g.fill();
    }
    arana(g, pB[0], pB[1], 8, '#5ee8ff', !mueveNegra && hasta ? hasta : [120, 120]);
    arana(g, pN[0], pN[1], 8, '#ff4fa3', mueveNegra && hasta ? hasta : [120, 120]);
  }
}
let sucio = new Set(), pedido = false;
function marcar(j) { if (j) sucio.add(j.mesa); else mesas.forEach((_, m) => sucio.add(m)); pedir(); }
function pedir() { if (!pedido) { pedido = true; requestAnimationFrame(dibujar); } }
function dibujar() {
  pedido = false;
  if (!opc.directo) { if (!$('#resumen').hidden) pintarResumen(); pintarEstado(); sucio.clear(); return; }
  for (const m of sucio) pintarMesa(m);
  sucio.clear(); pintarEstado();
}
function juegosDeMesa(m) { return juegos.filter(j => j.ronda === ronda && j.mesa === m); }
const compilados = new Map();
function compilado(p) { let c = compilados.get(p.id); if (!c) { c = M.compilar(p.genes); compilados.set(p.id, c); if (compilados.size > 80) compilados.delete(compilados.keys().next().value); } return c; }
function pintarMesa(m) {
  const el = mesas[m]; if (!el) return;
  const js = juegosDeMesa(m);
  const j = js.find(x => x.estado === 'juega') || js.slice().reverse().find(x => x.estado === 'fin') || js[0];
  el.classList.toggle('juega', !!j && j.estado === 'juega');
  const fin = js.filter(x => x.estado === 'fin'), ult = fin[fin.length - 1];
  el.classList.toggle('r1', !!(j && j.estado === 'fin' && ult && ult.res === 1)); el.classList.toggle('r0', !!(j && j.estado === 'fin' && ult && ult.res === 0)); el.classList.toggle('rh', !!(j && j.estado === 'fin' && ult && ult.res === .5));
  if (nivel === 'lejos' || !visible(el)) return;
  if (!j) { tablero(el.querySelector('canvas'), M.INICIO, null, nivel === 'cerca'); return; }
  tablero(el.querySelector('canvas'), j.fenAhora, j.ultima, nivel === 'cerca');
  const a = byId.get(j.w), b = byId.get(j.b), bw = el.querySelector('[data-w]'), bb = el.querySelector('[data-b]');
  if (!a || !b) return;   // la generación acaba de cambiar
  bw.dataset.id = a.id; bb.dataset.id = b.id;
  bw.innerHTML = `<span>○ ${esc(a.nombre)}</span><i>${Math.round(a.elo)}</i>`;
  bb.innerHTML = `<span>● ${esc(b.nombre)}</span><i>${Math.round(b.elo)}</i>`;
  el.querySelector('.res').textContent = j.estado === 'juega' ? (js.indexOf(j) ? 'vuelta' : 'ida') : fin.length ? fin.map(x => x.res === 1 ? '1-0' : x.res === 0 ? '0-1' : '½').join(' · ') : 'espera';
  if (nivel === 'cerca') {
    const ev = j.eval || 0, pct = 100 / (1 + Math.pow(10, -ev / 400));
    el.querySelector('.ev b').style.width = pct.toFixed(1) + '%';
    el.querySelector('.evt').textContent = `Ella: ${ev > 0 ? '+' : ''}${fmt(ev / 100, 2)} para ${ev >= 0 ? 'blancas' : 'negras'}`;
    // Qué está pensando: los detectores que más pesan, con los genes de quien acaba de mover
    let chips = '';
    if (j.ultima) {
      try {
        const pos = new M.Pos(j.fenAhora), quien = pos.side ? a : b, ex = M.explicar(pos, compilado(quien));
        chips = ex.detectores.filter(d => d.n !== 1).slice(0, 4).map(d => { const v = pos.side ? d.v : -d.v; /* desde quien acaba de mover */ return `<span class="${v < 0 ? 'neg' : ''}">${esc(d.nombre)} ${v > 0 ? '+' : ''}${v}</span>`; }).join('');
      } catch (e) { chips = ''; }
    }
    el.querySelector('.chips').innerHTML = chips;
  }
}
lienzo.addEventListener('click', e => {
  const pl = e.target.closest('.pl'); if (pl && pl.dataset.id && nivel !== 'lejos') return ficha(pl.dataset.id);
  const me = e.target.closest('.mesa'); if (!me) return;
  if (nivel !== 'cerca') acercarMesa(+me.dataset.mesa);
});

/* ───── Resumen ───── */
function pintarResumen() {
  const fila = pop.slice().sort((a, b) => b.pts - a.pts || b.elo - a.elo);
  let h = '<h2>Esta generación</h2><table><tr><th>#</th><th>Araña</th><th class="num">Pts</th><th class="num">Elo</th></tr>';
  fila.forEach((p, i) => { h += `<tr data-id="${esc(p.id)}"><td>${i + 1}</td><td>${esc(p.nombre)}</td><td class="num">${p.pts || 0}</td><td class="num">${Math.round(p.elo)}</td></tr>`; });
  h += '</table><h2>Generaciones</h2>' + chispa(historial.map(g => g.mejor.elo), 'Elo de la mejor') + '<table><tr><th>Gen</th><th>Mejor</th><th class="num">Pts</th><th class="num">σ</th><th class="num">Div.</th></tr>';
  historial.slice(-12).reverse().forEach(g => { h += `<tr data-id="${esc(g.mejor.id)}"><td>${g.gen}</td><td>${esc(g.mejor.nombre)}</td><td class="num">${g.mejor.pts}</td><td class="num">${fmt(g.sigma, 3)}</td><td class="num">${fmt(g.diversidad, 2)}</td></tr>`; });
  $('#resumen').innerHTML = h + '</table>';
}
$('#resumen').addEventListener('click', e => { const r = e.target.closest('[data-id]'); if (r) ficha(r.dataset.id); });
function chispa(vals, titulo, color) {
  if (vals.length < 2) return '';
  const mn = Math.min(...vals), mx = Math.max(...vals), d = mx - mn || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * 300).toFixed(1)},${(52 - (v - mn) / d * 44).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 300 56" preserveAspectRatio="none" role="img" aria-label="${esc(titulo)}: de ${Math.round(vals[0])} a ${Math.round(vals[vals.length - 1])}"><polyline points="${pts}" fill="none" stroke="${color || '#5ee8ff'}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}
function pintarEstado() {
  const hechas = juegos.filter(j => j.estado === 'fin').length, total = juegos.length;
  const ult = historial[historial.length - 1];
  $('#estado').innerHTML = `<b>Generación ${est.gen}</b> · ${entrenando ? 'entrenando' : 'en pausa'}` +
    (total ? ` · ronda ${ronda + 1}/${opc.rondas} · ${hechas}/${total}` : '') +
    (ult ? ` · campeona <b>${esc(ult.mejor.nombre)}</b> (Elo ${ult.mejor.elo})` : ` · ${NHILOS} hilos`);
  const nh = Object.keys(est.hitos || {}).length, bh = document.querySelector('[data-aux=hitos]');
  if (bh) bh.innerHTML = 'Hitos' + (nh ? ` <b>${nh}</b>` : '');
}

/* ═════════ La hoja ═════════ */
function hoja(html) { $('#hojac').innerHTML = html; $('#hoja').classList.add('on'); $('#hojac').scrollTop = 0; const b = $('#hojac button'); if (b) b.focus(); }
function cerrarHoja() { $('#hoja').classList.remove('on'); clearInterval(repTimer); }
const CERRAR = '<div class="ctrl" style="margin-top:14px"><button class="btn sec" data-cerrar>Cerrar</button></div>';
$('#hoja').addEventListener('click', e => {
  if (e.target.id === 'hoja' || e.target.closest('[data-cerrar]')) return cerrarHoja();
  const f = e.target.closest('[data-ficha]'); if (f) ficha(f.getAttribute('data-ficha'));
});

/* ───── Ficha de una araña ───── */
async function individuo(id) { return byId.get(id) || await leer('individuos', id); }
const huellaDe = p => p && (p.huella || (p.genes ? M.huella(p.genes) : null));
async function linaje(p) {   // de la antepasada más antigua a ella, por el padre que dio más bloques
  const r = [p]; let c = p;
  while (r.length < 24 && c && c.padres && c.padres.length) {
    const cr = c.mut && c.mut.cruce, idx = cr && cr.b > cr.a ? 1 : 0;
    c = await individuo(c.padres[idx]); if (c) r.unshift(c);
  }
  return r;
}
function linea(vals, color, w, h) {
  const ok = vals.map((v, i) => [i, v]).filter(x => x[1] != null);
  if (ok.length < 2) return `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true"><circle cx="${w - 3}" cy="${h / 2}" r="2.5" fill="${color}"/></svg>`;
  const vs = ok.map(x => x[1]), mn = Math.min(...vs), mx = Math.max(...vs), d = mx - mn || 1, n = vals.length - 1 || 1;
  const pts = ok.map(([i, v]) => `${(i / n * (w - 6) + 3).toFixed(1)},${(h - 3 - (v - mn) / d * (h - 6)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}
function radar(est5) {
  const R = 64, cx = 110, cy = 82, n = est5.length, P = (i, v) => [cx + Math.sin(i / n * 6.283) * R * v, cy - Math.cos(i / n * 6.283) * R * v];
  let s = `<svg viewBox="0 0 220 172" width="100%" style="max-width:300px;display:block;margin:0 auto" role="img" aria-label="Estilo: ${est5.map(e => e.eje + ' ' + Math.round(e.v * 100) + '%').join(', ')}">`;
  for (const k of [.33, .66, 1]) s += `<polygon points="${est5.map((_, i) => P(i, k).join(',')).join(' ')}" fill="none" stroke="rgba(94,232,255,.18)"/>`;
  est5.forEach((e, i) => { const [x, y] = P(i, 1), [lx, ly] = P(i, 1.24); s += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="rgba(94,232,255,.18)"/><text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" fill="rgba(235,235,245,.7)" style="font:11px ui-monospace,Menlo,monospace">${e.eje}</text>`; });
  s += `<polygon points="${est5.map((e, i) => P(i, Math.max(.04, e.v)).join(',')).join(' ')}" fill="rgba(255,79,163,.22)" stroke="#ff4fa3" stroke-width="1.5"/>`;
  return s + '</svg>';
}
async function ficha(id) {
  const p = await individuo(id); if (!p) return;
  const padres = await Promise.all((p.padres || []).map(async x => ({ id: x, nombre: ((await individuo(x)) || { nombre: x }).nombre })));
  const mut = p.mut || {};
  const nacio = mut.nacio ? mut.nacio : `cruce (${mut.cruce ? mut.cruce.a + ' bloques de un padre, ' + mut.cruce.b + ' del otro' : '—'}), ${mut.total || 0} genes mutados con σ ${fmt(mut.sigma || 0, 3)}`;
  let h = `<h3>${esc(p.nombre)}</h3><div class="sub">${esc(p.id)} · nació en la generación ${p.gen} · sangre de ${esc(p.origen)}${byId.has(p.id) ? ' · viva' : ''}</div>`;
  h += `<dl class="kv"><dt>Padres</dt><dd>${padres.length ? padres.map(x => `<button class="btn sec" style="padding:2px 8px;min-height:0" data-ficha="${esc(x.id)}">${esc(x.nombre)}</button>`).join(' × ') : 'ninguno'}</dd><dt>Cómo nació</dt><dd>${esc(nacio)}</dd>` +
    `<dt>Elo</dt><dd>${Math.round(p.elo)}</dd><dt>Partidas</dt><dd>${p.partidas.g} ganadas · ${p.partidas.e} tablas · ${p.partidas.p} perdidas</dd></dl>`;
  if (p.genes) h += '<h2>Su estilo</h2>' + radar(M.estilo(p.genes));
  if (p.hist && p.hist.length > 1) h += '<h2>Su Elo por generación</h2>' + chispa(p.hist.map(x => x.elo), 'Elo de ' + p.nombre);
  const lin = await linaje(p), hs = lin.map(huellaDe);
  if (hs[hs.length - 1]) {
    h += `<h2>Sus genes a lo largo de su linaje</h2><div class="lin">${lin.map(x => `<b>${esc(x.nombre)}</b> (g${x.gen})`).join(' → ')}</div>
      <p class="nota">Cada línea es un gen, de la antepasada más antigua (izquierda) a ella (derecha). El número es su valor actual.</p>`;
    const actual = hs[hs.length - 1];
    const fila = (nombre, vals, v, on, d) => `<div class="gen${on === false ? ' off' : ''}"><span><span class="dotc"></span>${esc(nombre)}</span>${linea(vals, on === false ? 'rgba(235,235,245,.3)' : '#5ee8ff', 120, 20)}<span class="v">${v == null ? '—' : fmt(v, d)}</span></div>`;
    const piezas = ['Peón', 'Caballo', 'Alfil', 'Torre', 'Dama'];
    h += '<details open><summary>Valor de las piezas</summary>' + piezas.map((n, i) => fila(n, hs.map(x => x ? x.p[i] / 100 : null), actual.p[i] / 100, true, 2)).join('') + '</details>';
    h += '<details><summary>Cómo piensa</summary>' + M.PIENSA.map((n, i) => fila(n, hs.map(x => x ? x.k[i] : null), actual.k[i], true, 2)).join('') + '</details>';
    for (const c of [0, 1, 2]) {
      const ds = M.DET.filter(d => d.coste === c && d.n !== 1 && d.n !== 4), on = ds.filter(d => actual.d[d.n][0]).length;
      h += `<details><summary>Detectores ${M.COSTE[c]}s · ${on}/${ds.length} encendidos</summary>` +
        ds.map(d => fila(d.n + '. ' + d.nombre, hs.map(x => x && x.d[d.n] ? x.d[d.n][1] : null), actual.d[d.n][1], !!actual.d[d.n][0], 1)).join('') + '</details>';
    }
    h += '<p class="nota">El peso de cada detector es el de su primera medida en el medio juego. Apagado no cuenta para pensar, pero el gen sigue ahí y puede volver a encenderse en sus hijas.</p>';
  } else h += '<p class="nota">De esta araña no quedan sus genes.</p>';
  if (mut.cambios) {
    const top = Object.entries(mut.cambios).sort((a, b) => b[1] - a[1]).slice(0, 6);
    h += '<h2>Dónde mutó al nacer</h2><div class="det">' + top.map(([k, n]) => `<span>${esc(bloqueNombre(k))}</span><span class="v">${n} genes</span>`).join('') + '</div>';
  }
  hoja(h + CERRAR);
}
function bloqueNombre(k) { if (k === 'jugada') return 'Valor de cada jugada'; if (k === 'piensa') return 'Cómo piensa'; const d = M.DET_BY[k]; return d ? d.n + '. ' + d.nombre : k; }

/* ═════════ Vistas auxiliares ═════════ */
const AUX = {
  grafica() {
    if (historial.length < 2) return hoja('<h3>Gráfica</h3><p class="nota">Hacen falta al menos dos generaciones terminadas.</p>' + CERRAR);
    const g = historial.slice(-200), W = 340, H = 150, eje = (vals, cs) => {
      const all = vals.flat(), mn = Math.min(...all), mx = Math.max(...all), d = mx - mn || 1, n = vals[0].length - 1 || 1;
      let s = `<svg viewBox="0 0 ${W} ${H + 22}" width="100%" role="img" aria-label="Gráfica">`;
      for (let i = 0; i <= 2; i++) { const y = 8 + i * (H - 16) / 2, v = mx - i * d / 2; s += `<line x1="34" x2="${W}" y1="${y}" y2="${y}" stroke="rgba(94,232,255,.12)"/><text x="30" y="${y}" text-anchor="end" dominant-baseline="middle" fill="rgba(235,235,245,.55)" style="font:10px ui-monospace,Menlo,monospace">${Math.abs(v) >= 10 ? Math.round(v) : fmt(v, 2)}</text>`; }
      vals.forEach((vs, k) => { s += `<polyline fill="none" stroke="${cs[k]}" stroke-width="2"${k ? ' stroke-dasharray="5 4"' : ''} points="${vs.map((v, i) => `${(34 + i / n * (W - 38)).toFixed(1)},${(8 + (mx - v) / d * (H - 16)).toFixed(1)}`).join(' ')}"/>`; });
      return s + `<text x="34" y="${H + 16}" fill="rgba(235,235,245,.55)" style="font:10px ui-monospace,Menlo,monospace">gen ${g[0].gen}</text><text x="${W}" y="${H + 16}" text-anchor="end" fill="rgba(235,235,245,.55)" style="font:10px ui-monospace,Menlo,monospace">gen ${g[g.length - 1].gen}</text></svg>`;
    };
    hoja(`<h3>Gráfica de la evolución</h3><div class="sub">${historial.length} generaciones</div>
      <h2>Elo</h2><div class="ley"><span><i style="background:#3dff99"></i>la mejor</span><span><i style="background:#5ee8ff"></i>la media (discontinua)</span></div>${eje([g.map(x => x.mejor.elo), g.map(x => x.mediaElo)], ['#3dff99', '#5ee8ff'])}
      <h2>Mutación (σ) y diversidad</h2><div class="ley"><span><i style="background:#ff4fa3"></i>σ</span><span><i style="background:#ffb340"></i>diversidad (discontinua)</span></div>${eje([g.map(x => x.sigma), g.map(x => x.diversidad)], ['#ff4fa3', '#ffb340'])}
      <h2>Detectores encendidos de media</h2>${eje([g.map(x => x.encendidos)], ['#a99bff'])}
      <p class="nota">Si la diversidad cae mucho, entran inmigrantes. Si la campeona no cambia en varias generaciones, la mutación se sacude y vuelve a crecer.</p>` + CERRAR);
  },
  async arbol() {
    const G = est.gen, desde = Math.max(1, G - 4), inds = await porGen(desde, G), mapa = new Map(inds.map(p => [p.id, p]));
    for (const p of pop) mapa.set(p.id, p);
    const lista = [...mapa.values()], anillos = G - desde + 1, cx = 180, cy = 180, R = 160, rad = g => 22 + (Math.max(desde, g) - desde) / Math.max(1, anillos - 1) * (R - 22);
    const pos = new Map(), porAnillo = {};
    lista.forEach(p => { const k = Math.max(desde, p.gen); (porAnillo[k] = porAnillo[k] || []).push(p); });
    Object.entries(porAnillo).forEach(([k, ps]) => { ps.sort((a, b) => a.id < b.id ? -1 : 1).forEach((p, i) => { const a = i / ps.length * 6.283 + (+k) * .37, r = rad(+k); pos.set(p.id, [cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }); });
    let s = `<svg viewBox="0 0 360 360" width="100%" role="img" aria-label="Árbol genealógico de las últimas ${anillos} generaciones">`;
    for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; s += `<line x1="${cx}" y1="${cy}" x2="${cx + Math.cos(a) * R}" y2="${cy + Math.sin(a) * R}" stroke="rgba(94,232,255,.08)"/>`; }
    for (let g = desde; g <= G; g++) s += `<circle cx="${cx}" cy="${cy}" r="${rad(g)}" fill="none" stroke="rgba(94,232,255,.12)"/>`;
    for (const p of lista) for (const pa of p.padres || []) { const a = pos.get(p.id), b = pos.get(pa); if (a && b) s += `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${colorDe(p)}" stroke-opacity=".35" stroke-width=".8"/>`; }
    const viva = new Set(pop.map(p => p.id));
    for (const p of lista) { const [x, y] = pos.get(p.id); s += `<circle data-ficha="${esc(p.id)}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${viva.has(p.id) ? 5 : 3}" fill="${viva.has(p.id) ? colorDe(p) : 'none'}" stroke="${colorDe(p)}" stroke-width="1.2" style="cursor:pointer"><title>${esc(p.nombre)} · g${p.gen}</title></circle>`; }
    hoja(`<h3>Árbol en telaraña</h3><div class="sub">Generaciones ${desde} a ${G}: del centro (más antiguas) hacia fuera. Toque un punto para ver su ficha.</div>${s}</svg>
      <div class="ley"><span><i style="background:#5ee8ff"></i>iPhone</span><span><i style="background:#ffb340"></i>Android</span><span><i style="background:#a99bff"></i>web</span><span><i style="background:#9a9aa8"></i>inmigrante</span><span><i style="border:1.5px solid #ccc"></i>ya no vive</span></div>` + CERRAR);
  },
  adn() {
    const g = historial.filter(x => x.adn).slice(-60);
    if (!g.length) return hoja('<h3>ADN</h3><p class="nota">Aparece al terminar la primera generación.</p>' + CERRAR);
    const ds = M.DET, lab = 132, cw = Math.max(3, Math.floor((360 - lab) / g.length)), rh = 12, W = lab + cw * g.length, H = ds.length * rh + 20;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Mapa de calor: detectores encendidos por generación">`;
    ds.forEach((d, i) => {
      const y = i * rh; s += `<text x="${lab - 6}" y="${y + rh / 2}" text-anchor="end" dominant-baseline="middle" fill="rgba(235,235,245,.7)" style="font:9.5px ui-monospace,Menlo,monospace">${d.n}. ${esc(d.nombre.length > 17 ? d.nombre.slice(0, 16) + '…' : d.nombre)}</text>`;
      g.forEach((x, k) => { const row = x.adn.find(a => a[0] === d.n), f = row ? row[1] : 0; s += `<rect x="${lab + k * cw}" y="${y + 1}" width="${cw - 1}" height="${rh - 2}" fill="${d.coste === 2 ? '#ff4fa3' : d.coste === 1 ? '#ffb340' : '#5ee8ff'}" fill-opacity="${(.06 + f * .9).toFixed(2)}"><title>${esc(d.nombre)} · gen ${x.gen}: ${Math.round(f * 100)} % encendido</title></rect>`; });
    });
    s += `<text x="${lab}" y="${H - 4}" fill="rgba(235,235,245,.55)" style="font:10px ui-monospace,Menlo,monospace">gen ${g[0].gen}</text><text x="${W}" y="${H - 4}" text-anchor="end" fill="rgba(235,235,245,.55)" style="font:10px ui-monospace,Menlo,monospace">gen ${g[g.length - 1].gen}</text>`;
    hoja(`<h3>ADN de la población</h3><div class="sub">Qué parte de las arañas tiene encendido cada detector, generación a generación</div>
      <div class="ley"><span><i style="background:#5ee8ff"></i>barato</span><span><i style="background:#ffb340"></i>medio</span><span><i style="background:#ff4fa3"></i>caro</span><span>más intenso = más arañas lo usan</span></div>${s}</svg>` + CERRAR);
  },
  estilos() {
    const pts = pop.filter(p => p.genes).map(p => { const e = M.estilo(p.genes), v = Object.fromEntries(e.map(x => [x.eje, x.v])); return { p, x: v.ataque - v.defensa, y: (v['táctica'] + v.material) / 2 - v['posición'] }; });
    const W = 340, H = 300, m = 30, xs = pts.map(o => o.x), ys = pts.map(o => o.y);
    const ext = a => { const mx = Math.max(.15, ...a.map(Math.abs)); return mx * 1.15; }, ex = ext(xs), ey = ext(ys);
    const X = v => m + (v + ex) / (2 * ex) * (W - 2 * m), Y = v => H - m - (v + ey) / (2 * ey) * (H - 2 * m);
    const elos = pop.map(p => p.elo), emn = Math.min(...elos), emx = Math.max(...elos);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Mapa de estilos de las arañas vivas">
      <line x1="${m}" x2="${W - m}" y1="${Y(0)}" y2="${Y(0)}" stroke="rgba(94,232,255,.2)"/><line y1="${m}" y2="${H - m}" x1="${X(0)}" x2="${X(0)}" stroke="rgba(94,232,255,.2)"/>
      <text x="${W - m}" y="${Y(0) - 6}" text-anchor="end" fill="rgba(235,235,245,.6)" style="font:10.5px ui-monospace,Menlo,monospace">atacante →</text><text x="${m}" y="${Y(0) - 6}" fill="rgba(235,235,245,.6)" style="font:10.5px ui-monospace,Menlo,monospace">← defensiva</text>
      <text x="${X(0) + 6}" y="${m - 8}" fill="rgba(235,235,245,.6)" style="font:10.5px ui-monospace,Menlo,monospace">↑ táctica y material</text><text x="${X(0) + 6}" y="${H - m + 18}" fill="rgba(235,235,245,.6)" style="font:10.5px ui-monospace,Menlo,monospace">↓ posicional</text>`;
    const top = pop.slice().sort((a, b) => b.elo - a.elo)[0];
    for (const o of pts) { const r = 3 + (o.p.elo - emn) / ((emx - emn) || 1) * 5; s += `<circle data-ficha="${esc(o.p.id)}" cx="${X(o.x).toFixed(1)}" cy="${Y(o.y).toFixed(1)}" r="${r.toFixed(1)}" fill="${colorDe(o.p)}" fill-opacity=".75" stroke="${o.p === top ? '#3dff99' : 'none'}" stroke-width="2" style="cursor:pointer"><title>${esc(o.p.nombre)} · Elo ${Math.round(o.p.elo)}</title></circle>`; }
    const t = pts.find(o => o.p === top); if (t) s += `<text x="${X(t.x) + 9}" y="${Y(t.y) + 4}" fill="#3dff99" style="font:600 11px ui-monospace,Menlo,monospace">${esc(top.nombre)}</text>`;
    hoja(`<h3>Mapa de estilos</h3><div class="sub">Las ${pts.length} arañas vivas. Más grande = más Elo; con borde verde, la mejor. Toque una para su ficha.</div>${s}</svg>
      <p class="nota">Si los puntos se juntan, la población se parece demasiado; si se reparten, hay variedad para seguir evolucionando.</p>` + CERRAR);
  },
  async partidas() {
    const ps = (await todos('partidas')).sort((a, b) => b.gen - a.gen).slice(0, 40);
    if (!ps.length) return hoja('<h3>Partidas</h3><p class="nota">Al terminar cada generación guardo su mejor partida. Aún no hay ninguna.</p>' + CERRAR);
    hoja(`<h3>La mejor partida de cada generación</h3><select class="full" id="repSel" aria-label="Elegir partida">${ps.map(p => `<option value="${p.gen}">Gen ${p.gen}: ${esc(p.wn)} – ${esc(p.bn)} · ${p.res === 1 ? '1-0' : p.res === 0 ? '0-1' : '½-½'} (${esc(p.motivo)})</option>`).join('')}</select>
      <canvas id="repCv" width="240" height="240" style="width:100%;max-width:340px;aspect-ratio:1;display:block;margin:0 auto;border-radius:8px"></canvas>
      <div class="rep"><button id="r0" aria-label="Al principio">⏮</button><button id="r1" aria-label="Jugada anterior">◀</button><button id="rp" aria-label="Reproducir">▶</button><button id="r2" aria-label="Jugada siguiente">▶︎|</button><button id="r3" aria-label="Al final">⏭</button></div>
      <div class="nota" id="repTxt" style="text-align:center"></div>` + CERRAR);
    const porG = new Map(ps.map(p => [p.gen, p])); let partida = null, fens = [], ucis = [], i = 0;
    const cargarP = g => {
      partida = porG.get(+g); const pos = new M.Pos(partida.fen); fens = [pos.fen()]; ucis = [null];
      for (const u of partida.jugadas || []) { const m = M.parseUci(pos, u); if (!m) break; pos.make(m); fens.push(pos.fen()); ucis.push(u); }
      i = 0; pintar();
    };
    const pintar = () => { const cv = $('#repCv'); if (!cv) return; const e0 = esc0; esc0 = 1.4; tablero(cv, fens[i], ucis[i], true); esc0 = e0; $('#repTxt').textContent = `Jugada ${Math.ceil(i / 2)} de ${Math.ceil((fens.length - 1) / 2)}${i === fens.length - 1 ? ' · ' + partida.motivo : ''}`; };
    const ir = n => { i = Math.max(0, Math.min(fens.length - 1, n)); pintar(); };
    $('#repSel').onchange = e => { clearInterval(repTimer); $('#rp').textContent = '▶'; cargarP(e.target.value); };
    $('#r0').onclick = () => ir(0); $('#r1').onclick = () => ir(i - 1); $('#r2').onclick = () => ir(i + 1); $('#r3').onclick = () => ir(fens.length - 1);
    $('#rp').onclick = () => { if (repTimer) { clearInterval(repTimer); repTimer = 0; $('#rp').textContent = '▶'; return; } $('#rp').textContent = '⏸'; repTimer = setInterval(() => { if (i >= fens.length - 1) { clearInterval(repTimer); repTimer = 0; $('#rp').textContent = '▶'; return; } ir(i + 1); }, 650); };
    cargarP(ps[0].gen);
  },
  hitos() {
    hoja('<h3>Hitos</h3><div class="sub">Cada hito conseguido hace crecer un hilo de la telaraña de Araña</div>' + HITOS.map(h => {
      const s = est.hitos[h.id];
      return `<div class="hito${s ? ' si' : ''}"><span class="m"></span><span>${esc(h.texto)}${s ? `<small>Generación ${s.gen} · ${new Date(s.fecha).toLocaleDateString('es-ES')}</small>` : ''}</span></div>`;
    }).join('') + CERRAR);
  }
};
let repTimer = 0;
$('#aux').addEventListener('click', e => { const b = e.target.closest('[data-aux]'); if (b) AUX[b.dataset.aux](); });

/* ───── Opciones ───── */
function opciones() {
  const sel = (k, vals, fmtv, obj) => { const o = obj || opc, cur = o[k] != null ? o[k] : M.OPC_EVO[k]; return `<select data-k="${k}"${obj ? ' data-evo' : ''}>${vals.map(v => `<option value="${v}"${cur === v ? ' selected' : ''}>${fmtv(v)}</option>`).join('')}</select>`; };
  est.opc = est.opc || {};
  hoja(`<h3>Opciones de entrenamiento</h3><div class="sub">Se aplican a la próxima generación</div>
    <label class="op">Tiempo por jugada ${sel('ms', [10, 30, 60, 120, 250], v => v + ' ms')}</label>
    <label class="op">Profundidad máxima ${sel('prof', [2, 3, 4, 5, 6], v => v + ' jugadas')}</label>
    <label class="op">Partidas por araña ${sel('rondas', [2, 4, 6, 8], v => v * 2)}</label>
    <label class="op">Límite de jugadas ${sel('maxPlies', [120, 160, 240], v => v / 2)}</label>
    <label class="op">Arañas por generación ${sel('poblacion', [16, 24, 32, 48, 64], v => v, est.opc)}</label>
    <label class="op">Probabilidad de mutar cada gen ${sel('pm', [0.03, 0.06, 0.12], v => Math.round(v * 100) + ' %', est.opc)}</label>
    <p class="nota">Más tiempo por jugada juega mejor pero evoluciona más despacio. Con ${NHILOS} hilos, una generación de ${pop.length} arañas tarda unos ${Math.max(1, Math.round(pop.length * opc.rondas * (opc.maxPlies * .45) * opc.ms / 1000 / NHILOS / 60))} min.</p>
    <div class="ctrl"><button class="btn sec" id="exp">Exportar copia</button><button class="btn sec" id="reset">Empezar de cero</button><button class="btn" data-cerrar>Hecho</button></div>`);
  $('#hojac').querySelectorAll('select').forEach(s => s.onchange = () => {
    if (s.hasAttribute('data-evo')) { est.opc[s.dataset.k] = +s.value; guardarEstado().catch(() => {}); } else { opc[s.dataset.k] = +s.value; guardarOpc(); }
  });
  $('#exp').onclick = exportar;
  $('#reset').onclick = async () => {
    if (!confirm('¿Borro todas las arañas y empiezo en la generación 1? Haga antes una copia si la quiere.')) return;
    entrenar(false); hilos.forEach(w => w.terminate()); hilos.length = 0;
    if (db) { db.close(); await new Promise(ok => { const r = indexedDB.deleteDatabase('arana-ajedrez'); r.onsuccess = r.onerror = r.onblocked = ok; }); }
    location.reload();
  };
}
async function exportar() {
  const datos = { app: 'arana-ajedrez', v: 2, origen: ORIGEN, fecha: new Date().toISOString(), estado: est, individuos: await todos('individuos'), generaciones: await todos('generaciones'), partidas: await todos('partidas') };
  if (!db) datos.individuos = pop;
  const nombreF = `arana-ajedrez-${ORIGEN}-gen${est.gen}.json`, blob = new Blob([JSON.stringify(datos)], { type: 'application/json' });
  try { const f = new File([blob], nombreF, { type: 'application/json' }); if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: nombreF }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombreF; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ───── Botones ───── */
function ponerVista() {
  $('#vista').setAttribute('aria-pressed', String(opc.directo)); $('#vista').textContent = opc.directo ? 'Directo' : 'Resumen';
  plano.hidden = !opc.directo; $('#zoom').style.visibility = opc.directo ? '' : 'hidden'; $('#resumen').hidden = opc.directo;
  if (opc.directo) { aplicarEscala(esc0, true); } else pintarResumen();
}
$('#go').onclick = () => entrenar(!entrenando);
$('#vista').onclick = () => { opc.directo = !opc.directo; guardarOpc(); ponerVista(); pintarEstado(); };
$('#opc').onclick = opciones;
$('#salir').onclick = () => { entrenar(false); if (window.parent !== window) window.parent.postMessage({ arana: 'ajedrez-salir' }, '*'); else location.href = '../'; };
document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarHoja(); });
window.addEventListener('message', e => { if (e.data && e.data.arana === 'ajedrez-entrenar') entrenar(true); });

/* Para pruebas */
window.__sala = { estado: () => est, pop: () => pop, juegos: () => juegos, entrenar, ficha, opciones, cerrarGeneracion, exportar, aux: AUX, nivel: () => nivel, escala: () => esc0, zoom: s => aplicarEscala(s, true), acercarMesa, verTodo };

cargar().then(() => {
  crearHilos(); construirPlano(); ponerVista(); pintarEstado();
  if (qs.get('entrenar') === '1') entrenar(true);
}).catch(e => { $('#estado').textContent = 'No he podido abrir la sala: ' + e.message; });
})();
