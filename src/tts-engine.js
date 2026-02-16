/**
 * TTS 引擎 - 基于 EdgeTTS 的文本转语音引擎
 */

class TTSEngine {
  constructor() {
    // 缓存已合成的音频
    this.audioCache = new Map();
  }

  /**
   * 合成文本为音频 (优先使用 EdgeTTS，失败则回退到 Web Speech API)
   */
  async synthesize(text, options = {}) {
    const {
      voice = 'female',
      rate = 1.0,
      pitch = 1.0,
      volume = 1.0,
      fallback = true // 是否允许回退到系统 TTS
    } = options;
    
    // 1. 尝试使用 EdgeTTS (通过 Electron IPC)
    if (window.electronAPI && window.electronAPI.synthesizeTTS) {
      try {
        // 将速率转换为字符串格式，例如 "+0%" 或 "-10%"
        // 这里简单映射：1.0 -> +0%, 1.1 -> +10%, 0.9 -> -10%
        let rateStr = '+0%';
        if (rate !== 1.0) {
          const percent = Math.round((rate - 1.0) * 100);
          rateStr = (percent >= 0 ? '+' : '') + percent + '%';
        }
        
        const result = await window.electronAPI.synthesizeTTS(text, voice, rateStr);
        
        if (result.success && result.path) {
          // 返回音频文件路径，播放器需要能处理它
          // 我们这里返回一个 Promise，模拟 SpeechSynthesis 的行为，但实际上我们返回的是文件路径
          // 调用者需要知道如何处理 { audioPath: ... }
          return {
            audioPath: result.path,
            text,
            duration: this.estimateDuration(text, rate) // 估算时长
          };
        } else {
          console.warn('EdgeTTS failed:', result.error);
          if (!fallback) {
             throw new Error(result.error || 'EdgeTTS synthesis failed');
          }
          // Fallback continue...
        }
      } catch (e) {
        console.error('EdgeTTS error:', e);
        if (!fallback) throw e;
        // Fallback continue...
      }
    }

    // 2. 回退到 Web Speech API
    // 检查是否在 Linux 且没有系统 TTS
    if ((window.electronAPI?.platform === 'linux' || (typeof process !== 'undefined' && process.platform === 'linux')) && !('speechSynthesis' in window)) {
        throw new Error('Linux 系统且未检测到系统 TTS，无法播放。');
    }

    return new Promise((resolve, reject) => {
      if (!('speechSynthesis' in window)) {
        reject(new Error('浏览器不支持语音合成'));
        return;
      }
      
      const utterance = new SpeechSynthesisUtterance(text);
      
      // 设置语音
      const voices = speechSynthesis.getVoices();
      const targetVoice = this.findBestVoice(voices, voice);
      if (targetVoice) {
        utterance.voice = targetVoice;
      }
      
      // 设置参数
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.volume = volume;
      
      // 中文语音设置
      utterance.lang = 'zh-CN';
      
      utterance.onend = () => {
        resolve({
          text,
          duration: text.length * 0.3 // 估算时长
        });
      };
      
      utterance.onerror = (e) => {
        reject(e);
      };
      
      speechSynthesis.speak(utterance);
    });
  }

  /**
   * 查找最佳匹配语音
   */
  findBestVoice(voices, voiceKey) {
    return voices.find(v => v.name === voiceKey) || null;
  }

  /**
   * 停止播放
   */
  stop() {
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
    }
  }

  /**
   * 暂停播放
   */
  pause() {
    if ('speechSynthesis' in window) {
      speechSynthesis.pause();
    }
  }

  /**
   * 恢复播放
   */
  resume() {
    if ('speechSynthesis' in window) {
      speechSynthesis.resume();
    }
  }

  /**
   * 获取可用语音列表
   */
  getAvailableVoices() {
    return new Promise((resolve) => {
      const voices = speechSynthesis.getVoices();
      if (voices.length > 0) {
        resolve(voices);
      } else {
        speechSynthesis.onvoiceschanged = () => {
          resolve(speechSynthesis.getVoices());
        };
      }
    });
  }

  /**
   * 估算文本朗读时长 (秒)
   */
  estimateDuration(text, rate = 1.0) {
    // 中文平均朗读速度约为每秒 3-4 个字
    const charCount = text.length;
    const baseDuration = charCount / 3.5;
    return baseDuration / rate;
  }

  /**
   * 为节点获取语速
   */
  getRateForNode(node) {
    if (node.tagName === 'q') {
      return 0.9; // 问题语速稍慢
    }
    return 1.0;
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TTSEngine;
}
