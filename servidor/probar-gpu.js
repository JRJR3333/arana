#!/usr/bin/env node
/* Araña · ¿funciona la gráfica? (fase 1 de la red en la gráfica, 0.37.0)
   Abre ajedrez/gpu.html en un Chromium sin ventana, con las mismas opciones que el servidor, y enseña:
   qué gráfica ve WebGPU, si sus cálculos coinciden con los del procesador y a qué velocidad valora la red prevista.
   Prueba en orden las formas de encender la gráfica (vulkan, dawn, gl) y guarda la que funciona en ~/.local/share/arana/gpu.json:
   el servidor la usará al reiniciarse (systemctl --user restart arana).
   Uso:   node ~/arana/servidor/probar-gpu.js                 (prueba normal)
          node ~/arana/servidor/probar-gpu.js --variante dawn (solo esa forma)
          node ~/arana/servidor/probar-gpu.js --parar-llama   (para llama-server durante la prueba y lo reanuda al acabar)
          node ~/arana/servidor/probar-gpu.js --diagnostico   (lo que dice chrome://gpu con cada forma, para Claude)
          node ~/arana/servidor/probar-gpu.js --red --variante nativo --F 64 --nb 6 --B 256 --pasos 300 --bench 1
                                                               (fase 2: la red da lo mismo que el procesador, sus gradientes, que aprende y su velocidad)
          node ~/arana/servidor/probar-gpu.js --lote 1024 --filtros 128 --bloques 10
   No necesita parar el servicio arana. */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const { buscarChromium, argsGPU, VARIANTES, GPU_JSON, pararLlama, reanudarLlama, procesosLlama } = require('./comun.js');

const WEB = path.resolve(__dirname, '..'), arg = process.argv.slice(2);
const val = k => { const i = arg.indexOf('--' + k); return i >= 0 ? arg[i + 1] : null; };
const PAGINA = process.argv.includes('--red') ? 'pruebas/red.html' : 'gpu.html';
const q = ['lote', 'filtros', 'bloques', 'vueltas', 'F', 'nb', 'B', 'pasos', 'bench'].filter(val).map(k => `${k}=${+val(k)}`).join('&');
let PUERTO_DIAG = 0;
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };

const srv = http.createServer((req, res) => {
  const f = path.normalize(path.join(WEB, decodeURIComponent(req.url.split('?')[0])));
  if (!f.startsWith(WEB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' }); res.end(b); });
}).listen(0, '127.0.0.1', async () => {
  const puerto = PUERTO_DIAG = srv.address().port, perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'arana-gpu-'));
  const conLlama = arg.includes('--parar-llama');
  const ll = procesosLlama();
  console.log(ll.length ? `llama-server está abierto (pid ${ll[0].pid}${ll[0].unidad ? ', servicio ' + ll[0].unidad : ', lanzado a mano'}).` : 'llama-server no está abierto.');
  if (conLlama && ll.length) { const r = await pararLlama(); if (r.error) console.log('· No he podido pararlo:', r.error); }
  if (arg.includes('--diagnostico')) {
    for (const v of (val('variante') ? [val('variante')] : Object.keys(VARIANTES))) { console.log(`\n══ Forma «${v}» ══`); console.log(await diagnostico(v)); }
    if (conLlama) await reanudarLlama(); srv.close(); process.exit(0);
  }
  const soloUna = val('variante'), lista = soloUna ? [soloUna] : Object.keys(VARIANTES);
  const fin = async codigo => { if (conLlama) await reanudarLlama(); srv.close(); process.exit(codigo); };
  let bueno = null, ultimo = null;
  for (const v of lista) {
    if (!VARIANTES[v]) { console.log('No existe la variante', v); continue; }
    process.stdout.write(`· Probando la forma «${v}»… `);
    const r = await probarCon(v, puerto);
    ultimo = r;
    if (r.error) { console.log('no: ' + r.error); continue; }
    if (r.gpu && r.gpu.simulada && process.env.ARANA_GPU_SIMULADA !== '1') { console.log('solo ve una gráfica simulada'); continue; }
    console.log(r.ok ? 'sí' : PAGINA === 'gpu.html' ? 'calcula mal' : 'responde'); if (r.ok || PAGINA !== 'gpu.html') { bueno = { v, r }; break; }
  }
  console.log('');
  if (!bueno) { console.log('✗ WebGPU no funciona con ninguna forma.' + (ultimo && ultimo.chromium ? '\nLo último que dijo Chromium:\n' + ultimo.chromium : '')); console.log('  Mire «La gráfica» en servidor/LEEME.md.'); return fin(1); }
  const { v: variante, r } = bueno, g = r.gpu;
  console.log(`Gráfica: ${[g.fabricante, g.arquitectura, g.descripcion].filter(Boolean).join(' · ') || '(sin nombre)'}${g.simulada ? '  ← SIMULADA: no usa la NVIDIA' : ''} (forma «${variante}»)`);
  for (const p of r.pruebas) if (p.diferencia != null) console.log(`${p.ok ? '✓' : '✗'} ${p.nombre}: diferencia con el procesador ${p.diferencia.toExponential(1)}`);
  const vel = r.velocidad;
  if (PAGINA !== 'gpu.html') {   // fase 2: la red
    for (const p of r.pruebas) if (p.diferencia == null) console.log(`${p.ok ? '✓' : '✗'} ${p.nombre}`);
    const a = r.aprende; if (a) { console.log(`Red de ${a.F} filtros y ${a.nb} bloques, lote ${a.B}: acierta la jugada ${Math.round(a.antes.acierto * 100)} % → ${Math.round(a.mejor.acierto * 100)} % (mejor momento) · ${a.msPorPaso} ms por paso`); console.log('Curva (paso: error del valor / pérdida de la política / acierto):'); for (const c of a.curva) console.log(`   ${String(c.paso).padStart(5)}: ${c.valor} / ${c.politica} / ${Math.round(c.acierto * 100)} %`); }
    if (vel) console.log(`Entrenamiento (lote ${vel.lote}, ${vel.filtros} filtros, ${vel.bloques} bloques): ${vel.msPorPaso} ms por paso · ${vel.posicionesPorSegundo.toLocaleString('es-ES')} posiciones/s aprendidas`);
    console.log(r.ok ? '\nLa red funciona en la gráfica.' : '\nAlgo no cuadra: mándele esta salida a Claude.');
    return fin(r.ok ? 0 : 1);
  }
  if (vel) console.log(`Velocidad (lote ${vel.lote}, ${vel.filtros} filtros, ${vel.bloques} bloques): ${vel.msPorLote} ms por lote · ${vel.posicionesPorSegundo.toLocaleString('es-ES')} posiciones/s · ${vel.gflops} GFLOP/s`);
  fs.writeFileSync(GPU_JSON, JSON.stringify({ variante, gpu: g, velocidad: vel, fecha: new Date().toISOString() }, null, 1));
  console.log('');
  console.log(`Todo bien: guardado en ${GPU_JSON}. Para que la sala la use:  systemctl --user restart arana`);
  fin(0);
});
/* Abre gpu.html en un Chromium aparte con una forma de encender la gráfica y devuelve lo que mide */
async function probarCon(variante, puerto) {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'arana-gpu-'));
  const args = ['--headless=new', '--no-first-run', ...argsGPU(variante), `--user-data-dir=${perfil}`, '--remote-debugging-port=0', `http://127.0.0.1:${puerto}/ajedrez/${PAGINA}${q ? '?' + q : ''}`];
  if (process.getuid && process.getuid() === 0) args.unshift('--no-sandbox');
  const ch = spawn(buscarChromium(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  const cerrar = res => { try { ch.kill('SIGTERM'); } catch (e) {} setTimeout(() => { try { fs.rmSync(perfil, { recursive: true, force: true }); } catch (e) {} }, 1000); return res; };
  const mal = m => cerrar({ error: m, chromium: err.split('\n').filter(l => /error|vulkan|gpu/i.test(l)).slice(-8).join('\n') });
  try {
    const ws = await Promise.race([
      new Promise((ok, ko) => { ch.stderr.on('data', d => { err += d; const m = err.match(/DevTools listening on (ws:\S+)/); if (m) ok(m[1]); }); ch.on('exit', c => ko(new Error('Chromium se cerró (' + c + ')'))); }),
      new Promise((_, ko) => setTimeout(() => ko(new Error('Chromium no arranca')), 30000))]);
    const base = ws.replace(/^ws:/, 'http:').replace(/\/devtools\/.*/, '');
    let pag = null; for (let i = 0; i < 50 && !pag; i++) { try { pag = (await (await fetch(base + '/json/list')).json()).find(x => x.type === 'page' && x.url.includes(PAGINA.split('/').pop())); } catch (e) {} if (!pag) await new Promise(r => setTimeout(r, 200)); }
    if (!pag) return mal('Chromium no abre la página de prueba');
    const s = new WebSocket(pag.webSocketDebuggerUrl); let id = 0; const esp = new Map();
    s.onmessage = e => { const m = JSON.parse(e.data); if (esp.has(m.id)) { esp.get(m.id)(m.result); esp.delete(m.id); } };
    await new Promise(r => { s.onopen = r; });
    const ev = expr => new Promise(r => { const i = ++id; esp.set(i, r); s.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } })); });
    const t0 = Date.now(); let r = null;
    while (!r) { if (Date.now() - t0 > (PAGINA === 'gpu.html' ? 90000 : 1800000)) return mal('la prueba no termina (Chromium se ha quedado colgado con esta forma)'); await new Promise(k => setTimeout(k, 500)); const x = await ev('window.__prueba || null'); r = x && x.result && x.result.value; }
    s.close();
    return r.error ? mal(r.error) : cerrar(r);
  } catch (e) { return mal(e.message); }
}
/* chrome://gpu con una forma: estado de WebGPU y Vulkan, la gráfica que ve y sus problemas */
async function diagnostico(variante) {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'arana-gpu-'));
  const args = ['--headless=new', '--no-first-run', ...argsGPU(variante), '--enable-logging=stderr', '--allow-chrome-scheme-url', `--user-data-dir=${perfil}`, '--remote-debugging-port=0', 'about:blank'];
  if (process.getuid && process.getuid() === 0) args.unshift('--no-sandbox');
  const ch = spawn(buscarChromium(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  const salir = t => { try { ch.kill('SIGTERM'); } catch (e) {} setTimeout(() => { try { fs.rmSync(perfil, { recursive: true, force: true }); } catch (e) {} }, 1000); return t; };
  const errores = () => err.split('\n').filter(l => /ERROR|vulkan|gpu|dawn|webgpu/i.test(l)).slice(-12).map(l => '  ' + l.slice(0, 220)).join('\n');
  try {
    const ws = await Promise.race([
      new Promise((ok, ko) => { ch.stderr.on('data', d => { err += d; const m = err.match(/DevTools listening on (ws:\S+)/); if (m) ok(m[1]); }); ch.on('exit', c => ko(new Error('Chromium se cerró (' + c + ')'))); }),
      new Promise((_, ko) => setTimeout(() => ko(new Error('Chromium no arranca')), 30000))]);
    const base = ws.replace(/^ws:/, 'http:').replace(/\/devtools\/.*/, '');
    let pag = null; for (let i = 0; i < 50 && !pag; i++) { try { pag = (await (await fetch(base + '/json/list')).json()).find(x => x.type === 'page'); } catch (e) {} if (!pag) await new Promise(r => setTimeout(r, 200)); }
    if (!pag) return salir('No abre chrome://gpu.\n' + errores());
    const s = new WebSocket(pag.webSocketDebuggerUrl); await new Promise(r => { s.onopen = r; });
    s.send(JSON.stringify({ id: 9, method: 'Page.navigate', params: { url: 'chrome://gpu' } }));   // desde la línea de órdenes abre una pestaña nueva
    await new Promise(r => setTimeout(r, 6000));
    const texto = await new Promise(r => { s.onmessage = e => { const m = JSON.parse(e.data); if (m.id === 1) r(m.result && m.result.result && m.result.result.value); };
      s.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, expression: `(() => { const t = []; const ver = n => { if (n.shadowRoot) ver(n.shadowRoot); for (const c of n.children || []) ver(c); if (!n.children || !n.children.length) { const x = (n.textContent || '').trim(); if (x) t.push(x); } }; ver(document.documentElement); return t.join('\\n'); })()` } })); });
    // Y pedir la gráfica a WebGPU de varias formas, en una página normal
    s.send(JSON.stringify({ id: 10, method: 'Page.navigate', params: { url: `http://127.0.0.1:${PUERTO_DIAG}/version.json` } }));
    await new Promise(r => setTimeout(r, 2000));
    const pide = await new Promise(r => { s.onmessage = e => { const m = JSON.parse(e.data); if (m.id === 2) r(m.result && m.result.result && m.result.result.value); };
      s.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { awaitPromise: true, returnByValue: true, expression: `(async () => { if (!navigator.gpu) return 'navigator.gpu no existe'; const out = []; for (const [n, o] of [['alto rendimiento', { powerPreference: 'high-performance' }], ['sin opciones', {}], ['bajo consumo', { powerPreference: 'low-power' }], ['compatibilidad', { featureLevel: 'compatibility' }]]) { try { const a = await Promise.race([navigator.gpu.requestAdapter(o), new Promise(k => setTimeout(() => k('tarda'), 15000))]); if (a === 'tarda') { out.push(n + ': no responde'); continue; } if (!a) { out.push(n + ': ninguna'); continue; } const i = a.info || {}; out.push(n + ': ' + [i.vendor, i.architecture, i.device, i.description].filter(Boolean).join(' · ') + (a.isFallbackAdapter ? ' (de reserva)' : '')); } catch (e) { out.push(n + ': error ' + e.message); } } return out.join('\\n'); })()` } })); });
    s.close();
    const L = String(texto || '').split('\n'), out = [];
    for (let i = 0; i < L.length; i++) {
      const l = L[i]; if (/[{}]/.test(l) || l.length > 300) continue;   // estilos y listas de extensiones
      if (/^Disabled$/.test(l)) continue;
      if (!/webgpu|vulkan|gpu0|gpu1|nvidia|adapter|dawn|backend|driver|gl_renderer|problems|blocklist|unsafe|software|unavailable|error|fail|ozone|display type/i.test(l)) continue;
      out.push('  ' + l.slice(0, 200) + (/:$/.test(l) && L[i + 1] && L[i + 1].length < 200 ? ' ' + L[i + 1] : ''));
    }
    return salir((out.slice(0, 60).join('\n') || '  (chrome://gpu vacío)') + '\n  — WebGPU, al pedirle la gráfica:\n' + String(pide || '(sin respuesta)').split('\n').map(x => '  ' + x).join('\n') + '\n  — Chromium dijo:\n' + errores());
  } catch (e) { return salir('No he podido: ' + e.message + '\n' + errores()); }
}
