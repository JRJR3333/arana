// node ajedrez/pruebas/evolucion.js [generaciones] — unas generaciones pequeñas de punta a punta, sin navegador
const M = require('../motor.js');
const G = +(process.argv[2] || 3), rng = M.mulberry(42);
const opc = { ms: 4, prof: 3, maxPlies: 140 };
let est = { gen: 1, origen: 'web', opc: { poblacion: 16, elite: 3, rondas: 2 } };
let pop = M.poblacionInicial(rng, 'web', 16);
const t0 = Date.now();
for (let g = 0; g < G; g++) {
  pop.forEach(p => { p.pts = 0; });
  const byId = new Map(pop.map(p => [p.id, p])), juegos = M.emparejar(pop, est.opc.rondas, rng);
  const comp = new Map(pop.map(p => [p.id, M.compilar(p.genes)]));
  for (const j of juegos) {
    const w = byId.get(j.w), b = byId.get(j.b), r = M.jugar(comp.get(j.w), comp.get(j.b), j.fen, opc);
    w.pts += r.res; b.pts += 1 - r.res; M.actualizarElo(w, b, r.res);
    for (const [p, v] of [[w, r.res], [b, 1 - r.res]]) p.partidas[v === 1 ? 'g' : v === 0 ? 'p' : 'e']++;
  }
  const out = M.siguienteGeneracion(est, pop, rng); est = out.est; pop = out.pop;
  const s = out.resumen;
  console.log(`gen ${s.gen}: mejor ${s.mejor.nombre} ${s.mejor.pts} pts (Elo ${s.mejor.elo}), media ${s.mediaPts.toFixed(2)}, sigma ${s.sigma.toFixed(3)}, diversidad ${s.diversidad.toFixed(3)}, detectores ${s.encendidos.toFixed(1)}, ${juegos.length} partidas`);
  if (pop.length !== 16 || pop.some(p => !p.genes || !p.genes.d1)) { console.log('POBLACIÓN ROTA'); process.exit(1); }
  JSON.stringify(pop); // todo tiene que poder guardarse
}
const hijos = pop.filter(p => p.padres.length);
console.log('hijos con padres y mutaciones:', hijos.length, '— ejemplo:', JSON.stringify(hijos[0].mut));
console.log('tiempo:', ((Date.now() - t0) / 1000).toFixed(1), 's');
