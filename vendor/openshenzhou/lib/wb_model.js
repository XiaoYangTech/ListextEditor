'use strict';
// wb_model.js —— 官方中文断词模型（CBlstmWordBreaker）的 Node 复刻
//
// 已逐字节验证：本模块输出的逐字类别与引擎进程内 CBlstmWordBreaker 完全一致。
// 类别语义（由 3000 句统计确定）：1/2 = 词内延续，0/3 = 词起始标记；
// 词界 = 「在 class∈{0,3} 的字符之前切」，再按官方词表 + 引擎合并率做相邻词合并。
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');
const WINDOW = 20;
const MAX_MERGE_LEN = 12;
const MERGE_TH = parseFloat(process.env.OS_MERGE_TH || '0.1');
const MERGE_DEFAULT = parseFloat(process.env.OS_MERGE_DEFAULT || '0.5');
const MERGE_DEFAULT_ENV = process.env.OS_MERGE_DEFAULT;

let W = null;
let OFFICIAL = null;
let RATES = null;
let RATES_TH = null;
let EVIDENCE = null;

function load() {
  if (W) return W;
  const buf = fs.readFileSync(path.join(DATA, 'wb_bilstm.bin'));
  if (buf.toString('ascii', 0, 8) !== 'OSWB0001') throw new Error('bad wb weights');
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

let ENGINE_WORDSET = null;
function loadEngineWordset() {
  if (ENGINE_WORDSET !== null) return ENGINE_WORDSET;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(DATA, 'zh_engine_words.json'), 'utf8'));
    ENGINE_WORDSET = new Set(Object.keys(d));
  } catch (e) { ENGINE_WORDSET = null; }
  return ENGINE_WORDSET;
}

function loadMergeWords() {
  if ((process.env.OS_ENGINE_WORDS || '0') === '1') {
    const ws = loadEngineWordset();
    if (ws && ws.size) return ws;
  }
  return loadOfficial();
}

function loadOfficial() {
  if (OFFICIAL) return OFFICIAL;
  try {
    OFFICIAL = new Set(JSON.parse(fs.readFileSync(path.join(DATA, 'official_words_zh.json'), 'utf8')));
  } catch (e) {
    OFFICIAL = new Set();
  }
  return OFFICIAL;
}

let WBMERGE = null;
function loadWbMerge() {
  if (WBMERGE) return WBMERGE;
  if ((process.env.OS_ZH_WBPAIR || '1') === '0') { WBMERGE = new Set(); return WBMERGE; }
  try {
    WBMERGE = new Set(JSON.parse(fs.readFileSync(path.join(DATA, 'zh_wb_merge_words.json'), 'utf8')));
  } catch (e) { WBMERGE = new Set(); }
  return WBMERGE;
}

let PROBE = null;
function loadProbeWords() {
  if (PROBE) return PROBE;
  if ((process.env.OS_ZH_PROBE || '1') === '0') { PROBE = {}; return PROBE; }
  try {
    PROBE = JSON.parse(fs.readFileSync(path.join(DATA, 'zh_engine_probe.json'), 'utf8'));
  } catch (e) { PROBE = {}; }
  return PROBE;
}

function loadRates() {
  if (RATES) return RATES;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(DATA, 'zh_merge_rates.json'), 'utf8'));
    RATES = d.rates || {};
    RATES_TH = (d.threshold === undefined) ? null : d.threshold;
  } catch (e) {
    RATES = {};
    RATES_TH = null;
  }
  return RATES;
}

function charRow(ch) {
  const o = ch.codePointAt(0);
  if (o >= 0x4e00 && o <= 0x9fcc) return 6 + (o - 0x4e00);
  if (ch >= '0' && ch <= '9') return 2;
  if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) return 3;
  return 4;
}

// 单方向 LSTM：X 为 n×64（逆序时由调用方先倒序），返回 n×64
function runLstm(X, Wm, b, reverse) {
  const n = X.length;
  const h = new Float32Array(64);
  const c = new Float32Array(64);
  const H = new Float32Array(n * 64);
  const Wx = Wm;         // 128×256，前 64 行 = x 部分
  const WhOff = 64 * 256;
  const bb = b;
  const pre = new Float32Array(256);
  const idxs = [];
  if (reverse) { for (let t = n - 1; t >= 0; t--) idxs.push(t); }
  else { for (let t = 0; t < n; t++) idxs.push(t); }
  for (const t of idxs) {
    for (let o = 0; o < 256; o++) {
      let s = bb[o];
      for (let i = 0; i < 64; i++) s += X[t][i] * Wx[i * 256 + o];
      for (let i = 0; i < 64; i++) s += h[i] * Wx[WhOff + i * 256 + o];
      pre[o] = s;
    }
    for (let k = 0; k < 64; k++) {
      const i = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, pre[k]))));
      const f = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, pre[64 + k]))));
      const g = Math.tanh(pre[128 + k]);
      c[k] = f * c[k] + i * g;
      const o = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, pre[192 + k]))));
      h[k] = o * Math.tanh(c[k]);
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

function loadEvidence() {
  if (OFFICIAL === null) loadOfficial();
  if (EVIDENCE !== null) return EVIDENCE;
  try {
    EVIDENCE = new Set(JSON.parse(fs.readFileSync(path.join(DATA, 'zh_merge_evidence.json'), 'utf8')));
  } catch (e) { EVIDENCE = undefined; }
  return EVIDENCE;
}

function mergeByLexicon(text, segs) {
  const words = loadMergeWords();
  const probe = loadProbeWords();
  const wbmerge = loadWbMerge();
  const rates = loadRates();
  let th = RATES_TH !== null ? RATES_TH : MERGE_TH;
  if (process.env.OS_MERGE_TH !== undefined && process.env.OS_MERGE_TH !== '') {
    th = parseFloat(process.env.OS_MERGE_TH);
  }
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
        if (cand.length > MAX_MERGE_LEN) continue;
        if (!words.has(cand) && probe[cand] === undefined && !wbmerge.has(cand)) continue;
        if (wbmerge.has(cand) && !words.has(cand)) { best = k; break; }
        const pv = probe[cand];
        if (pv !== undefined) {
          if (pv === 1) { best = k; break; }
          continue;
        }
        const rate = rates[cand];
        let ok;
        if (rate === undefined) {
          if (MERGE_DEFAULT_ENV !== undefined) ok = MERGE_DEFAULT >= th;
          else {
            const ev = loadEvidence();
            ok = ev === undefined ? true : ev.has(cand);
          }
        } else ok = rate >= th;
        if (ok) { best = k; break; }
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

function boundsFromWords(chars, words) {
  const n = chars.length;
  const bounds = new Array(Math.max(0, n - 1)).fill(false);
  let pos = 0;
  for (const w of words) {
    pos += w.length;
    if (pos > 0 && pos < n) bounds[pos - 1] = true;
  }
  return bounds;
}

module.exports = { classes, segments, boundsFromWords, available: () => { try { load(); return true; } catch (e) { return false; } } };

if (require.main === module) {
  const args = process.argv.slice(2);
  for (const t of (args.length ? args : ['未预配上下文'])) {
    const segs = segments([...t]);
    console.log(t, '->', segs.map(([s, L]) => t.slice(s, s + L)).join('|'));
  }
}
