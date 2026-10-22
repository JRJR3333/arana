/* Un hilo de partidas: recibe dos arañas y una apertura, juega y devuelve el resultado.
   En directo manda cada jugada a la sala para dibujarla. También piensa jugadas sueltas (contra Stockfish).
   flags: interruptores de las distópicas; aj: memoria del rival (35). */
importScripts('motor.js');
const M = self.AjedrezMotor, cache = new Map();
function compilado(ind, flags) {
  const k = ind.id + '|' + (flags ? Object.keys(flags).filter(n => flags[n]).join(',') : '*');
  let c = cache.get(k);
  if (!c) { c = M.compilar(M.completar(ind.genes), flags); cache.set(k, c); if (cache.size > 80) cache.delete(cache.keys().next().value); }
  return c;
}
/* Banco de pruebas: la misma búsqueda siempre (mismos nodos), así lo que tarda mide la velocidad del aparato en este momento.
   Si baja mucho, el aparato se está calentando o ahorrando batería. Devuelve nodos por milisegundo. */
let C_BANCO = null;
const FEN_BANCO = 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 8';
function banco() {
  if (!C_BANCO) C_BANCO = M.compilar(M.genomaClasico(M.mulberry(1), 0));
  let mejor = 0;
  for (let i = 0; i < 2; i++) { const t = performance.now(), r = new M.Buscador(C_BANCO).pensar(new M.Pos(FEN_BANCO), 1e9, 3); mejor = Math.max(mejor, r.nodes / Math.max(1, performance.now() - t)); }
  return Math.round(mejor);
}
self.onmessage = e => {
  const d = e.data;
  if (d.t === 'banco') { self.postMessage({ t: 'banco', id: d.id, nps: banco() }); return; }
  if (d.t === 'pensar') {   // una sola jugada: repite la partida hasta aquí y piensa
    try {
      const pos = new M.Pos(d.fen0); for (const u of d.jugadas) { const m = M.parseUci(pos, u); if (!m) throw new Error('jugada ' + u); pos.make(m); }
      const b = new M.Buscador(compilado(d.ind, d.flags)); b.aj = d.aj || null;
      const r = b.pensar(pos, d.ms, d.prof);
      self.postMessage({ t: 'pensado', id: d.id, uci: r.move ? M.uci(r.move) : null, eval: pos.side ? -r.score : r.score });
    } catch (err) { self.postMessage({ t: 'pensado', id: d.id, uci: null, error: err && err.message }); }
    return;
  }
  if (d.t !== 'partida') return;
  const nps = d.banco ? banco() : null;
  try {
    const cw = compilado(d.w, d.flags), cb = compilado(d.b, d.flags);
    const r = M.jugar(cw, cb, d.fen, d.opc, d.directo ? i => self.postMessage({ t: 'jugada', id: d.id, uci: i.uci, fen: i.fen, eval: i.eval, prof: i.prof }) : null, d.ajW, d.ajB);
    self.postMessage({ t: 'fin', id: d.id, res: r.res, motivo: r.motivo, jugadas: r.jugadas, plies: r.plies, evals: r.evals, fen: r.fen, nps });
  } catch (err) {
    self.postMessage({ t: 'fin', id: d.id, res: .5, motivo: 'error: ' + (err && err.message), jugadas: [], plies: 0, evals: [], fen: d.fen });
  }
};
