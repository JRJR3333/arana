/* Un hilo de partidas: recibe dos arañas y una apertura, juega y devuelve el resultado.
   En directo manda cada jugada a la sala para dibujarla. */
importScripts('motor.js');
const M = self.AjedrezMotor, cache = new Map();
function compilado(ind) {
  let c = cache.get(ind.id);
  if (!c) { c = M.compilar(ind.genes); cache.set(ind.id, c); if (cache.size > 80) cache.delete(cache.keys().next().value); }
  return c;
}
self.onmessage = e => {
  const d = e.data;
  if (d.t === 'pensar') {   // una sola jugada (contra Stockfish): repite la partida hasta aquí y piensa
    try {
      const pos = new M.Pos(d.fen0); for (const u of d.jugadas) { const m = M.parseUci(pos, u); if (!m) throw new Error('jugada ' + u); pos.make(m); }
      const r = new M.Buscador(compilado(d.ind)).pensar(pos, d.ms, d.prof);
      self.postMessage({ t: 'pensado', id: d.id, uci: r.move ? M.uci(r.move) : null, eval: pos.side ? -r.score : r.score });
    } catch (err) { self.postMessage({ t: 'pensado', id: d.id, uci: null, error: err && err.message }); }
    return;
  }
  if (d.t !== 'partida') return;
  try {
    const cw = compilado(d.w), cb = compilado(d.b);
    const r = M.jugar(cw, cb, d.fen, d.opc, d.directo ? i => self.postMessage({ t: 'jugada', id: d.id, uci: i.uci, fen: i.fen, eval: i.eval, prof: i.prof }) : null);
    self.postMessage({ t: 'fin', id: d.id, res: r.res, motivo: r.motivo, jugadas: r.jugadas, plies: r.plies, evals: r.evals, fen: r.fen });
  } catch (err) {
    self.postMessage({ t: 'fin', id: d.id, res: .5, motivo: 'error: ' + (err && err.message), jugadas: [], plies: 0, evals: [], fen: d.fen });
  }
};
