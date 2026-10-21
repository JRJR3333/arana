/* La sala de partidas: reparte las partidas entre hilos, dibuja el plano con zoom,
   guarda cada generación en IndexedDB y enseña la ficha y las vistas de la evolución. */
(function () {
'use strict';
const M = window.AjedrezMotor, $ = s => document.querySelector(s);
const qs = new URLSearchParams(location.search);
const ORIGEN = qs.get('plat') || (/android/i.test(navigator.userAgent) || qs.get('app') === 'android' ? 'android' : /iphone|ipad|ipod/i.test(navigator.userAgent) ? 'iphone' : 'web');
const rng = M.mulberry((Math.random() * 4294967296) >>> 0);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const COLOR_ORIGEN = { iphone: '#5ee8ff', android: '#ffb340', web: '#a99bff', inmigrante: '#9a9aa8', cazadora: '#ff5c5c' };
const colorDe = p => p.mut && p.mut.nacio === 'inmigrante' ? COLOR_ORIGEN.inmigrante : COLOR_ORIGEN[p.origen] || '#9a9aa8';
const fmt = (v, d) => (+v).toFixed(d == null ? 1 : d).replace('.', ',');
/* Las apps nativas: el iPhone habla por window.webkit.messageHandlers.arana; Android, por AranaAndroid (también desde el iframe) */
const IOS_APP = () => window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.arana;
const ANDROID = () => { try { return window.AranaAndroid || (window.parent !== window && window.parent.AranaAndroid) || null; } catch (e) { return null; } };
function avisarApp(msg) {
  const io = IOS_APP(); if (io) { try { io.postMessage(msg); } catch (e) {} return true; }
  if (window.parent !== window) { window.parent.postMessage(Object.assign({ arana: 'ajedrez-' + msg.tipo }, msg), '*'); return true; }
  return false;
}

/* Los 12 peldaños de la escalera de Stockfish (nivel de Stockfish y cuánto piensa) */
const ESCALERA = [
  { n: 1, nombre: 'Stockfish a ciegas', skill: 0, go: 'depth 1' }, { n: 2, nombre: 'Mira dos jugadas', skill: 0, go: 'depth 2' },
  { n: 3, nombre: 'Aprendiz', skill: 1, go: 'depth 3' }, { n: 4, nombre: 'Principiante', skill: 2, go: 'depth 3' },
  { n: 5, nombre: 'Jugador de club', skill: 3, go: 'depth 4' }, { n: 6, nombre: 'Club fuerte', skill: 4, go: 'depth 4' },
  { n: 7, nombre: 'Jugador de torneo', skill: 5, go: 'depth 5' }, { n: 8, nombre: 'Torneo fuerte', skill: 6, go: 'depth 5' },
  { n: 9, nombre: 'Experto', skill: 8, go: 'depth 6' }, { n: 10, nombre: 'Maestro', skill: 10, go: 'depth 8' },
  { n: 11, nombre: 'Gran maestro', skill: 15, go: 'movetime 50' }, { n: 12, nombre: 'Plena potencia', skill: 20, go: 'movetime 100' }];

/* ───── Opciones (se guardan en el aparato) ───── */
const OPC_DEF = { ms: 30, prof: 4, rondas: 4, maxPlies: 160, directo: true, sf: 1, sfTop: 4 };
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
let est = null, pop = [], byId = new Map(), historial = [], cazadoras = [], cazById = new Map();
const ind = id => byId.get(id) || cazById.get(id);
/* Interruptores de las distópicas (29–38): todos encendidos salvo que Juan apague alguno en Opciones */
const flagsDe = () => Object.assign(M.todasDist(), (est && est.opc && est.opc.dist) || {});
const fkey = f => Object.keys(f).filter(n => f[n]).join(',');
async function cargar() {
  try { db = await abrirDB(); } catch (e) { db = null; }
  est = await leer('estado', 'actual');
  if (est && est.pop) {
    const inds = await Promise.all(est.pop.map(id => leer('individuos', id)));
    pop = inds.filter(Boolean);
    if (pop.length !== est.pop.length || pop.some(p => !p.genes)) pop = [];
  }
  if (!est || !pop.length) {
    est = { gen: 1, origen: ORIGEN, opc: {}, creada: new Date().toISOString(), hitos: {}, escalera: { peldano: 1, conquistas: {} } };
    pop = M.poblacionInicial(rng, ORIGEN, M.OPC_EVO.poblacion);
    await guardarEstado();
  }
  est.hitos = est.hitos || {}; est.escalera = est.escalera || { peldano: 1, conquistas: {} };
  pop.forEach(p => M.completar(p.genes));
  if (est.cazPop) { const cs = await Promise.all(est.cazPop.map(id => leer('individuos', id))); cazadoras = cs.every(c => c && c.genes) ? cs : []; cazadoras.forEach(c => M.completar(c.genes)); }
  historial = (await todos('generaciones')).sort((a, b) => a.gen - b.gen);
  byId = new Map(pop.map(p => [p.id, p])); cazById = new Map(cazadoras.map(c => [c.id, c]));
}
function guardarEstado(extra) {
  est.pop = pop.map(p => p.id); est.cazPop = cazadoras.map(c => c.id);
  const ops = [['estado', est, 'actual']];
  for (const p of pop.concat(cazadoras)) ops.push(['individuos', conHuella(p)]);
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
/* Parásitos (34): 8 cazadoras que evolucionan solo para ganar a la élite. Cada una juega dos partidas contra dos arañas de la élite. */
function asegurarCazadoras() {
  if (!flagsDe()[34] || cazadoras.length) return;
  est.caz = est.caz || { gen: 1, origen: 'cazadora', opc: { poblacion: 8, elite: 2, torneo: 2, inmigrantes: 1 } };
  cazadoras = M.poblacionInicial(rng, 'cazadora', 8); cazadoras.forEach(c => { c.mut = { nacio: 'cazadora' }; });
  cazById = new Map(cazadoras.map(c => [c.id, c]));
}
function prepararGeneracion() {
  aplicarPendientes();
  pop.forEach(p => { p.pts = 0; p.sfb = 0; p.nov = 0; p.plyT = 0; p.nJ = 0; });
  juegos = M.emparejar(pop, opc.rondas, rng).map(j => Object.assign(j, { id: ++sigId, estado: 'cola', fenAhora: j.fen, ultima: null, res: null, eval: 0 }));
  asegurarCazadoras();
  if (flagsDe()[34] && cazadoras.length) {
    const elite = pop.slice(0, Math.min(4, pop.length));
    cazadoras.forEach((c, i) => {
      c.pts = 0;
      const a = elite[i % elite.length], b = elite[(i + 1) % elite.length], f1 = M.aperturaAleatoria(rng, 4), f2 = M.aperturaAleatoria(rng, 4);
      juegos.push({ ronda: opc.rondas - 1, mesa: 'c' + i, tipo: 'caza', w: c.id, b: a.id, fen: f1 }, { ronda: opc.rondas - 1, mesa: 'c' + i, tipo: 'caza', w: b.id, b: c.id, fen: f2 });
    });
    juegos.forEach(j => { if (j.tipo) Object.assign(j, { id: ++sigId, estado: 'cola', fenAhora: j.fen, ultima: null, res: null, eval: 0 }); });
  }
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
    const pw = ind(j.w), pb = ind(j.b), F = flagsDe();
    const ajW = j.tipo === 'caza' && byId.has(j.w) ? ajusteContra(pw, 'cazadoras') : null, ajB = j.tipo === 'caza' && byId.has(j.b) ? ajusteContra(pb, 'cazadoras') : null;
    w.postMessage({ t: 'partida', id: j.id, w: { id: j.w, genes: pw.genes }, b: { id: j.b, genes: pb.genes }, fen: j.fen, opc: { ms: opc.ms, prof: opc.prof, maxPlies: opc.maxPlies }, directo: opc.directo, flags: F, ajW, ajB });
  }
  marcar();
}
function alRecibir(w, d) {
  if (d.t === 'pensado') { const f = pens.get(d.id); if (f) { pens.delete(d.id); f(d); } return; }
  const j = enCurso.get(d.id); if (!j) return;
  if (d.t === 'jugada') { j.fenAhora = d.fen; j.ultima = d.uci; j.eval = d.eval; marcar(j); return; }
  if (d.t === 'fin') {
    w.libre = true; enCurso.delete(d.id);
    j.estado = 'fin'; j.res = d.res; j.motivo = d.motivo; j.jugadas = d.jugadas; j.fenAhora = d.fen; j.plies = d.plies;
    const a = ind(j.w), b = ind(j.b);
    if (j.tipo === 'caza') {   // la araña suma o pierde puntos de su generación; la cazadora suma los suyos
      const aranaB = byId.has(j.b), s0 = aranaB ? b : a, c = aranaB ? a : b, rs = aranaB ? 1 - d.res : d.res;
      s0.pts += rs; c.pts += 1 - rs;
      for (const [p, v] of [[s0, rs], [c, 1 - rs]]) p.partidas[v === 1 ? 'g' : v === 0 ? 'p' : 'e']++;
      recordarRival(s0, 'cazadoras', rs);
      if (rs === 0 && s0.id === est.campeon) est.cazaGana = { gen: est.gen, cazadora: c.nombre, campeona: s0.nombre };
    } else {
      a.pts += d.res; b.pts += 1 - d.res; M.actualizarElo(a, b, d.res);
      for (const [p, v] of [[a, d.res], [b, 1 - d.res]]) { p.partidas[v === 1 ? 'g' : v === 0 ? 'p' : 'e']++; p.plyT = (p.plyT || 0) + d.plies; p.nJ = (p.nJ || 0) + 1; }
    }
    marcar(j);
    if (juegos.every(x => x.estado === 'fin')) finTorneo();
    else repartir();
  }
}
async function cerrarGeneracion() {
  const viejos = pop.slice(), mejorPartida = elegirPartida(), fase = sfFase; sfFase = null;
  let resSF = null;
  if (fase && fase.hechos.length) {
    const E = fase.E, puntos = fase.hechos.reduce((a, j) => a + j.res, 0), n = fase.hechos.length, conquistado = false;
    const mejor = fase.hechos.slice().sort((a, b) => b.res - a.res || b.calidad - a.calidad || b.plies - a.plies)[0];
    resSF = { peldano: E.n, nombre: E.nombre, puntos, partidas: n, conquistado, calidad: Math.round(fase.hechos.reduce((a, j) => a + j.calidad, 0) / n * 1000) / 1000,
      juegos: fase.hechos.map(j => ({ id: j.id, nombre: j.nombre, color: j.yoB ? 'blancas' : 'negras', res: j.res, plies: j.plies, calidad: Math.round(j.calidad * 1000) / 1000, motivo: j.motivo })) };
    if (mejorPartida) mejorPartida.sf = { peldano: E.n, nombre: mejor.nombre, yoB: mejor.yoB, fen: mejor.fen0, jugadas: mejor.jugadas, res: mejor.res, motivo: mejor.motivo };
    // Se conquista con las últimas 8 partidas jugadas en este peldaño (de esta generación o de las anteriores)
    const ven = est.escalera.ventana = (est.escalera.ventana || []).concat(fase.hechos.map(j => j.res)).slice(-8);
    const media = ven.reduce((a, b) => a + b, 0) / ven.length;
    resSF.ventana = { partidas: ven.length, puntos: ven.reduce((a, b) => a + b, 0) };
    resSF.conquistado = ven.length >= 8 && media >= 0.5 && !est.escalera.conquistas[E.n];
    if (resSF.conquistado) { est.escalera.conquistas[E.n] = { gen: est.gen, fecha: new Date().toISOString(), por: mejor.nombre, puntos: resSF.ventana.puntos, partidas: ven.length }; est.escalera.peldano = Math.min(ESCALERA.length, E.n + 1); est.escalera.ventana = []; }
  }
  const F = flagsDe(); est.flags = F;
  if (F[37]) novedad();
  const out = M.siguienteGeneracion(est, pop, rng);
  if (resSF) out.resumen.sf = resSF;
  out.resumen.flags = fkey(F);
  // Memoria del rival (35): las hijas heredan la memoria del padre que más les dio
  const antes = new Map(viejos.map(p => [p.id, p]));
  for (const h of out.pop) if (h.padres && h.padres.length && !h.rivales) { const cr = h.mut && h.mut.cruce, pa = antes.get(h.padres[cr && cr.b > cr.a ? 1 : 0]); if (pa && pa.rivales) h.rivales = JSON.parse(JSON.stringify(pa.rivales)); }
  // Las cazadoras también evolucionan
  const extraCaz = [];
  if (F[34] && cazadoras.length) {
    est.caz.flags = F;
    const oc = M.siguienteGeneracion(est.caz, cazadoras, rng), vivasC = new Set(oc.pop.map(c => c.id)), eliteC = new Set(oc.resumen.elite);
    out.resumen.caza = { mejor: oc.resumen.mejor, puntos: cazadoras.reduce((a, c) => a + c.pts, 0), partidas: cazadoras.length * 2 };
    for (const c of cazadoras) if (!vivasC.has(c.id)) { conHuella(c); extraCaz.push(['individuos', Object.assign({}, c, { genes: eliteC.has(c.id) ? c.genes : null })]); }
    oc.pop.forEach(c => { if (!c.mut || !c.mut.nacio) { c.mut = c.mut || {}; } c.pts = 0; });
    cazadoras = oc.pop; cazById = new Map(cazadoras.map(c => [c.id, c]));
  }
  const elite = new Set(out.resumen.elite);
  const vivos = new Set(out.pop.map(p => p.id)), extra = [['generaciones', out.resumen]].concat(extraCaz);
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
/* Búsqueda de novedad (37): premia jugar distinto. Descriptor = estilo + duración de sus partidas; novedad = distancia media a las 5 más parecidas (población y archivo) */
function novedad() {
  const peso = est.opc && est.opc.novPeso != null ? est.opc.novPeso : 0.15;
  const desc = p => M.estilo(p.genes).map(x => x.v).concat([(p.nJ ? p.plyT / p.nJ : opc.maxPlies / 2) / opc.maxPlies]);
  const dist = (a, b) => Math.sqrt(a.reduce((t, v, i) => t + (v - b[i]) * (v - b[i]), 0));
  const D = pop.map(desc), arch = est.archivo || [];
  const nov = D.map((d, i) => { const ds = []; D.forEach((o, j) => { if (j !== i) ds.push(dist(d, o)); }); arch.forEach(o => ds.push(dist(d, o))); ds.sort((a, b) => a - b); const k = ds.slice(0, 5); return k.length ? k.reduce((a, b) => a + b, 0) / k.length : 0; });
  const mx = Math.max(...nov) || 1;
  pop.forEach((p, i) => { p.novedad = Math.round(nov[i] * 1000) / 1000; p.nov = peso * (nov[i] / mx) * opc.rondas * 2; });
  est.archivo = arch.concat([D[Math.floor(rng() * D.length)], D[Math.floor(rng() * D.length)]]).slice(-150);
}
/* Memoria del rival (35): qué tal le va contra cada rival, y cómo se ajusta: si pierde mucho, busca más las tablas y arriesga menos; si gana, al revés */
function recordarRival(p, clave, res) { const r = (p.rivales = p.rivales || {}); const x = r[clave] = r[clave] || { partidas: 0, puntos: 0 }; x.partidas++; x.puntos += res; }
function ajusteContra(p, ...claves) {
  if (!flagsDe()[35] || !p || !p.rivales) return null;
  for (const k of claves) {
    const r = p.rivales[k]; if (!r || r.partidas < 2) continue;
    const m = r.puntos / r.partidas;
    return m < 0.3 ? { tablas: 1.6, riesgo: -0.4 } : m > 0.6 ? { tablas: 0.6, riesgo: 0.3 } : null;
  }
  return null;
}
function elegirPartida() {   // la partida más larga de la mejor araña
  const fin = juegos.filter(j => j.estado === 'fin' && !j.tipo); if (!fin.length) return null;
  const top = pop.slice().sort((a, b) => b.pts - a.pts)[0].id;
  const suyas = fin.filter(j => j.w === top || j.b === top).sort((a, b) => b.plies - a.plies);
  const j = suyas[0] || fin[0];
  return { w: j.w, b: j.b, wn: byId.get(j.w).nombre, bn: byId.get(j.b).nombre, fen: j.fen, jugadas: j.jugadas, res: j.res, motivo: j.motivo };
}

/* ───── Hitos: cada uno hace crecer la telaraña de Araña ───── */
const HITOS = [
  ...[2, 10, 25, 50, 100, 250, 500, 1000].map(g => ({ id: 'g' + g, texto: g === 2 ? 'Mi primera generación completa' : `Generación ${g} completada`, ok: r => r.gen + 1 >= g })),
  ...[1300, 1400, 1500, 1600, 1800, 2000].map(e => ({ id: 'e' + e, texto: `Una campeona llega a ${e} de Elo`, ok: r => r.mejor.elo >= e })),
  { id: 'sf-tablas', texto: 'Mis primeras tablas contra Stockfish', ok: r => !!(r.sf && r.sf.juegos.some(j => j.res === .5)) },
  { id: 'sf-gana', texto: 'Mi primera victoria contra Stockfish', ok: r => !!(r.sf && r.sf.juegos.some(j => j.res === 1)) },
  ...[1, 3, 6, 9, 12].map(n => ({ id: 'p' + n, texto: n === 12 ? 'Conquisto el último peldaño: Stockfish a plena potencia' : `Peldaño ${n} conquistado: ${ESCALERA[n - 1].nombre}`, ok: () => !!(est.escalera && est.escalera.conquistas[n]) })),
  { id: 'sacudida', texto: 'Me estanqué y sacudí la mutación para explorar', ok: () => (est.sacudidas || 0) > 0 },
  { id: 'inmigrante', texto: 'Una inmigrante llega a la élite', ok: r => r.elite.some(id => { const p = byId.get(id); return p && p.mut && p.mut.nacio === 'inmigrante'; }) },
  { id: 'red3', texto: 'Una araña de la élite con 3 neuronas ocultas propias', ok: r => r.elite.some(id => { const p = byId.get(id); return p && p.genes && M.huella(p.genes).r >= 3; }) },
  { id: 'caza', texto: 'Una cazadora gana a la campeona', ok: () => !!est.cazaGana },
  { id: 'importa', texto: 'Llega una araña de otro aparato', ok: () => false },
  { id: 'sangre', texto: 'Corre por mi población sangre de otro aparato', ok: () => pop.some(p => p.origen !== ORIGEN && p.origen !== 'cazadora') },
  { id: 'juan-gana', texto: 'Juan me gana una partida', ok: () => false },
  { id: 'gano-juan', texto: 'Le gano una partida a Juan', ok: () => false },
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
  avisarApp({ tipo: 'hito', texto: h.texto });
}
function darHito(id) { const h = HITOS.find(x => x.id === id); if (!h || est.hitos[id]) return; est.hitos[id] = { fecha: new Date().toISOString(), gen: est.gen }; guardarEstado().catch(() => {}); anunciarHito(h); pintarEstado(); }

/* ───── Mantener la pantalla encendida mientras entrena ───── */
let candado = null;
async function pedirCandado() { try { if (navigator.wakeLock && entrenando) candado = await navigator.wakeLock.request('screen'); } catch (e) { candado = null; } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pedirCandado(); });
function entrenar(si) {
  entrenando = si;
  $('#go').textContent = si ? '⏸ Pausar' : '▶ Entrenar';
  const aa = ANDROID(); if (aa && typeof aa.pantalla === 'function') { try { aa.pantalla(!!si); } catch (e) {} }
  if (si) { pedirCandado(); if (sfFase) faseStockfish(); else { if (!juegos.length) prepararGeneracion(); repartir(); } }
  else if (candado) { candado.release().catch(() => {}); candado = null; }
  pintarEstado();
}

/* ═════════ Stockfish y la escalera ═════════
   Tras cada torneo, las mejores juegan contra Stockfish (blancas y negras, misma apertura) en el peldaño actual.
   Premio por partida: aguante (hasta 1), calidad según Stockfish (0–1) y resultado (tablas 2, victoria 3).
   Si sacan la mitad de los puntos en las últimas 8 partidas jugadas en el peldaño, queda conquistado y se sube al siguiente. */
const sf = { w: null, listo: false, espera: null };
let sfFase = null, sfFallo = '', sfVista = null;
function sfLinea(l) { const e = sf.espera; if (!e) return; e.lineas.push(l); if (e.re.test(l)) { clearTimeout(e.t); sf.espera = null; e.ok(e.lineas); } }
function sfCmd(cmd, re, ms) {
  return new Promise((ok, ko) => {
    sf.espera = { re, ok, lineas: [], t: setTimeout(() => { sf.espera = null; ko(new Error('Stockfish no responde')); }, ms || 20000) };
    sf.w.postMessage(cmd);
  });
}
async function sfIniciar() {
  if (sf.listo) return;
  sf.w = new Worker('stockfish/stockfish-19-lite-single.js');
  sf.w.onmessage = e => sfLinea(String(e.data));
  sf.w.onerror = e => { sfFallo = (e && e.message) || 'error al cargar'; if (sf.espera) { const x = sf.espera; sf.espera = null; clearTimeout(x.t); x.ok([]); } };
  await sfCmd('uci', /^uciok/, 30000);
  sf.listo = true;
}
function puntuacion(ls) {   // la última valoración de Stockfish, desde Stockfish
  for (let i = ls.length - 1; i >= 0; i--) { const m = / score (cp|mate) (-?\d+)/.exec(ls[i]); if (m) return m[1] === 'cp' ? +m[2] : (+m[2] > 0 ? 20000 : -20000); }
  return null;
}
let sigPens = 0; const pens = new Map();
function pensarArana(p, fen0, jugadas, aj) {
  return new Promise(ok => { const id = 'p' + (++sigPens); pens.set(id, ok); hilos[0].postMessage({ t: 'pensar', id, ind: { id: p.id, genes: p.genes }, fen0, jugadas, ms: opc.ms, prof: opc.prof, flags: flagsDe(), aj }); });
}
async function partidaSF(ind, yoB, fen0, E) {
  sf.w.postMessage('ucinewgame'); sf.w.postMessage('setoption name Skill Level value ' + E.skill); await sfCmd('isready', /^readyok/);
  const pos = new M.Pos(fen0), jug = [], cal = [], aj = ajusteContra(ind, 'sf' + E.n, 'sf'); let f = null, malas = 0, buenas = 0, evYo = 0, evSF = null;
  sfVista = { fen: pos.fen(), ultima: null, ind, yoB, evYo, evSF, E }; marcarSF();
  while (true) {
    if (!entrenando) return null;
    f = M.fin(pos); if (f) break;
    if (jug.length >= opc.maxPlies) { const e = evSF == null ? 0 : evSF; f = { res: e > 300 ? (yoB ? 1 : 0) : e < -300 ? (yoB ? 0 : 1) : .5, motivo: 'límite de jugadas' }; break; }
    let u;
    if ((pos.side === 0) === yoB) {
      const r = await pensarArana(ind, fen0, jug, aj); u = r.uci; if (r.uci) evYo = yoB ? r.eval : -r.eval;
    } else {
      sf.w.postMessage('position fen ' + fen0 + (jug.length ? ' moves ' + jug.join(' ') : ''));
      const ls = await sfCmd('go ' + E.go, /^bestmove/, 30000), b = ls.length ? ls[ls.length - 1].split(/\s+/)[1] : null, sc = puntuacion(ls);
      u = b;
      if (sc != null) {
        evSF = -sc; cal.push(1 / (1 + Math.pow(10, -evSF / 400)));
        if (evSF < -1500) { malas++; buenas = 0; } else if (evSF > 1500) { buenas++; malas = 0; } else { malas = buenas = 0; }
        if (malas >= 6) f = { res: yoB ? 0 : 1, motivo: 'abandono' };
        if (buenas >= 6) f = { res: yoB ? 1 : 0, motivo: 'Stockfish abandona' };
      }
    }
    if (!u || u === '(none)') { f = M.fin(pos) || { res: .5, motivo: 'sin jugada' }; break; }
    const m = M.parseUci(pos, u); if (!m) { f = { res: .5, motivo: 'jugada imposible' }; break; }
    pos.make(m); jug.push(u);
    sfVista = { fen: pos.fen(), ultima: u, ind, yoB, evYo, evSF, E, plies: jug.length }; marcarSF();
    if (f) break;
  }
  return { res: yoB ? f.res : 1 - f.res, plies: jug.length, calidad: cal.length ? cal.reduce((a, b) => a + b) / cal.length : .5, motivo: f.motivo, jugadas: jug, fen0, yoB };
}
function finTorneo() { if (opc.sf && !sfFallo && pop.length) faseStockfish(); else cerrarGeneracion(); }
async function faseStockfish() {
  if (sfFase && sfFase.corriendo) return;
  if (!sfFase) {
    const E = ESCALERA[(est.escalera.peldano || 1) - 1], top = pop.slice().sort((a, b) => b.pts - a.pts || b.elo - a.elo).slice(0, opc.sfTop);
    sfFase = { E, cola: [], hechos: [], total: top.length * 2 };
    for (const p of top) { const fen = M.aperturaAleatoria(rng, 4); sfFase.cola.push({ id: p.id, yoB: true, fen }, { id: p.id, yoB: false, fen }); }
  }
  sfFase.corriendo = true; marcarSF();
  try { await sfIniciar(); } catch (e) { sfFallo = (e && e.message) || 'no carga'; }
  if (sfFallo) { sfFase.corriendo = false; marcarSF(); return cerrarGeneracion(); }
  while (sfFase.cola.length) {
    if (!entrenando) { sfFase.corriendo = false; marcarSF(); return; }
    const j = sfFase.cola[0], p = byId.get(j.id); let r;
    try { r = await partidaSF(p, j.yoB, j.fen, sfFase.E); } catch (e) { sfFallo = (e && e.message) || 'error'; break; }
    if (!r) { sfFase.corriendo = false; marcarSF(); return; }
    sfFase.cola.shift(); sfFase.hechos.push(Object.assign({ id: p.id, nombre: p.nombre }, r));
    p.sfb = (p.sfb || 0) + Math.min(1, r.plies / 100) + r.calidad + (r.res === 1 ? 3 : r.res === .5 ? 2 : 0);
    const reg = p.sf = p.sf || { partidas: 0, puntos: 0, mejorPeldano: 0, mejor: null };
    reg.partidas++; reg.puntos += r.res; reg.ultimo = { peldano: sfFase.E.n, res: r.res, plies: r.plies };
    recordarRival(p, 'sf' + sfFase.E.n, r.res); recordarRival(p, 'sf', r.res);
    if (r.res > 0 && (sfFase.E.n > reg.mejorPeldano || (sfFase.E.n === reg.mejorPeldano && r.res === 1))) { reg.mejorPeldano = sfFase.E.n; reg.mejor = r.res === 1 ? 'victoria' : 'tablas'; }
  }
  sfFase.corriendo = false; sfVista = null; marcarSF();
  return cerrarGeneracion();
}
let sfSucio = true;
function marcarSF() { sfSucio = true; pedir(); }
function escaleraSVG(w, h) {
  const n = ESCALERA.length, cw = w / n, act = est.escalera.peldano, con = est.escalera.conquistas;
  let s = `<svg viewBox="0 0 ${w} ${h + 18}" width="${w}" height="${h + 18}" role="img" aria-label="Escalera de Stockfish: peldaño ${act} de ${n}">`;
  for (let i = 0; i < n; i++) {
    const k = i + 1, hh = (k / n) * h, x = i * cw + 3, y = h - hh, ok = !!con[k], cur = k === act && !ok;
    s += `<rect x="${x}" y="${y}" width="${cw - 6}" height="${hh}" rx="4" fill="${ok ? 'rgba(61,255,153,.35)' : cur ? 'rgba(94,232,255,.12)' : 'none'}" stroke="${ok ? '#3dff99' : cur ? '#5ee8ff' : 'rgba(94,232,255,.3)'}" stroke-width="${cur ? 3 : 1}"/>`;
    s += `<text x="${x + (cw - 6) / 2}" y="${h + 14}" text-anchor="middle" fill="${cur ? '#5ee8ff' : 'rgba(235,235,245,.55)'}" style="font:600 12px ui-monospace,Menlo,monospace">${k}</text>`;
  }
  return s + '</svg>';
}
function pintarSF() {
  sfSucio = false;
  const z = document.getElementById('zsf'); if (!z) return;
  const act = est.escalera.peldano, E = ESCALERA[act - 1], hecho = !!est.escalera.conquistas[ESCALERA.length];
  z.querySelector('h3').textContent = hecho ? 'Escalera de Stockfish · ¡conquistada!' : `Escalera de Stockfish · peldaño ${act}: ${E.nombre}`;
  z.querySelector('.esc').innerHTML = escaleraSVG(560, 150);
  const info = z.querySelector('.sfi'), v = sfVista;
  let t;
  if (!opc.sf) t = 'La escalera está apagada en las opciones.';
  else if (sfFallo) t = `Stockfish no ha cargado (${esc(sfFallo)}). Sigo evolucionando sin escalera; vuelva a abrir la sala para reintentarlo.`;
  else if (sfFase && v) {
    const pct = x => (100 / (1 + Math.pow(10, -(x || 0) / 400))).toFixed(1);
    t = `<b>${esc(v.ind.nombre)}</b> con ${v.yoB ? 'blancas' : 'negras'} · partida ${sfFase.hechos.length + 1} de ${sfFase.total} · jugada ${Math.ceil((v.plies || 0) / 2)}
      <div class="bar"><span>Ella</span><div class="ev"><b style="width:${pct(v.evYo)}%"></b></div><i>${v.evYo > 0 ? '+' : ''}${fmt((v.evYo || 0) / 100, 2)}</i></div>
      <div class="bar"><span>Stockfish</span><div class="ev"><b style="width:${pct(v.evSF)}%"></b></div><i>${v.evSF == null ? '—' : (v.evSF > 0 ? '+' : '') + fmt(v.evSF / 100, 2)}</i></div>
      <small>Valoraciones desde la araña: más de 0, va mejor ella.</small>`;
  } else if (sfFase) t = entrenando ? 'Preparando a Stockfish…' : `En pausa: quedan ${sfFase.cola.length} partidas contra Stockfish.`;
  else t = `Cuando acabe el torneo, las ${opc.sfTop} mejores subirán aquí: blancas y negras contra Stockfish. Conquistan el peldaño si sacan la mitad de los puntos en sus últimas 8 partidas en él${(est.escalera.ventana || []).length ? ` (llevan ${fmt(est.escalera.ventana.reduce((a, b) => a + b, 0), 1)} de ${est.escalera.ventana.length})` : ''}.`;
  info.innerHTML = t;
  if (nivel !== 'lejos') tablero(z.querySelector('canvas'), v ? v.fen : M.INICIO, v ? v.ultima : null, true, v ? (v.yoB ? 'b' : 'w') : 'b');
}

/* ═════════ El plano ═════════ */
const CW = 260, CH = 360, GAP = 24, PAD = 30, COLS = 4;
let W0 = 0, H0 = 0, esc0 = 1, nivel = '', mesas = [];
const plano = $('#plano'), tam = $('#tam'), lienzo = $('#lienzo');
function construirPlano() {
  const n = Math.max(1, Math.floor(pop.length / 2)), filas = Math.ceil(n / COLS);
  W0 = PAD * 2 + COLS * CW + (COLS - 1) * GAP;
  const yZ = PAD + filas * CH + (filas - 1) * GAP + 40;
  H0 = yZ + 320 + 24 + 300 + PAD;
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
  h += `<div class="zona zsf" id="zsf" style="left:${PAD}px;top:${yZ}px;width:${wz}px;height:320px"><h3>Escalera de Stockfish</h3>
      <canvas width="240" height="240" aria-label="Partida contra Stockfish"></canvas><div class="sfi"></div><div class="esc"></div></div>
    <div class="zona zcz" id="zcz" style="left:${PAD}px;top:${yZ + 344}px;width:${wz}px;height:300px"><h3>Rincón de las cazadoras</h3>
      <canvas width="240" height="240" aria-label="Partida de una cazadora"></canvas><div class="czi"></div><div class="czl"></div></div>`;
  lienzo.innerHTML = h; lienzo.style.width = W0 + 'px'; lienzo.style.height = H0 + 'px';
  mesas = Array.from(lienzo.querySelectorAll('.mesa')); sfSucio = true; cazaSucio = true;
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
  if (redibujar) { mesas.forEach((_, m) => sucio.add(m)); redibujarSF = true; pedir(); }
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
/* Stockfish: un pez de puntos y líneas */
function pez(g, x, y, r, color, hacia) {
  const ang = hacia ? Math.atan2(hacia[1] - y, hacia[0] - x) : 0;
  g.save(); g.translate(x, y); g.rotate(ang); g.strokeStyle = color; g.fillStyle = color; g.lineWidth = Math.max(1, r * .14);
  g.beginPath(); g.ellipse(0, 0, r * 1.1, r * .62, 0, 0, 7); g.stroke();
  g.beginPath(); g.moveTo(-r * 1.05, 0); g.lineTo(-r * 1.8, -r * .65); g.lineTo(-r * 1.8, r * .65); g.closePath(); g.stroke();
  g.beginPath(); g.arc(r * .55, -r * .12, r * .15, 0, 7); g.fill();
  for (const k of [-.4, 0, .4]) { g.beginPath(); g.arc(k * r, r * .2, r * .08, 0, 7); g.fill(); }
  g.restore();
}
function tablero(cv, fen, ultima, conAranas, pezEn) {
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
    (pezEn === 'w' ? pez : arana)(g, pB[0], pB[1], 8, '#5ee8ff', !mueveNegra && hasta ? hasta : [120, 120]);
    (pezEn === 'b' ? pez : arana)(g, pN[0], pN[1], 8, '#ff4fa3', mueveNegra && hasta ? hasta : [120, 120]);
  }
}
let sucio = new Set(), pedido = false, redibujarSF = false;
function marcar(j) { if (j && j.tipo === 'caza') { cazaVista = j; cazaSucio = true; return pedir(); } if (j) sucio.add(j.mesa); else { mesas.forEach((_, m) => sucio.add(m)); cazaSucio = true; } pedir(); }
let cazaVista = null, cazaSucio = true;
function pintarCaza() {
  cazaSucio = false;
  const z = document.getElementById('zcz'); if (!z) return;
  const on = flagsDe()[34], info = z.querySelector('.czi'), lista = z.querySelector('.czl');
  z.querySelector('h3').textContent = 'Rincón de las cazadoras' + (on ? ` · generación ${est.caz ? est.caz.gen : 1}` : ' · apagado');
  if (!on) { info.textContent = 'Los parásitos están apagados en las opciones.'; lista.innerHTML = ''; return; }
  const j = cazaVista && juegos.includes(cazaVista) ? cazaVista : null, pw = j && ind(j.w), pb = j && ind(j.b);
  info.innerHTML = j && pw && pb ? `<b>${esc(pw.nombre)}</b> (blancas) contra <b>${esc(pb.nombre)}</b> · ${j.estado === 'fin' ? (j.res === 1 ? '1-0' : j.res === 0 ? '0-1' : '½-½') : 'jugando'}<small>Las cazadoras evolucionan solo para ganar a la élite. Lo que pierde la élite contra ellas le resta en su generación: así tapa sus agujeros.</small>`
    : `Cuando lleguen las últimas partidas del torneo, cada cazadora jugará dos contra la élite.<small>Si una gana a la campeona, es un hito.</small>`;
  lista.innerHTML = cazadoras.map(c => `<button class="pl" data-id="${esc(c.id)}"><span>✦ ${esc(c.nombre)}</span><i>${c.pts || 0} / 2</i></button>`).join('');
  if (nivel !== 'lejos' && j) tablero(z.querySelector('canvas'), j.fenAhora, j.ultima, true);
}
function pedir() { if (!pedido) { pedido = true; requestAnimationFrame(dibujar); } }
function dibujar() {
  pedido = false;
  if (!opc.directo) { if (!$('#resumen').hidden) pintarResumen(); pintarEstado(); sucio.clear(); return; }
  for (const m of sucio) pintarMesa(m);
  if (sfSucio || redibujarSF) pintarSF();
  if (cazaSucio || redibujarSF) pintarCaza();
  redibujarSF = false;
  sucio.clear(); pintarEstado();
}
function juegosDeMesa(m) { return juegos.filter(j => j.ronda === ronda && j.mesa === m); }
const compilados = new Map();
function compilado(p) { const F = flagsDe(), k = p.id + '|' + fkey(F); let c = compilados.get(k); if (!c) { c = M.compilar(M.completar(p.genes), F); compilados.set(k, c); if (compilados.size > 80) compilados.delete(compilados.keys().next().value); } return c; }
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
  if (e.target.closest('.zona')) return;
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
    (sfFase ? ` · escalera ${sfFase.hechos.length}/${sfFase.total}` : total ? ` · ronda ${ronda + 1}/${opc.rondas} · ${hechas}/${total}` : '') +
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
async function individuo(id) { return ind(id) || await leer('individuos', id); }
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
    `<dt>Elo</dt><dd>${Math.round(p.elo)}</dd><dt>Partidas</dt><dd>${p.partidas.g} ganadas · ${p.partidas.e} tablas · ${p.partidas.p} perdidas</dd>` +
    `<dt>Contra Stockfish</dt><dd>${p.sf ? `${p.sf.partidas} partidas, ${fmt(p.sf.puntos, 1)} puntos · ${p.sf.mejor ? `su mejor: ${p.sf.mejor} en el peldaño ${p.sf.mejorPeldano}` : 'aún sin puntos'} · la última, en el peldaño ${p.sf.ultimo.peldano}, aguantó ${Math.ceil(p.sf.ultimo.plies / 2)} jugadas` : 'aún no ha subido a la escalera'}</dd></dl>`;
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
  if (p.genes) h += distopicas(p, hs);
  if (mut.cambios) {
    const top = Object.entries(mut.cambios).sort((a, b) => b[1] - a[1]).slice(0, 6);
    h += '<h2>Dónde mutó al nacer</h2><div class="det">' + top.map(([k, n]) => `<span>${esc(bloqueNombre(k))}</span><span class="v">${n} genes</span>`).join('') + '</div>';
  }
  hoja(h + CERRAR);
}
/* La ficha de sus distópicas: su red, su carácter, sus sesgos, su ritmo de mutación, su azar, su novedad y su memoria */
function distopicas(p, hs) {
  const g = M.completar(p.genes), F = flagsDe(), off = n => F[n] ? '' : ' <i style="font-style:normal;color:var(--dim)">(apagada)</i>';
  const barra = (v, a, b) => { const pct = Math.round((v - a) / (b - a) * 100); return `<span style="display:inline-block;width:90px;height:7px;border-radius:3px;background:#1b2140;vertical-align:1px;overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:#ff4fa3"></span></span>`; };
  let h = '<h2>Sus distópicas</h2><div class="det">';
  const neur = []; for (let i = 0; i < M.RED_N; i++) { const o = i * M.RED_W; if (g.red[o] > 0) neur.push({ out: g.red[o + 1], cons: [0, 1, 2, 3].map(k => [g.red[o + 2 + k * 2], g.red[o + 3 + k * 2]]).filter(c => c[1]) }); }
  h += `<span>29. Red que crece${off(29)}</span><span class="v">${neur.length} de ${M.RED_N} neuronas</span>`;
  M.CARACTER.forEach((n, i) => { h += `<span>30. ${n[0].toUpperCase() + n.slice(1)}${i ? '' : off(30)}</span><span class="v">${barra(g.caracter[i], -1, 1)} ${fmt(g.caracter[i], 2)}</span>`; });
  h += `<span>31. Anti-motor (prefiere cerradas)${off(31)}</span><span class="v">${barra(g.sesgo[0], -1, 1)} ${fmt(g.sesgo[0], 2)}</span>`;
  h += `<span>32. Caos (prefiere tácticas)${off(32)}</span><span class="v">${barra(g.sesgo[1], -1, 1)} ${fmt(g.sesgo[1], 2)}</span>`;
  h += `<span>33. Un cerebro por fase${off(33)}</span><span class="v">${F[33] ? 'apertura, medio, final' : 'un solo cerebro'}</span>`;
  h += `<span>36. Mutación propia${off(36)}</span><span class="v">σ ×${fmt(Math.exp(g.automut[0]), 2)} · prob. ×${fmt(Math.exp(g.automut[1]), 2)}</span>`;
  h += `<span>37. Novedad${off(37)}</span><span class="v">${p.novedad != null ? fmt(p.novedad, 3) : '—'}</span>`;
  h += `<span>38. Azar${off(38)}</span><span class="v">${barra(g.azar[0], 0, 1)} ${fmt(g.azar[0], 2)}</span></div>`;
  if (neur.length) h += '<details><summary>Su red, neurona a neurona</summary><div class="lin">' + neur.map((ne, i) => `<b>Neurona ${i + 1}</b> (salida ${ne.out > 0 ? '+' : ''}${fmt(ne.out, 1)}) lee: ${ne.cons.map(([f, w]) => `${esc((M.RASGOS[Math.abs(Math.round(f)) % M.RASGOS.length] || {}).nombre || '?')} (${w > 0 ? '+' : ''}${fmt(w, 2)})`).join(', ')}`).join('<br>') + '</div></details>';
  const riv = p.rivales ? Object.entries(p.rivales) : [];
  if (riv.length) {
    const nom = k => k === 'cazadoras' ? 'Las cazadoras' : k === 'sf' ? 'Stockfish (todos los peldaños)' : 'Stockfish, peldaño ' + k.slice(2);
    h += `<h2>35. Memoria del rival${off(35)}</h2><div class="det">` + riv.map(([k, r]) => { const m = r.puntos / r.partidas, a = r.partidas >= 2 && m < .3 ? ' · busca tablas' : r.partidas >= 2 && m > .6 ? ' · arriesga' : ''; return `<span>${esc(nom(k))}</span><span class="v">${fmt(r.puntos, 1)} de ${r.partidas}${a}</span>`; }).join('') + '</div><p class="nota">La memoria se hereda del padre que más le dio. Contra un rival que le gana, busca más las tablas y arriesga menos; contra uno al que gana, al revés.</p>';
  }
  if (hs && hs.some(Boolean)) {
    const fila = (n, vals, v, d) => `<div class="gen"><span><span class="dotc"></span>${esc(n)}</span>${linea(vals, '#ff4fa3', 120, 20)}<span class="v">${v == null ? '—' : fmt(v, d)}</span></div>`, ult = hs[hs.length - 1] || {};
    h += '<details><summary>Distópicas a lo largo de su linaje</summary>' +
      fila('Neuronas de su red', hs.map(x => x && x.r != null ? x.r : null), ult.r, 0) +
      M.CARACTER.map((n, i) => fila(n[0].toUpperCase() + n.slice(1), hs.map(x => x && x.c ? x.c[i] : null), ult.c && ult.c[i], 2)).join('') +
      M.SESGO.map((n, i) => fila(n[0].toUpperCase() + n.slice(1), hs.map(x => x && x.s ? x.s[i] : null), ult.s && ult.s[i], 2)).join('') +
      M.AUTOMUT.map((n, i) => fila(n[0].toUpperCase() + n.slice(1), hs.map(x => x && x.a ? Math.exp(x.a[i]) : null), ult.a && Math.exp(ult.a[i]), 2)).join('') +
      fila('Azar', hs.map(x => x && x.z != null ? x.z : null), ult.z, 2) + '</details>';
  }
  return h;
}
function bloqueNombre(k) { if (k === 'jugada') return 'Valor de cada jugada'; if (k === 'piensa') return 'Cómo piensa'; const ds = { red: '29. Su red', caracter: '30. Personalidad', sesgo: '31–32. Anti-motor y caos', automut: '36. Mutación propia', azar: '38. Azar' }; if (ds[k]) return ds[k]; const d = M.DET_BY[k]; return d ? d.n + '. ' + d.nombre : k; }

/* ═════════ Vistas auxiliares ═════════ */
const AUX = {
  biblioteca() { return biblioteca(); },
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
      ${g.some(x => x.neuronas != null) ? `<h2>Neuronas de su red de media</h2>${eje([g.map(x => x.neuronas || 0)], ['#ff4fa3'])}` : ''}
      <p class="nota">Si la diversidad cae mucho, entran inmigrantes. Si la campeona no cambia en varias generaciones, la mutación se sacude y vuelve a crecer.</p>` + CERRAR);
  },
  async arbol() {
    const G = est.gen, desde = Math.max(1, G - 4), inds = (await porGen(desde, G)).filter(p => p.origen !== 'cazadora'), mapa = new Map(inds.map(p => [p.id, p]));
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
    const ops = []; for (const p of ps) { ops.push(`<option value="g${p.gen}">Gen ${p.gen}: ${esc(p.wn)} – ${esc(p.bn)} · ${p.res === 1 ? '1-0' : p.res === 0 ? '0-1' : '½-½'} (${esc(p.motivo)})</option>`); if (p.sf) ops.push(`<option value="s${p.gen}">Gen ${p.gen}: ${esc(p.sf.nombre)} contra Stockfish (peldaño ${p.sf.peldano}) · ${p.sf.res === 1 ? 'gana' : p.sf.res === .5 ? 'tablas' : 'pierde'}</option>`); }
    hoja(`<h3>Las mejores partidas</h3><select class="full" id="repSel" aria-label="Elegir partida">${ops.join('')}</select>
      <canvas id="repCv" width="240" height="240" style="width:100%;max-width:340px;aspect-ratio:1;display:block;margin:0 auto;border-radius:8px"></canvas>
      <div class="rep"><button id="r0" aria-label="Al principio">⏮</button><button id="r1" aria-label="Jugada anterior">◀</button><button id="rp" aria-label="Reproducir">▶</button><button id="r2" aria-label="Jugada siguiente">▶︎|</button><button id="r3" aria-label="Al final">⏭</button></div>
      <div class="nota" id="repTxt" style="text-align:center"></div>` + CERRAR);
    const porG = new Map(ps.map(p => [p.gen, p])); let partida = null, fens = [], ucis = [], i = 0, pezEn = null;
    const cargarP = v => {
      const g = porG.get(+v.slice(1)); partida = v[0] === 's' ? g.sf : g; pezEn = v[0] === 's' ? (g.sf.yoB ? 'b' : 'w') : null;
      const pos = new M.Pos(partida.fen); fens = [pos.fen()]; ucis = [null];
      for (const u of partida.jugadas || []) { const m = M.parseUci(pos, u); if (!m) break; pos.make(m); fens.push(pos.fen()); ucis.push(u); }
      i = 0; pintar();
    };
    const pintar = () => { const cv = $('#repCv'); if (!cv) return; const e0 = esc0; esc0 = 1.4; tablero(cv, fens[i], ucis[i], true, pezEn); esc0 = e0; $('#repTxt').textContent = `Jugada ${Math.ceil(i / 2)} de ${Math.ceil((fens.length - 1) / 2)}${i === fens.length - 1 ? ' · ' + partida.motivo : ''}`; };
    const ir = n => { i = Math.max(0, Math.min(fens.length - 1, n)); pintar(); };
    $('#repSel').onchange = e => { clearInterval(repTimer); $('#rp').textContent = '▶'; cargarP(e.target.value); };
    $('#r0').onclick = () => ir(0); $('#r1').onclick = () => ir(i - 1); $('#r2').onclick = () => ir(i + 1); $('#r3').onclick = () => ir(fens.length - 1);
    $('#rp').onclick = () => { if (repTimer) { clearInterval(repTimer); repTimer = 0; $('#rp').textContent = '▶'; return; } $('#rp').textContent = '⏸'; repTimer = setInterval(() => { if (i >= fens.length - 1) { clearInterval(repTimer); repTimer = 0; $('#rp').textContent = '▶'; return; } ir(i + 1); }, 650); };
    cargarP('g' + ps[0].gen);
  },
  escalera() {
    const con = est.escalera.conquistas, act = est.escalera.peldano, gs = historial.filter(g => g.sf);
    let h = `<h3>Escalera de Stockfish</h3><div class="sub">${Object.keys(con).length} de ${ESCALERA.length} peldaños conquistados</div>${escaleraSVG(340, 110).replace('width="340"', 'width="100%"')}`;
    h += ESCALERA.slice().reverse().map(E => { const c = con[E.n]; return `<div class="hito${c ? ' si' : ''}"><span class="m"${E.n === act && !c ? ' style="border-color:#5ee8ff"' : ''}></span><span>${E.n}. ${esc(E.nombre)}<small>${c ? `Conquistado en la generación ${c.gen} · ${fmt(c.puntos, 1)} de ${c.partidas} puntos · la mejor, ${esc(c.por)}` : E.n === act ? 'Peldaño actual' : 'Por llegar'} · nivel ${E.skill}, ${E.go.replace('depth', 'profundidad').replace('movetime', 'tiempo')}${E.go.startsWith('movetime') ? ' ms' : ''}</small></span></div>`; }).join('');
    if (gs.length > 1) h += '<h2>Puntos contra Stockfish por generación (%)</h2>' + chispa(gs.map(g => g.sf.puntos / g.sf.partidas * 100), 'Porcentaje de puntos contra Stockfish', '#3dff99') + '<h2>Calidad según Stockfish (%)</h2>' + chispa(gs.map(g => g.sf.calidad * 100), 'Calidad media según Stockfish', '#ffb340');
    const ult = gs[gs.length - 1];
    if (ult) h += `<h2>Última generación (${ult.gen}) · peldaño ${ult.sf.peldano}</h2><div class="det">${ult.sf.juegos.map(j => `<span data-ficha="${esc(j.id)}" style="cursor:pointer">${esc(j.nombre)} con ${j.color}</span><span class="v">${j.res === 1 ? 'gana' : j.res === .5 ? 'tablas' : 'pierde'} · ${Math.ceil(j.plies / 2)} jug.</span>`).join('')}</div>`;
    hoja(h + '<p class="nota">La calidad es cómo de bien ve Stockfish la posición para la araña a lo largo de la partida: 50 % es igualada.</p>' + CERRAR);
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

/* ═════════ Biblioteca de arañas ═════════
   Todas las arañas con genes (vivas, élite de cada generación, cazadoras e importadas de otros aparatos).
   Con cada una: jugar contra ella, duelo con la campeona, mezclarla en la población, retomar desde ella o exportarla. */
let filtroBib = 'todas';
const etiquetaOrigen = p => p.importada ? `importada de ${esc(p.importada.de || p.origen)}` : p.origen === 'cazadora' ? 'cazadora' : byId.has(p.id) ? 'viva' : 'élite guardada';
async function conGenes() {
  const vistas = new Map();
  for (const p of await todos('individuos')) if (p.genes) vistas.set(p.id, p);
  for (const p of pop.concat(cazadoras)) vistas.set(p.id, p);
  return [...vistas.values()];
}
async function biblioteca() {
  const todas = await conGenes(), F = {
    todas: () => true, vivas: p => byId.has(p.id), elite: p => !byId.has(p.id) && !p.importada && p.origen !== 'cazadora',
    importadas: p => !!p.importada, cazadoras: p => p.origen === 'cazadora' };
  const lista = todas.filter(F[filtroBib] || F.todas).sort((a, b) => b.elo - a.elo);
  const chip = (k, t) => `<button class="btn sec" data-bf="${k}" aria-pressed="${filtroBib === k}" style="padding:4px 10px;min-height:32px">${t} · ${todas.filter(F[k]).length}</button>`;
  hoja(`<h3>Biblioteca de arañas</h3><div class="sub">Elija una para jugar contra ella, retarla, mezclarla en su población o retomar desde ella</div>
    <div class="ctrl" style="margin-bottom:10px"><button class="btn" id="bImp">Importar arañas</button><button class="btn sec" id="bExp">Exportar copia</button><input type="file" id="bFile" accept=".json,application/json" hidden></div>
    <div class="ctrl" style="margin-bottom:8px">${chip('todas', 'Todas')}${chip('vivas', 'Vivas')}${chip('elite', 'Élite guardada')}${chip('importadas', 'Importadas')}${chip('cazadoras', 'Cazadoras')}</div>
    <table style="width:100%;border-collapse:collapse;font:13px/1.35 var(--mono)">${lista.slice(0, 80).map(p => `<tr data-bib="${esc(p.id)}" style="cursor:pointer;border-bottom:1px solid var(--line)"><td style="padding:7px 4px"><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${colorDe(p)};margin-right:6px"></i>${esc(p.nombre)}<div style="color:var(--muted);font-size:11.5px">g${p.gen} · ${etiquetaOrigen(p)}${p.sf && p.sf.mejor ? ` · ${p.sf.mejor} en el peldaño ${p.sf.mejorPeldano}` : ''}</div></td><td class="num" style="padding:7px 4px">${Math.round(p.elo)}</td></tr>`).join('') || '<tr><td class="nota">No hay ninguna en este grupo.</td></tr>'}</table>
    ${lista.length > 80 ? `<p class="nota">Enseño las 80 de más Elo de ${lista.length}.</p>` : ''}
    ${(est.duelos || []).length ? '<h2>Últimos duelos</h2><div class="det">' + est.duelos.slice(-6).reverse().map(d => `<span>${esc(d.a)} contra ${esc(d.b)}</span><span class="v">${fmt(d.pa, 1)} – ${fmt(d.pb, 1)}</span>`).join('') + '</div>' : ''}` + CERRAR);
  $('#hojac').querySelectorAll('[data-bf]').forEach(b => b.onclick = () => { filtroBib = b.dataset.bf; biblioteca(); });
  $('#bImp').onclick = () => $('#bFile').click();
  $('#bFile').onchange = async e => { const f = e.target.files && e.target.files[0]; if (!f) return; const t = await f.text(); const r = await importarTexto(t, f.name); avisar(r); biblioteca(); };
  $('#bExp').onclick = exportar;
  $('#hojac').querySelectorAll('[data-bib]').forEach(r => r.onclick = () => accionesDe(r.dataset.bib));
}
function avisar(t) { const a = $('#aviso'); a.textContent = t; a.classList.add('on'); clearTimeout(avisar.t); avisar.t = setTimeout(() => a.classList.remove('on'), 3500); }
async function importarTexto(texto, nombreArchivo) {
  let d; try { d = JSON.parse(texto); } catch (e) { return 'Ese archivo no es una copia de arañas.'; }
  const inds = d && d.app === 'arana-ajedrez' && Array.isArray(d.individuos) ? d.individuos.filter(p => p && p.id && p.genes) : null;
  if (!inds || !inds.length) return 'Ese archivo no trae arañas con genes.';
  const ops = [], fecha = new Date().toISOString(); let n = 0;
  for (const p0 of inds) {
    const p = JSON.parse(JSON.stringify(p0)); M.completar(p.genes);
    if (byId.has(p.id) || cazById.has(p.id)) continue;          // ya está viva aquí
    const ya = await leer('individuos', p.id);
    if (ya) continue;                                            // ya la tengo (de este aparato o importada antes)
    p.importada = { archivo: nombreArchivo, fecha, de: d.origen || p.origen };
    delete p.pts; delete p.sfb; delete p.nov;
    ops.push(['individuos', conHuella(p)]); n++;
  }
  if (!n) return 'Esas arañas ya estaban en la biblioteca.';
  await escribir(ops);
  darHito('importa');
  return `He traído ${n} arañas de ${d.origen || 'otro aparato'}.`;
}
async function accionesDe(id) {
  const p = await individuo(id); if (!p || !p.genes) return;
  const viva = byId.has(p.id), camp = campeona();
  hoja(`<h3>${esc(p.nombre)}</h3><div class="sub">g${p.gen} · ${etiquetaOrigen(p)} · Elo ${Math.round(p.elo)}</div>
    <div style="display:grid;gap:8px">
      <button class="btn" data-ac="jugar">Jugar yo contra ella</button>
      ${camp && camp.id !== p.id ? `<button class="btn sec" data-ac="duelo">Duelo contra mi campeona (${esc(camp.nombre)}), 4 partidas</button>` : ''}
      ${viva ? '' : `<button class="btn sec" data-ac="mezclar">Mezclarla en mi población</button><button class="btn sec" data-ac="retomar">Retomar la evolución desde ella</button>`}
      <button class="btn sec" data-ac="exportar">Exportar esta araña</button>
      <button class="btn sec" data-ac="ficha">Ver su ficha</button>
    </div>
    <p class="nota">Mezclar: entra en su población en lugar de la araña con menos Elo y se cruza con las suyas. Retomar: su población pasa a ser ella y 31 hijas suyas con mutaciones; la población de ahora queda guardada en la biblioteca.</p>` + CERRAR);
  $('#hojac').querySelectorAll('[data-ac]').forEach(b => b.onclick = async () => {
    const ac = b.dataset.ac;
    if (ac === 'ficha') return ficha(p.id);
    if (ac === 'jugar') return elegirColor(p);
    if (ac === 'duelo') return duelo(camp, p);
    if (ac === 'exportar') return guardarArchivo(`arana-${p.nombre.toLowerCase()}-${ORIGEN}.json`, JSON.stringify({ app: 'arana-ajedrez', v: 2, origen: ORIGEN, fecha: new Date().toISOString(), individuos: [p] }));
    if (ac === 'retomar' && !confirm(`¿Retomo la evolución desde ${p.nombre}? Su población de ahora queda guardada en la biblioteca.`)) return;
    encolar(ac, p);
  });
}
const campeona = () => { const id = est.campeon; return (id && byId.get(id)) || pop.slice().sort((a, b) => b.elo - a.elo)[0]; };
function encolar(tipo, p) {
  est.pendientes = (est.pendientes || []).filter(x => !(x.tipo === 'retomar' && tipo === 'retomar'));
  est.pendientes.push({ tipo, src: { id: p.id, nombre: p.nombre, origen: p.origen, gen: p.gen, elo: p.elo, genes: JSON.parse(JSON.stringify(p.genes)), rivales: p.rivales || null } });
  const libre = !entrenando && !juegos.some(j => j.estado !== 'cola') && !sfFase;
  if (libre) { juegos = []; aplicarPendientes(); construirPlano(); avisar(tipo === 'retomar' ? `Retomo desde ${p.nombre}.` : `${p.nombre} ya está en su población.`); }
  else avisar(`Lo haré al empezar la próxima generación.`);
  guardarEstado().catch(() => {}); cerrarHoja();
}
function copiaDe(src, nacio) {
  const c = M.nuevoIndividuo(rng, est.gen, src.origen === 'cazadora' ? 'cazadora' : src.origen, M.completar(JSON.parse(JSON.stringify(src.genes))), [src.id], { nacio });
  c.nombre = src.nombre; c.elo = src.elo || 1200; if (src.rivales) c.rivales = JSON.parse(JSON.stringify(src.rivales));
  return c;
}
function aplicarPendientes() {
  const ps = est.pendientes || []; if (!ps.length) return;
  est.pendientes = [];
  const muertas = [];
  for (const { tipo, src } of ps) {
    if (tipo === 'mezclar') {
      const peor = pop.slice(Math.min(4, pop.length - 1)).sort((a, b) => a.elo - b.elo)[0];
      const c = copiaDe(src, 'mezclada desde ' + src.nombre);
      if (peor) { pop[pop.indexOf(peor)] = c; muertas.push(peor); } else pop.push(c);
    } else if (tipo === 'retomar') {
      const base = copiaDe(src, 'retoma desde ' + src.nombre), n = pop.length || M.OPC_EVO.poblacion, F = flagsDe(), nueva = [base];
      while (nueva.length < n) {
        const g = JSON.parse(JSON.stringify(base.genes)), m = M.mutar(g, M.OPC_EVO.sigma0 * .5, M.OPC_EVO.pm, rng, F);
        const h = M.nuevoIndividuo(rng, est.gen, base.origen, g, [base.id], { cruce: { a: 1, b: 0 }, cambios: m.cambio, total: m.total, sigma: M.OPC_EVO.sigma0 * .5 });
        h.elo = base.elo; if (base.rivales) h.rivales = JSON.parse(JSON.stringify(base.rivales)); nueva.push(h);
      }
      muertas.push(...pop); pop = nueva; est.sigma = M.OPC_EVO.sigma0 * .5; est.racha = 0;
      (est.retomas = est.retomas || []).push({ gen: est.gen, desde: src.nombre, fecha: new Date().toISOString() });
    }
  }
  byId = new Map(pop.map(p => [p.id, p]));
  escribir(muertas.map(p => ['individuos', conHuella(p)])).catch(() => {});   // se guardan con sus genes: se puede volver a ellas
  if (HITOS.find(h => h.id === 'sangre').ok()) darHito('sangre');
}

/* ───── Jugar contra una araña ───── */
let hiloPropio = null;
function hiloAparte() { if (!hiloPropio) { hiloPropio = new Worker('worker.js'); hiloPropio.onmessage = e => { const d = e.data; const f = aparte.get(d.id); if (f) { if (d.t === 'jugada') f.jugada && f.jugada(d); else { aparte.delete(d.id); f.fin(d); } } }; } return hiloPropio; }
const aparte = new Map(); let sigAparte = 0;
function elegirColor(p) {
  hoja(`<h3>Contra ${esc(p.nombre)}</h3><div class="sub">¿Con qué color juega usted?</div><div class="ctrl"><button class="btn" data-col="w">Blancas</button><button class="btn sec" data-col="b">Negras</button><button class="btn sec" data-col="r">Al azar</button></div>` + CERRAR);
  $('#hojac').querySelectorAll('[data-col]').forEach(b => b.onclick = () => partidaHumana(p, b.dataset.col === 'r' ? (Math.random() < .5 ? 'w' : 'b') : b.dataset.col));
}
let ph = null;
function partidaHumana(p, color) {
  ph = { p, color, pos: new M.Pos(), jug: [], sel: -1, ultima: null, piensa: false, fin: null };
  hoja(`<h3>Usted contra ${esc(p.nombre)}</h3><div class="sub" id="phTxt"></div>
    <canvas id="phCv" width="320" height="320" style="width:100%;max-width:360px;aspect-ratio:1;display:block;margin:0 auto;border-radius:8px;touch-action:manipulation"></canvas>
    <div class="ctrl" style="justify-content:center;margin-top:10px"><button class="btn sec" id="phRend">Me rindo</button><button class="btn sec" id="phNueva">Otra partida</button></div>` + CERRAR);
  $('#phCv').addEventListener('click', toqueHumano);
  $('#phRend').onclick = () => { if (!ph.fin) acabarHumana({ res: ph.color === 'w' ? 0 : 1, motivo: 'se rinde' }); };
  $('#phNueva').onclick = () => elegirColor(p);
  pintarHumana();
  if (color === 'b') turnoArana();
}
function pintarHumana() {
  const cv = $('#phCv'); if (!cv || !ph) return;
  const g = cv.getContext('2d'), W = cv.width, q = W / 8, gir = ph.color === 'b', pos = ph.pos;
  const xy = sq => { const c = sq & 7, r = 7 - (sq >> 4); return gir ? [(7 - c) * q, (7 - r) * q] : [c * q, r * q]; };
  g.clearRect(0, 0, W, W);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { g.fillStyle = (r + c) % 2 ? 'rgba(94,232,255,.07)' : 'rgba(94,232,255,.2)'; g.fillRect(c * q, r * q, q, q); }
  if (ph.ultima) { g.fillStyle = 'rgba(61,255,153,.25)'; for (const s of [ph.ultima.slice(0, 2), ph.ultima.slice(2, 4)]) { const [x, y] = xy((s.charCodeAt(0) - 97) + (+s[1] - 1) * 16); g.fillRect(x, y, q, q); } }
  if (ph.sel >= 0) {
    const [x, y] = xy(ph.sel); g.strokeStyle = '#ff4fa3'; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, q - 3, q - 3);
    g.fillStyle = 'rgba(255,79,163,.55)';
    for (const m of M.legal(pos)) if (M.mFrom(m) === ph.sel) { const [a, b] = xy(M.mTo(m)); g.beginPath(); g.arc(a + q / 2, b + q / 2, q * .14, 0, 7); g.fill(); }
  }
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 ' + Math.round(q * .5) + 'px ui-monospace,Menlo,monospace';
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    const pz = pos.b[s]; if (!pz) continue;
    const blanca = !(pz >> 3), [x, y] = xy(s), cx = x + q / 2, cy = y + q / 2;
    g.beginPath(); g.arc(cx, cy, q * .38, 0, 7); g.fillStyle = blanca ? '#e9f6ff' : '#1b1430'; g.fill();
    g.lineWidth = Math.max(1, q * .06); g.strokeStyle = blanca ? '#5ee8ff' : '#ff4fa3'; g.stroke();
    g.fillStyle = blanca ? '#0a0c15' : '#ffd6ea'; g.fillText(LET['pnbrqk'[(pz & 7) - 1]], cx, cy + q * .03);
  }
  const t = $('#phTxt'); if (t) t.textContent = ph.fin ? ph.fin : ph.piensa ? `${ph.p.nombre} está pensando…` : M.inCheck(pos) ? 'Le toca. ¡Está en jaque!' : 'Le toca. Toque una pieza y luego su casilla.';
}
function toqueHumano(e) {
  if (!ph || ph.fin || ph.piensa) return;
  const pos = ph.pos; if ((pos.side === 0) !== (ph.color === 'w')) return;
  const r = e.currentTarget.getBoundingClientRect(), q = (r.width || 320) / 8, gir = ph.color === 'b';
  let c = Math.floor((e.clientX - r.left) / q), f = 7 - Math.floor((e.clientY - r.top) / q); if (gir) { c = 7 - c; f = 7 - f; }
  if (c < 0 || c > 7 || f < 0 || f > 7) return;
  moverHumano(c + f * 16);
}
function moverHumano(sq) {
  const pos = ph.pos, mia = pos.b[sq] && (pos.b[sq] >> 3) === pos.side;
  if (ph.sel < 0 || mia) { ph.sel = mia ? sq : -1; return pintarHumana(); }
  const ms = M.legal(pos).filter(m => M.mFrom(m) === ph.sel && M.mTo(m) === sq);
  ph.sel = -1; if (!ms.length) return pintarHumana();
  const m = ms.find(x => (x >> 14 & 7) === 5) || ms[0];   // corona en dama
  jugarEn(m); if (!ph.fin) turnoArana();
}
function jugarEn(m) {
  const u = M.uci(m); ph.pos.make(m); ph.jug.push(u); ph.ultima = u;
  const f = M.fin(ph.pos); if (f) acabarHumana(f); else pintarHumana();
}
function turnoArana() {
  ph.piensa = true; pintarHumana();
  const id = 'h' + (++sigAparte), yo = ph;
  aparte.set(id, { fin: d => { if (ph !== yo || ph.fin) return; ph.piensa = false; const m = d.uci && M.parseUci(ph.pos, d.uci); if (!m) return acabarHumana({ res: .5, motivo: 'la araña no encuentra jugada' }); jugarEn(m); } });
  hiloAparte().postMessage({ t: 'pensar', id, ind: { id: yo.p.id, genes: yo.p.genes }, fen0: M.INICIO, jugadas: yo.jug.slice(), ms: Math.max(400, opc.ms * 10), prof: 8, flags: flagsDe(), aj: ajusteContra(yo.p, 'juan') });
}
async function acabarHumana(f) {
  const yoB = ph.color === 'w', mio = yoB ? f.res : 1 - f.res;
  ph.fin = (mio === 1 ? '¡Ha ganado usted!' : mio === 0 ? `Gana ${ph.p.nombre}.` : 'Tablas.') + ` (${f.motivo})`; ph.piensa = false; pintarHumana();
  const p = ph.p; recordarRival(p, 'juan', 1 - mio);
  if (!byId.has(p.id) && !cazById.has(p.id)) await escribir([['individuos', p]]).catch(() => {}); else guardarEstado().catch(() => {});
  darHito(mio === 1 ? 'juan-gana' : mio === 0 ? 'gano-juan' : '');
}

/* ───── Duelo: la campeona contra otra araña, 4 partidas (blancas y negras, dos aperturas) ───── */
async function duelo(a, b) {
  hoja(`<h3>${esc(a.nombre)} contra ${esc(b.nombre)}</h3><div class="sub" id="duTxt">Empieza el duelo…</div>
    <canvas id="duCv" width="240" height="240" style="width:100%;max-width:340px;aspect-ratio:1;display:block;margin:0 auto;border-radius:8px"></canvas><div class="det" id="duRes" style="margin-top:10px"></div>` + CERRAR);
  const f1 = M.aperturaAleatoria(rng, 4), f2 = M.aperturaAleatoria(rng, 4), partidas = [[a, b, f1], [b, a, f1], [a, b, f2], [b, a, f2]];
  let pa = 0, pb = 0; const filas = [];
  for (let i = 0; i < partidas.length; i++) {
    const [w, n, fen] = partidas[i];
    if (!$('#duCv')) return;   // cerró la hoja
    $('#duTxt').textContent = `Partida ${i + 1} de 4 · ${w.nombre} con blancas · ${fmt(pa, 1)} – ${fmt(pb, 1)}`;
    const r = await new Promise(ok => {
      const id = 'd' + (++sigAparte);
      aparte.set(id, { jugada: d => { const cv = $('#duCv'); if (cv) { const e0 = esc0; esc0 = 1.4; tablero(cv, d.fen, d.uci, true); esc0 = e0; } }, fin: ok });
      hiloAparte().postMessage({ t: 'partida', id, w: { id: w.id, genes: w.genes }, b: { id: n.id, genes: n.genes }, fen, opc: { ms: opc.ms, prof: opc.prof, maxPlies: opc.maxPlies }, directo: true, flags: flagsDe() });
    });
    const ra = w === a ? r.res : 1 - r.res; pa += ra; pb += 1 - ra;
    filas.push(`<span>${i + 1}. ${esc(w.nombre)} – ${esc(n.nombre)}</span><span class="v">${r.res === 1 ? '1-0' : r.res === 0 ? '0-1' : '½-½'} · ${esc(r.motivo)}</span>`);
    const dr = $('#duRes'); if (dr) dr.innerHTML = filas.join('');
  }
  const t = $('#duTxt'); if (t) t.textContent = `Final: ${a.nombre} ${fmt(pa, 1)} – ${fmt(pb, 1)} ${b.nombre}` + (pa > pb ? ' · gana la campeona' : pa < pb ? ` · ¡gana ${b.nombre}!` : ' · empate');
  (est.duelos = est.duelos || []).push({ a: a.nombre, b: b.nombre, pa, pb, fecha: new Date().toISOString(), gen: est.gen });
  est.duelos = est.duelos.slice(-30); guardarEstado().catch(() => {});
}

/* ───── Opciones ───── */
function opciones() {
  const sel = (k, vals, fmtv, obj) => { const o = obj || opc, cur = o[k] != null ? o[k] : k === 'novPeso' ? 0.15 : M.OPC_EVO[k]; return `<select data-k="${k}"${obj ? ' data-evo' : ''}>${vals.map(v => `<option value="${v}"${cur === v ? ' selected' : ''}>${fmtv(v)}</option>`).join('')}</select>`; };
  est.opc = est.opc || {};
  hoja(`<h3>Opciones de entrenamiento</h3><div class="sub">Se aplican a la próxima generación</div>
    <label class="op">Tiempo por jugada ${sel('ms', [10, 30, 60, 120, 250], v => v + ' ms')}</label>
    <label class="op">Profundidad máxima ${sel('prof', [2, 3, 4, 5, 6], v => v + ' jugadas')}</label>
    <label class="op">Partidas por araña ${sel('rondas', [2, 4, 6, 8], v => v * 2)}</label>
    <label class="op">Límite de jugadas ${sel('maxPlies', [120, 160, 240], v => v / 2)}</label>
    <label class="op">Escalera de Stockfish ${sel('sf', [1, 0], v => v ? 'Sí' : 'No')}</label>
    <label class="op">Arañas que suben a la escalera ${sel('sfTop', [2, 4, 8], v => v)}</label>
    <label class="op">Arañas por generación ${sel('poblacion', [16, 24, 32, 48, 64], v => v, est.opc)}</label>
    <label class="op">Probabilidad de mutar cada gen ${sel('pm', [0.03, 0.06, 0.12], v => Math.round(v * 100) + ' %', est.opc)}</label>
    <h2>Distópicas</h2>
    ${M.DIST.map(([n, nombre]) => `<label class="op">${n}. ${nombre} <select data-dist="${n}"><option value="1"${flagsDe()[n] ? ' selected' : ''}>Sí</option><option value="0"${flagsDe()[n] ? '' : ' selected'}>No</option></select></label>`).join('')}
    <label class="op">Peso de la novedad ${sel('novPeso', [0, 0.05, 0.15, 0.3], v => Math.round(v * 100) + ' %', est.opc)}</label>
    <p class="nota">Apagar una distópica no borra sus genes: siguen heredándose y vuelven a contar si la enciende. Los parásitos añaden 16 partidas por generación.</p>
    <p class="nota">Más tiempo por jugada juega mejor pero evoluciona más despacio. Con ${NHILOS} hilos, una generación de ${pop.length} arañas tarda unos ${Math.max(1, Math.round(pop.length * opc.rondas * (opc.maxPlies * .45) * opc.ms / 1000 / NHILOS / 60))} min.</p>
    <div class="ctrl"><button class="btn sec" id="exp">Exportar copia</button><button class="btn sec" id="reset">Empezar de cero</button><button class="btn" data-cerrar>Hecho</button></div>`);
  $('#hojac').querySelectorAll('select').forEach(s => s.onchange = () => {
    if (s.dataset.dist) { est.opc.dist = Object.assign({}, est.opc.dist || {}, { [s.dataset.dist]: +s.value }); compilados.clear(); guardarEstado().catch(() => {}); marcar(); return; }
    if (s.hasAttribute('data-evo')) { est.opc[s.dataset.k] = +s.value; guardarEstado().catch(() => {}); } else { opc[s.dataset.k] = +s.value; guardarOpc(); marcarSF(); }
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
  return guardarArchivo(`arana-ajedrez-${ORIGEN}-gen${est.gen}.json`, JSON.stringify(datos));
}
async function guardarArchivo(nombreF, texto) {
  const io = IOS_APP(); if (io) { io.postMessage({ tipo: 'guardar', nombre: nombreF, texto }); return; }
  const aa = ANDROID(); if (aa && typeof aa.guardarArchivo === 'function') { aa.guardarArchivo(nombreF, texto); return; }
  const blob = new Blob([texto], { type: 'application/json' });
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
$('#salir').onclick = () => { entrenar(false); if (!avisarApp({ tipo: 'salir' })) location.href = '../'; };
document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarHoja(); });
window.addEventListener('message', e => { if (e.data && e.data.arana === 'ajedrez-entrenar') entrenar(true); });

/* Para pruebas */
window.__sala = { importarTexto, accionesDe, partidaHumana, moverHumano, humana: () => ph, duelo, campeona, encolar, conGenes, escalera: ESCALERA, sfEstado: () => ({ fase: sfFase, fallo: sfFallo, vista: sfVista }), estado: () => est, pop: () => pop, juegos: () => juegos, entrenar, ficha, opciones, cerrarGeneracion, exportar, aux: AUX, nivel: () => nivel, escala: () => esc0, zoom: s => aplicarEscala(s, true), acercarMesa, verTodo };

cargar().then(() => {
  crearHilos(); construirPlano(); ponerVista(); pintarEstado();
  if (qs.get('entrenar') === '1') entrenar(true);
}).catch(e => { $('#estado').textContent = 'No he podido abrir la sala: ' + e.message; });
})();
