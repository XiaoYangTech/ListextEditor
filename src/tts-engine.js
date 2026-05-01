/**
 * TTS 引擎
 */
class TTSEngine {
  constructor() {
    this.audioCache = new Map();
  }

  async synthesize(text, options = {}) {
    const {
      voice = 'female',
      rate = 1.0,
      pitch = 1.0,
      volume = 1.0,
      fallback = true
    } = options;

    // 1) 优先 EdgeTTS
    if (window.electronAPI?.synthesizeTTS) {
      try {
        let rateStr = '+0%';
        if (rate !== 1.0) {
          const percent = Math.round((rate - 1.0) * 100);
          rateStr = (percent >= 0 ? '+' : '') + percent + '%';
        }

        const result = await window.electronAPI.synthesizeTTS(text, voice, rateStr);
        if (result.success && result.path) {
          return { audioPath: result.path, text, duration: this.estimateDuration(text, rate) };
        }
        if (!fallback) throw new Error(result.error || 'EdgeTTS synthesis failed');
      } catch (e) {
        if (!fallback) throw e;
      }
    }

    // 2) 回退系统 TTS：在 Linux/macOS 禁用
    const platform = window.electronAPI?.platform;
    if (platform === 'linux' || platform === 'darwin') {
      throw new Error('当前平台已禁用系统TTS，请使用 EdgeTTS。');
    }

    return new Promise((resolve, reject) => {
      if (!('speechSynthesis' in window)) {
        reject(new Error('浏览器不支持语音合成'));
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      const voices = speechSynthesis.getVoices();
      const targetVoice = this.findBestVoice(voices, voice);
      if (targetVoice) utterance.voice = targetVoice;

      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.volume = volume;
      utterance.lang = 'zh-CN';

      utterance.onend = () => resolve({ text, duration: text.length * 0.3 });
      utterance.onerror = (e) => reject(e);

      speechSynthesis.speak(utterance);
    });
  }

  findBestVoice(voices, voiceKey) {
    return voices.find(v => v.name === voiceKey) || null;
  }

  stop() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
  pause() { if ('speechSynthesis' in window) speechSynthesis.pause(); }
  resume() { if ('speechSynthesis' in window) speechSynthesis.resume(); }

  getAvailableVoices() {
    return new Promise((resolve) => {
      const voices = speechSynthesis.getVoices();
      if (voices.length > 0) resolve(voices);
      else speechSynthesis.onvoiceschanged = () => resolve(speechSynthesis.getVoices());
    });
  }

  estimateDuration(text, rate = 1.0) {
    const charCount = text.length;
    const baseDuration = charCount / 3.5;
    return baseDuration / rate;
  }

  getRateForNode() { return 1.0; }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TTSEngine;
}
