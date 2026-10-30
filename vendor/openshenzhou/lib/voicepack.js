'use strict';
// voicepack.js —— 语音包加载：.bin → ONNX → 标准算子，带缓存
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { decodeBin } = require('./decode');
const { rewriteModel } = require('./rewrite');
const onnxProto = require('onnx-proto');

const onnx = onnxProto.onnx;
const MODELS = ['am_v5_encoder', 'am_v5_decoder', 'device_vocoder_v6_streaming'];
const CACHE_ROOT = path.join(os.homedir(), '.openshenzhou', 'models');

function loadSymbols(phonesPath) {
  const txt = fs.readFileSync(phonesPath, 'utf8').replace(/^\uFEFF/, '');
  const m = {};
  for (const line of txt.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const idx = t.lastIndexOf(':');
    if (idx < 0) continue;
    m[t.slice(0, idx)] = parseInt(t.slice(idx + 1), 10);
  }
  return m;
}

class VoicePack {
  constructor(dir) {
    this.dir = path.resolve(dir);
    this.name = path.basename(this.dir);
    this.phonesPath = path.join(this.dir, 'phones.txt');
    if (!fs.existsSync(this.phonesPath)) throw new Error('缺少 phones.txt: ' + this.dir);
    this.symbols = loadSymbols(this.phonesPath);
    this.lang = this._guessLang();
    this._sessions = null;
  }

  _guessLang() {
    const n = this.name.toLowerCase();
    const tags = [['zh-cn', 'zh'], ['en-us', 'en'], ['en-gb', 'en'], ['en-in', 'en'],
      ['ja-jp', 'ja'], ['ko-kr', 'ko'], ['es-es', 'es'], ['es-mx', 'es'],
      ['pt-br', 'pt'], ['fr-fr', 'fr'], ['de-de', 'de']];
    for (const [tag, lang] of tags) if (n.includes(tag)) return lang;
    return 'unknown';
  }

  _cacheDir() {
    const st = fs.statSync(this.phonesPath);
    const h = crypto.createHash('md5').update(this.dir + String(st.mtimeMs)).digest('hex').slice(0, 12);
    const d = path.join(CACHE_ROOT, this.name + '-' + h);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  models() {
    const cache = this._cacheDir();
    const out = [];
    for (const base of MODELS) {
      const dst = path.join(cache, base + '.onnx');
      if (!fs.existsSync(dst)) {
        const binp = path.join(this.dir, base + '.bin');
        if (!fs.existsSync(binp)) throw new Error('缺少模型: ' + binp);
        const raw = decodeBin(fs.readFileSync(binp));
        if (base === 'am_v5_encoder') {
          fs.writeFileSync(dst, raw);
        } else {
          const model = onnx.ModelProto.decode(raw);
          rewriteModel(model);
          fs.writeFileSync(dst, onnx.ModelProto.encode(model).finish());
        }
      }
      out.push(dst);
    }
    return out;
  }

  async sessions() {
    if (this._sessions) return this._sessions;
    const ort = require('onnxruntime-node');
    const paths = this.models();
    this._sessions = [];
    for (const p of paths) this._sessions.push(await ort.InferenceSession.create(p));
    return this._sessions;
  }
}

module.exports = { VoicePack, loadSymbols };
