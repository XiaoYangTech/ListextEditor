'use strict';
// zh_tone.js —— 中文上下文声调/读音修正（与 Python openshenzhou/zh_tone.py v2 一致）
//
// 数据：data/zh_tone_ctx_model.json.gz（8,756 句 UI 语料训练，7 级 backoff；
//       v2 富特征：基线 token + 前2/前1/后1字符 + 前后词界位 + 句内位置）。
// 验证：留出 1500 句 1419->1462（+43，仅 1 句破坏）；中文 3000 句 2915->2925；599 句不变。
// 只对简体路径生效（繁体由 zh_trad 处理）。

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DATA = path.join(__dirname, '..', '..', 'data');
const BOUND = new Set(['-bos-', 'br0', 'br1', 'br2', 'br3', 'br4', '~', '-']);

let MODEL = null;
let TABLES = null;
let ENABLED = true;

function setEnabled(flag) { ENABLED = !!flag; }
function isEnabled() { return ENABLED; }

function load() {
  if (MODEL !== null) return;
  try {
    const buf = fs.readFileSync(path.join(DATA, 'zh_tone_ctx_model.json.gz'));
    MODEL = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
  } catch (e) {
    MODEL = { tables: [] };
  }
  TABLES = MODEL.tables || [];
}

function revOf(sym) {
  const rev = {};
  for (const [k, v] of Object.entries(sym || {})) rev[v] = k;
  return rev;
}

function charsOf(sent) {
  const out = [];
  for (const ch of sent) {
    const code = ch.codePointAt(0);
    if ((code >= 0x4e00 && code <= 0x9fff) || ch === '〇') out.push(ch);
  }
  return out;
}

function parseIds(ids, rev) {
  const names = [];
  for (const x of ids) {
    names.push(rev[x] !== undefined ? rev[x] : ('?' + x));
    if (x === 1) break;
  }
  const pieces = [];
  let cur = [];
  for (const t of names) {
    if (BOUND.has(t) || t.startsWith('punc')) {
      if (cur.length) { pieces.push(['word', cur]); cur = []; }
      pieces.push(['sep', t]);
    } else {
      cur.push(t);
    }
  }
  if (cur.length) pieces.push(['word', cur]);
  const words = pieces.filter((p) => p[0] === 'word').map((p) => p[1]);
  const bits = [];
  let pending = [];
  for (const piece of pieces) {
    if (piece[0] === 'sep') {
      pending.push(piece[1]);
    } else {
      bits.push(pending.includes('br1') ? 1 : 0);
      pending = [];
    }
  }
  return { pieces, words, bits };
}

function keysOf(chars, words, bits, i) {
  const n = chars.length;
  const ch = chars[i];
  const p1 = i > 0 ? chars[i - 1] : '^';
  const p2 = i > 1 ? chars[i - 2] : '^';
  const n1 = i + 1 < n ? chars[i + 1] : '$';
  const bl = i < bits.length ? bits[i] : 0;
  const br = i + 1 < bits.length ? bits[i + 1] : 0;
  const pos = i === 0 ? 'B' : (i === n - 1 ? 'E' : 'M');
  const cur = words[i].join(' ');
  const s = '\x1f';
  return [cur + s + p2 + p1 + ch + n1 + s + bl + '' + br + s + pos,
    cur + s + p1 + ch + n1 + s + bl + '' + br,
    cur + s + ch + n1 + s + bl + '' + br,
    cur + s + p1 + ch + s + bl,
    cur + s + ch + s + bl,
    cur + s + ch,
    cur];
}

function apply(text, ids, sym) {
  load();
  if (!ENABLED || !TABLES.length) return ids;
  try {
    const trad = require('./zh_trad');
    if (trad.detect(text)) return ids;
  } catch (e) { /* 保持可用 */ }
  const rev = revOf(sym);
  const chars = charsOf(text);
  const { pieces, words, bits } = parseIds(ids, rev);
  if (words.length !== chars.length) return ids;
  const newWords = [];
  let changed = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const keys = keysOf(chars, words, bits, i);
    let use = w;
    for (let d = 0; d < keys.length; d++) {
      const table = TABLES[d];
      if (!table) continue;
      const hit = table[keys[d]];
      if (hit) {
        if (hit.length !== w.length || hit.some((x, k) => x !== w[k])) {
          let ok = true;
          for (const t of hit) if (sym[t] === undefined) { ok = false; break; }
          if (ok) { use = hit.slice(); changed = true; }
        }
        break;
      }
    }
    newWords.push(use);
  }
  if (!changed) return ids;
  const out = [];
  let wi = 0;
  for (const piece of pieces) {
    if (piece[0] === 'sep') {
      out.push(sym[piece[1]] !== undefined ? sym[piece[1]] : (sym.padding || 0));
    } else {
      for (const t of newWords[wi]) out.push(sym[t]);
      wi += 1;
    }
  }
  return out;
}

module.exports = { apply, setEnabled, isEnabled, load };
