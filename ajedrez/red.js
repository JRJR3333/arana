/* Araña · la red en la gráfica (distópica 40), fase 2 (0.38.0, lo pidió Juan).
   Una red neuronal que lee el tablero entero, como Leela:
   - Entrada: 17 planos de 8×8 vistos desde el bando que mueve (sus 6 piezas, las 6 del rival, 4 de enroques y uno de unos).
     Si mueven las negras, el tablero se da la vuelta (filas): la red siempre «juega con las de abajo».
   - Activación: ReLU con fuga (0,01) en todas las capas.
   - Tronco: una convolución 3×3 de 17 a F filtros y «bloques» bloques residuales (dos 3×3 y la suma de la entrada).
   - Política: 3×3 de F a F y 1×1 de F a 64 → 64 × 64 = 4096 jugadas (casilla de destino × casilla de origen).
   - Valor: 1×1 de F a 32 y, según «cabeza»: «plano» (las 32 × 64 = 2048 entradas a una capa densa de 128) o «media» (la suma
     de cada canal sobre las casillas, ÷ 8, a una densa de 32 a 128); luego de 128 a 1 y tanh: de −1 (pierde) a +1 (gana), desde el que mueve.
   Aprende con Adam, todo en la gráfica: entropía cruzada del valor (probabilidad de ganar) contra Stockfish y de la política
   contra la mejor jugada de Stockfish. Aquí también va la misma red en el procesador, para comprobar la gráfica. */
(function (raiz) {
  'use strict';
  const PL = 17, NP = 4096, VC = 32;   // VC: canales de la cabeza del valor (con 8 se apagaban y el valor no aprendía junto a la política)
  const PIEZA = { p: 0, n: 1, b: 2, r: 3, q: 4, k: 5 };

  /* ───── Tablero → planos ───── */
  function codificar(fen, out, o) {
    o = o || 0; out.fill(0, o, o + PL * 64);
    const f = fen.trim().split(/\s+/), negras = f[1] === 'b';
    let r = 7, c = 0;
    for (const ch of f[0]) {
      if (ch === '/') { r--; c = 0; continue; }
      if (ch >= '1' && ch <= '8') { c += +ch; continue; }
      const lo = ch.toLowerCase(), t = PIEZA[lo], blanca = ch !== lo, mia = blanca !== negras;
      const fila = negras ? 7 - r : r;
      out[o + (t + (mia ? 0 : 6)) * 64 + fila * 8 + c] = 1; c++;
    }
    const cs = f[2] || '-', [mk, mq, rk, rq] = negras ? ['k', 'q', 'K', 'Q'] : ['K', 'Q', 'k', 'q'];
    const llena = (pl, si) => { if (si) out.fill(1, o + pl * 64, o + pl * 64 + 64); };
    llena(12, cs.includes(mk)); llena(13, cs.includes(mq)); llena(14, cs.includes(rk)); llena(15, cs.includes(rq)); llena(16, true);
    return out;
  }
  /* Jugada (uci, en el tablero de verdad) → índice 0–4095 en el tablero de la red. Las promociones cuentan como la jugada sin promoción. */
  function indiceJugada(uci, negras) {
    if (!uci || uci.length < 4) return -1;
    const cas = (fl, rk) => { const fi = fl.charCodeAt(0) - 97, ri = rk.charCodeAt(0) - 49; return (negras ? 7 - ri : ri) * 8 + fi; };
    const de = cas(uci[0], uci[1]), a = cas(uci[2], uci[3]);
    return de < 0 || de > 63 || a < 0 || a > 63 ? -1 : a * 64 + de;
  }

  /* ───── Los pesos ───── */
  const ESC_MEDIA = 8;
  function forma(F, nb, cabeza) {
    const K = cabeza === 'media' ? VC : VC * 64;
    const L = [['in.w', F * PL * 9, PL * 9], ['in.b', F, 0]];
    for (let k = 0; k < nb; k++) L.push([`b${k}.w1`, F * F * 9, F * 9], [`b${k}.b1`, F, 0], [`b${k}.w2`, F * F * 9, F * 9, .1], [`b${k}.b2`, F, 0]);
    L.push(['pol.w1', F * F * 9, F * 9], ['pol.b1', F, 0], ['pol.w2', 64 * F, F, .1], ['pol.b2', 64, 0],
      ['val.w', VC * F, F], ['val.b', VC, 0], ['val.d1', K * 128, K], ['val.c1', 128, 0], ['val.d2', 128, 128, .1], ['val.c2', 1, 0]);
    return L.map(([nombre, n, fan, esc]) => ({ nombre, n, fan, esc: esc || 1 }));
  }
  function disposicion(F, nb, cabeza) {   // igual que GPU.bloque: cada tensor empieza en un múltiplo de 64 floats
    const T = forma(F, nb, cabeza); let off = 0;
    for (const t of T) { t.off = off; off += Math.ceil(t.n / 64) * 64; }
    return { tensores: T, total: Math.max(64, off), por: Object.fromEntries(T.map(t => [t.nombre, t])) };
  }
  function azarNormal(semilla) {
    let a = semilla >>> 0 || 1;
    const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (((t ^ (t >>> 14)) >>> 0) + 1) / 4294967297; };
    return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  }
  function crear(op) {
    op = Object.assign({ filtros: 64, bloques: 6, semilla: 1, cabeza: 'plano' }, op || {});
    const d = disposicion(op.filtros, op.bloques, op.cabeza), pesos = new Float32Array(d.total), g = azarNormal(op.semilla);
    for (const t of d.tensores) if (t.fan) { const sd = Math.sqrt(2 / t.fan) * t.esc; for (let i = 0; i < t.n; i++) pesos[t.off + i] = g() * sd; }
    return { v: 1, filtros: op.filtros, bloques: op.bloques, cabeza: op.cabeza, pesos, pasos: 0, total: d.total };
  }
  const vistaCPU = (red, nombre) => { const t = disposicion(red.filtros, red.bloques, red.cabeza).por[nombre]; return red.pesos.subarray(t.off, t.off + t.n); };

  /* ───── La red en el procesador (referencia) ───── */
  function convCPU(X, W, Bv, B, Ci, Co, k, relu, R) {
    const r = (k - 1) >> 1, Y = new Float64Array(B * Co * 64);   // doble precisión: es la referencia
    for (let b = 0; b < B; b++) for (let co = 0; co < Co; co++) for (let s = 0; s < 64; s++) {
      const y = s >> 3, x = s & 7; let acc = Bv[co];
      for (let ci = 0; ci < Ci; ci++) { const xo = (b * Ci + ci) * 64, wo = (co * Ci + ci) * k * k;
        for (let ky = -r; ky <= r; ky++) { const yy = y + ky; if (yy < 0 || yy > 7) continue; for (let kx = -r; kx <= r; kx++) { const xx = x + kx; if (xx < 0 || xx > 7) continue; acc += X[xo + yy * 8 + xx] * W[wo + (ky + r) * k + kx + r]; } } }
      const o = (b * Co + co) * 64 + s; if (R) acc += R[o]; Y[o] = relu ? Math.max(.01 * acc, acc) : acc;
    }
    return Y;
  }
  function densaCPU(A, W, c, M, K, N, relu) {
    const C = new Float64Array(M * N);
    for (let i = 0; i < M; i++) for (let j = 0; j < N; j++) { let a = c[j]; for (let q = 0; q < K; q++) a += A[i * K + q] * W[q * N + j]; C[i * N + j] = relu ? Math.max(.01 * a, a) : a; }
    return C;
  }
  function adelanteCPU(red, X, B) {
    const F = red.filtros, w = n => vistaCPU(red, n);
    let t = convCPU(X, w('in.w'), w('in.b'), B, PL, F, 3, true);
    for (let k = 0; k < red.bloques; k++) { const h = convCPU(t, w(`b${k}.w1`), w(`b${k}.b1`), B, F, F, 3, true); t = convCPU(h, w(`b${k}.w2`), w(`b${k}.b2`), B, F, F, 3, true, t); }
    const p1 = convCPU(t, w('pol.w1'), w('pol.b1'), B, F, F, 3, true), lg = convCPU(p1, w('pol.w2'), w('pol.b2'), B, F, 64, 1, false);
    const vc = convCPU(t, w('val.w'), w('val.b'), B, F, VC, 1, true), media = red.cabeza === 'media';
    let vp = vc; if (media) { vp = new Float64Array(B * VC); for (let i = 0; i < B * VC; i++) { let a = 0; for (let s = 0; s < 64; s++) a += vc[i * 64 + s]; vp[i] = a / ESC_MEDIA; } }
    const v1 = densaCPU(vp, w('val.d1'), w('val.c1'), B, media ? VC : VC * 64, 128, true), zv = densaCPU(v1, w('val.d2'), w('val.c2'), B, 128, 1, false);
    return { zv, lg };
  }
  /* La pérdida media, igual que el kernel «perdida» (para comprobar gradientes) */
  function perdidaCPU(red, X, T, Obj, B, wv, wp) {
    const { zv, lg } = adelanteCPU(red, X, B); let L = 0;
    for (let b = 0; b < B; b++) {
      const pz = 1 / (1 + Math.exp(-2 * zv[b])), y = (T[b] + 1) / 2; L += wv * -(y * Math.log(Math.max(pz, 1e-12)) + (1 - y) * Math.log(Math.max(1 - pz, 1e-12)));
      if (Obj[b] >= 0) { let m = -Infinity; for (let j = 0; j < NP; j++) m = Math.max(m, lg[b * NP + j]); let s = 0; for (let j = 0; j < NP; j++) s += Math.exp(lg[b * NP + j] - m); L += wp * (Math.log(s) + m - lg[b * NP + Obj[b]]); }
    }
    return L / B;
  }

  /* ───── La red en la gráfica ───── */
  async function enGPU(red, op) {
    const G = raiz.GPU || (typeof require !== 'undefined' ? null : null);
    if (!G) throw new Error('falta gpu.js');
    await G.iniciar(); G.preparar2();
    op = Object.assign({ lote: 256, wv: 1, wp: .1, lr: 1e-3, l2: 1e-4 }, op || {});   // elegido con el barrido en la 5080 (2026-10-22): cabeza «plano», ritmo 0,001, política 0,1   // política con peso 0,1: con 1 se lleva el tronco y el valor no aprende (medido)   // valor con entropía cruzada (0.38.0): con tanh y error cuadrático no aprendía en la red grande (medido en la 5080)
    const B = op.lote, F = red.filtros, nb = red.bloques, media = red.cabeza === 'media', KV = media ? VC : VC * 64, D = disposicion(F, nb, red.cabeza), tam = D.tensores.map(t => t.n);
    const P = G.bloque(tam), Gd = G.bloque(tam), Mm = G.bloque(tam), Vv = G.bloque(tam);
    G.escribir({ buf: P.buf, off: 0, n: D.total }, red.pesos.length === D.total ? red.pesos : Float32Array.from(red.pesos));
    const pv = n => P.vistas[D.tensores.indexOf(D.por[n])], gv = n => Gd.vistas[D.tensores.indexOf(D.por[n])];
    const act = n => G.vista(G.buffer(n)), nada = act(1);
    const X = act(B * PL * 64), x0 = act(B * F * 64), hs = [], ys = [];
    for (let k = 0; k < nb; k++) { hs.push(act(B * F * 64)); ys.push(act(B * F * 64)); }
    const p1 = act(B * F * 64), lg = act(B * NP), vc = act(B * VC * 64), vp = act(B * VC), dvp = act(B * VC), v1 = act(B * 128), zv = act(B);
    const T = act(B), Obj = act(B), Lo = act(B * 4), dzv = act(B), dlg = act(B * NP), dv1 = act(B * 128), dvc = act(B * VC * 64);
    const gA = act(B * F * 64), gB = act(B * F * 64), tmp = act(B * F * 64);
    const tronco = nb ? ys[nb - 1] : x0;
    // Hacia delante
    const ade = [G.paso('conv', [X, pv('in.w'), pv('in.b'), nada, x0], [B, PL, F, 1, 3], [], [F, B])];
    for (let k = 0; k < nb; k++) {
      const xin = k ? ys[k - 1] : x0;
      ade.push(G.paso('conv', [xin, pv(`b${k}.w1`), pv(`b${k}.b1`), nada, hs[k]], [B, F, F, 1, 3], [], [F, B]));
      ade.push(G.paso('conv', [hs[k], pv(`b${k}.w2`), pv(`b${k}.b2`), xin, ys[k]], [B, F, F, 3, 3], [], [F, B]));
    }
    ade.push(G.paso('conv', [tronco, pv('pol.w1'), pv('pol.b1'), nada, p1], [B, F, F, 1, 3], [], [F, B]));
    ade.push(G.paso('conv', [p1, pv('pol.w2'), pv('pol.b2'), nada, lg], [B, F, 64, 0, 1], [], [64, B]));
    ade.push(G.paso('conv', [tronco, pv('val.w'), pv('val.b'), nada, vc], [B, F, VC, 1, 1], [], [VC, B]));
    if (media) ade.push(G.paso('media', [vc, vp], [B, VC], [ESC_MEDIA], [VC, B]));
    ade.push(G.paso('matmul', [media ? vp : vc, pv('val.d1'), pv('val.c1'), v1], [B, KV, 128, 1], [], [8, Math.ceil(B / 16)]));
    ade.push(G.paso('matmul', [v1, pv('val.d2'), pv('val.c2'), zv], [B, 128, 1, 0], [], [1, Math.ceil(B / 16)]));
    const perd = G.paso('perdida', [zv, lg, T, Obj, dzv, dlg, Lo], [B, NP], [op.wv, op.wp], [B]);
    // Hacia atrás
    const atr = [];
    // valor
    atr.push(G.paso('matmul', [v1, dzv, nada, gv('val.d2')], [128, B, 1, 2 | 8], [], [1, 8]));
    atr.push(G.paso('columnas', [dzv, gv('val.c2')], [B, 1], [], [1]));
    atr.push(G.paso('matmul', [dzv, pv('val.d2'), nada, dv1], [B, 1, 128, 4 | 8], [], [8, Math.ceil(B / 16)]));
    atr.push(G.paso('reluAtras', [v1, dv1], [B * 128], [], G.lineal(B * 128)));
    atr.push(G.paso('matmul', [media ? vp : vc, dv1, nada, gv('val.d1')], [KV, B, 128, 2 | 8], [], [8, Math.ceil(KV / 16)]));
    atr.push(G.paso('columnas', [dv1, gv('val.c1')], [B, 128], [], [2]));
    if (media) { atr.push(G.paso('matmul', [dv1, pv('val.d1'), nada, dvp], [B, 128, VC, 4 | 8], [], [Math.ceil(VC / 16), Math.ceil(B / 16)])); atr.push(G.paso('mediaAtras', [dvp, dvc], [B * VC * 64], [ESC_MEDIA], G.lineal(B * VC * 64))); }
    else atr.push(G.paso('matmul', [dv1, pv('val.d1'), nada, dvc], [B, 128, VC * 64, 4 | 8], [], [VC * 4, Math.ceil(B / 16)]));
    atr.push(G.paso('reluAtras', [vc, dvc], [B * VC * 64], [], G.lineal(B * VC * 64)));
    atr.push(G.paso('convW', [dvc, tronco, gv('val.w')], [B, F, VC, 0, 1], [], [F, VC]));
    atr.push(G.paso('planos', [dvc, gv('val.b')], [B, 0, VC], [], [VC]));
    atr.push(G.paso('convX', [dvc, pv('val.w'), gA], [B, F, VC, 0, 1], [], [F, B]));
    // política
    atr.push(G.paso('convW', [dlg, p1, gv('pol.w2')], [B, F, 64, 0, 1], [], [F, 64]));
    atr.push(G.paso('planos', [dlg, gv('pol.b2')], [B, 0, 64], [], [64]));
    atr.push(G.paso('convX', [dlg, pv('pol.w2'), tmp], [B, F, 64, 0, 1], [], [F, B]));
    atr.push(G.paso('reluAtras', [p1, tmp], [B * F * 64], [], G.lineal(B * F * 64)));
    atr.push(G.paso('convW', [tmp, tronco, gv('pol.w1')], [B, F, F, 0, 3], [], [F, F]));
    atr.push(G.paso('planos', [tmp, gv('pol.b1')], [B, 0, F], [], [F]));
    atr.push(G.paso('convX', [tmp, pv('pol.w1'), gA], [B, F, F, 1, 3], [], [F, B]));
    // tronco, de arriba abajo
    let gc = gA, gn = gB;
    for (let k = nb - 1; k >= 0; k--) {
      const xin = k ? ys[k - 1] : x0;
      atr.push(G.paso('reluAtras', [ys[k], gc], [B * F * 64], [], G.lineal(B * F * 64)));
      atr.push(G.paso('convW', [gc, hs[k], gv(`b${k}.w2`)], [B, F, F, 0, 3], [], [F, F]));
      atr.push(G.paso('planos', [gc, gv(`b${k}.b2`)], [B, 0, F], [], [F]));
      atr.push(G.paso('convX', [gc, pv(`b${k}.w2`), tmp], [B, F, F, 0, 3], [], [F, B]));
      atr.push(G.paso('reluAtras', [hs[k], tmp], [B * F * 64], [], G.lineal(B * F * 64)));
      atr.push(G.paso('convW', [tmp, xin, gv(`b${k}.w1`)], [B, F, F, 0, 3], [], [F, F]));
      atr.push(G.paso('planos', [tmp, gv(`b${k}.b1`)], [B, 0, F], [], [F]));
      atr.push(G.paso('convX', [tmp, pv(`b${k}.w1`), gn], [B, F, F, 0, 3], [], [F, B]));
      atr.push(G.paso('sumar', [gc, gn], [B * F * 64], [], G.lineal(B * F * 64)));   // el atajo residual
      [gc, gn] = [gn, gc];
    }
    atr.push(G.paso('reluAtras', [x0, gc], [B * F * 64], [], G.lineal(B * F * 64)));
    atr.push(G.paso('convW', [gc, X, gv('in.w')], [B, PL, F, 0, 3], [], [PL, F]));
    atr.push(G.paso('planos', [gc, gv('in.b')], [B, 0, F], [], [F]));
    const todoP = { buf: P.buf, off: 0, n: D.total }, todoG = { buf: Gd.buf, off: 0, n: D.total };
    const adam = G.paso('adam', [todoG, todoP, { buf: Mm.buf, off: 0, n: D.total }, { buf: Vv.buf, off: 0, n: D.total }], [D.total], [op.lr, .9, .999, 1e-8, 1, 1, op.l2], G.lineal(D.total));
    let t = red.pasos || 0;
    const Xc = new Float32Array(B * PL * 64), Tc = new Float32Array(B), Oc = new Float32Array(B);
    const subir = lote => {
      for (let i = 0; i < B; i++) { const m = lote[i % lote.length]; Xc.set(m.x, i * PL * 64); Tc[i] = m.t; Oc[i] = m.obj; }
      G.escribir(X, Xc); G.escribir(T, Tc); G.escribir(Obj, Oc);
    };
    const resumir = lo => { let v = 0, p = 0, a = 0, n = 0; for (let i = 0; i < lo.length; i += 4) { v += lo[i]; p += lo[i + 1]; a += lo[i + 2]; n += lo[i + 3]; } const m = lo.length / 4; return { valor: v / m, politica: n ? p / n : 0, acierto: n ? a / n : 0, conJugada: n }; };
    return {
      lote: B, disposicion: D, depurar: { X, x0, ys, hs, p1, lg, vc, vp, dvp, v1, zv, dzv, dv1, dvc, dlg, gA, gB, tmp },
      /* Un paso de entrenamiento con «lote» muestras { x: planos, t: valor −1…1, obj: índice de jugada o −1 } */
      async paso(lote, conMedida) {
        subir(lote); t++;
        adam.fu[0] = op.lr; adam.fu[4] = 1 - Math.pow(.9, t); adam.fu[5] = 1 - Math.pow(.999, t); G.actualizar(adam);
        const e = G.dev.createCommandEncoder(); G.lanzar(e, ade.concat([perd], atr, [adam])); G.dev.queue.submit([e.finish()]);
        red.pasos = t;
        if (conMedida) return resumir(await G.leerVista(Lo));
        return null;
      },
      /* El error sin aprender (posiciones de prueba) */
      async medir(muestras) {
        const out = [];
        for (let i = 0; i < muestras.length; i += B) {
          const trozo = muestras.slice(i, i + B);
          subir(trozo); const e = G.dev.createCommandEncoder(); G.lanzar(e, ade.concat([perd])); G.dev.queue.submit([e.finish()]);
          const lo = await G.leerVista(Lo); for (let k = 0; k < trozo.length * 4; k++) out.push(lo[k]);
        }
        return resumir(out);
      },
      /* Valoración y política de unas posiciones (para la fase 3) */
      async valorar(muestras) {
        subir(muestras); const e = G.dev.createCommandEncoder(); G.lanzar(e, ade); G.dev.queue.submit([e.finish()]);
        const z = await G.leerVista(zv), l = await G.leerVista(lg), n = Math.min(B, muestras.length);
        return { valor: Array.from(z.subarray(0, n), Math.tanh), politica: l.subarray(0, n * NP) };
      },
      async gradientes() { return G.leerVista(todoG); },
      async pesos() { const p = await G.leerVista(todoP); red.pesos = p; return p; },
      async esperar() { await G.dev.queue.onSubmittedWorkDone(); },
      cerrar() { for (const b of [P.buf, Gd.buf, Mm.buf, Vv.buf]) b.destroy(); }
    };
  }

  /* Una muestra de entrenamiento a partir de [fen, y (probabilidad de ganar de las blancas), fuente, mejor jugada] */
  function muestra(fen, y, mejor) {
    const negras = / b /.test(fen), x = codificar(fen, new Float32Array(PL * 64));
    const v = 2 * y - 1;
    return { x, t: negras ? -v : v, obj: indiceJugada(mejor, negras) };
  }

  const Red = { PL, NP, VC, codificar, indiceJugada, forma, disposicion, crear, vistaCPU, adelanteCPU, perdidaCPU, convCPU, enGPU, muestra };
  if (typeof module !== 'undefined' && module.exports) module.exports = Red; else raiz.Red = Red;
})(typeof self !== 'undefined' ? self : this);
