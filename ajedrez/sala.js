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
  { n: 3, nombre: 'Mira tres jugadas', skill: 0, go: 'depth 3' }, { n: 4, nombre: 'Aprendiz', skill: 1, go: 'depth 3' },
  { n: 5, nombre: 'Principiante', skill: 2, go: 'depth 3' }, { n: 6, nombre: 'Principiante atento', skill: 2, go: 'depth 4' },
  { n: 7, nombre: 'Jugador de club', skill: 3, go: 'depth 4' }, { n: 8, nombre: 'Club fuerte', skill: 4, go: 'depth 4' },
  { n: 9, nombre: 'Club que calcula', skill: 4, go: 'depth 5' }, { n: 10, nombre: 'Jugador de torneo', skill: 5, go: 'depth 5' },
  { n: 11, nombre: 'Torneo fuerte', skill: 6, go: 'depth 5' }, { n: 12, nombre: 'Candidato a experto', skill: 7, go: 'depth 6' },
  { n: 13, nombre: 'Experto', skill: 8, go: 'depth 6' }, { n: 14, nombre: 'Candidato a maestro', skill: 9, go: 'depth 7' },
  { n: 15, nombre: 'Maestro', skill: 10, go: 'depth 8' }, { n: 16, nombre: 'Maestro internacional', skill: 12, go: 'depth 10' },
  { n: 17, nombre: 'Gran maestro', skill: 15, go: 'movetime 50' }, { n: 18, nombre: 'Gran maestro de élite', skill: 18, go: 'movetime 100' },
  { n: 19, nombre: 'Plena potencia', skill: 20, go: 'movetime 100' }, { n: 20, nombre: 'Plena potencia, sin prisa', skill: 20, go: 'movetime 500' }];
/* Antes había 12 peldaños: cada uno es ahora este (los nuevos quedan en medio) */
const DE_12_A_20 = { 1: 1, 2: 2, 3: 4, 4: 5, 5: 7, 6: 8, 7: 10, 8: 11, 9: 13, 10: 15, 11: 17, 12: 19 };
function migrarEscalera(e) {
  if (e.v >= 2) return e;
  const con = {}; let max = 0;
  for (const k of Object.keys(e.conquistas || {})) { const n = DE_12_A_20[k]; if (n) { con[n] = e.conquistas[k]; if (n > max) max = n; } }
  for (let n = 1; n < max; n++) if (!con[n]) con[n] = Object.assign({}, con[max], { nota: 'por debajo de un peldaño ya conquistado' });
  return { v: 2, peldano: max ? Math.min(ESCALERA.length, max + 1) : 1, conquistas: con, ventana: max + 1 === DE_12_A_20[e.peldano] ? (e.ventana || []) : [] };
}

/* ───── Opciones (se guardan en el aparato) ───── */
const OPC_DEF = { ms: 30, prof: 4, rondas: 4, maxPlies: 160, directo: true, sf: 1, sfTop: 4, ana: 1 };
let opc = OPC_DEF;
try { opc = Object.assign({}, OPC_DEF, JSON.parse(localStorage.getItem('arana.ajedrez.opc') || '{}')); } catch (e) { opc = Object.assign({}, OPC_DEF); }
const guardarOpc = () => { try { localStorage.setItem('arana.ajedrez.opc', JSON.stringify(opc)); } catch (e) {} };

/* ───── Evoluciones: cada una en su propia base de datos, para empezar otra sin perder la de ahora ───── */
const SLOTS_K = 'arana.ajedrez.slots', SLOT_K = 'arana.ajedrez.slot';
function leerSlots() { try { const l = JSON.parse(localStorage.getItem(SLOTS_K) || 'null'); if (Array.isArray(l) && l.length) return l; } catch (e) {} return [{ id: 'principal', nombre: 'Mi evolución', creada: new Date().toISOString() }]; }
let slots = leerSlots(), slotId = (() => { try { return localStorage.getItem(SLOT_K) || 'principal'; } catch (e) { return 'principal'; } })();
if (!slots.some(x => x.id === slotId)) slotId = slots[0].id;
const guardarSlots = () => { try { localStorage.setItem(SLOTS_K, JSON.stringify(slots)); localStorage.setItem(SLOT_K, slotId); } catch (e) {} };
const dbNombre = id => id === 'principal' ? 'arana-ajedrez' : 'arana-ajedrez-' + id;
const slotActual = () => slots.find(x => x.id === slotId) || slots[0];

/* ───── Base de datos: memoria aparte de la del asistente ───── */
let db = null;
function abrirDB(nombre) {
  return new Promise((ok, ko) => {
    if (!window.indexedDB) return ok(null);
    const r = indexedDB.open(nombre || dbNombre(slotId), 2);
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
const genesTodas = () => !!(est && est.opc && est.opc.genesTodas);   // guardar también los genes de las que mueren (ocupa más)

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
    est = { gen: 1, origen: ORIGEN, opc: {}, creada: new Date().toISOString(), hitos: {}, escalera: { v: 2, peldano: 1, conquistas: {} } };
    pop = M.poblacionInicial(rng, ORIGEN, M.OPC_EVO.poblacion);
    await guardarEstado();
  }
  est.hitos = est.hitos || {}; est.escalera = migrarEscalera(est.escalera || { peldano: 1, conquistas: {} });
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
  if (d.t === 'jugada') { j.fenAhora = d.fen; j.ultima = d.uci; j.eval = d.eval; (j.lista = j.lista || []).push(d.uci); marcar(j); actualizarVisor(); return; }
  if (d.t === 'fin') {
    w.libre = true; enCurso.delete(d.id);
    j.estado = 'fin'; j.res = d.res; j.motivo = d.motivo; j.jugadas = d.jugadas; j.lista = d.jugadas.slice(); j.fenAhora = d.fen; j.plies = d.plies; actualizarVisor();
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
  const antes = new Map(viejos.map(p => [p.id, p])), cazAntes = new Map(cazadoras.map(c => [c.id, c]));
  for (const h of out.pop) if (h.padres && h.padres.length && !h.rivales) { const cr = h.mut && h.mut.cruce, pa = antes.get(h.padres[cr && cr.b > cr.a ? 1 : 0]); if (pa && pa.rivales) h.rivales = JSON.parse(JSON.stringify(pa.rivales)); }
  // Las cazadoras también evolucionan
  const extraCaz = [];
  if (F[34] && cazadoras.length) {
    est.caz.flags = F;
    const oc = M.siguienteGeneracion(est.caz, cazadoras, rng), vivasC = new Set(oc.pop.map(c => c.id)), eliteC = new Set(oc.resumen.elite);
    out.resumen.caza = { mejor: oc.resumen.mejor, puntos: cazadoras.reduce((a, c) => a + c.pts, 0), partidas: cazadoras.length * 2 };
    for (const c of cazadoras) if (!vivasC.has(c.id)) { conHuella(c); c.murio = est.gen; extraCaz.push(['individuos', Object.assign({}, c, { genes: eliteC.has(c.id) || genesTodas() ? c.genes : null })]); }
    oc.pop.forEach(c => { if (!c.mut || !c.mut.nacio) { c.mut = c.mut || {}; } c.pts = 0; });
    cazadoras = oc.pop; cazById = new Map(cazadoras.map(c => [c.id, c]));
  }
  const elite = new Set(out.resumen.elite);
  const vivos = new Set(out.pop.map(p => p.id)), extra = [['generaciones', out.resumen]].concat(extraCaz);
  if (mejorPartida) {   // todas las partidas de la generación, con sus jugadas
    const nom = id => (ind(id) || antes.get(id) || cazAntes.get(id) || { nombre: '?' }).nombre;
    mejorPartida.todas = juegos.filter(j => j.estado === 'fin').map(j => ({ tipo: j.tipo || '', wn: nom(j.w), bn: nom(j.b), w: j.w, b: j.b, fen: j.fen, jugadas: (j.jugadas || []).join(' '), res: j.res, motivo: j.motivo }))
      .concat(fase ? fase.hechos.map(x => ({ tipo: 'sf', wn: x.yoB ? x.nombre : 'Stockfish', bn: x.yoB ? 'Stockfish' : x.nombre, fen: x.fen0, jugadas: x.jugadas.join(' '), res: x.yoB ? x.res : 1 - x.res, motivo: x.motivo, peldano: fase.E.n })) : []);
    extra.push(['partidas', Object.assign({ gen: out.resumen.gen }, mejorPartida)]);
  }
  for (const p of viejos) if (!vivos.has(p.id)) { conHuella(p); p.murio = out.resumen.gen; extra.push(['individuos', Object.assign({}, p, { genes: elite.has(p.id) || genesTodas() ? p.genes : null })]); }
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
  ...[1, 3, 5, 10, 15, 20].map(n => ({ id: 'p' + n, texto: n === 20 ? 'Conquisto el último peldaño: Stockfish a plena potencia y sin prisa' : `Peldaño ${n} conquistado: ${ESCALERA[n - 1].nombre}`, ok: () => !!(est.escalera && est.escalera.conquistas[n]) })),
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
  sfVista = { fen: pos.fen(), ultima: null, ind, yoB, evYo, evSF, E, jug, fen0 }; marcarSF();
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
    sfVista = { fen: pos.fen(), ultima: u, ind, yoB, evYo, evSF, E, plies: jug.length, jug, fen0 }; marcarSF(); actualizarVisor();
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
  const n = ESCALERA.length, cw = w / n, act = est.escalera.peldano, con = est.escalera.conquistas, fs = cw < 22 ? 9 : 12;
  let s = `<svg viewBox="0 0 ${w} ${h + 18}" width="${w}" height="${h + 18}" role="img" aria-label="Escalera de Stockfish: peldaño ${act} de ${n}">`;
  for (let i = 0; i < n; i++) {
    const k = i + 1, hh = (k / n) * h, x = i * cw + 3, y = h - hh, ok = !!con[k], cur = k === act && !ok;
    s += `<rect x="${x}" y="${y}" width="${cw - 6}" height="${hh}" rx="4" fill="${ok ? 'rgba(61,255,153,.35)' : cur ? 'rgba(94,232,255,.12)' : 'none'}" stroke="${ok ? '#3dff99' : cur ? '#5ee8ff' : 'rgba(94,232,255,.3)'}" stroke-width="${cur ? 3 : 1}"/>`;
    s += `<text x="${x + (cw - 6) / 2}" y="${h + 14}" text-anchor="middle" fill="${cur ? '#5ee8ff' : 'rgba(235,235,245,.55)'}" style="font:600 ${fs}px ui-monospace,Menlo,monospace">${k}</text>`;
  }
  return s + '</svg>';
}
function pintarSF() {
  sfSucio = false;
  const z = document.getElementById('zsf'); if (!z) return;
  const act = est.escalera.peldano, E = ESCALERA[act - 1], hecho = !!est.escalera.conquistas[ESCALERA.length];
  z.querySelector('h3').textContent = hecho ? 'Escalera de Stockfish · ¡conquistada!' : `Escalera de Stockfish · peldaño ${act}: ${E.nombre}`;
  z.querySelector('.esc').innerHTML = escaleraSVG(480, 170);
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
  H0 = yZ + 360 + 24 + 330 + PAD + 60;
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
  h += `<div class="zona zsf" id="zsf" style="left:${PAD}px;top:${yZ}px;width:${wz}px;height:360px"><h3>Escalera de Stockfish</h3>
      <canvas width="240" height="240" aria-label="Partida contra Stockfish (tóquela para verla con sus jugadas)"></canvas><div class="sfi"></div><div class="esc"></div></div>
    <div class="zona zcz" id="zcz" style="left:${PAD}px;top:${yZ + 384}px;width:${wz}px;height:330px"><h3>Rincón de las cazadoras</h3>
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
/* El tablero, verde y crema, con las piezas «cburnett» (piezas.js). o: girar, coords, sel, destinos, base (resolución) */
const CLARA = '#eeeed2', OSCURA = '#769656';
const IMG = {}; let imgListas = 0;
(function cargarPiezas() {
  const svgs = window.PIEZAS_SVG || {};
  for (const k of Object.keys(svgs)) {
    const im = new Image();
    im.onload = () => { if (++imgListas === Object.keys(svgs).length) { redibujarSF = true; marcar(); if (visor) pintarVisor(); if (ph) pintarHumana(); } };
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgs[k]); IMG[k] = im;
  }
})();
const TIPO = { p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };
function pieza(g, ch, x, y, q) {
  const blanca = ch !== ch.toLowerCase(), im = IMG[(blanca ? 'w' : 'b') + TIPO[ch.toLowerCase()]];
  if (im && im.complete && im.naturalWidth !== 0) { g.drawImage(im, x, y, q, q); return; }
  g.beginPath(); g.arc(x + q / 2, y + q / 2, q * .38, 0, 7); g.fillStyle = blanca ? '#fff' : '#333'; g.fill();   // mientras cargan
  g.lineWidth = Math.max(1, q * .05); g.strokeStyle = blanca ? '#333' : '#000'; g.stroke();
  g.fillStyle = blanca ? '#111' : '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 ' + Math.round(q * .46) + 'px -apple-system,system-ui,sans-serif';
  g.fillText(TIPO[ch.toLowerCase()], x + q / 2, y + q / 2 + q * .03);
}
function tablero(cv, fen, ultima, conAranas, pezEn, o) {
  o = o || {};
  const base = o.base || Math.max(.6, esc0), dpr = Math.min(2, window.devicePixelRatio || 1), px = Math.round(240 * base * dpr);
  if (cv.width !== px) { cv.width = px; cv.height = px; }
  const g = cv.getContext('2d'); g.setTransform(px / 240, 0, 0, px / 240, 0, 0); g.clearRect(0, 0, 240, 240);
  const m = conAranas ? 26 : 0, L = 240 - m * 2, q = L / 8, gir = !!o.girar;
  const XY = (c, r) => gir ? [m + (7 - c) * q, m + (7 - r) * q] : [m + c * q, m + r * q];   // c: columna (0 = a), r: fila desde arriba (0 = la 8)
  const deSq = sq => [sq & 7, 7 - (sq >> 4)];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const [x, y] = XY(c, r); g.fillStyle = (r + c) % 2 ? OSCURA : CLARA; g.fillRect(x, y, q, q); }
  if (o.sel >= 0 && o.sel != null) { const [x, y] = XY(...deSq(o.sel)); g.fillStyle = 'rgba(255,255,51,.5)'; g.fillRect(x, y, q, q); }
  if (o.coords) {
    g.font = '700 ' + Math.max(6, Math.round(q * .2)) + 'px -apple-system,system-ui,sans-serif';
    for (let v = 0; v < 8; v++) {
      const r = gir ? 7 - v : v, c0 = gir ? 7 : 0, [x0, y0] = XY(c0, r);
      g.fillStyle = (r + c0) % 2 ? CLARA : OSCURA; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(String(8 - r), x0 + q * .06, y0 + q * .05);
      const c = gir ? 7 - v : v, r7 = gir ? 0 : 7, [x1, y1] = XY(c, r7);
      g.fillStyle = (r7 + c) % 2 ? CLARA : OSCURA; g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText('abcdefgh'[c], x1 + q * .95, y1 + q * .97);
    }
  }
  fen.split(' ')[0].split('/').forEach((f, r) => {
    let c = 0;
    for (const ch of f) { if (ch >= '1' && ch <= '8') { c += +ch; continue; } const [x, y] = XY(c, r); pieza(g, ch, x, y, q); c++; }
  });
  if (o.destinos) for (const d of o.destinos) {
    const [x, y] = XY(...deSq(d)), ocupada = /[a-z]/i.test(fen.split(' ')[0]) && casillaOcupada(fen, d);
    g.fillStyle = 'rgba(0,0,0,.16)'; g.beginPath();
    if (ocupada) { g.lineWidth = q * .09; g.strokeStyle = 'rgba(0,0,0,.18)'; g.arc(x + q / 2, y + q / 2, q * .44, 0, 7); g.stroke(); }
    else { g.arc(x + q / 2, y + q / 2, q * .16, 0, 7); g.fill(); }
  }
  if (conAranas) {
    // Juega quien no tiene el turno: lanza su hilo a la casilla donde dejó la pieza
    let hasta = null;
    if (ultima) { const [x, y] = XY(ultima.charCodeAt(2) - 97, 8 - +ultima[3]); hasta = [x + q / 2, y + q / 2]; }
    const mueveNegra = fen.split(' ')[1] === 'w', pB = [14, 226], pN = [226, 14];
    if (hasta) {
      const or = mueveNegra ? pN : pB;
      g.strokeStyle = mueveNegra ? 'rgba(255,79,163,.9)' : 'rgba(94,232,255,.9)'; g.lineWidth = 1.2; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(or[0], or[1]); g.lineTo(hasta[0], hasta[1]); g.stroke(); g.setLineDash([]);
    }
    (pezEn === 'w' ? pez : arana)(g, pB[0], pB[1], 8, '#5ee8ff', !mueveNegra && hasta ? hasta : [120, 120]);
    (pezEn === 'b' ? pez : arana)(g, pN[0], pN[1], 8, '#ff4fa3', mueveNegra && hasta ? hasta : [120, 120]);
  }
}
function casillaOcupada(fen, sq) {
  const filas = fen.split(' ')[0].split('/'), r = 7 - (sq >> 4), c = sq & 7; let k = 0;
  for (const ch of filas[r]) { if (ch >= '1' && ch <= '8') { k += +ch; if (k > c) return false; continue; } if (k === c) return true; k++; }
  return false;
}

/* ═════════ El visor de partidas: tablero grande, jugadas en inglés y análisis de Stockfish ═════════ */
let visor = null;
function verPartida(o) {
  const v = Object.assign({ fen0: M.INICIO, ucis: [], idx: null, girar: false, info: {} }, o);
  if (v.idx == null) v.idx = v.ucis.length;
  hoja(`<h3>${esc(v.titulo || 'Partida')}</h3><div class="sub" id="vSub">${esc(v.sub || '')}</div>
    <div class="ana" id="vAna"></div>
    <canvas id="vCv" class="tabg" width="240" height="240" aria-label="Tablero"></canvas>
    <div class="rep"><button id="v0" aria-label="Al principio">⏮</button><button id="v1" aria-label="Jugada anterior">◀</button><button id="v2" aria-label="Jugada siguiente">▶</button><button id="v3" aria-label="Al final">⏭</button><button id="vG" aria-label="Girar el tablero">⇅</button></div>
    <div class="jugadas" id="vLista"></div>
    <div class="ctrl" style="margin-top:12px"><button class="btn sec" id="vSF" aria-pressed="${!!opc.ana}">Análisis de Stockfish</button><button class="btn sec" id="vPgn">Copiar PGN</button><button class="btn sec" data-cerrar>Cerrar</button></div>`);
  visor = v;
  const ir = n => { visor.idx = Math.max(0, Math.min(visor.ucis.length, n)); pintarVisor(); };
  $('#v0').onclick = () => ir(0); $('#v1').onclick = () => ir(visor.idx - 1); $('#v2').onclick = () => ir(visor.idx + 1); $('#v3').onclick = () => ir(visor.ucis.length);
  $('#vG').onclick = () => { visor.girar = !visor.girar; pintarVisor(); };
  $('#vSF').onclick = () => { opc.ana = opc.ana ? 0 : 1; guardarOpc(); $('#vSF').setAttribute('aria-pressed', String(!!opc.ana)); if (!opc.ana) anaParar(); pintarVisor(); };
  $('#vPgn').onclick = () => copiar(M.pgn(visor.fen0, visor.ucis, visor.info), $('#vPgn'));
  $('#vLista').onclick = e => { const b = e.target.closest('[data-i]'); if (b) ir(+b.dataset.i); };
  pintarVisor();
}
function posEn(fen0, ucis, n) { const pos = new M.Pos(fen0); for (let i = 0; i < n; i++) { const m = M.parseUci(pos, ucis[i]); if (!m) break; pos.make(m); } return pos; }
function pintarVisor() {
  if (!visor || !$('#vCv')) return;
  const pos = posEn(visor.fen0, visor.ucis, visor.idx), fen = pos.fen();
  tablero($('#vCv'), fen, null, false, null, { coords: true, girar: visor.girar, base: 1.6 });
  $('#vLista').innerHTML = listaHTML(visor.fen0, visor.ucis, visor.idx);
  const cur = $('#vLista .cur'); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (visor.estado) $('#vSub').textContent = visor.estado();
  if (opc.ana) analizar(fen, '#vAna'); else $('#vAna').innerHTML = '';
}
/* Las jugadas numeradas, en inglés: 1. e4 e5 2. Nf3 Nc6 */
function listaHTML(fen0, ucis, idx) {
  const ss = M.sanLista(fen0, ucis), p0 = new M.Pos(fen0); let n = p0.full, h = '';
  if (!ss.length) return '<span class="nota">Aún no hay jugadas.</span>';
  ss.forEach((x, k) => {
    const blancas = (p0.side === 0) === (k % 2 === 0);
    if (blancas) h += `<span class="n">${n}.</span>`; else if (k === 0) h += `<span class="n">${n}…</span>`;
    h += `<button data-i="${k + 1}"${k + 1 === idx ? ' class="cur"' : ''}>${esc(x)}</button>`;
    if (!blancas) n++;
  });
  return h;
}
function actualizarVisor() {
  if (!visor || !visor.fuente) return;
  const u = visor.fuente(); if (!u) return;
  if (u.length === visor.ucis.length) { if (visor.estado && $('#vSub')) $('#vSub').textContent = visor.estado(); return; }
  const alFinal = visor.idx === visor.ucis.length; visor.ucis = u.slice(); if (alFinal) visor.idx = u.length;
  pintarVisor();
}
async function copiar(t, boton) {
  let ok = false;
  try { if (navigator.clipboard) { await navigator.clipboard.writeText(t); ok = true; } } catch (e) {}
  if (!ok) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); try { ok = document.execCommand('copy'); } catch (e) {} a.remove(); }
  if (boton) { const v = boton.textContent; boton.textContent = ok ? 'Copiado' : 'No he podido copiar'; setTimeout(() => { boton.textContent = v; }, 1500); }
}

/* ───── Análisis de Stockfish (un Stockfish aparte del de la escalera): valoración y las 2 mejores líneas ───── */
const ana = { w: null, fallo: '', corriendo: false, pend: null, fen: null, lineas: [], destino: null, t: 0 };
function analizar(fen, destino) {
  ana.destino = destino;
  if (ana.fallo) return pintarAnalisis();
  if (!ana.w) {
    try {
      ana.w = new Worker('stockfish/stockfish-19-lite-single.js');
      ana.w.onmessage = e => anaLinea(String(e.data));
      ana.w.onerror = e => { ana.fallo = (e && e.message) || 'no carga'; pintarAnalisis(); };
      ana.w.postMessage('uci'); ana.w.postMessage('setoption name MultiPV value 2');
    } catch (e) { ana.fallo = 'no carga'; return pintarAnalisis(); }
  }
  if (fen === ana.fen && !ana.pend) return pintarAnalisis();
  ana.pend = fen;
  if (ana.corriendo) { ana.w.postMessage('stop'); pintarAnalisis(); return; }
  anaArrancar();
}
function anaArrancar() {
  const fen = ana.pend; ana.pend = null; if (!fen) return;
  ana.fen = fen; ana.lineas = [];
  const p = new M.Pos(fen); if (M.fin(p)) { ana.corriendo = false; return pintarAnalisis(); }
  ana.corriendo = true; ana.w.postMessage('position fen ' + fen); ana.w.postMessage('go depth 18 movetime 4000'); pintarAnalisis();
}
function anaParar() { ana.pend = null; ana.destino = null; if (ana.corriendo && ana.w) ana.w.postMessage('stop'); }
function anaLinea(l) {
  if (l.startsWith('bestmove')) { ana.corriendo = false; if (ana.pend) anaArrancar(); else pintarAnalisis(); return; }
  if (!ana.corriendo || ana.pend || !l.startsWith('info ') || l.indexOf(' pv ') < 0) return;
  const k = +(/ multipv (\d+)/.exec(l) || [0, 1])[1], d = +(/ depth (\d+)/.exec(l) || [0, 0])[1], sc = / score (cp|mate) (-?\d+)/.exec(l); if (!sc) return;
  ana.lineas[k - 1] = { depth: d, cp: sc[1] === 'cp' ? +sc[2] : null, mate: sc[1] === 'mate' ? +sc[2] : null, pv: l.slice(l.indexOf(' pv ') + 4).trim().split(/\s+/) };
  const t = Date.now(); if (t - ana.t > 300) { ana.t = t; pintarAnalisis(); }
}
function pintarAnalisis() {
  const el = ana.destino && $(ana.destino); if (!el) return;
  if (ana.fallo) { el.innerHTML = '<p class="nota">Stockfish no carga en este aparato: sin análisis.</p>'; return; }
  const fen = ana.fen; if (!fen) { el.innerHTML = ''; return; }
  const p = new M.Pos(fen), f = M.fin(p), negras = p.side === 1;
  if (f) { el.innerHTML = `<div class="evbar"><b style="width:${f.res === 1 ? 100 : f.res === 0 ? 0 : 50}%"></b><span>${f.motivo === 'mate' ? 'Jaque mate' : 'Tablas'}</span></div>`; return; }
  const val = x => { const cp = x.cp == null ? null : negras ? -x.cp : x.cp, mt = x.mate == null ? null : negras ? -x.mate : x.mate; return { cp, mt, txt: mt != null ? (mt > 0 ? '#' : '#-') + Math.abs(mt) : (cp > 0 ? '+' : '') + fmt(cp / 100, 2), pct: mt != null ? (mt > 0 ? 100 : 0) : 100 / (1 + Math.pow(10, -cp / 400)) }; };
  const ls = ana.lineas.filter(Boolean);
  if (!ls.length) { el.innerHTML = '<div class="evbar"><b style="width:50%"></b><span>…</span></div><p class="nota">Stockfish está pensando…</p>'; return; }
  const v0 = val(ls[0]);
  el.innerHTML = `<div class="evbar"><b style="width:${v0.pct.toFixed(1)}%"></b><span>${v0.txt}</span></div>` +
    ls.slice(0, 2).map(x => { const v = val(x); return `<div class="linea"><span class="ev">${v.txt}</span><span>${esc(lineaSAN(fen, x.pv.slice(0, 10)))}</span></div>`; }).join('') +
    `<p class="nota" style="margin:4px 0 0">Stockfish 19 · profundidad ${ls[0].depth}${ana.corriendo ? '…' : ''}</p>`;
}
function lineaSAN(fen, pv) {
  const ss = M.sanLista(fen, pv), p0 = new M.Pos(fen); let n = p0.full, t = '';
  ss.forEach((x, k) => { const bl = (p0.side === 0) === (k % 2 === 0); if (bl) t += n + '. '; else if (k === 0) t += n + '… '; t += x + ' '; if (!bl) n++; });
  return t.trim();
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
  const z = e.target.closest('.zona');
  if (z) { if (nivel !== 'lejos' && e.target.tagName === 'CANVAS') { if (z.id === 'zsf') verSF(); else if (z.id === 'zcz' && cazaVista) verJuego(cazaVista); } return; }
  const me = e.target.closest('.mesa'); if (!me) return;
  if (nivel !== 'cerca') return acercarMesa(+me.dataset.mesa);
  if (e.target.tagName === 'CANVAS') { const js = juegosDeMesa(+me.dataset.mesa), j = js.find(x => x.estado === 'juega') || js.slice().reverse().find(x => x.estado === 'fin'); if (j) verJuego(j); }
});
const resTxt = r => r === 1 ? '1-0' : r === 0 ? '0-1' : r === .5 ? '½-½' : '*';
function verJuego(j) {
  const a = ind(j.w), b = ind(j.b); if (!a || !b) return;
  verPartida({ titulo: `${a.nombre} – ${b.nombre}`, fen0: j.fen, ucis: (j.lista || j.jugadas || []).slice(), fuente: () => j.lista || j.jugadas,
    info: { blancas: a.nombre, negras: b.nombre, resultado: resTxt(j.res), evento: 'Araña · generación ' + est.gen },
    estado: () => (j.tipo === 'caza' ? 'Cazadora contra la élite · ' : `Generación ${est.gen} · mesa ${+j.mesa + 1} · `) + (j.estado === 'fin' ? `${resTxt(j.res)} (${j.motivo})` : j.estado === 'juega' ? (opc.directo ? 'en directo' : 'jugando (active «Directo» para verla en vivo)') : 'en espera') });
}
function verSF() {
  const v = sfVista; if (!v || !v.jug) return;
  const yo = v.ind.nombre, sfN = 'Stockfish (peldaño ' + v.E.n + ')';
  verPartida({ titulo: `${yo} contra Stockfish`, fen0: v.fen0, ucis: v.jug.slice(), fuente: () => sfVista && sfVista.ind === v.ind && sfVista.fen0 === v.fen0 ? sfVista.jug : null,
    info: { blancas: v.yoB ? yo : sfN, negras: v.yoB ? sfN : yo, evento: 'Araña · escalera de Stockfish' }, girar: !v.yoB,
    estado: () => `Peldaño ${v.E.n}: ${v.E.nombre} · ${yo} con ${v.yoB ? 'blancas' : 'negras'}` });
}

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
function hoja(html) { visor = null; anaParar(); $('#hojac').innerHTML = html; $('#hoja').classList.add('on'); $('#hojac').scrollTop = 0; const b = $('#hojac button'); if (b) b.focus(); }
function cerrarHoja() { $('#hoja').classList.remove('on'); clearInterval(repTimer); visor = null; anaParar(); }
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
  registro() { return registro(); },
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
  async partidas(genElegida) {
    const ps = (await todos('partidas')).sort((a, b) => b.gen - a.gen);
    if (!ps.length) return hoja('<h3>Partidas</h3><p class="nota">Al terminar cada generación guardo sus partidas. Aún no hay ninguna.</p>' + CERRAR);
    const g = ps.find(x => x.gen === genElegida) || ps[0];
    const lista = g.todas ? g.todas.map(x => Object.assign({}, x, { jugadas: typeof x.jugadas === 'string' ? (x.jugadas ? x.jugadas.split(' ') : []) : x.jugadas || [] }))
      : [{ wn: g.wn, bn: g.bn, fen: g.fen, jugadas: g.jugadas, res: g.res, motivo: g.motivo, tipo: '' }].concat(g.sf ? [{ tipo: 'sf', wn: g.sf.yoB ? g.sf.nombre : 'Stockfish', bn: g.sf.yoB ? 'Stockfish' : g.sf.nombre, fen: g.sf.fen, jugadas: g.sf.jugadas, res: g.sf.yoB ? g.sf.res : 1 - g.sf.res, motivo: g.sf.motivo, peldano: g.sf.peldano }] : []);
    const grupo = { '': 'Torneo', caza: 'Contra las cazadoras', sf: 'Contra Stockfish' };
    let h = `<h3>Partidas</h3><select class="full" id="pGen" aria-label="Generación">${ps.slice(0, 300).map(x => `<option value="${x.gen}"${x === g ? ' selected' : ''}>Generación ${x.gen}${x.todas ? ` · ${x.todas.length} partidas` : ' · la mejor'}</option>`).join('')}</select>`;
    for (const t of ['sf', 'caza', '']) {
      const ls = lista.map((x, k) => [x, k]).filter(([x]) => (x.tipo || '') === t); if (!ls.length) continue;
      h += `<h2>${grupo[t]} · ${ls.length}</h2><div class="det">` + ls.map(([x, k]) => `<span data-par="${k}" style="cursor:pointer">${esc(x.wn)} – ${esc(x.bn)}${x.peldano ? ` <i style="font-style:normal;color:var(--muted)">(peldaño ${x.peldano})</i>` : ''}</span><span class="v">${resTxt(x.res)} · ${Math.ceil((x.jugadas || []).length / 2)} jug.</span>`).join('') + '</div>';
    }
    hoja(h + '<p class="nota">Toque una partida para verla jugada a jugada, con su análisis de Stockfish.</p>' + CERRAR);
    $('#pGen').onchange = e => AUX.partidas(+e.target.value);
    $('#hojac').querySelectorAll('[data-par]').forEach(b => b.onclick = () => {
      const x = lista[+b.dataset.par];
      verPartida({ titulo: `${x.wn} – ${x.bn}`, sub: `Generación ${g.gen} · ${resTxt(x.res)} (${x.motivo})`, fen0: x.fen || M.INICIO, ucis: x.jugadas || [], idx: 0, girar: x.tipo === 'sf' && x.bn !== 'Stockfish',
        info: { blancas: x.wn, negras: x.bn, resultado: resTxt(x.res), evento: 'Araña · generación ' + g.gen } });
    });
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
  escribir(muertas.map(p => { p.murio = est.gen; return ['individuos', conHuella(p)]; })).catch(() => {});   // se guardan con sus genes: se puede volver a ellas
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
    <div class="ana" id="phAna"></div>
    <canvas id="phCv" class="tabg" width="320" height="320" style="touch-action:manipulation"></canvas>
    <div class="jugadas" id="phLista"></div>
    <div class="ctrl" style="justify-content:center;margin-top:10px"><button class="btn sec" id="phRend">Me rindo</button><button class="btn sec" id="phNueva">Otra partida</button><button class="btn sec" id="phAn" aria-pressed="false">Análisis</button><button class="btn sec" id="phPgn">Copiar PGN</button></div>` + CERRAR);
  $('#phAn').onclick = () => { ph.ana = !ph.ana; $('#phAn').setAttribute('aria-pressed', String(ph.ana)); if (!ph.ana) anaParar(); pintarHumana(); };
  $('#phPgn').onclick = () => copiar(M.pgn(M.INICIO, ph.jug, { blancas: ph.color === 'w' ? 'Juan' : p.nombre, negras: ph.color === 'w' ? p.nombre : 'Juan' }), $('#phPgn'));
  $('#phCv').addEventListener('click', toqueHumano);
  $('#phRend').onclick = () => { if (!ph.fin) acabarHumana({ res: ph.color === 'w' ? 0 : 1, motivo: 'se rinde' }); };
  $('#phNueva').onclick = () => elegirColor(p);
  pintarHumana();
  if (color === 'b') turnoArana();
}
function pintarHumana() {
  const cv = $('#phCv'); if (!cv || !ph) return;
  const pos = ph.pos, dest = ph.sel >= 0 ? M.legal(pos).filter(m => M.mFrom(m) === ph.sel).map(M.mTo) : null;
  tablero(cv, pos.fen(), null, false, null, { girar: ph.color === 'b', coords: true, sel: ph.sel, destinos: dest, base: 1.6 });
  const t = $('#phTxt'); if (t) t.textContent = ph.fin ? ph.fin : ph.piensa ? `${ph.p.nombre} está pensando…` : M.inCheck(pos) ? 'Le toca. ¡Está en jaque!' : 'Le toca. Toque una pieza y luego su casilla.';
  const l = $('#phLista'); if (l) l.innerHTML = listaHTML(M.INICIO, ph.jug, ph.jug.length);
  if (ph.ana) analizar(pos.fen(), '#phAna'); else { const a = $('#phAna'); if (a) a.innerHTML = ''; }
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
  ph.fin = (mio === 1 ? '¡Ha ganado usted!' : mio === 0 ? `Gana ${ph.p.nombre}.` : 'Tablas.') + ` (${f.motivo})`; ph.piensa = false; ph.ana = true; const b = $('#phAn'); if (b) b.setAttribute('aria-pressed', 'true'); pintarHumana();
  const p = ph.p; recordarRival(p, 'juan', 1 - mio);
  if (!byId.has(p.id) && !cazById.has(p.id)) await escribir([['individuos', p]]).catch(() => {}); else guardarEstado().catch(() => {});
  darHito(mio === 1 ? 'juan-gana' : mio === 0 ? 'gano-juan' : '');
}

/* ───── Duelo: la campeona contra otra araña, 4 partidas (blancas y negras, dos aperturas) ───── */
async function duelo(a, b) {
  hoja(`<h3>${esc(a.nombre)} contra ${esc(b.nombre)}</h3><div class="sub" id="duTxt">Empieza el duelo…</div>
    <canvas id="duCv" width="240" height="240" style="width:100%;max-width:340px;aspect-ratio:1;display:block;margin:0 auto;border-radius:8px"></canvas><div class="det" id="duRes" style="margin-top:10px"></div>` + CERRAR);
  const f1 = M.aperturaAleatoria(rng, 4), f2 = M.aperturaAleatoria(rng, 4), partidas = [[a, b, f1], [b, a, f1], [a, b, f2], [b, a, f2]];
  let pa = 0, pb = 0; const filas = [], jugadasDu = [];
  for (let i = 0; i < partidas.length; i++) {
    const [w, n, fen] = partidas[i];
    if (!$('#duCv')) return;   // cerró la hoja
    $('#duTxt').textContent = `Partida ${i + 1} de 4 · ${w.nombre} con blancas · ${fmt(pa, 1)} – ${fmt(pb, 1)}`;
    const r = await new Promise(ok => {
      const id = 'd' + (++sigAparte);
      aparte.set(id, { jugada: d => { const cv = $('#duCv'); if (cv) { const e0 = esc0; esc0 = 1.4; tablero(cv, d.fen, d.uci, true); esc0 = e0; } }, fin: ok });
      hiloAparte().postMessage({ t: 'partida', id, w: { id: w.id, genes: w.genes }, b: { id: n.id, genes: n.genes }, fen, opc: { ms: opc.ms, prof: opc.prof, maxPlies: opc.maxPlies }, directo: true, flags: flagsDe() });
    });
    const ra = w === a ? r.res : 1 - r.res; pa += ra; pb += 1 - ra; jugadasDu.push({ w, n, fen, r });
    filas.push(`<span data-du="${i}" style="cursor:pointer">${i + 1}. ${esc(w.nombre)} – ${esc(n.nombre)}</span><span class="v">${resTxt(r.res)} · ${esc(r.motivo)}</span>`);
    const dr = $('#duRes'); if (dr) { dr.innerHTML = filas.join(''); dr.onclick = e => { const x = e.target.closest('[data-du]'); if (!x) return; const g = jugadasDu[+x.dataset.du]; verPartida({ titulo: `${g.w.nombre} – ${g.n.nombre}`, sub: `Duelo · ${resTxt(g.r.res)} (${g.r.motivo})`, fen0: g.fen, ucis: g.r.jugadas, idx: 0, info: { blancas: g.w.nombre, negras: g.n.nombre, resultado: resTxt(g.r.res), evento: 'Araña · duelo' } }); }; }
  }
  const t = $('#duTxt'); if (t) t.textContent = `Final: ${a.nombre} ${fmt(pa, 1)} – ${fmt(pb, 1)} ${b.nombre}` + (pa > pb ? ' · gana la campeona' : pa < pb ? ` · ¡gana ${b.nombre}!` : ' · empate');
  (est.duelos = est.duelos || []).push({ a: a.nombre, b: b.nombre, pa, pb, fecha: new Date().toISOString(), gen: est.gen });
  est.duelos = est.duelos.slice(-30); guardarEstado().catch(() => {});
}

/* ═════════ Menú de evoluciones ═════════ */
function cambiarA(id) { entrenar(false); slotId = id; guardarSlots(); hilos.forEach(w => w.terminate()); if (db) db.close(); location.reload(); }
function nuevaEvolucion() {
  const nombre = prompt('¿Cómo llamo a la nueva evolución? La de ahora queda guardada tal cual.', 'Evolución ' + (slots.length + 1));
  if (nombre == null) return;
  const id = Date.now().toString(36);
  slots.push({ id, nombre: (nombre.trim() || 'Evolución ' + (slots.length + 1)).slice(0, 40), creada: new Date().toISOString() });
  cambiarA(id);
}
async function resumenDe(sl) {
  if (sl.id === slotId) return { gen: est.gen, peldano: est.escalera.peldano, campeona: (campeona() || {}).nombre, arañas: pop.length };
  try {
    const d = await abrirDB(dbNombre(sl.id)); if (!d) return null;
    const e = await req(d.transaction('estado').objectStore('estado').get('actual')); d.close();
    return e ? { gen: e.gen, peldano: e.escalera ? migrarEscalera(e.escalera).peldano : 1, arañas: (e.pop || []).length } : null;
  } catch (e) { return null; }
}
async function evoluciones() {
  const res = await Promise.all(slots.map(resumenDe));
  hoja(`<h3>Evoluciones</h3><div class="sub">Cada evolución tiene sus propias arañas, su escalera y sus partidas. Cambiar de una a otra no borra nada.</div>
    <div class="ctrl" style="margin-bottom:12px"><button class="btn" id="eNueva">Nueva evolución desde cero</button><button class="btn sec" id="eDup">Duplicar la de ahora</button></div>` +
    slots.map((sl, i) => { const r = res[i], act = sl.id === slotId; return `<div class="hito${act ? ' si' : ''}" style="align-items:center"><span class="m"></span><span style="flex:1">${esc(sl.nombre)}${act ? ' · abierta' : ''}<small>${r ? `Generación ${r.gen} · peldaño ${r.peldano} de Stockfish${r.campeona ? ' · campeona ' + esc(r.campeona) : ''}` : 'Sin empezar'} · creada el ${new Date(sl.creada).toLocaleDateString('es-ES')}</small></span>
      <span class="ctrl" style="flex:none">${act ? '' : `<button class="btn sec" data-eab="${sl.id}" style="min-height:34px;padding:4px 10px">Abrir</button>`}<button class="btn sec" data-ere="${sl.id}" style="min-height:34px;padding:4px 10px">Renombrar</button>${act ? '' : `<button class="btn sec" data-ebo="${sl.id}" style="min-height:34px;padding:4px 10px">Borrar</button>`}</span></div>`; }).join('') + CERRAR);
  $('#eNueva').onclick = nuevaEvolucion;
  $('#eDup').onclick = duplicarEvolucion;
  $('#hojac').querySelectorAll('[data-eab]').forEach(b => b.onclick = () => cambiarA(b.dataset.eab));
  $('#hojac').querySelectorAll('[data-ere]').forEach(b => b.onclick = () => { const sl = slots.find(x => x.id === b.dataset.ere), n = prompt('Nuevo nombre:', sl.nombre); if (n && n.trim()) { sl.nombre = n.trim().slice(0, 40); guardarSlots(); ponerTitulo(); evoluciones(); } });
  $('#hojac').querySelectorAll('[data-ebo]').forEach(b => b.onclick = async () => {
    const sl = slots.find(x => x.id === b.dataset.ebo);
    if (!confirm(`¿Borro para siempre la evolución «${sl.nombre}» con todas sus arañas? Si la quiere, exporte antes una copia desde ella.`)) return;
    await new Promise(ok => { const r = indexedDB.deleteDatabase(dbNombre(sl.id)); r.onsuccess = r.onerror = r.onblocked = ok; });
    slots = slots.filter(x => x !== sl); guardarSlots(); evoluciones();
  });
}
async function duplicarEvolucion() {
  const nombre = prompt('¿Cómo llamo a la copia? Seguirá desde la misma generación, por su cuenta.', slotActual().nombre + ' (copia)');
  if (nombre == null) return;
  entrenar(false);
  const id = Date.now().toString(36), stores = ['individuos', 'generaciones', 'partidas'], datos = {};
  await guardarEstado().catch(() => {});
  for (const st of stores) datos[st] = await todos(st);
  const d = await abrirDB(dbNombre(id));
  await new Promise((ok, ko) => { const tx = d.transaction(['estado'].concat(stores), 'readwrite'); tx.objectStore('estado').put(JSON.parse(JSON.stringify(est)), 'actual'); for (const st of stores) for (const v of datos[st]) tx.objectStore(st).put(v); tx.oncomplete = ok; tx.onerror = () => ko(tx.error); });
  d.close();
  slots.push({ id, nombre: (nombre.trim() || slotActual().nombre + ' (copia)').slice(0, 40), creada: new Date().toISOString() }); guardarSlots();
  if (confirm('Copia hecha. ¿La abro ahora?')) cambiarA(id); else evoluciones();
}
function ponerTitulo() { $('header h1').textContent = slots.length > 1 ? 'Sala · ' + slotActual().nombre : 'Sala de partidas'; }

/* ═════════ Registro: todas las arañas que han existido, en tabla, y comparar ═════════ */
const RCOLS = [
  ['nombre', 'Araña', p => p.nombre, v => esc(v)],
  ['gen', 'Gen', p => p.gen],
  ['estado', 'Estado', p => estadoDe(p)],
  ['origen', 'Origen', p => p.origen],
  ['elo', 'Elo', p => Math.round(p.elo)],
  ['par', 'Partidas', p => p.partidas ? p.partidas.g + p.partidas.e + p.partidas.p : null],
  ['gan', '% puntos', p => p.partidas && (p.partidas.g + p.partidas.e + p.partidas.p) ? Math.round((p.partidas.g + p.partidas.e / 2) / (p.partidas.g + p.partidas.e + p.partidas.p) * 100) : null],
  ['sf', 'Stockfish', p => p.sf && p.sf.mejorPeldano ? p.sf.mejorPeldano : null, (v, p) => v == null ? '—' : `${p.sf.mejor === 'victoria' ? 'gana' : 'tablas'} p${v}`],
  ...['P', 'N', 'B', 'R', 'Q'].map((l, i) => ['v' + l, l, p => { const h = huellaDe(p); return h ? h.p[i] / 100 : null; }, v => v == null ? '—' : fmt(v, 2)]),
  ['det', 'Detect.', p => { const h = huellaDe(p); return h ? Object.values(h.d).filter(x => x[0]).length : null; }],
  ['neu', 'Neuronas', p => { const h = huellaDe(p); return h && h.r != null ? h.r : null; }],
  ['agr', 'Agresiv.', p => { const h = huellaDe(p); return h && h.c ? h.c[0] : null; }, v => v == null ? '—' : fmt(v, 2)],
  ['sac', 'Sacrif.', p => { const h = huellaDe(p); return h && h.c ? h.c[1] : null; }, v => v == null ? '—' : fmt(v, 2)],
  ['rie', 'Riesgo', p => { const h = huellaDe(p); return h && h.c ? h.c[2] : null; }, v => v == null ? '—' : fmt(v, 2)],
  ['ant', 'Anti-mot.', p => { const h = huellaDe(p); return h && h.s ? h.s[0] : null; }, v => v == null ? '—' : fmt(v, 2)],
  ['cao', 'Caos', p => { const h = huellaDe(p); return h && h.s ? h.s[1] : null; }, v => v == null ? '—' : fmt(v, 2)],
  ['aza', 'Azar', p => { const h = huellaDe(p); return h && h.z != null ? h.z : null; }, v => v == null ? '—' : fmt(v, 2)],
  ['nov', 'Novedad', p => p.novedad != null ? p.novedad : null, v => v == null ? '—' : fmt(v, 3)],
];
function estadoDe(p) { if (byId.has(p.id)) return 'viva'; if (cazById.has(p.id)) return 'cazadora viva'; if (p.importada) return 'importada'; return p.murio ? '† g' + p.murio : 'élite guardada'; }
let regOrden = { k: 'elo', dir: -1 }, regFiltro = 'todas', regBuscar = '', regSel = new Set();
async function registro() {
  const mapa = new Map(); for (const p of await todos('individuos')) mapa.set(p.id, p); for (const p of pop.concat(cazadoras)) mapa.set(p.id, p);
  const todas = [...mapa.values()];
  const F = { todas: () => true, vivas: p => byId.has(p.id), muertas: p => !byId.has(p.id) && !cazById.has(p.id) && !p.importada, cazadoras: p => p.origen === 'cazadora', importadas: p => !!p.importada };
  const col = RCOLS.find(c => c[0] === regOrden.k) || RCOLS[4], b = regBuscar.toLowerCase();
  const filas = todas.filter(F[regFiltro] || F.todas).filter(p => !b || p.nombre.toLowerCase().includes(b)).map(p => [p, col[2](p)])
    .sort((x, y) => { const a = x[1], c = y[1]; if (a == null && c == null) return 0; if (a == null) return 1; if (c == null) return -1; return (typeof a === 'string' ? a.localeCompare(c) : a - c) * regOrden.dir; });
  const vistas = filas.slice(0, 200);
  hoja(`<h3>Registro de arañas</h3><div class="sub">Las ${todas.length} que han existido en esta evolución, también las que murieron. Toque una columna para ordenar.</div>
    <div class="ctrl" style="margin-bottom:8px"><input id="rBus" type="search" placeholder="Buscar por nombre" value="${esc(regBuscar)}" style="flex:1;min-width:140px;font:14px var(--mono);background:#141832;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px">
      <select id="rFil" style="font:14px var(--mono);background:#141832;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px">${Object.keys(F).map(k => `<option value="${k}"${k === regFiltro ? ' selected' : ''}>${k[0].toUpperCase() + k.slice(1)} · ${todas.filter(F[k]).length}</option>`).join('')}</select>
      <button class="btn" id="rCmp"${regSel.size < 2 ? ' aria-disabled="true"' : ''}>Comparar (${regSel.size})</button></div>
    <div class="tabla"><table><thead><tr><th></th>${RCOLS.map(c => `<th data-ord="${c[0]}" class="${typeof col[2](vistas[0] ? vistas[0][0] : {}) === 'string' && c === col ? '' : ''}${c[0] === regOrden.k ? 'ord' : ''}">${c[1]}${c[0] === regOrden.k ? (regOrden.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead><tbody>
    ${vistas.map(([p]) => `<tr><td><input type="checkbox" data-sel="${esc(p.id)}"${regSel.has(p.id) ? ' checked' : ''} aria-label="Elegir ${esc(p.nombre)} para comparar"></td>${RCOLS.map(c => { const v = c[2](p); return `<td${c[0] === 'nombre' ? ` data-ficha="${esc(p.id)}" class="nom"` : ''}>${c[3] ? c[3](v, p) : v == null ? '—' : esc(v)}</td>`; }).join('')}</tr>`).join('')}
    </tbody></table></div>${filas.length > 200 ? `<p class="nota">Enseño las 200 primeras de ${filas.length}: ordene o busque para ver otras.</p>` : ''}
    <p class="nota">Valores de las piezas en el medio juego (P peón, N caballo, B alfil, R rook/torre, Q dama). Toque un nombre para su ficha. De las que murieron se guardan sus cualidades${genesTodas() ? ' y sus genes' : ', no sus genes (se puede cambiar en Opciones)'}.</p>` + CERRAR);
  $('#hojac').querySelectorAll('[data-ord]').forEach(th => th.onclick = () => { const k = th.dataset.ord; regOrden = { k, dir: regOrden.k === k ? -regOrden.dir : (k === 'nombre' || k === 'origen' || k === 'estado' ? 1 : -1) }; registro(); });
  $('#rBus').onchange = e => { regBuscar = e.target.value.trim(); registro(); };
  $('#rFil').onchange = e => { regFiltro = e.target.value; registro(); };
  $('#hojac').querySelectorAll('[data-sel]').forEach(c => c.onchange = () => { if (c.checked) { if (regSel.size >= 4) { c.checked = false; return avisar('Como mucho cuatro a la vez.'); } regSel.add(c.dataset.sel); } else regSel.delete(c.dataset.sel); const bt = $('#rCmp'); bt.textContent = `Comparar (${regSel.size})`; bt.setAttribute('aria-disabled', String(regSel.size < 2)); });
  $('#rCmp').onclick = () => { if (regSel.size >= 2) comparar([...regSel].map(id => mapa.get(id)).filter(Boolean)); else avisar('Elija al menos dos arañas.'); };
}
function comparar(ps) {
  const filaNum = (nombre, vals, d, mayorMejor) => {
    const nums = vals.filter(v => typeof v === 'number'), mx = nums.length > 1 && mayorMejor !== false ? Math.max(...nums) : null;
    return `<tr><th>${esc(nombre)}</th>${vals.map(v => `<td${v === mx && nums.filter(x => x === mx).length === 1 ? ' class="mejor"' : ''}>${v == null ? '—' : typeof v === 'number' ? fmt(v, d == null ? 2 : d) : esc(v)}</td>`).join('')}</tr>`;
  };
  const hs = ps.map(huellaDe);
  let h = `<h3>Comparar ${ps.length} arañas</h3><div class="tabla"><table class="cmp"><thead><tr><th></th>${ps.map(p => `<th data-ficha="${esc(p.id)}" class="nom">${esc(p.nombre)}</th>`).join('')}</tr></thead><tbody>`;
  h += filaNum('Generación', ps.map(p => p.gen), 0, false) + filaNum('Estado', ps.map(estadoDe)) + filaNum('Origen', ps.map(p => p.origen)) + filaNum('Elo', ps.map(p => Math.round(p.elo)), 0);
  h += filaNum('Partidas', ps.map(p => p.partidas ? p.partidas.g + p.partidas.e + p.partidas.p : null), 0, false) + filaNum('Ganadas', ps.map(p => p.partidas ? p.partidas.g : null), 0) + filaNum('Tablas', ps.map(p => p.partidas ? p.partidas.e : null), 0, false) + filaNum('Perdidas', ps.map(p => p.partidas ? p.partidas.p : null), 0, false);
  h += filaNum('Mejor peldaño de Stockfish', ps.map(p => p.sf && p.sf.mejorPeldano ? p.sf.mejorPeldano : null), 0) + filaNum('Puntos contra Stockfish', ps.map(p => p.sf ? p.sf.puntos : null), 1);
  h += '<tr><th colspan="9" class="sec">Valor de las piezas (medio juego)</th></tr>' + ['Pawn (peón)', 'Knight (caballo)', 'Bishop (alfil)', 'Rook (torre)', 'Queen (dama)'].map((n, i) => filaNum(n, hs.map(x => x ? x.p[i] / 100 : null), 2, false)).join('');
  h += '<tr><th colspan="9" class="sec">Cómo piensa</th></tr>' + M.PIENSA.map((n, i) => filaNum(n, hs.map(x => x ? x.k[i] : null), 2, false)).join('');
  h += '<tr><th colspan="9" class="sec">Distópicas</th></tr>' + filaNum('Neuronas de su red', hs.map(x => x && x.r != null ? x.r : null), 0) +
    M.CARACTER.map((n, i) => filaNum(n[0].toUpperCase() + n.slice(1), hs.map(x => x && x.c ? x.c[i] : null), 2, false)).join('') +
    M.SESGO.map((n, i) => filaNum(n[0].toUpperCase() + n.slice(1), hs.map(x => x && x.s ? x.s[i] : null), 2, false)).join('') +
    M.AUTOMUT.map((n, i) => filaNum(n[0].toUpperCase() + n.slice(1) + ' (×)', hs.map(x => x && x.a ? Math.exp(x.a[i]) : null), 2, false)).join('') +
    filaNum('Azar', hs.map(x => x && x.z != null ? x.z : null), 2, false) + filaNum('Novedad', ps.map(p => p.novedad != null ? p.novedad : null), 3);
  h += `<tr><th colspan="9" class="sec">Detectores (peso de su primera medida; — apagado)</th></tr>` + M.DET.filter(d => d.n !== 1 && d.n !== 4).map(d => filaNum(d.n + '. ' + d.nombre, hs.map(x => x && x.d[d.n] ? (x.d[d.n][0] ? x.d[d.n][1] : null) : null), 1, false)).join('');
  hoja(h + '</tbody></table></div><p class="nota">En verde, el valor más alto en las filas donde más es mejor. Toque un nombre para su ficha.</p><div class="ctrl" style="margin-top:12px"><button class="btn sec" id="cVolver">Volver al registro</button><button class="btn sec" data-cerrar>Cerrar</button></div>');
  $('#cVolver').onclick = registro;
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
    <label class="op">Guardar los genes de las que mueren ${sel('genesTodas', [0, 1], v => v ? 'Sí (ocupa más)' : 'No, solo sus cualidades', est.opc)}</label>
    <p class="nota">Apagar una distópica no borra sus genes: siguen heredándose y vuelven a contar si la enciende. Los parásitos añaden 16 partidas por generación.</p>
    <p class="nota">Más tiempo por jugada juega mejor pero evoluciona más despacio. Con ${NHILOS} hilos, una generación de ${pop.length} arañas tarda unos ${Math.max(1, Math.round(pop.length * opc.rondas * (opc.maxPlies * .45) * opc.ms / 1000 / NHILOS / 60))} min.</p>
    <div class="ctrl"><button class="btn sec" id="exp">Exportar copia</button><button class="btn sec" id="reset">Nueva evolución desde cero</button><button class="btn" data-cerrar>Hecho</button></div>`);
  $('#hojac').querySelectorAll('select').forEach(s => s.onchange = () => {
    if (s.dataset.dist) { est.opc.dist = Object.assign({}, est.opc.dist || {}, { [s.dataset.dist]: +s.value }); compilados.clear(); guardarEstado().catch(() => {}); marcar(); return; }
    if (s.hasAttribute('data-evo')) { est.opc[s.dataset.k] = +s.value; guardarEstado().catch(() => {}); } else { opc[s.dataset.k] = +s.value; guardarOpc(); marcarSF(); }
  });
  $('#exp').onclick = exportar;
  $('#reset').onclick = async () => {
    nuevaEvolucion();
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
$('#evo').onclick = evoluciones;
$('#salir').onclick = () => { entrenar(false); if (!avisarApp({ tipo: 'salir' })) location.href = '../'; };
document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarHoja(); });
window.addEventListener('message', e => { if (e.data && e.data.arana === 'ajedrez-entrenar') entrenar(true); });

/* Para pruebas */
window.__sala = { evoluciones, nuevaEvolucion, duplicarEvolucion, registro, comparar, verPartida, verJuego, visor: () => visor, ana: () => ana, slots: () => slots, importarTexto, accionesDe, partidaHumana, moverHumano, humana: () => ph, duelo, campeona, encolar, conGenes, escalera: ESCALERA, sfEstado: () => ({ fase: sfFase, fallo: sfFallo, vista: sfVista }), estado: () => est, pop: () => pop, juegos: () => juegos, entrenar, ficha, opciones, cerrarGeneracion, exportar, aux: AUX, nivel: () => nivel, escala: () => esc0, zoom: s => aplicarEscala(s, true), acercarMesa, verTodo };

cargar().then(() => {
  ponerTitulo(); crearHilos(); construirPlano(); ponerVista(); pintarEstado();
  if (qs.get('entrenar') === '1') entrenar(true);
}).catch(e => { $('#estado').textContent = 'No he podido abrir la sala: ' + e.message; });
})();
