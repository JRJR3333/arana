/* Araña · la gráfica (WebGPU). Fase 1 de la red en la gráfica (0.37.0, lo pidió Juan).
   - iniciar(): pide la gráfica más potente (en el servidor de Linux, la NVIDIA por Vulkan).
   - conv(): convolución 3×3 sobre tableros de 8×8, por lotes, con ReLU y suma residual opcionales.
     Un grupo de 64 hilos = un plano (una casilla por hilo); se lanzan Co × B grupos.
   - matmul(): capa densa C = A·B + sesgo, en baldosas de 16×16 con memoria compartida.
   - probar(): compara cada cálculo con el procesador y mide la velocidad con la red prevista
     (12 planos de entrada → 64 filtros, 6 bloques residuales), en posiciones por segundo.
   Funciona en la sala, en un hilo (Worker) o en una página suelta; en Node no hay WebGPU. */
(function (raiz) {
  'use strict';
  const WG_CONV = `
struct P { B: u32, Ci: u32, Co: u32, flags: u32 }
@group(0) @binding(0) var<storage, read> X: array<f32>;
@group(0) @binding(1) var<storage, read> W: array<f32>;
@group(0) @binding(2) var<storage, read> Bv: array<f32>;
@group(0) @binding(3) var<storage, read> R: array<f32>;
@group(0) @binding(4) var<storage, read_write> Y: array<f32>;
@group(0) @binding(5) var<uniform> p: P;
var<workgroup> plano: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) s: u32) {
  let co = wg.x; let b = wg.y; let y = i32(s / 8u); let x = i32(s % 8u);
  var acc = Bv[co];
  let xb = b * p.Ci * 64u; let wb = co * p.Ci * 9u;
  for (var ci = 0u; ci < p.Ci; ci = ci + 1u) {
    plano[s] = X[xb + ci * 64u + s];
    workgroupBarrier();
    let wo = wb + ci * 9u;
    for (var ky = -1; ky <= 1; ky = ky + 1) {
      let yy = y + ky;
      if (yy < 0 || yy > 7) { continue; }
      for (var kx = -1; kx <= 1; kx = kx + 1) {
        let xx = x + kx;
        if (xx < 0 || xx > 7) { continue; }
        acc = acc + plano[u32(yy * 8 + xx)] * W[wo + u32((ky + 1) * 3 + (kx + 1))];
      }
    }
    workgroupBarrier();
  }
  let o = (b * p.Co + co) * 64u + s;
  if ((p.flags & 2u) != 0u) { acc = acc + R[o]; }
  if ((p.flags & 1u) != 0u) { acc = max(acc, 0.0); }
  Y[o] = acc;
}`;
  const WG_MATMUL = `
struct P { M: u32, K: u32, N: u32, flags: u32 }
@group(0) @binding(0) var<storage, read> A: array<f32>;
@group(0) @binding(1) var<storage, read> Bm: array<f32>;
@group(0) @binding(2) var<storage, read> Bv: array<f32>;
@group(0) @binding(3) var<storage, read_write> C: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
var<workgroup> tA: array<f32, 256>;
var<workgroup> tB: array<f32, 256>;
@compute @workgroup_size(16, 16)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) l: vec3<u32>) {
  let row = wg.y * 16u + l.y; let col = wg.x * 16u + l.x;
  var acc = 0.0;
  let nt = (p.K + 15u) / 16u;
  for (var t = 0u; t < nt; t = t + 1u) {
    let ka = t * 16u + l.x; let kb = t * 16u + l.y;
    var a = 0.0; if (row < p.M && ka < p.K) { a = A[row * p.K + ka]; }
    var b = 0.0; if (kb < p.K && col < p.N) { b = Bm[kb * p.N + col]; }
    tA[l.y * 16u + l.x] = a; tB[l.y * 16u + l.x] = b;
    workgroupBarrier();
    for (var k = 0u; k < 16u; k = k + 1u) { acc = acc + tA[l.y * 16u + k] * tB[k * 16u + l.x]; }
    workgroupBarrier();
  }
  if (row < p.M && col < p.N) {
    var v = acc + Bv[col];
    if ((p.flags & 1u) != 0u) { v = max(v, 0.0); }
    C[row * p.N + col] = v;
  }
}`;

  const G = { dev: null, info: null, limites: null, pConv: null, pMat: null, nada: null, error: '' };
  const S = () => (typeof GPUBufferUsage !== 'undefined' ? GPUBufferUsage : {});
  G.disponible = () => typeof navigator !== 'undefined' && !!navigator.gpu;

  const conLimite = (pr, ms, que) => Promise.race([pr, new Promise((_, ko) => setTimeout(() => ko(new Error(que + ' no responde en ' + ms / 1000 + ' s')), ms))]);
  G.iniciar = async function () {
    if (G.dev) return G.info;
    if (!G.disponible()) throw new Error('este navegador no tiene WebGPU');
    let a = null;
    for (const o of [{ powerPreference: 'high-performance' }, {}, { featureLevel: 'compatibility' }]) { a = await conLimite(navigator.gpu.requestAdapter(o), 20000, 'la gráfica'); if (a) break; }   // con dos gráficas, a veces solo responde a una de las formas
    if (!a) throw new Error('no hay gráfica disponible para WebGPU');
    const i = a.info || (a.requestAdapterInfo ? await a.requestAdapterInfo() : {}) || {};
    G.info = { fabricante: i.vendor || '', arquitectura: i.architecture || '', descripcion: i.description || '', dispositivo: i.device || '',
      simulada: /swiftshader|llvmpipe|software/i.test([i.vendor, i.architecture, i.description].join(' ')), memoriaMax: a.limits.maxBufferSize };
    G.dev = await conLimite(a.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: a.limits.maxStorageBufferBindingSize, maxBufferSize: a.limits.maxBufferSize } }), 20000, 'el dispositivo de la gráfica');
    G.dev.lost.then(e => { G.error = 'se perdió la gráfica: ' + (e && e.message); G.dev = null; });
    G.limites = { buffer: a.limits.maxStorageBufferBindingSize };
    const mk = code => G.dev.createComputePipeline({ layout: 'auto', compute: { module: G.dev.createShaderModule({ code }), entryPoint: 'main' } });
    G.pConv = mk(WG_CONV); G.pMat = mk(WG_MATMUL);
    G.nada = G.buffer(new Float32Array(1));
    return G.info;
  };
  G.buffer = function (datos, copiar) {   // datos: Float32Array o número de floats
    const U = S(), n = typeof datos === 'number' ? datos : datos.length;
    const b = G.dev.createBuffer({ size: Math.max(16, Math.ceil(n * 4 / 16) * 16), usage: U.STORAGE | U.COPY_SRC | U.COPY_DST | (copiar ? 0 : 0) });
    if (typeof datos !== 'number') G.dev.queue.writeBuffer(b, 0, datos.buffer, datos.byteOffset, datos.byteLength);
    b.n = n; return b;
  };
  const uniforme = arr => { const U = S(), b = G.dev.createBuffer({ size: 16, usage: U.UNIFORM | U.COPY_DST }); G.dev.queue.writeBuffer(b, 0, Uint32Array.from(arr)); return b; };
  G.leer = async function (buf, n) {
    const U = S(), bytes = (n == null ? buf.n : n) * 4, r = G.dev.createBuffer({ size: Math.ceil(bytes / 4) * 4, usage: U.MAP_READ | U.COPY_DST });
    const e = G.dev.createCommandEncoder(); e.copyBufferToBuffer(buf, 0, r, 0, r.size); G.dev.queue.submit([e.finish()]);
    await r.mapAsync(GPUMapMode.READ); const out = new Float32Array(r.getMappedRange().slice(0)); r.unmap(); r.destroy(); return out;
  };
  /* Codifican el trabajo en un «pase» del codificador que se les da (para encadenar capas sin esperar) */
  G.conv = function (enc, X, Wt, Bb, B, Ci, Co, Y, op) {
    op = op || {};
    const u = uniforme([B, Ci, Co, (op.relu ? 1 : 0) | (op.residuo ? 2 : 0)]);
    const bg = G.dev.createBindGroup({ layout: G.pConv.getBindGroupLayout(0), entries: [X, Wt, Bb, op.residuo || G.nada, Y, u].map((b, k) => ({ binding: k, resource: { buffer: b } })) });
    const p = enc.beginComputePass(); p.setPipeline(G.pConv); p.setBindGroup(0, bg); p.dispatchWorkgroups(Co, B); p.end();
    return u;
  };
  G.matmul = function (enc, A, Bm, Bb, M, K, N, C, op) {
    op = op || {};
    const u = uniforme([M, K, N, op.relu ? 1 : 0]);
    const bg = G.dev.createBindGroup({ layout: G.pMat.getBindGroupLayout(0), entries: [A, Bm, Bb, C, u].map((b, k) => ({ binding: k, resource: { buffer: b } })) });
    const p = enc.beginComputePass(); p.setPipeline(G.pMat); p.setBindGroup(0, bg); p.dispatchWorkgroups(Math.ceil(N / 16), Math.ceil(M / 16)); p.end();
    return u;
  };

  /* ═════════ Fase 2: kernels para entrenar (0.38.0) ═════════
     Todos usan el mismo bloque de parámetros: 8 enteros (i0, i1) y 8 decimales (f0, f1).
     Los tensores son «vistas»: un trozo de un buffer ({ buf, off, n } en floats; off múltiplo de 64, que son 256 bytes).
     Tableros siempre en orden [lote][plano][casilla 0–63]. */
  const CAB = `struct P { i0: vec4<u32>, i1: vec4<u32>, f0: vec4<f32>, f1: vec4<f32> }\n`;
  const K2 = {
    // Convolución k×k (k = 1 o 3). flags: 1 ReLU, 2 suma residual R. Un grupo = un plano (co, b).
    conv: CAB + `
@group(0) @binding(0) var<storage, read> X: array<f32>;
@group(0) @binding(1) var<storage, read> W: array<f32>;
@group(0) @binding(2) var<storage, read> Bv: array<f32>;
@group(0) @binding(3) var<storage, read> R: array<f32>;
@group(0) @binding(4) var<storage, read_write> Y: array<f32>;
@group(0) @binding(5) var<uniform> p: P;
var<workgroup> plano: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) s: u32) {
  let Ci = p.i0.y; let Co = p.i0.z; let fl = p.i0.w; let k = i32(p.i1.x); let r = (k - 1) / 2; let kk = u32(k * k);
  let co = wg.x; let b = wg.y; let y = i32(s / 8u); let x = i32(s % 8u);
  var acc = Bv[co];
  for (var ci = 0u; ci < Ci; ci = ci + 1u) {
    plano[s] = X[(b * Ci + ci) * 64u + s];
    workgroupBarrier();
    let wo = (co * Ci + ci) * kk;
    for (var ky = -r; ky <= r; ky = ky + 1) {
      let yy = y + ky; if (yy < 0 || yy > 7) { continue; }
      for (var kx = -r; kx <= r; kx = kx + 1) {
        let xx = x + kx; if (xx < 0 || xx > 7) { continue; }
        acc = acc + plano[u32(yy * 8 + xx)] * W[wo + u32((ky + r) * k + (kx + r))];
      }
    }
    workgroupBarrier();
  }
  let o = (b * Co + co) * 64u + s;
  if ((fl & 2u) != 0u) { acc = acc + R[o]; }
  if ((fl & 1u) != 0u) { acc = max(acc, 0.0); }
  Y[o] = acc;
}`,
    // Gradiente respecto a la entrada: dX[b,ci,t] = Σ_co Σ_d dY[b,co,t−d] · W[co,ci,d]. flags: 1 acumular.
    convX: CAB + `
@group(0) @binding(0) var<storage, read> dY: array<f32>;
@group(0) @binding(1) var<storage, read> W: array<f32>;
@group(0) @binding(2) var<storage, read_write> dX: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
var<workgroup> plano: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) s: u32) {
  let Ci = p.i0.y; let Co = p.i0.z; let fl = p.i0.w; let k = i32(p.i1.x); let r = (k - 1) / 2; let kk = u32(k * k);
  let ci = wg.x; let b = wg.y; let ty = i32(s / 8u); let tx = i32(s % 8u);
  var acc = 0.0;
  for (var co = 0u; co < Co; co = co + 1u) {
    plano[s] = dY[(b * Co + co) * 64u + s];
    workgroupBarrier();
    let wo = (co * Ci + ci) * kk;
    for (var ky = -r; ky <= r; ky = ky + 1) {
      let yy = ty - ky; if (yy < 0 || yy > 7) { continue; }
      for (var kx = -r; kx <= r; kx = kx + 1) {
        let xx = tx - kx; if (xx < 0 || xx > 7) { continue; }
        acc = acc + plano[u32(yy * 8 + xx)] * W[wo + u32((ky + r) * k + (kx + r))];
      }
    }
    workgroupBarrier();
  }
  let o = (b * Ci + ci) * 64u + s;
  if ((fl & 1u) != 0u) { dX[o] = dX[o] + acc; } else { dX[o] = acc; }
}`,
    // Gradiente de los pesos: dW[co,ci,d] = Σ_b Σ_s dY[b,co,s] · X[b,ci,s+d]. Un grupo = (ci, co); cada hilo, una casilla.
    convW: CAB + `
@group(0) @binding(0) var<storage, read> dY: array<f32>;
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read_write> dW: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
var<workgroup> red: array<f32, 576>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) s: u32) {
  let B = p.i0.x; let Ci = p.i0.y; let Co = p.i0.z; let k = i32(p.i1.x); let r = (k - 1) / 2; let kk = u32(k * k);
  let ci = wg.x; let co = wg.y; let y = i32(s / 8u); let x = i32(s % 8u);
  var acc: array<f32, 9>;
  for (var t = 0u; t < 9u; t = t + 1u) { acc[t] = 0.0; }
  for (var b = 0u; b < B; b = b + 1u) {
    let g = dY[(b * Co + co) * 64u + s];
    if (g == 0.0) { continue; }
    let xo = (b * Ci + ci) * 64u;
    for (var ky = -r; ky <= r; ky = ky + 1) {
      let yy = y + ky; if (yy < 0 || yy > 7) { continue; }
      for (var kx = -r; kx <= r; kx = kx + 1) {
        let xx = x + kx; if (xx < 0 || xx > 7) { continue; }
        let t = u32((ky + r) * k + (kx + r));
        acc[t] = acc[t] + g * X[xo + u32(yy * 8 + xx)];
      }
    }
  }
  for (var t = 0u; t < kk; t = t + 1u) { red[t * 64u + s] = acc[t]; }
  workgroupBarrier();
  for (var st = 32u; st > 0u; st = st >> 1u) {
    if (s < st) { for (var t = 0u; t < kk; t = t + 1u) { red[t * 64u + s] = red[t * 64u + s] + red[t * 64u + s + st]; } }
    workgroupBarrier();
  }
  if (s < kk) { dW[(co * Ci + ci) * kk + s] = red[s * 64u]; }
}`,
    // Gradiente del sesgo de una convolución: db[co] = Σ_b Σ_s dY[b,co,s]
    planos: CAB + `
@group(0) @binding(0) var<storage, read> dY: array<f32>;
@group(0) @binding(1) var<storage, read_write> db: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
var<workgroup> red: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) s: u32) {
  let B = p.i0.x; let Co = p.i0.z; let co = wg.x;
  var a = 0.0;
  for (var b = 0u; b < B; b = b + 1u) { a = a + dY[(b * Co + co) * 64u + s]; }
  red[s] = a; workgroupBarrier();
  for (var st = 32u; st > 0u; st = st >> 1u) { if (s < st) { red[s] = red[s] + red[s + st]; } workgroupBarrier(); }
  if (s == 0u) { db[co] = red[0]; }
}`,
    // dY *= (Y > 0): el ReLU hacia atrás
    reluAtras: CAB + `
@group(0) @binding(0) var<storage, read> Y: array<f32>;
@group(0) @binding(1) var<storage, read_write> dY: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) { let i = g.x + g.y * 65535u * 256u; if (i < p.i0.x && Y[i] <= 0.0) { dY[i] = 0.0; } }`,
    // A += B
    sumar: CAB + `
@group(0) @binding(0) var<storage, read> Bs: array<f32>;
@group(0) @binding(1) var<storage, read_write> A: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>) { let i = g.x + g.y * 65535u * 256u; if (i < p.i0.x) { A[i] = A[i] + Bs[i]; } }`,
    // C = op(A)·op(B) + sesgo. flags: 1 ReLU, 2 A traspuesta (guardada K×M), 4 B traspuesta (guardada N×K), 8 sin sesgo
    matmul: CAB + `
@group(0) @binding(0) var<storage, read> A: array<f32>;
@group(0) @binding(1) var<storage, read> Bm: array<f32>;
@group(0) @binding(2) var<storage, read> Bv: array<f32>;
@group(0) @binding(3) var<storage, read_write> C: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
var<workgroup> tA: array<f32, 256>;
var<workgroup> tB: array<f32, 256>;
@compute @workgroup_size(16, 16)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) l: vec3<u32>) {
  let M = p.i0.x; let K = p.i0.y; let N = p.i0.z; let fl = p.i0.w;
  let row = wg.y * 16u + l.y; let col = wg.x * 16u + l.x;
  var acc = 0.0;
  let nt = (K + 15u) / 16u;
  for (var t = 0u; t < nt; t = t + 1u) {
    let ka = t * 16u + l.x; let kb = t * 16u + l.y;
    var a = 0.0;
    if (row < M && ka < K) { if ((fl & 2u) != 0u) { a = A[ka * M + row]; } else { a = A[row * K + ka]; } }
    var b = 0.0;
    if (kb < K && col < N) { if ((fl & 4u) != 0u) { b = Bm[col * K + kb]; } else { b = Bm[kb * N + col]; } }
    tA[l.y * 16u + l.x] = a; tB[l.y * 16u + l.x] = b;
    workgroupBarrier();
    for (var q = 0u; q < 16u; q = q + 1u) { acc = acc + tA[l.y * 16u + q] * tB[q * 16u + l.x]; }
    workgroupBarrier();
  }
  if (row < M && col < N) {
    var v = acc;
    if ((fl & 8u) == 0u) { v = v + Bv[col]; }
    if ((fl & 1u) != 0u) { v = max(v, 0.0); }
    C[row * N + col] = v;
  }
}`,
    // db[j] = Σ_i dC[i,j]
    columnas: CAB + `
@group(0) @binding(0) var<storage, read> dC: array<f32>;
@group(0) @binding(1) var<storage, read_write> db: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let M = p.i0.x; let N = p.i0.y; let j = g.x; if (j >= N) { return; }
  var a = 0.0; for (var i = 0u; i < M; i = i + 1u) { a = a + dC[i * N + j]; } db[j] = a;
}`,
    // Pérdida de cada posición: valor tanh + error cuadrático (peso wv) y política softmax + entropía cruzada (peso wp).
    // Escribe los gradientes y, por posición, [error del valor, pérdida de la política, acierto, tiene jugada].
    perdida: CAB + `
@group(0) @binding(0) var<storage, read> ZV: array<f32>;
@group(0) @binding(1) var<storage, read> Lg: array<f32>;
@group(0) @binding(2) var<storage, read> T: array<f32>;
@group(0) @binding(3) var<storage, read> Obj: array<f32>;
@group(0) @binding(4) var<storage, read_write> dZV: array<f32>;
@group(0) @binding(5) var<storage, read_write> dL: array<f32>;
@group(0) @binding(6) var<storage, read_write> Lo: array<f32>;
@group(0) @binding(7) var<uniform> p: P;
var<workgroup> sh: array<f32, 256>;
var<workgroup> si: array<u32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) l: u32) {
  let Bn = p.i0.x; let NP = p.i0.y; let wv = p.f0.x; let wp = p.f0.y; let b = wg.x; let base = b * NP;
  var m = -3.0e38; var am = 0u;
  for (var j = l; j < NP; j = j + 256u) { let v = Lg[base + j]; if (v > m) { m = v; am = j; } }
  sh[l] = m; si[l] = am; workgroupBarrier();
  for (var st = 128u; st > 0u; st = st >> 1u) { if (l < st && sh[l + st] > sh[l]) { sh[l] = sh[l + st]; si[l] = si[l + st]; } workgroupBarrier(); }
  let M = sh[0]; let AM = si[0]; workgroupBarrier();
  var a = 0.0; for (var j = l; j < NP; j = j + 256u) { a = a + exp(Lg[base + j] - M); }
  sh[l] = a; workgroupBarrier();
  for (var st = 128u; st > 0u; st = st >> 1u) { if (l < st) { sh[l] = sh[l] + sh[l + st]; } workgroupBarrier(); }
  let S = sh[0];
  let tg = i32(Obj[b]);
  for (var j = l; j < NP; j = j + 256u) {
    var g = 0.0;
    if (tg >= 0) { g = exp(Lg[base + j] - M) / S; if (i32(j) == tg) { g = g - 1.0; } g = g * wp / f32(Bn); }
    dL[base + j] = g;
  }
  if (l == 0u) {
    let v = tanh(ZV[b]); let t = T[b];
    dZV[b] = 2.0 * (v - t) * (1.0 - v * v) * wv / f32(Bn);
    Lo[b * 4u] = (v - t) * (v - t);
    if (tg >= 0) { Lo[b * 4u + 1u] = log(S) + M - Lg[base + u32(tg)]; Lo[b * 4u + 2u] = select(0.0, 1.0, AM == u32(tg)); Lo[b * 4u + 3u] = 1.0; }
    else { Lo[b * 4u + 1u] = 0.0; Lo[b * 4u + 2u] = 0.0; Lo[b * 4u + 3u] = 0.0; }
  }
}`,
    // Adam con decaimiento de pesos: P -= lr · (m̂ / (√v̂ + ε) + l2 · P)
    adam: CAB + `
@group(0) @binding(0) var<storage, read> Gd: array<f32>;
@group(0) @binding(1) var<storage, read_write> Pp: array<f32>;
@group(0) @binding(2) var<storage, read_write> Mm: array<f32>;
@group(0) @binding(3) var<storage, read_write> Vv: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x + gid.y * 65535u * 256u; if (i >= p.i0.x) { return; }
  let lr = p.f0.x; let b1 = p.f0.y; let b2 = p.f0.z; let eps = p.f0.w; let c1 = p.f1.x; let c2 = p.f1.y; let l2 = p.f1.z;
  let g = Gd[i];
  let m = b1 * Mm[i] + (1.0 - b1) * g; let v = b2 * Vv[i] + (1.0 - b2) * g * g;
  Mm[i] = m; Vv[i] = v;
  Pp[i] = Pp[i] - lr * ((m / c1) / (sqrt(v / c2) + eps) + l2 * Pp[i]);
}`
  };
  G.K2 = {};
  G.preparar2 = function () {
    if (G.K2.conv) return;
    for (const k in K2) G.K2[k] = G.dev.createComputePipeline({ layout: 'auto', compute: { module: G.dev.createShaderModule({ code: K2[k] }), entryPoint: 'main' } });
  };
  /* Un buffer grande donde viven muchos tensores (pesos, gradientes…); cada uno empieza en un múltiplo de 64 floats */
  G.bloque = function (tamanos) {
    let off = 0; const offs = tamanos.map(n => { const o = off; off += Math.ceil(n / 64) * 64; return o; });
    const buf = G.buffer(Math.max(64, off));
    return { buf, total: off, vistas: tamanos.map((n, i) => ({ buf, off: offs[i], n })) };
  };
  G.vista = buf => ({ buf, off: 0, n: buf.n });
  const recurso = v => ({ buffer: v.buf, offset: v.off * 4, size: Math.max(4, v.n * 4) });
  /* Un paso preparado: tubería, grupo de enlaces, uniformes y tamaño del lanzamiento. Se crea una vez y se reutiliza. */
  G.paso = function (nombre, vistas, ints, floats, grupos) {
    const U = S(), u = G.dev.createBuffer({ size: 64, usage: U.UNIFORM | U.COPY_DST });
    const ab = new ArrayBuffer(64), iu = new Uint32Array(ab, 0, 8), fu = new Float32Array(ab, 32, 8);
    (ints || []).forEach((v, i) => { iu[i] = v; }); (floats || []).forEach((v, i) => { fu[i] = v; });
    G.dev.queue.writeBuffer(u, 0, ab);
    const pipe = G.K2[nombre], entries = vistas.map((v, k) => ({ binding: k, resource: recurso(v) })).concat([{ binding: vistas.length, resource: { buffer: u } }]);
    return { pipe, bg: G.dev.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries }), grupos, u, ab, iu, fu, nombre };
  };
  G.actualizar = function (paso) { G.dev.queue.writeBuffer(paso.u, 0, paso.ab); };
  G.lanzar = function (enc, pasos) {
    const p = enc.beginComputePass();
    for (const s of pasos) { p.setPipeline(s.pipe); p.setBindGroup(0, s.bg); p.dispatchWorkgroups(...s.grupos); }
    p.end();
  };
  G.lineal = n => { const g = Math.ceil(n / 256); return g <= 65535 ? [g, 1] : [65535, Math.ceil(g / 65535)]; };   // para los kernels de 256 hilos por elemento
  G.escribir = function (v, datos) { G.dev.queue.writeBuffer(v.buf, v.off * 4, datos.buffer, datos.byteOffset, datos.byteLength); };
  G.leerVista = async function (v) {
    const U = S(), r = G.dev.createBuffer({ size: Math.ceil(v.n * 4 / 4) * 4, usage: U.MAP_READ | U.COPY_DST });
    const e = G.dev.createCommandEncoder(); e.copyBufferToBuffer(v.buf, v.off * 4, r, 0, v.n * 4); G.dev.queue.submit([e.finish()]);
    await r.mapAsync(GPUMapMode.READ); const out = new Float32Array(r.getMappedRange().slice(0)); r.unmap(); r.destroy(); return out;
  };

  /* Lo mismo en el procesador, para comparar */
  function convCPU(X, W, Bv, B, Ci, Co, op) {
    const Y = new Float32Array(B * Co * 64);
    for (let b = 0; b < B; b++) for (let co = 0; co < Co; co++) for (let s = 0; s < 64; s++) {
      const y = s >> 3, x = s & 7; let acc = Bv[co];
      for (let ci = 0; ci < Ci; ci++) for (let ky = -1; ky <= 1; ky++) { const yy = y + ky; if (yy < 0 || yy > 7) continue; for (let kx = -1; kx <= 1; kx++) { const xx = x + kx; if (xx < 0 || xx > 7) continue; acc += X[(b * Ci + ci) * 64 + yy * 8 + xx] * W[(co * Ci + ci) * 9 + (ky + 1) * 3 + kx + 1]; } }
      const o = (b * Co + co) * 64 + s; if (op.residuo) acc += op.residuo[o]; if (op.relu) acc = Math.max(0, acc); Y[o] = acc;
    }
    return Y;
  }
  function matmulCPU(A, Bm, Bv, M, K, N, op) {
    const C = new Float32Array(M * N);
    for (let i = 0; i < M; i++) for (let j = 0; j < N; j++) { let a = Bv[j]; for (let k = 0; k < K; k++) a += A[i * K + k] * Bm[k * N + j]; C[i * N + j] = op.relu ? Math.max(0, a) : a; }
    return C;
  }
  const azar = (n, s) => { const a = new Float32Array(n); let x = s || 1; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; a[i] = ((x >>> 8) / 16777216 - .5) * 2; } return a; };
  const difMax = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]) / (1 + Math.abs(b[i]))); return m; };

  /* La prueba: exactitud contra el procesador y velocidad con la red prevista */
  G.probar = async function (op) {
    op = Object.assign({ lote: 256, filtros: 64, bloques: 6, vueltas: 10 }, op || {});
    const r = { ok: false, gpu: null, pruebas: [], velocidad: null, error: '' };
    try {
      r.gpu = await G.iniciar();
      // 1) capa densa
      { const M = 70, K = 133, N = 45, A = azar(M * K, 3), Bm = azar(K * N, 5), Bv = azar(N, 7);
        const gA = G.buffer(A), gB = G.buffer(Bm), gV = G.buffer(Bv), gC = G.buffer(M * N), e = G.dev.createCommandEncoder();
        G.matmul(e, gA, gB, gV, M, K, N, gC, { relu: true }); G.dev.queue.submit([e.finish()]);
        const d = difMax(await G.leer(gC), matmulCPU(A, Bm, Bv, M, K, N, { relu: true }));
        r.pruebas.push({ nombre: 'capa densa 70×133 · 133×45', diferencia: d, ok: d < 1e-4 }); [gA, gB, gV, gC].forEach(b => b.destroy()); }
      // 2) convolución con residuo y ReLU
      { const B = 3, Ci = 12, Co = 16, X = azar(B * Ci * 64, 11), W = azar(Co * Ci * 9, 13), Bv = azar(Co, 17), Rr = azar(B * Co * 64, 19);
        const gX = G.buffer(X), gW = G.buffer(W), gV = G.buffer(Bv), gR = G.buffer(Rr), gY = G.buffer(B * Co * 64), e = G.dev.createCommandEncoder();
        G.conv(e, gX, gW, gV, B, Ci, Co, gY, { relu: true, residuo: gR }); G.dev.queue.submit([e.finish()]);
        const d = difMax(await G.leer(gY), convCPU(X, W, Bv, B, Ci, Co, { relu: true, residuo: Rr }));
        r.pruebas.push({ nombre: 'convolución 3×3, 12→16 planos, con residuo', diferencia: d, ok: d < 1e-4 }); [gX, gW, gV, gR, gY].forEach(b => b.destroy()); }
      // 3) velocidad: entrada 12 planos → F filtros, y «bloques» bloques residuales (2 convoluciones cada uno)
      { const B = op.lote, F = op.filtros, nb = op.bloques;
        const gX = G.buffer(azar(B * 12 * 64, 23)), w0 = G.buffer(azar(F * 12 * 9, 29).map(v => v * .2)), b0 = G.buffer(new Float32Array(F));
        const ws = [], bs = []; for (let k = 0; k < nb * 2; k++) { ws.push(G.buffer(azar(F * F * 9, 31 + k).map(v => v * .05))); bs.push(G.buffer(new Float32Array(F))); }
        const t = [G.buffer(B * F * 64), G.buffer(B * F * 64), G.buffer(B * F * 64)];
        const pasada = () => {
          const e = G.dev.createCommandEncoder(), us = [];
          us.push(G.conv(e, gX, w0, b0, B, 12, F, t[0], { relu: true }));
          for (let k = 0; k < nb; k++) { us.push(G.conv(e, t[0], ws[2 * k], bs[2 * k], B, F, F, t[1], { relu: true })); us.push(G.conv(e, t[1], ws[2 * k + 1], bs[2 * k + 1], B, F, F, t[2], { relu: true, residuo: t[0] })); t.unshift(t.splice(2, 1)[0]); }
          G.dev.queue.submit([e.finish()]); return us;
        };
        pasada(); await G.dev.queue.onSubmittedWorkDone();
        const t0 = performance.now(), basura = [];
        for (let v = 0; v < op.vueltas; v++) basura.push(...pasada());
        await G.dev.queue.onSubmittedWorkDone();
        const ms = (performance.now() - t0) / op.vueltas, flop = 2 * B * 64 * 9 * (12 * F + 2 * nb * F * F);
        r.velocidad = { lote: B, filtros: F, bloques: nb, msPorLote: Math.round(ms * 100) / 100, posicionesPorSegundo: Math.round(B / ms * 1000), gflops: Math.round(flop / ms / 1e6 * 10) / 10 };
        basura.forEach(u => u.destroy()); [gX, w0, b0, ...ws, ...bs, ...t].forEach(b => b.destroy());
      }
      r.ok = r.pruebas.every(p => p.ok);
    } catch (e) { r.error = (e && e.message) || String(e); }
    return r;
  };
  G.convCPU = convCPU; G.matmulCPU = matmulCPU;
  if (typeof module !== 'undefined' && module.exports) module.exports = G; else raiz.GPU = G;
})(typeof self !== 'undefined' ? self : this);
