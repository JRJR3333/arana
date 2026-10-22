/* La sala de partidas: reparte las partidas entre hilos, dibuja el plano con zoom,
   guarda cada generación en IndexedDB y enseña la ficha y las vistas de la evolución. */
(function () {
'use strict';
const M = window.AjedrezMotor, $ = s => document.querySelector(s);
const qs = new URLSearchParams(location.search);
const ORIGEN = qs.get('plat') || (/android/i.test(navigator.userAgent) || qs.get('app') === 'android' ? 'android' : /iphone|ipad|ipod/i.test(navigator.userAgent) ? 'iphone' : 'web');
const rng = M.mulberry((Math.random() * 4294967296) >>> 0);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const COLOR_ORIGEN = { iphone: '#5ee8ff', android: '#ffb340', web: '#a99bff', linux: '#ff8ad8', inmigrante: '#9a9aa8', cazadora: '#ff5c5c' };
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

/* Los 23 peldaños de la escalera de Stockfish (nivel de Stockfish y cuánto piensa) */
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
  { n: 19, nombre: 'Plena potencia', skill: 20, go: 'movetime 100' }, { n: 20, nombre: 'Plena potencia, sin prisa', skill: 20, go: 'movetime 500' },
  { n: 21, nombre: 'Un segundo por jugada', skill: 20, go: 'movetime 1000' }, { n: 22, nombre: 'Tres segundos por jugada', skill: 20, go: 'movetime 3000' },
  { n: 23, nombre: 'Stockfish al máximo', skill: 20, go: 'movetime 10000' }];
/* Elo aproximado de cada peldaño en la escala normal (CCRL, la de UCI_Elo de Stockfish): calibrado en la 0.32.0
   con 418 partidas entre peldaños vecinos y contra Stockfish con «Elo limitado» de 1320 a 2900 a 1 s por jugada (ver ajedrez/README.md). */
const ELO_PELDANO = [1160, 1280, 1340, 1500, 1660, 1680, 1700, 1800, 1940, 2070, 2120, 2220, 2280, 2370, 2520, 2780, 2810, 3000, 3250, 3350, 3450, 3550, 3600];   // 19 a 23: estimados por encima de las anclas
ESCALERA.forEach((E, i) => { E.elo = ELO_PELDANO[i]; });
const ELO_INICIAL = 1500;   // una población recién nacida (genes clásicos con ruido) juega más o menos así

/* ───── Elo en la escala normal ─────
   Las partidas entre arañas solo dan un Elo relativo, y se inflaba (las hijas heredan la media de sus padres y las peores mueren).
   Ahora la escala se ancla a la escalera: tras cada generación, las partidas contra Stockfish desplazan el Elo de todas
   (máxima verosimilitud, con una distribución previa para no dar saltos), y la población no infla su media. */
function anclaElo(js, c0, sd) {
  let c = c0; const k = Math.LN10 / 400;
  for (let it = 0; it < 40; it++) {
    let g = -(c - c0) / (sd * sd), h = -1 / (sd * sd);
    for (const j of js) { const w = j.w || 1, p = 1 / (1 + Math.pow(10, (j.R - (j.e + c)) / 400)); g += w * k * (j.s - p); h -= w * k * k * p * (1 - p); }
    const d = Math.max(-400, Math.min(400, -g / h)); c += d; if (Math.abs(d) < .01) break;
  }
  return c;
}
const mediaEloDe = l => l.length ? l.reduce((a, p) => a + p.elo, 0) / l.length : 0;
/* Pasa a la escala normal todo lo guardado antes de la 0.32.0: cada generación tiene su desplazamiento, sacado de sus partidas contra Stockfish
   (y de las 3 generaciones de cada lado, con menos peso). Sin partidas cerca, la media de la generación se toma como una población recién nacida. */
function migrarElo(inds, gens) {
  const eloEn = (p, g) => { const h = (p.hist || []).find(x => x.gen === g); return h ? h.elo : p.elo; };
  const porGen = new Map();
  for (const r of gens) if (r.sf && r.sf.juegos && ESCALERA[r.sf.peldano - 1]) {
    const R = ESCALERA[r.sf.peldano - 1].elo;
    porGen.set(r.gen, r.sf.juegos.map(j => { const p = inds.get(j.id); return p ? { e: eloEn(p, r.gen), R, s: j.res } : null; }).filter(Boolean));
  }
  const c = new Map(), medias = new Map(gens.map(r => [r.gen, r.mediaElo || 0])); let prev = null;
  for (const r of gens) {
    const base = ELO_INICIAL - (r.mediaElo || 1200), js = [];
    for (const [g, l] of porGen) { const dg = Math.abs(g - r.gen), dm = (medias.get(g) || 0) - (medias.get(r.gen) || 0); if (dg <= 3) l.forEach(j => js.push({ w: 1 / (1 + dg), e: j.e - dm, R: j.R, s: j.s })); }   // a la escala de esta generación
    const c0 = prev ? base + prev.rel : base, v = js.length ? anclaElo(js, c0, 300) : c0;
    c.set(r.gen, v); prev = { rel: v - base };
  }
  const gs = [...c.keys()], ult = gs.length ? c.get(gs[gs.length - 1]) : null;
  const cDe = g => { if (c.has(g)) return c.get(g); let mejor = null, d = 1e9; for (const x of gs) if (Math.abs(x - g) < d) { d = Math.abs(x - g); mejor = x; } return mejor == null ? null : c.get(mejor); };
  const fallback = l => ELO_INICIAL - mediaEloDe(l);
  return { cDe, ult, fallback };
}
async function migrarTodoElo() {
  if (est.eloReal) return;
  const todas = db ? await todos('individuos') : [], inds = new Map(todas.map(p => [p.id, p]));
  for (const p of pop.concat(cazadoras)) inds.set(p.id, p);
  const { cDe, ult } = migrarElo(inds, historial), sin = ELO_INICIAL - mediaEloDe(pop), cUlt = ult == null ? sin : ult;
  const vivas = new Set(pop.concat(cazadoras).map(p => p.id)), ops = [];
  for (const p of inds.values()) {
    const caz = p.origen === 'cazadora', fin = vivas.has(p.id) || caz ? null : p.murio;
    (p.hist || []).forEach(h => { const v = caz ? cUlt : cDe(h.gen); h.elo = Math.round(h.elo + (v == null ? cUlt : v)); });
    const v = fin != null ? cDe(fin) : cUlt; p.elo = Math.round(p.elo + (v == null ? cUlt : v)); p.eloReal = 1;
    if (!vivas.has(p.id)) ops.push(['individuos', p]);
  }
  for (const r of historial) { const v = cDe(r.gen); const d = v == null ? cUlt : v; if (r.mejor) r.mejor.elo = Math.round(r.mejor.elo + d); if (r.mediaElo != null) r.mediaElo += d; ops.push(['generaciones', r]); }
  est.eloReal = 1; est.eloAncla = { desde: est.gen, migrado: new Date().toISOString() };
  await guardarEstado(ops).catch(e => console.warn('migrar Elo', e));
}
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
const OPC_DEF = { ms: 0, rend: ORIGEN === 'linux' ? 2 : 1, prof: 4, rondas: 4, maxPlies: 160, directo: true, sf: 1, sfTop: 4, ana: 1, final: 1 };
const limite = () => opc.maxPlies || 300;   // para estimar tiempos cuando no hay límite
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
/* Gradiente (39): posiciones tranquilas etiquetadas [fen, y, fuente]; y = probabilidad de ganar de las blancas. Se guardan en «estado» con la clave «grad». */
let grad = { pos: [] }, gradVista = '';
/* Red en la gráfica (40): sus posiciones [fen, y, fuente, mejor jugada] (clave «red40datos») y sus pesos (clave «red40») */
let redDatos = { pos: [] }, redes = [], redUltima = null, redOcupada = false;
const gradCache = new Map();
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
    pop = M.poblacionInicial(rng, ORIGEN, M.OPC_EVO.poblacion); nombresUnicos(pop);
    pop.forEach(p => { p.elo = ELO_INICIAL; p.eloReal = 1; }); est.eloReal = 1;
    await guardarEstado();
  }
  est.hitos = est.hitos || {}; est.escalera = migrarEscalera(est.escalera || { peldano: 1, conquistas: {} });
  while (est.escalera.conquistas[est.escalera.peldano] && est.escalera.peldano < ESCALERA.length) est.escalera.peldano++;   // peldaños nuevos encima de lo conquistado
  pop.forEach(p => M.completar(p.genes));
  if (est.cazPop) { const cs = await Promise.all(est.cazPop.map(id => leer('individuos', id))); cazadoras = cs.every(c => c && c.genes) ? cs : []; cazadoras.forEach(c => M.completar(c.genes)); }
  historial = (await todos('generaciones')).sort((a, b) => a.gen - b.gen);
  try { const g = await leer('estado', 'grad'); if (g && Array.isArray(g.pos)) grad = g; } catch (e) {}
  try {
    const d = await leer('estado', 'red40datos'); if (d && Array.isArray(d.pos)) redDatos = d;
    const pob = await leer('estado', 'red40pob');
    if (pob && Array.isArray(pob.lista)) { redes = pob.lista.filter(r => r && r.pesos); redSig = pob.sig || redes.length + 1; }
    else { const r = await leer('estado', 'red40'); if (r && r.pesos) redes = [Object.assign(r, { id: r.id || 'red0', nombre: r.nombre || 'Red Primera', genes: Object.assign({}, GENES_RED, r.genes || {}), elo: r.elo || 1500, peldano: r.peldano || 1, juegos: r.juegos || [], hist: r.hist || [] })]; }   // la red única de la 0.38/0.39 es la primera de la población
  } catch (e) {}
  byId = new Map(pop.map(p => [p.id, p])); cazById = new Map(cazadoras.map(c => [c.id, c]));
  await migrarTodoElo();
}
function guardarEstado(extra) {
  est.pop = pop.map(p => p.id); est.cazPop = cazadoras.map(c => c.id);
  const ops = [['estado', est, 'actual']];
  for (const p of pop.concat(cazadoras)) ops.push(['individuos', conHuella(p)]);
  return escribir(ops.concat(extra || []));
}

/* ───── Hilos de partidas ───── */
const NUCLEOS = navigator.hardwareConcurrency || 4, NHILOS = Math.max(1, Math.min(ORIGEN === 'linux' ? 64 : 8, NUCLEOS - 1));   // en el servidor de Linux, todos los núcleos menos uno

/* ───── Rendimiento: cuánto trabaja el aparato ─────
   Tres niveles (Ahorro, Equilibrado, Máximo) que elige Juan; no se cambian solos (lo pidió Juan en la 0.33.0).
   Cada hilo mide su velocidad cada 4 partidas con la misma búsqueda de prueba: solo sirve para el tiempo por jugada
   «Automático» (que la araña piense más o menos los mismos nodos en un aparato lento y en uno rápido) y para enseñarla. */
const MODOS = [
  { n: 'Ahorro', hilos: () => 1, descanso: 1, nodos: 2500 },
  { n: 'Equilibrado', hilos: () => Math.max(1, Math.min(NHILOS, Math.floor(NUCLEOS / 2))), descanso: .2, nodos: 4000 },
  { n: 'Máximo', hilos: () => NHILOS, descanso: 0, nodos: 6000 }];
const rend = { nps: 0, partidas: 0 };
const modo = () => MODOS[Math.max(0, Math.min(2, opc.rend == null ? 1 : opc.rend))];
const hilosActivos = () => Math.max(1, modo().hilos());
const descanso = () => modo().descanso;
function msJugada() { return opc.ms || (rend.nps ? Math.max(10, Math.min(400, Math.round(modo().nodos / rend.nps))) : 40); }
function medida(nps) { if (nps) rend.nps = rend.nps ? rend.nps * .7 + nps * .3 : nps; }
function textoRend() { return `${modo().n} · ${hilosActivos()} de ${NHILOS} hilos${rend.nps ? ` · ${Math.round(rend.nps)} nodos/ms` : ''}`; }
const hilos = [];
function crearHilos() {
  for (let i = 0; i < NHILOS; i++) {
    const w = new Worker('worker.js'); w.libre = true; w.onmessage = e => alRecibir(w, e.data);
    w.onerror = e => { console.warn('hilo', e.message); }; hilos.push(w);
  }
}
/* Lichess (la sección está más abajo): el estado va aquí arriba para que la barra de estado lo pueda leer desde el principio. */
const LI = 'https://lichess.org', LI_K = 'arana.ajedrez.lichess';
const li = { token: '', cuenta: null, arana: null, aceptar: true, conectado: false, ctrl: null, partidas: new Map(), log: [], error: '' };
try { const g = JSON.parse(localStorage.getItem(LI_K) || '{}'); li.token = g.token || ''; li.arana = g.arana || null; li.aceptar = g.aceptar !== false; } catch (e) {}
let juegos = [], enCurso = new Map(), entrenando = false, sigId = 0, ronda = 0;
/* Parásitos (34): 8 cazadoras que evolucionan solo para ganar a la élite. Cada una juega dos partidas contra dos arañas de la élite. */
function asegurarCazadoras() {
  if (!flagsDe()[34] || cazadoras.length) return;
  est.caz = est.caz || { gen: 1, origen: 'cazadora', opc: { poblacion: 8, elite: 2, torneo: 2, inmigrantes: 1 } };
  cazadoras = M.poblacionInicial(rng, 'cazadora', 8); cazadoras.forEach(c => { c.mut = { nacio: 'cazadora' }; });
  cazById = new Map(cazadoras.map(c => [c.id, c]));
}
/* ═════════ El torneo de cada generación: suizo + final ═════════
   Ronda 1: emparejadas por Elo. Las siguientes: por la clasificación (puntos, Buchholz y Elo), sin repetir rival si se puede.
   Mesa 1 = las dos primeras, mesa 2 = las dos siguientes… Cada pareja juega ida y vuelta con la misma apertura.
   Tras las rondas, las dos primeras juegan la final (ida y vuelta; si empatan, desempate). La ganadora es la campeona y suma 1 punto. */
let torneo = null;
/* Que no haya dos vivas con el mismo nombre: la nueva se llama «Vivi II», «Vivi III»… */
const ROMANOS = ['', '', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];
function nombresUnicos(lista) {
  const usados = new Set();
  for (const p of lista) {
    if (!usados.has(p.nombre)) { usados.add(p.nombre); continue; }
    const base = p.nombre.replace(/ [IVX]+$|\s\d+$/, ''); let k = 2;
    while (usados.has(base + (ROMANOS[k] || ' ' + k))) k++;
    p.nombre = base + (ROMANOS[k] || ' ' + k); usados.add(p.nombre);
  }
}
const nuevoJuego = j => Object.assign(j, { id: ++sigId, estado: 'cola', fenAhora: j.fen, ultima: null, res: null, eval: 0 });
function clasif() {
  const bh = p => (p.opp || []).reduce((t, id) => t + ((byId.get(id) || {}).tor || 0), 0);
  return pop.map(p => ({ p, tor: p.tor || 0, bh: bh(p), elo: p.elo })).sort((a, b) => b.tor - a.tor || b.bh - a.bh || b.elo - a.elo);
}
function nuevaRonda() {
  const orden = clasif().map(x => x.p), libres = orden.slice(), pares = [];
  if (torneo.ronda === 0) libres.sort((a, b) => b.elo - a.elo);
  while (libres.length > 1) {
    const a = libres.shift(); let k = libres.findIndex(b => !torneo.pares.has(a.id + '|' + b.id)); if (k < 0) k = 0;
    const b = libres.splice(k, 1)[0]; pares.push([a, b]); torneo.pares.add(a.id + '|' + b.id); torneo.pares.add(b.id + '|' + a.id);
  }
  ronda = torneo.ronda;
  pares.forEach(([a, b], mesa) => {
    a.opp = (a.opp || []).concat(b.id); b.opp = (b.opp || []).concat(a.id);
    const fen = M.aperturaAleatoria(rng, 4);
    juegos.push(nuevoJuego({ ronda, mesa, fase: 'suizo', w: a.id, b: b.id, fen, ida: true }), nuevoJuego({ ronda, mesa, fase: 'suizo', w: b.id, b: a.id, fen, ida: false }));
  });
  torneo.historia.push(pares.map(([a, b]) => [a.id, b.id]));
  if (torneo.ronda > 0) avisarProgreso(`Generación ${est.gen} · ronda ${torneo.ronda + 1} de ${torneo.R} · líder: ${orden[0].nombre} (${pts(orden[0].tor || 0)} puntos)`);
}
function empezarFinal() {
  const [x, y] = clasif(); if (!x || !y) { torneo.fase = 'hecho'; return; }
  torneo.fase = 'final'; torneo.final = { a: x.p.id, b: y.p.id };
  const fen = M.aperturaAleatoria(rng, 4);
  juegos.push(nuevoJuego({ ronda: torneo.R, mesa: 'F', fase: 'final', w: x.p.id, b: y.p.id, fen, ida: true }), nuevoJuego({ ronda: torneo.R, mesa: 'F', fase: 'final', w: y.p.id, b: x.p.id, fen, ida: false }));
}
function marcadorFinal() {
  const f = torneo && torneo.final; if (!f) return null;
  let pa = 0, pb = 0; for (const j of juegos) if (j.fase === 'final' && j.estado === 'fin') { const ra = j.w === f.a ? j.res : 1 - j.res; pa += ra; pb += 1 - ra; }
  return { pa, pb };
}
function trasPartida(j) {   // ¿se acaba la ronda, la final o el torneo?
  if (!torneo) return;
  if (j.fase === 'suizo' && juegos.every(x => x.fase !== 'suizo' || x.ronda !== torneo.ronda || x.estado === 'fin')) {
    if (torneo.ronda + 1 < torneo.R) { torneo.ronda++; nuevaRonda(); }
    else if (opc.final && pop.length >= 2) empezarFinal(); else torneo.fase = 'hecho';
  } else if (j.fase === 'final' && juegos.every(x => x.fase !== 'final' || x.estado === 'fin')) {
    const f = torneo.final, m = marcadorFinal(), fn = juegos.filter(x => x.fase === 'final');
    if (m.pa === m.pb && fn.length < 3) { const fen = M.aperturaAleatoria(rng, 4), ab = rng() < .5; juegos.push(nuevoJuego({ ronda: torneo.R, mesa: 'F', fase: 'final', w: ab ? f.a : f.b, b: ab ? f.b : f.a, fen, desempate: true })); return; }
    const gana = m.pa > m.pb ? f.a : m.pb > m.pa ? f.b : (clasif()[0].p.id);   // si también empatan el desempate, la primera del suizo
    torneo.campeona = gana; const pc = byId.get(gana); if (pc) { pc.pts += 1; pc.titulos = (pc.titulos || 0) + 1; }
    torneo.fase = 'hecho';
  }
  claSucio = true;
}
function prepararGeneracion() {
  aplicarPendientes();
  pop.forEach(p => { p.pts = 0; p.sfb = 0; p.nov = 0; p.plyT = 0; p.nJ = 0; p.tor = 0; p.opp = []; });
  juegos = []; torneo = { ronda: 0, R: Math.max(1, opc.rondas), pares: new Set(), fase: 'suizo', final: null, historia: [], campeona: null };
  nuevaRonda();
  asegurarCazadoras();
  if (flagsDe()[34] && cazadoras.length) {
    const elite = pop.slice(0, Math.min(4, pop.length));
    cazadoras.forEach((c, i) => {
      c.pts = 0;
      const a = elite[i % elite.length], b = elite[(i + 1) % elite.length], f1 = M.aperturaAleatoria(rng, 4), f2 = M.aperturaAleatoria(rng, 4);
      juegos.push(nuevoJuego({ ronda: 0, mesa: 'c' + i, tipo: 'caza', w: c.id, b: a.id, fen: f1 }), nuevoJuego({ ronda: 0, mesa: 'c' + i, tipo: 'caza', w: b.id, b: c.id, fen: f2 }));
    });
  }
  ronda = 0;
  construirPlano();
}
function repartir() {
  if (!entrenando) return;
  const ahora = Date.now(), activos = hilosActivos();
  let usados = hilos.filter(w => !w.libre).length;
  for (const w of hilos) {
    if (!w.libre) continue;
    if (usados >= activos) break;
    if (w.descansa > ahora) { clearTimeout(w.tDesc); w.tDesc = setTimeout(repartir, w.descansa - ahora + 5); continue; }   // descanso entre partidas
    const j = juegos.find(x => x.estado === 'cola'); if (!j) break;
    j.estado = 'juega'; w.libre = false; enCurso.set(j.id, j); usados++; j.t0 = Date.now(); w.n = (w.n || 0) + 1;
    const pw = ind(j.w), pb = ind(j.b), F = flagsDe();
    const ajW = j.tipo === 'caza' && byId.has(j.w) ? ajusteContra(pw, 'cazadoras') : null, ajB = j.tipo === 'caza' && byId.has(j.b) ? ajusteContra(pb, 'cazadoras') : null;
    w.postMessage({ t: 'partida', id: j.id, w: { id: j.w, genes: pw.genes }, b: { id: j.b, genes: pb.genes }, fen: j.fen, opc: { ms: msJugada(), prof: opc.prof, maxPlies: opc.maxPlies }, directo: opc.directo, flags: F, ajW, ajB, banco: w.n % 4 === 1 });
  }
  marcar();
}
function alRecibir(w, d) {
  if (d.t === 'pensado') { const f = pens.get(d.id); if (f) { pens.delete(d.id); f(d); } return; }
  const j = enCurso.get(d.id); if (!j) return;
  if (d.t === 'jugada') { j.fenAhora = d.fen; j.ultima = d.uci; j.eval = d.eval; (j.lista = j.lista || []).push(d.uci); marcar(j); actualizarVisor(); return; }
  if (d.t === 'fin') {
    w.libre = true; enCurso.delete(d.id); medida(d.nps); rend.partidas++;
    const dur = Date.now() - (j.t0 || Date.now()); w.descansa = descanso() ? Date.now() + Math.min(60000, dur * descanso()) : 0;
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
      if (j.fase === 'suizo') { a.tor = (a.tor || 0) + d.res; b.tor = (b.tor || 0) + 1 - d.res; }
      for (const [p, v] of [[a, d.res], [b, 1 - d.res]]) { p.partidas[v === 1 ? 'g' : v === 0 ? 'p' : 'e']++; p.plyT = (p.plyT || 0) + d.plies; p.nJ = (p.nJ || 0) + 1; }
    }
    trasPartida(j); marcar(j); if (j.fase === 'suizo') marcar();
    if (juegos.every(x => x.estado === 'fin') && (!torneo || torneo.fase === 'hecho')) finTorneo();
    else repartir();
  }
}
async function cerrarGeneracion() {
  const viejos = pop.slice(), mejorPartida = elegirPartida(), fase = sfFase; sfFase = null;
  if (flagsDe()[39] || redActiva()) { try { await etiquetarGradiente(fase); } catch (e) { console.warn('gradiente', e); } gradVista = ''; }
  if (redActiva()) { try { redUltima = await cicloRedes(); } catch (e) { redUltima = { error: (e && e.message) || String(e) }; console.warn('redes', e); } gradVista = ''; }
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
  // Elo en la escala normal: las partidas contra Stockfish desplazan la escala de todas
  if (fase && fase.hechos.length && fase.E.elo) {
    const js = fase.hechos.map(j => { const p = byId.get(j.id); return p ? { e: p.elo, R: fase.E.elo, s: j.res } : null; }).filter(Boolean);
    const d = anclaElo(js, 0, 120); pop.concat(cazadoras).forEach(p => { p.elo += d; }); if (resSF) resSF.ajusteElo = Math.round(d);
  }
  const mediaAntes = mediaEloDe(pop), mediaCaz = mediaEloDe(cazadoras);
  const F = flagsDe(); est.flags = F; const clasifAntes = torneo ? clasif() : [];
  if (F[37]) novedad();
  const out = M.siguienteGeneracion(est, pop, rng);
  if (resSF) out.resumen.sf = resSF;
  { const d = mediaAntes - mediaEloDe(out.pop); out.pop.forEach(p => { p.elo += d; p.eloReal = 1; }); }   // sin inflación: las hijas no suben la media por nacer
  if (F[39]) { try { const g = afinarHijas(out.pop, new Set(out.resumen.elite), F); if (g) out.resumen.gradiente = g; } catch (e) { console.warn('gradiente', e); } }
  if (redUltima) { out.resumen.red = redUltima; redUltima = null; }
  if (redActiva()) { out.resumen.auto = resumenAuto(); if (out.resumen.red) out.resumen.red.auto = out.resumen.auto; }
  out.resumen.flags = fkey(F);
  // Memoria del rival (35): las hijas heredan la memoria del padre que más les dio
  const antes = new Map(viejos.map(p => [p.id, p])), cazAntes = new Map(cazadoras.map(c => [c.id, c]));
  if (torneo) { const cl = clasifAntes, mf = marcadorFinal(), cp = torneo.campeona && antes.get(torneo.campeona);
    out.resumen.torneo = { rondas: torneo.R, campeona: cp ? { id: cp.id, nombre: cp.nombre } : null, final: torneo.final ? { a: (antes.get(torneo.final.a) || {}).nombre, b: (antes.get(torneo.final.b) || {}).nombre, pa: mf.pa, pb: mf.pb } : null, clasif: cl.slice(0, 32).map(x => [x.p.nombre, x.tor, x.bh]) }; }
  for (const h of out.pop) if (h.padres && h.padres.length && !h.rivales) { const cr = h.mut && h.mut.cruce, pa = antes.get(h.padres[cr && cr.b > cr.a ? 1 : 0]); if (pa && pa.rivales) h.rivales = JSON.parse(JSON.stringify(pa.rivales)); }
  // Las cazadoras también evolucionan
  const extraCaz = [];
  if (F[34] && cazadoras.length) {
    est.caz.flags = F;
    const oc = M.siguienteGeneracion(est.caz, cazadoras, rng), vivasC = new Set(oc.pop.map(c => c.id)), eliteC = new Set(oc.resumen.elite);
    out.resumen.caza = { mejor: oc.resumen.mejor, puntos: cazadoras.reduce((a, c) => a + c.pts, 0), partidas: cazadoras.length * 2 };
    for (const c of cazadoras) if (!vivasC.has(c.id)) { conHuella(c); c.murio = est.gen; extraCaz.push(['individuos', Object.assign({}, c, { genes: eliteC.has(c.id) || genesTodas() ? c.genes : null })]); }
    oc.pop.forEach(c => { if (!c.mut || !c.mut.nacio) { c.mut = c.mut || {}; } c.pts = 0; });
    { const d = mediaCaz - mediaEloDe(oc.pop); oc.pop.forEach(c => { c.elo += d; c.eloReal = 1; }); }
    cazadoras = oc.pop; cazById = new Map(cazadoras.map(c => [c.id, c]));
  }
  const elite = new Set(out.resumen.elite);
  const vivos = new Set(out.pop.map(p => p.id)), extra = [['generaciones', out.resumen]].concat(extraCaz);
  if (F[39]) extra.push(['estado', grad, 'grad']);
  if (redActiva()) { extra.push(['estado', redDatos, 'red40datos']); if (redes.length) extra.push(['estado', { lista: redes.map(sinGPU), sig: redSig }, 'red40pob']); }
  if (mejorPartida) {   // todas las partidas de la generación, con sus jugadas
    const nom = id => (ind(id) || antes.get(id) || cazAntes.get(id) || { nombre: '?' }).nombre;
    mejorPartida.todas = juegos.filter(j => j.estado === 'fin').map(j => ({ tipo: j.tipo || '', wn: nom(j.w), bn: nom(j.b), w: j.w, b: j.b, fen: j.fen, jugadas: (j.jugadas || []).join(' '), res: j.res, motivo: j.motivo }))
      .concat(fase ? fase.hechos.map(x => ({ tipo: 'sf', wn: x.yoB ? x.nombre : 'Stockfish', bn: x.yoB ? 'Stockfish' : x.nombre, fen: x.fen0, jugadas: x.jugadas.join(' '), res: x.yoB ? x.res : 1 - x.res, motivo: x.motivo, peldano: fase.E.n })) : [])
      .concat(redJuegos);
    extra.push(['partidas', Object.assign({ gen: out.resumen.gen }, mejorPartida)]);
  }
  for (const p of viejos) if (!vivos.has(p.id)) { conHuella(p); p.murio = out.resumen.gen; extra.push(['individuos', Object.assign({}, p, { genes: elite.has(p.id) || genesTodas() ? p.genes : null })]); }
  redJuegos = [];
  est = out.est; pop = out.pop; nombresUnicos(pop.concat(cazadoras)); byId = new Map(pop.map(p => [p.id, p])); historial.push(out.resumen);
  const nuevos = revisarHitos(out.resumen);
  try { await guardarEstado(extra); } catch (e) { console.warn('guardar', e); }
  juegos = []; sucio.clear();
  nuevos.forEach((h, i) => setTimeout(() => anunciarHito(h), i * 3200));
  { const r = out.resumen, tc = r.torneo && r.torneo.campeona;
    avisarProgreso(`Generación ${r.gen} terminada · campeona del torneo: ${tc ? tc.nombre : r.mejor.nombre} · mejor Elo ${r.mejor.elo} · Stockfish: peldaño ${est.escalera.peldano} de ${ESCALERA.length}${r.sf ? ` (${fmt(r.sf.puntos, 1)} de ${r.sf.partidas})` : ''}`); }
  pintarEstado();
  if (entrenando) { prepararGeneracion(); repartir(); } else construirPlano();
}
/* ═════════ La gráfica (WebGPU, fase 1 de la red en la gráfica, 0.37.0) ═════════
   De momento solo se comprueba que funciona y lo rápida que es. Mientras la sala usa la gráfica (usaGPU), el servidor de Linux
   para llama-server y lo vuelve a abrir al acabar (lo pidió Juan). */
let gpuPrueba = null, gpuOcupada = false;
async function probarGPU(op) {
  if (typeof GPU === 'undefined') return null;
  gpuOcupada = true;
  try { gpuPrueba = await GPU.probar(op); } finally { gpuOcupada = false; }
  return gpuPrueba;
}
function textoGPU() {
  const r = gpuPrueba; if (!r) return 'Este aparato tiene WebGPU. Pulse «Probar la gráfica» para ver si calcula bien y a qué velocidad.';
  if (r.error) return 'La gráfica no funciona: ' + r.error;
  const g = r.gpu, v = r.velocidad, nombre = [g.fabricante, g.arquitectura, g.descripcion].filter(Boolean).join(' · ') || 'sin nombre';
  return `${nombre}${g.simulada ? ' (simulada: no acelera)' : ''}. ${r.ok ? 'Calcula igual que el procesador' : 'Sus cálculos NO coinciden con el procesador'}.` + (v ? ` Red de prueba (${v.bloques} bloques de ${v.filtros} filtros): ${v.posicionesPorSegundo.toLocaleString('es-ES')} posiciones/s.` : '');
}
/* ═════════ La red en la gráfica (40): fases 2, 3 y 4 ═════════
   Solo en el servidor de Linux con WebGPU. Al cerrar cada generación (cicloRedes):
   1) Stockfish etiqueta posiciones de las partidas (valor y mejor jugada); una de cada diez, siempre las mismas, solo sirve para medir.
   2) Cada red de la población entrena con Adam en la gráfica (como mucho «redVueltas» vueltas a los datos, para no memorizar).
   3) Cada red juega con MCTS (mcts.js): ida y vuelta contra su peldaño de Stockfish (sube con 1,5 de 2, baja con 0) y contra una de
      las dos primeras del torneo, que suma puntos y Elo por esas partidas (las redes «entran» en el torneo). Elo de cada red: sus
      últimas 40 partidas, en la misma escala que las arañas.
   4) Fase 4 (0.40.0): entrenamiento por población (PBT). Cada «redCada» generaciones, la red con peor Elo se sustituye por una hija de
      la mejor: hereda sus pesos y su Elo, y cambia un poco su ritmo de aprendizaje, el peso de la política, cómo busca (cpuct, fpu)
      y, a veces, su número de bloques (crece con un bloque nuevo que casi no cambia nada, o encoge). */
const TAMS_RED = [{ filtros: 32, bloques: 4 }, { filtros: 64, bloques: 6 }, { filtros: 128, bloques: 10 }];
const redActiva = () => !!(flagsDe()[40] && ORIGEN === 'linux' && typeof GPU !== 'undefined' && GPU.disponible() && typeof Red !== 'undefined');
const hashTexto = t => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const GENES_RED = { lr: 1e-3, wp: .1, cpuct: 1.8, fpu: .3 };
const RANGO_RED = { lr: [5e-5, 5e-3], wp: [.02, 1], cpuct: [.8, 4], fpu: [0, .6], bloques: [2, 12] };
let redJuegos = [], redSig = 1;
function nuevaRed(base, genes, nombre) {
  const r = Object.assign(base, { id: 'red' + (redSig++) + '-' + Math.floor(rng() * 1e6).toString(36), nombre: nombre || 'Red ' + M.nombre(rng), gen: est.gen,
    genes: Object.assign({}, GENES_RED, genes || {}), elo: base.elo || 1500, peldano: base.peldano || 1, juegos: base.juegos || [], hist: base.hist || [] });
  return r;
}
const sinGPU = r => { const o = {}; for (const k in r) if (k[0] !== '_') o[k] = r[k]; return o; };
function cerrarGPU(r) { for (const k of ['_gpu', '_juego', '_auto']) if (r[k]) { try { r[k].cerrar(); } catch (e) {} r[k] = null; } r._agr = null; }
function asegurarRedes() {
  const tam = TAMS_RED[Math.max(0, Math.min(2, gopc('redTam')))], quiere = Math.max(1, gopc('redPob'));
  redes = redes.filter(r => r.pesos && r.pesos.length === Red.disposicion(r.filtros, r.bloques, r.cabeza).total);   // las de otra forma (versiones viejas) no sirven
  while (redes.length < quiere) {
    const k = redes.length, g = k ? { lr: GENES_RED.lr * Math.exp(gauss() * .5), wp: GENES_RED.wp * Math.exp(gauss() * .5), cpuct: GENES_RED.cpuct + gauss() * .3, fpu: GENES_RED.fpu + gauss() * .1 } : {};
    redes.push(nuevaRed(Red.crear({ filtros: tam.filtros, bloques: tam.bloques, semilla: (Date.now() % 1e9) + k + 1 }), recortarGenes(g)));
  }
  while (redes.length > quiere) { const peor = redes.slice().sort((a, b) => a.elo - b.elo)[0]; cerrarGPU(peor); redes = redes.filter(r => r !== peor); }
}
function gauss() { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function recortarGenes(g) { const o = Object.assign({}, g); for (const k in o) if (RANGO_RED[k]) o[k] = Math.max(RANGO_RED[k][0], Math.min(RANGO_RED[k][1], o[k])); return o; }
const datosRed = () => { const ent = [], prueba = []; for (const x of redDatos.pos) (hashTexto(x[0]) % 10 === 0 ? prueba : ent).push(x); return { ent, prueba }; };
const aMuestra = x => Red.muestra(x[0], x[1], x[3] || '');
async function entrenarUna(r, ent, pr) {
  if (!r._gpu) r._gpu = await Red.enGPU(r, { lote: 256, lr: r.genes.lr, wp: r.genes.wp });
  const tope = Math.max(5, Math.round(ent.length * gopc('redVueltas') / 256)), pasos = Math.min(gopc('redPasos'), tope);
  const antes = await r._gpu.medir(pr), t0 = Date.now(); let hechos = 0;
  for (let s = 0; s < pasos; s++) {
    if (!entrenando) break;
    const lote = []; for (let i = 0; i < 256; i++) lote.push(aMuestra(ent[Math.floor(rng() * ent.length)]));
    await r._gpu.paso(lote); hechos++;
    if (s % 10 === 9) { await r._gpu.esperar(); gradVista = `${r.nombre} aprende: paso ${s + 1} de ${pasos}`; if (s % 50 === 49) pintarEstado(); }
  }
  await r._gpu.esperar();
  const despues = await r._gpu.medir(pr); await r._gpu.pesos();
  const q4 = v => Math.round(v * 1e4) / 1e4, m = x => ({ valor: q4(x.valor), politica: q4(x.politica), acierto: q4(x.acierto) });
  r.ultimo = { pasos: hechos, tope, antes: m(antes), despues: m(despues), ms: Date.now() - t0 };
  return r.ultimo;
}
async function evaluadorDe(r) {
  if (!r._juego || r._juego.pasosCargados !== r.pasos) { if (r._juego) r._juego.cerrar(); r._juego = await Red.enGPU(r, { lote: 64 }); r._juego.pasosCargados = r.pasos; }
  const g = r._juego;
  return async fens => {
    const out = [];
    for (let i = 0; i < fens.length; i += 64) {
      const trozo = fens.slice(i, i + 64).map(f => ({ x: Red.codificar(f, new Float32Array(Red.PL * 64)), t: 0, obj: -1 })), v = await g.valorar(trozo);
      for (let k = 0; k < trozo.length; k++) out.push({ v: v.valor[k], logits: v.politica.subarray(k * Red.NP, (k + 1) * Red.NP) });
    }
    return out;
  };
}
async function partidaRed(r, rival, redBlancas, fen0) {
  const evaluar = await evaluadorDe(r), pos = new M.Pos(fen0), jug = [];
  if (rival.tipo === 'sf') { sf.w.postMessage('ucinewgame'); sf.w.postMessage('setoption name Skill Level value ' + rival.E.skill); await sfCmd('isready', /^readyok/); }
  const maxP = opc.maxPlies || 300; let f = null, malas = 0, msRed = 0, movRed = 0;
  while (!(f = M.fin(pos))) {
    if (!entrenando) return null;
    if (jug.length >= maxP) {   // como en la escalera: decide Stockfish por la valoración de la posición
      let res = .5;
      if (sf.listo && !sfFallo) { try { sf.w.postMessage('setoption name Skill Level value 20'); sf.w.postMessage('position fen ' + pos.fen()); const sc = puntuacion(await sfCmd('go depth 12', /^bestmove/, 30000)); if (sc != null) { const bl = pos.side ? -sc : sc; res = bl > 300 ? 1 : bl < -300 ? 0 : .5; } } catch (e) {} }
      f = { res, motivo: 'límite de jugadas' }; break;
    }
    let u;
    if ((pos.side === 0) === redBlancas) {
      const ta = Date.now(), b = await MCTS.buscar(pos, evaluar, { sims: gopc('redSims'), lote: 64, cpuct: r.genes.cpuct, fpu: r.genes.fpu, temperatura: jug.length < 8 ? 1 : 0, rng });
      msRed += Date.now() - ta; movRed++; u = b.uci;
      if ((b.q || 0) < -.95) { if (++malas >= 6) { f = { res: redBlancas ? 0 : 1, motivo: 'la red abandona' }; break; } } else malas = 0;
    } else if (rival.tipo === 'sf') {
      sf.w.postMessage('position fen ' + fen0 + (jug.length ? ' moves ' + jug.join(' ') : ''));
      const ls = await sfCmd('go ' + rival.E.go, /^bestmove/, 30000); u = ls.length ? ls[ls.length - 1].split(/\s+/)[1] : null;
    } else { const b = await pensarArana(rival.p, fen0, jug, null); u = b.uci; }
    if (!u || u === '(none)') { f = M.fin(pos) || { res: .5, motivo: 'sin jugada' }; break; }
    const m = M.parseUci(pos, u); if (!m) { f = { res: .5, motivo: 'jugada imposible' }; break; }
    pos.make(m); jug.push(u);
    if (jug.length % 10 === 0) { gradVista = gradVista.replace(/ · jugada \d+$/, '') + ' · jugada ' + Math.ceil(jug.length / 2); pintarEstado(); }
  }
  return { res: redBlancas ? f.res : 1 - f.res, blancasRes: f.res, motivo: f.motivo, jugadas: jug, fen0, redBlancas, msJugada: movRed ? Math.round(msRed / movRed) : 0 };
}
async function jugarUna(r, k) {
  if (!sf.listo && !sfFallo) { try { await sfIniciar(); } catch (e) { sfFallo = (e && e.message) || 'no carga'; } }
  r.peldano = Math.max(1, Math.min(ESCALERA.length, r.peldano || 1));
  const E = ESCALERA[r.peldano - 1], cl = torneo ? clasif() : [], arana = cl.length ? cl[k % Math.min(2, cl.length)].p : null;
  const f1 = M.aperturaAleatoria(rng, 4), f2 = M.aperturaAleatoria(rng, 4), rivales = [];
  if (sf.listo && !sfFallo) rivales.push([{ tipo: 'sf', E }, true, f1], [{ tipo: 'sf', E }, false, f1]);
  if (arana) rivales.push([{ tipo: 'arana', p: arana }, true, f2], [{ tipo: 'arana', p: arana }, false, f2]);
  const salida = { peldano: E.n, partidas: [] };
  for (const [rv, b, f0] of rivales) {
    const nombre = rv.tipo === 'sf' ? 'Stockfish' : rv.p.nombre, R = rv.tipo === 'sf' ? E.elo : Math.round(rv.p.elo);
    gradVista = `${r.nombre} juega con ${b ? 'blancas' : 'negras'} contra ${rv.tipo === 'sf' ? `Stockfish (peldaño ${E.n})` : nombre}`; pintarEstado();
    const x = await partidaRed(r, rv, b, f0); if (!x) break;
    r.juegos = (r.juegos || []).concat([{ R, s: x.res, gen: est.gen, contra: nombre }]).slice(-40);
    if (rv.tipo === 'arana') {   // la araña también juega: suma puntos (repartidos entre las redes) y Elo, como en el torneo
      const p = rv.p, rs = 1 - x.res, proxy = { elo: r.elo || 1500 };
      p.pts = (p.pts || 0) + rs / Math.max(1, redes.length); M.actualizarElo(proxy, p, x.res);
      p.partidas[rs === 1 ? 'g' : rs === 0 ? 'p' : 'e']++; recordarRival(p, 'red', rs);
    }
    salida.partidas.push({ contra: nombre, R, blancas: b, res: x.res, motivo: x.motivo, plies: x.jugadas.length, msJugada: x.msJugada });
    redJuegos.push({ tipo: 'red', wn: b ? r.nombre : nombre, bn: b ? nombre : r.nombre, fen: f0, jugadas: x.jugadas.join(' '), res: x.blancasRes, motivo: x.motivo, peldano: rv.tipo === 'sf' ? E.n : undefined });
  }
  const contraSF = salida.partidas.filter(x => x.contra === 'Stockfish'), pts = contraSF.reduce((a, x) => a + x.res, 0);
  if (contraSF.length === 2) { if (pts >= 1.5 && r.peldano < ESCALERA.length) r.peldano++; else if (pts === 0 && r.peldano > 1) r.peldano--; }
  r.elo = Math.round(1500 + anclaElo(r.juegos.map(j => ({ e: 1500, R: j.R, s: j.s })), 0, 400));
  salida.elo = r.elo; salida.peldanoNuevo = r.peldano; r.ultimoJuego = salida;
  return salida;
}
/* Fase 4: la peor deja su sitio a una hija de la mejor */
function explotarExplorar() {
  if (redes.length < 2 || est.gen % Math.max(1, gopc('redCada')) !== 0) return null;
  const listas = redes.filter(r => (r.juegos || []).length >= 6); if (listas.length < 2) return null;
  listas.sort((a, b) => b.elo - a.elo);
  const mejor = listas[0], peor = listas[listas.length - 1];
  if (mejor.elo - peor.elo < 30) return { nada: `diferencia pequeña (${mejor.elo} contra ${peor.elo})` };
  const g = recortarGenes({ lr: mejor.genes.lr * Math.exp(gauss() * .3), wp: mejor.genes.wp * Math.exp(gauss() * .4), cpuct: mejor.genes.cpuct + gauss() * .3, fpu: mejor.genes.fpu + gauss() * .08 });
  let base, cambio = '';
  if (rng() < .25) { const nb = Math.max(RANGO_RED.bloques[0], Math.min(RANGO_RED.bloques[1], mejor.bloques + (rng() < .65 ? 1 : -1))); if (nb !== mejor.bloques) { base = Red.rehacer(mejor, { bloques: nb, semilla: (Date.now() % 1e9) + 3 }); cambio = `${mejor.bloques} → ${nb} bloques`; } }
  if (!base) base = { v: mejor.v, filtros: mejor.filtros, bloques: mejor.bloques, cabeza: mejor.cabeza, total: mejor.total, pesos: mejor.pesos.slice(), pasos: mejor.pasos };
  Object.assign(base, { elo: mejor.elo, peldano: mejor.peldano, juegos: (mejor.juegos || []).slice(), hist: [] });
  const hija = nuevaRed(base, g); hija.padre = mejor.id; hija.padreNombre = mejor.nombre;
  cerrarGPU(peor); redes = redes.map(r => (r === peor ? hija : r));
  const f = v => (v < .01 ? v.toExponential(1) : Math.round(v * 1000) / 1000);
  return { gen: est.gen, muere: `${peor.nombre} (Elo ${peor.elo})`, madre: `${mejor.nombre} (Elo ${mejor.elo})`, hija: hija.nombre,
    cambios: [`ritmo ${f(mejor.genes.lr)} → ${f(g.lr)}`, `política ${f(mejor.genes.wp)} → ${f(g.wp)}`, `cpuct ${f(mejor.genes.cpuct)} → ${f(g.cpuct)}`, `fpu ${f(mejor.genes.fpu)} → ${f(g.fpu)}`].concat(cambio ? [cambio] : []) };
}
async function cicloRedes() {
  const n = redDatos.pos.length; if (n < 512) return { posiciones: n, nota: 'aún pocas posiciones (hacen falta 512)' };
  auto.pausa = true; for (let i = 0; i < 600 && (auto.enCurso > 0 || auto.entrenando); i++) await esperar(200);   // el autojuego acaba sus partidas (hasta 2 min) y deja la gráfica
  try {
  asegurarRedes();
  const { ent, prueba } = datosRed(); if (!ent.length || !prueba.length) return { posiciones: n, nota: 'faltan posiciones' };
  const pr = prueba.slice(-2048).map(aMuestra), salida = { posiciones: n, entrenamiento: ent.length, prueba: pr.length, redes: [] };
  redOcupada = true;
  try {
    for (const r of redes) { if (!entrenando) break; await entrenarUna(r, ent, pr); }
    if (gopc('redJuega')) for (let k = 0; k < redes.length; k++) { if (!entrenando) break; if ((redes[k].pasos || 0) >= 100) await jugarUna(redes[k], k); }
    for (const r of redes) r.hist = (r.hist || []).concat([{ gen: est.gen, elo: r.elo, acierto: r.ultimo ? r.ultimo.despues.acierto : null, valor: r.ultimo ? r.ultimo.despues.valor : null }]).slice(-300);
    salida.pbt = explotarExplorar();
    salida.redes = redes.map(r => ({ id: r.id, nombre: r.nombre, tam: `${r.filtros}×${r.bloques}`, genes: r.genes, pasos: r.pasos, elo: r.elo, peldano: r.peldano, entrenamiento: r.ultimo || null, juego: r.ultimoJuego || null }));
    const mejor = redes.slice().sort((a, b) => b.elo - a.elo)[0];
    // Para las gráficas de siempre: la mejor red
    if (mejor.ultimo) Object.assign(salida, { red: `${mejor.filtros}×${mejor.bloques}`, antes: mejor.ultimo.antes, despues: mejor.ultimo.despues, pasos: mejor.ultimo.pasos, totalPasos: mejor.pasos });
    if (mejor.ultimoJuego) salida.juego = Object.assign({}, mejor.ultimoJuego, { elo: mejor.elo, nombre: mejor.nombre });
    salida.eloMedio = Math.round(redes.reduce((a, r) => a + r.elo, 0) / redes.length);
    return salida;
  } finally { redOcupada = false; }
  } finally { auto.pausa = false; if (entrenando && redActiva()) bucleAuto(); }
}
function textoRed() {
  if (!redActiva()) return ORIGEN === 'linux' ? 'Encienda la distópica 40 y la gráfica (WebGPU) para que entrene.' : 'Solo entrena en el servidor de Linux, con su gráfica.';
  const ua = historial.slice().reverse().find(g => g.auto && g.auto.partidas);
  return (auto.activo ? `Autojuego en marcha: ${auto.gen.partidas} partidas en esta generación. ` : '') + (ua ? `En la generación ${ua.gen} jugó ${ua.auto.partidas} partidas contra sí misma (${ua.auto.valoracionesPorSegundo.toLocaleString('es-ES')} valoraciones por segundo en la gráfica). ` : '') + `Tiene ${redDatos.pos.length.toLocaleString('es-ES')} posiciones etiquetadas y ${redes.length ? redes.length + ' redes' : 'aún ninguna red (nacen cuando haya 512 posiciones)'}. Juegan con ${gopc('redSims')} simulaciones por jugada; cada ${gopc('redCada')} generaciones la peor deja su sitio a una hija de la mejor.`;
}
function listaRedes() {
  if (!redes.length) return '';
  const f = v => (v < .01 ? v.toExponential(1) : Math.round(v * 1000) / 1000);
  const ev = historial.slice().reverse().find(g => g.red && g.red.pbt && g.red.pbt.hija);
  const ult = ev ? `<p class="nota">Último cambio (generación ${ev.gen}): ${esc(ev.red.pbt.muere)} deja su sitio a ${esc(ev.red.pbt.hija)}, hija de ${esc(ev.red.pbt.madre)} · ${esc(ev.red.pbt.cambios.join(' · '))}.</p>` : '';
  return ult + '<div class="det">' + redes.slice().sort((a, b) => b.elo - a.elo).map(r => `<span>${esc(r.nombre)} <i style="font-style:normal;color:var(--muted)">${r.filtros}×${r.bloques}${r.padreNombre ? ' · hija de ' + esc(r.padreNombre) : ''}</i></span><span class="v">Elo ${r.elo} · peldaño ${r.peldano}${r.ultimo ? ` · acierta ${Math.round(r.ultimo.despues.acierto * 100)} %` : ''}</span><span style="color:var(--muted)">ritmo ${f(r.genes.lr)} · política ${f(r.genes.wp)} · cpuct ${f(r.genes.cpuct)} · fpu ${f(r.genes.fpu)}</span><span class="v">${(r.pasos || 0).toLocaleString('es-ES')} pasos</span>`).join('') + '</div>';
}
/* ═════════ Autojuego continuo en la gráfica (40, 0.41.0, lo pidió Juan: que el trabajo vaya a la 5080) ═════════
   Mientras la sala entrena, las redes juegan contra sí mismas sin parar, como AlphaZero: «redAutoPar» partidas a la vez, cada jugada una
   búsqueda MCTS de «redAutoSims» simulaciones con ruido de Dirichlet en la raíz y algo de azar en las 20 primeras jugadas.
   Un agrupador junta las hojas de todas las partidas en lotes de hasta 256 para la gráfica. Cada posición se guarda con el resultado
   de la partida (valor) y la jugada más visitada por la búsqueda (política), en los mismos datos que las de Stockfish (fuente «a»).
   Cada 4096 posiciones nuevas, las redes entrenan con ellas. Al cerrar cada generación, el autojuego se para un momento y el ciclo
   de siempre mide a las redes contra Stockfish y las arañas, y hace el relevo. Las arañas siguen en el procesador, a la vez. */
const auto = { activo: false, pausa: false, enCurso: 0, entrenando: false, turno: 0, evals: 0, nuevas: 0, gen: { partidas: 0, posiciones: 0, evals: 0, t0: Date.now(), entrenos: 0 } };
const esperar = ms => new Promise(r => setTimeout(r, ms));
function agrupadorAuto(r) {
  if (r._agr) return r._agr;
  const cola = []; let corriendo = false;
  async function vaciar() {
    if (corriendo) return; corriendo = true;
    try {
      while (cola.length) {
        await esperar(0);   // deja que las demás partidas pongan sus hojas en la cola
        if (!r._auto || r._auto.pasosCargados !== r.pasos) { if (r._auto) r._auto.cerrar(); r._auto = await Red.enGPU(r, { lote: 256 }); r._auto.pasosCargados = r.pasos; }
        const lote = []; let n = 0;
        while (cola.length && (n + cola[0].fens.length <= 256 || !lote.length)) { const q = cola.shift(); lote.push(q); n += q.fens.length; }
        const fens = lote.flatMap(q => q.fens), tr = fens.map(f => ({ x: Red.codificar(f, new Float32Array(Red.PL * 64)), t: 0, obj: -1 }));
        let v; try { v = await r._auto.valorar(tr); } catch (e) { lote.forEach(q => q.ko(e)); continue; }
        let k = 0; for (const q of lote) { const out = []; for (let i = 0; i < q.fens.length; i++, k++) out.push({ v: v.valor[k], logits: v.politica.subarray(k * Red.NP, (k + 1) * Red.NP) }); q.ok(out); }
        auto.evals += fens.length; auto.gen.evals += fens.length;
      }
    } finally { corriendo = false; }
  }
  r._agr = fens => new Promise((ok, ko) => { cola.push({ fens, ok, ko }); vaciar(); });
  return r._agr;
}
async function partidaAuto(r) {
  const ev = agrupadorAuto(r), pos = new M.Pos(M.aperturaAleatoria(rng, 2)), reg = [];
  let f = null, seguro = 0;
  auto.enCurso++;
  try {
    while (!(f = M.fin(pos))) {
      if (!entrenando || !redes.includes(r)) return null;   // con la pausa del cierre de generación, la partida se termina (no se tira)
      if (reg.length >= 300) { f = { res: .5, motivo: 'límite' }; break; }
      const b = await MCTS.buscar(pos, ev, { sims: gopc('redAutoSims'), lote: 32, cpuct: r.genes.cpuct, fpu: r.genes.fpu, temperatura: reg.length < 20 ? 1 : 0, ruido: { alfa: .3, eps: .25 }, rng });
      if (!b.uci) break;
      reg.push([pos.fen(), b.visitas[0][0]]);
      if (Math.abs(b.q || 0) > .97 && reg.length > 20) { if (++seguro >= 8) { const gana = b.q > 0 ? pos.side : pos.side ^ 1; f = { res: gana === 0 ? 1 : 0, motivo: 'abandono' }; break; } } else seguro = 0;
      pos.make(M.parseUci(pos, b.uci));
    }
    if (!f) return null;
    return { res: f.res, reg };
  } catch (e) { return null; } finally { auto.enCurso--; }
}
async function entrenarConAuto() {
  if (redDatos.pos.length < 512) return;
  auto.entrenando = true;
  try {
    const { ent, prueba } = datosRed(), pr = prueba.slice(-2048).map(aMuestra);
    for (const r of redes.slice()) { if (auto.pausa || !entrenando) break; await entrenarUna(r, ent, pr); }
    auto.gen.entrenos++;
  } finally { auto.entrenando = false; }
}
async function bucleAuto() {
  if (auto.activo) return; auto.activo = true;
  try {
    while (entrenando && redActiva() && gopc('redAuto')) {
      if (auto.pausa || redOcupada) { await esperar(1000); continue; }
      asegurarRedes(); if (!redes.length) { await esperar(5000); continue; }
      const r = redes[auto.turno++ % redes.length];
      gradVista = `autojuego en la gráfica: ${r.nombre} · ${auto.gen.partidas} partidas y ${auto.gen.posiciones.toLocaleString('es-ES')} posiciones en esta generación`; pintarEstado();
      const hechas = await Promise.all(Array.from({ length: Math.max(1, gopc('redAutoPar')) }, () => partidaAuto(r)));
      for (const h of hechas) if (h) {
        for (const [fen, uci] of h.reg) redDatos.pos.push([fen, h.res, 'a', uci]);
        auto.gen.partidas++; auto.gen.posiciones += h.reg.length; auto.nuevas += h.reg.length;
      }
      if (redDatos.pos.length > gopc('redMax')) redDatos.pos = redDatos.pos.slice(-gopc('redMax'));
      if (auto.nuevas >= 4096) { auto.nuevas = 0; await entrenarConAuto(); }
    }
  } catch (e) { console.warn('autojuego', e); } finally { auto.activo = false; if (gradVista.startsWith('autojuego')) gradVista = ''; }
}
function resumenAuto() {
  const g = auto.gen, s = (Date.now() - g.t0) / 1000;
  const r = { partidas: g.partidas, posiciones: g.posiciones, valoraciones: g.evals, entrenos: g.entrenos, segundos: Math.round(s), valoracionesPorSegundo: s ? Math.round(g.evals / s) : 0 };
  auto.gen = { partidas: 0, posiciones: 0, evals: 0, t0: Date.now(), entrenos: 0 };
  return r;
}
/* ═════════ Gradiente (39) ═════════
   Al cerrar cada generación: de sus partidas se sacan posiciones tranquilas y se etiquetan (Stockfish a poca profundidad o,
   si no hay Stockfish o así se elige, el resultado de la partida). Después, cada hija recibe unos pasos de descenso de gradiente
   sobre los genes de sus medidas encendidas y de su red, antes de jugar (Lamarck). La élite pasa intacta, como siempre. */
const gopc = k => (est.opc && est.opc[k] != null ? est.opc[k] : M.OPC_EVO[k]);
async function etiquetarGradiente(fase) {
  const cuantas = Math.max(flagsDe()[39] ? gopc('gradPos') : 0, redActiva() ? gopc('redPos') : 0), prof = gopc('gradProf');
  let usarSF = !!gopc('gradSF');
  const partidas = juegos.filter(j => j.estado === 'fin' && j.jugadas && j.jugadas.length > 12).map(j => ({ fen: j.fen, jug: j.jugadas, res: j.res }))
    .concat(fase ? fase.hechos.map(x => ({ fen: x.fen0, jug: x.jugadas, res: x.yoB ? x.res : 1 - x.res })) : []);
  if (!partidas.length) return;
  const porPartida = Math.max(1, Math.ceil(cuantas / partidas.length)), cand = [];
  for (const p of partidas) {
    const pos = new M.Pos(p.fen), aqui = [];
    for (let k = 0; k < p.jug.length; k++) {
      const m = M.parseUci(pos, p.jug[k]); if (!m) break; pos.make(m);
      if (k >= 8 && !M.fin(pos) && M.tranquila(pos)) aqui.push({ fen: pos.fen(), res: p.res });
    }
    for (let k = 0; k < porPartida && aqui.length; k++) cand.push(aqui.splice(Math.floor(rng() * aqui.length), 1)[0]);
  }
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  const lista = cand.slice(0, cuantas), nuevas = [];
  if (usarSF) { try { await sfIniciar(); } catch (e) { sfFallo = (e && e.message) || 'no carga'; } if (sfFallo || !sf.listo) usarSF = false; }
  if (usarSF) { sf.w.postMessage('ucinewgame'); sf.w.postMessage('setoption name Skill Level value 20'); await sfCmd('isready', /^readyok/); }
  for (let k = 0; k < lista.length; k++) {
    const c = lista[k];
    if (usarSF && entrenando) {
      gradVista = `gradiente: Stockfish etiqueta ${k + 1} de ${lista.length}`; if (k % 10 === 0) pintarEstado();
      sf.w.postMessage('position fen ' + c.fen);
      let ls = null, sc = null; try { ls = await sfCmd('go depth ' + prof, /^bestmove/, 20000); sc = puntuacion(ls); } catch (e) { usarSF = false; }
      const mejor = ls && ls.length ? (ls[ls.length - 1].split(/\s+/)[1] || '') : '';   // la mejor jugada de Stockfish: el objetivo de la política (40)
      if (sc != null) { const blancas = / w /.test(c.fen) ? sc : -sc, cp = Math.max(-1500, Math.min(1500, blancas)); nuevas.push([c.fen, Math.round(1e6 / (1 + Math.exp(-M.K_TEXEL * cp))) / 1e6, 's', mejor === '(none)' ? '' : mejor]); continue; }
    }
    nuevas.push([c.fen, c.res, 'r']);   // sin Stockfish (o en pausa): el resultado de la partida
  }
  if (flagsDe()[39]) grad.pos = grad.pos.concat(nuevas.map(x => x.slice(0, 3))).slice(-gopc('gradMax'));
  if (redActiva()) redDatos.pos = redDatos.pos.concat(nuevas).slice(-gopc('redMax'));
  grad.ultima = { gen: est.gen, nuevas: nuevas.length, sf: nuevas.filter(x => x[2] === 's').length, prof };
}
function datosGradiente() {
  const vivas = new Set(), datos = [];
  for (const [fen, y] of grad.pos) {
    vivas.add(fen);
    let r = gradCache.get(fen);
    if (!r) { try { r = M.rasgosPos(new M.Pos(fen)); } catch (e) { continue; } gradCache.set(fen, r); }
    datos.push({ i: r.i, v: r.v, fi: r.fi, fv: r.fv, y });
  }
  for (const k of gradCache.keys()) if (!vivas.has(k)) gradCache.delete(k);
  return datos;
}
function afinarHijas(nueva, elite, F) {
  if (grad.pos.length < 200) return { posiciones: grad.pos.length, nota: 'aún pocas posiciones (hacen falta 200)' };
  const datos = datosGradiente(); let n = 0, antes = 0, despues = 0, deshechos = 0; const t0 = Date.now();
  for (const h of nueva) {
    if (elite.has(h.id)) continue;
    const r = M.ajustarGradiente(h.genes, datos, null, rng, F); if (!r) continue;
    n++; antes += r.antes; despues += r.despues; if (r.deshecho) deshechos++;
    h.mut = Object.assign({}, h.mut, { grad: { antes: Math.round(r.antes * 1e6) / 1e6, despues: Math.round(r.despues * 1e6) / 1e6, cambio: r.cambio, deshecho: !!r.deshecho } });
  }
  return n ? { posiciones: datos.length, hijas: n, antes: Math.round(antes / n * 1e6) / 1e6, despues: Math.round(despues / n * 1e6) / 1e6, deshechos, ms: Date.now() - t0, etiquetas: grad.ultima || null } : null;
}
/* Búsqueda de novedad (37): premia jugar distinto. Descriptor = estilo + duración de sus partidas; novedad = distancia media a las 5 más parecidas (población y archivo) */
function novedad() {
  const peso = est.opc && est.opc.novPeso != null ? est.opc.novPeso : 0.15;
  const desc = p => M.estilo(p.genes).map(x => x.v).concat([(p.nJ ? p.plyT / p.nJ : limite() / 2) / limite()]);
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
  { id: 'li-primera', texto: 'Mi primera partida en Lichess', ok: () => false },
  { id: 'li-gana', texto: 'Gano una partida en Lichess', ok: () => false },
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
  avisarApp({ tipo: 'hito', texto: h.texto }); avisarProgreso('Hito: ' + h.texto, true);
}
function darHito(id) { const h = HITOS.find(x => x.id === id); if (!h || est.hitos[id]) return; est.hitos[id] = { fecha: new Date().toISOString(), gen: est.gen }; guardarEstado().catch(() => {}); anunciarHito(h); pintarEstado(); }

/* ───── Mantener la pantalla encendida mientras entrena ───── */
let candado = null;
async function pedirCandado() { try { if (navigator.wakeLock && entrenando) candado = await navigator.wakeLock.request('screen'); } catch (e) { candado = null; } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pedirCandado(); });
/* ───── Segundo plano: seguir jugando con la pantalla bloqueada y avisar de cómo va ───── */
let silencio = null;
function audioSilencio(on) {   // en la app de iPhone, un audio silencioso mantiene viva la sala (modo de fondo «audio»)
  if (!IOS_APP()) return;
  try {
    if (!silencio) {
      const n = 8000, b = new Uint8Array(44 + n), dv = new DataView(b.buffer), txt = (o, t) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
      txt(0, 'RIFF'); dv.setUint32(4, 36 + n, true); txt(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); txt(36, 'data'); dv.setUint32(40, n, true); b.fill(128, 44);
      silencio = new Audio(URL.createObjectURL(new Blob([b], { type: 'audio/wav' }))); silencio.loop = true; silencio.setAttribute('playsinline', '');
    }
    if (on) silencio.play().catch(() => {}); else silencio.pause();
  } catch (e) {}
}
function avisarProgreso(texto, hito) {
  if (IOS_APP()) { avisarApp({ tipo: 'progreso', texto, hito: !!hito }); return; }
  const aa = ANDROID(); if (aa && typeof aa.progreso === 'function') { try { aa.progreso(texto); } catch (e) {} return; }
  try { if (document.hidden && window.Notification && Notification.permission === 'granted') new Notification(hito ? 'Araña · ¡hito de ajedrez!' : 'Araña · ajedrez', { body: texto, tag: hito ? undefined : 'ajedrez' }); } catch (e) {}
}
function segundoPlano(on) {
  audioSilencio(on);
  if (IOS_APP()) avisarApp({ tipo: 'entreno', on: !!on });
  const aa = ANDROID(); if (aa && typeof aa.entreno === 'function') { try { aa.entreno(!!on); } catch (e) {} }
  else if (on && !IOS_APP() && window.Notification && Notification.permission === 'default' && !/iphone|ipad/i.test(navigator.userAgent)) { try { Notification.requestPermission().catch(() => {}); } catch (e) {} }
}
function entrenar(si) {
  entrenando = si; segundoPlano(si);
  if (ORIGEN === 'linux') try { localStorage.setItem('arana.ajedrez.servidor.entrena', si ? '1' : '0'); } catch (e) {}   // el servidor recuerda si estaba entrenando al reiniciar
  $('#go').textContent = si ? '⏸ Pausar' : '▶ Entrenar';
  const aa = ANDROID(); if (aa && typeof aa.pantalla === 'function') { try { aa.pantalla(!!si); } catch (e) {} }
  if (si) { pedirCandado(); if (sfFase) faseStockfish(); else { if (!juegos.length) prepararGeneracion(); repartir(); } }
  else if (candado) { candado.release().catch(() => {}); candado = null; }
  if (si && redActiva()) bucleAuto();   // la gráfica trabaja a la vez que el torneo
  pintarEstado();
}

/* ═════════ Stockfish y la escalera ═════════
   Tras cada torneo, las mejores juegan contra Stockfish (blancas y negras, misma apertura) en el peldaño actual.
   Premio por partida: aguante (hasta 0,5), calidad según Stockfish (0–1) y resultado (tablas 6, victoria 12; desde la 0.36.0,
   lo pidió Juan: el resultado manda mucho más que durar).
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
  return new Promise(ok => { const id = 'p' + (++sigPens); pens.set(id, ok); hilos[0].postMessage({ t: 'pensar', id, ind: { id: p.id, genes: p.genes }, fen0, jugadas, ms: msJugada(), prof: opc.prof, flags: flagsDe(), aj }); });
}
async function partidaSF(ind, yoB, fen0, E) {
  sf.w.postMessage('ucinewgame'); sf.w.postMessage('setoption name Skill Level value ' + E.skill); await sfCmd('isready', /^readyok/);
  const pos = new M.Pos(fen0), jug = [], cal = [], aj = ajusteContra(ind, 'sf' + E.n, 'sf'); let f = null, malas = 0, buenas = 0, evYo = 0, evSF = null;
  sfVista = { fen: pos.fen(), ultima: null, ind, yoB, evYo, evSF, E, jug, fen0 }; marcarSF();
  while (true) {
    if (!entrenando) return null;
    f = M.fin(pos); if (f) break;
    if (opc.maxPlies && jug.length >= opc.maxPlies) { const e = evSF == null ? 0 : evSF; f = { res: e > 300 ? (yoB ? 1 : 0) : e < -300 ? (yoB ? 0 : 1) : .5, motivo: 'límite de jugadas' }; break; }
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
    p.sfb = (p.sfb || 0) + Math.min(.5, r.plies / 200) + r.calidad + (r.res === 1 ? 12 : r.res === .5 ? 6 : 0);
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
  z.querySelector('.esc').innerHTML = escaleraSVG(500, 70);
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
  if (nivel !== 'lejos') tablero(z.querySelector('canvas'), v ? v.fen : M.INICIO, v ? v.ultima : null, true, v ? (v.yoB ? 'b' : 'w') : 'b', { base: Math.max(.6, esc0) * 500 / 240, coords: true });
}

/* ═════════ El plano ═════════ */
const CW = 260, CH = 360, GAP = 24, PAD = 30, COLS = 4;
let W0 = 0, H0 = 0, esc0 = 1, nivel = '', mesas = [];
const plano = $('#plano'), tam = $('#tam'), lienzo = $('#lienzo');
const CARD_W = () => (W0 - PAD * 2 - GAP) / 2, CARD_H = 760, CLA_H = 330;
let yMesas = 0, claSucio = true, finSucio = true;
function construirPlano() {
  const n = Math.max(1, Math.floor(pop.length / 2)), filas = Math.ceil(n / COLS);
  W0 = PAD * 2 + COLS * CW + (COLS - 1) * GAP;
  const cw = CARD_W(), yCla = PAD + CARD_H + GAP; yMesas = yCla + CLA_H + 70;
  const yZ = yMesas + filas * CH + (filas - 1) * GAP + 40;
  H0 = yZ + 330 + PAD + 60;
  // Arriba, en el centro y grandes: la final (o la mesa 1 mientras dura el suizo) y Stockfish
  let h = `<div class="zona grande" id="zfin" style="left:${PAD}px;top:${PAD}px;width:${cw}px;height:${CARD_H}px"><h3>Mesa 1</h3>
      <canvas width="240" height="240" aria-label="La partida de las mejores (tóquela para verla con sus jugadas)"></canvas>
      <div class="mar"><button class="pl" data-w></button><b class="tan"></b><button class="pl" data-b></button></div><div class="iv"></div></div>
    <div class="zona grande zsf" id="zsf" style="left:${PAD + cw + GAP}px;top:${PAD}px;width:${cw}px;height:${CARD_H}px"><h3>Escalera de Stockfish</h3>
      <canvas width="240" height="240" aria-label="Partida contra Stockfish (tóquela para verla con sus jugadas)"></canvas><div class="sfi"></div><div class="esc"></div></div>
    <div class="zona" id="zcla" style="left:${PAD}px;top:${yCla}px;width:${W0 - PAD * 2}px;height:${CLA_H}px"><h3>Clasificación</h3><div class="cla"></div></div>
    <div class="rot" id="rot" style="left:${PAD}px;top:${yMesas - 52}px;width:${W0 - PAD * 2}px"></div>`;
  for (let m = 0; m < n; m++) {
    const x = PAD + (m % COLS) * (CW + GAP), y = yMesas + Math.floor(m / COLS) * (CH + GAP);
    h += `<div class="mesa" id="m${m}" data-mesa="${m}" style="left:${x}px;top:${y}px">
      <button class="pl" data-b></button><canvas width="240" height="240" aria-label="Tablero de la mesa ${m + 1}"></canvas><button class="pl" data-w></button>
      <div class="info"><div class="ev"><b style="width:50%"></b></div><div class="evt"></div><div class="chips"></div></div>
      <div class="res"></div>
      <div class="lejos" aria-hidden="true"><div class="o">${m + 1}</div><div class="t">MESA ${m + 1}</div></div></div>`;
  }
  h += `<div class="zona zcz" id="zcz" style="left:${PAD}px;top:${yZ}px;width:${W0 - PAD * 2}px;height:330px"><h3>Rincón de las cazadoras</h3>
      <canvas width="240" height="240" aria-label="Partida de una cazadora"></canvas><div class="czi"></div><div class="czl"></div></div>`;
  lienzo.innerHTML = h; lienzo.style.width = W0 + 'px'; lienzo.style.height = H0 + 'px';
  mesas = Array.from(lienzo.querySelectorAll('.mesa')); sfSucio = true; cazaSucio = true; claSucio = true; finSucio = true;
  if (!esc0 || !nivel) verTodo(); else aplicarEscala(esc0, true);
  marcar();
}
/* Marcador de una pareja (ida y vuelta): puntos de cada una y texto «Ida 1-0 · Vuelta ½-½» */
function marcadorPareja(js, idA) {
  let pa = 0, pb = 0; const t = js.map((x, k) => { const nom = x.desempate ? 'Desempate' : x.ida ? 'Ida' : 'Vuelta'; if (x.estado === 'fin') { const ra = x.w === idA ? x.res : 1 - x.res; pa += ra; pb += 1 - ra; return `${nom} ${resTxt(x.res)}`; } return `${nom} ${x.estado === 'juega' ? '▶ jugando' : '—'}`; });
  return { pa, pb, texto: t.join(' · ') };
}
const pts = v => v === 0 ? '0' : v % 1 ? (v > 1 ? Math.floor(v) + '½' : '½') : String(v);
function pintarFinal() {
  finSucio = false;
  const z = document.getElementById('zfin'); if (!z || !torneo) return;
  const fn = juegos.filter(x => x.fase === 'final'), enFinal = fn.length > 0, js = enFinal ? fn : juegosDeMesa(0);
  const j = js.find(x => x.estado === 'juega') || js.slice().reverse().find(x => x.estado === 'fin') || js[0]; if (!j) return;
  const ida = js[0], A = ind(ida.w), B = ind(ida.b); if (!A || !B) return;
  const m = marcadorPareja(js, A.id), camp = torneo.campeona && ind(torneo.campeona);
  z.classList.toggle('final', enFinal);
  z.querySelector('h3').textContent = camp ? `¡Campeona: ${camp.nombre}!` : enFinal ? 'Final del torneo' : `Mesa 1 · ronda ${torneo.ronda + 1} de ${torneo.R} · las líderes`;
  const bw = z.querySelector('[data-w]'), bb = z.querySelector('[data-b]'); bw.dataset.id = A.id; bb.dataset.id = B.id;
  bw.innerHTML = `<span>${esc(A.nombre)}</span><i>${Math.round(A.elo)}</i>`; bb.innerHTML = `<span>${esc(B.nombre)}</span><i>${Math.round(B.elo)}</i>`;
  z.querySelector('.tan').textContent = `${pts(m.pa)} – ${pts(m.pb)}`;
  z.querySelector('.iv').textContent = m.texto;
  z._juego = j;
  if (nivel !== 'lejos') tablero(z.querySelector('canvas'), j.fenAhora, j.ultima, true, null, { base: Math.max(.6, esc0) * 500 / 240, coords: true });
}
function pintarCla() {
  claSucio = false;
  const z = document.getElementById('zcla'); if (!z || !torneo) return;
  const cl = clasif(), fin = torneo.final ? [torneo.final.a, torneo.final.b] : [];
  z.querySelector('h3').textContent = `Clasificación · ${torneo.fase === 'suizo' ? `ronda ${torneo.ronda + 1} de ${torneo.R}` : torneo.fase === 'final' ? 'final en juego' : 'torneo terminado'}`;
  const fila = (x, k) => `<button class="cf${fin.includes(x.p.id) ? ' fi' : ''}${x.p.id === torneo.campeona ? ' ca' : ''}" data-id="${esc(x.p.id)}"><i>${k + 1}</i><span>${esc(x.p.nombre)}</span><b>${pts(x.tor)}</b><em>${fmt(x.bh, 1)}</em><em>${Math.round(x.elo)}</em></button>`;
  const cab = '<div class="cf ca0"><i>#</i><span>Araña</span><b>Pts</b><em title="Buchholz: suma de los puntos de sus rivales; desempata">Bh</em><em>Elo</em></div>', mitad = Math.ceil(cl.length / 2);
  z.querySelector('.cla').innerHTML = `<div>${cab}${cl.slice(0, mitad).map(fila).join('')}</div><div>${cab}${cl.slice(mitad).map((x, k) => fila(x, k + mitad)).join('')}</div>`;
  const r = document.getElementById('rot'); if (r) r.textContent = `Ronda ${Math.min(torneo.ronda, torneo.R - 1) + 1} de ${torneo.R} · mesa 1 = las dos primeras de la clasificación · Bh (Buchholz) = puntos de sus rivales, desempata`;
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
function acercarZona(z) {
  const s = Math.min(ESC_MAX, Math.max(.6, (plano.clientWidth - 24) / parseFloat(z.style.width)));
  aplicarEscala(s, true); plano.scrollLeft = parseFloat(z.style.left) * esc0 - 12; plano.scrollTop = parseFloat(z.style.top) * esc0 - 12;
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
  const v = Object.assign({ fen0: M.INICIO, ucis: [], idx: null, girar: false, info: {}, var: null, sel: -1 }, o);
  if (v.idx == null) v.idx = v.ucis.length;
  hoja(`<h3>${esc(v.titulo || 'Partida')}</h3><div class="sub" id="vSub">${esc(v.sub || '')}</div>
    <div class="ana" id="vAna"></div>
    <canvas id="vCv" class="tabg" width="240" height="240" aria-label="Tablero: toque una pieza y su casilla para probar sus propias jugadas" style="touch-action:manipulation"></canvas>
    <div class="rep"><button id="v0" aria-label="Al principio">⏮</button><button id="v1" aria-label="Jugada anterior">◀</button><button id="v2" aria-label="Jugada siguiente">▶</button><button id="v3" aria-label="Al final">⏭</button><button id="vG" aria-label="Girar el tablero">⇅</button></div>
    <div class="jugadas" id="vLista"></div>
    <div id="vVar"></div>
    <div class="ctrl" style="margin-top:12px"><button class="btn sec" id="vSF" aria-pressed="${!!opc.ana}">Análisis de Stockfish</button><button class="btn sec" id="vPgn">Copiar PGN</button><button class="btn sec" data-cerrar>Cerrar</button></div>
    <p class="nota">Mueva usted las piezas para probar sus ideas: se abre una variante y Stockfish la analiza. La partida no cambia.</p>`);
  visor = v;
  const ir = n => { const V = visor.var; if (V) V.idx = Math.max(0, Math.min(V.ucis.length, n)); else visor.idx = Math.max(0, Math.min(visor.ucis.length, n)); visor.sel = -1; pintarVisor(); };
  const cur = () => visor.var ? visor.var.idx : visor.idx, fin = () => visor.var ? visor.var.ucis.length : visor.ucis.length;
  $('#v0').onclick = () => ir(0); $('#v1').onclick = () => ir(cur() - 1); $('#v2').onclick = () => ir(cur() + 1); $('#v3').onclick = () => ir(fin());
  $('#vG').onclick = () => { visor.girar = !visor.girar; pintarVisor(); };
  $('#vSF').onclick = () => { opc.ana = opc.ana ? 0 : 1; guardarOpc(); $('#vSF').setAttribute('aria-pressed', String(!!opc.ana)); if (!opc.ana) anaParar(); pintarVisor(); };
  $('#vPgn').onclick = () => copiar(M.pgn(visor.fen0, visor.ucis, visor.info), $('#vPgn'));
  $('#vLista').onclick = e => { const b = e.target.closest('[data-i]'); if (b) { visor.var = null; visor.idx = +b.dataset.i; visor.sel = -1; pintarVisor(); } };
  $('#vVar').onclick = e => { const b = e.target.closest('[data-vi]'); if (b) ir(+b.dataset.vi); if (e.target.closest('#vVolver')) { visor.var = null; visor.sel = -1; pintarVisor(); } };
  $('#vCv').addEventListener('click', toqueVisor);
  pintarVisor();
}
function posEn(fen0, ucis, n) { const pos = new M.Pos(fen0); for (let i = 0; i < n; i++) { const m = M.parseUci(pos, ucis[i]); if (!m) break; pos.make(m); } return pos; }
const lineaVisor = () => visor.var ? visor.ucis.slice(0, visor.var.desde).concat(visor.var.ucis.slice(0, visor.var.idx)) : visor.ucis.slice(0, visor.idx);
/* Casilla tocada en un tablero (0x88), según esté girado */
function casillaToque(e, girar) {
  const r = e.currentTarget.getBoundingClientRect(), q = (r.width || 320) / 8;
  let c = Math.floor((e.clientX - r.left) / q), f = 7 - Math.floor((e.clientY - r.top) / q); if (girar) { c = 7 - c; f = 7 - f; }
  return c < 0 || c > 7 || f < 0 || f > 7 ? -1 : c + f * 16;
}
/* Si una jugada corona, pregunta en qué pieza; si no, la hace directamente */
function conCoronacion(ms, blancas, hacer) {
  if (ms.length === 1) return hacer(ms[0]);
  const caja = document.createElement('div'); caja.className = 'corona'; caja.setAttribute('role', 'dialog'); caja.setAttribute('aria-label', 'Coronar en');
  caja.innerHTML = '<p>¿En qué pieza corona?</p>' + [[5, 'Q', 'Dama'], [4, 'R', 'Torre'], [3, 'B', 'Alfil'], [2, 'N', 'Caballo']].map(([t, l, n]) => { const im = IMG[(blancas ? 'w' : 'b') + l]; return `<button data-t="${t}" aria-label="${n}">${im && im.src ? `<img src="${im.src}" alt="">` : l}<span>${n}</span></button>`; }).join('');
  caja.onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; caja.remove(); const m = ms.find(x => (x >> 14 & 7) === +b.dataset.t); if (m) hacer(m); };
  $('#hojac').appendChild(caja); const b = caja.querySelector('button'); if (b) b.focus();
}
function toqueVisor(e) {
  if (!visor) return;
  const sq = casillaToque(e, visor.girar); if (sq < 0) return;
  const pos = posEn(visor.fen0, lineaVisor(), lineaVisor().length), mia = pos.b[sq] && (pos.b[sq] >> 3) === pos.side;
  if (visor.sel < 0 || mia) { visor.sel = mia ? sq : -1; return pintarVisor(); }
  const ms = M.legal(pos).filter(m => M.mFrom(m) === visor.sel && M.mTo(m) === sq);
  visor.sel = -1; if (!ms.length) return pintarVisor();
  conCoronacion(ms, pos.side === 0, m => {
    const u = M.uci(m);
    if (!visor.var && visor.ucis[visor.idx] === u) { visor.idx++; return pintarVisor(); }   // es la jugada de la partida: solo avanza
    if (!visor.var) visor.var = { desde: visor.idx, ucis: [], idx: 0 };
    const V = visor.var; V.ucis = V.ucis.slice(0, V.idx); V.ucis.push(u); V.idx++;
    pintarVisor();
  });
}
function pintarVisor() {
  if (!visor || !$('#vCv')) return;
  const linea = lineaVisor(), pos = posEn(visor.fen0, linea, linea.length), fen = pos.fen();
  const dest = visor.sel >= 0 ? M.legal(pos).filter(m => M.mFrom(m) === visor.sel).map(M.mTo) : null;
  tablero($('#vCv'), fen, null, false, null, { coords: true, girar: visor.girar, base: 1.6, sel: visor.sel, destinos: dest });
  const L = $('#vLista'); L.innerHTML = listaHTML(visor.fen0, visor.ucis, visor.var ? -1 : visor.idx);
  const cur = L.querySelector('.cur'); if (cur) L.scrollTop = Math.max(0, cur.offsetTop - L.clientHeight / 2);   // sin mover la hoja entera
  const V = visor.var;
  $('#vVar').innerHTML = V ? `<div class="var"><b>Su variante</b> desde ${V.desde ? 'la jugada ' + Math.ceil(V.desde / 2) : 'el principio'}: ${listaHTML(posEn(visor.fen0, visor.ucis, V.desde).fen(), V.ucis, V.idx).replace(/data-i=/g, 'data-vi=')} <button class="btn sec" id="vVolver" style="min-height:32px;padding:3px 10px;margin-left:6px">Volver a la partida</button></div>` : '';
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
  { const el = ana.destino && $(ana.destino); if (el) el.querySelectorAll('.linea span:last-child').forEach(x => { x.style.opacity = '.45'; }); }
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
  const fen = ana.fen; if (!fen) return;
  const p = new M.Pos(fen), f = M.fin(p), negras = p.side === 1;
  // Siempre la misma estructura y altura (barra, dos líneas y la nota), para que la pantalla no salte
  let pct = ana.pct == null ? 50 : ana.pct, txt = '…', l1 = ['…', 'Stockfish está pensando…'], l2 = ['', ''], nota = 'Stockfish 19';
  if (f) { pct = f.res === 1 ? 100 : f.res === 0 ? 0 : 50; txt = f.motivo === 'mate' ? 'Mate' : 'Tablas'; l1 = [txt, f.motivo === 'mate' ? 'Jaque mate' : 'Tablas (' + f.motivo + ')']; }
  else {
    const val = x => { const cp = x.cp == null ? null : negras ? -x.cp : x.cp, mt = x.mate == null ? null : negras ? -x.mate : x.mate; return { txt: mt != null ? (mt > 0 ? '#' : '#-') + Math.abs(mt) : (cp > 0 ? '+' : '') + fmt(cp / 100, 2), pct: mt != null ? (mt > 0 ? 100 : 0) : 100 / (1 + Math.pow(10, -cp / 400)) }; };
    const ls = ana.lineas.filter(Boolean);
    if (ls.length) {
      if (el.querySelector('.linea')) el.querySelectorAll('.linea span:last-child').forEach(x => { x.style.opacity = ''; });
      const v0 = val(ls[0]); pct = v0.pct; txt = v0.txt; l1 = [v0.txt, lineaSAN(fen, ls[0].pv.slice(0, 10))];
      if (ls[1]) { const v1 = val(ls[1]); l2 = [v1.txt, lineaSAN(fen, ls[1].pv.slice(0, 10))]; }
      nota = `Stockfish 19 · profundidad ${ls[0].depth}${ana.corriendo ? '…' : ''}`; ana.pct = pct;
    }
  }
  if (!el.querySelector('.evbar')) el.innerHTML = '<div class="evbar"><b></b><span></span></div><div class="linea"><span class="ev"></span><span></span></div><div class="linea"><span class="ev"></span><span></span></div><p class="nota anan"></p>';
  el.querySelector('.evbar b').style.width = pct.toFixed(1) + '%'; el.querySelector('.evbar span').textContent = txt;
  const [a, b] = el.querySelectorAll('.linea');
  a.children[0].textContent = l1[0]; a.children[1].textContent = l1[1]; a.children[0].style.visibility = l1[0] ? '' : 'hidden';
  b.children[0].textContent = l2[0]; b.children[1].textContent = l2[1]; b.children[0].style.visibility = l2[0] ? '' : 'hidden';
  el.querySelector('.anan').textContent = nota;
}
function lineaSAN(fen, pv) {
  const ss = M.sanLista(fen, pv), p0 = new M.Pos(fen); let n = p0.full, t = '';
  ss.forEach((x, k) => { const bl = (p0.side === 0) === (k % 2 === 0); if (bl) t += n + '. '; else if (k === 0) t += n + '… '; t += x + ' '; if (!bl) n++; });
  return t.trim();
}
let sucio = new Set(), pedido = false, redibujarSF = false;
function marcar(j) { if (j && j.tipo === 'caza') { cazaVista = j; cazaSucio = true; return pedir(); } if (j && j.fase === 'final') { finSucio = true; return pedir(); } if (j) sucio.add(j.mesa); else { mesas.forEach((_, m) => sucio.add(m)); cazaSucio = true; claSucio = true; finSucio = true; } pedir(); }
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
  if (finSucio || claSucio || redibujarSF || sucio.has(0)) { pintarFinal(); pintarCla(); }
  redibujarSF = false;
  sucio.clear(); pintarEstado();
}
function juegosDeMesa(m) { return juegos.filter(j => j.ronda === ronda && j.mesa === m && j.fase === 'suizo'); }
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
  const ida = js[0], mk = marcadorPareja(js, ida.w), ptsDe = id => id === ida.w ? mk.pa : mk.pb;
  bw.innerHTML = `<span>○ ${esc(a.nombre)}</span><b>${pts(ptsDe(a.id))}</b>`;
  bb.innerHTML = `<span>● ${esc(b.nombre)}</span><b>${pts(ptsDe(b.id))}</b>`;
  el.querySelector('.res').textContent = mk.texto;
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
  const cf = e.target.closest('.cf[data-id]'); if (cf && nivel !== 'lejos') return ficha(cf.dataset.id);
  if (z) { if (nivel !== 'lejos' && e.target.tagName === 'CANVAS') { if (z.id === 'zsf') verSF(); else if (z.id === 'zcz' && cazaVista) verJuego(cazaVista); else if (z.id === 'zfin' && z._juego) verJuego(z._juego); } else if (nivel === 'lejos' && (z.id === 'zfin' || z.id === 'zsf')) acercarZona(z); return; }
  const me = e.target.closest('.mesa'); if (!me) return;
  if (nivel !== 'cerca') return acercarMesa(+me.dataset.mesa);
  if (e.target.tagName === 'CANVAS') { const js = juegosDeMesa(+me.dataset.mesa), j = js.find(x => x.estado === 'juega') || js.slice().reverse().find(x => x.estado === 'fin'); if (j) verJuego(j); }
});
const resTxt = r => r === 1 ? '1-0' : r === 0 ? '0-1' : r === .5 ? '½-½' : '*';
function verJuego(j) {
  const a = ind(j.w), b = ind(j.b); if (!a || !b) return;
  verPartida({ titulo: `${a.nombre} – ${b.nombre}`, fen0: j.fen, ucis: (j.lista || j.jugadas || []).slice(), fuente: () => j.lista || j.jugadas,
    info: { blancas: a.nombre, negras: b.nombre, resultado: resTxt(j.res), evento: 'Araña · generación ' + est.gen },
    estado: () => (j.tipo === 'caza' ? 'Cazadora contra la élite · ' : j.fase === 'final' ? `Generación ${est.gen} · final${j.desempate ? ' · desempate' : j.ida ? ' · ida' : ' · vuelta'} · ` : `Generación ${est.gen} · ronda ${j.ronda + 1} · mesa ${+j.mesa + 1} · ${j.ida ? 'ida' : 'vuelta'} · `) + (j.estado === 'fin' ? `${resTxt(j.res)} (${j.motivo})` : j.estado === 'juega' ? (opc.directo ? 'en directo' : 'jugando (active «Directo» para verla en vivo)') : 'en espera') });
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
function avance() {   // parte hecha de la generación: rondas, final y escalera de Stockfish
  if (sfFase) return .85 + .15 * sfFase.hechos.length / Math.max(1, sfFase.total);
  if (!torneo) return 0;
  const R = torneo.R + (opc.final ? 1 : 0), dentro = juegos.filter(j => j.fase === torneo.fase && (j.fase !== 'suizo' || j.ronda === torneo.ronda)), h = dentro.filter(j => j.estado === 'fin').length;
  const r = torneo.fase === 'suizo' ? torneo.ronda : torneo.fase === 'final' ? torneo.R : R;
  return Math.min(1, (r + (dentro.length ? h / dentro.length : 1)) / R) * .85;
}
function pintarEstado() {
  if (!est) return;
  const hechas = juegos.filter(j => j.estado === 'fin').length, total = juegos.length;
  const ult = historial[historial.length - 1];
  $('#estado').innerHTML = `<b>Generación ${est.gen}</b> · ${entrenando ? 'entrenando' : 'en pausa'}` +
    (gradVista ? ` · ${esc(gradVista)}` : sfFase ? ` · escalera ${sfFase.hechos.length}/${sfFase.total}` : torneo && total ? ` · ${torneo.fase === 'final' ? 'final' : torneo.fase === 'hecho' ? 'cazadoras' : `ronda ${torneo.ronda + 1}/${torneo.R}`} · ${hechas}/${total}` : '') +
    (ult ? ` · campeona <b>${esc(ult.mejor.nombre)}</b> (Elo ${ult.mejor.elo})` : ` · ${hilosActivos()} hilos`) +
    (li.conectado ? ` · <b>Lichess</b> ${[...li.partidas.values()].filter(g => !g.fin).length ? 'jugando' : 'esperando'}` : '') +
    `<i class="prog" style="width:${(avance() * 100).toFixed(1)}%"></i>`;
  const nh = Object.keys(est.hitos || {}).length, bh = document.querySelector('[data-aux=hitos]');
  if (bh) bh.innerHTML = 'Hitos' + (nh ? ` <b>${nh}</b>` : '');
}

/* ═════════ La hoja ═════════ */
function hoja(html) { visor = null; anaParar(); $('#hojac').innerHTML = html; $('#hoja').classList.add('on'); $('#hojac').scrollTop = 0; const b = $('#hojac button'); if (b) b.focus({ preventScroll: true }); }
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
  const nacio = mut.nacio ? mut.nacio : `cruce (${mut.cruce ? mut.cruce.a + ' bloques de un padre, ' + mut.cruce.b + ' del otro' : '—'}), ${mut.total || 0} genes mutados con σ ${fmt(mut.sigma || 0, 3)}` + (mut.grad ? (mut.grad.deshecho ? ' · el gradiente no la mejoró y la dejó igual' : ` · gradiente: error ${fmt(mut.grad.antes * 1000, 2)} → ${fmt(mut.grad.despues * 1000, 2)} (‰)`) : '');
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
  lichess() { return lichess(); },
  registro() { return registro(); },
  grafica() {
    if (historial.length < 2) return hoja('<h3>Gráfica</h3><p class="nota">Hacen falta al menos dos generaciones terminadas.</p>' + CERRAR);
    const g = historial.slice(-200), W = 340, H = 150, eje = (vals, cs) => {
      const all = vals.flat().filter(Number.isFinite), mn = Math.min(...all), mx = Math.max(...all), d = mx - mn || 1, n = vals[0].length - 1 || 1;
      let s = `<svg viewBox="0 0 ${W} ${H + 22}" width="100%" role="img" aria-label="Gráfica">`;
      for (let i = 0; i <= 2; i++) { const y = 8 + i * (H - 16) / 2, v = mx - i * d / 2; s += `<line x1="34" x2="${W}" y1="${y}" y2="${y}" stroke="rgba(94,232,255,.12)"/><text x="30" y="${y}" text-anchor="end" dominant-baseline="middle" fill="rgba(235,235,245,.55)" style="font:10px ui-monospace,Menlo,monospace">${Math.abs(v) >= 10 ? Math.round(v) : fmt(v, 2)}</text>`; }
      vals.forEach((vs, k) => { s += `<polyline fill="none" stroke="${cs[k]}" stroke-width="2"${k ? ' stroke-dasharray="5 4"' : ''} points="${vs.map((v, i) => Number.isFinite(v) ? `${(34 + i / n * (W - 38)).toFixed(1)},${(8 + (mx - v) / d * (H - 16)).toFixed(1)}` : '').filter(Boolean).join(' ')}"/>`; });
      return s + `<text x="34" y="${H + 16}" fill="rgba(235,235,245,.55)" style="font:10px ui-monospace,Menlo,monospace">gen ${g[0].gen}</text><text x="${W}" y="${H + 16}" text-anchor="end" fill="rgba(235,235,245,.55)" style="font:10px ui-monospace,Menlo,monospace">gen ${g[g.length - 1].gen}</text></svg>`;
    };
    hoja(`<h3>Gráfica de la evolución</h3><div class="sub">${historial.length} generaciones</div>
      <h2>Elo</h2><div class="ley"><span><i style="background:#3dff99"></i>la mejor</span><span><i style="background:#5ee8ff"></i>la media (discontinua)</span></div>${eje([g.map(x => x.mejor.elo), g.map(x => x.mediaElo)], ['#3dff99', '#5ee8ff'])}
      <h2>Mutación (σ) y diversidad</h2><div class="ley"><span><i style="background:#ff4fa3"></i>σ</span><span><i style="background:#ffb340"></i>diversidad (discontinua)</span></div>${eje([g.map(x => x.sigma), g.map(x => x.diversidad)], ['#ff4fa3', '#ffb340'])}
      <h2>Detectores encendidos de media</h2>${eje([g.map(x => x.encendidos)], ['#a99bff'])}
      ${g.some(x => x.neuronas != null) ? `<h2>Neuronas de su red de media</h2>${eje([g.map(x => x.neuronas || 0)], ['#ff4fa3'])}` : ''}
      ${g.some(x => x.gradiente && x.gradiente.hijas) ? `<h2>Gradiente: error antes y después (‰)</h2><div class="ley"><span><i style="background:#ffb340"></i>antes</span><span><i style="background:#3dff99"></i>después (discontinua)</span></div>${eje([g.map(x => x.gradiente && x.gradiente.hijas ? x.gradiente.antes * 1000 : NaN), g.map(x => x.gradiente && x.gradiente.hijas ? x.gradiente.despues * 1000 : NaN)], ['#ffb340', '#3dff99'])}<p class="nota">Error cuadrático entre la probabilidad de ganar que ve la araña y la de Stockfish, en posiciones que no se usaron para ajustar. Si baja generación a generación, las arañas valoran cada vez más como Stockfish.</p>` : ''}
      ${g.some(x => x.red && x.red.despues) ? `<h2>Red en la gráfica: acierta la jugada de Stockfish (%)</h2>${eje([g.map(x => x.red && x.red.despues ? x.red.despues.acierto * 100 : NaN)], ['#3dff99'])}${g.some(x => x.red && x.red.juego && x.red.juego.elo) ? `<h2>Redes en la gráfica: Elo jugando</h2><div class="ley"><span><i style="background:#5ee8ff"></i>la mejor</span><span><i style="background:#a99bff"></i>la media (discontinua)</span></div>${eje([g.map(x => x.red && x.red.juego && x.red.juego.elo ? x.red.juego.elo : NaN), g.map(x => x.red && x.red.eloMedio ? x.red.eloMedio : NaN)], ['#5ee8ff', '#a99bff'])}` : ''}${g.some(x => x.auto && x.auto.partidas) ? `<h2>Autojuego en la gráfica: partidas por generación</h2>${eje([g.map(x => x.auto ? x.auto.partidas : NaN)], ['#3dff99'])}` : ''}<h2>Red en la gráfica: error del valor</h2>${eje([g.map(x => x.red && x.red.despues ? x.red.despues.valor : NaN)], ['#ffb340'])}<p class="nota">Medido en posiciones que la red no usa para aprender. Si el acierto sube y el error baja, aprende de verdad.</p>` : ''}
      <p class="nota">Si la diversidad cae mucho, entran inmigrantes. La mutación nunca baja de 0,03; si la campeona no cambia en 5 generaciones o el Elo no sube en 15, se sacude y vuelve a crecer.</p>` + CERRAR);
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
    const grupo = { '': 'Torneo', caza: 'Contra las cazadoras', sf: 'Contra Stockfish', red: 'La red en la gráfica' };
    let h = `<h3>Partidas</h3><select class="full" id="pGen" aria-label="Generación">${ps.slice(0, 300).map(x => `<option value="${x.gen}"${x === g ? ' selected' : ''}>Generación ${x.gen}${x.todas ? ` · ${x.todas.length} partidas` : ' · la mejor'}</option>`).join('')}</select>`;
    for (const t of ['sf', 'red', 'caza', '']) {
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
    h += ESCALERA.slice().reverse().map(E => { const c = con[E.n]; return `<div class="hito${c ? ' si' : ''}"><span class="m"${E.n === act && !c ? ' style="border-color:#5ee8ff"' : ''}></span><span>${E.n}. ${esc(E.nombre)}<small>${c ? `Conquistado en la generación ${c.gen} · ${fmt(c.puntos, 1)} de ${c.partidas} puntos · la mejor, ${esc(c.por)}` : E.n === act ? 'Peldaño actual' : 'Por llegar'} · Elo ≈ ${E.elo} · nivel ${E.skill}, ${E.go.replace('depth', 'profundidad').replace('movetime', 'tiempo')}${E.go.startsWith('movetime') ? ' ms' : ''}</small></span></div>`; }).join('');
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
  // Copias de antes de la 0.32.0: su Elo se pasa a la escala normal con sus propias generaciones
  let cImp = null;
  if (!(d.estado && d.estado.eloReal)) { const m = migrarElo(new Map(inds.map(p => [p.id, p])), (d.generaciones || []).slice().sort((a, b) => a.gen - b.gen)); cImp = p => { if (p.eloReal) return; const v = p.murio != null ? m.cDe(p.murio) : m.ult; p.elo = Math.round(p.elo + (v == null ? m.fallback(inds) : v)); (p.hist || []).forEach(h => { const w = m.cDe(h.gen); h.elo = Math.round(h.elo + (w == null ? m.fallback(inds) : w)); }); p.eloReal = 1; }; }
  for (const p0 of inds) {
    const p = JSON.parse(JSON.stringify(p0)); M.completar(p.genes);
    if (byId.has(p.id) || cazById.has(p.id)) continue;          // ya está viva aquí
    const ya = await leer('individuos', p.id);
    if (ya) continue;                                            // ya la tengo (de este aparato o importada antes)
    p.importada = { archivo: nombreArchivo, fecha, de: d.origen || p.origen }; if (cImp) cImp(p);
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
      <button class="btn sec" data-ac="lichess">Que juegue en Lichess</button>
      <button class="btn sec" data-ac="motor">Exportar como motor para el ordenador (UCI)</button>
      <button class="btn sec" data-ac="exportar">Exportar esta araña (copia)</button>
      <button class="btn sec" data-ac="ficha">Ver su ficha</button>
    </div>
    <p class="nota">Mezclar: entra en su población en lugar de la araña con menos Elo y se cruza con las suyas. Retomar: su población pasa a ser ella y 31 hijas suyas con mutaciones; la población de ahora queda guardada en la biblioteca.</p>` + CERRAR);
  $('#hojac').querySelectorAll('[data-ac]').forEach(b => b.onclick = async () => {
    const ac = b.dataset.ac;
    if (ac === 'ficha') return ficha(p.id);
    if (ac === 'jugar') return elegirColor(p);
    if (ac === 'duelo') return duelo(camp, p);
    if (ac === 'lichess') { liElegir(p); return lichess(); }
    if (ac === 'motor') return exportarMotor(p);
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
  c.nombre = src.nombre; c.elo = src.elo || ELO_INICIAL; c.eloReal = 1; if (src.rivales) c.rivales = JSON.parse(JSON.stringify(src.rivales));
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
  conCoronacion(ms, pos.side === 0, m => { jugarEn(m); if (!ph.fin) turnoArana(); });
}
function jugarEn(m) {
  const u = M.uci(m); ph.pos.make(m); ph.jug.push(u); ph.ultima = u;
  const f = M.fin(ph.pos); if (f) acabarHumana(f); else pintarHumana();
}
function turnoArana() {
  ph.piensa = true; pintarHumana();
  const id = 'h' + (++sigAparte), yo = ph;
  aparte.set(id, { fin: d => { if (ph !== yo || ph.fin) return; ph.piensa = false; const m = d.uci && M.parseUci(ph.pos, d.uci); if (!m) return acabarHumana({ res: .5, motivo: 'la araña no encuentra jugada' }); jugarEn(m); } });
  hiloAparte().postMessage({ t: 'pensar', id, ind: { id: yo.p.id, genes: yo.p.genes }, fen0: M.INICIO, jugadas: yo.jug.slice(), ms: Math.max(400, msJugada() * 10), prof: Math.max(8, opc.prof), flags: flagsDe(), aj: ajusteContra(yo.p, 'juan') });
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
      hiloAparte().postMessage({ t: 'partida', id, w: { id: w.id, genes: w.genes }, b: { id: n.id, genes: n.genes }, fen, opc: { ms: msJugada(), prof: opc.prof, maxPlies: opc.maxPlies }, directo: true, flags: flagsDe() });
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
    <h2>Rendimiento</h2>
    <label class="op">Cuánto trabaja el aparato ${sel('rend', [0, 1, 2], v => MODOS[v].n)}</label>
    <p class="nota" id="opRend">${esc(textoRend())}. Ahorro: un hilo y descansa tanto como juega. Equilibrado: la mitad de los núcleos y descansos cortos. Máximo: todos los hilos sin descanso. El nivel no cambia solo: lo elige usted.</p>
    <label class="op">Tiempo por jugada ${sel('ms', [0, 10, 30, 60, 120, 250, 500, 1000, 2000, 5000], v => v ? (v < 1000 ? v + ' ms' : v / 1000 + ' s') : `Automático (${msJugada()} ms)`)}</label>
    <label class="op">Profundidad máxima ${sel('prof', [2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 64], v => v === 64 ? 'Sin tope (manda el tiempo)' : v + ' jugadas')}</label>
    <h2>Torneo</h2>
    <label class="op">Partidas por araña ${sel('rondas', [2, 4, 6, 8], v => v * 2)}</label>
    <label class="op">Límite de jugadas ${sel('maxPlies', [120, 160, 240, 0], v => v ? v / 2 : 'Sin límite')}</label>
    <label class="op">Final entre las dos primeras ${sel('final', [1, 0], v => v ? 'Sí' : 'No')}</label>
    <label class="op">Escalera de Stockfish ${sel('sf', [1, 0], v => v ? 'Sí' : 'No')}</label>
    <label class="op">Arañas que suben a la escalera ${sel('sfTop', [2, 4, 8], v => v)}</label>
    <label class="op">Arañas por generación ${sel('poblacion', [16, 24, 32, 48, 64], v => v, est.opc)}</label>
    <label class="op">Probabilidad de mutar cada gen ${sel('pm', [0.03, 0.06, 0.12], v => Math.round(v * 100) + ' %', est.opc)}</label>
    ${typeof GPU !== 'undefined' && GPU.disponible() ? `<h2>Gráfica</h2>
    <p class="nota" id="gpuTxt">${esc(textoGPU())}</p>
    <div class="ctrl"><button class="btn sec" id="gpuProbar">Probar la gráfica</button></div>` : ''}
    ${ORIGEN === 'linux' ? `<h2>Red en la gráfica (40)</h2>
    <p class="nota">${esc(textoRed())}</p>${listaRedes()}
    <label class="op">Redes en la población ${sel('redPob', [1, 2, 4, 6], v => v, est.opc)}</label>
    <label class="op">Cambio de la peor por una hija de la mejor ${sel('redCada', [2, 3, 5, 10], v => 'cada ' + v + ' generaciones', est.opc)}</label>
    <label class="op">Tamaño de las redes nuevas ${sel('redTam', [0, 1, 2], v => TAMS_RED[v].filtros + ' filtros × ' + TAMS_RED[v].bloques + ' bloques', est.opc)}</label>
    <label class="op">Pasos de entrenamiento por generación ${sel('redPasos', [100, 300, 1000, 3000], v => v, est.opc)}</label>
    <label class="op">Posiciones nuevas por generación ${sel('redPos', [500, 1000, 2000, 4000], v => v, est.opc)}</label>
    <label class="op">Autojuego continuo en la gráfica ${sel('redAuto', [1, 0], v => v ? 'Sí: juegan contra sí mismas sin parar' : 'No', est.opc)}</label>
    <label class="op">Autojuego: simulaciones por jugada ${sel('redAutoSims', [100, 200, 400, 800], v => v, est.opc)}</label>
    <label class="op">Autojuego: partidas a la vez ${sel('redAutoPar', [4, 8, 16, 32], v => v, est.opc)}</label>
    <label class="op">Que juegue cada generación ${sel('redJuega', [1, 0], v => v ? 'Sí: contra Stockfish y la campeona' : 'No, solo aprende', est.opc)}</label>
    <label class="op">Simulaciones por jugada ${sel('redSims', [100, 400, 1600, 6400], v => v, est.opc)}</label>
    <p class="nota">El tamaño solo cuenta para las redes que nacen de cero; las hijas heredan el de su madre y a veces crecen o encogen un bloque. Cada paso aprende de 256 posiciones; guarda las últimas ${gopc('redMax').toLocaleString('es-ES')}. Para no memorizar, nunca da más de ${gopc('redVueltas')} vueltas por generación a lo que tiene: con pocas posiciones hace menos pasos.</p>` : ''}
    <h2>Distópicas</h2>
    ${M.DIST.map(([n, nombre]) => `<label class="op">${n}. ${nombre} <select data-dist="${n}"><option value="1"${flagsDe()[n] ? ' selected' : ''}>Sí</option><option value="0"${flagsDe()[n] ? '' : ' selected'}>No</option></select></label>`).join('')}
    <label class="op">Gradiente: etiquetas ${sel('gradSF', [1, 0], v => v ? 'Stockfish' : 'Resultado de la partida', est.opc)}</label>
    <label class="op">Gradiente: posiciones nuevas por generación ${sel('gradPos', [100, 200, 400, 800], v => v, est.opc)}</label>
    <label class="op">Gradiente: profundidad de Stockfish ${sel('gradProf', [6, 8, 10, 12], v => v + ' jugadas', est.opc)}</label>
    <p class="nota">Gradiente (39): cada hija afina con descenso de gradiente los pesos de sus medidas y de su red para parecerse a la valoración de Stockfish en posiciones de sus propias partidas (guarda las últimas ${gopc('gradMax')}; ahora hay ${grad.pos.length}). Los genes llevan 6 decimales.</p>
    <label class="op">Peso de la novedad ${sel('novPeso', [0, 0.05, 0.15, 0.3], v => Math.round(v * 100) + ' %', est.opc)}</label>
    <label class="op">Guardar los genes de las que mueren ${sel('genesTodas', [0, 1], v => v ? 'Sí (ocupa más)' : 'No, solo sus cualidades', est.opc)}</label>
    <p class="nota">Apagar una distópica no borra sus genes: siguen heredándose y vuelven a contar si la enciende. Los parásitos añaden 16 partidas por generación.</p>
    <p class="nota">Sin límite, las partidas acaban por mate, ahogado, triple repetición, la regla de las 50 jugadas, material insuficiente o porque una se rinde (cuando las dos la ven perdida 8 jugadas seguidas). Más tiempo por jugada juega mejor pero evoluciona más despacio. Con ${NHILOS} hilos, una generación de ${pop.length} arañas tarda unos ${Math.max(1, Math.round(pop.length * opc.rondas * (limite() * .45) * msJugada() * (1 + descanso()) / 1000 / hilosActivos() / 60))} min (contra Stockfish la araña piensa lo mismo que en el torneo).</p>
    <div class="ctrl"><button class="btn sec" id="exp">Exportar copia</button><button class="btn sec" id="reset">Nueva evolución desde cero</button><button class="btn" data-cerrar>Hecho</button></div>`);
  $('#hojac').querySelectorAll('select').forEach(s => s.onchange = () => {
    if (s.dataset.dist) { est.opc.dist = Object.assign({}, est.opc.dist || {}, { [s.dataset.dist]: +s.value }); compilados.clear(); guardarEstado().catch(() => {}); marcar(); return; }
    if (s.hasAttribute('data-evo')) { est.opc[s.dataset.k] = +s.value; guardarEstado().catch(() => {}); } else { opc[s.dataset.k] = +s.value; guardarOpc(); marcarSF(); repartir(); pintarEstado(); const r = $('#opRend'); if (r && s.dataset.k === 'rend') r.firstChild.textContent = textoRend(); }
  });
  $('#exp').onclick = exportar;
  { const b = $('#gpuProbar'); if (b) b.onclick = async () => { b.disabled = true; $('#gpuTxt').textContent = 'Probando la gráfica…'; await probarGPU(); $('#gpuTxt').textContent = textoGPU(); b.disabled = false; }; }
  $('#reset').onclick = async () => {
    nuevaEvolucion();
  };
}
async function exportar() {
  const datos = { app: 'arana-ajedrez', v: 2, origen: ORIGEN, fecha: new Date().toISOString(), estado: est, individuos: await todos('individuos'), generaciones: await todos('generaciones'), partidas: await todos('partidas') };
  if (!db) datos.individuos = pop;
  return guardarArchivo(`arana-ajedrez-${ORIGEN}-gen${est.gen}.json`, JSON.stringify(datos));
}
async function guardarArchivo(nombreF, texto, tipo) {
  tipo = tipo || 'application/json';
  const io = IOS_APP(); if (io) { io.postMessage({ tipo: 'guardar', nombre: nombreF, texto }); return; }
  const aa = ANDROID(); if (aa && typeof aa.guardarArchivo === 'function') { aa.guardarArchivo(nombreF, texto); return; }
  const blob = new Blob([texto], { type: tipo });
  try { const f = new File([blob], nombreF, { type: tipo }); if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: nombreF }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombreF; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ═════════ Sacar una araña a jugar fuera ═════════ */

/* ───── Motor UCI: un archivo .js con el cerebro de la araña y sus genes, para el ordenador y sin internet.
   Se usa con Node.js en cualquier programa de ajedrez que admita motores UCI (Cute Chess, Arena, BanksiaGUI…) o con lichess-bot. ───── */
async function exportarMotor(p) {
  let motor = '';
  try { motor = await (await fetch('motor.js')).text(); } catch (e) { return avisar('No he podido leer mi motor.'); }
  const nombre = p.nombre.replace(/[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ ]/g, '').trim() || 'Arana', archivo = 'arana-' + nombre.toLowerCase().replace(/\s+/g, '-') + '.js';
  const texto = `#!/usr/bin/env node
/* Araña «${nombre}» como motor de ajedrez UCI (generación ${p.gen}, Elo ${Math.round(p.elo)} en su evolución).
   Funciona sin internet. Necesita Node.js 14 o posterior (https://nodejs.org).
   Probar en una terminal:   node ${archivo}   y escriba: uci  ·  isready  ·  position startpos moves e2e4  ·  go movetime 1000
   En un programa de ajedrez (Cute Chess, Arena, BanksiaGUI…): añada un motor con el comando «node» y el argumento «${archivo}»
   (o haga ejecutable este archivo). Con lichess-bot: póngalo en su carpeta de motores con protocolo UCI. */
${motor}
;(function () {
  'use strict';
  const M = (typeof module !== 'undefined' && module.exports && module.exports.Pos) ? module.exports : globalThis.AjedrezMotor;
  const GENES = ${JSON.stringify(M.completar(JSON.parse(JSON.stringify(p.genes))))};
  const FLAGS = ${JSON.stringify(flagsDe())};
  const C = M.compilar(GENES, FLAGS);
  let pos = new M.Pos(), bus = new M.Buscador(C);
  const out = t => process.stdout.write(t + '\\n');
  function posicion(args) {
    let i = 0;
    if (args[0] === 'startpos') { pos = new M.Pos(); i = 1; }
    else if (args[0] === 'fen') { const f = []; i = 1; while (i < args.length && args[i] !== 'moves') f.push(args[i++]); pos = new M.Pos(f.join(' ')); }
    if (args[i] === 'moves') for (const u of args.slice(i + 1)) { const m = M.parseUci(pos, u); if (!m) break; pos.make(m); }
  }
  function ir(args) {
    const v = k => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : null; };
    const yo = pos.side ? 'b' : 'w', t = v(yo + 'time'), inc = v(yo + 'inc') || 0, mt = v('movetime'), d = v('depth');
    const ms = mt || (t != null ? Math.max(30, Math.min(t / 25 + inc * .8, t * .5)) : d ? 1e9 : 2000);
    const r = bus.pensar(pos, ms, d || 64);
    if (r.move) { const sc = Math.abs(r.score) > 29000 ? 'mate ' + Math.sign(r.score) * Math.ceil((30000 - Math.abs(r.score)) / 2) : 'cp ' + r.score;
      out(\`info depth \${r.depth} score \${sc} nodes \${r.nodes} pv \${M.uci(r.move)}\`); out('bestmove ' + M.uci(r.move)); }
    else out('bestmove 0000');
  }
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); orden(l); } });
  function orden(l) {
    const [c, ...a] = l.split(/\\s+/);
    if (c === 'uci') { out('id name Arana ${nombre}'); out('id author Juan y su arana'); out('uciok'); }
    else if (c === 'isready') out('readyok');
    else if (c === 'ucinewgame') { pos = new M.Pos(); bus = new M.Buscador(C); }
    else if (c === 'position') posicion(a);
    else if (c === 'go') ir(a);
    else if (c === 'quit') process.exit(0);
  }
})();
`;
  return guardarArchivo(archivo, texto, 'text/javascript');
}

/* ───── Lichess: la araña juega con una cuenta BOT (API oficial: https://lichess.org/api#tag/bot) ───── */
const liGuardar = () => { try { localStorage.setItem(LI_K, JSON.stringify({ token: li.token, arana: li.arana, aceptar: li.aceptar, auto: li.conectado })); } catch (e) {} };
const liLog = t => { li.log.push(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) + ' · ' + t); li.log = li.log.slice(-30); liPintar(); };
function liElegir(p) { li.arana = { id: p.id, nombre: p.nombre, gen: p.gen, genes: JSON.parse(JSON.stringify(p.genes)) }; liGuardar(); }
async function liFetch(ruta, o) {
  o = o || {};
  const r = await fetch(LI + ruta, { method: o.method || 'GET', headers: Object.assign({ Authorization: 'Bearer ' + li.token }, o.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), body: o.form ? new URLSearchParams(o.form).toString() : undefined, signal: o.signal });
  if (!r.ok) { let m = r.status + ''; try { const j = await r.json(); m = j.error || m; } catch (e) {} throw new Error(m); }
  return r;
}
async function liStream(ruta, alObjeto, signal) {   // ndjson: un objeto por línea; líneas vacías para mantener viva la conexión
  const r = await liFetch(ruta, { signal }), rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
  while (true) {
    const { value, done } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) { try { await alObjeto(JSON.parse(l)); } catch (e) { console.warn('lichess', e); } } }
  }
}
async function liConectar() {
  li.error = '';
  if (!li.token) { li.error = 'Falta el token.'; return liPintar(); }
  if (!li.arana) { const c = campeona(); if (c) liElegir(c); }
  try { li.cuenta = await (await liFetch('/api/account')).json(); } catch (e) { li.error = 'Lichess no acepta el token (' + e.message + ').'; return liPintar(); }
  if (li.cuenta.title !== 'BOT') { li.error = 'Esta cuenta aún no es BOT. Conviértala abajo (solo si es una cuenta nueva, sin partidas).'; return liPintar(); }
  li.conectado = true; li.ctrl = new AbortController(); segundoPlano(true); liGuardar();
  liLog(`Conectada como ${li.cuenta.username}. Juega ${li.arana ? li.arana.nombre : '—'}.`);
  (async () => {
    while (li.conectado) {
      try { await liStream('/api/stream/event', liEvento, li.ctrl.signal); } catch (e) { if (!li.conectado) break; liLog('Se ha cortado la conexión; reintento…'); }
      if (li.conectado) await new Promise(r => setTimeout(r, 5000));
    }
  })();
  liPintar();
}
function liDesconectar() { li.conectado = false; liGuardar(); if (li.ctrl) li.ctrl.abort(); if (!entrenando) segundoPlano(false); liLog('Desconectada.'); }
async function liEvento(ev) {
  if (ev.type === 'challenge') {
    const c = ev.challenge; if (!c || (li.cuenta && c.challenger && c.challenger.id === li.cuenta.id)) return;
    const vivas = [...li.partidas.values()].filter(x => !x.fin).length;
    const motivo = !li.aceptar ? 'later' : c.variant && c.variant.key !== 'standard' ? 'standard' : c.speed === 'correspondence' ? 'timeControl' : vivas >= 2 ? 'later' : null;
    try {
      if (motivo) { await liFetch(`/api/challenge/${c.id}/decline`, { method: 'POST', form: { reason: motivo } }); liLog(`Rechazo el reto de ${c.challenger.name} (${motivo}).`); }
      else { await liFetch(`/api/challenge/${c.id}/accept`, { method: 'POST' }); liLog(`Acepto el reto de ${c.challenger.name} (${c.speed}${c.rated ? ', con puntos' : ''}).`); }
    } catch (e) { liLog('Reto: ' + e.message); }
  } else if (ev.type === 'gameStart') {
    const id = ev.game.gameId || ev.game.id; if (!li.partidas.has(id)) liPartida(id);
  } else if (ev.type === 'challengeDeclined') liLog('Han rechazado mi reto.');
}
async function liPartida(id) {
  const g = { id, color: null, fen0: M.INICIO, rival: '?', ucis: [], piensa: false, fin: null, ev: 0, saludo: false };
  li.partidas.set(id, g); liLog(`Empieza la partida ${id}.`);
  const alEstado = async st => {
    g.ucis = st.moves ? st.moves.split(' ') : [];
    if (st.status && st.status !== 'started' && st.status !== 'created') {
      if (!g.fin) {
        g.fin = st.status + (st.winner ? ' · ganan ' + (st.winner === 'white' ? 'blancas' : 'negras') : '');
        const res = st.winner ? (st.winner === g.color ? 1 : 0) : .5;
        liLog(`Partida ${id} terminada: ${res === 1 ? '¡gano!' : res === 0 ? 'pierdo' : 'tablas'} (${st.status}).`);
        darHito('li-primera'); if (res === 1) darHito('li-gana');
        const p = await individuo(li.arana.id); if (p) { recordarRival(p, 'lichess', res); if (!byId.has(p.id)) escribir([['individuos', p]]).catch(() => {}); else guardarEstado().catch(() => {}); }
      }
      return liPintar();
    }
    const pos = posEn(g.fen0, g.ucis, g.ucis.length), mia = (pos.side === 0) === (g.color === 'white');
    if (g.color && (g.color === 'white' ? st.bdraw : st.wdraw) && g.ev < -150) { try { await liFetch(`/api/bot/game/${id}/draw/yes`, { method: 'POST' }); liLog('Acepto las tablas que me ofrecen.'); } catch (e) {} }
    if (!mia || g.piensa) return liPintar();
    g.piensa = true; liPintar();
    const yo = g.color === 'white' ? 'w' : 'b', t = st[yo + 'time'] || 60000, inc = st[yo + 'inc'] || 0;
    const ms = Math.max(50, Math.min(t / 30 + inc * .8, t * .4, 8000)), n = g.ucis.length;
    const r = await new Promise(ok => { const k = 'l' + (++sigAparte); aparte.set(k, { fin: ok }); hiloAparte().postMessage({ t: 'pensar', id: k, ind: { id: li.arana.id, genes: li.arana.genes }, fen0: g.fen0, jugadas: g.ucis.slice(), ms, prof: 64, flags: flagsDe(), aj: null }); });
    g.piensa = false; g.ev = (r.eval || 0) * (g.color === 'white' ? 1 : -1);
    if (r.uci && n === g.ucis.length && !g.fin) { try { await liFetch(`/api/bot/game/${id}/move/${r.uci}`, { method: 'POST' }); } catch (e) { liLog('Jugada rechazada: ' + e.message); } }
    liPintar();
  };
  try {
    await liStream(`/api/bot/game/stream/${id}`, async o => {
      if (o.type === 'gameFull') {
        g.color = o.white && li.cuenta && o.white.id === li.cuenta.id ? 'white' : 'black';
        const riv = g.color === 'white' ? o.black : o.white; g.rival = riv ? (riv.name || riv.id || 'IA') + (riv.rating ? ` (${riv.rating})` : '') : 'IA de Lichess';
        g.fen0 = !o.initialFen || o.initialFen === 'startpos' ? M.INICIO : o.initialFen;
        if (!g.saludo) { g.saludo = true; liFetch(`/api/bot/game/${id}/chat`, { method: 'POST', form: { room: 'player', text: `Hola, soy ${li.arana.nombre}, una araña de ajedrez que evoluciona sola. ¡Suerte!` } }).catch(() => {}); }
        await alEstado(o.state);
      } else if (o.type === 'gameState') await alEstado(o);
    }, li.ctrl && li.ctrl.signal);
  } catch (e) { if (li.conectado) liLog(`Partida ${id}: ${e.message}`); }
}
async function liRetar(usuario, min, inc, puntos) {
  try {
    await liFetch('/api/challenge/' + encodeURIComponent(usuario), { method: 'POST', form: { rated: puntos ? 'true' : 'false', 'clock.limit': String(min * 60), 'clock.increment': String(inc), color: 'random', variant: 'standard' } });
    liLog(`Reto enviado a ${usuario} (${min}+${inc}).`);
  } catch (e) { liLog(`No he podido retar a ${usuario}: ${e.message}.`); }
}
async function liBot() {
  if (!confirm('Convertir la cuenta en BOT no tiene vuelta atrás y solo funciona si la cuenta no ha jugado ninguna partida. Use una cuenta nueva, no la suya. ¿Sigo?')) return;
  try { await liFetch('/api/bot/account/upgrade', { method: 'POST' }); li.cuenta = await (await liFetch('/api/account')).json(); liLog('La cuenta ya es BOT.'); li.error = ''; }
  catch (e) { li.error = 'Lichess no deja convertirla: ' + e.message + '.'; }
  liPintar();
}
function lichess() {
  hoja(`<h3>Lichess</h3><div class="sub">Su araña juega en Lichess con una cuenta BOT, mientras la sala esté abierta y con internet.</div>
    <details${li.token ? '' : ' open'}><summary>Cómo se prepara (una vez)</summary><div class="lin">
      1. Cree en Lichess una cuenta nueva solo para su araña y no juegue ninguna partida con ella.<br>
      2. Con esa cuenta abierta, cree un token con el permiso «Play games with the bot API»: <a href="https://lichess.org/account/oauth/token/create?scopes[]=bot:play&description=Arana" target="_blank" rel="noopener">crear el token</a>.<br>
      3. Péguelo aquí, pulse «Guardar» y luego «Convertir en BOT».<br>
      chess.com no admite bots: jugar allí con un motor cierra la cuenta.</div></details>
    <label class="op">Token <input id="liTok" type="password" autocomplete="off" placeholder="${li.token ? 'Guardado · …' + esc(li.token.slice(-4)) : 'lip_…'}" style="flex:1;font:14px var(--mono);background:#141832;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px;min-width:0"></label>
    <div class="ctrl" style="margin:8px 0"><button class="btn sec" id="liGuarda">Guardar</button><button class="btn" id="liCon"></button><button class="btn sec" id="liBot">Convertir en BOT</button></div>
    <div id="liEstado"></div>
    <label class="op">Aceptar retos <select id="liAcep"><option value="1"${li.aceptar ? ' selected' : ''}>Sí (hasta 2 partidas a la vez)</option><option value="0"${li.aceptar ? '' : ' selected'}>No</option></select></label>
    <h2>Retar a alguien</h2>
    <div class="ctrl"><input id="liUser" placeholder="usuario (p. ej. maia1)" style="flex:1;min-width:120px;font:14px var(--mono);background:#141832;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px">
      <select id="liMin" style="font:14px var(--mono);background:#141832;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px">${[1, 3, 5, 10, 15].map(m => `<option value="${m}"${m === 5 ? ' selected' : ''}>${m} min</option>`).join('')}</select>
      <select id="liInc" style="font:14px var(--mono);background:#141832;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px">${[0, 2, 3, 5].map(m => `<option value="${m}"${m === 3 ? ' selected' : ''}>+${m} s</option>`).join('')}</select>
      <button class="btn sec" id="liRetar">Retar</button></div>
    <p class="nota">Los bots pueden retar a otros bots (como maia1, maia5 o maia9). A personas es mejor que le reten ellas a su bot desde su perfil.</p>
    <h2>Partidas y registro</h2><div id="liPart"></div>` + CERRAR);
  $('#liGuarda').onclick = () => { const t = $('#liTok').value.trim(); if (t) { li.token = t; liGuardar(); $('#liTok').value = ''; avisar('Token guardado solo en este aparato.'); lichess(); } };
  $('#liCon').onclick = () => li.conectado ? liDesconectar() : liConectar();
  $('#liBot').onclick = liBot;
  $('#liAcep').onchange = e => { li.aceptar = e.target.value === '1'; liGuardar(); };
  $('#liRetar').onclick = () => { const u = $('#liUser').value.trim(); if (!u) return avisar('Escriba un usuario.'); if (!li.conectado) return avisar('Conecte primero.'); liRetar(u, +$('#liMin').value, +$('#liInc').value, false); };
  liPintar();
}
function liPintar() {
  const e = $('#liEstado'); if (!e) return;
  $('#liCon').textContent = li.conectado ? 'Desconectar' : 'Conectar';
  $('#liBot').style.display = li.cuenta && li.cuenta.title === 'BOT' ? 'none' : '';
  e.innerHTML = `<div class="det"><span>Cuenta</span><span class="v">${li.cuenta ? esc(li.cuenta.username) + (li.cuenta.title === 'BOT' ? ' · BOT' : ' · aún no es BOT') : '—'}</span>
    <span>Juega</span><span class="v">${li.arana ? esc(li.arana.nombre) + ' (g' + li.arana.gen + ')' : 'su campeona'} · <a href="#" id="liCambiar">cambiar</a></span>
    <span>Estado</span><span class="v">${li.conectado ? 'conectada, esperando retos' : 'desconectada'}</span></div>${li.error ? `<p class="nota" style="color:#ff8a8a">${esc(li.error)}</p>` : ''}`;
  const c = $('#liCambiar'); if (c) c.onclick = ev => { ev.preventDefault(); biblioteca(); };
  const ps = [...li.partidas.values()].reverse();
  $('#liPart').innerHTML = (ps.length ? '<div class="det">' + ps.map(g => `<span><a href="${LI}/${esc(g.id)}" target="_blank" rel="noopener">${esc(g.id)}</a> contra ${esc(g.rival)}</span><span class="v">${g.fin ? esc(g.fin) : g.piensa ? 'pensando…' : 'jugada ' + Math.ceil(g.ucis.length / 2)}</span>`).join('') + '</div>' : '') +
    `<div class="lin" style="margin-top:8px">${li.log.slice().reverse().map(esc).join('<br>') || 'Sin actividad todavía.'}</div>`;
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
if (ORIGEN === 'linux') $('#salir').hidden = true;
/* En el servidor de Linux la sala se ve por el visor, que no enseña las listas desplegables del sistema:
   se sustituyen por una lista dentro de la página. */
if (ORIGEN === 'linux') document.addEventListener('mousedown', e => {
  const s = e.target.closest && e.target.closest('select'); if (!s || s.disabled) return;
  e.preventDefault(); const vieja = document.querySelector('.selec'); if (vieja) vieja.remove();
  const caja = document.createElement('div'), et = s.closest('label');
  caja.className = 'selec'; caja.setAttribute('role', 'listbox');
  caja.innerHTML = `<p>${esc(et ? (et.firstChild.textContent || '').trim() : 'Elija')}</p>` + [...s.options].map((o, i) => `<button data-i="${i}"${o.selected ? ' class="si"' : ''}>${esc(o.textContent)}</button>`).join('');
  caja.onclick = ev => { const b = ev.target.closest('[data-i]'); caja.remove(); if (!b) return; s.selectedIndex = +b.dataset.i; s.dispatchEvent(new Event('change', { bubbles: true })); };
  document.body.appendChild(caja);
}, true);   // el servidor de Linux no sale de la sala: sigue entrenando
$('#salir').onclick = () => { entrenar(false); if (!avisarApp({ tipo: 'salir' })) location.href = '../'; };
document.addEventListener('keydown', e => {   // atajos en el ordenador
  if (e.key === 'Escape') return cerrarHoja();
  if (/INPUT|SELECT|TEXTAREA/.test((e.target && e.target.tagName) || '') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (visor && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { const b = $(e.key === 'ArrowLeft' ? '#v1' : '#v2'); if (b) { e.preventDefault(); b.click(); } return; }
  if ($('#hoja').classList.contains('on')) return;
  if (e.key === ' ') { e.preventDefault(); entrenar(!entrenando); }
  else if (e.key === '+') $('#zp').click(); else if (e.key === '-') $('#zm').click(); else if (e.key === '0') $('#zt').click();
  else if (e.key === 'l' || e.key === 'L') lichess(); else if (e.key === 'b' || e.key === 'B') biblioteca();
});
window.addEventListener('message', e => { if (e.data && e.data.arana === 'ajedrez-entrenar') entrenar(true); });

/* Para pruebas */
window.__sala = { usaGPU: () => gpuOcupada || redOcupada || auto.activo, auto: () => Object.assign({}, auto, { gen: Object.assign({}, auto.gen) }), bucleAuto, cicloRedes, ponerRedes: l => { redes = l; }, redes: () => redes, ponerDatosRed: d => { redDatos = d; }, explotarExplorar,   // ponerRedes: solo para las pruebas
  red: () => ({ redes: redes.map(sinGPU), datos: redDatos.pos.length, ultima: historial.slice().reverse().find(g => g.red) }), probarGPU, gpuPrueba: () => gpuPrueba, rend, hilosActivos, msJugada, textoRend, li, liConectar, liDesconectar, liRetar, exportarMotor, torneo: () => torneo, clasif, evoluciones, nuevaEvolucion, duplicarEvolucion, registro, comparar, verPartida, verJuego, visor: () => visor, ana: () => ana, slots: () => slots, importarTexto, accionesDe, partidaHumana, moverHumano, humana: () => ph, duelo, campeona, encolar, conGenes, escalera: ESCALERA, sfEstado: () => ({ fase: sfFase, fallo: sfFallo, vista: sfVista }), estado: () => est, pop: () => pop, juegos: () => juegos, entrenar, ficha, opciones, cerrarGeneracion, exportar, aux: AUX, nivel: () => nivel, escala: () => esc0, zoom: s => aplicarEscala(s, true), acercarMesa, verTodo };

// Sin internet: la sala se guarda en el aparato (sw.js de Araña) también si se abre directamente
try { if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => {}); } catch (e) {}
cargar().then(() => {
  ponerTitulo(); crearHilos(); construirPlano(); ponerVista(); pintarEstado();
  let sigue = false; if (ORIGEN === 'linux') try { sigue = localStorage.getItem('arana.ajedrez.servidor.entrena') !== '0'; } catch (e) {}
  if (qs.get('entrenar') === '1' || sigue) entrenar(true);
  if (ORIGEN === 'linux') try { if (JSON.parse(localStorage.getItem(LI_K) || '{}').auto && li.token) liConectar(); } catch (e) {}   // el servidor vuelve a Lichess tras reiniciar
}).catch(e => { $('#estado').textContent = 'No he podido abrir la sala: ' + e.message; });
})();
