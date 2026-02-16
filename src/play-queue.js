/**
 * PlayQueue - 播放队列管理器
 * 遍历 Listext AST，将每个标签转化为播放任务
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
    
    // 回调函数
    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;
    this.onBlockHighlight = null;
    this.onTtsFallback = null;
    this.onTtsError = null;
  }

  /**
   * 加载音效库
   */
  async loadEffects() {
    if (window.electronAPI) {
      this.effectLibrary = await window.electronAPI.loadEffects();
    }
  }

  /**
   * 构建 AST 播放队列
   */
  buildQueue(ast) {
    this.queue = [];
    this.buildQueueFromNodes(ast);
    this.currentIndex = 0;
    return this.queue;
  }

  /**
   * 递归构建队列
   */
  buildQueueFromNodes(nodes, inRepeat = false) {
    for (const node of nodes) {
      if (node.type === 'text') continue;
      
      const task = this.createTaskForNode(node);
      
      if (node.tagName === 'repeat') {
        const childTasks = [];
        this.collectChildTasks(node.children, childTasks);
        const count = node.attrs?.count ? parseInt(node.attrs.count) : 2;
        for (let i = 0; i < count; i++) {
          this.queue.push(...childTasks);
        }
      } else if (node.tagName === 't') {
        // 测试块：正常播放子节点
        this.buildQueueFromNodes(node.children, inRepeat);
      } else if (task) {
        this.queue.push(task);
      }
    }
  }

  /**
   * 收集子任务
   */
  collectChildTasks(children, tasks) {
    for (const node of children) {
      if (node.type === 'text') continue;
      
      const task = this.createTaskForNode(node);
      if (task) {
        tasks.push(task);
      }
      
      if (node.children && node.children.length > 0) {
        this.collectChildTasks(node.children, tasks);
      }
    }
  }

  /**
   * 为节点创建任务
   */
  createTaskForNode(node) {
    const tagName = node.tagName;
    
    switch (tagName) {
      case 'say':
        {
          const roleId = node.attrs?.role || '';
          const role = roleId ? this.getRole(roleId) : null;
          const ttsType = role?.type || 'local';
          const voice = role?.voice || null;
          const rate = node.attrs?.rate ? parseFloat(node.attrs.rate) : this.ttsEngine.getRateForNode(node);
          return {
            type: 'tts',
            node,
            text: node.content,
            ttsType,
            roleId,
            voice,
            rate,
            estimatedDuration: this.ttsEngine.estimateDuration(node.content, rate)
          };
        }
      
      case 'v':
        {
          const roleId = node.attrs?.id || '';
          const role = this.getRole(roleId);
          const ttsType = role?.type || 'local';
          const voice = role?.voice || null;
          // 优先使用标签上的 rate，其次是角色设定的 rate，最后是默认值
          const rate = node.attrs?.rate 
            ? parseFloat(node.attrs.rate) 
            : (role?.rate ? parseFloat(role.rate) : this.ttsEngine.getRateForNode(node));
          return {
            type: 'tts',
            node,
            text: node.content,
            ttsType,
            roleId,
            voice,
            rate,
            estimatedDuration: this.ttsEngine.estimateDuration(node.content, rate)
          };
        }

      case 'pause':
        const duration = this.parseSilenceDuration(node);
        return {
          type: 'silence',
          node,
          duration,
          estimatedDuration: duration
        };
      
      case 'fx':
        return {
          type: 'effect',
          node,
          effectId: node.attrs?.id || 'bell',
          maxDuration: node.attrs?.dur ? parseInt(node.attrs.dur) : null,
          fadeDuration: node.attrs?.fade ? parseInt(node.attrs.fade) : null,
          estimatedDuration: node.attrs?.dur ? parseInt(node.attrs.dur) : 5
        };
      
      case 'divider':
        return null;

      default:
        return null;
    }
  }

  /**
   * 解析静音时长
   */
  parseSilenceDuration(node) {
    if (node.attrs?.dur) {
      return parseInt(node.attrs.dur) || 10;
    }
    
    const keys = Object.keys(node.attrs || {});
    if (keys.length > 0) {
      const val = node.attrs[keys[0]];
      if (!isNaN(parseInt(val))) {
        return parseInt(val);
      }
    }
    
    return 10;
  }

  /**
   * 开始播放
   */
  async play(ast) {
    if (this.isPlaying && this.isPaused) {
      this.isPaused = false;
      this.ttsEngine.resume();
      return;
    }
    
    if (this.isPlaying) {
      this.stop();
    }
    
    await this.loadEffects();
    this.buildQueue(ast);
    this.isPlaying = true;
    this.isPaused = false;
    
    this.executeQueue();
  }

  /**
   * 执行播放队列
   */
  async executeQueue() {
    while (this.currentIndex < this.queue.length && this.isPlaying) {
      if (this.isPaused) {
        await this.waitForResume();
      }
      
      const task = this.queue[this.currentIndex];
      
      // 进度回调
      if (this.onProgress) {
        this.onProgress({
          current: this.currentIndex,
          total: this.queue.length,
          task
        });
      }
      
      // 高亮当前块
      if (this.onBlockHighlight) {
        this.onBlockHighlight(task.node, true);
      }
      
      try {
        await this.executeTask(task);
      } catch (error) {
        if (this.onError) {
          this.onError(error, task);
        }
      }
      
      // 取消高亮
      if (this.onBlockHighlight) {
        this.onBlockHighlight(task.node, false);
      }
      
      this.currentIndex++;
    }
    
    this.isPlaying = false;
    
    if (this.onComplete) {
      this.onComplete();
    }
  }

  /**
   * 执行单个任务
   */
  async executeTask(task) {
    switch (task.type) {
      case 'tts':
        await this.playTTS(task);
        break;
      case 'silence':
        await this.playSilence(task);
        break;
      case 'effect':
        await this.playEffect(task);
        break;
    }
  }

  /**
   * 播放 TTS
   */
  async playTTS(task) {
    if (task.ttsType === 'edge' && window.electronAPI) {
      const ratePercent = this.convertRateToEdge(task.rate || 1.0);
      const voiceName = this.resolveVoice(task);
      if (!voiceName) {
        if (this.onTtsFallback) this.onTtsFallback();
        try {
          await this.playLocalTTS(task);
        } catch (error) {
          if (this.onTtsError) this.onTtsError('系统TTS不可用');
          throw error;
        }
        return;
      }
      try {
        const res = await window.electronAPI.synthesizeTTS(task.text, voiceName, ratePercent);
        if (res && res.success && res.path) {
          await new Promise((resolve, reject) => {
            const audio = new Audio();
            this.currentAudio = audio; // 保存当前 audio 对象以便停止
            audio.src = this.toFileUrl(res.path);
            const cleanup = () => {
              this.currentAudio = null;
              audio.onended = null;
              audio.onerror = null;
            };
            const done = () => {
              cleanup();
              resolve();
            };
            const err = (e) => {
              cleanup();
              // 如果是被中断（pause/stop），不应该抛出错误，而是静默结束
              if (!this.isPlaying) {
                resolve(); 
              } else {
                reject(e);
              }
            };
            audio.onended = done;
            audio.onerror = err;
            audio.play().catch(e => {
               // 处理播放过程中的 AbortError (如调用 pause())
               if (e.name === 'AbortError' || !this.isPlaying) {
                 done();
               } else {
                 err(e);
               }
            });
          });
        } else {
          throw new Error(res?.error || 'EdgeTTS 合成失败');
        }
      } catch (error) {
        // 如果是因为停止播放导致的错误，直接返回
        if (!this.isPlaying) return;
        
        console.error('EdgeTTS Error:', error);
        if (this.onTtsFallback) this.onTtsFallback();
        try {
          await this.playLocalTTS(task);
        } catch (localError) {
          if (this.onTtsError) this.onTtsError('EdgeTTS 失败，系统TTS不可用');
          throw localError;
        }
      }
    } else {
      try {
        await this.playLocalTTS(task);
      } catch (error) {
        if (this.onTtsError) this.onTtsError('系统TTS不可用');
        throw error;
      }
    }
  }
  
  async playLocalTTS(task) {
    return new Promise((resolve, reject) => {
      if (!('speechSynthesis' in window)) {
        reject(new Error('系统TTS不可用'));
        return;
      }
      const utterance = new SpeechSynthesisUtterance(task.text);
      const voices = speechSynthesis.getVoices();
      let targetVoice = null;
      const voiceName = this.resolveVoice(task);
      if (voiceName) {
        targetVoice = voices.find(v => v.name === voiceName) || null;
      }
      if (!targetVoice && task.voiceKey) {
        targetVoice = this.ttsEngine.findBestVoice(voices, task.voiceKey);
      }
      if (targetVoice) {
        utterance.voice = targetVoice;
      }
      utterance.rate = task.rate || 1.0;
      utterance.lang = 'zh-CN';
      utterance.onend = () => resolve();
      utterance.onerror = (e) => reject(e);
      speechSynthesis.speak(utterance);
    });
  }

  /**
   * 播放静音
   */
  async playSilence(task) {
    return new Promise((resolve) => {
      setTimeout(resolve, task.duration * 1000);
    });
  }

  /**
   * 播放音效
   */
  async playEffect(task) {
    return new Promise((resolve, reject) => {
      const effectPath = this.effectLibrary[task.effectId];
      
      if (!effectPath) {
        // 播放默认提示音
        console.warn(`音效 "${task.effectId}" 未找到`);
        resolve();
        return;
      }
      
      const audio = new Audio();
      audio.src = this.toFileUrl(effectPath);
      
      let resolved = false;
      const doResolve = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      
      audio.onended = doResolve;
      audio.onerror = () => {
        console.error(`音效播放失败: ${task.effectId}`);
        doResolve();
      };
      
      // 如果设置了最大时长，超时后截断
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
              if (step >= steps) {
                clearInterval(timer);
              }
            }, 50);
          }, startFadeAt);
        }
        setTimeout(() => {
          try {
            audio.pause();
          } catch (e) {}
          doResolve();
        }, total);
      }
      
      audio.play().catch(err => {
        console.error('音效播放错误:', err);
        doResolve();
      });
    });
  }
  
  getRole(id) {
    try {
      const raw = localStorage.getItem('listext_roles') || '[]';
      const roles = JSON.parse(raw);
      return roles.find(r => r.id === id) || null;
    } catch (e) {
      return null;
    }
  }
  
  resolveVoice(task) {
    if (task.voice) return task.voice;
    const role = task.roleId ? this.getRole(task.roleId) : null;
    if (role && role.voice) return role.voice;
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

  /**
   * 暂停播放
   */
  pause() {
    if (this.isPlaying) {
      this.isPaused = true;
      this.ttsEngine.pause();
      if (this.currentAudio) {
        this.currentAudio.pause();
      }
    }
  }

  /**
   * 停止播放
   */
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

  /**
   * 恢复播放
   */
  resume() {
    if (this.isPaused && this.isPlaying) {
      this.isPaused = false;
      this.ttsEngine.resume();
      if (this.currentAudio) {
        this.currentAudio.play();
      }
    }
  }

  /**
   * 等待恢复
   */
  waitForResume() {
    return new Promise((resolve) => {
      const checkResume = () => {
        if (!this.isPaused || !this.isPlaying) {
          resolve();
        } else {
          setTimeout(checkResume, 100);
        }
      };
      checkResume();
    });
  }

  /**
   * 获取总预估时长 (秒)
   */
  getTotalEstimatedDuration() {
    return this.queue.reduce((sum, task) => sum + (task.estimatedDuration || 0), 0);
  }

  /**
   * 格式化时长显示
   */
  formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PlayQueue;
}
