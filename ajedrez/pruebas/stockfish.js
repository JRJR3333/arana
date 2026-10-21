// node ajedrez/pruebas/stockfish.js — el Stockfish de la escalera responde por UCI y la araña clásica juega contra el peldaño 1
const M = require('../motor.js'), { spawn } = require('child_process'), path = require('path');
const ch = spawn(process.execPath, [path.join(__dirname, '../stockfish/stockfish-19-lite-single.js')], { stdio: 'pipe' });
let buf = '', espera = null;
ch.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (espera) { espera.ls.push(l); if (espera.re.test(l)) { const e = espera; espera = null; e.ok(e.ls); } } } });
const cmd = (s, re) => new Promise(ok => { espera = { re, ok, ls: [] }; ch.stdin.write(s + '\n'); });
(async () => {
  const t = setTimeout(() => { console.log('Stockfish no responde'); process.exit(1); }, 60000);
  await cmd('uci', /^uciok/); ch.stdin.write('setoption name Skill Level value 0\n'); await cmd('isready', /^readyok/);
  const C = M.compilar(M.genomaClasico(M.mulberry(1), 0)), pos = new M.Pos(), jug = []; let f;
  while (!(f = M.fin(pos)) && jug.length < 160) {
    let u;
    if (pos.side === 0) u = M.uci(new M.Buscador(C).pensar(pos, 30, 4).move);
    else { ch.stdin.write('position startpos' + (jug.length ? ' moves ' + jug.join(' ') : '') + '\n'); const ls = await cmd('go depth 1', /^bestmove/); u = ls[ls.length - 1].split(' ')[1]; }
    const m = M.parseUci(pos, u); if (!m) { console.log('jugada imposible', u); process.exit(1); } pos.make(m); jug.push(u);
  }
  clearTimeout(t); ch.kill();
  console.log('stockfish: responde · araña clásica contra el peldaño 1:', f ? (f.res === 1 ? 'gana' : f.res === 0 ? 'pierde' : 'tablas') + ' (' + f.motivo + ')' : 'límite', 'en', jug.length, 'medias jugadas');
})();
