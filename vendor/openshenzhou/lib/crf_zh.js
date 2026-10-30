'use strict';
// crf_zh.js —— 中文多音字读音 CRF 的 Node 复刻（与 Python openshenzhou/crf_zh.py 一致）
//
// 数据：语音包内 MSTTSLocZhCN.dat 的 A 段（trie）与 B 段（权重）；
// 元数据：data/zh_crf_models.json / zh_crf_model_chars.json / zh_crf_model_trust.json

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');
const VIRT_PRE = ['_B', '_B-2', '_B-1'];
const VIRT_POST = ['_B+1', '_B+2', '_B+3', '_B+4'];

let MODELS = null;
let MODEL_CHARS = null;
let CHAR_MODELS = null;
let TRUST = null;
const DAT_CACHE = new Map();
const TRIE_CACHE = new Map();
const WEIGHT_CACHE = new Map();

function loadJson(p, d) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; }
}

function loadModels() {
  if (!MODELS) MODELS = loadJson(path.join(DATA, 'zh_crf_models.json'), []);
  return MODELS;
}

function loadCharModels() {
  if (!MODEL_CHARS) {
    MODEL_CHARS = loadJson(path.join(DATA, 'zh_crf_model_chars.json'), {});
    CHAR_MODELS = {};
    for (const [k, v] of Object.entries(MODEL_CHARS)) {
      if (v && v.char) {
        if (!CHAR_MODELS[v.char]) CHAR_MODELS[v.char] = [];
        CHAR_MODELS[v.char].push(parseInt(k, 10));
      }
    }
  }
  return [MODEL_CHARS, CHAR_MODELS];
}

function loadTrust() {
  if (!TRUST) TRUST = loadJson(path.join(DATA, 'zh_crf_model_trust.json'), {});
  return TRUST;
}

function modelTrusted(idx) {
  const t = loadTrust()[String(idx)];
  if (!t) return false;
  if (t.force) return true;
  return (t.n || 0) >= 3 && (t.acc || 0) >= 0.9;
}

function modelMargin(idx) {
  const t = loadTrust()[String(idx)] || {};
  return t.margin !== undefined ? t.margin : 0.0;
}

function datOf(pkgDir) {
  if (!pkgDir) return null;
  const p = path.join(pkgDir, 'MSTTSLocZhCN.dat');
  if (DAT_CACHE.has(p)) return DAT_CACHE.get(p);
  let buf = null;
  try { buf = fs.readFileSync(p); } catch (e) { buf = null; }
  DAT_CACHE.set(p, buf);
  return buf;
}

class Trie {
  constructor(A) {
    this.A = A;
    this.nfeat = A.readUInt32LE(20);
    this.countB = A.readUInt32LE(24);
    this.nodeCount = A.readUInt32LE(28);
    this.countA = A.readUInt32LE(36);
    this.streamOff = A.readUInt32LE(40);
    this.streamSize = A.readUInt32LE(44);
    this.tbl1 = 0x30; this.tbl2 = 0x34; this.tbl3 = 0x38;
    this.nodes = 0x3C;
    this.arrA = this.nodes + this.nodeCount * 4;
    this.arrB = this.arrA + this.countA * 4;
    this.base = this.streamOff;
  }
  u16(off) { return this.A.readUInt16LE(off); }
  u32(off) { return this.A.readUInt32LE(off); }
  decode(tbl, p) {
    let b = this.A[p];
    let val = 0;
    let i = 0;
    for (;;) {
      const base = this.u16(tbl + i * 2);
      if (base > b) break;
      val += base;
      i += 1;
      p += 1;
      b = (b - base) * 256 + this.A[p];
    }
    return [val + b, i + 1];
  }
  descend(st) {
    const [idx, used] = this.decode(this.tbl1, st.p10);
    st.ch = this.u16(this.nodes + idx * 4);
    st.flags = this.u16(this.nodes + idx * 4 + 2);
    let v = 0;
    let q = st.p10 + used;
    if (st.flags & 4) {
      const b0 = this.A[q];
      if (b0 < 0xC0) {
        if (b0 > 0x7F) { v = ((b0 & 0x7F) << 8) | this.A[q + 1]; q += 2; }
        else { v = b0; q += 1; }
      } else {
        v = (((this.A[q + 1] & 0x7F) | ((b0 & 0x3F) << 7)) << 8) | this.A[q + 2];
        q += 3;
      }
    }
    st.val8 = v;
    st.p10 = q;
  }
  skip(st) {
    const mask = st.flags & 0x1D0;
    if (!mask) return;
    let p = st.p10;
    let p2 = p;
    if (mask === 0x10) {
      const [idx, used] = this.decode(this.tbl3, p);
      p2 = p + used;
      let q = st.p28;
      if (q === 0) { st.p28 = p2; q = p2; }
      st.p28 = q + this.u32(this.arrB + idx * 4);
    } else if (mask === 0x50) {
      st.p28 = p;
    } else if (mask === 0x90) {
      let i = 0;
      let b = this.A[p];
      let base = this.u16(this.tbl2);
      let q = p;
      if (base <= b) {
        for (;;) {
          i += 1; q += 1;
          b = (b - base) * 256 + this.A[q];
          base = this.u16(this.tbl2 + i * 2);
          if (base > b) break;
        }
      }
      p2 = p + (i + 1);
    } else if (mask === 0x110) {
      p2 = p + 3;
    }
    st.p10 = p2;
  }
  commit(st) {
    const mask = st.flags & 0x1C0;
    let v = 0;
    if (mask === 0) v = st.p28;
    else if (mask === 0x40) v = st.p_desc;
    else if (mask === 0x80) {
      const [idx] = this.decode(this.tbl2, st.p_desc);
      v = this.u32(this.arrA + idx * 4) + this.base;
    } else if (mask === 0x100) {
      const p = st.p_desc;
      v = ((this.A[p] << 16) | (this.A[p + 1] << 8) | this.A[p + 2]) + this.base;
    }
    st.p18 = v;
  }
  lookup(str) {
    const s = [];
    for (const ch of str) s.push(ch.codePointAt(0));
    const n = s.length;
    const st = { ch: 0, flags: 0x10, val8: 0, p10: this.base, p18: this.base,
                 p28: 0, p20: 0, p_desc: this.base };
    let acc = -1;
    let best = -1;
    let i = 0;
    let guardTotal = 0;
    for (;;) {
      const saved = acc;
      if ((st.flags & 0x10) === 0) break;
      st.p28 = 0;
      st.p10 = st.p18;
      this.descend(st);
      st.p_desc = st.p10;
      this.skip(st);
      const ch = i < n ? s[i] : 0;
      acc += 1;
      if ((st.flags & 1) === 0) acc = saved;
      let guard = 0;
      while (st.ch !== ch) {
        guard += 1; guardTotal += 1;
        if (guard > 200000 || guardTotal > 400000) return [-1, 0];
        acc += st.val8;
        if (st.flags & 2) {
          if ((st.flags & 0x200) === 0) {
            if ((st.flags & 0x20) === 0) return [-1, 0];
            st.p10 = st.p20;
          }
          st.p28 = 0;
        }
        this.descend(st);
        st.p_desc = st.p10;
        if (st.flags & 1) acc += 1;
        this.skip(st);
      }
      st.p10 = st.p_desc;
      this.commit(st);
      i += 1;
      if (st.flags & 1) best = acc;
      if (i >= n) break;
    }
    return [best, i];
  }
}

function trieOf(pkgDir, idx) {
  const key = pkgDir + '#' + idx;
  if (TRIE_CACHE.has(key)) return TRIE_CACHE.get(key);
  const dat = datOf(pkgDir);
  if (!dat) return null;
  const m = loadModels()[idx];
  if (!m) return null;
  const A = dat.subarray(m.A_off, m.A_off + m.lenA);
  let trie = null;
  try { trie = new Trie(Buffer.from(A)); } catch (e) { trie = null; }
  TRIE_CACHE.set(key, trie);
  return trie;
}

function weightsOf(pkgDir, idx) {
  const key = pkgDir + '#' + idx;
  if (WEIGHT_CACHE.has(key)) return WEIGHT_CACHE.get(key);
  const dat = datOf(pkgDir);
  const m = loadModels()[idx];
  if (!dat || !m) return null;
  const B = dat.subarray(m.B_off, m.B_off + m.lenB);
  const view = new DataView(B.buffer, B.byteOffset, B.byteLength);
  const n = Math.floor(B.byteLength / 4);
  const vals = new Float32Array(n);
  for (let i = 0; i < n; i++) vals[i] = view.getFloat32(i * 4, true);
  WEIGHT_CACHE.set(key, vals);
  return vals;
}

function labelParts(model) {
  const out = [];
  for (const lab of model.labels) {
    const parts = String(lab).toLowerCase().split('%');
    if (!parts.length || parts.some((p) => !p)) return null;
    out.push(parts);
  }
  return out;
}

function features(model, tokText, sentChars, tokens, ti) {
  const tmpls = model.templates;
  const [tStart, tEnd] = [tokens[ti].start, tokens[ti].end];
  const n = sentChars.length;
  const ext = VIRT_PRE.concat(tokens.map((t) => t.text), VIRT_POST);
  const ei = VIRT_PRE.length + ti;
  const prevChar = (k) => {
    const p = tStart - 1 - k;
    return p >= 0 && p < n ? sentChars[p] : '^';
  };
  const nextChar = (k) => {
    const p = tEnd + k;
    return p >= 0 && p < n ? sentChars[p] : '^';
  };
  const prevTok = (k) => {
    const j = ei - k;
    return j >= 0 && j < ext.length ? ext[j] : '_B';
  };
  const nextTok = (k) => {
    const j = ei + k;
    return j >= 0 && j < ext.length ? ext[j] : '_B+2';
  };
  const out = [];
  for (const tm of tmpls) {
    const ci = tm.indexOf(':');
    const expr = ci >= 0 ? tm.slice(ci + 1) : tm;
    const parts = [];
    for (let part of expr.split('/')) {
      part = part.trim();
      let mm = part.match(/^Token\.PreviousCharacters\.GetCharacter\((\d+)\)$/);
      if (mm) { parts.push(prevChar(parseInt(mm[1], 10))); continue; }
      mm = part.match(/^Token\.NextCharacters\.GetCharacter\((\d+)\)$/);
      if (mm) { parts.push(nextChar(parseInt(mm[1], 10))); continue; }
      if (part.includes('PrevToken') && part.endsWith('CaseInsensitiveText')) {
        parts.push(prevTok((part.match(/PrevToken/g) || []).length)); continue;
      }
      if (part.includes('NextToken') && part.endsWith('CaseInsensitiveText')) {
        parts.push(nextTok((part.match(/NextToken/g) || []).length)); continue;
      }
      parts.push('');
    }
    out.push(tm.slice(0, Math.max(0, ci)) + ':' + parts.join('/'));
  }
  return out;
}

function readingForChar(ch, sentChars, tokens, ti, pkgDir) {
  const [, inv] = loadCharModels();
  const idxs = inv[ch];
  if (!idxs) return null;
  for (const idx of idxs) {
    if (!modelTrusted(idx)) continue;
    const model = loadModels()[idx];
    if (!model || model.T !== 24) continue;
    const labels = labelParts(model);
    if (!labels) continue;
    const trie = trieOf(pkgDir, idx);
    const vals = weightsOf(pkgDir, idx);
    if (!trie || !vals) continue;
    const L = model.L;
    const nf = model.nfeat;
    if (L !== labels.length) continue;
    let feats = null;
    try { feats = features(model, tokens[ti].text, sentChars, tokens, ti); }
    catch (e) { continue; }
    const scores = new Array(L).fill(0);
    let hit = 0;
    for (const fs of feats) {
      let fid = -1;
      try { fid = trie.lookup(fs)[0]; } catch (e) { fid = -1; }
      if (fid < 0 || fid >= nf) continue;
      hit += 1;
      const b = fid * L;
      for (let l = 0; l < L; l++) scores[l] += vals[b + l];
    }
    if (!hit) continue;
    const order = scores.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    const margin = L > 1 ? order[0][0] - order[1][0] : 99;
    if (margin < modelMargin(idx)) continue;
    return labels[order[0][1]];
  }
  return null;
}

function buildTokens(text, wb) {
  const tokens = [];
  const punct = new Set('，。！？、；：,.;!?…—－《》「」『』（）()【】 \t'.split(''));
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (punct.has(c)) {
      tokens.push({ text: c, start: i, end: i + 1 });
      i += 1;
      continue;
    }
    let j = i;
    while (j < n && !punct.has(text[j])) j += 1;
    const chunk = text.slice(i, j);
    const chars = [...chunk];
    let words = null;
    if (wb) {
      try { words = wb.segments(chars).map(([s, L]) => chars.slice(s, s + L).join('')); }
      catch (e) { words = null; }
    }
    if (!words) words = chars;
    let pos = i;
    for (const w of words) {
      tokens.push({ text: w, start: pos, end: pos + w.length });
      pos += w.length;
    }
    i = j;
  }
  return tokens;
}

function charTokenIndex(tokens, pos) {
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.start <= pos && pos < t.end) {
      return t.end - t.start === 1 ? k : null;
    }
  }
  return null;
}

module.exports = { loadModels, loadCharModels, readingForChar, buildTokens, charTokenIndex, modelTrusted };
