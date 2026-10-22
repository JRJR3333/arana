// node ajedrez/pruebas/gradiente.js — distópica 39: las medidas reproducen la valoración exacta, Stockfish etiqueta
// posiciones tranquilas y unos pasos de gradiente bajan el error de una araña al azar.
const M = require('../motor.js'), { spawn } = require('child_process'), path = require('path');
const rng = M.mulberry(5), F = M.todasDist();
let fallos = 0; const mal = t => { console.log('MAL:', t); fallos++; };

// 1) Posiciones tranquilas de partidas rápidas entre arañas clásicas con ruido
const fens = [];
for (let p = 0; p < 16; p++) {
  const a = M.compilar(M.genomaClasico(rng, .1), F), b = M.compilar(M.genomaClasico(rng, .1), F), fen = M.aperturaAleatoria(rng, 4);
  const r = M.jugar(a, b, fen, { ms: 5, prof: 3, maxPlies: 100 }), pos = new M.Pos(fen);
  r.jugadas.forEach((u, k) => { const m = M.parseUci(pos, u); if (!m) return; pos.make(m); if (k >= 8 && !M.fin(pos) && M.tranquila(pos)) fens.push(pos.fen()); });
}
console.log('posiciones tranquilas:', fens.length);
if (fens.length < 200) mal('pocas posiciones');

// 2) W·medidas = evaluar (sin red), con y sin «un cerebro por fase»
for (const f33 of [1, 0]) {
  const Fx = Object.assign({}, F, { 33: f33, 29: 0 }), g = M.genomaAzar(rng), C = M.compilar(g, Fx);
  let max = 0;
  for (const fen of fens.slice(0, 150)) {
    const pos = new M.Pos(fen), r = M.rasgosPos(pos); let v = 0;
    const T = M.compilar((() => { const t = M.genomaClasico(() => .5, 0); for (const d of M.DET) t['d' + d.n][0] = 1; return t; })(), M.todasDist());
    for (let k = 0; k < r.i.length; k++) {
      const idx = r.i[k]; const it = T.lista.find(x => idx >= x.off && idx < x.off + x.d.nf * 5), a = g['d' + it.d.n];
      if (!(a[0] > 0)) continue;
      const rel = idx - it.off, c = rel % 5, i = 1 + rel - c;
      const w = c === 0 ? (f33 ? a[i] : a[i + 1]) : c === 2 ? (f33 ? a[i + 2] : a[i + 1]) : a[i + c];
      v += w * r.v[k];
    }
    max = Math.max(max, Math.abs(v - M.evaluar(pos, C) * (pos.side ? -1 : 1)));
    if (fens.indexOf(fen) > 40) break;
  }
  console.log(`medidas × pesos = valoración (cerebro por fase ${f33 ? 'sí' : 'no'}): diferencia máxima ${max.toExponential(1)}`);
  if (max > 1e-6) mal('la valoración no coincide');
}

// 3) Stockfish etiqueta y el gradiente baja el error
const ch = spawn(process.execPath, [path.join(__dirname, '../stockfish/stockfish-19-lite-single.js')], { stdio: 'pipe' });
let buf = '', espera = null;
ch.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (espera) { espera.ls.push(l); if (espera.re.test(l)) { const e = espera; espera = null; e.ok(e.ls); } } } });
const cmd = (s, re) => new Promise(ok => { espera = { re, ok, ls: [] }; ch.stdin.write(s + '\n'); });
const punt = ls => { for (let i = ls.length - 1; i >= 0; i--) { const m = / score (cp|mate) (-?\d+)/.exec(ls[i]); if (m) return m[1] === 'cp' ? +m[2] : (+m[2] > 0 ? 20000 : -20000); } return null; };
(async () => {
  const t = setTimeout(() => { console.log('Stockfish no responde'); process.exit(1); }, 240000);
  await cmd('uci', /^uciok/); await cmd('isready', /^readyok/);
  const datos = [], t0 = Date.now();
  for (const fen of fens.slice(0, 400)) {
    ch.stdin.write('position fen ' + fen + '\n');
    const sc = punt(await cmd('go depth 8', /^bestmove/)); if (sc == null) continue;
    const cp = Math.max(-1500, Math.min(1500, / w /.test(fen) ? sc : -sc)), r = M.rasgosPos(new M.Pos(fen));
    datos.push(Object.assign(r, { y: 1 / (1 + Math.exp(-M.K_TEXEL * cp)) }));
  }
  const ms = (Date.now() - t0) / datos.length;
  clearTimeout(t); ch.kill();
  console.log(`Stockfish a profundidad 8: ${datos.length} posiciones, ${ms.toFixed(0)} ms cada una`);
  const g = M.genomaAzar(rng), errs = []; let t1 = Date.now();
  for (let k = 0; k < 15; k++) { const r = M.ajustarGradiente(g, datos, null, rng, F); errs.push((r.antes * 1000).toFixed(2)); }
  console.log('error de validación (‰) de una araña al azar en 15 generaciones:', errs.join(' → '), `(${((Date.now() - t1) / 15).toFixed(0)} ms por ajuste)`);
  if (!(+errs[errs.length - 1] < +errs[0])) mal('el gradiente no baja el error');
  const dec = String(g.d1[2]).split('.')[1] || '';
  console.log('valor de un caballo tras el gradiente:', g.d1[2], `(${dec.length} decimales)`);
  if (dec.length > 6) mal('más de 6 decimales');
  console.log(fallos ? `${fallos} fallos` : 'gradiente: todo bien');
  process.exit(fallos ? 1 : 0);
})();
