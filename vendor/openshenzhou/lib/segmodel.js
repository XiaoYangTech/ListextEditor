'use strict';
// segmodel.js —— 中文分词边界模型（与 Python openshenzhou/segmodel.py 完全一致的推理）
//
// 权重来自 data/zh_seg_model.bin（float32）；维度见 data/zh_seg_model.json。

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');

// ---- CRC32（与 zlib.crc32 一致）----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(str) {
  const buf = Buffer.from(str, 'utf8');
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

let _W = null;
let _DIM = 0;
let _LEX = null;
let _WORDSET = null;

function loadLexWords() {
  if (_LEX) return _LEX;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(DATA, 'lexicon_zh.names.json'), 'utf8'));
    _LEX = new Set(Object.keys(d));
  } catch (e) { _LEX = new Set(); }
  return _LEX;
}

function loadOfficialWords() {
  try {
    return new Set(JSON.parse(fs.readFileSync(path.join(DATA, 'official_words_zh.json'), 'utf8')));
  } catch (e) { return new Set(); }
}

function wordset() {
  if (!_WORDSET) {
    try {
      const arr = JSON.parse(fs.readFileSync(path.join(DATA, 'zh_seg_wordset.json'), 'utf8'));
      _WORDSET = new Set(arr);
    } catch (e) {
      _WORDSET = new Set([...loadLexWords(), ...loadOfficialWords()]);
    }
  }
  return _WORDSET;
}

function load() {
  if (_W) return true;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(DATA, 'zh_seg_model.json'), 'utf8'));
    _DIM = meta.dim;
    const buf = fs.readFileSync(path.join(DATA, 'zh_seg_model.bin'));
    _W = new Float32Array(buf.buffer, buf.byteOffset, _DIM);
    return true;
  } catch (e) {
    _W = null;
    return false;
  }
}

function available() { return load(); }

function baselineWords(chars, maxlen) {
  maxlen = maxlen || 6;
  const ws = wordset();
  const out = [];
  let i = 0;
  const n = chars.length;
  while (i < n) {
    let hit = null;
    for (let L = Math.min(maxlen, n - i); L >= 1; L--) {
      const cand = chars.slice(i, i + L).join('');
      if (ws.has(cand)) { hit = L; break; }
    }
    if (hit === null) hit = 1;
    out.push([i, i + hit]);
    i += hit;
  }
  return out;
}

function baselineLabels(nchars, words) {
  const labs = new Array(Math.max(0, nchars - 1)).fill(0);
  for (let si = 1; si < words.length; si++) {
    const pos = words[si][0] - 1;
    if (pos >= 0 && pos < labs.length) labs[pos] = 1;
  }
  return labs;
}

function featurize(chars, i, baseLabs, words) {
  const n = chars.length;
  const ch = (k) => (k < 0 ? '^' : (k >= n ? '$' : chars[k]));
  const f = [];
  for (let d = -2; d <= 3; d++) f.push('c' + d + '=' + ch(i + d));
  f.push('b0=' + ch(i) + ch(i + 1));
  f.push('b-1=' + ch(i - 1) + ch(i));
  f.push('b1=' + ch(i + 1) + ch(i + 2));
  f.push('t-1=' + ch(i - 1) + ch(i) + ch(i + 1));
  f.push('t0=' + ch(i) + ch(i + 1) + ch(i + 2));
  for (let L = 1; L <= 4; L++) {
    for (let s = 1; s < L; s++) {
      const start = i - s + 1;
      const end = start + L;
      if (start < 0 || end > n) continue;
      const w = chars.slice(start, end).join('');
      if (loadLexWords().has(w)) f.push('w' + L + '_' + s + '=' + w);
    }
  }
  const bl = (i >= 0 && i < baseLabs.length) ? baseLabs[i] : 0;
  f.push('base=' + bl);
  let left = null, right = null;
  for (const [s0, e0] of words) {
    if (s0 < i + 1 && i + 1 <= e0) left = [s0, e0];
    if (s0 <= i + 1 && i + 1 < e0) right = [s0, e0];
  }
  if (!left) left = [i, i + 1];
  if (!right) right = [i + 1, Math.min(n, i + 2)];
  const lw = chars.slice(left[0], left[1]).join('');
  const rw = chars.slice(right[0], right[1]).join('');
  f.push('lwlen=' + lw.length);
  f.push('rwlen=' + rw.length);
  f.push('lw=' + lw);
  f.push('rw=' + rw);
  f.push('pair=' + lw + '|' + rw);
  f.push('pos_in_lw=' + (i + 1 - left[0]));
  f.push('pos=' + Math.min(3, Math.floor(4.0 * i / Math.max(1, n))));
  f.push('len=' + Math.min(5, Math.floor(n / 5)));
  if (i === 0) f.push('at_start');
  if (i === n - 2) f.push('at_end');
  return f;
}

function scores(chars, baseLabs, words) {
  if (!load() || chars.length < 2) return new Float32Array(Math.max(0, chars.length - 1));
  if (!words) words = baselineWords(chars);
  if (!baseLabs) baseLabs = baselineLabels(chars.length, words);
  const n = chars.length;
  const out = new Float32Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const feats = featurize(chars, i, baseLabs, words);
    let z = 0;
    for (const s of feats) z += _W[crc32(s) % _DIM];
    out[i] = z;
  }
  return out;
}

function predict(chars, baseLabs, words) {
  const sc = scores(chars, baseLabs, words);
  const out = new Int8Array(sc.length);
  for (let i = 0; i < sc.length; i++) out[i] = sc[i] > 0 ? 1 : 0;
  return out;
}

module.exports = { available, baselineWords, baselineLabels, predict, scores, crc32 };
