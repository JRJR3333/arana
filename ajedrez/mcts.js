/* Araña · búsqueda de la red en la gráfica (distópica 40, fase 3, 0.39.0). Como Leela: MCTS con PUCT.
   - Cada nodo guarda N (visitas), W (suma de valores, vistos por el que hizo la jugada que lleva a él) y P (lo que la política
     de la red le daba). Se baja eligiendo el hijo con mayor Q + U, donde U = cpuct · P · √N(padre) / (1 + N(hijo)).
   - Por lotes: se bajan muchas simulaciones seguidas con «pérdida virtual» (cuenta la visita como si perdiera mientras espera),
     así cada simulación va por un camino distinto, y todas las hojas se valoran de una vez en la gráfica.
   - Las hojas que acaban la partida (mate, tablas) se valoran exactas, sin la red.
   evaluar(fens) → promesa de [{ v: valor −1…1 desde el que mueve, logits: 4096 números de la política }].
   Funciona en el navegador y en Node (con motor.js y red.js). */
(function (raiz) {
  'use strict';
  const M = raiz.AjedrezMotor || (typeof require !== 'undefined' ? require('./motor.js') : null);
  const R = raiz.Red || (typeof require !== 'undefined' ? require('./red.js') : null);

  function Nodo(P) { this.P = P; this.N = 0; this.W = 0; this.hijos = null; this.final = null; this.espera = false; }

  /* Reparte la política de la red entre las jugadas legales (softmax solo sobre ellas) */
  function abrir(nodo, ucis, negras, logits) {
    let mx = -Infinity; const ls = ucis.map(u => { const i = R.indiceJugada(u, negras); const l = i >= 0 ? logits[i] : -30; if (l > mx) mx = l; return l; });
    let s = 0; const e = ls.map(l => { const x = Math.exp(l - mx); s += x; return x; });
    nodo.hijos = ucis.map((u, k) => ({ uci: u, nodo: new Nodo(e[k] / s) }));
  }
  function elegirHijo(nodo, cpuct, fpu) {
    const raizN = Math.sqrt(Math.max(1, nodo.N)), qPadre = nodo.N ? -nodo.W / nodo.N : 0;   // nodo.W es del rival: para mí, al revés
    let mejor = null, mv = -Infinity;
    for (const h of nodo.hijos) {
      const c = h.nodo, q = c.N ? c.W / c.N : qPadre - fpu, u = cpuct * c.P * raizN / (1 + c.N), v = q + u;
      if (v > mv) { mv = v; mejor = h; }
    }
    return mejor;
  }
  /* El valor de una posición final desde el que mueve: si no tiene jugadas y está en jaque, ha perdido */
  const valorFinal = (f, pos) => (f.motivo === 'mate' ? -1 : 0);

  /* La búsqueda. pos: posición con su historia (se deja como estaba). Devuelve la jugada, sus visitas y la valoración. */
  async function buscar(pos, evaluar, op) {
    op = Object.assign({ sims: 400, lote: 64, cpuct: 1.8, fpu: .3, temperatura: 0, rng: Math.random }, op || {});
    const raizNodo = new Nodo(1), negras0 = pos.side === 1;
    const f0 = M.fin(pos); if (f0) return { uci: null, final: f0 };
    const legales0 = M.legal(pos).map(M.uci);
    { const [r] = await evaluar([pos.fen()]); abrir(raizNodo, legales0, negras0, r.logits); raizNodo.N = 1; raizNodo.W = -r.v; }
    if (legales0.length === 1) return { uci: legales0[0], visitas: [[legales0[0], 1]], q: r0q(raizNodo), sims: 0 };
    let hechas = 0, lotes = 0;
    while (hechas < op.sims) {
      const hojas = [];
      for (let k = 0; k < op.lote && hechas + hojas.length < op.sims; k++) {
        const camino = [raizNodo]; let nodo = raizNodo, hechos = 0;
        while (nodo.hijos && nodo.hijos.length) {
          const h = elegirHijo(nodo, op.cpuct, op.fpu);
          pos.make(M.parseUci(pos, h.uci)); hechos++;
          nodo = h.nodo; camino.push(nodo);
          if (nodo.final || !nodo.hijos) break;
        }
        // pérdida virtual por todo el camino
        for (const n of camino) { n.N++; n.W--; }
        let hoja = null;
        if (nodo.final) hoja = { camino, v: nodo.final.v };
        else if (nodo.espera) { for (const n of camino) { n.N--; n.W++; } for (let i = 0; i < hechos; i++) pos.unmake(); break; }   // ya está pedida en este lote
        else {
          const f = M.fin(pos);
          if (f) { nodo.final = { v: valorFinal(f, pos), f }; hoja = { camino, v: nodo.final.v }; }
          else { nodo.espera = true; hoja = { camino, fen: pos.fen(), ucis: M.legal(pos).map(M.uci), negras: pos.side === 1 }; }
        }
        for (let i = 0; i < hechos; i++) pos.unmake();
        hojas.push(hoja);
      }
      if (!hojas.length) break;
      const pedir = hojas.filter(h => h.fen), res = pedir.length ? await evaluar(pedir.map(h => h.fen)) : [];
      pedir.forEach((h, i) => { const n = h.camino[h.camino.length - 1]; abrir(n, h.ucis, h.negras, res[i].logits); n.espera = false; h.v = res[i].v; });
      // hacia arriba: quitar la pérdida virtual y sumar el valor de verdad, cambiando de signo en cada nivel
      for (const h of hojas) {
        let v = -h.v;   // el valor de la hoja es del que mueve en ella; para el que hizo la jugada que lleva a ella, al revés
        for (let i = h.camino.length - 1; i >= 0; i--) { const n = h.camino[i]; n.N--; n.W++; n.N++; n.W += v; v = -v; }
      }
      hechas += hojas.length; lotes++;
    }
    const visitas = raizNodo.hijos.map(h => [h.uci, h.nodo.N, h.nodo.N ? h.nodo.W / h.nodo.N : 0]).sort((a, b) => b[1] - a[1]);
    let uci = visitas[0][0];
    if (op.temperatura > 0) {   // al principio de la partida, un poco al azar entre las más visitadas (para variar)
      const pes = visitas.map(x => Math.pow(x[1], 1 / op.temperatura)), t = pes.reduce((a, b) => a + b, 0); let r = op.rng() * t;
      for (let i = 0; i < pes.length; i++) { r -= pes[i]; if (r <= 0) { uci = visitas[i][0]; break; } }
    }
    return { uci, visitas, q: r0q(raizNodo), sims: hechas, lotes, pv: variante(raizNodo) };
  }
  const r0q = n => (n.N ? -n.W / n.N : 0);   // valoración de la raíz para el que mueve
  function variante(n) { const pv = []; while (n.hijos && n.hijos.length && pv.length < 8) { const h = n.hijos.reduce((a, b) => (b.nodo.N > a.nodo.N ? b : a)); if (!h.nodo.N) break; pv.push(h.uci); n = h.nodo; } return pv; }

  const MCTS = { buscar };
  if (typeof module !== 'undefined' && module.exports) module.exports = MCTS; else raiz.MCTS = MCTS;
})(typeof self !== 'undefined' ? self : this);
