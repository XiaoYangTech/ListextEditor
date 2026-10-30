'use strict';
// g2p_ja.js —— 日文文本 → 音素 ID
//
// 引擎实测格式（Keita / Nanami）：
//     k o & nn & n i & ch i & w a / punc。 ~
//   "&" 分莫拉，"/" 分词，结尾 "/ punc。 ~"，没有 -BOS-/br0
//
// 汉字读音：data/ja_readings.json（由官方词典词表 + pykakasi 生成）
// 词表：data/lexicon_ja.names.json（符号名，按音色包映射）

const fs = require('fs');
const path = require('path');
const { DATA, loadJsonPreferNames, resolveSeq, resolveTable } = require('./symbols');

let _readings = null;
function loadReadings() {
  if (_readings) return _readings;
  const p = path.join(DATA, 'ja_readings.json');
  _readings = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  return _readings;
}

let _JA_CTX = null;
function loadCtx() {
  if (_JA_CTX) return _JA_CTX;
  try {
    _JA_CTX = JSON.parse(fs.readFileSync(path.join(DATA, 'lexicon_ja_ctx.json'), 'utf8'));
  } catch (e) { _JA_CTX = {}; }
  return _JA_CTX;
}

function loadKana() {
  return loadJsonPreferNames('kana_ja', 'kana_ja.json');
}
function loadLexicon() {
  return loadJsonPreferNames('lexicon_ja', 'lexicon_ja.json');
}

const PUNCT = { '。': 'punc。', '、': 'punc、', '？': 'punc?', '！': 'punc!', '「': 'punc「', '」': 'punc」', ',': 'punc,', '.': 'punc.' };
const SMALL = new Set('ゃゅょぁぃぅぇぉ');
const SPACE = new Set([' ', '\u3000', '\t', '\r', '\n']);

function kataToHira(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 0x30a1 && c <= 0x30f6) out += String.fromCharCode(c - 0x60);
    else out += ch;
  }
  return out;
}

function isKanji(ch) {
  const c = ch.charCodeAt(0);
  return c >= 0x4e00 && c <= 0x9fff;
}
function isKana(ch) {
  const c = ch.charCodeAt(0);
  return (c >= 0x3041 && c <= 0x309f) || (c >= 0x30a1 && c <= 0x30ff) || ch === 'ー';
}

// 文本 → 假名串序列（词级别）
function toHiraganaWords(text) {
  const readings = loadReadings();
  const words = [];
  let buf = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (isKanji(ch)) {
      // 最长匹配读音表
      let hit = null;
      for (let L = Math.min(6, n - i); L >= 1; L--) {
        const cand = text.slice(i, i + L);
        if (readings[cand]) { hit = cand; break; }
      }
      if (hit) { buf += readings[hit]; i += hit.length; continue; }
      buf += ch;            // 无法读 → 保留（后面会被跳过）
      i += 1;
      continue;
    }
    if (isKana(ch)) { buf += kataToHira(ch); i += 1; continue; }
    if (PUNCT[ch] || SPACE.has(ch)) {
      if (buf) { words.push({ w: buf }); buf = ''; }
      if (PUNCT[ch]) words.push({ p: PUNCT[ch] });
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  if (buf) words.push({ w: buf });
  return words;
}

function splitMorae(word, table) {
  const out = [];
  let i = 0;
  const n = word.length;
  while (i < n) {
    const ch = word[i];
    if (i + 1 < n && SMALL.has(word[i + 1]) && table[ch + word[i + 1]]) {
      out.push(ch + word[i + 1]);
      i += 2;
      continue;
    }
    out.push(ch);
    i += 1;
  }
  const phones = [];
  for (let idx = 0; idx < out.length; idx++) {
    const m = out[idx];
    if (m === 'っ') {
      const nxt = table[out[idx + 1]] || [];
      if (nxt.length) phones.push([nxt[0]]);
      continue;
    }
    if (m === 'ー') {
      if (phones.length && phones[phones.length - 1].length) {
        const prev = phones[phones.length - 1];
        phones.push([prev[prev.length - 1]]);
      }
      continue;
    }
    phones.push((table[m] || []).slice());
  }
  return phones;
}

function resolveNames(core, sym) {
  const out = [];
  for (const x of core) {
    if (typeof x === 'number') { out.push(x); continue; }
    if (sym[x] !== undefined) { out.push(sym[x]); continue; }
    let cand = null;
    for (const alt of [x.replace(/[0-9]+$/, ''), x.replace(/hh/g, 'h'), x.replace(/pso/g, 'p')]) {
      if (sym[alt] !== undefined) { cand = sym[alt]; break; }
    }
    out.push(cand !== null ? cand : (sym.padding || 0));
  }
  return out;
}

const JA_PARTICLE = { 'は': 'わ', 'へ': 'え', 'を': 'お' };
const JA_NUM = new Set(Array.from('一二三四五六七八九十百千万零〇'));
const JA_UNIT = new Set(Array.from('時分秒月日年歳個回度'));

function splitNumUnit(word) {
  if (word.length < 2 || !JA_UNIT.has(word[word.length - 1])) return null;
  const head = word.slice(0, -1);
  if (head && Array.from(head).every((ch) => JA_NUM.has(ch))) return [head, word[word.length - 1]];
  return null;
}
const JA_SUFFIX = {
  '中': [['ch', 'y', 'u1'], ['w', 'u']],
  '日': [['n', 'i', 'ch', 'i']],
  '人': [['n', 'i', 'nn']],
  '時': [['j', 'i']],
  '分': [['f', 'u', 'nn']],
  '年': [['n', 'e', 'nn']],
  '月': [['g', 'a', 'ts', 'u']],
  '課': [['k', 'a']],
  '者': [['sh', 'a']],
  '性': [['s', 'e1', 'y', 'i']],
};

function wordToHiragana(word) {
  if (JA_PARTICLE[word]) return JA_PARTICLE[word];
  if (word.length > 1 && JA_PARTICLE[word[word.length - 1]]) {
    return wordToHiragana(word.slice(0, -1)) + JA_PARTICLE[word[word.length - 1]];
  }
  const readings = loadReadings();
  let out = '';
  let i = 0, n = word.length;
  while (i < n) {
    const ch = word[i];
    if (isKanji(ch)) {
      let hit = null;
      for (let L = Math.min(6, n - i); L >= 1; L--) {
        const cand = word.slice(i, i + L);
        if (readings[cand]) { hit = cand; break; }
      }
      if (hit) { out += readings[hit]; i += hit.length; continue; }
      out += ch; i += 1; continue;
    }
    if (isKana(ch)) { out += kataToHira(ch); i += 1; continue; }
    out += ch; i += 1;
  }
  return out;
}

function segmentWords(text) {
  // 用复刻的官方断词模型在原文上分词；标点单独成项
  const items = [];
  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    const chunk = buf.join('');
    buf = [];
    try {
      const W = require('./wb_model_ja');
      const chars = Array.from(chunk);
      for (const [s, L] of W.segments(chars)) {
        const w = chunk.slice(s, s + L);
        if (!w) continue;
        const parts = splitNumUnit(w);
        if (parts) for (const pp of parts) items.push({ w: pp });
        else items.push({ w });
      }
    } catch (e) {
      items.push({ w: chunk });
    }
  };
  for (const ch of text) {
    if (PUNCT[ch]) { flush(); items.push({ p: PUNCT[ch] }); }
    else if (SPACE.has(ch)) { flush(); }
    else buf.push(ch);
  }
  flush();
  return items;
}

function textToIds(text, sym) {
  const frame = (sym['-BOS-'] !== undefined || sym['-bos-'] !== undefined) && sym['br0'] !== undefined;
  const moraSep = sym['-'] !== undefined ? sym['-'] : (sym['&'] !== undefined ? sym['&'] : null);
  const slash = sym['/'] !== undefined ? sym['/'] : null;
  const tilde = sym['~'] !== undefined ? sym['~'] : null;
  const table = resolveTable(loadKana(), sym);
  const lexiconRaw = loadLexicon();
  const items = segmentWords(text);
  const ids = [];
  let first = true;
  let ended = false;
  let prevKanji = false;
  const ctx = loadCtx();
  let prevWord = '^';
  if (frame) {
    const bos = sym['-BOS-'] !== undefined ? sym['-BOS-'] : sym['-bos-'];
    ids.push(bos, sym['br0']);
  }
  const emitGroups = (groups) => {
    const core = [];
    groups.forEach((g, gi) => {
      if (gi > 0 && moraSep !== null) core.push(moraSep);
      for (const x of g) core.push(x);
    });
    return core;
  };
  for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
    const item = items[itemIdx];
    if (item.p) {
      if (frame) {
        ids.push(sym['br4'] !== undefined ? sym['br4'] : 0);
        ids.push(sym[item.p] !== undefined ? sym[item.p] : 0);
        first = true; ended = true; prevKanji = false;
        continue;
      }
      if (slash !== null) ids.push(slash);
      ids.push(sym[item.p] !== undefined ? sym[item.p] : 0);
      first = true; ended = true; prevKanji = false; prevWord = '^';
      continue;
    }
    const val = item.w;
    let nextWord = '$';
    for (let sj = itemIdx + 1; sj < items.length; sj++) {
      if (items[sj].w !== undefined) { nextWord = items[sj].w; break; }
    }
    if (frame) {
      const groups = splitMorae(wordToHiragana(val), table).map((ph) => resolveNames(ph, sym)).filter((g) => g.length);
      if (!groups.length) continue;
      if (!first) ids.push(sym['br1'] !== undefined ? sym['br1'] : sym['br0']);
      const sep = sym['-'];
      groups.forEach((g, gi) => {
        if (gi > 0 && sep !== undefined) ids.push(sep);
        for (const x of g) ids.push(x);
      });
      first = false; prevKanji = isKanji(val[val.length - 1]); prevWord = val;
      continue;
    }
    let core = null;
    const ctxKey = prevWord + '|' + val + '|' + nextWord;
    if (ctx[ctxKey] && Array.isArray(ctx[ctxKey])) {
      core = resolveNames(ctx[ctxKey], sym);
    } else if (JA_PARTICLE[val]) {
      core = [];
      for (const ph of splitMorae(JA_PARTICLE[val], table)) for (const x of ph) core.push(x);
    } else if (val.length === 1 && JA_SUFFIX[val] && prevKanji) {
      core = [];
      JA_SUFFIX[val].forEach((grp, gi) => {
        if (gi > 0 && moraSep !== null) core.push(moraSep);
        for (const x of resolveNames(grp, sym)) core.push(x);
      });
    } else if (val.length > 1 && JA_PARTICLE[val[val.length - 1]]
               && lexiconRaw[val.slice(0, -1)] && Array.isArray(lexiconRaw[val.slice(0, -1)])) {
      core = resolveSeq(lexiconRaw[val.slice(0, -1)], sym).slice();
      if (moraSep !== null) core.push(moraSep);
      for (const ph of splitMorae(JA_PARTICLE[val[val.length - 1]], table)) {
        for (const x of ph) core.push(x);
      }
    } else if (lexiconRaw[val] && Array.isArray(lexiconRaw[val])) {
      const seq = resolveSeq(lexiconRaw[val], sym);
      const sepIds = new Set();
      if (sym['&'] !== undefined) sepIds.add(sym['&']);
      if (sym['-'] !== undefined) sepIds.add(sym['-']);
      const groups = [];
      let cur = [];
      for (const x of seq) {
        if (sepIds.has(x)) {
          if (cur.length) groups.push(cur);
          cur = [];
        } else cur.push(x);
      }
      if (cur.length) groups.push(cur);
      core = emitGroups(groups);
    } else {
      core = emitGroups(splitMorae(wordToHiragana(val), table));
    }
    if (!core.length) continue;
    if (!first && slash !== null) ids.push(slash);
    for (const x of core) ids.push(x);
    first = false;
    prevKanji = isKanji(val[val.length - 1]);
    prevWord = val;
  }
  if (frame) {
    if (!ended) ids.push(sym['br4'] !== undefined ? sym['br4'] : 0);
    ids.push(sym['~'] !== undefined ? sym['~'] : 0);
    return ids;
  }
  if (slash !== null && !ended) ids.push(slash);
  if (tilde !== null) ids.push(tilde);
  return ids;
}

module.exports = { textToIds, loadKana, loadLexicon, toHiraganaWords, splitMorae };
