/**
 * TTS 引擎
 */
class TTSEngine {
  constructor() {
    this.audioCache = new Map();
  }

  stop() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }

  getRateForNode() { return 1.0; }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TTSEngine;
}
