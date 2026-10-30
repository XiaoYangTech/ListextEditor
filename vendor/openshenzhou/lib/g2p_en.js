'use strict';
// g2p_en.js —— 英文文本 → 音素 ID（引擎行为复刻版，与 Python openshenzhou/g2p_en.py 对齐）
//
// 数据来源全部为引擎实测（ORT 探针标定）：
//   data/lexicon_en_context.json   语料句内「词 → 音素名序列」（含弱读形态）
//   data/lexicon_en_engine.json    单词隔离标定的「词 → 音素名序列」
//   data/lexicon_en.names.json     早期标定词表
//   data/cmudict_en.json           CMUdict 兜底
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');

function loadJson(p, d) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; }
}

const CTX = loadJson(path.join(DATA, 'lexicon_en_context.json'), {});
const ISO = loadJson(path.join(DATA, 'lexicon_en_engine.json'), {});
const VOCAB = loadJson(path.join(DATA, 'lexicon_en.names.json'), {});
const CMU = loadJson(path.join(DATA, 'cmudict_en.json'), {});
const HETERO = loadJson(path.join(DATA, 'lexicon_en_heteronyms.json'), {});
const ACRONYMS = loadJson(path.join(DATA, 'lexicon_en_acronyms.json'), {});
const CASE_WORDS = loadJson(path.join(DATA, 'lexicon_en_case.json'), {});
function acronymPhones(letters) {
  const ph = ACRONYMS[letters] || ACRONYMS[letters.toUpperCase()];
  if (ph) return ph.slice();
  return letterToken(letters.toLowerCase());
}
const VERB_PREV = new Set(['to', 'will', 'would', 'can', 'could', 'should', 'must', 'may', 'might',
  'do', 'does', 'did', "don't", "doesn't", "didn't", 'i', 'you', 'we', 'they', 'he', 'she',
  'let', 'please', 'cannot', "won't"]);
const HETERO_NOUN_PREV = new Set(['ip', 'email', 'web', 'home', 'street', 'url', 'ftp', 'http']);
const NOUN_PREV = new Set(['the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your',
  'his', 'her', 'its', 'our', 'their', 'no', 'every', 'each', 'any', 'some']);
(function loadJsonl() {
  const p = path.join(DATA, 'lexicon_en_engine.jsonl');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (ISO[r.w] === undefined) ISO[r.w] = r.phones;
    } catch (e) { /* ignore */ }
  }
})();

const BOS = '-bos-', END = '~';
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];
const ORD_ONES = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
  'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth',
  'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth'];
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy',
  'eighty', 'ninety'];
const ORD_TENS = ['', '', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth',
  'sixtieth', 'seventieth', 'eightieth', 'ninetieth'];
const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
const ROMAN_RE = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
function isRoman(w) { return !!w && w !== 'I' && ROMAN_RE.test(w); }
const CNT_WORDS = new Set(['chapter', 'part', 'section', 'book', 'volume', 'act',
  'scene', 'article', 'item', 'figure', 'table', 'appendix', 'page', 'no']);
const UNITS = {
  km: ['kilometers'], kmh: ['kilometers', 'per', 'hour'],
  kg: ['kilograms'], mg: ['milligrams'], g: ['grams'],
  cm: ['centimeters'], mm: ['millimeters'],
  ft: ['feet'], yd: ['yards'], mi: ['miles'],
  mph: ['miles', 'per', 'hour'], kbps: ['kilobits', 'per', 'second'],
  mb: ['megabytes'], gb: ['gigabytes'], kb: ['kilobytes'],
  tb: ['terabytes'], ms: ['milliseconds'],
  h: ['hours'], hr: ['hours'], hrs: ['hours'],
  min: ['minutes'], mins: ['minutes'],
  sec: ['seconds'], secs: ['seconds'],
  ml: ['milliliters'], oz: ['ounces'], lb: ['pounds'], lbs: ['pounds'],
};
const UNIT_SINGULAR = { hours: 'hour', minutes: 'minute', seconds: 'second',
  feet: 'foot', inches: 'inch', miles: 'mile', meters: 'meter',
  centimeters: 'centimeter', kilometers: 'kilometer', kilograms: 'kilogram' };
const CURRENCY = { $: ['dollar', 'cent'], '€': ['euro', 'cent'],
  '£': ['pound', 'penny'], '¥': ['yen', 'sen'], '￥': ['yen', 'sen'] };
const SPECIAL_PHONES = {
  underscore: ['ah2', 'n', '-', 'd', 'ax', 'r', '-', 's', 'k', 'ao1', 'r'],
  asterisk: ['ae1', '-', 's', 't', 'ax', '-', 'r', 'ih', 's', 'k'],
  "o'clock": ['ax', '-', 'k', 'l', 'aa1', 'k'],
};
const SYMBOL_WORDS = { '*': 'asterisk', _: 'underscore', '#': 'number', '@': 'at',
  '+': 'plus', '<': 'less', '>': 'greater', '~': null, '|': 'bar' };
const STRONG_AND = ['ae1', 'n', 'd'];
const STRONG_FOR = ['f', 'ao1', 'r'];
const PAUSE_PUNCT = { ',': 'punc,', ';': 'punc;', ':': null, '(': 'punc,',
  ')': 'punc,', '[': 'punc,', ']': 'punc,' };
const END_PUNCT = { '.': 'punc.', '?': 'punc?', '!': 'punc!' };
const BQUOTE = new Set(['"', '’', '”', "'"]);
const DENOM = { 2: 'half', 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth',
  7: 'seventh', 8: 'eighth', 9: 'ninth', 10: 'tenth', 100: 'hundredth' };

const VOWELS = new Set('aa ae ah ao aw ax ay eh er ey ih iy ow oy uh uw'.split(' '));
const ONSETS = new Set(`p b t d k g f v th dh s z sh zh ch jh m n ng l r h w y
pl pr bl br tr dr kl kr gl gr fl fr sl sw sp st sk sm sn
spl spr str skr skw shr thr`.split(/\s+/).filter(Boolean));
const LETTER_RULES = {
  a: ['ey1'], b: ['b', 'iy1'], c: ['s', 'iy1'], d: ['d', 'iy1'], e: ['iy1'],
  f: ['eh1', 'f'], g: ['jh', 'iy1'], h: ['ey1', 'ch'], i: ['ay1'],
  j: ['jh', 'ey1'], k: ['k', 'ey1'], l: ['eh1', 'l'], m: ['eh1', 'm'],
  n: ['eh1', 'n'], o: ['ow1'], p: ['p', 'iy1'], q: ['k', 'y', 'uw1'],
  r: ['aa1', 'r'], s: ['eh1', 's'], t: ['t', 'iy1'], u: ['y', 'uw1'],
  v: ['v', 'iy1'], w: ['d', 'ah1', 'b', 'ax', 'l', 'y', 'uw1'],
  x: ['eh1', 'k', 's'], y: ['w', 'ay1'], z: ['z', 'iy1'],
};

function cmuToEngine(ph) {
  const m = /^([A-Z]+)([012])?$/.exec(ph);
  if (!m) return ph.toLowerCase();
  const base = m[1], stress = m[2];
  if (base === 'HH') return 'h';
  if (base === 'AH' && (!stress || stress === '0')) return 'ax';
  if (stress === '1' || stress === '2') return base.toLowerCase() + stress;
  return base.toLowerCase();
}

function splitSyllables(phones) {
  const nuclei = [];
  for (let i = 0; i < phones.length; i++) {
    if (VOWELS.has(String(phones[i]).replace(/[012]$/, ''))) nuclei.push(i);
  }
  if (!nuclei.length) return [phones.slice()];
  const cuts = [];
  for (let k = 0; k + 1 < nuclei.length; k++) {
    const a = nuclei[k], b = nuclei[k + 1];
    const cluster = phones.slice(a + 1, b);
    if (!cluster.length) { cuts.push(b); continue; }
    let cut = a + 1;
    for (let n = cluster.length; n >= 1; n--) {
      const s = cluster.slice(cluster.length - n)
        .map((x) => String(x).replace(/[012]$/, '')).join('');
      if (ONSETS.has(s)) { cut = a + 1 + (cluster.length - n); break; }
    }
    cuts.push(cut);
  }
  const groups = [];
  let prev = 0;
  for (const c of cuts) {
    if (c <= prev) continue;
    groups.push(phones.slice(prev, c));
    prev = c;
  }
  groups.push(phones.slice(prev));
  return groups.filter((g) => g.length);
}

function withSyllables(phones) {
  const out = [];
  splitSyllables(phones).forEach((g, gi) => {
    if (gi) out.push('-');
    for (const p of g) out.push(p);
  });
  return out;
}

function cardinalWords(n) {
  if (n < 0) return ['minus'].concat(cardinalWords(-n));
  if (n < 20) return [ONES[n]];
  if (n < 100) { const r = n % 10; return [TENS[Math.floor(n / 10)]].concat(r ? [ONES[r]] : []); }
  if (n < 1000) {
    const q = Math.floor(n / 100), r = n % 100;
    let w = [ONES[q], 'hundred'];
    if (r) w = w.concat(['and'], cardinalWords(r));
    return w;
  }
  if (n < 1e6) {
    const q = Math.floor(n / 1000), r = n % 1000;
    let w = cardinalWords(q).concat(['thousand']);
    if (r) w = w.concat(r < 100 ? ['and'] : [], cardinalWords(r));
    return w;
  }
  if (n < 1e9) {
    const q = Math.floor(n / 1e6), r = n % 1e6;
    let w = cardinalWords(q).concat(['million']);
    if (r) w = w.concat(r < 100 ? ['and'] : [], cardinalWords(r));
    return w;
  }
  const q = Math.floor(n / 1e9), r = n % 1e9;
  let w = cardinalWords(q).concat(['billion']);
  if (r) w = w.concat(cardinalWords(r));
  return w;
}

function ordinalWords(n) {
  if (n < 20) return [ORD_ONES[n]];
  if (n < 100) {
    if (n % 10 === 0) return [ORD_TENS[Math.floor(n / 10)]];
    return [TENS[Math.floor(n / 10)], ORD_ONES[n % 10]];
  }
  if (n < 1000) {
    const q = Math.floor(n / 100), r = n % 100;
    let w = [ONES[q], 'hundred'];
    if (r) w = w.concat(r < 100 ? ['and'] : [], ordinalWords(r));
    return w;
  }
  const base = cardinalWords(n);
  if (n % 100 === 0) return base;
  return base.slice(0, -1).concat([ordinalWords(n % 100).slice(-1)[0]]);
}

function digitsWords(ds) {
  const out = [];
  for (const c of String(ds)) if (/[0-9]/.test(c)) out.push(ONES[Number(c)]);
  return out;
}

function yearWords(n) {
  if (n >= 1000 && n < 2000) {
    const hi = Math.floor(n / 100), lo = n % 100;
    if (!lo) return cardinalWords(hi * 100);
    return cardinalWords(hi).concat(lo >= 10 ? cardinalWords(lo) : ['oh'].concat(cardinalWords(lo)));
  }
  if (n >= 2000 && n < 2100) {
    const lo = n - 2000;
    if (!lo) return ['two', 'thousand'];
    if (lo < 10) return ['two', 'thousand', 'and'].concat(cardinalWords(lo));
    return cardinalWords(20).concat(cardinalWords(lo));
  }
  return cardinalWords(n);
}

function plural(n, w) {
  if (w === 'yen' || w === 'sen') return w;
  if (n === 1) return w;
  const map = { penny: 'pence', cent: 'cents', dollar: 'dollars', euro: 'euros', pound: 'pounds' };
  return map[w] || w + 's';
}

function romanValue(w) {
  let n = 0, prev = 0;
  for (let i = w.length - 1; i >= 0; i--) {
    const v = ROMAN[w[i]];
    n += v < prev ? -v : v;
    prev = Math.max(prev, v);
  }
  return n;
}

function enginePhones(word) {
  const w = String(word).toLowerCase().replace(/’/g, "'");
  for (const src of [CTX, ISO, VOCAB]) {
    const v = src[w];
    if (v && v.length) return v.slice();
  }
  return null;
}

function letterToken(letters) {
  const names = [];
  for (let k = 0; k < letters.length; k++) {
    if (k) names.push('-');
    const ch = letters[k].toLowerCase();
    const ph = ISO[ch] || enginePhones(ch) || LETTER_RULES[ch] || [];
    for (const x of ph) names.push(x);
  }
  return names;
}

function fallbackPhones(word) {
  const w = String(word).toLowerCase();
  for (const key of [w, w.toUpperCase()]) {
    const cmu = CMU[key] || CMU[w];
    if (cmu) {
      const arr = typeof cmu === 'string' ? cmu.split(/\s+/) : cmu;
      return arr.map(cmuToEngine);
    }
  }
  const out = [];
  for (const ch of w) if (/[a-z]/.test(ch) && LETTER_RULES[ch]) out.push(...LETTER_RULES[ch]);
  return out;
}

function pronWord(word, nextWord, prevWord) {
  const acro = ACRONYMS[word];
  if (acro) return acro.slice();
  const cw = CASE_WORDS[word];
  if (cw) return cw.slice();
  const w = String(word).toLowerCase().replace(/’/g, "'");
  const het = HETERO[w];
  if (het) {
    const pv = String(prevWord || '').toLowerCase();
    if (w === 'read' && het.past) {
      if (['had', 'has', 'have', 'was', 'were', 'been', 'being', 'is', 'are', 'am'].includes(pv)) return het.past.slice();
    }
    if (w === 'use' && pv && ['is', 'are', 'was', 'were', 'be', 'being', 'am'].includes(pv) && het.noun) {
      return het.noun.slice();
    }
    if (w === 'content') {
      const nxt0 = String(nextWord || '').toLowerCase();
      const modal = ['will', 'would', 'can', 'could', 'should', 'must', 'may', 'might'].includes(pv);
      const pron = ['me', 'you', 'him', 'her', 'us', 'them', 'it'].includes(nxt0);
      if (modal && pron && het.verb) return het.verb.slice();
      if (het.noun) return het.noun.slice();
    }
    if (VERB_PREV.has(pv) && het.verb) return het.verb.slice();
    if (NOUN_PREV.has(pv) && het.noun) return het.noun.slice();
    if (HETERO_NOUN_PREV.has(pv) && het.noun) return het.noun.slice();
  }
  if (w === 'the') {
    const nxt = String(nextWord || '').toLowerCase();
    const nxtPh = nxt ? enginePhones(nxt) : null;
    let isVowel;
    if (nxtPh) {
      const first = nxtPh.filter((x) => x !== '-');
      isVowel = first.length && VOWELS.has(String(first[0]).replace(/[012]$/, ''));
    } else {
      isVowel = nxt ? 'aeiou'.includes(nxt[0]) : false;
    }
    return isVowel ? ['dh', 'ih1'] : ['dh', 'ax1'];
  }
  if (SPECIAL_PHONES[w]) return SPECIAL_PHONES[w].slice();
  const v = enginePhones(w);
  if (v) return v;
  if (w.includes('-')) {
    const parts = w.split('-').filter(Boolean);
    const out = [];
    for (const p of parts) {
      const ph = pronWord(p, '');
      if (out.length) out.push('-');
      for (const x of ph) out.push(x);
    }
    return out;
  }
  if (w.endsWith('s') && w.length > 2) {
    const base = pronWord(w.slice(0, -1), '', '');
    if (base && base.length > 1) {
      const first = String(base[0]).replace(/[012]$/, '');
      const voiceless = ['p', 't', 'k', 'f', 'th'].includes(first);
      return base.concat([voiceless ? 's' : 'z']);
    }
  }
  return withSyllables(fallbackPhones(w));
}

// ---------------- TN ----------------
function timeWords(hh, mm, ampm) {
  const events = cardinalWords(hh).map((w) => ['w', w]);
  if (mm) for (const w of cardinalWords(mm)) events.push(['w', w]);
  if (ampm) {
    const ap = ampm.toLowerCase().startsWith('a') ? 'a' : 'p';
    events.push(['phones', letterToken(ap)]);
    events.push(['phones', letterToken('m')]);
  } else if (mm === 0) {
    events.push(['phones', SPECIAL_PHONES["o'clock"].slice()]);
  }
  return events;
}

function fractionWords(num, den) {
  if (den === 2 && num === 1) return ['one', 'half'];
  const d = DENOM[den] || ordinalWords(den).slice(-1)[0];
  if (num === den) return cardinalWords(num).concat([d + 's']);
  if (num === 1) return ['one', d];
  return cardinalWords(num).concat([d + 's']);
}

const NUM_PATTERNS = [
  ['phone', /\+\d{1,3}(?:[-.]\d{2,4}){2,}/],
  ['phone', /\(\d{3}\)\s*\d{3}[-.]\d{4}/],
  ['phone', /\d{3}[-.]\d{3}[-.]\d{4}/],
  ['phone', /\d{3}[-.]\d{4}(?![\d])/],
  ['ip', /\d{1,3}(?:\.\d{1,3}){3}/],
  ['date', /\d{4}-\d{1,2}-\d{1,2}/],
  ['date', /\d{1,2}\/\d{1,2}\/\d{2,4}/],
  ['time', /\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm])?/],
  ['time', /\d{1,2}\s?(?:[AaPp]\.?[Mm])(?![A-Za-z])/],
  ['alnum', /\d{2,4}-[A-Za-z]{2,4}-\d{2,4}/],
  ['ratio', /\d{1,2}:\d{1}/],
  ['version', /\d+\.\d+(?:\.\d+)+/],
  ['ordinal', /\d+(?:st|nd|rd|th)\b/],
  ['decimal', /\d*\.\d+/],
  ['thousands', /\d{1,3}(?:,\d{3})+(?:\.\d+)?/],
  ['dashgroup', /\d{2}(?:-[0-9A-Za-z]{2}){2,}/],
  ['range', /\d+(?:-\d+)+/],
  ['mixed', /\d+\s+\d+\s*\/\s*\d+/],
  ['fraction', /\d+\s*\/\s*\d+/],
  ['percent', /\d+(?:\.\d+)?%/],
  ['currency', /[$€£¥￥]\s*\d[\d,]*(?:\.\d+)?/],
  ['number', /\d+/],
];
const WORD_RE = /[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*(?:['’][A-Za-z]+)*(?:-[A-Za-z0-9]+)*/;
const DOT_ABBR_RE = /(?:[A-Za-z]\.){2,}/;
const ABBR_CONSUME = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'prof', 'jr', 'sr', 'vs',
  'etc', 'capt', 'col', 'no', 'inc', 'ltd', 'co', 'mt', 'saint']);

function matchNumber(text, i) {
  const sub = text.slice(i);
  for (const [kind, re] of NUM_PATTERNS) {
    const m = re.exec(sub);
    if (m && m.index === 0) return [kind, m[0], i + m[0].length];
  }
  return [null, null, i];
}

function phoneWords(text) {
  const clean = text.replace(/[()]/g, ' ');
  const parts = clean.split(/[-.\s]+/).map((x) => x.trim().replace(/^\+/, '')).filter(Boolean);
  const groups = [], letters = [];
  for (const part of parts) {
    const digitsOnly = part.replace(/\D/g, '');
    if (digitsOnly) groups.push(digitsOnly); else letters.push(part);
  }
  const events = [];
  groups.forEach((g, gi) => {
    if (gi) events.push(['pause_plain', null]);
    if (g.length === 3 && g[0] >= '8' && g.slice(1) === '00') {
      events.push(['w', ONES[Number(g[0])]], ['w', 'hundred']);
    } else {
      for (const w of digitsWords(g)) events.push(['w', w]);
    }
  });
  for (const part of letters) {
    const ev = letterToken(part.toLowerCase());
    if (ev.length) events.push(['phones', ev]);
  }
  return events;
}

function unitWords(unit) {
  const u = String(unit).toLowerCase().replace(/\.+$/, '');
  return UNITS[u] || null;
}

function parse(text) {
  const events = [];
  const n = text.length;
  let i = 0, lastWord = '';
  while (i < n) {
    const ch = text[i];
    if (' \t\r\n'.includes(ch)) { i++; continue; }
    const [kind, tok, j] = matchNumber(text, i);
    if (kind) {
      if (kind === 'currency') events.push(['currency', [tok[0], tok.slice(1).trim()]]);
      else if (kind === 'date') events.push(['date', tok]);
      else if (kind === 'time') events.push(['time', tok]);
      else if (kind === 'ratio') events.push(['ratio', tok]);
      else if (kind === 'percent') { events.push(['number', tok.slice(0, -1)]); events.push(['percent', null]); }
      else if (kind === 'ordinal') events.push(['ordinal', tok]);
      else if (kind === 'phone') events.push(['phone', tok]);
      else if (kind === 'ip') events.push(['ip', tok]);
      else if (kind === 'alnum') events.push(['alnum', tok]);
      else if (kind === 'fraction') events.push(['fraction', tok]);
      else if (kind === 'groupnum') events.push(['groupnum', tok]);
      else if (kind === 'mixed') events.push(['mixed', tok]);
      else if (kind === 'dashgroup') events.push(['dashgroup', tok]);
      else if (['decimal', 'thousands', 'version', 'range'].includes(kind)) events.push([kind, tok]);
      else events.push(['number', tok]);
      i = j; continue;
    }
    const dotM = DOT_ABBR_RE.exec(text.slice(i));
    if (dotM && dotM.index === 0) {
      events.push(['dotted', dotM[0]]); i += dotM[0].length; continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      const m = WORD_RE.exec(text.slice(i));
      if (m && m.index === 0) {
        const w = m[0]; i += w.length;
        if ('_' in {} && false) { /* noop */ }
        if (w.includes('_') && w.split('_').some((s) => /^[0-9]+$/.test(s))) {
          const segs = w.split('_').filter(Boolean);
          segs.forEach((seg, si) => {
            if (si) events.push(['w', 'underscore']);
            if (/^[0-9]+$/.test(seg)) events.push(['number', seg]); else events.push(['word', seg]);
          });
          if (i < n && text[i] === '.' && i + 1 < n && /[A-Za-z0-9]/.test(text[i + 1])) {
            events.push(['w', 'dot']); i += 1;
          }
          lastWord = w.toLowerCase(); continue;
        }
        const an = /^([A-Za-z]+)(\d+)$/.exec(w);
        if (an) {
          if (an[1].length > 1 && an[1] === an[1].toUpperCase()) events.push(['acronym', an[1]]);
          else events.push(['letters', an[1]]);
          if (an[2].length === 3) events.push(['groupnum', an[2]]);
          else events.push(['number', an[2]]);
          lastWord = w.toLowerCase(); continue;
        }
        if (i < n && text[i] === '.' && i + 1 < n && /[A-Za-z0-9]/.test(text[i + 1])) {
          events.push(['word', w]);
          events.push(['w', 'dot']);
          i += 1; lastWord = 'dot'; continue;
        }
        if (w.length === 1 && /[A-Z]/.test(w)) {
          let j2 = i;
          while (j2 < n && text[j2] === ' ') j2++;
          if (j2 < n && !/[A-Za-z0-9.]/.test(text[j2])) {
            events.push(['letters', w]);
            lastWord = w.toLowerCase(); continue;
          }
        }
        if (i < n && text[i] === '.') {
          const low = w.toLowerCase();
          if (low === 'no') { events.push(['w', 'number']); i += 1; lastWord = 'number'; continue; }
          if (CNT_WORDS.has(low)) { events.push(['word', w]); lastWord = low; continue; }
          if (ABBR_CONSUME.has(low)) {
            events.push(['word', w]); i += 1;
            if (i >= n || !text.slice(i).trim()) events.push(['end', 'punc.']);
            lastWord = low; continue;
          }
          if (w.length === 1 && /[A-Z]/.test(w)) {
            if (CNT_WORDS.has(lastWord)) { events.push(['word', w]); lastWord = low; continue; }
            events.push(['letters', w]);
            if (i + 2 < n && ',;'.includes(text[i + 1])) {
              events.push(['pause', 'punc.']);
              i += 2; lastWord = low; continue;
            }
            if (i + 1 >= n || text[i + 1] === ' ') events.push(['end', 'punc.']);
            i += 1; lastWord = low; continue;
          }
          events.push(['word', w]); lastWord = low; continue;
        }
        events.push(['word', w]); lastWord = w.toLowerCase(); continue;
      }
    }
    if ('-–—'.includes(ch) && events.length && events[events.length - 1][0] === 'word'
        && i > 0 && !' \t'.includes(text[i - 1])) {
      let k = i;
      while (k < n && '-–—'.includes(text[k])) k++;
      const m2 = WORD_RE.exec(text.slice(k));
      if (m2 && m2.index === 0) {
        const prev = events[events.length - 1][1];
        events[events.length - 1] = ['word', prev + '-' + m2[0]];
        i = k + m2[0].length; continue;
      }
      i = k; continue;
    }
    if (ch === '-' && i + 1 < n && /[0-9]/.test(text[i + 1])
        && (i === 0 || ' \t\n'.includes(text[i - 1]))) {
      events.push(['minus', null]); i += 1; continue;
    }
    if (END_PUNCT[ch]) {
      if (ch === '.') {
        let run = 0;
        while (i + run < n && text[i + run] === '.') run++;
        if (run >= 2) {
          events.push(['end', 'punc.']);
          events.push(['punc_after_end', 'punc.']);
          i += run;
          continue;
        }
        const nxt = i + 1 < n ? text[i + 1] : '';
        if (nxt && !/\s/.test(nxt) && !')]'.includes(nxt)) {
          if (/[A-Za-z0-9]/.test(nxt)) { i += 1; continue; }
          events.push([nxt === '_' ? 'pause_br1' : 'pause', 'punc.']);
          i += 1;
          continue;
        }
      }
      events.push(['end', END_PUNCT[ch]]);
      if (i + 1 < n && BQUOTE.has(text[i + 1])) {
        events.push(['quote_after_end', 'punc.']);
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === ')' || ch === ']') {
      let j2 = i + 1;
      while (j2 < n && ')]'.includes(text[j2])) j2++;
      if (j2 < n && text[j2] === ':') { i = j2 + 1; continue; }
      const lastEv = events.length ? events[events.length - 1] : null;
      if (lastEv && (lastEv[0] === 'end' || lastEv[0] === 'punc_after_end')) {
        events.push(['punc_after_end', 'punc.']);
        i = j2;
        continue;
      }
      const rest2 = text.slice(j2).replace(/^\s+/, '');
      if (!rest2 || '.!?'.includes(rest2[0])) {
        events.push(['end', 'punc.']);
        i = j2;
        continue;
      }
    }
    if (ch in PAUSE_PUNCT) {
      if (ch === ':' && i + 1 < n && '-–—'.includes(text[i + 1])) {
        events.push(['br1_br0', null]);
        i += 1;
        continue;
      }
      if (ch === ':') {
        let j3 = i + 1;
        while (j3 < n && text[j3] === ' ') j3++;
        if (j3 < n && text[j3] === '[') {
          events.push(['pause', 'punc,']);
          i += 1;
          continue;
        }
      }
      if (ch === ',' && i + 1 < n && '-–—'.includes(text[i + 1])) {
        events.push(['pause_br1', 'punc,']);
        i += 1;
        continue;
      }
      events.push(['pause', PAUSE_PUNCT[ch]]);
      i += 1;
      continue;
    }
    if (ch === '&') { events.push(['phones', STRONG_AND.slice()]); i += 1; continue; }
    if (ch === '×') { events.push(['w', 'times']); i += 1; continue; }
    if (ch === '÷') {
      events.push(['phones', ['d', 'ih', '-', 'v', 'ay1', '-', 'd', 'ih', 'd', '-', 'b', 'ay2']]);
      i += 1; continue;
    }
    if (ch === '/') { events.push(['slash', null]); i += 1; continue; }
    if (ch === '=') { events.push(['phones', ['iy1', '-', 'k', 'w', 'ax', 'l', 'z']]); i += 1; continue; }
    if (ch === '@') { events.push(['w', 'at']); i += 1; continue; }
    if (ch === '"') { events.push(['br2', null]); i += 1; continue; }
    if (ch === "'") { i += 1; continue; }
    if (ch === '\\') { i += 1; continue; }
    if (SYMBOL_WORDS[ch] !== undefined) {
      const word = SYMBOL_WORDS[ch];
      if (word) events.push(['w', word]);
      i += 1; continue;
    }
    i += 1;
  }
  return events;
}

function expandNumberToken(tok, kind, outWords) {
  const out_words = outWords || [];
  const t = tok.replace(/,/g, '');
  if (kind === 'date') {
    let parts = t.split(/[/.-]/).map(Number);
    let mm, dd, yy;
    if (t.includes('/')) { [mm, dd, yy] = parts; }
    else { [yy, mm, dd] = parts; }
    if (yy < 100) yy += yy < 30 ? 2000 : 1900;
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const words = [MONTH_NAMES[mm - 1]].concat(ordinalWords(dd));
      const events = words.map((w) => ['w', w]);
      events.push(['pause_plain', null]);
      for (const w of yearWords(yy)) events.push(['w', w]);
      return events;
    }
    return digitsWords(t.replace(/\D/g, '')).map((w) => ['w', w]);
  }
  if (kind === 'time') {
    let m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s?([AaPp])\.?[Mm])?/.exec(tok);
    if (m) {
      const hh = Number(m[1]), mm = Number(m[2]);
      const rawAp = (m[4] || '').toLowerCase();
      const ampm = rawAp ? (rawAp.startsWith('a') ? 'am' : 'pm') : null;
      if (m[3]) {
        return cardinalWords(hh).concat(cardinalWords(mm), cardinalWords(Number(m[3])))
          .map((w) => ['w', w]);
      }
      return timeWords(hh, mm, ampm);
    }
    m = /^(\d{1,2})\s?(?:([AaPp])\.?[Mm])/.exec(tok);
    if (m) {
      const ap = (m[2] || '').toLowerCase().startsWith('a') ? 'am' : 'pm';
      return timeWords(Number(m[1]), 0, ap);
    }
    return [];
  }
  if (kind === 'ratio') {
    const [hh, mm] = t.split(':');
    return cardinalWords(Number(hh)).concat(['to'], cardinalWords(Number(mm))).map((w) => ['w', w]);
  }
  if (kind === 'version') {
    const parts = t.split('.');
    const ev = cardinalWords(Number(parts[0])).map((w) => ['w', w]);
    for (const p of parts.slice(1)) {
      ev.push(['w', 'point']);
      for (const w of digitsWords(p)) ev.push(['w', w]);
    }
    return ev;
  }
  if (kind === 'ordinal') {
    return ordinalWords(Number(/^\d+/.exec(tok)[0])).map((w) => ['w', w]);
  }
  if (kind === 'decimal') {
    let a, b;
    if (t.startsWith('.')) { a = ''; b = t.slice(1); } else { [a, b] = t.split('.'); }
    const ev = [];
    if (a) for (const w of cardinalWords(Number(a))) ev.push(['w', w]);
    ev.push(['w', 'point']);
    for (const w of digitsWords(b)) ev.push(['w', w]);
    return ev;
  }
  if (kind === 'range') {
    const [a, b] = t.split('-');
    return cardinalWords(Number(a)).concat(['to'], cardinalWords(Number(b))).map((w) => ['w', w]);
  }
  if (kind === 'phone') return phoneWords(tok);
  if (kind === 'alnum') {
    const out = [];
    for (const p of tok.split('-')) {
      if (/^[0-9]+$/.test(p)) {
        if (p.length === 3) {
          const n = Number(p);
          out.push(['w', ONES[Number(p[0])]]);
          if (n % 100 >= 10) for (const w of cardinalWords(n % 100)) out.push(['w', w]);
        } else for (const w of digitsWords(p)) out.push(['w', w]);
      } else if (p.length > 1 && p === p.toUpperCase()) out.push(['phones', acronymPhones(p)]); else out.push(['phones', letterToken(p.toLowerCase())]);
    }
    return out;
  }
  if (kind === 'groupnum') {
    const n = Number(tok);
    const first = ONES[Number(tok[0])];
    const rest = n % 100;
    if (rest >= 10) return [['w', first]].concat(cardinalWords(rest).map((w) => ['w', w]));
    return cardinalWords(n).map((w) => ['w', w]);
  }
  if (kind === 'fraction') {
    const [a, b] = t.split(/\s*\/\s*/);
    return fractionWords(Number(a), Number(b)).map((w) => ['w', w]);
  }
  if (kind === 'mixed') {
    const m = /^(\d+)\s+(\d+)\s*\/\s*(\d+)/.exec(tok);
    const words = cardinalWords(Number(m[1])).concat(['and'], fractionWords(Number(m[2]), Number(m[3])));
    return words.map((w) => ['w', w]);
  }
  if (kind === 'ip') {
    const parts = t.split('.');
    const ev = [];
    parts.forEach((part, pi) => {
      if (pi) ev.push(['w', 'dot']);
      for (const w of digitsWords(part)) ev.push(['w', w]);
    });
    return ev;
  }
  if (kind === 'dashgroup') {
    const ev = [];
    const parts = tok.split('-').filter(Boolean);
    for (const ch of parts[0]) {
      if (/[0-9]/.test(ch)) ev.push(['w', ONES[Number(ch)]]);
      else ev.push(['phones', letterToken(ch.toLowerCase())]);
    }
    ev.push(['w', 'dash']);
    for (let pi = 1; pi < parts.length; pi++) {
      for (const ch of parts[pi]) {
        if (/[0-9]/.test(ch)) ev.push(['w', ONES[Number(ch)]]);
        else ev.push(['phones', letterToken(ch.toLowerCase())]);
      }
    }
    return ev;
  }
  const nn = Number(t);
  if (kind === 'number' && t.length === 4 && nn >= 1000 && nn <= 2099) {
    const prevWords = outWords.slice(-2);
    if (prevWords.includes('year')) return yearWords(nn).map((w) => ['w', w]);
  }
  if (kind === 'number' && t.length === 4 && nn >= 2000 && nn <= 2099) {
    return yearWords(nn).map((w) => ['w', w]);
  }
  if (kind === 'thousands' || t.length > 3) {
    return cardinalWords(nn).map((w) => ['w', w]);
  }
  return cardinalWords(nn).map((w) => ['w', w]);
}

function expand(events) {
  const out = [];
  for (let idx = 0; idx < events.length; idx++) {
    const [kind, val] = events[idx];
    const nxt = idx + 1 < events.length ? events[idx + 1] : null;
    if (kind === 'ordinal' && nxt && nxt[0] === 'word' && MONTH_NAMES.includes(String(nxt[1]).toLowerCase())) {
      out.push(['w', nxt[1]]);
      const m0 = /^(\d+)/.exec(val);
      for (const w of ordinalWords(Number(m0[1]))) out.push(['w', w]);
      events[idx + 1] = ['consumed', null];
      continue;
    }
    if (kind === 'word' && MONTH_NAMES.includes(String(val).toLowerCase())
        && nxt && (nxt[0] === 'number' || nxt[0] === 'ordinal')) {
      const day = Number(/^\d+/.exec(nxt[1])[0]);
      if (day >= 1 && day <= 31) {
        out.push(['w', val]);
        for (const w of ordinalWords(day)) out.push(['w', w]);
        events[idx + 1] = ['consumed', null];
        const nxt2 = idx + 2 < events.length ? events[idx + 2] : null;
        if (nxt2 && nxt2[0] === 'pause' && nxt2[1] === 'punc,') events[idx + 2] = ['pause_plain', null];
        continue;
      }
    }
    if (['number', 'date', 'time', 'ratio', 'version', 'ordinal', 'decimal',
      'thousands', 'range', 'phone', 'alnum', 'fraction', 'mixed', 'ip', 'dashgroup', 'groupnum'].includes(kind)) {
      const ev = expandNumberToken(val, kind, out.filter((x) => x[0] === 'w' || x[0] === 'word').map((x) => x[1]));
      for (const e of ev) out.push(e);
      if (nxt && nxt[0] === 'word') {
        let rawU = nxt[1];
        let uw = unitWords(rawU);
        if (String(rawU).toLowerCase() === 'm') {
          const prevWords = out.filter((x) => x[0] === 'w').slice(-4).map((x) => x[1]).join(' ');
          uw = (prevWords.includes('hour') || prevWords.includes('hours')) ? ['minutes'] : null;
        }
        if (uw && ['number', 'decimal', 'thousands', 'version'].includes(kind)) {
          let lastNum = null;
          try { lastNum = parseFloat(val.replace(/[^0-9.]/g, '')); } catch (e) { lastNum = null; }
          const words = uw.slice();
          if (lastNum === 1 && UNIT_SINGULAR[words[0]]) words[0] = UNIT_SINGULAR[words[0]];
          for (const w of words) out.push(['w', w]);
          events[idx + 1] = ['consumed', null];
        }
      }
    } else if (kind === 'currency') {
      const [sym, num] = val;
      const cur = CURRENCY[sym] || CURRENCY['$'];
      const major = cur[0], minor = cur[1];
      if (num.includes('.')) {
        const [a0, b0] = num.split('.');
        const majorN = Number((a0 || '0').replace(/,/g, ''));
        const cents = Number((b0 + '00').slice(0, 2));
        const words = [];
        if (majorN || !cents) { for (const w of cardinalWords(majorN)) words.push(w); words.push(plural(majorN, major)); }
        if (cents) {
          if (majorN) words.push('and');
          for (const w of cardinalWords(cents)) words.push(w);
          words.push(plural(cents, minor));
        }
        for (const w of words) out.push(['w', w]);
      } else {
        const nn = Number(num.replace(/,/g, ''));
        if ((sym === '¥' || sym === '￥') && nn) {
          for (const w of cardinalWords(nn)) out.push(['w', w]);
          out.push(['phones', ['y', 'uw', '-', 'aa1', 'n']]);
        } else {
          for (const w of cardinalWords(nn)) out.push(['w', w]);
          out.push(['w', plural(nn, major)]);
        }
      }
    } else if (kind === 'percent') {
      if (out.length) out.push(['w', 'percent']);
    } else if (kind === 'word') {
      if (String(val).toLowerCase() === 'www') {
        for (const ch of 'www') out.push(['phones', letterToken(ch)]);
      } else out.push(['word', val]);
    } else if (kind === 'letters') {
      out.push(['phones', letterToken(String(val).toLowerCase())]);
    } else if (kind === 'acronym') {
      out.push(['phones', acronymPhones(String(val))]);
    } else if (kind === 'dotted') {
      const letters = String(val).toLowerCase().split('').filter((c) => /[a-z]/.test(c)).join('');
      out.push(['phones', letterToken(letters)]);
    } else if (kind === 'minus') {
      out.push(['w', 'minus']);
    } else if (kind === 'slash') {
      out.push(['w', 'slash']);
    } else if (kind === 'w') {
      out.push(['w', val]);
    } else if (kind === 'phones') {
      out.push(['phones', val.slice()]);
    } else if (kind === 'br2') {
      out.push(['br2', null]);
    } else if (kind === 'pause_plain') {
      out.push(['pause_plain', null]);
    } else if (kind === 'pause_br1') {
      out.push(['pause_br1', val]);
    } else if (kind === 'br1_br0') {
      out.push(['br1_br0', null]);
    } else if (kind === 'pause') {
      out.push(['pause', val]);
    } else if (kind === 'end') {
      out.push(['end', val]);
    } else if (kind === 'punc_after_end') {
      out.push(['punc_after_end', val]);
    } else if (kind === 'quote_after_end') {
      out.push(['quote_after_end', val]);
    }
  }
  return out;
}

function wordExpansion(w, prevWord) {
  if (w === 'I' && ['chapter', 'part', 'section', 'book', 'volume', 'act', 'scene', 'article', 'appendix'].includes(prevWord)) {
    return cardinalWords(1);
  }
  if (isRoman(w)) {
    const n = romanValue(w);
    if (w.length === 1 && !CNT_WORDS.has(prevWord)) return [w];
    if (n > 0 && n < 4000) return cardinalWords(n);
  }
  return [w];
}

function flatten(events) {
  const flat = [];
  let prevWord = '', prevWasName = false;
  for (const [kind, val] of events) {
    if (['pause', 'pause_plain', 'end', 'br2', 'pause_br1'].includes(kind)) {
      prevWord = ''; prevWasName = false; flat.push([kind, val]); continue;
    }
    if (kind === 'word') {
      const w = String(val);
      const exp = wordExpansion(w, prevWord);
      if (isRoman(w) && w.length > 1 && prevWasName && !CNT_WORDS.has(prevWord)) {
        const n = romanValue(w);
        if (n > 0 && n < 4000) {
          const ordw = ordinalWords(n).slice(-1)[0];
          const ph = ['dh', 'ih1', '-'].concat(pronWord(ordw, '').filter((x) => x !== '-'));
          flat.push(['phones', ph]);
          prevWord = w.toLowerCase(); prevWasName = false; continue;
        }
      }
      for (const x of exp) flat.push(['w', x]);
      prevWord = w.toLowerCase();
      prevWasName = /^[A-Z]/.test(w);
      continue;
    }
    if (kind === 'w') flat.push(['w', val]);
    else flat.push([kind, val]);
  }
  return flat;
}

function preprocess(text) {
  text = text.replace(/°\s*C\b/gi, ' degrees celsius');
  text = text.replace(/°\s*F\b/gi, ' degrees fahrenheit');
  text = text.replace(/°/g, ' degrees');
  text = text.replace(/(\d+)\s*'\s*(\d+)?\s*"/g, (m, ft, inch) => ft + ' feet' + (inch ? ' ' + inch + ' inches' : ''));
  return text;
}

function textToIds(text, sym) {
  text = preprocess(String(text || ''));
  const raw = parse(text);
  const ev = expand(raw);
  const flat = flatten(ev);
  const ids = [sym[BOS]];
  if (sym['br0'] !== undefined) ids.push(sym['br0']);
  let first = true, ended = false;
  for (let i = 0; i < flat.length; i++) {
    const item = flat[i];
    const kind = item[0];
    if (kind === 'w') {
      const w = item[1];
      let nxt = '';
      let j = i + 1;
      while (j < flat.length && flat[j][0] !== 'w') j++;
      if (j < flat.length) nxt = flat[j][1];
      let prevW = i > 0 && flat[i - 1][0] === 'w' ? flat[i - 1][1] : '';
      if (['not', 'never', 'always', 'only', 'also', 'just', 'still'].includes(String(prevW).toLowerCase())) {
        let j2 = i - 2;
        while (j2 >= 0 && flat[j2][0] !== 'w') j2--;
        if (j2 >= 0) prevW = flat[j2][1];
      }
      let phones = pronWord(w, nxt, prevW);
      const wl = String(w).toLowerCase();
      const afterKind = i + 1 < flat.length ? flat[i + 1][0] : 'end';
      const afterW = i + 1 < flat.length && flat[i + 1][0] === 'w' ? flat[i + 1][1] : '';
      if (wl === 'for') {
        const prevPause = first || (i > 0 && (flat[i - 1][0] === 'pause' || flat[i - 1][0] === 'pause_plain'));
        if (prevPause || afterW === 'underscore' || afterW === 'asterisk' || afterKind === 'br2'
            || ['end', 'pause', 'pause_plain'].includes(afterKind)) {
          phones = STRONG_FOR.slice();
        }
      } else if (wl === 'and') {
        if (['pause', 'pause_plain', 'end', 'br2'].includes(afterKind)
            || afterW === 'underscore' || afterW === 'asterisk') {
          phones = STRONG_AND.slice();
        }
      }
      const needBr1 = !first && !(i > 0 && flat[i - 1][0] === 'br2');
      if (needBr1 && sym['br1'] !== undefined) ids.push(sym['br1']);
      for (const ph of phones) {
        if (ph === '-') ids.push(sym['-'] !== undefined ? sym['-'] : 0);
        else ids.push(sym[ph] !== undefined ? sym[ph] : (sym['<pad>'] !== undefined ? sym['<pad>'] : 0));
      }
      first = false;
    } else if (kind === 'pause_plain') {
      ids.push(sym['br3']);
      first = true;
    } else if (kind === 'pause_br1') {
      ids.push(sym['br1']);
      ids.push(item[1] && sym[item[1]] !== undefined ? sym[item[1]] : (sym['punc.'] || 0));
      ids.push(sym['br0'] !== undefined ? sym['br0'] : 0);
      first = true;
    } else if (kind === 'br1_br0') {
      ids.push(sym['br1']);
      ids.push(sym['br0'] !== undefined ? sym['br0'] : 0);
      first = true;
    } else if (kind === 'pause') {
      if (first) continue;
      ids.push(sym['br3']);
      if (item[1] && sym[item[1]] !== undefined) ids.push(sym[item[1]]);
      if (sym['br0'] !== undefined) ids.push(sym['br0']);
      first = true;
    } else if (kind === 'end') {
      if (ended) {
        ids.push(item[1] && sym[item[1]] !== undefined ? sym[item[1]] : (sym['punc.'] || 0));
        continue;
      }
      ids.push(sym['br4']);
      if (item[1] && sym[item[1]] !== undefined) ids.push(sym[item[1]]);
      else if (sym['punc.'] !== undefined) ids.push(sym['punc.']);
      ended = true;
      first = true;
    } else if (kind === 'punc_after_end') {
      ids.push(item[1] && sym[item[1]] !== undefined ? sym[item[1]] : (sym['punc.'] || 0));
      continue;
    } else if (kind === 'quote_after_end') {
      ids.push(sym['br0'] !== undefined ? sym['br0'] : 0);
      ids.push(item[1] && sym[item[1]] !== undefined ? sym[item[1]] : (sym['punc.'] || 0));
      continue;
    } else if (kind === 'br2') {
      if (sym['br2'] !== undefined) ids.push(sym['br2']);
    } else if (kind === 'phones') {
      const needBr1 = !first && !(i > 0 && flat[i - 1][0] === 'br2');
      if (needBr1 && sym['br1'] !== undefined) ids.push(sym['br1']);
      for (const ph of item[1]) {
        if (ph === '-') ids.push(sym['-'] !== undefined ? sym['-'] : 0);
        else ids.push(sym[ph] !== undefined ? sym[ph] : (sym['<pad>'] !== undefined ? sym['<pad>'] : 0));
      }
      first = false;
    }
  }
  if (!ended) {
    ids.push(sym['br4']);
    if (sym['punc.'] !== undefined) ids.push(sym['punc.']);
  }
  ids.push(sym[END]);
  return ids;
}

module.exports = { textToIds };
