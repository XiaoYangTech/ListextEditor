'use strict';
// zh_trad.js —— 繁体文本逐字读音修正（与 Python openshenzhou/zh_trad.py 一致）
//
// 数据：data/zh_trad_ctx_model.json.gz（3000 句繁体小说引擎 ids 训练的字级上下文修正表，
//       5 级 backoff；留出集 97.63% vs 基线 96.03%）。
// 投影：仅当文本含「有独立简体形的繁体字」时启用；音节数须等于汉字数；只覆盖差异项。

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DATA = path.join(__dirname, '..', '..', 'data');
const BOUND = new Set(['-bos-', 'br0', 'br1', 'br2', 'br3', 'br4', '~', '-']);

let MODEL = null;
let TABLES = null;
let TRAD_CHARS = null;
let ENABLED = process.env.OS_TRAD_OFF !== '1';

function setEnabled(flag) { ENABLED = !!flag; }
function isEnabled() { return ENABLED; }

function load() {
  if (MODEL !== null) return;
  try {
    const buf = fs.readFileSync(path.join(DATA, 'zh_trad_ctx_model.json.gz'));
    MODEL = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
  } catch (e) {
    MODEL = { tables: [], trad_chars: '' };
  }
  TABLES = MODEL.tables || [];
  TRAD_CHARS = new Set(MODEL.trad_gate || MODEL.trad_chars || '');
}

function detect(text) {
  load();
  for (const ch of String(text || '')) {
    if (TRAD_CHARS.has(ch)) return true;
  }
  return false;
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

function parseIds(sent, ids, rev) {
  const chars = charsOf(sent);
  const segments = [];
  let cur = [];
  for (const id of ids) {
    const t = rev[id] !== undefined ? rev[id] : ('?' + id);
    if (BOUND.has(t) || t.startsWith('punc')) {
      if (cur.length) { segments.push(['syl', cur]); cur = []; }
      segments.push(['sep', t]);
    } else {
      cur.push(t);
    }
  }
  if (cur.length) segments.push(['syl', cur]);
  const syls = segments.filter((s) => s[0] === 'syl').map((s) => s[1]);
  if (syls.length !== chars.length) return null;
  return { chars, syls, segments };
}

function lookup(chars, i, cur) {
  const n = chars.length;
  const ch = chars[i];
  const p1 = i > 0 ? chars[i - 1] : '^';
  const p2 = i > 1 ? chars[i - 2] : '^';
  const n1 = i + 1 < n ? chars[i + 1] : '$';
  const curS = cur.join(' ');
  const keys = [curS + '\x1f' + p2 + p1 + ch + n1,
    curS + '\x1f' + p1 + ch + n1,
    curS + '\x1f' + ch + n1,
    curS + '\x1f' + ch,
    curS];
  for (let depth = 0; depth < keys.length; depth++) {
    const table = TABLES[depth];
    if (!table) continue;
    const hit = table[keys[depth]];
    if (hit) return hit[0].slice();
  }
  return null;
}

function apply(text, ids, sym) {
  load();
  if (!ENABLED || !TABLES.length || !detect(text)) return ids;
  const rev = revOf(sym);
  const parsed = parseIds(text, ids, rev);
  if (!parsed) return ids;
  const { chars, syls, segments } = parsed;
  const fixed = [];
  let changed = false;
  for (let i = 0; i < syls.length; i++) {
    const cur = syls[i];
    const next = lookup(chars, i, cur);
    if (!next || next.length === cur.length && next.every((x, k) => x === cur[k])) {
      fixed.push(cur);
      continue;
    }
    let ok = true;
    for (const t of next) if (sym[t] === undefined) { ok = false; break; }
    if (!ok) { fixed.push(cur); continue; }
    fixed.push(next);
    changed = true;
  }
  if (!changed) return ids;
  const out = [];
  let k = 0;
  for (const seg of segments) {
    if (seg[0] === 'sep') {
      out.push(sym[seg[1]] !== undefined ? sym[seg[1]] : 0);
    } else {
      for (const t of fixed[k]) out.push(sym[t]);
      k += 1;
    }
  }
  return out;
}

module.exports = { detect, apply, setEnabled, isEnabled, load };
