'use strict';
// wb_model_ja.js —— 官方日语断词模型（CBlstmWordBreaker）的 Node 复刻
//
// 与 Python 版逐字节一致：字符→嵌入行号映射由反编译 FUN_1802548ec/FUN_180254c78 得到；
// 类别语义：1/2 = 词内延续，0/3 = 词起始 → 「在 class∈{0,3} 的字符之前切」；
// 后处理只对「不含平假名的复合词」做词典合并（引擎不会把 ですね 这类假名串合并）。
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');
const WINDOW = 20;
const MAX_MERGE_LEN = 12;
const HIRA = new Set('ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをん');

let W = null;
let LEX = null;

function load() {
  if (W) return W;
  const buf = fs.readFileSync(path.join(DATA, 'wb_ja_bilstm.bin'));
  if (buf.toString('ascii', 0, 8) !== 'OSWB0001') throw new Error('bad wb ja weights');
  const rows = buf.readUInt32LE(8);
  const cols = buf.readUInt32LE(12);
  const nEmb = rows * cols;
  const f32 = (start, n) => new Float32Array(buf.buffer.slice(buf.byteOffset + start, buf.byteOffset + start + n * 4));
  let off = 16;
  const emb = f32(off, nEmb); off += nEmb * 4;
  const wFwd = f32(off, 128 * 256); off += 128 * 256 * 4;
  const wBwd = f32(off, 128 * 256); off += 128 * 256 * 4;
  const bFwd = f32(off, 256); off += 256 * 4;
  const bBwd = f32(off, 256); off += 256 * 4;
  const wOut = f32(off, 128 * 4); off += 128 * 4 * 4;
  const bOut = f32(off, 4);
  W = { rows, cols, emb, wFwd, wBwd, bFwd, bBwd, wOut, bOut };
  return W;
}

function loadLexicon() {
  if (LEX) return LEX;
  let d = {};
  const pn = path.join(DATA, 'lexicon_ja.names.json');
  const p = path.join(DATA, 'lexicon_ja.json');
  try { d = JSON.parse(fs.readFileSync(fs.existsSync(pn) ? pn : p, 'utf8')); }
  catch (e) { d = {}; }
  LEX = new Set(Object.keys(d));
  return LEX;
}

function charRow(ch) {
  const c = ch.codePointAt(0) & 0xffff;
  if ((c > 0x3004 && c < 0x9fcd) || c >= 0x9fcd) {
    if (c < 0x3008) return 6 + (c - 0x3005);
    if (c < 0x30a0) return 6 + (c - 0x303d);
    if (c < 0x30fb) return 6 + (c - 0x303e);
    if (c < 0x3100) return 6 + (c - 0x303f);
    if (c < 0x3200) return 6 + (c - 0x312f);
    if (c < 0x9fcd) return 6 + (c - 0x4d2f);
    return 6 + (c - 0xacc8);
  }
  if (ch >= '0' && ch <= '9') return 2;
  if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) return 3;
  return 4;
}

function runLstm(X, Wm, b, reverse) {
  const n = X.length;
  const h = new Float32Array(64);
  const c = new Float32Array(64);
  const H = new Float32Array(n * 64);
  const WhOff = 64 * 256;
  const pre = new Float32Array(256);
  const idxs = [];
  if (reverse) { for (let t = n - 1; t >= 0; t--) idxs.push(t); }
  else { for (let t = 0; t < n; t++) idxs.push(t); }
  for (const t of idxs) {
    for (let o = 0; o < 256; o++) {
      let s = b[o];
      for (let i = 0; i < 64; i++) s += X[t][i] * Wm[i * 256 + o];
      for (let i = 0; i < 64; i++) s += h[i] * Wm[WhOff + i * 256 + o];
      pre[o] = s;
    }
    for (let k = 0; k < 64; k++) {
      const ii = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, pre[k]))));
      const ff = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, pre[64 + k]))));
      const gg = Math.tanh(pre[128 + k]);
      c[k] = ff * c[k] + ii * gg;
      const oo = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, pre[192 + k]))));
      h[k] = oo * Math.tanh(c[k]);
      H[t * 64 + k] = h[k];
    }
  }
  return H;
}

function classes(chars) {
  const w = load();
  const n = chars.length;
  if (!n) return [];
  const seq = [w.emb.subarray(0, 64)];
  for (const ch of chars) {
    const r = charRow(ch);
    seq.push(w.emb.subarray(r * 64, r * 64 + 64));
  }
  seq.push(w.emb.subarray(64, 128));
  while (seq.length % WINDOW) seq.push(w.emb.subarray(64, 128));
  const T = seq.length;
  const Hf = new Float32Array(T * 64);
  const Hb = new Float32Array(T * 64);
  for (let s = 0; s < T; s += WINDOW) {
    const X = seq.slice(s, s + WINDOW);
    const hf = runLstm(X, w.wFwd, w.bFwd, false);
    const hb = runLstm(X, w.wBwd, w.bBwd, true);
    for (let k = 0; k < X.length; k++) {
      for (let j = 0; j < 64; j++) {
        Hf[(s + k) * 64 + j] = hf[k * 64 + j];
        Hb[(s + k) * 64 + j] = hb[k * 64 + j];
      }
    }
  }
  const out = [];
  for (let k = 0; k < n; k++) {
    const t = k + 1;
    let best = -1e30, bi = 0;
    for (let c = 0; c < 4; c++) {
      let s = w.bOut[c];
      for (let j = 0; j < 64; j++) s += Hf[t * 64 + j] * w.wOut[j * 4 + c];
      for (let j = 0; j < 64; j++) s += Hb[t * 64 + j] * w.wOut[(64 + j) * 4 + c];
      if (s > best) { best = s; bi = c; }
    }
    out.push(bi);
  }
  return out;
}

function r1Segments(cls) {
  const segs = [];
  let st = 0;
  for (let j = 1; j < cls.length; j++) {
    if (cls[j] === 0 || cls[j] === 3) { segs.push([st, j - st]); st = j; }
  }
  segs.push([st, cls.length - st]);
  return segs;
}

function mergeByLexicon(text, segs) {
  const words = loadLexicon();
  let changed = true;
  while (changed) {
    changed = false;
    const out = [];
    let i = 0;
    while (i < segs.length) {
      let best = -1;
      for (let k = segs.length - 1; k > i; k--) {
        const end = segs[k][0] + segs[k][1];
        const cand = text.slice(segs[i][0], end);
        if (cand.length > MAX_MERGE_LEN || !words.has(cand)) continue;
        let hasHira = false;
        for (const ch of cand) if (HIRA.has(ch)) { hasHira = true; break; }
        if (hasHira) continue;
        best = k; break;
      }
      if (best >= 0) {
        out.push([segs[i][0], segs[best][0] + segs[best][1] - segs[i][0]]);
        i = best + 1;
        changed = true;
      } else {
        out.push(segs[i]);
        i += 1;
      }
    }
    segs = out;
  }
  return segs;
}

function segments(chars) {
  const text = chars.join('');
  const segs = r1Segments(classes(chars));
  return mergeByLexicon(text, segs);
}

module.exports = { classes, segments, available: () => { try { load(); return true; } catch (e) { return false; } } };
