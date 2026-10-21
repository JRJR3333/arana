// node ajedrez/pruebas/reglas.js — comprueba las reglas (perft) y que la evaluación es simétrica
const M = require('../motor.js');
const casos = [
  [M.INICIO, [20, 400, 8902, 197281]],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
];
let mal = 0;
for (const [fen, esp] of casos) esp.forEach((n, i) => { const p = new M.Pos(fen), r = M.perft(p, i + 1); if (r !== n) { mal++; console.log('PERFT MAL', fen, i + 1, r, '≠', n); } if (p.fen() !== new M.Pos(fen).fen()) { mal++; console.log('NO RESTAURA', fen); } });
console.log('perft:', mal ? mal + ' fallos' : 'todo bien');
// Simetría: la misma posición vista con los colores cambiados debe valer igual para quien mueve
function espejo(fen) {
  const f = fen.split(' ');
  const filas = f[0].split('/').reverse().map(r => r.replace(/[a-z]/gi, c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
  const cs = f[2] === '-' ? '-' : f[2].replace(/[a-z]/gi, c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()).split('').sort().join('');
  const ep = f[3] === '-' ? '-' : f[3][0] + (9 - +f[3][1]);
  return [filas.join('/'), f[1] === 'w' ? 'b' : 'w', cs, ep, f[4], f[5]].join(' ');
}
const rng = M.mulberry(7); let asim = 0, posiciones = 0;
const C = M.compilar((() => { const g = M.genomaAzar(rng); for (const d of M.DET) g['d' + d.n][0] = 1; return g; })());
for (let partida = 0; partida < 30; partida++) {
  const p = new M.Pos();
  for (let i = 0; i < 80; i++) {
    const ms = M.legal(p); if (!ms.length) break; p.make(ms[Math.floor(rng() * ms.length)]);
    const a = M.evaluar(p, C), b = M.evaluar(new M.Pos(espejo(p.fen())), C); posiciones++;
    if (Math.abs(a - b) > 1e-6) { asim++; if (asim < 4) { const e1 = M.explicar(p, C), e2 = M.explicar(new M.Pos(espejo(p.fen())), C); const m2 = new Map(e2.detectores.map(d => [d.n, d.v])); console.log('ASIMÉTRICA', p.fen(), a, b, e1.detectores.filter(d => m2.get(d.n) !== d.v).map(d => d.n + ':' + d.v + '/' + m2.get(d.n))); } }
  }
}
console.log('simetría:', posiciones, 'posiciones,', asim ? asim + ' asimétricas' : 'todas simétricas');
process.exit(mal || asim ? 1 : 0);
