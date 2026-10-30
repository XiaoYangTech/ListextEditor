'use strict';
// symbols.js —— 标定数据（符号名）→ 当前音色包 id 的解析
//
// 同一语言不同音色（Xiaoxiao / Yunxi）的 phones.txt id 映射不同，
// 所以 lexicon / kana / syllables 以符号名保存，运行时按本音色包映射。

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');
// table → (sym → 解析结果)：同一词表在不同音色包下映射不同，必须按 sym 区分
const cache = new Map();

function loadJsonPreferNames(base, fallbackName) {
  const namesPath = path.join(DATA, base + '.names.json');
  if (fs.existsSync(namesPath)) return JSON.parse(fs.readFileSync(namesPath, 'utf8'));
  const p = path.join(DATA, fallbackName || base + '.json');
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return {}; }
  }
  return {};
}

function isNameSeq(seq) {
  return Array.isArray(seq) && seq.length > 0 && typeof seq[0] === 'string';
}

function resolveSeq(seq, sym) {
  if (!isNameSeq(seq)) return seq;
  return seq.map((x) => (typeof x === 'number' ? x : (sym[x] !== undefined ? sym[x] : (sym.padding || 0))));
}

function resolveTable(table, sym) {
  if (!table) return table || {};
  const first = table[Object.keys(table)[0]];
  if (!first || !isNameSeq(first)) return table;
  let perSym = cache.get(table);
  if (!perSym) {
    perSym = new WeakMap();
    cache.set(table, perSym);
  }
  const hit = perSym.get(sym);
  if (hit) return hit;
  const out = {};
  for (const k of Object.keys(table)) out[k] = resolveSeq(table[k], sym);
  perSym.set(sym, out);
  return out;
}

module.exports = { DATA, loadJsonPreferNames, resolveSeq, resolveTable, isNameSeq };
