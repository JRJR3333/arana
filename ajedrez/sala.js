/* La sala de partidas (fase 1): reparte las partidas entre hilos, dibuja las 16 mesas,
   guarda cada generación en IndexedDB y enseña la ficha de cada araña. */
(function () {
'use strict';
const M = window.AjedrezMotor, $ = s => document.querySelector(s);
const qs = new URLSearchParams(location.search);
const ORIGEN = qs.get('plat') || (/android/i.test(navigator.userAgent) || qs.get('app') === 'android' ? 'android' : /iphone|ipad|ipod/i.test(navigator.userAgent) ? 'iphone' : 'web');
const rng = M.mulberry((Math.random() * 4294967296) >>> 0);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
    const r = indexedDB.open('arana-ajedrez', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('estado');
      d.createObjectStore('individuos', { keyPath: 'id' });
      d.createObjectStore('generaciones', { keyPath: 'gen' });
      d.createObjectStore('partidas', { keyPath: 'gen' });
    };
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
}
const req = r => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
async function leer(store, key) { if (!db) return null; return req(db.transaction(store).objectStore(store).get(key)); }
async function todos(store) { if (!db) return []; return req(db.transaction(store).objectStore(store).getAll()); }
function escribir(ops) {
  if (!db) return Promise.resolve();
  return new Promise((ok, ko) => {
    const tx = db.transaction(['estado', 'individuos', 'generaciones', 'partidas'], 'readwrite');
    for (const [s, v, k] of ops) k === undefined ? tx.objectStore(s).put(v) : tx.objectStore(s).put(v, k);
    tx.oncomplete = ok; tx.onerror = () => ko(tx.error); tx.onabort = () => ko(tx.error);
  });
}

/* ───── Estado de la evolución ───── */
let est = null, pop = [], byId = new Map(), historial = [];
async function cargar() {
  try { db = await abrirDB(); } catch (e) { db = null; }
  est = await leer('estado', 'actual');
  if (est && est.pop) {
    const inds = await Promise.all(est.pop.map(id => leer('individuos', id)));
    pop = inds.filter(Boolean);
    if (pop.length !== est.pop.length) pop = [];
  }
  if (!est || !pop.length) {
    est = { gen: 1, origen: ORIGEN, opc: {}, creada: new Date().toISOString() };
    pop = M.poblacionInicial(rng, ORIGEN, M.OPC_EVO.poblacion);
    await guardarEstado();
  }
  historial = (await todos('generaciones')).sort((a, b) => a.gen - b.gen);
  byId = new Map(pop.map(p => [p.id, p]));
}
function guardarEstado(extra) {
  est.pop = pop.map(p => p.id);
  const ops = [['estado', est, 'actual']];
  for (const p of pop) ops.push(['individuos', p]);
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
let juegos = [], enCurso = new Map(), entrenando = false, finGen = null, sigId = 0, ronda = 0;
function prepararGeneracion() {
  pop.forEach(p => { p.pts = 0; });
  juegos = M.emparejar(pop, opc.rondas, rng).map(j => Object.assign(j, { id: ++sigId, estado: 'cola', fenAhora: j.fen, ultima: null, res: null }));
  ronda = 0;
  pintarMesas(true);
}
function repartir() {
  if (!entrenando) return;
  for (const w of hilos) {
    if (!w.libre) continue;
    const j = juegos.find(x => x.estado === 'cola'); if (!j) break;
    j.estado = 'juega'; w.libre = false; enCurso.set(j.id, j);
    if (j.ronda !== ronda) { ronda = j.ronda; pintarMesas(true); }
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
  for (const id of out.resumen.elite) { const p = byId.get(id); if (p) p.fueElite = true; }
  const vivos = new Set(out.pop.map(p => p.id)), extra = [['generaciones', out.resumen]];
  if (mejorPartida) extra.push(['partidas', Object.assign({ gen: out.resumen.gen }, mejorPartida)]);
  for (const p of viejos) if (!vivos.has(p.id)) extra.push(['individuos', Object.assign({}, p, { genes: p.fueElite ? p.genes : null })]);
  est = out.est; pop = out.pop; byId = new Map(pop.map(p => [p.id, p])); historial.push(out.resumen);
  try { await guardarEstado(extra); } catch (e) { console.warn('guardar', e); }
  juegos = []; sucio.clear();
  pintarEstado();
  if (entrenando) { prepararGeneracion(); repartir(); } else pintarMesas(true);
}
function elegirPartida() {   // la partida más larga de la mejor araña
  const fin = juegos.filter(j => j.estado === 'fin'); if (!fin.length) return null;
  const top = pop.slice().sort((a, b) => b.pts - a.pts)[0].id;
  const suyas = fin.filter(j => j.w === top || j.b === top).sort((a, b) => b.plies - a.plies);
  const j = suyas[0] || fin[0];
  return { w: j.w, b: j.b, wn: byId.get(j.w).nombre, bn: byId.get(j.b).nombre, fen: j.fen, jugadas: j.jugadas, res: j.res, motivo: j.motivo };
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

/* ───── Dibujo ───── */
const LET = { p: 'P', n: 'C', b: 'A', r: 'T', q: 'D', k: 'R' };
function tablero(cv, fen, ultima) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth || 140;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(W * dpr); }
  const g = cv.getContext('2d'), s = cv.width / 8; g.setTransform(1, 0, 0, 1, 0, 0);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { g.fillStyle = (r + c) % 2 ? 'rgba(94,232,255,.05)' : 'rgba(94,232,255,.16)'; g.fillRect(c * s, r * s, s, s); }
  if (ultima) {
    g.fillStyle = 'rgba(61,255,153,.22)';
    for (const q of [ultima.slice(0, 2), ultima.slice(2, 4)]) { const c = q.charCodeAt(0) - 97, r = 8 - +q[1]; g.fillRect(c * s, r * s, s, s); }
  }
  const filas = fen.split(' ')[0].split('/');
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 ' + Math.round(s * .5) + 'px ui-monospace,Menlo,monospace';
  filas.forEach((f, r) => {
    let c = 0;
    for (const ch of f) {
      if (ch >= '1' && ch <= '8') { c += +ch; continue; }
      const blanca = ch !== ch.toLowerCase(), x = c * s + s / 2, y = r * s + s / 2;
      g.beginPath(); g.arc(x, y, s * .38, 0, Math.PI * 2);
      g.fillStyle = blanca ? '#e9f6ff' : '#1b1430'; g.fill();
      g.lineWidth = Math.max(1, s * .06); g.strokeStyle = blanca ? '#5ee8ff' : '#ff4fa3'; g.stroke();
      g.fillStyle = blanca ? '#0a0c15' : '#ffd6ea'; g.fillText(LET[ch.toLowerCase()], x, y + s * .03);
      c++;
    }
  });
}
let sucio = new Set(), pedido = false;
function marcar(j) { if (j) sucio.add(j.mesa); else juegos.forEach(x => sucio.add(x.mesa)); if (!pedido) { pedido = true; requestAnimationFrame(dibujar); } }
function dibujar() {
  pedido = false;
  if (!opc.directo) { pintarResumen(); pintarEstado(); return; }
  for (const m of sucio) pintarMesa(m);
  sucio.clear(); pintarEstado();
}
function juegosDeMesa(m) { return juegos.filter(j => j.ronda === ronda && j.mesa === m); }
function pintarMesas(todo) {
  const box = $('#mesas'), res = $('#resumen');
  box.hidden = !opc.directo; res.hidden = opc.directo;
  if (!opc.directo) { pintarResumen(); return; }
  if (todo) {
    const n = Math.floor(pop.length / 2); let h = '';
    for (let m = 0; m < n; m++) h += `<div class="mesa" id="m${m}"><div class="n"><span>MESA ${m + 1}</span><span class="res"></span></div><canvas></canvas><button data-w></button><button data-b></button></div>`;
    box.innerHTML = h;
    for (let m = 0; m < n; m++) pintarMesa(m);
  }
}
function pintarMesa(m) {
  const el = document.getElementById('m' + m); if (!el) return;
  const js = juegosDeMesa(m);
  const j = js.find(x => x.estado === 'juega') || js.slice().reverse().find(x => x.estado === 'fin') || js[0];
  if (!j) { tablero(el.querySelector('canvas'), M.INICIO, null); return; }
  el.classList.toggle('juega', j.estado === 'juega');
  tablero(el.querySelector('canvas'), j.fenAhora, j.ultima);
  const a = byId.get(j.w), b = byId.get(j.b), bw = el.querySelector('[data-w]'), bb = el.querySelector('[data-b]');
  if (!a || !b) return;   // la generación acaba de cambiar
  bw.dataset.id = a.id; bb.dataset.id = b.id;
  bw.innerHTML = `<span><span class="dot w"></span>${esc(a.nombre)}</span><i>${Math.round(a.elo)}</i>`;
  bb.innerHTML = `<span><span class="dot b"></span>${esc(b.nombre)}</span><i>${Math.round(b.elo)}</i>`;
  const fin = js.filter(x => x.estado === 'fin');
  el.querySelector('.res').textContent = j.estado === 'juega' ? (js.indexOf(j) ? 'vuelta' : 'ida') : fin.length ? fin.map(x => x.res === 1 ? '1-0' : x.res === 0 ? '0-1' : '½').join(' · ') : 'espera';
}
function pintarResumen() {
  const fila = pop.slice().sort((a, b) => b.pts - a.pts || b.elo - a.elo);
  let h = '<h2>Esta generación</h2><table><tr><th>#</th><th>Araña</th><th class="num">Pts</th><th class="num">Elo</th></tr>';
  fila.forEach((p, i) => { h += `<tr data-id="${esc(p.id)}"><td>${i + 1}</td><td>${esc(p.nombre)}</td><td class="num">${p.pts || 0}</td><td class="num">${Math.round(p.elo)}</td></tr>`; });
  h += '</table><h2>Generaciones</h2>' + chispa(historial.map(g => g.mejor.elo), 'Elo de la mejor') + '<table><tr><th>Gen</th><th>Mejor</th><th class="num">Pts</th><th class="num">σ</th><th class="num">Div.</th></tr>';
  historial.slice(-12).reverse().forEach(g => { h += `<tr><td>${g.gen}</td><td>${esc(g.mejor.nombre)}</td><td class="num">${g.mejor.pts}</td><td class="num">${g.sigma.toFixed(3)}</td><td class="num">${g.diversidad.toFixed(2)}</td></tr>`; });
  $('#resumen').innerHTML = h + '</table>';
}
function chispa(vals, titulo) {
  if (vals.length < 2) return '';
  const mn = Math.min(...vals), mx = Math.max(...vals), d = mx - mn || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * 300).toFixed(1)},${(52 - (v - mn) / d * 44).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 300 56" preserveAspectRatio="none" role="img" aria-label="${esc(titulo)}: de ${Math.round(vals[0])} a ${Math.round(vals[vals.length - 1])}"><polyline points="${pts}" fill="none" stroke="#5ee8ff" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}
function pintarEstado() {
  const hechas = juegos.filter(j => j.estado === 'fin').length, total = juegos.length;
  const ult = historial[historial.length - 1];
  $('#estado').innerHTML = `<b>Generación ${est.gen}</b> · ${entrenando ? 'entrenando' : 'en pausa'}` +
    (total ? ` · ronda ${ronda + 1}/${opc.rondas} · ${hechas}/${total} partidas` : '') +
    ` · σ ${(est.sigma || M.OPC_EVO.sigma0).toFixed(3)}` + (ult ? `<br>Última campeona: <b>${esc(ult.mejor.nombre)}</b> (${ult.mejor.pts} pts, Elo ${ult.mejor.elo}) · ${NHILOS} hilos` : `<br>${NHILOS} hilos · cada generación se guarda al terminar`);
}

/* ───── Ficha de una araña ───── */
function hoja(html) { $('#hojac').innerHTML = html; $('#hoja').classList.add('on'); const b = $('#hojac button'); if (b) b.focus(); }
function cerrarHoja() { $('#hoja').classList.remove('on'); }
$('#hoja').addEventListener('click', e => { if (e.target.id === 'hoja' || e.target.closest('[data-cerrar]')) cerrarHoja(); });
async function ficha(id) {
  const p = byId.get(id) || await leer('individuos', id); if (!p) return;
  const padres = await Promise.all((p.padres || []).map(async x => (byId.get(x) || await leer('individuos', x) || { nombre: x }).nombre));
  const mut = p.mut || {};
  const nacio = mut.nacio ? mut.nacio : `cruce (${mut.cruce ? mut.cruce.a + ' bloques de un padre, ' + mut.cruce.b + ' del otro' : '—'}), ${mut.total || 0} genes mutados con σ ${(mut.sigma || 0).toFixed(3)}`;
  let h = `<h3>${esc(p.nombre)}</h3><div class="sub">${esc(p.id)} · nació en la generación ${p.gen} · sangre de ${esc(p.origen)}</div>`;
  h += `<dl class="kv"><dt>Padres</dt><dd>${padres.length ? padres.map(esc).join(' × ') : 'ninguno'}</dd><dt>Cómo nació</dt><dd>${esc(nacio)}</dd>` +
    `<dt>Elo</dt><dd>${Math.round(p.elo)}</dd><dt>Partidas</dt><dd>${p.partidas.g} ganadas · ${p.partidas.e} tablas · ${p.partidas.p} perdidas</dd>` +
    `<dt>Esta generación</dt><dd>${p.pts || 0} puntos</dd></dl>`;
  if (p.hist && p.hist.length > 1) h += '<h2>Su Elo por generación</h2>' + chispa(p.hist.map(x => x.elo), 'Elo de ' + p.nombre);
  if (mut.cambios) {
    const top = Object.entries(mut.cambios).sort((a, b) => b[1] - a[1]).slice(0, 6);
    h += '<h2>Dónde mutó</h2><div class="det">' + top.map(([k, n]) => `<span>${esc(bloqueNombre(k))}</span><span class="v">${n} genes</span>`).join('') + '</div>';
  }
  if (p.genes) {
    const g = p.genes, piezas = ['peón', 'caballo', 'alfil', 'torre', 'dama'];
    h += '<h2>Valor de sus piezas (medio juego)</h2><div class="det">' + piezas.map((n, i) => `<span>${n}</span><span class="v">${(g.d1[1 + i * 5 + 1] / 100).toFixed(2)}</span>`).join('') + '</div>';
    h += '<h2>Cómo piensa</h2><div class="det">' + M.PIENSA.map((n, i) => `<span>${esc(n)}</span><span class="v">${g.piensa[i].toFixed(2)}</span>`).join('') + '</div>';
    for (const c of [0, 1, 2]) {
      const ds = M.DET.filter(d => d.coste === c), on = ds.filter(d => g['d' + d.n][0] > 0).length;
      h += `<h2>Detectores ${M.COSTE[c]}s · ${on}/${ds.length} encendidos</h2><div class="det">` +
        ds.map(d => { const a = g['d' + d.n], o = a[0] > 0; return `<span class="${o ? 'on' : 'off'}">${d.n}. ${esc(d.nombre)}</span><span class="v">${o && d.n !== 4 ? a[2].toFixed(1) : ''}</span>`; }).join('') + '</div>';
    }
    h += '<p class="nota">El número de cada detector es el peso de su primera medida en el medio juego.</p>';
  } else h += '<p class="nota">De esta araña solo queda el resumen: sus genes no se guardan porque nunca llegó a la élite.</p>';
  hoja(h + '<div class="ctrl" style="margin-top:14px"><button class="btn sec" data-cerrar>Cerrar</button></div>');
}
function bloqueNombre(k) { if (k === 'jugada') return 'Valor de cada jugada'; if (k === 'piensa') return 'Cómo piensa'; const d = M.DET_BY[k]; return d ? d.n + '. ' + d.nombre : k; }

/* ───── Opciones ───── */
function opciones() {
  const sel = (k, vals, fmt) => `<select data-k="${k}">${vals.map(v => `<option value="${v}"${opc[k] === v ? ' selected' : ''}>${fmt(v)}</option>`).join('')}</select>`;
  hoja(`<h3>Opciones de entrenamiento</h3><div class="sub">Se aplican a la próxima generación</div>
    <label class="op">Tiempo por jugada ${sel('ms', [10, 30, 60, 120, 250], v => v + ' ms')}</label>
    <label class="op">Profundidad máxima ${sel('prof', [2, 3, 4, 5, 6], v => v + ' jugadas')}</label>
    <label class="op">Partidas por araña ${sel('rondas', [2, 4, 6, 8], v => v * 2)}</label>
    <label class="op">Límite de jugadas ${sel('maxPlies', [120, 160, 240], v => v / 2)}</label>
    <p class="nota">Más tiempo por jugada juega mejor pero evoluciona más despacio. Con ${NHILOS} hilos, una generación de ${pop.length} arañas tarda unos ${Math.max(1, Math.round(pop.length * opc.rondas * (opc.maxPlies * .45) * opc.ms / 1000 / NHILOS / 60))} min.</p>
    <div class="ctrl"><button class="btn sec" id="exp">Exportar copia</button><button class="btn sec" id="reset">Empezar de cero</button><button class="btn" data-cerrar>Hecho</button></div>`);
  $('#hojac').querySelectorAll('select').forEach(s => s.onchange = () => { opc[s.dataset.k] = +s.value; guardarOpc(); });
  $('#exp').onclick = exportar;
  $('#reset').onclick = async () => {
    if (!confirm('¿Borro todas las arañas y empiezo en la generación 1? Haga antes una copia si la quiere.')) return;
    entrenar(false); hilos.forEach(w => w.terminate()); hilos.length = 0;
    if (db) { db.close(); await new Promise(ok => { const r = indexedDB.deleteDatabase('arana-ajedrez'); r.onsuccess = r.onerror = r.onblocked = ok; }); }
    location.reload();
  };
}
async function exportar() {
  const datos = { app: 'arana-ajedrez', v: 1, origen: ORIGEN, fecha: new Date().toISOString(), estado: est, individuos: await todos('individuos'), generaciones: await todos('generaciones'), partidas: await todos('partidas') };
  if (!db) datos.individuos = pop;
  const nombreF = `arana-ajedrez-${ORIGEN}-gen${est.gen}.json`, blob = new Blob([JSON.stringify(datos)], { type: 'application/json' });
  try { const f = new File([blob], nombreF, { type: 'application/json' }); if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: nombreF }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombreF; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ───── Botones ───── */
$('#go').onclick = () => entrenar(!entrenando);
$('#vista').onclick = () => { opc.directo = !opc.directo; guardarOpc(); $('#vista').setAttribute('aria-pressed', String(opc.directo)); $('#vista').textContent = opc.directo ? 'Directo' : 'Resumen'; pintarMesas(true); pintarEstado(); };
$('#opc').onclick = opciones;
$('#salir').onclick = () => { entrenar(false); if (window.parent !== window) window.parent.postMessage({ arana: 'ajedrez-salir' }, '*'); else location.href = '../'; };
document.addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b && b.dataset.id && !b.closest('#hoja')) ficha(b.dataset.id); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarHoja(); });
window.addEventListener('message', e => { if (e.data && e.data.arana === 'ajedrez-entrenar') entrenar(true); });

/* Para pruebas */
window.__sala = { estado: () => est, pop: () => pop, juegos: () => juegos, entrenar, ficha, opciones, cerrarGeneracion, exportar };

cargar().then(() => {
  $('#vista').setAttribute('aria-pressed', String(opc.directo)); $('#vista').textContent = opc.directo ? 'Directo' : 'Resumen';
  crearHilos(); pintarMesas(true); pintarEstado();
  if (qs.get('entrenar') === '1') entrenar(true);
}).catch(e => { $('#estado').textContent = 'No he podido abrir la sala: ' + e.message; });
})();
