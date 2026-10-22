// node ajedrez/pruebas/mcts.js — la búsqueda de la red (fase 3) con un evaluador de juguete (material, política uniforme):
// encuentra el mate en una, captura la dama colgada, no regala la suya, deja la posición como estaba y juega una partida legal.
const M = require('../motor.js'), MCTS = require('../mcts.js');
let fallos = 0; const mal = t => { console.log('MAL:', t); fallos++; };
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const material = fen => { const [pl, lado] = fen.split(' '); let m = 0; for (const ch of pl) { const v = VAL[ch.toLowerCase()]; if (v) m += (ch === ch.toUpperCase() ? 1 : -1) * v; } return lado === 'b' ? -m : m; };
let llamadas = 0;
const evaluar = async fens => { llamadas++; return fens.map(f => ({ v: Math.tanh(material(f) / 6), logits: new Float32Array(4096) })); };
(async () => {
  const casos = [
    ['mate del pastor (Dxf7#)', 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 2 3', ['f3f7']],
    ['capturar la dama colgada', 'rnb1kbnr/pppp1ppp/8/4p3/3q4/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 3', ['f3d4']],
    ['no regalar la dama', 'rnbqkbnr/ppp2ppp/8/3pp3/4P3/5Q2/PPPP1PPP/RNB1KBNR w KQkq - 0 3', null]
  ];
  for (const [nombre, fen, buenas] of casos) {
    const pos = new M.Pos(fen), antes = pos.fen(), t0 = Date.now();
    const r = await MCTS.buscar(pos, evaluar, { sims: 800, lote: 32 });
    if (pos.fen() !== antes) mal(nombre + ': la posición no ha quedado igual');
    const ok = buenas ? buenas.includes(r.uci) : (() => { const p = new M.Pos(fen); p.make(M.parseUci(p, r.uci)); return !M.legal(p).some(m => { const u = M.uci(m), q = p.b[M.mTo(m)]; return q && (q & 7) === 5 && (q >> 3) === 0; }); })();
    console.log(`${ok ? '✓' : '✗'} ${nombre}: ${r.uci} (q ${r.q.toFixed(2)}, ${r.sims} simulaciones en ${r.lotes} lotes, ${Date.now() - t0} ms) · ${r.pv.join(' ')}`);
    if (!ok) mal(nombre);
  }
  // el mate en una para las negras también
  { const r = await MCTS.buscar(new M.Pos('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2'), evaluar, { sims: 800, lote: 32 });
    const ok = r.uci === 'd8h4'; console.log(`${ok ? '✓' : '✗'} mate del loco con negras: ${r.uci}`); if (!ok) mal('mate con negras'); }
  // una partida entera contra sí misma: todo legal y termina
  { const pos = new M.Pos(); let f = null, n = 0;
    while (!(f = M.fin(pos)) && n < 200) { const r = await MCTS.buscar(pos, evaluar, { sims: 64, lote: 16, temperatura: n < 10 ? 1 : 0 }); const m = M.parseUci(pos, r.uci); if (!m) { mal('jugada ilegal ' + r.uci); break; } pos.make(m); n++; }
    console.log(`✓ partida contra sí misma: ${n} medias jugadas${f ? ', ' + f.motivo : ''}`); }
  // con ruido de Dirichlet en la raíz sigue viendo el mate, y varía en la apertura
  { const rr = M.mulberry(3); const r = await MCTS.buscar(new M.Pos('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 2 3'), evaluar, { sims: 800, lote: 32, ruido: { alfa: .3, eps: .25 }, rng: rr });
    const v = new Set(); for (let k = 0; k < 6; k++) v.add((await MCTS.buscar(new M.Pos(), evaluar, { sims: 64, lote: 16, temperatura: 1, ruido: { alfa: .3, eps: .25 }, rng: rr })).uci);
    const ok = r.uci === 'f3f7' && v.size > 1; console.log(`${ok ? '✓' : '✗'} con ruido: mate ${r.uci}, ${v.size} primeras jugadas distintas en 6 partidas`); if (!ok) mal('ruido'); }
  console.log(fallos ? `${fallos} fallos` : 'mcts: todo bien');
  process.exit(fallos ? 1 : 0);
})();
