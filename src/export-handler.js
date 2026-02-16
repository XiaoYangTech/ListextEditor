class ExportHandler {
  constructor(api, statusCallback) {
    this.api = api || window.electronAPI;
    this.statusCallback = statusCallback;
  }

  updateStatus(text) {
    if (this.statusCallback) this.statusCallback(text);
    // 同时更新主界面状态栏
    if (window.app && window.app.updateStatus) {
      window.app.updateStatus(text);
    }
  }

  async exportAudio(content, parser, playQueue, filePath) {
    if (!this.api) {
      this.updateStatus('导出失败: 当前环境不支持');
      return;
    }
    this.updateStatus('正在准备导出...');
    
    let targetPath = filePath;
    if (!targetPath) {
      targetPath = await this.api.selectExportPath();
    }
    if (!targetPath) {
      this.updateStatus('已取消导出');
      return;
    }

    const ast = parser.parse(content);
    if (!ast.length) {
      this.updateStatus('没有可导出的内容');
      return;
    }

    // 使用 playQueue 构建任务队列
    const queue = playQueue.buildQueue(ast);
    const effects = await this.api.loadEffects();
    
    // 音频处理参数
    const sampleRate = 44100;
    const channels = 2;
    const buffers = [];
    
    // 创建 AudioContext 用于解码
    const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });

    try {
      this.updateStatus(`开始导出，共 ${queue.length} 个任务...`);
      
      for (let i = 0; i < queue.length; i++) {
        const task = queue[i];
        this.updateStatus(`正在处理任务 ${i + 1}/${queue.length}...`);
        
        if (task.type === 'tts') {
          // 处理 TTS
          const roleId = task.roleId || '';
          // 获取角色配置
          const role = playQueue.getRole(roleId);
          // 优先使用任务指定的 voice，其次角色配置，再次默认
          const voice = task.voice || (role ? role.voice : null);
          
          // 使用 playQueue 的速率转换逻辑
          const rate = playQueue.convertRateToEdge(task.rate || 1.0);
          
          // 调用 IPC 生成 TTS 音频文件
          const res = await this.api.synthesizeTTS(task.text || '', voice, rate);
          if (!res?.success || !res.path) {
            console.warn('TTS 生成失败:', task.text);
            continue; 
          }
          
          // 读取生成的音频文件
          const fileRes = await this.api.getAudioFile(res.path);
          if (!fileRes?.success || !fileRes.data) {
            console.warn('读取 TTS 音频文件失败:', res.path);
            continue;
          }
          
          // 解码并处理
          const audioBuffer = await this.decodeAudioData(audioContext, fileRes.data);
          if (audioBuffer) {
            buffers.push(this.resampleAndStereo(audioBuffer, sampleRate, channels));
          }
          
        } else if (task.type === 'effect') {
          // 处理音效
          const effectPath = effects?.[task.effectId];
          if (!effectPath) {
            console.warn(`音效未找到: ${task.effectId}`);
            continue;
          }
          
          const fileRes = await this.api.getAudioFile(effectPath);
          if (!fileRes?.success || !fileRes.data) {
            console.warn(`读取音效文件失败: ${effectPath}`);
            continue;
          }
          
          const audioBuffer = await this.decodeAudioData(audioContext, fileRes.data);
          if (audioBuffer) {
            let processed = this.resampleAndStereo(audioBuffer, sampleRate, channels);
            // 处理裁剪和淡入淡出
            processed = this.applyTrimAndFade(processed, task.maxDuration, task.fadeDuration, sampleRate, channels);
            buffers.push(processed);
          }
          
        } else if (task.type === 'silence') {
          // 处理静音
          const duration = task.duration || 0;
          if (duration > 0) {
            const silenceBuffer = this.createSilenceBuffer(duration, sampleRate, channels);
            buffers.push(silenceBuffer);
          }
        }
      }

      if (buffers.length === 0) {
        this.updateStatus('导出失败: 没有生成有效的音频数据');
        return;
      }

      this.updateStatus('正在合并音频...');
      const mergedBuffer = this.concatAudioBuffers(buffers, sampleRate, channels);
      
      this.updateStatus('正在编码 WAV...');
      const wavData = this.encodeWav(mergedBuffer);
      const base64 = this.arrayBufferToBase64(wavData);
      
      this.updateStatus('正在保存文件...');
      const result = await this.api.saveBinary(targetPath, base64);
      
      // 清理临时文件
      await this.api.cleanupTemp();
      
      if (result?.success) {
        this.updateStatus('导出完成');
        // 3秒后恢复就绪状态
        setTimeout(() => {
            if (window.app && window.app.updateStatus) window.app.updateStatus('就绪');
        }, 3000);
      } else {
        this.updateStatus('保存失败: ' + (result?.error || '未知错误'));
      }
      
    } catch (error) {
      console.error('导出过程出错:', error);
      this.updateStatus('导出出错: ' + error.message);
    } finally {
      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close();
      }
    }
  }

  // --- 音频处理辅助方法 ---

  /**
   * Base64 转 ArrayBuffer 并解码为 AudioBuffer
   */
  async decodeAudioData(context, base64) {
    try {
      const binaryString = window.atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return await context.decodeAudioData(bytes.buffer);
    } catch (e) {
      console.error('解码音频失败:', e);
      return null;
    }
  }

  /**
   * 重采样并转换为立体声
   */
  resampleAndStereo(buffer, targetRate, targetChannels) {
    // 简单实现：如果采样率不同，应该使用 OfflineAudioContext 重采样
    // 这里为了简化，假设浏览器 decodeAudioData 已经处理好了采样率，或者我们手动处理
    // 实际上 decodeAudioData 会使用 context 的采样率，所以通常不需要手动重采样
    // 但我们需要确保通道数一致
    
    // 如果通道数一致且长度不需要改变，直接返回
    if (buffer.numberOfChannels === targetChannels) {
        return buffer;
    }
    
    // 创建新的 AudioBuffer
    const newBuffer = new AudioBuffer({
        length: buffer.length,
        numberOfChannels: targetChannels,
        sampleRate: buffer.sampleRate
    });
    
    // 复制数据
    for (let i = 0; i < targetChannels; i++) {
        // 如果源是单声道，复制到所有目标声道
        // 如果源是多声道，取对应声道或混合
        const sourceChannel = i < buffer.numberOfChannels ? i : 0;
        const channelData = buffer.getChannelData(sourceChannel);
        newBuffer.copyToChannel(channelData, i);
    }
    
    return newBuffer;
  }

  /**
   * 应用裁剪和淡入淡出
   */
  applyTrimAndFade(buffer, maxDuration, fadeDuration, sampleRate, channels) {
    let length = buffer.length;
    
    // 裁剪
    if (maxDuration && maxDuration > 0) {
      const maxLen = Math.floor(maxDuration * sampleRate);
      if (length > maxLen) {
        length = maxLen;
      }
    }
    
    // 创建新 buffer
    const newBuffer = new AudioBuffer({
      length: length,
      numberOfChannels: channels,
      sampleRate: sampleRate
    });
    
    // 复制并应用淡入淡出
    const fadeLen = fadeDuration ? Math.floor(fadeDuration * sampleRate) : 0;
    
    for (let c = 0; c < channels; c++) {
      const srcData = buffer.getChannelData(c);
      const destData = newBuffer.getChannelData(c);
      
      for (let i = 0; i < length; i++) {
        let sample = srcData[i];
        
        // 淡入 (开头) - 暂时不处理，通常只需要淡出
        // if (i < fadeLen) sample *= (i / fadeLen);
        
        // 淡出 (结尾)
        if (fadeLen > 0 && i > length - fadeLen) {
          const fadePos = i - (length - fadeLen);
          sample *= (1 - fadePos / fadeLen);
        }
        
        destData[i] = sample;
      }
    }
    
    return newBuffer;
  }

  /**
   * 创建静音 Buffer
   */
  createSilenceBuffer(duration, sampleRate, channels) {
    const length = Math.floor(duration * sampleRate);
    return new AudioBuffer({
      length: length,
      numberOfChannels: channels,
      sampleRate: sampleRate
    });
  }

  /**
   * 合并多个 AudioBuffer
   */
  concatAudioBuffers(buffers, sampleRate, channels) {
    const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);
    const result = new AudioBuffer({
      length: totalLength,
      numberOfChannels: channels,
      sampleRate: sampleRate
    });
    
    let offset = 0;
    for (const buf of buffers) {
      for (let c = 0; c < channels; c++) {
        const channelData = buf.getChannelData(c);
        result.copyToChannel(channelData, c, offset);
      }
      offset += buf.length;
    }
    
    return result;
  }

  /**
   * 将 AudioBuffer 编码为 WAV 格式
   */
  encodeWav(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    
    const dataLength = audioBuffer.length * blockAlign;
    const bufferLength = 44 + dataLength;
    
    const buffer = new ArrayBuffer(bufferLength);
    const view = new DataView(buffer);
    
    // RIFF chunk descriptor
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    this.writeString(view, 8, 'WAVE');
    
    // fmt sub-chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, format, true); // AudioFormat
    view.setUint16(22, numChannels, true); // NumChannels
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, sampleRate * blockAlign, true); // ByteRate
    view.setUint16(32, blockAlign, true); // BlockAlign
    view.setUint16(34, bitDepth, true); // BitsPerSample
    
    // data sub-chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);
    
    // Write PCM data
    let offset = 44;
    for (let i = 0; i < audioBuffer.length; i++) {
      for (let c = 0; c < numChannels; c++) {
        const sample = audioBuffer.getChannelData(c)[i];
        // Clip sample to [-1, 1]
        const s = Math.max(-1, Math.min(1, sample));
        // Scale to 16-bit integer
        const int16 = s < 0 ? s * 0x8000 : s * 0x7FFF;
        view.setInt16(offset, int16, true);
        offset += 2;
      }
    }
    
    return buffer;
  }

  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }
}
