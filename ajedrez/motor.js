/* Araña juega al ajedrez — el cerebro (fase 1).
   Un solo fichero para todas las versiones (web, Android, iPhone) y para las pruebas en Node.
   Reglas propias (tablero 0x88, sin dependencias), 45 detectores de posición con gen de encendido,
   tres ejes (fase, estructura, temperatura), búsqueda alfa-beta y el algoritmo genético.
   Diseño completo: claude/ajedrez-diseno.md en el proyecto de Juan. */
(function (root) {
'use strict';

/* ───────────── Reglas ───────────── */
const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
const VAL = [0, 100, 300, 320, 500, 900, 0];      // valores fijos, solo para ordenar jugadas y arbitrar
const ORD = [0, 1, 3, 3, 5, 9, 20];               // valor «de atacante» (para mínimos y SEE)
const ND = [33, 31, 18, 14, -33, -31, -18, -14], BD = [17, 15, -17, -15], RD = [16, 1, -16, -1], KD = [17, 16, 15, 1, -1, -15, -16, -17];
const LETRA = ' pnbrqk';
const CAS_MASK = new Uint8Array(128).fill(15);
CAS_MASK[0x00] = 15 & ~2; CAS_MASK[0x04] = 15 & ~3; CAS_MASK[0x07] = 15 & ~1;
CAS_MASK[0x70] = 15 & ~8; CAS_MASK[0x74] = 15 & ~12; CAS_MASK[0x77] = 15 & ~4;
const INICIO = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function mulberry(seed) { let a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const zr = mulberry(20261021);
const ZL = new Int32Array(16 * 128), ZH = new Int32Array(16 * 128), ZCL = new Int32Array(16), ZCH = new Int32Array(16), ZEL = new Int32Array(8), ZEH = new Int32Array(8);
const z32 = () => (zr() * 4294967296) | 0, z21 = () => (zr() * 2097152) | 0;
for (let i = 0; i < ZL.length; i++) { ZL[i] = z32(); ZH[i] = z21(); }
for (let i = 0; i < 16; i++) { ZCL[i] = z32(); ZCH[i] = z21(); }
for (let i = 0; i < 8; i++) { ZEL[i] = z32(); ZEH[i] = z21(); }
const ZSL = z32(), ZSH = z21();

const sqName = s => 'abcdefgh'[s & 7] + ((s >> 4) + 1);
const sqParse = t => (t.charCodeAt(0) - 97) + (t.charCodeAt(1) - 49) * 16;
const mFrom = m => m & 127, mTo = m => (m >> 7) & 127, mPro = m => (m >> 14) & 7, mFl = m => m >> 17;
const mk = (f, t, pr, fl) => f | (t << 7) | (pr << 14) | (fl << 17);   // fl: 1 captura, 2 al paso, 4 enroque, 8 doble

function Pos(fen) { this.b = new Int8Array(128); this.k = [0, 0]; this.hist = []; this.keys = []; this.load(fen || INICIO); }
Pos.prototype.load = function (fen) {
  const f = fen.trim().split(/\s+/), b = this.b; b.fill(0);
  let r = 7, c = 0;
  for (const ch of f[0]) {
    if (ch === '/') { r--; c = 0; continue; }
    if (ch >= '1' && ch <= '8') { c += +ch; continue; }
    const lo = ch.toLowerCase(), t = LETRA.indexOf(lo), col = ch === lo ? 1 : 0, sq = r * 16 + c;
    b[sq] = (col << 3) | t; if (t === K) this.k[col] = sq; c++;
  }
  this.side = f[1] === 'b' ? 1 : 0;
  this.cas = 0; const cs = f[2] || '-';
  if (cs.includes('K')) this.cas |= 1; if (cs.includes('Q')) this.cas |= 2; if (cs.includes('k')) this.cas |= 4; if (cs.includes('q')) this.cas |= 8;
  this.ep = f[3] && f[3] !== '-' ? sqParse(f[3]) : -1;
  this.half = +(f[4] || 0); this.full = +(f[5] || 1);
  this.hist.length = 0; this.keys.length = 0; this.rehash(); this.keys.push(this.key());
  return this;
};
Pos.prototype.rehash = function () {
  let l = 0, h = 0;
  for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const p = this.b[s]; if (p) { l ^= ZL[p * 128 + s]; h ^= ZH[p * 128 + s]; } }
  if (this.side) { l ^= ZSL; h ^= ZSH; }
  l ^= ZCL[this.cas]; h ^= ZCH[this.cas];
  if (this.ep >= 0) { l ^= ZEL[this.ep & 7]; h ^= ZEH[this.ep & 7]; }
  this.hl = l; this.hh = h;
};
Pos.prototype.key = function () { return (this.hh & 0x1FFFFF) * 4294967296 + (this.hl >>> 0); };
Pos.prototype.fen = function () {
  let s = '';
  for (let r = 7; r >= 0; r--) {
    let e = 0;
    for (let c = 0; c < 8; c++) {
      const p = this.b[r * 16 + c];
      if (!p) { e++; continue; }
      if (e) { s += e; e = 0; }
      const ch = LETRA[p & 7]; s += p >> 3 ? ch : ch.toUpperCase();
    }
    if (e) s += e; if (r) s += '/';
  }
  let cs = (this.cas & 1 ? 'K' : '') + (this.cas & 2 ? 'Q' : '') + (this.cas & 4 ? 'k' : '') + (this.cas & 8 ? 'q' : '');
  return s + ' ' + (this.side ? 'b' : 'w') + ' ' + (cs || '-') + ' ' + (this.ep >= 0 ? sqName(this.ep) : '-') + ' ' + this.half + ' ' + this.full;
};
Pos.prototype.make = function (m) {
  const b = this.b, f = m & 127, t = (m >> 7) & 127, pr = (m >> 14) & 7, fl = m >> 17;
  const p = b[f], c = p >> 3;
  let capSq = t; if (fl & 2) capSq = t + (c ? 16 : -16);
  const cap = b[capSq];
  this.hist.push([m, p, cap, this.cas, this.ep, this.half, this.hl, this.hh]);
  let l = this.hl, h = this.hh;
  l ^= ZL[p * 128 + f]; h ^= ZH[p * 128 + f];
  if (cap) { l ^= ZL[cap * 128 + capSq]; h ^= ZH[cap * 128 + capSq]; b[capSq] = 0; }
  b[f] = 0;
  const np = pr ? (c << 3) | pr : p; b[t] = np; l ^= ZL[np * 128 + t]; h ^= ZH[np * 128 + t];
  if (fl & 4) {
    const rf = t > f ? f + 3 : f - 4, rt = t > f ? f + 1 : f - 1, rk = (c << 3) | R;
    b[rf] = 0; b[rt] = rk; l ^= ZL[rk * 128 + rf] ^ ZL[rk * 128 + rt]; h ^= ZH[rk * 128 + rf] ^ ZH[rk * 128 + rt];
  }
  if ((p & 7) === K) this.k[c] = t;
  if (this.ep >= 0) { l ^= ZEL[this.ep & 7]; h ^= ZEH[this.ep & 7]; }
  this.ep = fl & 8 ? (f + t) >> 1 : -1;
  if (this.ep >= 0) { l ^= ZEL[this.ep & 7]; h ^= ZEH[this.ep & 7]; }
  l ^= ZCL[this.cas]; h ^= ZCH[this.cas];
  this.cas &= CAS_MASK[f] & CAS_MASK[t];
  l ^= ZCL[this.cas]; h ^= ZCH[this.cas];
  this.half = ((p & 7) === P || cap) ? 0 : this.half + 1;
  if (c) this.full++;
  this.side ^= 1; l ^= ZSL; h ^= ZSH;
  this.hl = l; this.hh = h; this.keys.push(this.key());
};
Pos.prototype.unmake = function () {
  const u = this.hist.pop(), b = this.b, m = u[0], p = u[1], cap = u[2];
  const f = m & 127, t = (m >> 7) & 127, fl = m >> 17, c = p >> 3;
  b[f] = p; b[t] = 0;
  if (fl & 2) b[t + (c ? 16 : -16)] = cap; else b[t] = cap;
  if (fl & 4) { const rf = t > f ? f + 3 : f - 4, rt = t > f ? f + 1 : f - 1; b[rf] = b[rt]; b[rt] = 0; }
  if ((p & 7) === K) this.k[c] = f;
  this.cas = u[3]; this.ep = u[4]; this.half = u[5]; this.hl = u[6]; this.hh = u[7];
  if (c) this.full--;
  this.side = c; this.keys.pop();
};
Pos.prototype.clone = function () { const q = new Pos(this.fen()); return q; };

function attacked(pos, sq, by) {
  const b = pos.b, o = by << 3;
  if (by === 0) { let s = sq - 15; if (!(s & 0x88) && b[s] === P) return true; s = sq - 17; if (!(s & 0x88) && b[s] === P) return true; }
  else { let s = sq + 15; if (!(s & 0x88) && b[s] === (8 | P)) return true; s = sq + 17; if (!(s & 0x88) && b[s] === (8 | P)) return true; }
  for (let i = 0; i < 8; i++) { const s = sq + ND[i]; if (!(s & 0x88) && b[s] === (o | N)) return true; }
  for (let i = 0; i < 8; i++) { const s = sq + KD[i]; if (!(s & 0x88) && b[s] === (o | K)) return true; }
  for (let i = 0; i < 4; i++) { const d = BD[i]; let s = sq + d; while (!(s & 0x88)) { const p = b[s]; if (p) { if (p === (o | B) || p === (o | Q)) return true; break; } s += d; } }
  for (let i = 0; i < 4; i++) { const d = RD[i]; let s = sq + d; while (!(s & 0x88)) { const p = b[s]; if (p) { if (p === (o | R) || p === (o | Q)) return true; break; } s += d; } }
  return false;
}
const inCheck = pos => attacked(pos, pos.k[pos.side], pos.side ^ 1);

function gen(pos, out, soloCapturas) {
  const b = pos.b, us = pos.side, them = us ^ 1;
  out.length = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = b[sq]; if (!p || (p >> 3) !== us) continue;
    const t = p & 7;
    if (t === P) {
      const dir = us ? -16 : 16, last = us ? 0 : 7, start = us ? 6 : 1, to = sq + dir;
      if (!(to & 0x88) && !b[to]) {
        if ((to >> 4) === last) { out.push(mk(sq, to, Q, 0)); if (!soloCapturas) { out.push(mk(sq, to, N, 0), mk(sq, to, R, 0), mk(sq, to, B, 0)); } }
        else if (!soloCapturas) { out.push(mk(sq, to, 0, 0)); if ((sq >> 4) === start && !b[to + dir]) out.push(mk(sq, to + dir, 0, 8)); }
      }
      for (const d of [dir - 1, dir + 1]) {
        const s = sq + d; if (s & 0x88) continue;
        if (b[s] && (b[s] >> 3) === them) {
          if ((s >> 4) === last) { out.push(mk(sq, s, Q, 1)); if (!soloCapturas) out.push(mk(sq, s, N, 1), mk(sq, s, R, 1), mk(sq, s, B, 1)); }
          else out.push(mk(sq, s, 0, 1));
        } else if (s === pos.ep) out.push(mk(sq, s, 0, 3));
      }
    } else if (t === N || t === K) {
      const D = t === N ? ND : KD;
      for (let i = 0; i < 8; i++) {
        const s = sq + D[i]; if (s & 0x88) continue;
        const q = b[s];
        if (!q) { if (!soloCapturas) out.push(mk(sq, s, 0, 0)); } else if ((q >> 3) === them) out.push(mk(sq, s, 0, 1));
      }
    } else {
      const D = t === B ? BD : t === R ? RD : KD;
      for (let i = 0; i < D.length; i++) {
        const d = D[i]; let s = sq + d;
        while (!(s & 0x88)) {
          const q = b[s];
          if (!q) { if (!soloCapturas) out.push(mk(sq, s, 0, 0)); } else { if ((q >> 3) === them) out.push(mk(sq, s, 0, 1)); break; }
          s += d;
        }
      }
    }
  }
  if (!soloCapturas) {
    const o = us ? 0x70 : 0;
    if (pos.cas & (us ? 4 : 1) && !b[o + 5] && !b[o + 6] && b[o + 7] === ((us << 3) | R) && !attacked(pos, o + 4, them) && !attacked(pos, o + 5, them) && !attacked(pos, o + 6, them)) out.push(mk(o + 4, o + 6, 0, 4));
    if (pos.cas & (us ? 8 : 2) && !b[o + 3] && !b[o + 2] && !b[o + 1] && b[o] === ((us << 3) | R) && !attacked(pos, o + 4, them) && !attacked(pos, o + 3, them) && !attacked(pos, o + 2, them)) out.push(mk(o + 4, o + 2, 0, 4));
  }
  return out;
}
function legal(pos) {
  const ps = gen(pos, []), r = [], us = pos.side;
  for (const m of ps) { pos.make(m); if (!attacked(pos, pos.k[us], us ^ 1)) r.push(m); pos.unmake(); }
  return r;
}
function hasLegal(pos) {
  const ps = gen(pos, []), us = pos.side;
  for (const m of ps) { pos.make(m); const ok = !attacked(pos, pos.k[us], us ^ 1); pos.unmake(); if (ok) return true; }
  return false;
}
function perft(pos, d) {
  if (d === 0) return 1;
  const ps = gen(pos, []), us = pos.side; let n = 0;
  for (const m of ps) { pos.make(m); if (!attacked(pos, pos.k[us], us ^ 1)) n += d === 1 ? 1 : perft(pos, d - 1); pos.unmake(); }
  return n;
}
const uci = m => sqName(mFrom(m)) + sqName(mTo(m)) + (mPro(m) ? LETRA[mPro(m)] : '');
function parseUci(pos, s) { for (const m of legal(pos)) if (uci(m) === s) return m; return 0; }
function insuficiente(pos) {
  const b = pos.b; let menores = 0, alfiles = [[], []];
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    const t = b[s] & 7; if (!b[s] || t === K) continue;
    if (t === P || t === R || t === Q) return false;
    menores++; if (t === B) alfiles[b[s] >> 3].push(((s >> 4) + (s & 7)) & 1);
  }
  if (menores <= 1) return true;
  if (menores === 2 && alfiles[0].length === 1 && alfiles[1].length === 1 && alfiles[0][0] === alfiles[1][0]) return true;
  return false;
}
function repeticiones(pos) { const ks = pos.keys, k = ks[ks.length - 1]; let n = 0; for (let i = ks.length - 1, j = 0; i >= 0 && j <= pos.half; i -= 2, j += 2) if (ks[i] === k) n++; return n; }
/* ¿Se ha acabado? null si no; {res: 1 gana blancas, 0 negras, .5 tablas, motivo} */
function fin(pos) {
  if (!hasLegal(pos)) return inCheck(pos) ? { res: pos.side ? 1 : 0, motivo: 'mate' } : { res: .5, motivo: 'ahogado' };
  if (pos.half >= 100) return { res: .5, motivo: '50 jugadas' };
  if (repeticiones(pos) >= 3) return { res: .5, motivo: 'repetición' };
  if (insuficiente(pos)) return { res: .5, motivo: 'material insuficiente' };
  return null;
}

/* ───────────── Ayudas de posición ───────────── */
const cheb = (a, b) => Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 4) - (b >> 4)));
const rr = (c, s) => c ? 7 - (s >> 4) : s >> 4;                          // fila relativa (0 = su primera fila)
const cdist = s => Math.max(Math.abs((s & 7) - 3.5), Math.abs((s >> 4) - 3.5)) - 0.5;   // 0 en el centro … 3 en el borde
const UNIT = [0, 0, 2, 2, 3, 5, 0];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* El contexto se reutiliza en cada evaluación para no crear basura */
function Ctx() {
  this.L = [[], []]; for (let c = 0; c < 2; c++) for (let t = 0; t < 7; t++) this.L[c].push([]);
  this.pf = [new Int8Array(8), new Int8Array(8)];
  this.pa = [new Uint8Array(128), new Uint8Array(128)];      // ataques de peón
  this.cnt = [new Uint8Array(128), new Uint8Array(128)];     // nº de atacantes
  this.mn = [new Uint8Array(128), new Uint8Array(128)];      // valor del atacante más barato
  this.last = [new Int16Array(128), new Int16Array(128)];    // último atacante (único si cnt = 1)
  this.byT = [[], []]; for (let c = 0; c < 2; c++) for (let t = 0; t < 7; t++) this.byT[c].push(new Uint8Array(128));
  this.mob = [new Float64Array(7), new Float64Array(7)];
  this.ku = [0, 0];
  this.zone = [new Uint8Array(128), new Uint8Array(128)];
  this.acc = 0; this.G = null;
}
Ctx.prototype.add = function (o, v) {
  if (v === 0) return;
  const g = this.G;
  this.acc += v * (this.op * g[o] + this.mj * g[o + 1] + this.fi * g[o + 2] + this.es * g[o + 3] + this.tp * g[o + 4]);
};
Ctx.prototype.base = function (pos) {
  this.pos = pos;
  const L = this.L, b = pos.b;
  for (let c = 0; c < 2; c++) { for (let t = 0; t < 7; t++) L[c][t].length = 0; this.pf[c].fill(0); this.pa[c].fill(0); }
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    const p = b[s]; if (!p) continue;
    const c = p >> 3, t = p & 7; L[c][t].push(s);
    if (t === P) {
      this.pf[c][s & 7]++;
      const d = c ? -16 : 16;
      if (!((s + d - 1) & 0x88)) this.pa[c][s + d - 1]++;
      if (!((s + d + 1) & 0x88)) this.pa[c][s + d + 1]++;
    }
  }
  this.hasAtt = false;
};
Ctx.prototype.att = function () {
  if (this.hasAtt) return; this.hasAtt = true;
  const b = this.pos.b;
  for (let c = 0; c < 2; c++) {
    this.cnt[c].fill(0); this.mn[c].fill(255); this.mob[c].fill(0); this.ku[c] = 0; this.zone[c].fill(0);
    for (let t = 0; t < 7; t++) this.byT[c][t].fill(0);
    const k = this.pos.k[c]; this.zone[c][k] = 1;
    for (const d of KD) { const s = k + d; if (!(s & 0x88)) this.zone[c][s] = 1; }
  }
  const mark = (c, t, from, s) => { this.cnt[c][s]++; if (ORD[t] < this.mn[c][s]) this.mn[c][s] = ORD[t]; this.last[c][s] = from; this.byT[c][t][s]++; };
  for (let c = 0; c < 2; c++) {
    const them = c ^ 1, L = this.L[c];
    for (const s of L[P]) { const d = c ? -16 : 16; for (const e of [d - 1, d + 1]) { const x = s + e; if (!(x & 0x88)) mark(c, P, s, x); } }
    for (const t of [N, B, R, Q, K]) {
      for (const s of L[t]) {
        let mob = 0, inZone = false;
        if (t === N || t === K) {
          const D = t === N ? ND : KD;
          for (const d of D) { const x = s + d; if (x & 0x88) continue; mark(c, t, s, x); if (this.zone[them][x]) inZone = true; if ((!b[x] || (b[x] >> 3) === them) && !this.pa[them][x]) mob++; }
        } else {
          const D = t === B ? BD : t === R ? RD : KD;
          for (const d of D) {
            let x = s + d;
            while (!(x & 0x88)) {
              mark(c, t, s, x); if (this.zone[them][x]) inZone = true;
              const q = b[x];
              if ((!q || (q >> 3) === them) && !this.pa[them][x]) mob++;
              if (q) break; x += d;
            }
          }
        }
        this.mob[c][t] += mob;
        if (inZone && t !== K) this.ku[c] += UNIT[t];
      }
    }
  }
};
/* Atacantes de una casilla para el SEE: valores ordenados */
function atacantes(pos, sq, c) {
  const b = pos.b, o = c << 3, r = [];
  const ps = c ? [sq + 15, sq + 17] : [sq - 15, sq - 17];
  for (const s of ps) if (!(s & 0x88) && b[s] === (o | P)) r.push(VAL[P]);
  for (const d of ND) { const s = sq + d; if (!(s & 0x88) && b[s] === (o | N)) r.push(VAL[N]); }
  for (const d of BD) { let s = sq + d; while (!(s & 0x88)) { const p = b[s]; if (p) { if (p === (o | B)) r.push(VAL[B]); else if (p === (o | Q)) r.push(VAL[Q]); break; } s += d; } }
  for (const d of RD) { let s = sq + d; while (!(s & 0x88)) { const p = b[s]; if (p) { if (p === (o | R)) r.push(VAL[R]); else if (p === (o | Q)) r.push(VAL[Q]); break; } s += d; } }
  for (const d of KD) { const s = sq + d; if (!(s & 0x88) && b[s] === (o | K)) r.push(10000); }
  return r.sort((x, y) => x - y);
}
function see(pos, sq, c) {
  const v = pos.b[sq] ? (VAL[pos.b[sq] & 7] || 10000) : 0;
  const A = [atacantes(pos, sq, c), atacantes(pos, sq, c ^ 1)];
  if (!A[0].length) return 0;
  const g = [v]; let side = 0, ia = [0, 0], cur = A[0][ia[0]++], d = 0;
  while (true) {
    side ^= 1; if (ia[side] >= A[side].length) break;
    d++; g[d] = cur - g[d - 1]; cur = A[side][ia[side]++];
    if (cur === 10000 && ia[side ^ 1] < A[side ^ 1].length) { break; }
  }
  while (d > 0) { g[d - 1] = -Math.max(-g[d - 1], g[d]); d--; }
  return g[0];
}
function pasado(x, c, s) {
  const b = x.pos.b, f = s & 7, them = (c ^ 1) << 3 | P, d = c ? -16 : 16;
  for (let y = s + d; !(y & 0x88); y += d) {
    if (b[y] === them) return false;
    if (f > 0 && b[y - 1] === them) return false;
    if (f < 7 && b[y + 1] === them) return false;
  }
  return true;
}
function piezasMenoresYMayores(x, c) { const L = x.L[c]; return L[N].length + L[B].length + L[R].length + L[Q].length; }
function materialPeones(x) { let m = 0; for (let t = P; t <= Q; t++) m += (x.L[0][t].length - x.L[1][t].length) * VAL[t]; return clamp(m / 100, -6, 6); }
function mateEn1(pos, c) {
  if (pos.side !== c && inCheck(pos)) return 0;   // posición imposible: el bando que no mueve ya da jaque
  const s0 = pos.side, e0 = pos.ep; pos.side = c; if (s0 !== c) pos.ep = -1;
  let found = 0; const ms = gen(pos, []);
  for (const m of ms) {
    pos.make(m);
    if (!attacked(pos, pos.k[c], c ^ 1) && attacked(pos, pos.k[c ^ 1], c) && !hasLegal(pos)) found = 1;
    pos.unmake(); if (found) break;
  }
  pos.side = s0; pos.ep = e0; return found;
}

/* ───────────── Los 45 detectores ─────────────
   Cada detector: número de la lista que eligió Juan, nombre, coste (0 barato, 1 medio, 2 caro),
   si necesita el mapa de ataques, nombres de sus medidas y valores iniciales [apertura, medio juego, final].
   f(x, o, s, c): x contexto, o posición de sus genes; las medidas se suman con signo (blancas +, negras −). */
const I3 = (a, m, f) => [a, m, f];
const DET = [];
function det(n, nombre, coste, att, medidas, init, f) { DET.push({ n, nombre, coste, att, medidas, nf: medidas.length, init, f }); }
const COLORES = [0, 1];
function porColor(x, o, fn) { for (const c of COLORES) fn(c, c ? -1 : 1); }

// —— Baratos ——
det(1, 'Valor de las piezas', 0, false, ['peón', 'caballo', 'alfil', 'torre', 'dama'],
  [I3(100, 100, 110), I3(310, 310, 300), I3(320, 330, 330), I3(470, 500, 540), I3(900, 920, 950)],
  (x, o) => { for (let t = P; t <= Q; t++) x.add(o + (t - 1) * 5, x.L[0][t].length - x.L[1][t].length); });
det(2, 'Pareja de alfiles', 0, false, ['pareja'], [I3(20, 35, 50)],
  (x, o) => x.add(o, (x.L[0][B].length >= 2 ? 1 : 0) - (x.L[1][B].length >= 2 ? 1 : 0)));
det(3, 'Desequilibrios', 0, false, ['torre contra menor', 'dos menores contra torre', 'dama contra dos torres', 'caballo y peones'],
  [I3(0, 0, 0), I3(0, 0, 0), I3(0, 0, 0), I3(4, 6, 6)],
  (x, o) => {
    const L = x.L, m = (L[0][N].length + L[0][B].length) - (L[1][N].length + L[1][B].length), r = L[0][R].length - L[1][R].length, q = L[0][Q].length - L[1][Q].length;
    x.add(o, (r === 1 && m === -1) ? 1 : (r === -1 && m === 1) ? -1 : 0);
    x.add(o + 5, (r === -1 && m === 2) ? 1 : (r === 1 && m === -2) ? -1 : 0);
    x.add(o + 10, (q === 1 && r === -2) ? 1 : (q === -1 && r === 2) ? -1 : 0);
    x.add(o + 15, (L[0][N].length - L[1][N].length) * (L[0][P].length + L[1][P].length - 10) / 6);
  });
/* Tablas de casillas: 6 piezas × 32 casillas (simetría izquierda-derecha) */
const PST_N = 32;
function pstIdx(c, s) { const r = rr(c, s), f = s & 7; return r * 4 + (f < 4 ? f : 7 - f); }
function pstInit(t, i) {
  const r = i >> 2, f4 = i & 3, cd = (3 - f4) + Math.max(0, Math.abs(r - 3.5) - 0.5);
  switch (t) {
    case P: return r === 0 || r === 7 ? I3(0, 0, 0) : I3((r - 1) * 4 + (f4 >= 2 && r >= 2 && r <= 4 ? 10 : 0), (r - 1) * 5 + (f4 >= 2 && r >= 2 && r <= 4 ? 6 : 0), (r - 1) * 12);
    case N: return I3(16 - cd * 8, 16 - cd * 8, 10 - cd * 6);
    case B: return I3(8 - cd * 4, 8 - cd * 4, 6 - cd * 3);
    case R: { const v = (r === 6 ? 15 : 0) + (f4 >= 2 ? 3 : 0); return I3(v, v, v / 2); }
    case Q: return I3(-cd * 2, -cd * 2, -cd * 3);
    case K: { const m = r === 0 ? (f4 <= 1 ? 20 : f4 === 2 ? 0 : -10) : -r * 15; return I3(m, m, 20 - cd * 8); }
  }
}
{
  const meds = [], init = [];
  for (let t = P; t <= K; t++) for (let i = 0; i < PST_N; i++) { meds.push(LETRA[t].toUpperCase() + ' ' + 'abcd'[i & 3] + ((i >> 2) + 1)); init.push(pstInit(t, i)); }
  det(4, 'Tablas de casillas', 0, false, meds, init, (x, o) => {
    for (const c of COLORES) { const s = c ? -1 : 1, L = x.L[c]; for (let t = P; t <= K; t++) { const ot = o + (t - 1) * PST_N * 5; for (const sq of L[t]) x.add(ot + pstIdx(c, sq) * 5, s); } }
  });
}
const CENTRO = [0x33, 0x34, 0x43, 0x44];
det(5, 'Control del centro', 0, false, ['ocupación', 'peones que atacan el centro', 'centro ampliado'],
  [I3(10, 8, 0), I3(8, 5, 0), I3(3, 2, 0)],
  (x, o) => {
    const b = x.pos.b;
    for (const c of COLORES) {
      const s = c ? -1 : 1; let oc = 0, pa = 0, amp = 0;
      for (const q of CENTRO) { if (b[q] && (b[q] >> 3) === c && (b[q] & 7) !== K) oc++; pa += x.pa[c][q]; }
      for (let r = 2; r <= 5; r++) for (let f = 2; f <= 5; f++) { const q = r * 16 + f; amp += x.pa[c][q] ? 1 : 0; if (b[q] && (b[q] >> 3) === c && (b[q] & 7) !== K && (b[q] & 7) !== P) amp++; }
      x.add(o, s * oc); x.add(o + 5, s * pa); x.add(o + 10, s * amp);
    }
  });
det(11, 'Enroque', 0, false, ['enrocado', 'perdió el enroque sin enrocar', 'rey en el centro'],
  [I3(25, 20, 0), I3(-25, -15, 0), I3(-10, -20, 0)],
  (x, o) => {
    const pos = x.pos;
    for (const c of COLORES) {
      const s = c ? -1 : 1, k = pos.k[c], r = rr(c, k), f = k & 7, rights = pos.cas & (c ? 12 : 3);
      const castled = r === 0 && (f >= 6 || f <= 2) && !rights;
      x.add(o, s * (castled ? 1 : 0));
      x.add(o + 5, s * (!rights && !castled ? 1 : 0));
      x.add(o + 10, s * ((f === 3 || f === 4) && !rights ? 1 : 0));
    }
  });
det(12, 'Peones débiles', 0, false, ['doblados', 'aislados', 'retrasados'],
  [I3(-12, -12, -20), I3(-10, -12, -18), I3(-6, -8, -8)],
  (x, o) => {
    const b = x.pos.b;
    for (const c of COLORES) {
      const s = c ? -1 : 1, pf = x.pf[c]; let dob = 0, ais = 0, ret = 0;
      for (let f = 0; f < 8; f++) if (pf[f] > 1) dob += pf[f] - 1;
      for (const sq of x.L[c][P]) {
        const f = sq & 7, r = rr(c, sq);
        if ((f === 0 || !pf[f - 1]) && (f === 7 || !pf[f + 1])) { ais++; continue; }
        let apoyo = false;
        for (const q of x.L[c][P]) { const fq = q & 7; if (Math.abs(fq - f) === 1 && rr(c, q) <= r) { apoyo = true; break; } }
        const stop = sq + (c ? -16 : 16);
        if (!apoyo && !(stop & 0x88) && x.pa[c ^ 1][stop]) ret++;
      }
      x.add(o, s * dob); x.add(o + 5, s * ais); x.add(o + 10, s * ret);
    }
    void b;
  });
det(13, 'Peones pasados', 0, false, ['cuántos', 'cuán avanzados', 'protegidos', 'camino libre', 'imparables (regla del cuadrado)'],
  [I3(5, 10, 20), I3(3, 6, 15), I3(5, 8, 12), I3(2, 4, 10), I3(0, 0, 150)],
  (x, o) => {
    const pos = x.pos, b = pos.b;
    for (const c of COLORES) {
      const s = c ? -1 : 1, d = c ? -16 : 16; let n = 0, av = 0, pr = 0, lib = 0, imp = 0;
      const sinPiezas = piezasMenoresYMayores(x, c ^ 1) === 0;
      for (const sq of x.L[c][P]) {
        if (!pasado(x, c, sq)) continue;
        n++; const rel = rr(c, sq) - 1; av += rel * rel / 5;
        if (x.pa[c][sq]) pr++;
        let libre = true; for (let y = sq + d; !(y & 0x88); y += d) if (b[y]) { libre = false; break; }
        if (libre) lib++;
        if (sinPiezas && libre) {
          const prom = (c ? 0 : 0x70) + (sq & 7), pasos = 7 - rr(c, sq) - (rr(c, sq) === 1 ? 1 : 0);
          const dk = cheb(pos.k[c ^ 1], prom) - (pos.side === (c ^ 1) ? 1 : 0);
          if (dk > pasos) imp++;
        }
      }
      x.add(o, s * n); x.add(o + 5, s * av); x.add(o + 10, s * pr); x.add(o + 15, s * lib); x.add(o + 20, s * imp);
    }
  });
det(39, 'Peones conectados', 0, false, ['conectados'], [I3(3, 4, 6)],
  (x, o) => {
    const b = x.pos.b;
    for (const c of COLORES) {
      let n = 0; const mine = (c << 3) | P;
      for (const sq of x.L[c][P]) { const f = sq & 7; if ((f > 0 && b[sq - 1] === mine) || (f < 7 && b[sq + 1] === mine) || x.pa[c][sq]) n++; }
      x.add(o, (c ? -1 : 1) * n);
    }
  });
det(40, 'Mayoría en un flanco', 0, false, ['flanco de dama', 'flanco de rey'], [I3(0, 2, 8), I3(0, 2, 8)],
  (x, o) => {
    let q0 = 0, q1 = 0, k0 = 0, k1 = 0;
    for (let f = 0; f < 4; f++) { q0 += x.pf[0][f]; q1 += x.pf[1][f]; }
    for (let f = 4; f < 8; f++) { k0 += x.pf[0][f]; k1 += x.pf[1][f]; }
    x.add(o, Math.sign(q0 - q1)); x.add(o + 5, Math.sign(k0 - k1));
  });
det(41, 'Simplificar ganando', 0, false, ['cambiar piezas con ventaja'], [I3(0, 4, 8)],
  (x, o) => x.add(o, materialPeones(x) * (1 - (piezasMenoresYMayores(x, 0) + piezasMenoresYMayores(x, 1)) / 14)));
det(42, 'Alfiles de distinto color', 0, false, ['tienden a tablas'], [I3(0, -5, -25)],
  (x, o) => {
    const a = x.L[0][B], b = x.L[1][B];
    if (a.length === 1 && b.length === 1 && (((a[0] >> 4) + (a[0] & 7)) & 1) !== (((b[0] >> 4) + (b[0] & 7)) & 1)) x.add(o, materialPeones(x));
  });
det(43, 'Material insuficiente', 0, false, ['tablas seguras'], [I3(-100, -100, -100)],
  (x, o) => { if (!x.L[0][P].length && !x.L[1][P].length && insuficiente(x.pos)) x.add(o, materialPeones(x)); });
det(44, 'Tempo', 0, false, ['tener el turno'], [I3(10, 10, 5)],
  (x, o) => x.add(o, x.pos.side ? -1 : 1));
det(45, 'Buscar tablas', 0, false, ['valor de unas tablas cuando va perdiendo'], [I3(30, 30, 30)],
  () => {});   // no puntúa la posición: lo usa la búsqueda (ver drawBonus)

// —— Medios ——
det(6, 'Movilidad', 1, true, ['caballo', 'alfil', 'torre', 'dama'], [I3(4, 4, 3), I3(5, 5, 4), I3(2, 3, 4), I3(1, 1, 2)],
  (x, o) => { for (let t = N; t <= Q; t++) x.add(o + (t - N) * 5, x.mob[0][t] - x.mob[1][t]); });
det(7, 'Espacio', 1, true, ['casillas propias controladas'], [I3(2, 2, 0)],
  (x, o) => {
    const b = x.pos.b;
    for (const c of COLORES) {
      let n = 0;
      for (let rl = 1; rl <= 3; rl++) for (let f = 2; f <= 5; f++) {
        const sq = (c ? 7 - rl : rl) * 16 + f;
        if (x.pa[c ^ 1][sq]) continue;
        let detras = false; for (let y = sq + (c ? -16 : 16); !(y & 0x88); y += c ? -16 : 16) if (b[y] === ((c << 3) | P)) { detras = true; break; }
        if (detras || x.pa[c][sq]) n++;
      }
      x.add(o, (c ? -1 : 1) * n);
    }
  });
det(8, 'Escudo de peones del rey', 1, true, ['peones justo delante', 'peones dos filas delante', 'columnas sin escudo'],
  [I3(12, 12, 0), I3(6, 6, 0), I3(-15, -15, 0)],
  (x, o) => {
    const b = x.pos.b;
    for (const c of COLORES) {
      const s = c ? -1 : 1, k = x.pos.k[c], kf = k & 7, d = c ? -16 : 16, mine = (c << 3) | P; let a = 0, a2 = 0, fal = 0;
      if (rr(c, k) > 1) { x.add(o + 10, s * 3); continue; }
      for (let f = Math.max(0, kf - 1); f <= Math.min(7, kf + 1); f++) {
        const s1 = (k & 0x70) + f + d, s2 = s1 + d;
        if (!(s1 & 0x88) && b[s1] === mine) a++; else if (!(s2 & 0x88) && b[s2] === mine) a2++; else fal++;
      }
      x.add(o, s * a); x.add(o + 5, s * a2); x.add(o + 10, s * fal);
    }
  });
det(9, 'Atacantes del rey', 1, true, ['unidades de ataque', 'ataque concentrado (crece más que la suma)'], [I3(5, 5, 2), I3(6, 6, 2)],
  (x, o) => { const a = x.ku[0], b = x.ku[1]; x.add(o, a - b); x.add(o + 5, (a * a - b * b) / 8); });
det(10, 'Columnas hacia el rey', 1, true, ['abiertas', 'semiabiertas para el atacante'], [I3(10, 8, 0), I3(5, 4, 0)],
  (x, o) => {
    for (const c of COLORES) {        // c ataca al rey contrario
      const s = c ? -1 : 1, kf = x.pos.k[c ^ 1] & 7; let ab = 0, se = 0;
      for (let f = Math.max(0, kf - 1); f <= Math.min(7, kf + 1); f++) { if (!x.pf[0][f] && !x.pf[1][f]) ab++; else if (!x.pf[c][f]) se++; }
      x.add(o, s * ab); x.add(o + 5, s * se);
    }
  });
det(14, 'Estructura de peones', 1, true, ['islas', 'cadenas'], [I3(-5, -8, -12), I3(2, 3, 3)],
  (x, o) => {
    for (const c of COLORES) {
      const s = c ? -1 : 1, pf = x.pf[c]; let is = 0, en = false, cad = 0;
      for (let f = 0; f < 8; f++) { if (pf[f] && !en) is++; en = pf[f] > 0; }
      for (const sq of x.L[c][P]) if (x.pa[c][sq]) cad++;
      x.add(o, s * is); x.add(o + 5, s * cad);
    }
  });
det(15, 'Torres', 1, true, ['columna abierta', 'semiabierta', 'en séptima', 'dobladas'], [I3(10, 15, 8), I3(5, 8, 4), I3(10, 15, 15), I3(5, 8, 5)],
  (x, o) => {
    for (const c of COLORES) {
      const s = c ? -1 : 1, rs = x.L[c][R]; let ab = 0, se = 0, sep = 0, dob = 0;
      for (const sq of rs) { const f = sq & 7; if (!x.pf[c][f]) { if (!x.pf[c ^ 1][f]) ab++; else se++; } if (rr(c, sq) === 6) sep++; }
      for (let i = 0; i < rs.length && !dob; i++) for (let j = i + 1; j < rs.length; j++) if ((rs[i] & 7) === (rs[j] & 7)) { dob = 1; break; }
      x.add(o, s * ab); x.add(o + 5, s * se); x.add(o + 10, s * sep); x.add(o + 15, s * dob);
    }
  });
function puesto(x, c, sq) {
  const r = rr(c, sq); if (r < 3 || r > 5 || !x.pa[c][sq]) return false;
  const f = sq & 7, ep = ((c ^ 1) << 3) | P, b = x.pos.b, d = c ? -16 : 16;
  for (let y = sq + d; !(y & 0x88); y += d) { if ((f > 0 && b[y - 1] === ep) || (f < 7 && b[y + 1] === ep)) return false; }
  return true;
}
det(16, 'Puestos avanzados', 1, true, ['caballo', 'alfil'], [I3(15, 20, 5), I3(8, 10, 3)],
  (x, o) => { for (const c of COLORES) { const s = c ? -1 : 1; let n = 0, a = 0; for (const q of x.L[c][N]) if (puesto(x, c, q)) n++; for (const q of x.L[c][B]) if (puesto(x, c, q)) a++; x.add(o, s * n); x.add(o + 5, s * a); } });
det(17, 'Alfil malo', 1, true, ['peones propios de su color'], [I3(-2, -3, -4)],
  (x, o) => {
    for (const c of COLORES) {
      let n = 0;
      for (const q of x.L[c][B]) { const col = ((q >> 4) + (q & 7)) & 1; for (const p of x.L[c][P]) if ((((p >> 4) + (p & 7)) & 1) === col) n++; }
      x.add(o, (c ? -1 : 1) * n);
    }
  });
det(46, 'Agujeros', 1, true, ['casillas que ningún peón propio defenderá'], [I3(-3, -4, -1)],
  (x, o) => {
    for (const c of COLORES) {
      let n = 0;
      for (let rl = 2; rl <= 3; rl++) for (let f = 1; f <= 6; f++) {
        let def = false;
        for (const p of x.L[c][P]) { if (Math.abs((p & 7) - f) === 1 && rr(c, p) < rl) { def = true; break; } }
        if (!def) n++;
      }
      x.add(o, (c ? -1 : 1) * n);
    }
  });
det(47, 'Rey activo en finales', 1, true, ['rey centralizado'], [I3(0, 0, 10)],
  (x, o) => x.add(o, (3 - cdist(x.pos.k[0])) - (3 - cdist(x.pos.k[1]))));
det(48, 'Cercanía al rey rival', 1, true, ['piezas cerca de su rey'], [I3(3, 4, 2)],
  (x, o) => {
    for (const c of COLORES) {
      let v = 0; const ek = x.pos.k[c ^ 1];
      for (let t = N; t <= Q; t++) for (const q of x.L[c][t]) v += (7 - cheb(q, ek)) / 7;
      x.add(o, (c ? -1 : 1) * v);
    }
  });
det(49, 'Coordinación', 1, true, ['piezas que se defienden'], [I3(3, 3, 2)],
  (x, o) => { for (const c of COLORES) { let n = 0; for (let t = N; t <= Q; t++) for (const q of x.L[c][t]) if (x.cnt[c][q]) n++; x.add(o, (c ? -1 : 1) * n); } });
det(50, 'Diagonales largas', 1, true, ['alfil o dama en una gran diagonal abierta'], [I3(8, 6, 3)],
  (x, o) => {
    const b = x.pos.b;
    for (const c of COLORES) {
      let n = 0;
      for (const t of [B, Q]) for (const q of x.L[c][t]) {
        const f = q & 7, r = q >> 4;
        for (const [ok, D] of [[f === r, [17, -17]], [f + r === 7, [15, -15]]]) {
          if (!ok) continue; let libres = 0;
          for (const d of D) { let y = q + d; while (!(y & 0x88) && !b[y]) { libres++; y += d; } }
          if (libres >= 4) n++;
        }
      }
      x.add(o, (c ? -1 : 1) * n);
    }
  });
function linea(b, a, z, D) {
  for (const d of D) { let y = a + d; while (!(y & 0x88)) { if (y === z) return true; if (b[y]) break; y += d; } }
  return false;
}
det(51, 'Baterías', 1, true, ['dama y alfil', 'torres o torre y dama'], [I3(5, 5, 2), I3(5, 6, 4)],
  (x, o) => {
    const b = x.pos.b;
    for (const c of COLORES) {
      const s = c ? -1 : 1, L = x.L[c]; let d = 0, h = 0;
      for (const q of L[Q]) for (const a of L[B]) if (linea(b, q, a, BD)) d++;
      const pes = L[R].concat(L[Q]);
      for (let i = 0; i < pes.length; i++) for (let j = i + 1; j < pes.length; j++) if ((pes[i] & 7) === (pes[j] & 7) && linea(b, pes[i], pes[j], [16, -16])) h++;
      x.add(o, s * d); x.add(o + 5, s * h);
    }
  });
det(52, 'Dama temprana', 1, true, ['dama fuera antes de desarrollar'], [I3(-20, -5, 0)],
  (x, o) => {
    const b = x.pos.b; if (x.pos.full > 12) return;
    for (const c of COLORES) {
      const base = c ? 0x70 : 0, q = x.L[c][Q];
      if (!q.length || q[0] === base + 3) continue;
      let sin = 0; for (const s of [1, 2, 5, 6]) if (b[base + s] === ((c << 3) | (s === 1 || s === 6 ? N : B))) sin++;
      if (sin >= 2) x.add(o, c ? -1 : 1);
    }
  });
det(53, 'Rupturas de peones', 1, true, ['peones listos para chocar'], [I3(3, 4, 2)],
  (x, o) => {
    const b = x.pos.b;
    for (const c of COLORES) {
      let n = 0; const d = c ? -16 : 16, ep = ((c ^ 1) << 3) | P;
      for (const sq of x.L[c][P]) { const y = sq + d; if (y & 0x88 || b[y]) continue; for (const e of [d - 1, d + 1]) { const z = y + e; if (!(z & 0x88) && b[z] === ep) { n++; break; } } }
      x.add(o, (c ? -1 : 1) * n);
    }
  });
det(54, 'Bloqueo de pasados', 1, true, ['caballo bloqueando', 'otra pieza bloqueando'], [I3(10, 15, 15), I3(5, 8, 10)],
  (x, o) => {
    const b = x.pos.b;
    for (const c of COLORES) {        // c bloquea los pasados contrarios
      const s = c ? -1 : 1, e = c ^ 1; let n = 0, m = 0;
      for (const sq of x.L[e][P]) {
        if (!pasado(x, e, sq)) continue;
        const y = sq + (e ? -16 : 16); if (y & 0x88) continue;
        const p = b[y]; if (!p || (p >> 3) !== c) continue;
        if ((p & 7) === N) n++; else m++;
      }
      x.add(o, s * n); x.add(o + 5, s * m);
    }
  });
det(55, 'Avalancha de peones', 1, true, ['peones contra el rey enrocado'], [I3(3, 5, 0)],
  (x, o) => {
    if (Math.abs((x.pos.k[0] & 7) - (x.pos.k[1] & 7)) < 3) return;
    for (const c of COLORES) {
      let v = 0; const kf = x.pos.k[c ^ 1] & 7;
      for (const sq of x.L[c][P]) if (Math.abs((sq & 7) - kf) <= 1) { const rl = rr(c, sq); if (rl >= 3) v += rl - 2; }
      x.add(o, (c ? -1 : 1) * v);
    }
  });

// —— Caros (táctica) ——
function seguras(x, c, sq, t) {   // casillas seguras a las que puede ir la pieza
  const b = x.pos.b, them = c ^ 1; let n = 0;
  const ok = y => { const q = b[y]; if (q && (q >> 3) === c) return; if (!x.cnt[them][y] || (q && VAL[q & 7] >= VAL[t])) n++; };
  if (t === N) { for (const d of ND) { const y = sq + d; if (!(y & 0x88)) ok(y); } }
  else { const D = t === B ? BD : t === R ? RD : KD; for (const d of D) { let y = sq + d; while (!(y & 0x88)) { ok(y); if (b[y]) break; y += d; } } }
  return n;
}
det(18, 'Piezas colgadas o atrapadas', 2, true, ['colgadas (sin defensa)', 'atacadas por algo más barato', 'atrapadas'],
  [I3(-15, -15, -15), I3(-15, -15, -15), I3(-20, -20, -10)],
  (x, o) => {
    for (const c of COLORES) {
      const s = c ? -1 : 1, e = c ^ 1; let col = 0, bar = 0, atr = 0;
      for (let t = P; t <= Q; t++) for (const q of x.L[c][t]) {
        if (!x.cnt[e][q]) continue;
        if (!x.cnt[c][q]) col += VAL[t] / 100;
        if (x.mn[e][q] < ORD[t]) bar += (ORD[t] - x.mn[e][q]) / 3;
        if (t !== P && seguras(x, c, q, t) === 0) atr++;
      }
      x.add(o, s * col); x.add(o + 5, s * bar); x.add(o + 10, s * atr);
    }
  });
function clavadas(x, c) {   // piezas de c clavadas contra su rey
  const b = x.pos.b, k = x.pos.k[c], e = (c ^ 1) << 3; let n = 0;
  for (const [D, t1] of [[BD, B], [RD, R]]) for (const d of D) {
    let y = k + d, mia = -1;
    while (!(y & 0x88)) {
      const p = b[y];
      if (p) { if (mia < 0) { if ((p >> 3) === c) mia = y; else break; } else { if (p === (e | t1) || p === (e | Q)) n++; break; } }
      y += d;
    }
  }
  return n;
}
det(19, 'Golpes tácticos', 2, true, ['clavadas', 'dobles ataques', 'descubiertas preparadas'], [I3(-10, -10, -5), I3(20, 20, 15), I3(5, 5, 3)],
  (x, o) => {
    const b = x.pos.b;
    for (const c of COLORES) {
      const s = c ? -1 : 1, e = c ^ 1; let dob = 0, desc = 0;
      const valioso = (y, v) => { const p = b[y]; return p && (p >> 3) === e && ((p & 7) === K || VAL[p & 7] > v); };
      for (const q of x.L[c][N]) { let h = 0; for (const d of ND) { const y = q + d; if (!(y & 0x88) && valioso(y, VAL[N])) h++; } if (h >= 2) dob++; }
      for (const q of x.L[c][P]) { let h = 0; const d = c ? -16 : 16; for (const e2 of [d - 1, d + 1]) { const y = q + e2; if (!(y & 0x88) && valioso(y, VAL[P])) h++; } if (h >= 2) dob++; }
      for (const [t, D] of [[B, BD], [R, RD], [Q, KD]]) for (const q of x.L[c][t]) for (const d of D) {
        let y = q + d, propia = false;
        while (!(y & 0x88)) { const p = b[y]; if (p) { if (!propia && (p >> 3) === c) propia = true; else { if (propia && (p >> 3) === e && ((p & 7) === K || (p & 7) === Q)) desc++; break; } } y += d; }
      }
      x.add(o, s * clavadas(x, c)); x.add(o + 5, s * dob); x.add(o + 10, s * desc);
    }
  });
det(20, 'Cambios en una casilla', 2, true, ['mejor cambio disponible (SEE)'], [I3(30, 30, 30)],
  (x, o) => {
    for (const c of COLORES) {
      const e = c ^ 1; let best = 0;
      for (let t = P; t <= Q; t++) for (const q of x.L[e][t]) if (x.cnt[c][q]) { const g = see(x.pos, q, c); if (g > best) best = g; }
      x.add(o, (c ? -1 : 1) * best / 100);
    }
  });
det(21, 'Jaques seguros', 2, true, ['jaques disponibles a salvo'], [I3(8, 8, 6)],
  (x, o) => {
    const b = x.pos.b;
    for (const c of COLORES) {
      const e = c ^ 1, k = x.pos.k[e]; let n = 0;
      const seg = y => { const p = b[y]; return !(p && (p >> 3) === c) && !x.cnt[e][y]; };
      for (const d of ND) { const y = k + d; if (!(y & 0x88) && x.byT[c][N][y] && seg(y)) n++; }
      for (const [D, t] of [[BD, B], [RD, R]]) for (const d of D) {
        let y = k + d;
        while (!(y & 0x88)) { if ((x.byT[c][t][y] || x.byT[c][Q][y]) && seg(y)) n++; if (b[y]) break; y += d; }
      }
      x.add(o, (c ? -1 : 1) * n);
    }
  });
det(23, 'Desarrollo e iniciativa', 2, true, ['menores desarrolladas', 'torres conectadas', 'amenazas'], [I3(10, 3, 0), I3(10, 5, 0), I3(5, 5, 5)],
  (x, o) => {
    const b = x.pos.b;
    for (const c of COLORES) {
      const s = c ? -1 : 1, e = c ^ 1; let des = 0, con = 0, am = 0;
      for (const t of [N, B]) for (const q of x.L[c][t]) if (rr(c, q) > 0) des++;
      const rs = x.L[c][R].filter(q => rr(c, q) === 0);
      if (rs.length === 2) { const a = Math.min(rs[0], rs[1]), z = Math.max(rs[0], rs[1]); let libre = true; for (let y = a + 1; y < z; y++) if (b[y]) { libre = false; break; } if (libre) con = 1; }
      for (let t = N; t <= Q; t++) for (const q of x.L[e][t]) if (x.cnt[c][q] && x.mn[c][q] < ORD[t]) am++;
      x.add(o, s * des); x.add(o + 5, s * con); x.add(o + 10, s * am);
    }
  });
det(56, 'Amenaza de mate', 2, true, ['mate en una disponible'], [I3(50, 50, 50)],
  (x, o) => x.add(o, mateEn1(x.pos, 0) - mateEn1(x.pos, 1)));
det(57, 'Huidas del rey', 2, true, ['casillas seguras alrededor del rey'], [I3(2, 2, 1)],
  (x, o) => {
    const b = x.pos.b;
    for (const c of COLORES) { const k = x.pos.k[c]; let n = 0; for (const d of KD) { const y = k + d; if (y & 0x88) continue; const p = b[y]; if (p && (p >> 3) === c) continue; if (!x.cnt[c ^ 1][y]) n++; } x.add(o, (c ? -1 : 1) * n); }
  });
det(58, 'Sobrecarga', 2, true, ['piezas que defienden dos cosas'], [I3(-10, -10, -8)],
  (x, o) => {
    for (const c of COLORES) {
      const e = c ^ 1, tareas = new Map(); let n = 0;
      for (let t = P; t <= Q; t++) for (const q of x.L[c][t]) if (x.cnt[e][q] && x.cnt[c][q] === 1) { const d = x.last[c][q]; tareas.set(d, (tareas.get(d) || 0) + 1); }
      tareas.forEach(v => { if (v >= 2) n++; });
      x.add(o, (c ? -1 : 1) * n);
    }
  });
det(59, 'Rayos X', 2, true, ['ataques a través de otra pieza'], [I3(3, 3, 2)],
  (x, o) => {
    const b = x.pos.b;
    for (const c of COLORES) {
      const e = c ^ 1; let n = 0;
      for (const [t, D] of [[B, BD], [R, RD], [Q, KD]]) for (const q of x.L[c][t]) for (const d of D) {
        let y = q + d, primero = false;
        while (!(y & 0x88)) { const p = b[y]; if (p) { if (!primero) primero = true; else { if ((p >> 3) === e && ((p & 7) >= R)) n++; break; } } y += d; }
      }
      x.add(o, (c ? -1 : 1) * n);
    }
  });
det(60, 'Piezas sueltas', 2, true, ['piezas sin defender'], [I3(-5, -5, -3)],
  (x, o) => { for (const c of COLORES) { let n = 0; for (let t = N; t <= Q; t++) for (const q of x.L[c][t]) if (!x.cnt[c][q]) n++; x.add(o, (c ? -1 : 1) * n); } });
det(61, 'Carreras de peones', 2, true, ['quién corona antes'], [I3(0, 0, 30)],
  (x, o) => {
    if (piezasMenoresYMayores(x, 0) + piezasMenoresYMayores(x, 1) > 0) return;
    const pasos = [9, 9];
    for (const c of COLORES) for (const sq of x.L[c][P]) if (pasado(x, c, sq)) { let p = 7 - rr(c, sq); if (rr(c, sq) === 1) p--; if (x.pos.side !== c) p++; if (p < pasos[c]) pasos[c] = p; }
    if (pasos[0] === 9 && pasos[1] === 9) return;
    x.add(o, clamp(pasos[1] - pasos[0], -5, 5));
  });

DET.sort((a, b) => a.coste - b.coste || a.n - b.n);
const DET_BY = {}; DET.forEach(d => { DET_BY['d' + d.n] = d; });
const COSTE = ['barato', 'medio', 'caro'];

/* Bloques que no son detectores */
const JUGADA = ['captura', 'jaque', 'sacrificio', 'avance de peón', 'enroque', 'coronación'];
const JUGADA_INIT = [0, 5, -10, 2, 15, 20];
const PIENSA = ['extender en jaque (24)', 'profundidad de la calma (25)', 'descartar ramas (27)', 'tiempo en el medio juego (28)'];
const PIENSA_INIT = [1, 6, 1, 1.2];
const PIENSA_RANGO = [[-1, 1], [0, 10], [-1, 2], [0.5, 2]];

/* ───────────── Genoma ─────────────
   genes = { d1:[enc, ...5 por medida], d2:[...], ..., jugada:[6], piensa:[4] }
   Cada medida tiene 5 genes: cerebro de apertura, de medio juego, de final, ajuste por estructura, ajuste por temperatura. */
function genomaClasico(rng, ruido) {
  const g = {};
  for (const d of DET) {
    const a = [d.coste < 2 ? 1 : (rng() < .5 ? 1 : -1)];
    for (const v of d.init) { for (let i = 0; i < 3; i++) a.push(v[i] * (1 + gauss(rng) * ruido) + gauss(rng) * 3 * ruido * 10); a.push(gauss(rng) * ruido * 20, gauss(rng) * ruido * 20); }
    g['d' + d.n] = a.map(r4);
  }
  g.jugada = JUGADA_INIT.map(v => r4(v + gauss(rng) * ruido * 10));
  g.piensa = PIENSA_INIT.map((v, i) => r4(clamp(v + gauss(rng) * ruido * 2, PIENSA_RANGO[i][0], PIENSA_RANGO[i][1])));
  if (!ruido) { for (const d of DET) g['d' + d.n][0] = d.coste < 2 ? 1 : -1; g.d1 = g.d1.map(r4); }
  return g;
}
function genomaAzar(rng) {
  const g = {};
  for (const d of DET) {
    const a = [rng() < .6 ? 1 : -1];
    for (const v of d.init) { for (let i = 0; i < 3; i++) a.push((rng() * 2) * v[i] + gauss(rng) * 20); a.push(gauss(rng) * 15, gauss(rng) * 15); }
    g['d' + d.n] = a.map(r4);
  }
  g.d1[0] = 1;   // sin valor de las piezas no hay manera de empezar
  g.jugada = JUGADA_INIT.map(() => r4(gauss(rng) * 15));
  g.piensa = PIENSA_RANGO.map(([a, b]) => r4(a + rng() * (b - a)));
  return g;
}
function gauss(rng) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function r4(v) { return Math.round(v * 10000) / 10000; }

/* Compila los genes a un formato rápido */
function compilar(genes) {
  const lista = [], G = [];
  let needAtt = false;
  for (const d of DET) {
    const a = genes['d' + d.n] || genomaClasico(() => .5, 0)['d' + d.n];
    if (!(a[0] > 0)) continue;
    const off = G.length;
    for (let i = 1; i < a.length; i++) G.push(a[i]);
    lista.push({ d, off });
    if (d.att) needAtt = true;
  }
  const pz = genes.piensa || PIENSA_INIT, jg = genes.jugada || JUGADA_INIT, d45 = genes.d45;
  return {
    G: Float64Array.from(G), lista, needAtt,
    jug: Float64Array.from(jg),
    ext: pz[0] > 0, qprof: Math.round(clamp(pz[1], 0, 10)), lmr: pz[2] > 0 ? (pz[2] > 1 ? 2 : 1) : 0, tmj: clamp(pz[3], .5, 2),
    tablas: d45 && d45[0] > 0 ? d45[2] : 0,     // gen de «buscar tablas» (medio juego)
    ctx: new Ctx()
  };
}
/* Evaluación desde el bando que mueve, en centipeones */
function evaluar(pos, C) {
  const x = C.ctx; x.base(pos); x.G = C.G;
  // Eje de fase: material de piezas (24 al empezar)
  let ph = 0; for (const c of COLORES) { const L = x.L[c]; ph += L[N].length + L[B].length + 2 * L[R].length + 4 * L[Q].length; }
  const g = clamp(ph / 24, 0, 1), fi = clamp((0.5 - g) / 0.5, 0, 1);
  const op = (1 - fi) * clamp((g - 0.75) / 0.25, 0, 1) * clamp(1 - (pos.full - 8) / 12, 0, 1);
  x.op = op; x.fi = fi; x.mj = 1 - op - fi;
  // Eje de estructura: peones bloqueados y columnas abiertas
  let bloq = 0, abiertas = 0; const b = pos.b;
  for (const s of x.L[0][P]) if (b[s + 16] === (8 | P)) bloq++;
  for (let f = 0; f < 8; f++) if (!x.pf[0][f] && !x.pf[1][f]) abiertas++;
  const est = clamp(bloq / 4, 0, 1) * 0.6 + clamp(1 - abiertas / 3, 0, 1) * 0.4;
  x.es = (est - 0.5) * 2;
  // Eje de temperatura: piezas atacadas y jaques
  let tp = inCheck(pos) ? 0.5 : 0;
  if (C.needAtt) {
    x.att(); let at = 0;
    for (const c of COLORES) for (let t = N; t <= Q; t++) for (const q of x.L[c][t]) if (x.cnt[c ^ 1][q]) at++;
    tp = clamp(tp + at / 6, 0, 1);
  }
  x.tp = tp; x.est = est;
  x.acc = 0;
  for (const it of C.lista) it.d.f(x, it.off);
  const v = x.acc;
  return pos.side ? -v : v;
}
/* Para la ficha: qué detectores han pesado más en esta posición */
function explicar(pos, C) {
  evaluar(pos, C); const x = C.ctx, r = [];
  for (const it of C.lista) { const a = x.acc; x.acc = 0; it.d.f(x, it.off); r.push({ n: it.d.n, nombre: it.d.nombre, v: Math.round(x.acc) }); x.acc = a; }
  return { fase: { apertura: x.op, medio: x.mj, final: x.fi }, estructura: x.est, temperatura: x.tp, detectores: r.filter(o => o.v).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)) };
}

/* ───────────── Búsqueda ───────────── */
const MATE = 30000, INF = 1e9;
const now = typeof performance !== 'undefined' && performance.now ? () => performance.now() : () => Date.now();
function Buscador(C) { this.C = C; this.tt = new Map(); this.hist = new Int32Array(128 * 128); this.kill = []; }
Buscador.prototype.ordenar = function (pos, ms, ttm, ply) {
  const b = pos.b, sc = new Float64Array(ms.length), J = this.C.jug, k = this.kill[ply] || [];
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i], f = m & 127, t = (m >> 7) & 127, fl = m >> 17, pr = (m >> 14) & 7;
    let s = 0;
    if (m === ttm) s = 1e7;
    else if (fl & 1) { const v = fl & 2 ? P : b[t] & 7; s = 1e6 + VAL[v] * 10 - VAL[b[f] & 7] / 10 + J[0]; }
    else if (pr) s = 9e5 + VAL[pr] + J[5];
    else if (m === k[0] || m === k[1]) s = 8e5;
    else { s = this.hist[f * 128 + t]; if ((b[f] & 7) === P) s += J[3] * 10; if (fl & 4) s += J[4] * 10; }
    sc[i] = s;
  }
  return sc;
};
function pick(ms, sc, i) { let bi = i; for (let j = i + 1; j < ms.length; j++) if (sc[j] > sc[bi]) bi = j; if (bi !== i) { const a = ms[i]; ms[i] = ms[bi]; ms[bi] = a; const s = sc[i]; sc[i] = sc[bi]; sc[bi] = s; } return ms[i]; }
Buscador.prototype.drawScore = function (pos) { return pos.side === this.raiz ? this.tablas : -this.tablas; };
Buscador.prototype.quies = function (pos, a, bt, qd, ply) {
  this.nodes++;
  if ((this.nodes & 1023) === 0 && this.dmax > 1 && now() > this.deadline) this.stop = true;
  if (this.stop) return 0;
  const ev = evaluar(pos, this.C);
  if (ev >= bt) return ev;
  if (ev > a) a = ev;
  if (qd <= 0) return ev;
  const ms = gen(pos, [], true), sc = this.ordenar(pos, ms, 0, ply), us = pos.side;
  for (let i = 0; i < ms.length; i++) {
    const m = pick(ms, sc, i);
    const vic = (m >> 17) & 2 ? P : pos.b[(m >> 7) & 127] & 7;
    if (ev + VAL[vic] + 200 < a && !((m >> 14) & 7)) continue;      // poda delta
    pos.make(m);
    if (attacked(pos, pos.k[us], us ^ 1)) { pos.unmake(); continue; }
    const s = -this.quies(pos, -bt, -a, qd - 1, ply + 1);
    pos.unmake();
    if (this.stop) return 0;
    if (s >= bt) return s;
    if (s > a) a = s;
  }
  return a;
};
Buscador.prototype.nega = function (pos, d, a, bt, ply) {
  this.nodes++;
  if ((this.nodes & 1023) === 0 && this.dmax > 1 && now() > this.deadline) this.stop = true;
  if (this.stop) return 0;
  if (ply > 0 && (pos.half >= 100 || this.rep(pos))) return this.drawScore(pos);
  const chk = inCheck(pos);
  if (chk && this.C.ext && ply < 30) d++;
  if (d <= 0) return this.quies(pos, a, bt, this.C.qprof, ply);
  const key = pos.key(), e = this.tt.get(key);
  let ttm = 0;
  if (e) {
    ttm = e.m;
    if (e.d >= d && ply > 0) {
      if (e.f === 0) return e.s;
      if (e.f === 1 && e.s >= bt) return e.s;
      if (e.f === 2 && e.s <= a) return e.s;
    }
  }
  const ms = gen(pos, []), sc = this.ordenar(pos, ms, ttm, ply), us = pos.side, a0 = a;
  let best = -INF, bm = 0, n = 0;
  for (let i = 0; i < ms.length; i++) {
    const m = pick(ms, sc, i);
    pos.make(m);
    if (attacked(pos, pos.k[us], us ^ 1)) { pos.unmake(); continue; }
    n++;
    const quiet = !((m >> 17) & 1) && !((m >> 14) & 7);
    let s;
    if (n === 1) s = -this.nega(pos, d - 1, -bt, -a, ply + 1);
    else {
      let red = 0;
      if (this.C.lmr && d >= 3 && n > 4 && quiet && !chk && !inCheck(pos)) red = this.C.lmr;
      s = -this.nega(pos, d - 1 - red, -a - 1, -a, ply + 1);
      if (!this.stop && s > a && (red || s < bt)) s = -this.nega(pos, d - 1, -bt, -a, ply + 1);
    }
    pos.unmake();
    if (this.stop) return 0;
    if (s > best) { best = s; bm = m; }
    if (s > a) a = s;
    if (a >= bt) {
      if (quiet) { const k = this.kill[ply] || (this.kill[ply] = [0, 0]); if (k[0] !== m) { k[1] = k[0]; k[0] = m; } this.hist[(m & 127) * 128 + ((m >> 7) & 127)] += d * d; }
      break;
    }
  }
  if (!n) return chk ? -MATE + ply : this.drawScore(pos);
  if (this.tt.size > 300000) this.tt.clear();
  this.tt.set(key, { d, s: best, f: best <= a0 ? 2 : best >= bt ? 1 : 0, m: bm });
  return best;
};
Buscador.prototype.rep = function (pos) {
  const ks = pos.keys, k = ks[ks.length - 1];
  for (let i = ks.length - 3, j = 2; i >= 0 && j <= pos.half; i -= 2, j += 2) if (ks[i] === k) return true;
  return false;
};
/* Extra por tipo de jugada (punto 4): solo en la raíz */
Buscador.prototype.extra = function (pos, m) {
  const J = this.C.jug, b = pos.b, fl = m >> 17, t = (m >> 7) & 127, pz = b[t] & 7;   // se llama tras make
  let v = 0;
  if (fl & 1) v += J[0];
  if (inCheck(pos)) v += J[1];
  const us = pos.side ^ 1;
  if (pz !== K && attacked(pos, t, pos.side) && !attacked(pos, t, us)) v += J[2];
  if (pz === P) v += J[3];
  if (fl & 4) v += J[4];
  if ((m >> 14) & 7) v += J[5];
  return v;
};
/* Piensa una jugada. ms: tiempo; prof: profundidad máxima */
Buscador.prototype.pensar = function (pos, ms, prof) {
  this.nodes = 0; this.stop = false; this.deadline = now() + ms; this.raiz = pos.side;
  const est = evaluar(pos, this.C), T = this.C.tablas;
  this.tablas = est < -100 ? T : est > 100 ? -T : 0;
  const root = legal(pos);
  if (!root.length) return { move: 0, score: 0, depth: 0, nodes: 0 };
  const extras = root.map(m => { pos.make(m); const e = this.extra(pos, m); pos.unmake(); return e; });
  let bestM = root[0], bestS = -INF, depth = 0;
  for (let d = 1; d <= prof; d++) {
    this.dmax = d;
    const ttm = (this.tt.get(pos.key()) || {}).m || bestM;
    const sc = this.ordenar(pos, root.slice(), ttm, 0);
    const order = root.map((m, i) => [m, sc[i], extras[i]]).sort((p, q) => (q[0] === bestM) - (p[0] === bestM) || q[1] - p[1]);
    let a = -INF, itM = 0, itS = -INF;
    for (const [m, , ex] of order) {
      pos.make(m);
      const s = -this.nega(pos, d - 1, -INF, -(a - ex), 1) + ex;
      pos.unmake();
      if (this.stop) break;
      if (s > itS) { itS = s; itM = m; }
      if (s > a) a = s;
    }
    if (this.stop) { if (itM && itS > bestS) { bestM = itM; bestS = itS; } break; }
    bestM = itM; bestS = itS; depth = d;
    if (Math.abs(bestS) > MATE - 100) break;
  }
  return { move: bestM, score: Math.round(bestS), depth, nodes: this.nodes };
};

/* ───────────── Partidas ───────────── */
function aperturaAleatoria(rng, plies) {
  const Cc = compilar(genomaClasico(rng, 0));
  for (let intento = 0; intento < 40; intento++) {
    const pos = new Pos(); let ok = true;
    for (let i = 0; i < plies; i++) { const ms = legal(pos); if (!ms.length) { ok = false; break; } pos.make(ms[Math.floor(rng() * ms.length)]); }
    if (!ok || fin(pos)) continue;
    const bq = new Buscador(Cc); const r = bq.pensar(pos, 1e9, 1);
    if (Math.abs(r.score) < 80) return pos.fen();
  }
  return INICIO;
}
/* Juega una partida completa. Cw, Cb: genes compilados. alMover(info) se llama tras cada jugada */
function jugar(Cw, Cb, fen, opc, alMover) {
  opc = opc || {};
  const ms = opc.ms || 30, prof = opc.prof || 4, maxPlies = opc.maxPlies || 200;
  const pos = new Pos(fen || INICIO), jugadas = [], bus = [new Buscador(Cw), new Buscador(Cb)];
  let res = null, malas = 0, plies = 0, evals = [];
  while (true) {
    const f = fin(pos); if (f) { res = f; break; }
    if (plies >= maxPlies) { let m = 0; for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const p = pos.b[s]; if (p) m += (p >> 3 ? -1 : 1) * VAL[p & 7]; } res = { res: m >= 300 ? 1 : m <= -300 ? 0 : .5, motivo: 'límite de jugadas' }; break; }
    const C = pos.side ? Cb : Cw, x = new Ctx(); void x;
    let t = ms; { let ph = 0; for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const q = pos.b[s] & 7; if (q === N || q === B) ph++; else if (q === R) ph += 2; else if (q === Q) ph += 4; } if (ph >= 8 && ph <= 20) t *= C.tmj; }
    const r = bus[pos.side].pensar(pos, t, prof);
    if (!r.move) { res = { res: .5, motivo: 'sin jugada' }; break; }
    const blancas = pos.side ? -r.score : r.score;
    const u = uci(r.move); pos.make(r.move); jugadas.push(u); plies++; evals.push(blancas);
    if (alMover) alMover({ uci: u, fen: pos.fen(), eval: blancas, prof: r.depth, nodos: r.nodes });
    // Abandono: los dos ven la partida decidida durante 8 jugadas
    if (Math.abs(blancas) > 1500 && Math.abs(blancas) < MATE - 200) { malas++; if (malas >= 8) { res = { res: blancas > 0 ? 1 : 0, motivo: 'abandono' }; break; } } else malas = 0;
  }
  return { res: res.res, motivo: res.motivo, jugadas, plies, evals, fen: pos.fen() };
}

/* ───────────── Evolución ───────────── */
const SIL = ['te', 'ji', 'ra', 'ña', 'lo', 'mi', 'sa', 'vi', 'ta', 'no', 'ke', 'ru', 'li', 'da', 'po', 'ga', 'se', 'ba', 'ni', 'zu'];
function nombre(rng) { const n = 2 + (rng() < .35 ? 1 : 0); let s = ''; for (let i = 0; i < n; i++) s += SIL[Math.floor(rng() * SIL.length)]; return s[0].toUpperCase() + s.slice(1); }
const OPC_EVO = { poblacion: 32, elite: 4, torneo: 3, pm: 0.06, sigma0: 0.3, sigmaMin: 0.002, enfriar: 0.96, rondas: 4, inmigrantes: 2, umbralDiv: 0.03, racha: 5 };
function nuevoIndividuo(rng, gen, origen, genes, padres, mut) {
  return { id: origen[0] + gen + '-' + Math.floor(rng() * 1e6).toString(36), nombre: nombre(rng), gen, origen, padres: padres || [], mut: mut || null, genes, elo: 1200, hist: [], partidas: { g: 0, e: 0, p: 0 } };
}
function poblacionInicial(rng, origen, n) {
  n = n || OPC_EVO.poblacion; const pop = [];
  for (let i = 0; i < n; i++) {
    const clas = i < Math.round(n * .8);
    pop.push(nuevoIndividuo(rng, 1, origen, clas ? genomaClasico(rng, .1) : genomaAzar(rng), [], { nacio: clas ? 'clásica con ruido' : 'al azar' }));
  }
  return pop;
}
/* Torneo de autojuego: rondas de emparejamientos al azar, dos partidas por pareja (blancas y negras) */
function emparejar(pop, rondas, rng, plies) {
  const juegos = [];
  for (let r = 0; r < rondas; r++) {
    const ids = pop.map(p => p.id);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    for (let i = 0; i + 1 < ids.length; i += 2) {
      const fen = aperturaAleatoria(rng, plies == null ? 4 : plies), mesa = i / 2;
      juegos.push({ ronda: r, mesa, w: ids[i], b: ids[i + 1], fen }, { ronda: r, mesa, w: ids[i + 1], b: ids[i], fen });
    }
  }
  return juegos;
}
function actualizarElo(a, b, res, Kf) { Kf = Kf || 20; const e = 1 / (1 + Math.pow(10, (b.elo - a.elo) / 400)); a.elo += Kf * (res - e); b.elo -= Kf * (res - e); }
function cruzar(a, b, rng, fa, fb) {
  const g = {}, desde = { a: 0, b: 0 };
  const pa = fa >= fb ? .6 : .4;
  for (const k of Object.keys(a.genes)) {
    const deA = !(k in b.genes) || rng() < pa;
    g[k] = (deA ? a.genes[k] : b.genes[k]).slice(); deA ? desde.a++ : desde.b++;
  }
  return { genes: g, desde };
}
function mutar(genes, sigma, pm, rng) {
  const cambio = {}; let total = 0;
  for (const k of Object.keys(genes)) {
    const a = genes[k]; let n = 0;
    for (let i = 0; i < a.length; i++) {
      if (rng() >= pm) continue;
      if (k[0] === 'd' && i === 0) { if (rng() < .5) { a[0] = -a[0]; n++; } continue; }
      const esc = k === 'piensa' ? Math.abs(a[i]) + 1 : k === 'jugada' ? Math.abs(a[i]) + 5 : Math.abs(a[i]) + 10;
      a[i] = r4(a[i] + gauss(rng) * sigma * esc); n++;
      if (k === 'piensa') a[i] = r4(clamp(a[i], PIENSA_RANGO[i][0], PIENSA_RANGO[i][1]));
    }
    if (n) { cambio[k] = n; total += n; }
  }
  if (genes.d1) genes.d1[0] = 1;
  return { cambio, total };
}
function diversidad(pop, rng) {
  let s = 0, n = 0;
  for (let t = 0; t < 24; t++) {
    const a = pop[Math.floor(rng() * pop.length)].genes, b = pop[Math.floor(rng() * pop.length)].genes;
    if (a === b) continue; let d = 0, m = 0;
    for (const k of Object.keys(a)) { const x = a[k], y = b[k] || x; for (let i = 0; i < x.length; i++) { d += Math.abs(x[i] - y[i]) / (Math.abs(x[i]) + Math.abs(y[i]) + 10); m++; } }
    s += d / m; n++;
  }
  return n ? s / n : 0;
}
/* Huella: lo esencial de los genes, pequeño para guardarlo de todas las arañas (también de las que mueren).
   p: valor de las piezas en el medio juego; k: cómo piensa; d: por detector [encendido, peso de su 1.ª medida en el medio juego] */
function huella(genes) {
  const d = {};
  for (const x of DET) { const a = genes['d' + x.n]; d[x.n] = [a[0] > 0 ? 1 : 0, r4(x.n === 4 ? 0 : a[2])]; }
  return { p: [0, 1, 2, 3, 4].map(i => r4(genes.d1[1 + i * 5 + 1])), k: (genes.piensa || PIENSA_INIT).slice(), d };
}
/* Estilo (0–1 en cada eje), calculado de los genes: ataque, defensa, posición, material y táctica */
const ESTILO = [['ataque', [9, 48, 55, 10, 21]], ['defensa', [8, 57, 11, 54]], ['posición', [5, 6, 7, 16, 14, 15]], ['material', [2, 3, 41]], ['táctica', [18, 19, 20, 56, 58, 59, 60]]];
function estilo(genes) {
  return ESTILO.map(([nombre, ns]) => {
    let v = 0, n = 0;
    for (const k of ns) {
      const det = DET_BY['d' + k], a = genes['d' + k]; if (!det || !a) continue;
      n++; if (!(a[0] > 0)) continue;
      const base = Math.abs(det.init[0][1]) || 1;
      v += clamp(Math.abs(a[2]) / base, 0, 2) / 2;
    }
    return { eje: nombre, v: n ? r4(v / n) : 0 };
  });
}
/* Recibe la población con sus resultados (pts) y devuelve la siguiente generación y el resumen */
function siguienteGeneracion(est, pop, rng) {
  const O = Object.assign({}, OPC_EVO, est.opc || {}), gen = est.gen;
  pop.forEach(p => { p.fit = (p.pts || 0) + p.elo / 1e5; p.hist.push({ gen, pts: p.pts || 0, elo: Math.round(p.elo) }); });
  const orden = pop.slice().sort((a, b) => b.fit - a.fit);
  const mejor = orden[0];
  est.racha = mejor.id === est.campeon ? (est.racha || 0) + 1 : 0; est.campeon = mejor.id;
  est.sigma = Math.max(O.sigmaMin, (est.sigma || O.sigma0) * O.enfriar);
  if (est.racha >= O.racha) { est.sigma = Math.min(O.sigma0, est.sigma * 2); est.racha = 0; est.sacudidas = (est.sacudidas || 0) + 1; }
  const div = diversidad(pop, rng);
  const resumen = {
    gen, fecha: new Date().toISOString(), mejor: { id: mejor.id, nombre: mejor.nombre, pts: mejor.pts, elo: Math.round(mejor.elo) },
    mediaPts: pop.reduce((s, p) => s + (p.pts || 0), 0) / pop.length, mediaElo: pop.reduce((s, p) => s + p.elo, 0) / pop.length,
    sigma: est.sigma, diversidad: div, encendidos: pop.reduce((s, p) => s + DET.filter(d => p.genes['d' + d.n][0] > 0).length, 0) / pop.length,
    elite: orden.slice(0, O.elite).map(p => p.id), inmigrantes: 0,
    adn: DET.map(d => { let on = 0, w = 0; for (const p of pop) { const a = p.genes['d' + d.n]; if (a[0] > 0) { on++; w += a[2]; } } return [d.n, r4(on / pop.length), r4(on ? w / on : 0)]; })
  };
  const nueva = orden.slice(0, O.elite).map(p => { p.pts = 0; return p; });
  const elegir = () => { let b = null; for (let i = 0; i < O.torneo; i++) { const c = pop[Math.floor(rng() * pop.length)]; if (!b || c.fit > b.fit) b = c; } return b; };
  let inm = div < O.umbralDiv ? O.inmigrantes : 0; resumen.inmigrantes = inm;
  while (nueva.length < O.poblacion) {
    if (inm > 0) { inm--; nueva.push(nuevoIndividuo(rng, gen + 1, est.origen, genomaAzar(rng), [], { nacio: 'inmigrante' })); continue; }
    const a = elegir(); let b = elegir(), t = 0; while (b === a && t++ < 5) b = elegir();
    const x = cruzar(a, b, rng, a.fit, b.fit), m = mutar(x.genes, est.sigma, O.pm, rng);
    const h = nuevoIndividuo(rng, gen + 1, est.origen, x.genes, [a.id, b.id], { cruce: x.desde, cambios: m.cambio, total: m.total, sigma: est.sigma });
    h.elo = (a.elo + b.elo) / 2; nueva.push(h);
  }
  est.gen = gen + 1;
  return { pop: nueva, resumen, est };
}

const API = {
  Pos, INICIO, legal, perft, uci, parseUci, fin, inCheck, attacked, sqName, insuficiente, mFrom, mTo,
  DET, DET_BY, COSTE, JUGADA, PIENSA, OPC_EVO,
  genomaClasico, genomaAzar, compilar, evaluar, explicar, Buscador, jugar, aperturaAleatoria,
  huella, estilo, ESTILO, mulberry, nombre, poblacionInicial, emparejar, actualizarElo, cruzar, mutar, diversidad, siguienteGeneracion
};
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.AjedrezMotor = API;
})(typeof self !== 'undefined' ? self : this);
