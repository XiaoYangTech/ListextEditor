class ExportHandler {
  constructor(api, statusCallback) {
    this.api = api || window.electronAPI;
    this.statusCallback = statusCallback;
  }

  updateStatus(text) {
    if (this.statusCallback) this.statusCallback(text);
    if (window.app?.updateStatus) window.app.updateStatus(text);
  }

  async exportAudio(content, parser, playQueue, filePath) {
    const api = this.api || window.electronAPI;
    if (!api) return this.updateStatus('导出失败：当前环境不支持');

    this.updateStatus('正在准备导出...');

    try {
      const effectiveContent = typeof content === 'string' ? content : (window.app?.getContent?.() || '');
      const effectiveParser = parser || window.app?.parser;
      const effectiveQueue = playQueue || window.app?.playQueue;
      if (!effectiveParser || !effectiveQueue) return this.updateStatus('导出失败：导出上下文缺失');

      let targetPath = filePath;
      if (!targetPath) {
        if (typeof api.selectExportPath !== 'function') return this.updateStatus('导出失败：selectExportPath 不可用');
        targetPath = await api.selectExportPath();
      }
      if (!targetPath) return this.updateStatus('已取消导出');

      const ast = effectiveParser.parse(effectiveContent || '');
      if (!ast.length) return this.updateStatus('没有可导出的内容');

      const queue = effectiveQueue.buildQueue(ast);
      const effects = await api.loadEffects();

      // fast path: 单任务直接导出源音频（避免白屏）
      if (queue.length === 1) {
        const ok = await this.tryFastExportSingleTask(queue[0], targetPath, effectiveQueue, effects, api);
        if (ok) {
          this.updateStatus('导出完成');
          setTimeout(() => window.app?.updateStatus?.('就绪'), 1200);
          return;
        }
      }

      // fallback: WAV 混音管线
      await this.exportWithWavPipeline(queue, targetPath, effectiveQueue, effects, api);
    } catch (error) {
      console.error('导出过程出错:', error);
      this.updateStatus('导出出错: ' + (error?.message || String(error)));
    }
  }

  async tryFastExportSingleTask(task, targetPath, playQueue, effects, api) {
    try {
      const ext = (targetPath.split('.').pop() || '').toLowerCase();

      if (task.type === 'tts') {
        const role = playQueue.getRole(task.roleId || '');
        const voice = task.voice || (role ? role.voice : null);
        const rate = playQueue.convertRateToEdge(task.rate || 1.0);
        const res = await api.synthesizeTTS(task.text || '', voice, rate);
        if (!res?.success || !res.path) return false;
        const fileRes = await api.getAudioFile(res.path);
        if (!fileRes?.success || !fileRes.data) return false;

        // TTS 输出通常 mp3。若用户选 wav，走混音管线。
        if (ext === 'wav') return false;

        const save = await api.saveBinary(targetPath, fileRes.data);
        return !!save?.success;
      }

      if (task.type === 'effect') {
        const effectPath = effects?.[task.effectId];
        if (!effectPath) return false;
        if (task.maxDuration || task.fadeDuration) return false; // 需要处理时长/淡出，走混音管线

        const fileRes = await api.getAudioFile(effectPath);
        if (!fileRes?.success || !fileRes.data) return false;

        // 源音效通常压缩格式，wav 时走混音管线
        if (ext === 'wav') return false;

        const save = await api.saveBinary(targetPath, fileRes.data);
        return !!save?.success;
      }

      return false;
    } catch (e) {
      console.warn('快速导出失败，回退到混音管线:', e);
      return false;
    }
  }

  async exportWithWavPipeline(queue, targetPath, playQueue, effects, api) {
    const sampleRate = 44100;
    const channels = 2;
    const buffers = [];
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return this.updateStatus('导出失败：浏览器不支持音频上下文');

    const audioContext = new AudioCtx({ sampleRate });

    try {
      this.updateStatus(`开始导出，共 ${queue.length} 个任务...`);

      for (let i = 0; i < queue.length; i++) {
        const task = queue[i];
        this.updateStatus(`正在处理任务 ${i + 1}/${queue.length}...`);

        if (task.type === 'tts') {
          const role = playQueue.getRole(task.roleId || '');
          const voice = task.voice || (role ? role.voice : null);
          const rate = playQueue.convertRateToEdge(task.rate || 1.0);
          const res = await api.synthesizeTTS(task.text || '', voice, rate);
          if (res?.success && res.path) {
            const fileRes = await api.getAudioFile(res.path);
            if (fileRes?.success && fileRes.data) {
              const audioBuffer = await this.decodeAudioData(audioContext, fileRes.data);
              if (audioBuffer) buffers.push(this.resampleAndStereo(audioBuffer, channels));
            }
          }
        }

        if (task.type === 'effect') {
          const effectPath = effects?.[task.effectId];
          if (effectPath) {
            const fileRes = await api.getAudioFile(effectPath);
            if (fileRes?.success && fileRes.data) {
              const audioBuffer = await this.decodeAudioData(audioContext, fileRes.data);
              if (audioBuffer) {
                let processed = this.resampleAndStereo(audioBuffer, channels);
                processed = this.applyTrimAndFade(processed, task.maxDuration, task.fadeDuration, sampleRate, channels);
                buffers.push(processed);
              }
            }
          }
        }

        if (task.type === 'silence') {
          const duration = task.duration || 0;
          if (duration > 0) buffers.push(this.createSilenceBuffer(duration, sampleRate, channels));
        }

        if (i % 2 === 0) await new Promise(r => setTimeout(r, 0));
      }

      if (!buffers.length) return this.updateStatus('导出失败：没有生成有效音频数据');

      this.updateStatus('正在合并音频...');
      const mergedBuffer = this.concatAudioBuffers(buffers, sampleRate, channels);

      this.updateStatus('正在编码 WAV...');
      const wavData = this.encodeWav(mergedBuffer);

      this.updateStatus('正在保存文件...');
      const base64 = this.arrayBufferToBase64(wavData);
      const result = await api.saveBinary(targetPath, base64);
      await api.cleanupTemp?.();

      if (result?.success) {
        this.updateStatus('导出完成');
        setTimeout(() => window.app?.updateStatus?.('就绪'), 1500);
      } else {
        this.updateStatus('保存失败：' + (result?.error || '未知错误'));
      }
    } finally {
      if (audioContext && audioContext.state !== 'closed') await audioContext.close();
    }
  }

  async decodeAudioData(context, base64) {
    try {
      const binaryString = window.atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
      return await context.decodeAudioData(bytes.buffer);
    } catch (e) {
      console.error('解码音频失败:', e);
      return null;
    }
  }

  resampleAndStereo(buffer, targetChannels) {
    if (buffer.numberOfChannels === targetChannels) return buffer;
    const newBuffer = new AudioBuffer({ length: buffer.length, numberOfChannels: targetChannels, sampleRate: buffer.sampleRate });
    for (let i = 0; i < targetChannels; i++) {
      const sourceChannel = i < buffer.numberOfChannels ? i : 0;
      newBuffer.copyToChannel(buffer.getChannelData(sourceChannel), i);
    }
    return newBuffer;
  }

  applyTrimAndFade(buffer, maxDuration, fadeDuration, sampleRate, channels) {
    let length = buffer.length;
    if (maxDuration && maxDuration > 0) {
      const maxLen = Math.floor(maxDuration * sampleRate);
      if (length > maxLen) length = maxLen;
    }

    const newBuffer = new AudioBuffer({ length, numberOfChannels: channels, sampleRate });
    const fadeLen = fadeDuration ? Math.floor(fadeDuration * sampleRate) : 0;

    for (let c = 0; c < channels; c++) {
      const srcData = buffer.getChannelData(c);
      const destData = newBuffer.getChannelData(c);
      for (let i = 0; i < length; i++) {
        let sample = srcData[i];
        if (fadeLen > 0 && i > length - fadeLen) {
          const fadePos = i - (length - fadeLen);
          sample *= (1 - fadePos / fadeLen);
        }
        destData[i] = sample;
      }
    }
    return newBuffer;
  }

  createSilenceBuffer(duration, sampleRate, channels) {
    const length = Math.floor(duration * sampleRate);
    return new AudioBuffer({ length, numberOfChannels: channels, sampleRate });
  }

  concatAudioBuffers(buffers, sampleRate, channels) {
    const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);
    const result = new AudioBuffer({ length: totalLength, numberOfChannels: channels, sampleRate });
    let offset = 0;
    for (const buf of buffers) {
      for (let c = 0; c < channels; c++) {
        result.copyToChannel(buf.getChannelData(c), c, offset);
      }
      offset += buf.length;
    }
    return result;
  }

  encodeWav(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1;
    const bitDepth = 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataLength = audioBuffer.length * blockAlign;
    const bufferLength = 44 + dataLength;

    const buffer = new ArrayBuffer(bufferLength);
    const view = new DataView(buffer);

    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    this.writeString(view, 8, 'WAVE');
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    let offset = 44;
    for (let i = 0; i < audioBuffer.length; i++) {
      for (let c = 0; c < numChannels; c++) {
        const sample = audioBuffer.getChannelData(c)[i];
        const s = Math.max(-1, Math.min(1, sample));
        const int16 = s < 0 ? s * 0x8000 : s * 0x7FFF;
        view.setInt16(offset, int16, true);
        offset += 2;
      }
    }

    return buffer;
  }

  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
  }

  arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      const sub = bytes.subarray(i, i + chunk);
      binary += String.fromCharCode.apply(null, sub);
    }
    return window.btoa(binary);
  }
}
