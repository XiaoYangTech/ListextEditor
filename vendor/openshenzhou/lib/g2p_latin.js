'use strict';
// g2p_latin.js —— 拉丁语系（es/fr/de/pt）文本 → 音素 ID
const fs = require('fs');
const { resolveSeq } = require('./symbols');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');
const LANGS = ['es', 'fr', 'de', 'pt'];
const LEXICONS = {};
for (const l of LANGS) {
  try {
    const pn = path.join(DATA, 'lexicon_' + l + '.names.json');
    const p = fs.existsSync(pn) ? pn : path.join(DATA, 'lexicon_' + l + '.json');
    LEXICONS[l] = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  catch (e) { LEXICONS[l] = {}; }
}

const PUNCT = { ',': 'punc,', '.': 'punc.', '?': 'punc?', '!': 'punc!', ';': 'punc;' };

// 各语言字母 → 音素兜底
const LETTER_RULES = {
  es: { a: ['a'], e: ['e'], i: ['i'], o: ['o'], u: ['u'], b: ['b'], c: ['k'], d: ['d'],
        f: ['f'], g: ['g'], h: [], j: ['x'], k: ['k'], l: ['l'], m: ['m'], n: ['n'],
        ñ: ['nj'], p: ['p'], q: ['k'], r: ['rr'], s: ['s'], t: ['t'], v: ['b'],
        w: ['w'], x: ['x'], y: ['y'], z: ['s'] },
  fr: { a: ['a'], e: ['eh'], i: ['iy'], o: ['oh'], u: ['uy'], b: ['b'], c: ['k'], d: ['d'],
        f: ['f'], g: ['g'], h: [], j: ['zh'], k: ['k'], l: ['l'], m: ['m'], n: ['n'],
        p: ['p'], q: ['k'], r: ['r'], s: ['s'], t: ['t'], v: ['v'], w: ['w'],
        x: ['ks'], y: ['iy'], z: ['z'] },
  de: { a: ['a'], e: ['eh'], i: ['iy'], o: ['oh'], u: ['uh'], b: ['b'], c: ['k'], d: ['d'],
        f: ['f'], g: ['g'], h: ['h'], j: ['y'], k: ['k'], l: ['l'], m: ['m'], n: ['n'],
        p: ['p'], q: ['k'], r: ['r'], s: ['z'], t: ['t'], v: ['f'], w: ['v'],
        x: ['ks'], y: ['ue'], z: ['ts'] },
  pt: { a: ['a'], e: ['e'], i: ['i'], o: ['o'], u: ['u'], b: ['b'], c: ['k'], d: ['d'],
        f: ['f'], g: ['g'], h: [], j: ['zh'], k: ['k'], l: ['l'], m: ['m'], n: ['n'],
        p: ['p'], q: ['k'], r: ['rr'], s: ['s'], t: ['t'], v: ['v'], w: ['w'],
        x: ['sh'], y: ['y'], z: ['z'] },
};

function sid(sym, name) {
  if (sym[name] !== undefined) return sym[name];
  for (const k of Object.keys(sym)) if (k.toLowerCase() === name.toLowerCase()) return sym[k];
  return undefined;
}

function wordPhones(word, lang, sym) {
  const out = [];
  for (const ch of word.toLowerCase()) {
    for (const p of (LETTER_RULES[lang] || {})[ch] || []) {
      if (sym[p] !== undefined) out.push(sym[p]);
    }
  }
  return out;
}

function hasBos(sym) {
  return Object.keys(sym).some((k) => k.toLowerCase() === '-bos-');
}

function textToIdsPt(text, sym, lex) {
  const slash = sid(sym, '/');
  const tilde = sid(sym, '~');
  // Francisca 类葡语音色：纯音素串、无 / 分隔、无 punc、以 - 结尾
  const flat = false; // 实测 Francisca 使用「词内 -、词间 /」格式
  const wordGroups = [];
  let endPunct = null;
  for (const chunk of text.split(/([,\.\?!;])/)) {
    if (!chunk || !chunk.trim()) continue;
    if (PUNCT[chunk]) { endPunct = sym[PUNCT[chunk]] !== undefined ? sym[PUNCT[chunk]] : sym['punc.']; continue; }
    for (const w of chunk.match(/\p{L}+(?:['’\-]\p{L}+)*/gu) || []) {
      let core = lex[w.toLowerCase()];
      if (core) { core = core.slice(); while (core.length && core[core.length - 1] === slash) core.pop(); }
      else core = wordPhones(w, 'pt', sym);
      if (core && core.length) {
        if (flat) {
          while (core.length >= 2 && core[core.length - 1] === core[core.length - 2]) core.pop();
        }
        wordGroups.push(core);
      }
    }
  }
  const ids = [];
  if (flat) {
    for (const g of wordGroups) for (const x of g) ids.push(x);
    const dash = sid(sym, '-');
    if (dash !== undefined) ids.push(dash);
    return ids;
  }
  wordGroups.forEach((g, i) => { if (i > 0 && slash !== undefined) ids.push(slash); ids.push(...g); });
  if (endPunct !== null) { if (slash !== undefined) ids.push(slash); ids.push(endPunct); }
  if (slash !== undefined) ids.push(slash);
  if (tilde !== undefined) ids.push(tilde);
  return ids;
}

const FR_LIAISON = {
  est: 't', les: 'z', des: 'z', mes: 'z', tes: 'z', ses: 'z', ces: 'z',
  deux: 'z', trois: 'z', nous: 'z', vous: 'z', ils: 'z', elles: 'z',
  on: 'n', en: 'n', un: 'n', mon: 'n', ton: 'n', son: 'n', bien: 'n',
  trop: 'p', quand: 't', grand: 't', dix: 'z', six: 'z', neuf: 'v',
  pas: 'z', ont: 't', vont: 't', font: 't', sont: 't', faut: 't',
  chez: 'z', 'très': 'z', plus: 'z',
};
const FR_LIAISON_REPLACE = { dix: ['s', 'z'], six: ['s', 'z'], neuf: ['f', 'v'] };
const FR_VOWEL_INIT = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

function frIsVowel(phName) {
  if (!phName) return false;
  if (['uw', 'oh', 'oy'].some((p) => phName.startsWith(p))) return false;
  return FR_VOWEL_INIT.has(phName[0]);
}

function applyFrLiaison(ids, wordInfos, sym, rev) {
  const dels = [];
  const ins = [];
  for (let k = 1; k < wordInfos.length; k++) {
    const prev = wordInfos[k - 1], nxt = wordInfos[k];
    if (!prev.core.length || !nxt.core.length) continue;
    if (!frIsVowel(rev[nxt.core[0]] || '')) continue;
    const wPrev = (prev.word || '').toLowerCase();
    const rep = FR_LIAISON_REPLACE[wPrev];
    if (rep) {
      const [oldPh, newPh] = rep;
      const nid = sym[newPh];
      if (nid === undefined) continue;
      for (let ti = prev.core.length - 1; ti >= 0; ti--) {
        if ((rev[prev.core[ti]] || '') === oldPh) {
          const pos = prev.end - (prev.core.length - ti);
          if (pos >= 0 && pos < ids.length) dels.push(pos);
          ins.push([nxt.start, nid]);
          break;
        }
      }
      continue;
    }
    const consName = FR_LIAISON[wPrev];
    if (!consName) continue;
    const cons = sym[consName];
    if (cons === undefined) continue;
    ins.push([nxt.start, cons]);
  }
  if (!dels.length && !ins.length) return ids;
  ins.sort((a, b) => b[0] - a[0]);
  for (const [pos, cid] of ins) ids.splice(pos, 0, cid);
  dels.sort((a, b) => b - a);
  for (const pos of dels) ids.splice(pos, 1);
  return ids;
}

function textToIds(text, sym, lang) {
  const rawLex = LEXICONS[lang] || {};
  const lex = {};
  for (const k of Object.keys(rawLex)) lex[k] = resolveSeq(rawLex[k], sym);
  if (!hasBos(sym)) return textToIdsPt(text, sym, lex);
  const ids = [sid(sym, '-bos-'), sid(sym, 'br0')];
  const wordInfos = [];
  let first = true, ended = false;
  for (const chunk of text.split(/([,\.\?!;])/)) {
    if (!chunk || !chunk.trim()) continue;
    if (PUNCT[chunk]) {
      const key = PUNCT[chunk];
      if (['.', '?', '!'].includes(chunk)) {
        ids.push(sid(sym, 'br4'));
        ids.push(sym[key] !== undefined ? sym[key] : 0);
        ended = true;
      } else {
        ids.push(sid(sym, 'br3') !== undefined ? sid(sym, 'br3') : 0);
        ids.push(sym[key] !== undefined ? sym[key] : 0);
        ids.push(sid(sym, 'br0'));
        first = true;
      }
      continue;
    }
    for (const w of chunk.match(/\p{L}+(?:['’\-]\p{L}+)*/gu) || []) {
      let core = lex[w.toLowerCase()];
      if (!core && (w.includes("'") || w.includes("’"))) {
        const parts = w.split(/['’]/).filter(Boolean);
        core = [];
        parts.forEach((pp, pi) => {
          let c;
          if (pi < parts.length - 1 && pp.length === 1) c = wordPhones(pp, lang, sym);
          else c = lex[pp.toLowerCase()] || wordPhones(pp, lang, sym);
          core.push(...c);
        });
      } else if (!core && w.includes('-')) {
        const parts = w.split('-').filter(Boolean);
        core = [];
        parts.forEach((pp, gi) => {
          if (gi > 0 && sym['-'] !== undefined) core.push(sym['-']);
          const c = lex[pp.toLowerCase()] || wordPhones(pp, lang, sym);
          core.push(...c);
        });
      } else if (!core) {
        core = wordPhones(w, lang, sym);
      }
      if (!core || !core.length) continue;
      if (!first) ids.push(sid(sym, 'br1') !== undefined ? sid(sym, 'br1') : sid(sym, 'br0'));
      const startI = ids.length;
      ids.push(...core);
      wordInfos.push({ word: w, core: core, start: startI, end: ids.length });
      first = false;
    }
  }
  if (lang === 'fr' && wordInfos.length) {
    const rev = {};
    for (const k of Object.keys(sym)) rev[sym[k]] = k;
    try { applyFrLiaison(ids, wordInfos, sym, rev); } catch (e) {}
  }
  if (!ended) ids.push(sid(sym, 'br4'));
  // 德语语音包格式：句末 punc 之后还有一个 "/" 再过 "~"（引擎实测）
  if (lang === 'de') {
    const sl = sym['/'];
    if (sl !== undefined) ids.push(sl);
  }
  ids.push(sid(sym, '~'));
  return ids;
}

module.exports = { textToIds, LANGS };
