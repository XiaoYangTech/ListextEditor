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
  }

  async loadEffects() {
    if (window.electronAPI) this.effectLibrary = await window.electronAPI.loadEffects();
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
        const count = node.attrs?.count ? parseInt(node.attrs.count, 10) : 2;
        for (let i = 0; i < count; i++) this.queue.push(...childTasks);
      } else if (task) {
        this.queue.push(task);
      }
    }
  }

  collectChildTasks(children, tasks) {
    for (const node of children) {
      if (node.type === 'text') continue;
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
        const platform = window.electronAPI?.platform;
        const defaultTtsType = (platform === 'linux' || platform === 'darwin') ? 'edge' : 'local';
        const ttsType = role?.type || defaultTtsType;
        const voice = role?.voice || null;
        const rate = node.attrs?.rate ? parseFloat(node.attrs.rate) : this.ttsEngine.getRateForNode(node);
        return {
          type: 'tts', node, text: node.content || '', ttsType, roleId, voice, rate,
          estimatedDuration: this.ttsEngine.estimateDuration(node.content || '', rate)
        };
      }
      case 'pause': {
        const duration = this.parsePause(node);
        return { type: 'silence', node, duration, estimatedDuration: duration };
      }
      case 'fx': {
        return {
          type: 'effect',
          node,
          effectId: node.attrs?.id || '',
          maxDuration: node.attrs?.dur ? parseInt(node.attrs.dur, 10) : null,
          fadeDuration: node.attrs?.fade ? parseInt(node.attrs.fade, 10) : null,
          estimatedDuration: node.attrs?.dur ? parseInt(node.attrs.dur, 10) : 3
        };
      }
      case 'divider':
      case 'section':
      default:
        return null;
    }
  }

  parsePause(node) {
    if (node.attrs?.dur) return parseInt(node.attrs.dur, 10) || 10;
    return 10;
  }

  async play(ast) {
    if (this.isPlaying && this.isPaused) {
      this.isPaused = false;
      this.ttsEngine.resume();
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
      if (!voiceName) {
        if (this.onTtsFallback) this.onTtsFallback();
        return this.playLocalTTS(task);
      }
      try {
        const res = await window.electronAPI.synthesizeTTS(task.text, voiceName, ratePercent);
        if (res?.success && res.path) {
          await new Promise((resolve, reject) => {
            const audio = new Audio();
            this.currentAudio = audio;
            audio.src = this.toFileUrl(res.path);
            const done = () => { this.currentAudio = null; resolve(); };
            const err = (e) => { this.currentAudio = null; (!this.isPlaying ? resolve() : reject(e)); };
            audio.onended = done;
            audio.onerror = err;
            audio.play().catch(err);
          });
          return;
        }
        throw new Error(res?.error || 'EdgeTTS 合成失败');
      } catch (error) {
        if (!this.isPlaying) return;
        if (this.onTtsFallback) this.onTtsFallback();
        return this.playLocalTTS(task);
      }
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
      if (targetVoice) utterance.voice = targetVoice;
      utterance.rate = task.rate || 1.0;
      utterance.lang = 'zh-CN';
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
      if (!effectPath) return resolve();

      const audio = new Audio();
      audio.src = this.toFileUrl(effectPath);
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };

      audio.onended = done;
      audio.onerror = done;

      if (task.maxDuration) {
        const total = task.maxDuration * 1000;
        const fadeMs = Math.max(0, (task.fadeDuration || 0) * 1000);
        const startFadeAt = total - fadeMs;
        if (fadeMs > 0 && startFadeAt > 0) {
          setTimeout(() => {
            const startVolume = audio.volume;
            const steps = Math.max(1, Math.floor(fadeMs / 50));
            let step = 0;
            const timer = setInterval(() => {
              step++;
              const ratio = 1 - step / steps;
              audio.volume = Math.max(0, startVolume * ratio);
              if (step >= steps) clearInterval(timer);
            }, 50);
          }, startFadeAt);
        }
        setTimeout(() => { try { audio.pause(); } catch {} done(); }, total);
      }

      audio.play().catch(done);
    });
  }

  getRole(id) {
    try {
      const raw = localStorage.getItem('listext_roles') || '[]';
      const roles = JSON.parse(raw);
      return roles.find(r => r.id === id) || null;
    } catch {
      return null;
    }
  }

  resolveVoice(task) {
    if (task.voice) return task.voice;
    const role = task.roleId ? this.getRole(task.roleId) : null;
    if (role?.voice) return role.voice;
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
  }

  resume() {
    if (this.isPaused && this.isPlaying) {
      this.isPaused = false;
      this.ttsEngine.resume();
      if (this.currentAudio) this.currentAudio.play();
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

  getTotalEstimatedDuration() {
    return this.queue.reduce((sum, task) => sum + (task.estimatedDuration || 0), 0);
  }

  formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PlayQueue;
}
