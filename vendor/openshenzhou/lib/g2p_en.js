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
const VARIANT_LEX = {};
function loadVariantLexicon(variant) {
  if (variant !== 'gb' && variant !== 'in') return null;
  if (VARIANT_LEX[variant]) return VARIANT_LEX[variant];
  const base = {};
  for (const k of Object.keys(ISO)) base[k] = ISO[k];
  const p = path.join(DATA, 'lexicon_en_' + variant + '.json');
  if (fs.existsSync(p)) {
    const extra = loadJson(p, {});
    for (const k of Object.keys(extra)) base[k] = extra[k];
  }
  VARIANT_LEX[variant] = base;
  return base;
}
let ACTIVE_LEX = null;
let ACTIVE_VARIANT = '';
const VARIANT_FUNCTION_WORDS = new Set(('a an the and of to for in on at by with from as or but not no so ' +
  'do does did has have had is are was were be been am being i you he she we they it me him her us them ' +
  'my your his its our their this that these those there here who what which when where why how ' +
  'will would can could shall should may might must').split(' '));
const ALIAS_IN = { w: 'vw', v: 'vw', d: 'dr', t: 'tr', er: 'ah', dh: 'd', ax: 'ah' };
function symId(sym, ph, variant) {
  const direct = sym[ph];
  if (direct !== undefined) return direct;
  const base = String(ph || '').replace(/[012]+$/, '');
  if (variant === 'in') {
    const alt = ALIAS_IN[base];
    if (alt !== undefined && sym[alt] !== undefined) return sym[alt];
    if (sym[base] !== undefined) return sym[base];
  } else if (variant === 'gb') {
    if (sym[base] !== undefined) return sym[base];
  }
  return sym['<pad>'] !== undefined ? sym['<pad>'] : 0;
}

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
  'his', 'her', 'its', 'our', 'their', 'no', 'every', 'each', 'any', 'some',
  'good', 'better', 'best', 'great', 'full', 'own', 'such', 'same', 'what',
  'whatever', 'little', 'much', 'more', 'most', 'only', 'common',
  'practical', 'proper', 'right', 'wrong']);
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
const MONTH_ABBR = { jan: 'january', feb: 'february', mar: 'march', apr: 'april', jun: 'june', jul: 'july', aug: 'august', sep: 'september', sept: 'september', oct: 'october', nov: 'november', dec: 'december' };
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
  caret: ['k', 'eh1', '-', 'r', 'ax', 't'],
  underscore: ['ah2', 'n', '-', 'd', 'ax', 'r', '-', 's', 'k', 'ao1', 'r'],
  asterisk: ['ae1', '-', 's', 't', 'ax', '-', 'r', 'ih', 's', 'k'],
  "o'clock": ['ax', '-', 'k', 'l', 'aa1', 'k'],
  covid: ['k', 'ah1', '-', 'v', 'ih', 'd'],
};
const SYMBOL_WORDS = { '*': 'asterisk', _: 'underscore', '#': 'number', '@': 'at',
  '+': 'plus', '<': 'less', '>': 'greater', '^': 'caret', '~': null, '|': 'bar' };
const STRONG_AND = ['ae1', 'n', 'd'];
const STRONG_FOR = ['f', 'ao1', 'r'];
const PAUSE_PUNCT = { ',': 'punc,', ';': 'punc;', ':': null, '(': 'punc,',
  ')': 'punc,', '[': 'punc,', ']': 'punc,', '{': 'punc,', '}': 'punc,' };
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
    const w = [ONES[q], 'hundred'];
    if (r) w.push(...(r < 100 ? ['and'] : []), ...ordinalWords(r));
    else w[w.length - 1] = 'hundredth';
    return w;
  }
  const base = cardinalWords(n);
  if (n % 100 === 0) return base.slice(0, -1).concat([base[base.length - 1] + 'th']);
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
  if (ACTIVE_LEX && ACTIVE_LEX[w] && ACTIVE_LEX[w].length) return ACTIVE_LEX[w].slice();
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

const CONTRACTIONS = {
  "don't": ['d', 'ow1', 'n', 't'], "can't": ['k', 'ae1', 'n', 't'],
  "won't": ['w', 'ow1', 'n', 't'], "shan't": ['sh', 'ae1', 'n', 't'],
  "ain't": ['ey1', 'n', 't'],
  "isn't": ['ih1', 'z', 'ax', 'n', 't'], "aren't": ['aa1', 'r', 'n', 't'],
  "wasn't": ['w', 'ah1', 'z', 'ax', 'n', 't'], "weren't": ['w', 'er1', 'n', 't'],
  "doesn't": ['d', 'ah1', 'z', 'ax', 'n', 't'], "didn't": ['d', 'ih1', 'd', 'ax', 'n', 't'],
  "couldn't": ['k', 'uh1', 'd', 'ax', 'n', 't'], "shouldn't": ['sh', 'uh1', 'd', 'ax', 'n', 't'],
  "wouldn't": ['w', 'uh1', 'd', 'ax', 'n', 't'], "mustn't": ['m', 'ah1', 's', 'ax', 'n', 't'],
  "needn't": ['n', 'iy1', 'd', 'ax', 'n', 't'],
  "it's": ['ih1', 't', 's'], "that's": ['dh', 'ae1', 't', 's'],
  "what's": ['w', 'ah1', 't', 's'], "let's": ['l', 'eh1', 't', 's'],
  "he's": ['h', 'iy1', 'z'], "she's": ['sh', 'iy1', 'z'],
  "there's": ['dh', 'eh1', 'r', 'z'], "here's": ['hh', 'ih1', 'r', 'z'],
  "where's": ['w', 'eh1', 'r', 'z'], "who's": ['hh', 'uw1', 'z'],
  "how's": ['hh', 'aw1', 'z'],
  "i'm": ['ay1', 'm'], "i've": ['ay1', 'v'], "i'll": ['ay1', 'l'], "i'd": ['ay1', 'd'],
  "you're": ['y', 'ao1', 'r'], "you've": ['y', 'uw1', 'v'], "you'll": ['y', 'uw1', 'l'], "you'd": ['y', 'uw1', 'd'],
  "we're": ['w', 'iy1', 'r'], "we've": ['w', 'iy1', 'v'], "we'll": ['w', 'iy1', 'l'], "we'd": ['w', 'iy1', 'd'],
  "they're": ['dh', 'ey1', 'r'], "they've": ['dh', 'ey1', 'v'], "they'll": ['dh', 'ey1', 'l'], "they'd": ['dh', 'ey1', 'd'],
  "he'll": ['hh', 'iy1', 'l'], "he'd": ['hh', 'iy1', 'd'],
  "she'll": ['sh', 'iy1', 'l'], "she'd": ['sh', 'iy1', 'd'],
  "it'll": ['ih1', 't', 'ax', 'l'],
  "who'll": ['hh', 'uw1', 'l'], "who'd": ['hh', 'uw1', 'd'], "who've": ['hh', 'uw1', 'v'],
};

const VOICELESS = new Set(['p', 't', 'k', 'f', 'th', 's', 'sh', 'ch', 'hh']);

function contractionPhones(word) {
  const w = String(word).toLowerCase().replace(/’/g, "'");
  if (CONTRACTIONS[w]) return CONTRACTIONS[w].slice();
  if (w.endsWith("n't") && w.length > 3) {
    let base = w.slice(0, -3);
    base = ({ ca: 'can', wo: 'will', sha: 'shall', ai: 'am' })[base] || base;
    return pronWord(base).concat(['n', 't']);
  }
  if (w.endsWith("'s") && w.length > 2) {
    const bp = pronWord(w.slice(0, -2));
    const last = bp.length ? bp[bp.length - 1].replace(/[012]+$/, '') : '';
    return bp.concat([VOICELESS.has(last) ? 's' : 'z']);
  }
  for (const [suf, ph] of [["'ll", 'l'], ["'re", 'r'], ["'ve", 'v'], ["'d", 'd'], ["'m", 'm']]) {
    if (w.endsWith(suf) && w.length > suf.length) return pronWord(w.slice(0, -suf.length)).concat([ph]);
  }
  return null;
}

function pronWord(word, nextWord, prevWord) {
  const acro = ACRONYMS[word];
  if (acro) return acro.slice();
  const cw = CASE_WORDS[word];
  if (cw) return cw.slice();
  if (word.length === 1 && word === word.toUpperCase() && word !== 'I') {
    const nxt = String(nextWord || '').trim();
    if (word === 'A' && nxt && !(nxt.length === 1 && nxt === nxt.toUpperCase())) {
      const ph = enginePhones(nxt.split(/\s+/)[0]);
      const first = (ph || []).filter((x) => x !== '-');
      const isVowel = first.length > 0 && VOWELS.has(first[0].replace(/[012]+$/, ''));
      return isVowel ? ['ey1'] : pronWord('a', nextWord, prevWord);
    }
    return letterToken(word.toLowerCase());
  }
  const w = String(word).toLowerCase().replace(/’/g, "'");
  if (w === 'a') {
    // 引擎实测：孤立小写 a（后接单字母/数字/标点/句末）读字母名 /ey1/
    const nxtA = String(nextWord || '').trim();
    const firstA = nxtA.split(/\s+/)[0] || '';
    if (!nxtA || nxtA.startsWith('punc') || nxtA === 'dot'
        || (firstA.length === 1 && /[A-Za-z]/.test(firstA))
        || /^[0-9]/.test(firstA)) {
      return ['ey1'];
    }
  }
  // en-GB/en-IN 引擎实测词表优先（功能词弱读形式除外，见 Python 版说明）
  if (ACTIVE_LEX && !VARIANT_FUNCTION_WORDS.has(w)) {
    const lv = ACTIVE_LEX[w];
    if (lv && lv.length) return lv.slice();
  }
  if (w.includes("'")) {
    const cph = contractionPhones(w);
    if (cph) return cph;
  }
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
  if (ACTIVE_VARIANT === 'in' && w === 'a') return ['ah'];
  if (ACTIVE_VARIANT === 'gb' && w === 'a') return ['ax'];
  if (ACTIVE_VARIANT === 'in' && w === 'to') return ['tr', 'uw'];
  if (w === 'the') {
    if (ACTIVE_VARIANT === 'in' && ACTIVE_LEX && ACTIVE_LEX['the'] && ACTIVE_LEX['the'].length) {
      return ACTIVE_LEX['the'].slice();
    }
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
  ['date', /\d{4}[./-]\d{1,2}[./-]\d{1,4}/],
  ['date2', /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/],
  ['date', /\d{4}-\d{1,2}-\d{1,2}/],
  ['date', /\d{1,2}\/\d{1,2}\/\d{2,4}/],
  ['time_range', /\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/],
  ['time', /\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm])?/],
  ['time', /\d{1,2}\s?(?:[AaPp]\.?[Mm])(?![A-Za-z])/],
  ['alnum', /\d{2,4}-[A-Za-z]{2,4}-\d{2,4}/],
  ['ratio', /\d{1,2}:\d{1}/],
  ['version', /\d+\.\d+(?:\.\d+)+/],
  ['ordinal', /\d+(?:st|nd|rd|th)\b/],
  ['percent', /\d+(?:\.\d+)?%/],
  ['decimal', /\d*\.\d+/],
  ['ordinal', /\d{1,3}(?:,\d{3})+(?:st|nd|rd|th)/],
  ['thousands', /\d{1,3}(?:,\d{3})+(?:\.\d+)?/],
  ['dashgroup', /\d{2}(?:-[0-9A-Za-z]{2}){2,}/],
  ['range', /\d+(?:-\d+)+/],
  ['mixed', /\d+\s+\d+\s*\/\s*\d+/],
  ['date_ym', /\d{4}\/\d{1,2}/],
  ['date_my', /\d{1,2}\/\d{4}/],
  ['fraction', /\d+\s*\/\s*\d+/],
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
    const urlM = /^(https?):\/\//i.exec(text.slice(i));
    if (urlM) {
      for (const ch2 of urlM[1].toLowerCase()) events.push(['phones', letterToken(ch2)]);
      events.push(['w', 'colon'], ['w', 'slash'], ['w', 'slash']);
      i += urlM[0].length; continue;
    }
    const mailM = /^mailto:/i.exec(text.slice(i));
    if (mailM) { events.push(['word', 'mailto']); i += mailM[0].length; continue; }
    const [kind, tok, j] = matchNumber(text, i);
    if (kind) {
      if (kind === 'currency') events.push(['currency', [tok[0], tok.slice(1).trim()]]);
      else if (kind === 'date' || kind === 'date2') events.push(['date', tok]);
      else if (kind === 'date_my') events.push(['date_my', tok]);
      else if (kind === 'date_ym') events.push(['date_ym', tok]);
      else if (kind === 'time') events.push(['time', tok]);
      else if (kind === 'time_range') events.push(['time_range', tok]);
      else if (kind === 'ratio') events.push(['ratio', tok]);
      else if (kind === 'percent') { const num = tok.slice(0, -1); events.push([num.includes('.') ? 'decimal' : 'number', num]); events.push(['percent', null]); }
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
    const verM = /^v(\d+(?:\.\d+)+)(?:[-–]([A-Za-z0-9]+))?/i.exec(text.slice(i));
    if (verM) {
      events.push(['phones', letterToken('v')]);
      const num = verM[1];
      events.push([num.split('.').length >= 3 ? 'version' : 'decimal', num]);
      if (verM[2]) events.push(['word', verM[2]]);
      i += verM[0].length; continue;
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
            const m_a = /^([A-Za-z]+)(\d+)$/.exec(seg);
            const m_d = /^(\d+)([A-Za-z]+)$/.exec(seg);
            if (/^[0-9]+$/.test(seg)) events.push(['number', seg]);
            else if (m_a) {
              const letters = m_a[1];
              if (enginePhones(letters.toLowerCase()) || letters !== letters.toUpperCase()) events.push(['word', letters]);
              else if (letters.length > 1) events.push(['acronym', letters]);
              else events.push(['letters', letters]);
              events.push(['number', m_a[2]]);
            } else if (m_d) {
              events.push(['number', m_d[1]]);
              const letters = m_d[2];
              if (letters.length > 1 && letters === letters.toUpperCase()) events.push(['acronym', letters]);
              else events.push(['letters', letters]);
            } else events.push(['word', seg]);
          });
          if (i < n && text[i] === '.' && i + 1 < n && /[A-Za-z0-9]/.test(text[i + 1])) {
            events.push(['w', 'dot']); i += 1;
          }
          lastWord = w.toLowerCase(); continue;
        }
        const an3 = /^([A-Za-z]+)(\d+)([A-Za-z]+)$/.exec(w);
        if (an3) {
          const emitGroup = (g) => {
            if (enginePhones(g.toLowerCase()) || g !== g.toUpperCase()) events.push(['word', g]);
            else if (g.length > 1) events.push(['acronym', g]);
            else events.push(['letters', g]);
          };
          emitGroup(an3[1]);
          events.push(['number', an3[2]]);
          emitGroup(an3[3]);
          lastWord = w.toLowerCase(); continue;
        }
        const an = /^([A-Za-z]+)(\d+)$/.exec(w);
        if (an) {
          if (enginePhones(an[1].toLowerCase()) || SPECIAL_PHONES[an[1].toLowerCase()] || an[1] !== an[1].toUpperCase()) events.push(['word', an[1]]);
          else if (an[1].length > 1 && an[1] === an[1].toUpperCase()) events.push(['acronym', an[1]]);
          else events.push(['letters', an[1]]);
          if (an[2].length === 3) events.push(['groupnum', an[2]]);
          else events.push(['number', an[2]]);
          lastWord = w.toLowerCase(); continue;
        }
        if (w.toLowerCase() === 'no' && i < n && text[i] === '.') {
          events.push(['w', 'number']); i += 1; lastWord = 'number'; continue;
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
    if (ch === '…') {
      const restE = text.slice(i + 1).replace(/^\s+/, '');
      events.push([restE ? 'ellipsis_pause' : 'end_ellipsis', 'punc…']);
      i += 1; continue;
    }
    if (END_PUNCT[ch]) {
      if (ch === '.') {
        let run = 0;
        while (i + run < n && text[i + run] === '.') run++;
        if (run >= 2) {
          const restDot = text.slice(i + run).replace(/^\s+/, '');
          // 省略号后紧跟 ?/!（如 "Really...?"）：引擎只出 punc? + punc.
          if ((restDot[0] === '?' || restDot[0] === '!') && restDot.slice(1).replace(/\s+$/g, '').replace(/["'’”“]/g, '') === '') {
            events.push(['end', END_PUNCT[restDot[0]]]);
            events.push(['punc_after_end', 'punc.']);
            i += run + 1;
            continue;
          }
          // 引擎实测句末点串规则：3/6 点 → punc...；2/4/7 点 → punc.；5/8 点 → punc... br0 punc.
          if (run % 3 === 0 || run === 5 || run === 8) events.push([restDot ? 'ellipsis_pause' : 'end_ellipsis', null]);
          else { events.push(['end', 'punc.']); events.push(['punc_after_end', 'punc.']); }
          i += run;
          continue;
        }
        const nxt = i + 1 < n ? text[i + 1] : '';
        if (nxt && BQUOTE.has(nxt)) {
          events.push(['end', 'punc.']);
          events.push(['quote_after_end', 'punc.']);
          i += 2;
          continue;
        }
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
      if (ch === ':' && i + 1 < n && /[\\/]/.test(text[i + 1])) {
        events.push(['pause_plain', null]);
      } else {
        events.push(['pause', PAUSE_PUNCT[ch]]);
      }
      i += 1;
      continue;
    }
    if (ch === '&') { events.push(['phones', STRONG_AND.slice()]); i += 1; continue; }
    if (ch === '×') { events.push(['w', 'times']); i += 1; continue; }
    if (ch === '÷') {
      events.push(['phones', ['d', 'ih', '-', 'v', 'ay1', '-', 'd', 'ih', 'd', '-', 'b', 'ay2']]);
      i += 1; continue;
    }
    if (ch === '–' || ch === '—') {
      const prevKind = events.length ? events[events.length - 1][0] : null;
      let jj = i + 1;
      while (jj < n && text[jj] === ' ') jj++;
      if (['number', 'decimal', 'percent', 'thousands', 'currency'].includes(prevKind)
          && jj < n && /[0-9]/.test(text[jj])) {
        events.push(['w', 'to']);
      } else {
        events.push(['pause', 'punc,']);
      }
      i += 1; continue;
    }
    if (ch === '/') {
      if (i > 0 && i + 1 < n && /[A-Z]/.test(text[i - 1]) && /[A-Z]/.test(text[i + 1])
          && (i < 2 || !/[A-Za-z]/.test(text[i - 2]))
          && (i + 2 >= n || !/[A-Za-z]/.test(text[i + 2]))) {
        i += 1; continue;
      }
      events.push(['slash', null]); i += 1; continue;
    }
    if (ch === '=') { events.push(['phones', ['iy1', '-', 'k', 'w', 'ax', 'l', 'z']]); i += 1; continue; }
    if (ch === '@') { events.push(['w', 'at']); i += 1; continue; }
    if (ch === '"') { i += 1; continue; }
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
  if (kind === 'time_range') {
    const parts = tok.split(/\s*[-–—]\s*/);
    const [h1, m1] = parts[0].split(':').map(Number);
    const [h2, m2] = parts[1].split(':').map(Number);
    const ev = [];
    if (m1 === 0 && m2 === 0) {
      for (const w of cardinalWords(h1)) ev.push(['w', w]);
      ev.push(['w', 'to']);
      for (const w of cardinalWords(h2)) ev.push(['w', w]);
      ev.push(['w', "o'clock"]);
    } else {
      for (const e of timeWords(h1, m1, null)) ev.push(e);
      ev.push(['w', 'to']);
      for (const e of timeWords(h2, m2, null)) ev.push(e);
    }
    return ev;
  }
  if (kind === 'date_ym') {
    const [a1, b1] = tok.split('/');
    const ev = [];
    for (const w of yearWords(Number(a1))) ev.push(['w', w]);
    ev.push(['w', 'slash']);
    for (const w of digitsWords(String(b1).padStart(2, '0'))) ev.push(['w', w]);
    return ev;
  }
  if (kind === 'date_my') {
    const [a1, b1] = tok.split('/');
    const ev = [['w', MONTH_NAMES[Number(a1) - 1]]];
    for (const w of yearWords(Number(b1))) ev.push(['w', w]);
    return ev;
  }
  if (kind === 'date') {
    const sepM = /[/.-]/.exec(tok);
    const sep = sepM ? sepM[0] : '/';
    const parts = tok.split(/[/.-]/);
    const a0 = parts[0], b0 = parts[1], c0 = parts[2];
    const ai = Number(a0), bi = Number(b0), ci = Number(c0);
    if (a0.length === 4) {
      const mo = bi, d = ci, y = ai;
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        const words = [MONTH_NAMES[mo - 1]].concat(ordinalWords(d));
        const events = words.map((w) => ['w', w]);
        events.push(['pause_plain', null]);
        for (const w of yearWords(y)) events.push(['w', w]);
        return events;
      }
    } else if (ai >= 1 && ai <= 12 && bi >= 1 && bi <= 31) {
      const mo = ai, d = bi, y = ci;
      const words = [MONTH_NAMES[mo - 1]].concat(ordinalWords(d));
      const events = words.map((w) => ['w', w]);
      events.push(['pause_plain', null]);
      if (c0.length <= 2) { for (const w of cardinalWords(y)) events.push(['w', w]); }
      else { for (const w of yearWords(y)) events.push(['w', w]); }
      return events;
    }
    const sepWord = sep === '/' ? 'slash' : (sep === '-' ? 'dash' : 'dot');
    const ev = cardinalWords(ai).map((w) => ['w', w]);
    ev.push(['w', sepWord]);
    for (const w of cardinalWords(bi)) ev.push(['w', w]);
    ev.push(['w', sepWord]);
    if (c0.length === 4) { for (const w of yearWords(ci)) ev.push(['w', w]); }
    else { for (const w of cardinalWords(ci)) ev.push(['w', w]); }
    return ev;
  }
  if (kind === 'time') {
    let m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s?([AaPp])\.?[Mm])?/.exec(tok);
    if (m) {
      const hh = Number(m[1]), mm = Number(m[2]);
      const rawAp = (m[4] || '').toLowerCase();
      const ampm = rawAp ? (rawAp.startsWith('a') ? 'am' : 'pm') : null;
      if (m[3]) {
        const ss = Number(m[3]);
        const ev = cardinalWords(hh).map((w) => ['w', w]);
        ev.push(['w', hh === 1 ? 'hour' : 'hours']);
        for (const w of cardinalWords(mm)) ev.push(['w', w]);
        ev.push(['w', mm === 1 ? 'minute' : 'minutes'], ['w', 'and']);
        for (const w of cardinalWords(ss)) ev.push(['w', w]);
        ev.push(['w', ss === 1 ? 'second' : 'seconds']);
        return ev;
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
    const digits = String(tok).replace(/\D/g, '');
    return ordinalWords(Number(digits)).map((w) => ['w', w]);
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
    const parts = tok.split('-').filter(Boolean);
    const sepWord = parts.length === 2 ? 'to' : 'dash';
    const ev = [];
    parts.forEach((part, pi) => {
      if (pi) ev.push(['w', sepWord]);
      if (part.length > 1 && part.startsWith('0')) {
        for (const w of digitsWords(part)) ev.push(['w', w]);
      } else {
        for (const w of cardinalWords(Number(part))) ev.push(['w', w]);
      }
    });
    return ev;
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
    const n = Number(m[1]), num = Number(m[2]), den = Number(m[3]);
    if (num === 1 && den === 2) return cardinalWords(n).concat(['and', 'a', 'half']).map((w) => ['w', w]);
    const words = cardinalWords(n).concat(['and'], fractionWords(num, den));
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
    if (kind === 'word' && MONTH_ABBR[String(val).toLowerCase()]) {
      const monthFull = MONTH_ABBR[String(val).toLowerCase()];
      let day = null;
      if (nxt && (nxt[0] === 'number' || nxt[0] === 'ordinal')) {
        const dm = /^(\d+)/.exec(String(nxt[1]));
        const d = dm ? Number(dm[1]) : 0;
        if (d >= 1 && d <= 31) { day = d; events[idx + 1] = ['consumed', null]; }
      }
      out.push(['w', monthFull]);
      if (day !== null) { for (const w of ordinalWords(day)) out.push(['w', w]); }
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
    if (kind === 'number' && /^[0-9]{8,}$/.test(String(val))) {
      for (const w of digitsWords(String(val))) out.push(['w', w]);
      continue;
    }
    if (kind === 'number' && /^0[0-9]+$/.test(String(val))) {
      for (const w of digitsWords(String(val))) out.push(['w', w]);
      continue;
    }
    if (['number', 'date', 'date_my', 'date_ym', 'time', 'time_range', 'ratio', 'version', 'ordinal', 'decimal',
      'thousands', 'range', 'phone', 'alnum', 'fraction', 'mixed', 'ip', 'dashgroup', 'groupnum'].includes(kind)) {
      const ev = expandNumberToken(val, kind, out.filter((x) => x[0] === 'w' || x[0] === 'word').map((x) => x[1]));
      for (const e of ev) out.push(e);
      if (nxt && nxt[0] === 'word') {
        let rawU = nxt[1];
        let uw = unitWords(rawU);
        const nxt3 = idx + 2 < events.length ? events[idx + 2] : null;
        const nxt4 = idx + 3 < events.length ? events[idx + 3] : null;
        if (String(rawU).toLowerCase() === 'm' && nxt3 && nxt3[0] === 'slash' && nxt4 && nxt4[0] === 'word') {
          out.push(['phones', letterToken('m')]);
          events[idx + 1] = ['consumed', null];
          continue;
        }
        if (String(rawU).toLowerCase() === 'km' && nxt3 && nxt3[0] === 'slash'
            && nxt4 && nxt4[0] === 'word' && String(nxt4[1]).toLowerCase() === 'h') {
          out.push(['w', 'kilometers'], ['w', 'per'], ['w', 'hour']);
          events[idx + 1] = ['consumed', null];
          events[idx + 2] = ['consumed', null];
          events[idx + 3] = ['consumed', null];
          continue;
        }
        if (String(rawU).toLowerCase() === 'm') {
          const prevWords = out.filter((x) => x[0] === 'w').slice(-4).map((x) => x[1]).join(' ');
          uw = (prevWords.includes('hour') || prevWords.includes('hours')) ? ['minutes'] : null;
        }
        if (rawU === rawU.toUpperCase() && rawU.length === 1) uw = null;
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
        if (sym === '¥' && nn) {
          for (const w of cardinalWords(nn)) out.push(['w', w]);
          out.push(['w', 'yen']);
        } else if (sym === '￥' && nn) {
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
    } else if (kind === 'ellipsis_pause' || kind === 'end_ellipsis') {
      out.push([kind, val]);
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

function textToIds(text, sym, lexicon, variant) {
  const prevLex = ACTIVE_LEX;
  const prevVar = ACTIVE_VARIANT;
  if ((variant === 'gb' || variant === 'in') && lexicon) {
    ACTIVE_LEX = lexicon;
    ACTIVE_VARIANT = variant;
  }
  try {
    return _textToIdsImpl(text, sym, variant || '');
  } finally {
    ACTIVE_LEX = prevLex;
    ACTIVE_VARIANT = prevVar;
  }
}

function normalizeNewlines(text) {
  // 引擎实测：换行 = 句子边界（每行独立成句，自动补句号）
  if (!text.includes('\n') && !text.includes('\r')) return text;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let out = '';
  for (const ch of s) {
    if (ch === '\n') {
      let j = out.length - 1;
      while (j >= 0 && (out[j] === ' ' || out[j] === '\t')) j -= 1;
      if (j >= 0 && '.!?'.includes(out[j])) out += ' ';
      else out += '. ';
    } else out += ch;
  }
  return out;
}

function _textToIdsImpl(text, sym, variant) {
  text = preprocess(normalizeNewlines(String(text || '')));
  const raw = parse(text);
  const ev = expand(raw);
  const flat = flatten(ev);
  // 英文异读 CRF 的 token 上下文（引擎 token = 词 + 标点；引号不产生 token）
  const crfTokens = [];
  const crfTokIdx = new Map();
  const puncMap = { 'punc.': '.', 'punc,': ',', 'punc?': '?', 'punc!': '!', 'punc;': ';', 'punc:': ':', 'punc...': '...' };
  for (let k = 0; k < flat.length; k++) {
    const kk = flat[k][0];
    let tk = null;
    if (kk === 'w') tk = flat[k][1];
    else if (kk === 'pause' || kk === 'pause_plain' || kk === 'pause_br1') tk = ',';
    else if (kk === 'end') tk = puncMap[flat[k][1]] || '.';
    else if (kk === 'end_ellipsis' || kk === 'ellipsis_pause') tk = '...';
    if (tk !== null) {
      crfTokens.push(tk);
      crfTokIdx.set(k, crfTokens.length - 1);
    }
  }
  let crfEn = null;
  try { crfEn = require('./crf_en'); } catch (e) { crfEn = null; }
  const ids = [];
  if (sym[BOS] !== undefined) ids.push(sym[BOS]);
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
      let phones = null;
      if (crfEn) {
        const ti = crfTokIdx.get(i);
        if (ti !== undefined) {
          try { phones = crfEn.select(w, crfTokens, ti); } catch (e) { phones = null; }
        }
      }
      if (phones === null || phones === undefined) phones = pronWord(w, nxt, prevW);
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
        if (ph === '-') ids.push(symId(sym, '-', variant));
        else ids.push(symId(sym, ph, variant));
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
      if (variant === 'in') {
        if (sym['br3'] !== undefined) ids.push(sym['br3']);
        first = true;
        continue;
      }
      ids.push(sym['br3']);
      if (item[1] && sym[item[1]] !== undefined) ids.push(sym[item[1]]);
      if (sym['br0'] !== undefined) ids.push(sym['br0']);
      first = true;
    } else if (kind === 'ellipsis_pause') {
      ids.push(sym['br3'] !== undefined ? sym['br3'] : 0);
      ids.push(item[1] && sym[item[1]] !== undefined ? sym[item[1]] : (sym['punc...'] !== undefined ? sym['punc...'] : (sym['punc.'] || 0)));
      ids.push(sym['br0'] !== undefined ? sym['br0'] : 0);
      first = true;
    } else if (kind === 'end_ellipsis') {
      ids.push(sym['br4']);
      const nxtE = i + 1 < flat.length ? flat[i + 1] : null;
      if (nxtE && nxtE[0] === 'end' && String(nxtE[1] || '').startsWith('punc')) {
        // "Really...?" / "Really...!" → 引擎为 punc? / punc! + punc.
        ids.push(sym[nxtE[1]] !== undefined ? sym[nxtE[1]] : (sym['punc.'] || 0));
        if (sym['punc.'] !== undefined) ids.push(sym['punc.']);
        i += 2;
      } else {
        ids.push(item[1] && sym[item[1]] !== undefined ? sym[item[1]] : (sym['punc...'] !== undefined ? sym['punc...'] : (sym['punc.'] || 0)));
        if (sym['punc.'] !== undefined) ids.push(sym['punc.']);
        i += 1;
      }
      ids.push(sym[END]);
      ended = true;
      first = true;
    } else if (kind === 'end') {
      if (variant === 'in') {
        if (sym['br4'] !== undefined) ids.push(sym['br4']);
        if (sym[END] !== undefined) ids.push(sym[END]);
        let jx2 = i + 1;
        if (jx2 < flat.length) {
          if (sym[BOS] !== undefined) ids.push(sym[BOS]);
          if (sym['br0'] !== undefined) ids.push(sym['br0']);
          first = true; ended = false; i = jx2 - 1; continue;
        }
        ended = true; first = true; i = jx2 - 1; continue;
      }
      ids.push(sym['br4']);
      ids.push(item[1] && sym[item[1]] !== undefined ? sym[item[1]] : (sym['punc.'] || 0));
      let jx = i + 1;
      const extra = [];
      while (jx < flat.length && flat[jx][0] === 'punc_after_end') { extra.push(flat[jx][1]); jx += 1; }
      let quotePunc = null;
      if (jx < flat.length && flat[jx][0] === 'quote_after_end') { quotePunc = flat[jx][1]; jx += 1; }
      if (extra.length) {
        for (const ex of extra) ids.push(sym[ex] !== undefined ? sym[ex] : (sym['punc.'] || 0));
      }
      if (quotePunc !== null) {
        ids.push(sym['br0'] !== undefined ? sym['br0'] : 0);
        ids.push(sym[quotePunc] !== undefined ? sym[quotePunc] : (sym['punc.'] || 0));
      }
      if (jx < flat.length) {
        ids.push(sym[END]);
        ids.push(sym[BOS]); ids.push(sym['br0'] !== undefined ? sym['br0'] : 0);
        first = true; ended = false; i = jx - 1; continue;
      }
      ids.push(sym[END]);
      ended = true; first = true; i = jx - 1; continue;
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
        if (ph === '-') ids.push(symId(sym, '-', variant));
        else ids.push(symId(sym, ph, variant));
      }
      first = false;
    }
  }
  if (!ended) {
    if (sym['br4'] !== undefined) ids.push(sym['br4']);
    if (variant !== 'in' && sym['punc.'] !== undefined) ids.push(sym['punc.']);
    if (sym[END] !== undefined) ids.push(sym[END]);
  }
  return mergeBracketTail(ids, sym, text);
}

// 引擎实测：文本以「) / ] + 句末标点」结尾时，闭合括号的 punc 与句点的 punc 同属一句
// （br4 punc. punc. ~）；状态机偶尔把后者拆成空句，这里合并回前一句。
function mergeBracketTail(ids, sym, text) {
  try {
    if (!text) return ids;
    const t = String(text).trim();
    if (!t) return ids;
    const lastCh = t[t.length - 1];
    if (').]!?'.indexOf(lastCh) < 0) return ids;
    const END = sym['~'];
    const BOS = sym['-bos-'];
    const BR0 = sym['br0'];
    const BR4 = sym['br4'];
    const n = ids.length;
    if (n < 7) return ids;
    if (ids[n - 1] !== END) return ids;
    if (ids[n - 3] === BR4 && ids[n - 4] === BR0 && ids[n - 5] === BOS && ids[n - 6] === END) {
      const tailPunc = ids[n - 2];
      return ids.slice(0, n - 6).concat([tailPunc, END]);
    }
    return ids;
  } catch (e) {
    return ids;
  }
}

module.exports = { textToIds, loadVariantLexicon };
