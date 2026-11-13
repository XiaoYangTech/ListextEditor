'use strict';
// crf_en.js —— 英文异读词 CRF 的 Node 复刻（与 Python openshenzhou/crf_en.py 一致）
//
// 数据：语音包 MSTTSLocEnUS.dat 内的 29 个 CRF 模型（A 段 trie + B 段 float32 权重）；
// 元数据：data/en_crf_models.json（含绝对偏移/标签/模板）。
// 特征（运行期 hook 验证）：全大写 token 文本，'/' 连接；虚拟边界 '_B-2','_B-1' / '_B+1'..。

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');
const VIRT_PRE = ['_B-2', '_B-1'];
const VIRT_POST = ['_B+1', '_B+2', '_B+3', '_B+4'];

let MODELS = null;
let DAT_PATH = '';
let DAT_BUF = null;
const SLICES = new Map();

function loadModels() {
  if (!MODELS) {
    try {
      MODELS = JSON.parse(fs.readFileSync(path.join(DATA, 'en_crf_models.json'), 'utf8'));
    } catch (e) {
      MODELS = [];
    }
  }
  return MODELS;
}

function setDatPath(p) {
  if (p && p !== DAT_PATH) {
    DAT_PATH = p;
    DAT_BUF = null;
    SLICES.clear();
  }
}

function findDat() {
  if (DAT_PATH && fs.existsSync(DAT_PATH)) return DAT_PATH;
  const os = require('os');
  const roots = [];
  if (process.env.OS_VOICE_ROOT) roots.push(process.env.OS_VOICE_ROOT);
  const temp = process.env.TEMP || os.tmpdir();
  if (temp) roots.push(path.join(temp, 'AllVoice'));
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    let names = [];
    try {
      names = fs.readdirSync(root);
    } catch (e) {
      continue;
    }
    names.sort((a, b) => {
      const ka = a.toLowerCase().includes('en-us') ? 0 : 1;
      const kb = b.toLowerCase().includes('en-us') ? 0 : 1;
      return ka - kb || (a < b ? -1 : a > b ? 1 : 0);
    });
    for (const n of names) {
      const p = path.join(root, n, 'MSTTSLocEnUS.dat');
      try {
        if (fs.existsSync(p) && fs.statSync(p).size > 1000000) {
          DAT_PATH = p;
          return p;
        }
      } catch (e) {
        /* ignore */
      }
    }
  }
  return '';
}

function dat() {
  if (!DAT_BUF) {
    const p = findDat();
    if (!p) throw new Error('MSTTSLocEnUS.dat 未找到（设置 OS_VOICE_ROOT）');
    DAT_BUF = fs.readFileSync(p);
  }
  return DAT_BUF;
}

function modelForWord(word) {
  const w = String(word || '').toLowerCase().trim();
  for (const m of loadModels()) {
    if (m.word === w) return m;
  }
  return null;
}

function labelPhones(lab) {
  const parts = String(lab).split('%');
  const out = [];
  let i = 0;
  while (i < parts.length) {
    const p = parts[i];
    if (i + 1 < parts.length && /^\d$/.test(parts[i + 1])) {
      out.push((p + parts[i + 1]).toLowerCase());
      i += 2;
    } else if (p) {
      out.push(p.toLowerCase());
      i += 1;
    } else {
      i += 1;
    }
  }
  return out;
}

function features(m, tokens, ti) {
  const ext = VIRT_PRE.concat(tokens.map((t) => String(t).toUpperCase()), VIRT_POST);
  const ei = VIRT_PRE.length + ti;
  const get = (j) => {
    if (j < 0) return VIRT_PRE[0];
    if (j >= ext.length) return VIRT_POST[0];
    return ext[j];
  };
  const out = [];
  for (const tm of m.templates) {
    const ci = tm.indexOf(':');
    const expr = ci >= 0 ? tm.slice(ci + 1) : tm;
    const parts = [];
    for (let part of expr.split('/')) {
      part = part.trim();
      if (part.includes('PrevToken') && part.endsWith('CaseInsensitiveText')) {
        parts.push(get(ei - (part.match(/PrevToken/g) || []).length));
      } else if (part.includes('NextToken') && part.endsWith('CaseInsensitiveText')) {
        parts.push(get(ei + (part.match(/NextToken/g) || []).length));
      } else {
        parts.push('');
      }
    }
    out.push(tm.slice(0, Math.max(0, ci)) + ':' + parts.join('/'));
  }
  return out;
}

function sliceOf(m) {
  if (SLICES.has(m.idx)) return SLICES.get(m.idx);
  const d = dat();
  const A = d.subarray(m.A_off, m.A_off + m.lenA);
  const B = d.subarray(m.B_off, m.B_off + m.lenB);
  const view = new DataView(B.buffer, B.byteOffset, B.byteLength);
  const n = Math.floor(B.byteLength / 4);
  const vals = new Float32Array(n);
  for (let i = 0; i < n; i++) vals[i] = view.getFloat32(i * 4, true);
  const { Trie } = require('./crf_zh');
  const entry = { trie: new Trie(A), vals };
  SLICES.set(m.idx, entry);
  return entry;
}

function scoreWord(m, tokens, ti) {
  const { trie, vals } = sliceOf(m);
  const L = m.L;
  const nf = Math.floor(vals.length / Math.max(L, 1));
  const scores = new Array(L).fill(0);
  for (const f of features(m, tokens, ti)) {
    let fid = -1;
    try {
      fid = trie.lookup(f)[0];
    } catch (e) {
      fid = -1;
    }
    if (fid < 0 || fid >= nf) continue;
    for (let l = 0; l < L; l++) scores[l] += vals[fid * L + l];
  }
  return scores;
}

const MARGIN = process.env.OS_CRF_EN_MARGIN !== undefined
  ? parseFloat(process.env.OS_CRF_EN_MARGIN)
  : 0.5;

function select(word, tokens, ti, minMargin) {
  const mm = minMargin === undefined ? MARGIN : minMargin;
  const m = modelForWord(word);
  if (!m) return null;
  if (!(ti >= 0 && ti < tokens.length)) return null;
  let scores;
  try {
    scores = scoreWord(m, tokens, ti);
  } catch (e) {
    return null;
  }
  const order = scores.map((v, i) => i).sort((a, b) => scores[b] - scores[a]);
  if (scores.length > 1 && mm) {
    if (scores[order[0]] - scores[order[1]] < mm) return null;
  }
  return labelPhones(m.labels[order[0]]);
}

module.exports = { loadModels, setDatPath, findDat, modelForWord, scoreWord, select, features };
