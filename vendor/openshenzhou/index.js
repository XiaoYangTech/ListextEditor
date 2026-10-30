'use strict';
// index.js —— OpenShenzhou Node SDK：给语音包目录即可朗读
const path = require('path');
const { VoicePack } = require('./lib/voicepack');
const { synthesize, writeWav } = require('./lib/synth');

function splitSentences(ids) {
  const out = [];
  let cur = [];
  for (const x of ids) {
    cur.push(x);
    if (x === 1) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}

class TTS {
  /**
   * @param {string} voiceDir 语音包目录（含 .bin 模型与 phones.txt）
   */
  constructor(voiceDir) {
    this.pack = new VoicePack(voiceDir);
    this.lang = this.pack.lang;
    this._g2p = null;
  }

  _g2pFn() {
    if (this._g2p) return this._g2p;
    if (this.lang === 'zh') {
      const { textToIds } = require('./lib/g2p_zh');
      this._g2p = (text) => textToIds(text, this.pack.symbols, this.pack.dir);
    } else if (this.lang === 'en') {
      const { textToIds } = require('./lib/g2p_en');
      this._g2p = (text) => textToIds(text, this.pack.symbols);
    } else if (['es', 'fr', 'de', 'pt'].includes(this.lang)) {
      const { textToIds } = require('./lib/g2p_latin');
      this._g2p = (text) => textToIds(text, this.pack.symbols, this.lang);
    } else if (this.lang === 'ja') {
      const { textToIds } = require('./lib/g2p_ja');
      this._g2p = (text) => textToIds(text, this.pack.symbols);
    } else if (this.lang === 'ko') {
      const { textToIds } = require('./lib/g2p_ko');
      this._g2p = (text) => textToIds(text, this.pack.symbols);
    } else {
      throw new Error('暂不支持的语言: ' + this.lang + '（当前支持 zh / en / es / fr / de / pt / ja / ko）');
    }
    return this._g2p;
  }

  textToIds(text) {
    return this._g2pFn()(text);
  }

  /**
   * @param {string} text 文本
   * @param {string} [outPath] 可选 WAV 输出路径
   * @param {number} [speed] 1.0 正常
   * @returns {Promise<Float32Array>} 24kHz 单声道波形
   */
  async speak(text, outPath, speed = 1.0) {
    const ids = this.textToIds(text);
    const sessions = await this.pack.sessions();
    // 引擎每句一次 encoder：多句序列逐句合成后拼接
    const chunks = splitSentences(ids);
    if (chunks.length <= 1) return synthesize(sessions, ids, outPath, speed);
    const parts = [];
    let total = 0;
    for (const ch of chunks) {
      const a = await synthesize(sessions, ch, null, speed);
      parts.push(a);
      total += a.length;
    }
    const audio = new Float32Array(total);
    let off = 0;
    for (const a of parts) { audio.set(a, off); off += a.length; }
    if (outPath) writeWav(outPath, audio, 24000);
    return audio;
  }
}

module.exports = { TTS };
