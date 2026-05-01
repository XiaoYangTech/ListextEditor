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
    if (!this.api) {
      this.updateStatus('导出失败: 当前环境不支持');
      return;
    }

    this.updateStatus('正在准备导出...');

    try {
      const effectiveContent = typeof content === 'string' ? content : (window.app?.getContent?.() || '');
      const effectiveParser = parser || window.app?.parser;
      const effectiveQueue = playQueue || window.app?.playQueue;

      if (!effectiveParser || !effectiveQueue) {
        this.updateStatus('导出失败: 导出上下文缺失');
        return;
      }

      let targetPath = filePath;
      if (!targetPath) targetPath = await this.api.selectExportPath();
      if (!targetPath) {
        this.updateStatus('已取消导出');
        return;
      }

      const ast = effectiveParser.parse(effectiveContent || '');
      if (!ast.length) {
        this.updateStatus('没有可导出的内容');
        return;
      }

      const queue = effectiveQueue.buildQueue(ast);
      const effects = await this.api.loadEffects();

      const sampleRate = 44100;
      const channels = 2;
      const buffers = [];
      const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });

      try {
        this.updateStatus(`开始导出，共 ${queue.length} 个任务...`);

        for (let i = 0; i < queue.length; i++) {
          const task = queue[i];
          this.updateStatus(`正在处理任务 ${i + 1}/${queue.length}...`);

          if (task.type === 'tts') {
            const role = effectiveQueue.getRole(task.roleId || '');
            const voice = task.voice || (role ? role.voice : null);
            const rate = effectiveQueue.convertRateToEdge(task.rate || 1.0);

            const res = await this.api.synthesizeTTS(task.text || '', voice, rate);
            if (!res?.success || !res.path) continue;

            const fileRes = await this.api.getAudioFile(res.path);
            if (!fileRes?.success || !fileRes.data) continue;

            const audioBuffer = await this.decodeAudioData(audioContext, fileRes.data);
            if (audioBuffer) buffers.push(this.resampleAndStereo(audioBuffer, sampleRate, channels));
          }

          if (task.type === 'effect') {
            const effectPath = effects?.[task.effectId];
            if (!effectPath) continue;

            const fileRes = await this.api.getAudioFile(effectPath);
            if (!fileRes?.success || !fileRes.data) continue;

            const audioBuffer = await this.decodeAudioData(audioContext, fileRes.data);
            if (audioBuffer) {
              let processed = this.resampleAndStereo(audioBuffer, sampleRate, channels);
              processed = this.applyTrimAndFade(processed, task.maxDuration, task.fadeDuration, sampleRate, channels);
              buffers.push(processed);
            }
          }

          if (task.type === 'silence') {
            const duration = task.duration || 0;
            if (duration > 0) buffers.push(this.createSilenceBuffer(duration, sampleRate, channels));
          }
        }

        if (!buffers.length) {
          this.updateStatus('导出失败: 没有生成有效音频数据');
          return;
        }

        this.updateStatus('正在合并音频...');
        const mergedBuffer = this.concatAudioBuffers(buffers, sampleRate, channels);

        this.updateStatus('正在编码 WAV...');
        const wavData = this.encodeWav(mergedBuffer);
        const base64 = this.arrayBufferToBase64(wavData);

        this.updateStatus('正在保存文件...');
        const result = await this.api.saveBinary(targetPath, base64);
        await this.api.cleanupTemp();

        if (result?.success) {
          this.updateStatus('导出完成');
          setTimeout(() => { window.app?.updateStatus?.('就绪'); }, 3000);
        } else {
          this.updateStatus('保存失败: ' + (result?.error || '未知错误'));
        }
      } finally {
        if (audioContext && audioContext.state !== 'closed') await audioContext.close();
      }
    } catch (error) {
      console.error('导出过程出错:', error);
      this.updateStatus('导出出错: ' + error.message);
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

  resampleAndStereo(buffer, targetRate, targetChannels) {
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
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary);
  }
}
