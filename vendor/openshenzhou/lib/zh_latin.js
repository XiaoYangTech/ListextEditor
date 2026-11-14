'use strict';
// zh_latin.js —— 中文语音中的拉丁字母/英文词读音（与 Python openshenzhou/zh_latin.py 一致）
//
// 引擎行为（Xiaoxiao 等中文语音实测）：
//   单个拉丁字母：中文式字母名（A→ey1、B→bi i_h i_l、C→s i_h i_h …）；
//   字母连写：英文式字母名逐字母读，词内 '-' 分隔（AB→ey1 - b iy1、CPU→s iy2 - ph iy - yi uw1）；
//   英文单词：按英文读音（Hello→hh eh - l ow1、Windows→wu ih1 n - dd ow zz）；
//   与中文之间 br1 词界分隔。
//
// 数据 data/zh_latin.json 由 tools/build_zh_latin_model.py 从引擎探针生成。

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');

let MODEL = null;
let ENABLED = true;

function _load() {
  if (MODEL !== null) return MODEL;
  try {
    MODEL = JSON.parse(fs.readFileSync(path.join(DATA, 'zh_latin.json'), 'utf8'));
  } catch (e) {
    MODEL = {};
  }
  return MODEL;
}

function setEnabled(flag) { ENABLED = !!flag; }
function available() { return !!(_load().single && Object.keys(_load().single).length); }

function splitGroups(tokens) {
  const groups = [];
  let cur = [];
  for (const t of tokens) {
    if (t === '-') {
      if (cur.length) { groups.push(cur); cur = []; }
    } else {
      cur.push(t);
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

function wordFromPhones(word, sym, model) {
  let lexicon = null;
  try {
    lexicon = require('./g2p_en').lexicon;
  } catch (e) { return null; }
  if (!lexicon) return null;
  const phones = lexicon[word];
  if (!phones || !phones.length) return null;
  const pmap = model.phone_map || {};
  const toks = [];
  for (const p of phones) {
    if (p === '-') { toks.push('-'); continue; }
    let t = pmap[p];
    if (t === undefined) {
      if (sym[p] !== undefined) t = p;
      else if (p === 'zh') t = 'zzh';
      else return null;
    }
    if (sym[t] === undefined) return null;
    toks.push(t);
  }
  return splitGroups(toks);
}

function groups(run, sym) {
  const model = _load();
  if (!ENABLED || !model || !run) return null;
  const letters = model.letters || {};
  const single = model.single || {};
  const words = model.words || {};
  if (run.length === 1) {
    const g = single[run.toUpperCase()];
    return g ? splitGroups(g) : null;
  }
  if (run.indexOf('-') >= 0) {
    const parts = run.split('-').filter((x) => x);
    if (!parts.length) return null;
    const joined = parts.join('').toLowerCase();
    if (words[joined]) return splitGroups(words[joined]);
    const wj = wordFromPhones(joined, sym, model);
    if (wj) return wj;
    const toks = [];
    for (const part of parts) {
      const sub = [];
      for (const ch of part) {
        const g = letters[ch.toUpperCase()];
        if (!g) return null;
        sub.push(...g);
      }
      if (!sub.length) return null;
      if (toks.length) toks.push('-');
      toks.push(...sub);
    }
    return splitGroups(toks);
  }
  const key = run.toLowerCase();
  if (words[key]) return splitGroups(words[key]);
  let w = null;
  const isUpper = run === run.toUpperCase() && /[A-Z]/.test(run);
  const noVowel = !/[AEIOU]/.test(run.toUpperCase());
  if (!(isUpper && noVowel)) w = wordFromPhones(key, sym, model);
  if (w) return w;
  const toks = [];
  for (const ch of run) {
    const g = letters[ch.toUpperCase()];
    if (!g) return null;
    if (toks.length) toks.push('-');
    toks.push(...g);
  }
  return splitGroups(toks);
}

module.exports = { groups, setEnabled, available };
