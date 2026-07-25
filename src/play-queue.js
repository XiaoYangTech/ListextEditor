/**
 * PlayQueue - 播放队列管理器
 */
class PlayQueue {
  constructor(ttsEngine, parser) {
    this.ttsEngine = ttsEngine;
    this.parser = parser;
    this.queue = [];
    this.currentIndex = 0;
    this.isPlaying = false;
    this.isPaused = false;
    this.effectLibrary = {};

    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;
    this.onBlockHighlight = null;
    this.onTtsFallback = null;
    this.onTtsError = null;
    this.currentEffectAudio = null;
    this.effectFadeTimer = null;
  }

  async loadEffects() {
    const tab = window.app?.tabManager?.getActiveTab();
    const projectEffects = tab?.effects || [];
    const builtinSounds = window.electronAPI ? await window.electronAPI.listBuiltinSounds() || [] : [];

    this.effectLibrary = {};
    for (const effect of projectEffects) {
      let effectPath = effect.path;
      if (!effectPath && effect.source === 'builtin') {
        const builtin = builtinSounds.find(b => b.filename === effect.filename);
        if (builtin) effectPath = builtin.path;
      }
      const key = effect.id;
      if (effectPath && key) {
        this.effectLibrary[key] = effectPath;
      }
    }

    for (const builtin of builtinSounds) {
      const key = builtin.id;
      if (key && !this.effectLibrary[key] && builtin.path) {
        this.effectLibrary[key] = builtin.path;
      }
    }
  }

  buildQueue(ast) {
    this.queue = [];
    this.buildQueueFromNodes(ast);
    this.currentIndex = 0;
    return this.queue;
  }

  buildQueueFromNodes(nodes) {
    for (const node of nodes) {
      if (node.type === 'text') continue;
      const task = this.createTaskForNode(node);

      if (node.tagName === 'repeat') {
        const childTasks = [];
        this.collectChildTasks(node.children || [], childTasks);
        const count = node.attrs?.count ? parseInt(node.attrs.count, 10) : LISTEXT_CONSTANTS.DEFAULT_REPEAT_COUNT;
        for (let i = 0; i < count; i++) this.queue.push(...childTasks);
      } else if (task) {
        this.queue.push(task);
      }
    }
  }

  collectChildTasks(children, tasks) {
    for (const node of children) {
      if (node.type === 'text') continue;
      if (node.tagName === 'repeat') {
        const inner = [];
        this.collectChildTasks(node.children || [], inner);
        const count = node.attrs?.count ? parseInt(node.attrs.count, 10) : LISTEXT_CONSTANTS.DEFAULT_REPEAT_COUNT;
        for (let i = 0; i < count; i++) tasks.push(...inner);
        continue;
      }
      const task = this.createTaskForNode(node);
      if (task) tasks.push(task);
      if (node.children?.length) this.collectChildTasks(node.children, tasks);
    }
  }

  createTaskForNode(node) {
    switch (node.tagName) {
      case 'say': {
        const roleId = node.attrs?.role || '';
        const role = roleId ? this.getRole(roleId) : null;
        const defaultTtsType = 'edge';
        const ttsType = role?.type || defaultTtsType;
        const voice = role?.voice || null;
        const rate = node.attrs?.rate ? parseFloat(node.attrs.rate) : 1.0;
        return {
          type: 'tts', node, text: node.content || '', ttsType, roleId, voice, rate,
        };
      }
      case 'pause': {
        const duration = this.parsePause(node);
        return { type: 'silence', node, duration };
      }
      case 'fx': {
        return {
          type: 'effect',
          node,
          effectId: node.attrs?.id || '',
          maxDuration: node.attrs?.dur ? parseInt(node.attrs.dur, 10) : null,
          fadeDuration: node.attrs?.fade ? parseInt(node.attrs.fade, 10) : null,
        };
      }
      case 'divider':
      case 'section':
      default:
        return null;
    }
  }

  parsePause(node) {
    if (node.attrs?.dur) return parseInt(node.attrs.dur, 10) || LISTEXT_CONSTANTS.DEFAULT_PAUSE_DURATION;
    return LISTEXT_CONSTANTS.DEFAULT_PAUSE_DURATION;
  }

  async play(ast) {
    if (this.isPlaying && this.isPaused) {
      this.resume();
      return;
    }

    if (this.isPlaying) this.stop();

    await this.loadEffects();
    this.buildQueue(ast);
    this.isPlaying = true;
    this.isPaused = false;

    this.executeQueue();
  }

  async executeQueue() {
    while (this.currentIndex < this.queue.length && this.isPlaying) {
      if (this.isPaused) await this.waitForResume();
      const task = this.queue[this.currentIndex];

      if (this.onProgress) this.onProgress({ current: this.currentIndex, total: this.queue.length, task });
      if (this.onBlockHighlight) this.onBlockHighlight(task.node, true);

      try {
        await this.executeTask(task);
      } catch (error) {
        if (this.onError) this.onError(error, task);
      }

      if (this.onBlockHighlight) this.onBlockHighlight(task.node, false);
      this.currentIndex++;
    }

    this.isPlaying = false;
    if (this.onComplete) this.onComplete();
  }

  async executeTask(task) {
    if (task.type === 'tts') await this.playTTS(task);
    else if (task.type === 'silence') await this.playSilence(task);
    else if (task.type === 'effect') await this.playEffect(task);
  }

  async playTTS(task) {
    if (task.ttsType === 'edge' && window.electronAPI) {
      const ratePercent = this.convertRateToEdge(task.rate || 1.0);
      const voiceName = this.resolveVoice(task);
      try {
        const res = await window.electronAPI.synthesizeTTS(task.text, voiceName, ratePercent);
        if (res?.success && res.path) {
          await new Promise((resolve, reject) => {
            const audio = new Audio();
            this.currentAudio = audio;
            audio.src = this.toFileUrl(res.path);
            let settled = false;
            const finish = (isError, e) => {
              if (settled) return;
              settled = true;
              if (this._ttsSettle === onStop) this._ttsSettle = null;
              this.currentAudio = null;
              if (!isError || !this.isPlaying) resolve();
              else reject(e);
            };
            // stop() 时主动结算，避免 executeQueue 永久挂起
            const onStop = () => { try { audio.pause(); } catch {} finish(false); };
            this._ttsSettle = onStop;
            audio.onended = () => finish(false);
            audio.onerror = (e) => finish(true, e);
            audio.play().catch(e => finish(true, e));
          });
          return;
        }
        throw new Error(res?.error || 'EdgeTTS 合成失败');
      } catch (error) {
        if (!this.isPlaying) return;
        if (this.onTtsError) this.onTtsError('EdgeTTS 合成失败: ' + (error.message || error));
      }
      return;
    }

    return this.playLocalTTS(task);
  }

  async playLocalTTS(task) {
    const platform = window.electronAPI?.platform;
    if (platform === 'linux' || platform === 'darwin') {
      const msg = '当前平台已禁用系统TTS，请改用 EdgeTTS 角色';
      if (this.onTtsError) this.onTtsError(msg);
      throw new Error(msg);
    }

    return new Promise((resolve, reject) => {
      if (!('speechSynthesis' in window)) {
        reject(new Error('系统TTS不可用'));
        return;
      }
      const utterance = new SpeechSynthesisUtterance(task.text);
      const voices = speechSynthesis.getVoices();
      let targetVoice = null;
      const voiceName = this.resolveVoice(task);
      if (voiceName) targetVoice = voices.find(v => v.name === voiceName) || null;
      if (targetVoice) {
        utterance.voice = targetVoice;
        utterance.lang = targetVoice.lang;
      }
      utterance.rate = task.rate || 1.0;
      utterance.onend = () => resolve();
      utterance.onerror = (e) => reject(e);
      speechSynthesis.speak(utterance);
    });
  }

  async playSilence(task) {
    return new Promise((resolve) => setTimeout(resolve, task.duration * 1000));
  }

  async playEffect(task) {
    return new Promise((resolve) => {
      if (!task.effectId) return resolve();
      const effectPath = this.effectLibrary[task.effectId];
      if (!effectPath) {
        console.warn(`音效 "${task.effectId}" 无法播放：文件路径无效`);
        window.app?.updateStatus?.(`警告: 音效 "${task.effectId}" 文件未找到`);
        return resolve();
      }

      const audio = new Audio();
      audio.src = this.toFileUrl(effectPath);
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          if (this.currentEffectAudio === audio) {
            this.currentEffectAudio = null;
          }
          if (this.effectFadeTimer) {
            clearInterval(this.effectFadeTimer);
            this.effectFadeTimer = null;
          }
          resolve();
        }
      };

      this.currentEffectAudio = audio;

      audio.onended = done;
      audio.onerror = done;

      if (task.maxDuration) {
        // 用 currentTime 轮询实现截断/淡出：暂停时 currentTime 冻结，计时随之暂停
        const total = task.maxDuration;
        const fade = Math.max(0, task.fadeDuration || 0);
        const startVolume = audio.volume;
        this.effectFadeTimer = setInterval(() => {
          if (resolved) return;
          const t = audio.currentTime;
          if (fade > 0 && t >= total - fade) {
            audio.volume = Math.max(0, startVolume * (total - t) / fade);
          }
          if (t >= total) {
            try { audio.pause(); } catch (e) { console.error('音频暂停失败:', e); }
            done();
          }
        }, 50);
      }

      audio.play().catch(done);
    });
  }

  getRole(id) {
    const tab = window.app?.tabManager?.getActiveTab();
    const roles = tab?.roles || [];
    return roles.find(r => r.id === id) || null;
  }

  resolveVoice(task) {
    if (task.voice) return task.voice;
    const role = task.roleId ? this.getRole(task.roleId) : null;
    if (role?.voice) return role.voice;
    if (task.ttsType === 'edge') return LISTEXT_CONSTANTS.DEFAULT_EDGE_VOICE;
    return null;
  }

  convertRateToEdge(rate) {
    const percent = Math.round((rate - 1) * 100);
    const sign = percent >= 0 ? '+' : '';
    return `${sign}${percent}%`;
  }

  toFileUrl(filePath) {
    if (!filePath) return '';
    const normalized = filePath.replace(/\\/g, '/');
    return `file:///${encodeURI(normalized)}`;
  }

  pause() {
    if (this.isPlaying) {
      this.isPaused = true;
      this.ttsEngine.pause();
      if (this.currentAudio) this.currentAudio.pause();
      if (this.currentEffectAudio) this.currentEffectAudio.pause();
    }
  }

  stop() {
    this.isPlaying = false;
    this.isPaused = false;
    this.currentIndex = 0;
    this.ttsEngine.stop();
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    if (this.currentEffectAudio) {
      this.currentEffectAudio.pause();
      this.currentEffectAudio.currentTime = 0;
      this.currentEffectAudio = null;
    }
    if (this.effectFadeTimer) {
      clearInterval(this.effectFadeTimer);
      this.effectFadeTimer = null;
    }
    // 主动结算挂起的 TTS 播放 Promise，避免 executeQueue 永久 await
    if (this._ttsSettle) {
      const settle = this._ttsSettle;
      this._ttsSettle = null;
      settle();
    }
  }

  resume() {
    if (this.isPaused && this.isPlaying) {
      this.isPaused = false;
      this.ttsEngine.resume();
      if (this.currentAudio) this.currentAudio.play();
      if (this.currentEffectAudio) this.currentEffectAudio.play().catch(() => {});
    }
  }

  waitForResume() {
    return new Promise((resolve) => {
      const check = () => {
        if (!this.isPaused || !this.isPlaying) resolve();
        else setTimeout(check, 100);
      };
      check();
    });
  }

}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PlayQueue;
}
