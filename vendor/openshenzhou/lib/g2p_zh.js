'use strict';
// g2p_zh.js —— 中文文本 → 音素 ID（规则 + 引擎标定词表）
const fs = require('fs');
const { resolveSeq } = require('./symbols');
const segmodel = require('./segmodel');
let wb = null;
try { wb = require('./wb_model'); } catch (e) { wb = null; }
let crf = null;
try { crf = require('./crf_zh'); } catch (e) { crf = null; }

const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');
const CHAR_READINGS = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, 'zh_char_readings.json'), 'utf8'));
  } catch (e) { return {}; }
})();

const CORE_WS = (() => {
  try {
    return new Set(JSON.parse(fs.readFileSync(path.join(DATA, 'zh_seg_wordset.json'), 'utf8')));
  } catch (e) { return new Set(); }
})();

const NUM_PY = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, 'zh_num_pinyin.json'), 'utf8'));
  } catch (e) { return {}; }
})();

// 数字读法（与 Python pypinyin 短语词典一致）：按 万/亿 分段查表
function numPinyin(cn) {
  const SUFFIX = { '万': 'wan4', '亿': 'yi4' };
  let out = [];
  let buf = '';
  const flush = () => {
    if (!buf) return;
    const hit = NUM_PY[buf];
    if (hit) out.push(...hit);
    else for (const ch of buf) out.push(PINYIN[ch] || 'a1');
    buf = '';
  };
  for (const ch of cn) {
    if (SUFFIX[ch]) { flush(); out.push(SUFFIX[ch]); }
    else buf += ch;
  }
  flush();
  return out;
}

const CHAR_CTX = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, 'zh_char_ctx.json'), 'utf8'));
  } catch (e) { return {}; }
})();

function toIds(names, sym) {
  return String(names).split('.').map((x) => (sym[x] !== undefined ? sym[x] : (sym['<pad>'] || 0)));
}

function ctxCharSyl(ch, prevCh, nextCh, sym) {
  if (!CHAR_CTX || !CHAR_CTX.uni) return null;
  const tries = [
    [CHAR_CTX.tri, prevCh + '|' + ch + '|' + nextCh],
    [CHAR_CTX.bi_r, ch + '|' + nextCh],
    [CHAR_CTX.bi_l, prevCh + '|' + ch],
    [CHAR_CTX.uni, ch],
  ];
  for (const [tbl, key] of tries) {
    if (tbl && tbl[key]) return toIds(tbl[key], sym);
  }
  return null;
}

let ISOLATED = null;
function loadIsolatedSyl() {
  if (ISOLATED) return ISOLATED;
  try {
    ISOLATED = JSON.parse(fs.readFileSync(path.join(DATA, 'cjk_isolated.json'), 'utf8'));
  } catch (e) { ISOLATED = {}; }
  return ISOLATED;
}

function isolatedCharSyl(ch, sym) {
  const hit = loadIsolatedSyl()[ch];
  if (!hit) return null;
  return hit.map((x) => (sym[x] !== undefined ? sym[x] : (sym['padding'] !== undefined ? sym['padding'] : (sym['<pad>'] || 0))));
}

function correctCharSyl(ch, sym) {
  const corr = CHAR_READINGS[ch];
  if (!corr) return null;
  return corr.map((x) => (sym[x] !== undefined ? sym[x] : (sym['<pad>'] || 0)));
}

const PINYIN = JSON.parse(fs.readFileSync(path.join(DATA, 'pinyin_zh.json'), 'utf8'));
const FINALS = JSON.parse(fs.readFileSync(path.join(DATA, 'g2p_finals.json'), 'utf8')).finals;
const LEXICON = (() => {
  let d = {};
  try {
    const p = path.join(DATA, 'lexicon_zh.names.json');
    const f = fs.existsSync(p) ? p : path.join(DATA, 'lexicon_zh.json');
    d = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) { d = {}; }
  const mode = process.env.OS_ZH_BROAD || 'fill';
  if (mode !== 'off') {
    try {
      const b = JSON.parse(fs.readFileSync(path.join(DATA, 'lexicon_zh_broad.names.json'), 'utf8'));
      for (const [k, v] of Object.entries(b)) {
        if (mode === 'override' || d[k] === undefined) d[k] = v;
      }
    } catch (e) { /* ignore */ }
  }
  return d;
})();

const OFFICIAL_WORDS = new Set((() => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, 'official_words_zh.json'), 'utf8')); } catch (e) { return []; }
})());

const ZH_WORDS = new Set((() => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, 'zh_words.json'), 'utf8')); } catch (e) { return []; }
})());

const TONES = { 1: ['h', 'h'], 2: ['l', 'h'], 3: ['l', 'l'], 4: ['h', 'l'], 5: ['m', 'm'] };
const V_FINALS = { u: ['v', 'v'], ue: ['eh', 'eh'], uan: ['a', 'nn'], un: ['el', 'nn'] };
const PUNCT = { '，': 'punc,', ',': 'punc,', '。': 'punc。', '.': 'punc。', '？': 'punc?', '?': 'punc?',
                '！': 'punc!', '!': 'punc!', '、': 'punc、', '；': 'punc;', ';': 'punc;' };
const DIGITS = '零一二三四五六七八九';

function readDigitSeq(ds) {
  return ds.split('').filter((c) => c >= '0' && c <= '9')
    .map((c) => DIGITS[parseInt(c, 10)]).join('');
}

function readGroup(n) {
  const units = ['', '十', '百', '千'];
  let out = '';
  const s = String(n);
  let zero = false;
  for (let i = 0; i < s.length; i++) {
    const d = parseInt(s[i], 10);
    const pos = s.length - 1 - i;
    if (d === 0) { zero = true; continue; }
    if (zero && out) out += '零';
    zero = false;
    out += DIGITS[d] + units[pos];
  }
  if (out.startsWith('一十')) out = out.slice(1);
  return out;
}

function readDigits(ds) {
  ds = String(ds).replace(/^0+/, '') || '0';
  if (ds.length > 12) return readDigitSeq(ds);
  const n = parseInt(ds, 10);
  if (n === 0) return '零';
  const groups = ['', '万', '亿', '万亿'];
  let out = '';
  let gi = 0;
  let v = n;
  while (v > 0) {
    const part = v % 10000;
    v = Math.floor(v / 10000);
    if (part) out = readGroup(part) + groups[gi] + out;
    else if (out && !out.startsWith('零')) out = '零' + out;
    gi += 1;
  }
  return out.replace(/零+$/, '');
}

const NUM_RE = /(\d{4})(年)|(\d+)\.(\d+)|(\d+)%|(\d{7,})|(\d+)([月日])|(\d+)/g;

function tnSymbols(text) {
  // 货币：￥100 -> 100元
  text = text.replace(/[￥¥]\s*(\d+(?:\.\d+)?)\s*(万|亿)?/g, (m, a, b) => a + (b || '') + '元');
  text = text.replace(/\$\s*(\d+(?:\.\d+)?)/g, (m, a) => a + '美元');
  // 百分比：99.9% -> 百分之99.9
  text = text.replace(/(\d+(?:\.\d+)?)\s*[%％]/g, (m, a) => '百分之' + a);
  // 日期 2026/10/26 -> 2026年10月26日
  text = text.replace(/(?<!\d)(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?!\d)/g,
    (m, y, mo, d) => y + '年' + parseInt(mo, 10) + '月' + parseInt(d, 10) + '日');
  // 时间 9:30 -> 9点30分
  text = text.replace(/(?<!\d)(\d{1,2})[:：](\d{2})(?!\d)/g,
    (m, h, mi) => parseInt(mi, 10) ? h + '点' + mi + '分' : h + '点');
  const rules = [['℃', '摄氏度'], ['℉', '华氏度'], ['～', '至'], ['×', '乘以'], ['÷', '除以'], ['±', '正负']];
  for (const [a, b] of rules) text = text.split(a).join(b);
  return text;
}

function normalizeSegments(text) {
  text = tnSymbols(text);
  const segs = [];
  let pos = 0;
  NUM_RE.lastIndex = 0;
  let m;
  while ((m = NUM_RE.exec(text)) !== null) {
    if (m.index > pos) segs.push({ kind: 't', v: text.slice(pos, m.index) });
    let endp = m.index + m[0].length;
    if (m[1]) {
      segs.push({ kind: 'n', v: readDigitSeq(m[1]) + '年' });
    } else if (m[3] !== undefined) {
      let txt = readDigits(m[3]) + '点' + readDigitSeq(m[4]);
      while (endp < text.length && '点元年分秒'.includes(text[endp])) { txt += text[endp]; endp += 1; }
      segs.push({ kind: 'n', v: txt });
    } else if (m[5]) {
      segs.push({ kind: 't', v: '百分之' + readDigits(m[5]) });
    } else if (m[6]) {
      segs.push({ kind: 'n', v: readDigitSeq(m[6]) });
    } else if (m[7]) {
      segs.push({ kind: 'n', v: readDigits(m[7]) + m[8] });
    } else {
      let txt = readDigits(m[9]);
      while (endp < text.length && '点元分秒'.includes(text[endp])) { txt += text[endp]; endp += 1; }
      segs.push({ kind: 'n', v: txt });
    }
    pos = endp;
    NUM_RE.lastIndex = endp;
  }
  if (pos < text.length) segs.push({ kind: 't', v: text.slice(pos) });
  return segs;
}

function normalizeText(text) {
  return normalizeSegments(text).map((x) => x.v).join('');
}

function applySandhi(pys) {
  const out = pys.slice();
  for (let i = 0; i + 1 < out.length; i++) {
    const ti = out[i].slice(-1), tn = out[i + 1].slice(-1);
    const bi = out[i].slice(0, -1), bn = out[i + 1].slice(0, -1);
    if (ti === '3' && tn === '3') out[i] = bi + '2';
    if (bi === 'bu' && ti === '4' && tn === '4') out[i] = bi + '2';
  }
  return out;
}

function sylToSymbols(py) {
  const base = py.replace(/[1-5]$/, '');
  const tone = /[1-5]$/.test(py) ? parseInt(py.slice(-1), 10) : 5;
  const m = base.match(/^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw]|)(.*)$/);
  const ini = m[1], fin = m[2];
  const [s1, s2] = TONES[tone];
  let t1, seg = null;

  if (ini === 'y') {
    if (fin.startsWith('u')) {
      t1 = 'yv';
      seg = V_FINALS[fin] || ['v', 'v'];
    } else {
      t1 = 'yi';
      seg = fin === 'e' ? ['eh', 'eh'] : FINALS[fin];
    }
  } else if (ini === 'w') {
    t1 = 'wu';
    seg = FINALS[fin];
  } else if (fin === 'i' && ['zh', 'ch', 'sh', 'r'].includes(ini)) {
    t1 = ini; seg = ['ib', 'ib'];
  } else if (fin === 'i' && ['z', 'c', 's'].includes(ini)) {
    t1 = ini; seg = ['if', 'if'];
  } else {
    let medial = '';
    if (['j', 'q', 'x'].includes(ini) && ['u', 'ue', 'uan', 'un'].includes(fin)) medial = 'v';
    else if (fin.startsWith('u')) medial = 'u';
    else if (fin.startsWith('i')) medial = 'i';
    else if (fin === 'ong') medial = 'u';
    else if (fin === 'v') medial = 'v';

    if (ini === '') {
      if (fin.startsWith('i')) t1 = 'y' + medial;
      else if (fin.startsWith('u')) t1 = 'w' + medial;
      else t1 = 'g' + ({ a: 'a', e: 'e', o: 'o' }[fin[0]] || 'e');
    } else {
      t1 = ini + medial;
    }
    seg = (['j', 'q', 'x'].includes(ini) && V_FINALS[fin]) ? V_FINALS[fin] : FINALS[fin];
  }
  if (!seg) seg = [fin || 'a', fin || 'a'];
  return [t1, seg[0] + '_' + s1, seg[1] + '_' + s2];
}

// 贪心最长匹配分词（引擎词表优先，拼音表兜底）
function segmentWords(text) {
  const words = [];
  let i = 0;
  while (i < text.length) {
    let matched = null;
    for (let len = Math.min(6, text.length - i); len >= 1; len--) {
      const cand = text.substr(i, len);
      if (len === 1 || LEXICON[cand] || OFFICIAL_WORDS.has(cand)) { matched = cand; break; }
    }
    if (!matched) matched = text[i];
    words.push(matched);
    i += matched.length;
  }
  return words;
}

// 词条 ids → 音节组；词条内部的 br1 表示引擎把它拆成了多个词
function lexiconGroups(core, sym) {
  const br1 = sym['br1'] !== undefined ? sym['br1'] : (sym['br0'] || 0);
  const groups = [];
  let cur = [];
  for (const x of core) {
    if (x === br1) { groups.push(cur); cur = []; }
    else cur.push(x);
  }
  groups.push(cur);
  const out = [];
  for (const g of groups) {
    if (!g.length) continue;
    const gs = [];
    for (let k = 0; k < g.length; k += 3) gs.push(g.slice(k, k + 3));
    out.push(gs);
  }
  return out;
}

// 每个汉字对应的音节 token 列表（读音来自词表，保证多音字）
function charSyllables(chars, sym, wordsIn, crfCtx) {
  const words = wordsIn || segmentWords(chars.join(''));
  const syls = new Array(chars.length).fill(null);
  const lexBounds = new Array(Math.max(0, chars.length - 1)).fill(null);
  let pos = 0;
  for (const w of words) {
    const n = w.length;
    if (pos + n > chars.length) return null;
    let groups = null;
    if (LEXICON[w] && LEXICON[w].length) {
      const parsed = lexiconGroups(resolveSeq(LEXICON[w], sym), sym);
      const flat = [];
      for (const g of parsed) for (const syl of g) flat.push(syl);
      if (flat.length === n) groups = flat;
    }
    if (!groups) {
      const pys = applySandhi([...w].map((ch) => PINYIN[ch] || 'a1'));
      if (pys.length !== n) return null;
      groups = pys.map((py) => sylToSymbols(py).map((x) => (sym[x] !== undefined ? sym[x] : (sym['<pad>'] || 0))));
    }
    const multiLex = !!(LEXICON[w] && LEXICON[w].length) && n > 1;
    if (multiLex && !CORE_WS.has(w)) {
      const parsedGroups = lexiconGroups(resolveSeq(LEXICON[w], sym), sym);
      const tokOfChar = [];
      for (let gi = 0; gi < parsedGroups.length; gi++) {
        for (const _g of parsedGroups[gi]) tokOfChar.push(gi);
      }
      for (let k = 0; k < n - 1; k++) {
        if (pos + k < lexBounds.length && k + 1 < tokOfChar.length) {
          lexBounds[pos + k] = tokOfChar[k] !== tokOfChar[k + 1] ? 1 : 0;
        }
      }
    }
    for (let k = 0; k < n; k++) {
      syls[pos + k] = groups[k];
      if (!multiLex) {
        const gi = pos + k;
        const prevCh = gi > 0 ? chars[gi - 1] : '^';
        const nextCh = gi + 1 < chars.length ? chars[gi + 1] : '$';
        // 「一/不」的变调只在词首有效；词中/词尾保持本调（与 Python 一致）
        const corr = ((w[k] === '一' || w[k] === '不') && k > 0)
          ? null
          : (ctxCharSyl(w[k], prevCh, nextCh, sym) || correctCharSyl(w[k], sym) || isolatedCharSyl(w[k], sym));
        if (corr) syls[pos + k] = corr;
        // 多音字 CRF 覆盖（单字 token，与 Python 一致）
        if (crf && crfCtx && n === 1) {
          try {
            const ti = crf.charTokenIndex(crfCtx.tokens, crfCtx.base + pos);
            if (ti !== null) {
              const rd = crf.readingForChar(w, crfCtx.sentChars, crfCtx.tokens, ti, crfCtx.pkgDir);
              if (rd) syls[pos] = rd.map((x) => (sym[x] !== undefined ? sym[x] : 0));
            }
          } catch (e) { /* ignore */ }
        }
      }
    }
    pos += n;
  }
  if (pos !== chars.length || syls.some((s) => s === null)) return null;
  try { yiSandhiSyls(chars, syls, sym); } catch (e) { /* ignore */ }
  try { applyT3Chars(chars, syls, sym); } catch (e) { /* ignore */ }
  return { syls, lexBounds };
}

// 特定汉字的三声连读（数据来自引擎语料统计，与 Python data/zh_t3_chars.json 同源）
const T3_CHARS = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, 'zh_t3_chars.json'), 'utf8'));
  } catch (e) { return {}; }
})();

function applyT3Chars(chars, syls, sym) {
  if (!T3_CHARS || !Object.keys(T3_CHARS).length) return;
  const rev = new Map();
  for (const [k, v] of Object.entries(sym)) rev.set(v, k);
  const isT3 = (syl) => syl && syl.length === 3
    && String(rev.get(syl[1]) || '').endsWith('_l')
    && String(rev.get(syl[2]) || '').endsWith('_l');
  for (let i = 0; i + 1 < chars.length && i + 1 < syls.length; i++) {
    if (!T3_CHARS[chars[i]]) continue;
    const a = syls[i], b = syls[i + 1];
    if (!isT3(a) || !isT3(b)) continue;
    const nm = String(rev.get(a[2]) || '');
    if (!nm.endsWith('_l')) continue;
    const nid = sym[nm.slice(0, -2) + '_h'];
    if (nid !== undefined) a[2] = nid;
  }
}

// 字符级「一」变调（与 Python 相同规则：真「一」才变；第/唯/统/单/之/十 前不变）
function yiSandhiSyls(chars, syls, sym) {
  const rev = {};
  for (const k of Object.keys(sym)) rev[sym[k]] = k;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== '一') continue;  // 「一」
    if (i >= syls.length || !syls[i]) continue;
    if (i > 0 && YI_EXCEPT.has(chars[i - 1])) continue;
    const cur = syls[i];
    if (!cur || cur.length !== 3) continue;
    const nm1 = rev[cur[1]] || '';
    const nm2 = rev[cur[2]] || '';
    if (!nm1.startsWith('i_') || !nm2.startsWith('i_')) continue;
    if (i + 1 >= syls.length || !syls[i + 1] || syls[i + 1].length !== 3) continue;
    const nx = syls[i + 1];
    const a = (rev[nx[1]] || '').split('_').pop();
    const b = (rev[nx[2]] || '').split('_').pop();
    const nt = ({ hh: 1, lh: 2, ll: 3, hl: 4, mm: 5 })[a + b];
    let s1, s2;
    if (nt === 4) { s1 = 'l'; s2 = 'h'; }
    else if (nt === 1 || nt === 2 || nt === 3) { s1 = 'h'; s2 = 'l'; }
    else continue;
    const v1 = sym[nm1.split('_')[0] + '_' + s1];
    const v2 = sym[nm2.split('_')[0] + '_' + s2];
    if (v1 !== undefined) syls[i][1] = v1;
    if (v2 !== undefined) syls[i][2] = v2;
  }
  return syls;
}

const YI_EXCEPT = new Set(['第', '唯', '统', '单', '之', '十']);

// 「一」变调（与 Python 版一致）：非例外前字时按下一音节声调变调
function applyYiSandhi(ids, sym) {
  const tagIds = new Set();
  for (const k of ['-bos-', '~', 'br0', 'br1', 'br2', 'br3', 'br4']) {
    if (sym[k] !== undefined) tagIds.add(sym[k]);
  }
  const sep = sym['-'];
  const puncIds = new Set();
  for (const k of Object.keys(sym)) if (k.startsWith('punc')) puncIds.add(sym[k]);
  const rev = {};
  for (const k of Object.keys(sym)) rev[sym[k]] = k;
  const syls = [];
  let i = 0;
  while (i < ids.length) {
    const x = ids[i];
    if (tagIds.has(x) || x === sep || puncIds.has(x)) { i += 1; continue; }
    if (i + 2 < ids.length) { syls.push([i, ids[i], ids[i + 1], ids[i + 2]]); i += 3; }
    else i += 1;
  }
  const suf = (tok) => { const n = rev[tok] || ''; const p = n.split('_'); return p.length > 1 ? p[p.length - 1] : ''; };
  const tone = (s1, s2) => ({ hh: 1, lh: 2, ll: 3, hl: 4, mm: 5 }[(suf(s1) + suf(s2))] || 0);
  for (let k = 0; k < syls.length; k++) {
    const [pos, a, b, c] = syls[k];
    if ((rev[a] || '') !== 'yi') continue;
    // 区分「一」与「音/因」等同 initial 音节：一的两个韵母基都是 i
    const nb = (rev[b] || '').split('_')[0];
    const nc = (rev[c] || '').split('_')[0];
    if (nb !== 'i' || nc !== 'i') continue;
    if (k + 1 >= syls.length) continue;
    const nt = tone(syls[k + 1][2], syls[k + 1][3]);
    let s1, s2;
    if (nt === 4) { s1 = 'l'; s2 = 'h'; }
    else if (nt === 1 || nt === 2 || nt === 3) { s1 = 'h'; s2 = 'l'; }
    else continue;
    const n1 = rev[b] || '', n2 = rev[c] || '';
    const b1 = n1.split('_')[0], b2 = n2.split('_')[0];
    if (sym[b1 + '_' + s1] !== undefined) ids[pos + 1] = sym[b1 + '_' + s1];
    if (sym[b2 + '_' + s2] !== undefined) ids[pos + 2] = sym[b2 + '_' + s2];
  }
  return ids;
}

function textToIdsSentence(text, sym, pkgDir) {
  // 句尾的非句末标点（，；：等）：引擎当作句末处理（实测：句尾「，」→ br4+punc,；句尾「：」→ 仅 br4）
  let tailPunc = null;
  const trimmed = text.replace(/\s+$/, '');
  if (trimmed && '，、；：,;:'.includes(trimmed[trimmed.length - 1])) {
    tailPunc = trimmed[trimmed.length - 1];
    text = trimmed.slice(0, -1);
  }
  const segs = normalizeSegments(text);
  const ids = [sym['-bos-'], sym['br0']];
  // 多音字 CRF 上下文：整句字符 + token 列表（与 Python crf_zh.build_tokens 一致）
  let crfSentChars = null;
  let crfTokens = null;
  let crfCursor = 0;
  if (crf && pkgDir) {
    try {
      crfSentChars = [...text];
      crfTokens = crf.buildTokens(text, wb);
    } catch (e) { crfSentChars = null; crfTokens = null; }
  }
  let first = true, ended = false;

  const emitGroups = (groups) => {
    if (!first) ids.push(sym['br1']);
    for (let si = 0; si < groups.length; si++) {
      if (si > 0) ids.push(sym['-']);
      for (const t of groups[si]) ids.push(t);
    }
    first = false;
  };

  const pinyinGroups = (cn) => {
    let pys = [];
    for (const ch of cn) pys.push(PINYIN[ch] || 'a1');
    pys = applySandhi(pys);
    return pys.map((py) => sylToSymbols(py).map((x) => (sym[x] !== undefined ? sym[x] : (sym['<pad>'] || 0))));
  };

  // 数字串专用：额外处理「一」的变调（和 pypinyin 短语词典一致）
  const pinyinGroupsNum = (cn) => {
    // 去掉末尾量词（年/月/日/点/元/分/秒）后查表，量词单独用字表
    let core = cn, tail = '';
    while (core.length && '年月日点元分秒'.includes(core[core.length - 1])) {
      tail = core[core.length - 1] + tail;
      core = core.slice(0, -1);
    }
    let pys = numPinyin(core);
    for (const ch of tail) pys.push(PINYIN[ch] || 'a1');
    pys = applySandhi(pys);
    return pys.map((py) => sylToSymbols(py).map((x) => (sym[x] !== undefined ? sym[x] : (sym['<pad>'] || 0))));
  };

  for (const seg of segs) {
    if (seg.kind === 'n') {
      const groups = pinyinGroupsNum(seg.v);
      if (groups.length) emitGroups(groups);
      continue;
    }
    const parts = seg.v.split(/([，,。.？?！!、；;])/);
    for (const chunk of parts) {
      if (!chunk) continue;
      if (PUNCT[chunk]) {
        const key = PUNCT[chunk];
        const isEnd = ['。', '.', '？', '?', '！', '!'].includes(chunk);
        if (isEnd) {
          ids.push(sym['br4']);
          ids.push(sym[key] !== undefined ? sym[key] : sym['punc?']);
          ended = true;
        } else {
          ids.push(sym['br3'] !== undefined ? sym['br3'] : sym['br2']);
          ids.push(sym[key] !== undefined ? sym[key] : sym['punc?']);
          ids.push(sym['br0']);
          first = true;
        }
        continue;
      }
      const cn = [...chunk].filter((c) => c >= '\u4e00' && c <= '\u9fff').join('');
      if (!cn) continue;
      let crfCtx = null;
      if (crfTokens) {
        const b = text.indexOf(chunk, crfCursor);
        if (b >= 0) {
          crfCursor = b + chunk.length;
          crfCtx = { sentChars: crfSentChars, tokens: crfTokens, base: b, pkgDir };
        }
      }
      // 断词：官方 CBlstm 模型（wb_model）优先，segmodel 兜底
      {
        const chars = [...cn];
        let wbWords = null, wbBounds = null;
        if (wb) {
          try {
            wbWords = wb.segments(chars).map(([s0, L0]) => chars.slice(s0, s0 + L0).join(''));
            wbBounds = wb.boundsFromWords(chars, wbWords);
          } catch (e) { wbWords = null; wbBounds = null; }
        }
        if (wbBounds) {
          const parsedSyl = charSyllables(chars, sym, wbWords, crfCtx);
          if (parsedSyl) {
            const syls = parsedSyl.syls;
            const lexBounds = parsedSyl.lexBounds;
            const bounds = wbBounds;
            for (let bi = 0; bi < lexBounds.length && bi < bounds.length; bi++) {
              if (lexBounds[bi] !== null) bounds[bi] = lexBounds[bi];
            }
            if (!first) ids.push(sym['br1']);
            for (let k = 0; k < syls.length; k++) {
              if (k > 0) ids.push(bounds[k - 1] ? sym['br1'] : sym['-']);
              for (const t of syls[k]) ids.push(t);
            }
            first = false;
            continue;
          }
        }
      }
      if (segmodel.available()) {
        const chars = [...cn];
        const parsedSyl = charSyllables(chars, sym, null, crfCtx);
        if (parsedSyl) {
          const syls = parsedSyl.syls;
          const lexBounds = parsedSyl.lexBounds;
          const bwords = segmodel.baselineWords(chars);
          const blabs = segmodel.baselineLabels(chars.length, bwords);
          const bounds = segmodel.predict(chars, blabs, bwords);
          for (let bi = 0; bi < lexBounds.length && bi < bounds.length; bi++) {
            if (lexBounds[bi] !== null) bounds[bi] = lexBounds[bi];
          }
          if (!first) ids.push(sym['br1']);
          for (let k = 0; k < syls.length; k++) {
            if (k > 0) ids.push(bounds[k - 1] ? sym['br1'] : sym['-']);
            for (const t of syls[k]) ids.push(t);
          }
          first = false;
          continue;
        }
      }
      const words = segmentWords(cn);
      for (const w of words) {
        if (LEXICON[w] && LEXICON[w].length) {
          const parsed = lexiconGroups(resolveSeq(LEXICON[w], sym), sym);
          if (parsed.length) { for (const g of parsed) emitGroups(g); continue; }
        }
        const groups = pinyinGroups(w);
        if (groups.length) emitGroups(groups);
      }
    }
  }
  if (tailPunc) {
    ids.push(sym['br4']);
    const key = PUNCT[tailPunc] || 'punc,';
    if (tailPunc !== '：' && tailPunc !== ':') ids.push(sym[key] !== undefined ? sym[key] : sym['punc?']);
    ended = true;
  }
  if (!ended) ids.push(sym['br4']);
  ids.push(sym['~']);
  if (process.env.OS_YI_SANDHI !== '0') {
    return ids;
  }
  return ids;
}

// 引擎按句调用 encoder：输出是每句 -bos- ... ~ 序列首尾相接
function splitSentences(text) {
  const parts = [];
  const re = /[^。！？!?]*[。！？!?]/g;
  let m, start = 0;
  while ((m = re.exec(text)) !== null) {
    parts.push(m[0]);
    start = re.lastIndex;
  }
  if (start < text.length) {
    const rest = text.slice(start);
    if (rest) parts.push(rest);
  }
  return parts.filter((x) => x);
}

function textToIds(text, sym, pkgDir) {
  if (!text) return [];
  const out = [];
  for (const sent of splitSentences(text)) {
    if (!sent.trim()) continue;
    for (const id of textToIdsSentence(sent, sym, pkgDir)) out.push(id);
  }
  return out;
}

module.exports = { textToIds, textToIdsSentence, splitSentences, sylToSymbols, normalizeText, LEXICON, charSyllables, segmentWords, segmodel };
