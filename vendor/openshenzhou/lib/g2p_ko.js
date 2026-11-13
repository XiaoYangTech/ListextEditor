'use strict';
// g2p_ko.js —— 韩文文本 → 音素 ID
//
// 引擎实测格式（InJoon / SunHi）：
//     a n & n yeo ng & h a & s ei & yo / punc. / ~
//   "&"(12) 分音节，"/"(46) 分词，结尾 "/ punc. / ~"
//
// 词表：data/lexicon_ko.names.json；音节表：data/syllables_ko.names.json

const { loadJsonPreferNames, resolveSeq, resolveTable } = require('./symbols');

const PUNCT = { '.': 'punc.', '?': 'punc?', '!': 'punc!', ',': 'punc,', ';': 'punc;' };
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'.split('');
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'.split('');
const JONG = [''].concat('ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'.split(''));

function loadLexicon() { return loadJsonPreferNames('lexicon_ko', 'lexicon_ko.json'); }
function loadSyllables() { return loadJsonPreferNames('syllables_ko', 'syllables_ko.json'); }

function resolveKoSeq(seq, sym) {
  // 与 Python 版一致：缺失音素名按 去声调/hh→h/ss→s 回退，最后用 '-'（引擎占位符）
  return seq.map((x) => {
    if (typeof x === 'number') return x;
    if (sym[x] !== undefined) return sym[x];
    let cand = null;
    for (const alt of [x.replace(/[0-9]+$/, ''), x.replace(/hh/g, 'h'), x.replace(/ss/g, 's')]) {
      if (sym[alt] !== undefined) { cand = sym[alt]; break; }
    }
    if (cand === null) {
      cand = sym['-'] !== undefined ? sym['-'] : (sym['&'] !== undefined ? sym['&'] : (sym.padding || 0));
    }
    return cand;
  });
}


function decompose(ch) {
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return null;
  return [CHO[Math.floor(code / 588)], JUNG[Math.floor((code % 588) / 28)], JONG[code % 28]];
}

function textToIds(text, sym) {
  const amp = sym['&'] !== undefined ? sym['&'] : null;
  const slash = sym['/'] !== undefined ? sym['/'] : null;
  const tilde = sym['~'] !== undefined ? sym['~'] : null;
  const lexRaw = loadLexicon();
  const syllRaw = resolveTable(loadSyllables(), sym);

  const items = [];
  let ended = false;
  const re = /([.?!,;])|([\uac00-\ud7a3]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) { items.push({ p: PUNCT[m[1]] }); ended = true; }
    else if (m[2]) items.push({ w: m[2] });
  }

  const ids = [];
  let emitted = 0;
  for (const it of items) {
    if (it.p) {
      if (slash !== null) ids.push(slash);
      ids.push(sym[it.p] !== undefined ? sym[it.p] : 0);
      if (slash !== null) ids.push(slash);
      continue;
    }
    const w = it.w;
    let core;
    if (lexRaw[w] && Array.isArray(lexRaw[w])) {
      core = resolveKoSeq(lexRaw[w], sym);
    } else {
      const groups = [];
      for (const ch of w) {
        let g = syllRaw[ch];
        if (!g) {
          const d = decompose(ch);
          if (!d) continue;
          g = [];
          for (const j of d) if (j && syllRaw[j]) g = g.concat(syllRaw[j]);
          if (!g.length) continue;
        }
        groups.push(g);
      }
      core = [];
      groups.forEach((g, gi) => {
        if (gi > 0 && amp !== null) core.push(amp);
        for (const x of g) core.push(x);
      });
    }
    if (!core.length) continue;
    if (emitted > 0 && slash !== null) ids.push(slash);
    for (const x of core) ids.push(x);
    emitted += 1;
  }
  if (!ended && slash !== null) ids.push(slash);
  if (tilde !== null) ids.push(tilde);
  return ids;
}

module.exports = { textToIds, decompose, loadLexicon, loadSyllables };
