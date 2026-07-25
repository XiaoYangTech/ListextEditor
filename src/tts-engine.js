/**
 * TTS 引擎
 */
class TTSEngine {
  stop() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TTSEngine;
}
