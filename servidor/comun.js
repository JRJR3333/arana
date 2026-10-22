/* Araña · piezas comunes del servidor de Linux (0.37.0): Chromium con la gráfica y llama-server.
   - argsGPU(): opciones de Chromium para usar la gráfica por Vulkan en modo sin ventana (WebGPU).
     Con ARANA_GPU=0 se vuelve al modo de antes, sin gráfica.
   - pararLlama() / reanudarLlama(): Juan quiere que llama-server deje la gráfica libre mientras la araña entrena con ella.
     Orden de preferencia:
       1) ARANA_PARAR y ARANA_REANUDAR (órdenes de shell que pone Juan en el servicio);
       2) si llama-server es un servicio de systemd: de usuario, `systemctl --user stop/start`;
          del sistema, `sudo -n systemctl stop/start` (hace falta permitirlo en sudoers, ver LEEME.md);
       3) si se lanzó a mano: se guarda su orden y su carpeta, se cierra y luego se vuelve a lanzar igual.
     Lo parado se apunta en DATOS/llama-parado.json, así que si el servidor se reinicia, sabe qué tiene que reanudar. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { spawn, execFileSync, execSync } = require('child_process');

const DATOS = process.env.ARANA_DATOS || path.join(os.homedir(), '.local/share/arana');
fs.mkdirSync(DATOS, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a);

function buscarChromium() {
  if (process.env.ARANA_CHROMIUM) return process.env.ARANA_CHROMIUM;
  for (const n of ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome']) { try { return execFileSync('which', [n]).toString().trim(); } catch (e) {} }
  console.error('No encuentro Chromium. Instálelo con: sudo pacman -S chromium'); process.exit(1);
}
const conGPU = () => process.env.ARANA_GPU !== '0';
/* Formas de encender la gráfica en Chromium sin ventana. probar-gpu.js prueba en orden y guarda la que funciona en DATOS/gpu.json:
   «vulkan»: todo por Vulkan (la receta de Chrome para NVIDIA en Linux); «dawn»: WebGPU por Vulkan y la composición por software
   (por si ANGLE no arranca sin pantalla); «gl»: ANGLE por OpenGL/EGL. */
const VARIANTES = {
  vulkan: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--disable-vulkan-surface', '--ignore-gpu-blocklist'],
  dawn: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--disable-vulkan-surface', '--ignore-gpu-blocklist'],
  gl: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist']
};
const GPU_JSON = path.join(DATOS, 'gpu.json');
const varianteGuardada = () => { try { const v = JSON.parse(fs.readFileSync(GPU_JSON, 'utf8')).variante; return VARIANTES[v] ? v : null; } catch (e) { return null; } };
function argsGPU(variante) {
  if (!conGPU()) return ['--disable-gpu'];
  const a = VARIANTES[variante || process.env.ARANA_GPU_VARIANTE || varianteGuardada() || 'vulkan'].slice();
  if (process.env.ARANA_GPU_SIMULADA === '1') a.push('--enable-unsafe-swiftshader');   // solo para pruebas sin gráfica
  return a;
}

/* ───── llama-server ───── */
const ESTADO_LLAMA = path.join(DATOS, 'llama-parado.json'), LOG_LLAMA = path.join(DATOS, 'llama-server.log');
const nombreLlama = () => process.env.ARANA_LLAMA || 'llama-server';
function procesos() {
  const out = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const cmd = fs.readFileSync(`/proc/${d}/cmdline`).toString().split('\0').filter(Boolean);
      if (!cmd.length || path.basename(cmd[0]) !== nombreLlama()) continue;
      const cg = fs.readFileSync(`/proc/${d}/cgroup`).toString();
      const m = cg.match(/\/([^\/\n]+\.service)\s*$/m);
      const unidad = m && !/^user@\d+\.service$/.test(m[1]) && !/^(session-|app-|vte-spawn|tmux|init\.scope)/.test(m[1]) ? m[1] : null;
      let env = null; try { env = Object.fromEntries(fs.readFileSync(`/proc/${d}/environ`).toString().split('\0').filter(Boolean).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])); } catch (e) {}
      out.push({ pid: +d, cmd, cwd: fs.readlinkSync(`/proc/${d}/cwd`), env, unidad, deUsuario: /user@\d+\.service/.test(cg) });
    } catch (e) {}
  }
  return out;
}
const sh = orden => { try { execSync(orden, { stdio: 'pipe', timeout: 30000, shell: '/bin/bash' }); return ''; } catch (e) { return String((e.stderr || e.message || '')).trim().slice(0, 300) || 'falló'; } };
const leerEstado = () => { try { return JSON.parse(fs.readFileSync(ESTADO_LLAMA, 'utf8')); } catch (e) { return null; } };
const guardarEstado = v => { if (v) fs.writeFileSync(ESTADO_LLAMA, JSON.stringify(v, null, 1)); else try { fs.unlinkSync(ESTADO_LLAMA); } catch (e) {} };
const esperar = ms => new Promise(r => setTimeout(r, ms));

async function pararLlama() {
  if (leerEstado()) return { ya: true };
  if (process.env.ARANA_PARAR) {
    const e = sh(process.env.ARANA_PARAR); if (e) { log('No he podido parar llama-server con ARANA_PARAR:', e); return { error: e }; }
    guardarEstado({ modo: 'orden', fecha: new Date().toISOString() }); log('llama-server parado (ARANA_PARAR).'); return { ok: true };
  }
  const ps = procesos(); if (!ps.length) return { nada: true };
  const p = ps[0];
  if (p.unidad) {
    const usuario = p.deUsuario, orden = usuario ? `systemctl --user stop ${p.unidad}` : `sudo -n systemctl stop ${p.unidad}`;
    const e = sh(orden);
    if (e) { log(`No he podido parar ${p.unidad} (${orden}): ${e}. Para permitirlo, vea «llama-server» en servidor/LEEME.md.`); return { error: e, unidad: p.unidad }; }
    guardarEstado({ modo: 'systemd', unidad: p.unidad, usuario, fecha: new Date().toISOString() }); log(`llama-server parado (${p.unidad}).`); return { ok: true };
  }
  try { process.kill(p.pid, 'SIGTERM'); } catch (e) { log('No he podido cerrar llama-server:', e.message); return { error: e.message }; }
  for (let i = 0; i < 30 && procesos().some(x => x.pid === p.pid); i++) await esperar(500);
  try { process.kill(p.pid, 0); process.kill(p.pid, 'SIGKILL'); } catch (e) {}
  guardarEstado({ modo: 'mano', cmd: p.cmd, cwd: p.cwd, env: p.env, fecha: new Date().toISOString() }); log('llama-server cerrado; lo volveré a abrir igual:', p.cmd.join(' '));
  return { ok: true };
}
async function reanudarLlama() {
  const e0 = leerEstado(); if (!e0) return { nada: true };
  let e = '';
  if (e0.modo === 'orden') e = process.env.ARANA_REANUDAR ? sh(process.env.ARANA_REANUDAR) : 'falta ARANA_REANUDAR';
  else if (e0.modo === 'systemd') e = sh(e0.usuario ? `systemctl --user start ${e0.unidad}` : `sudo -n systemctl start ${e0.unidad}`);
  else if (e0.modo === 'mano') {
    if (!procesos().length) {
      const fd = fs.openSync(LOG_LLAMA, 'a');
      const ch = spawn(e0.cmd[0], e0.cmd.slice(1), { cwd: e0.cwd, env: e0.env || process.env, detached: true, stdio: ['ignore', fd, fd] }); ch.unref();
    }
  }
  if (e) { log('No he podido volver a abrir llama-server:', e); return { error: e }; }
  guardarEstado(null); log('llama-server vuelve a funcionar.'); return { ok: true };
}

module.exports = { DATOS, log, buscarChromium, conGPU, argsGPU, VARIANTES, GPU_JSON, pararLlama, reanudarLlama, procesosLlama: procesos };
