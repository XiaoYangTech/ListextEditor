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
      if (!/\.mp3$/i.test(targetPath)) targetPath = targetPath.replace(/\.[^\.]+$/,'') + '.mp3';

      const ast = effectiveParser.parse(effectiveContent || '');
      if (!ast.length) return this.updateStatus('没有可导出的内容');

      const queue = effectiveQueue.buildQueue(ast);
      const projectData = window.app?.getActiveProjectData();
      const projectEffects = projectData?.effects || [];
      const builtinSounds = await api.listBuiltinSounds() || [];

      const segments = [];
      this.updateStatus(`正在构建导出任务（${queue.length}）...`);

      for (let i = 0; i < queue.length; i++) {
        const task = queue[i];
        this.updateStatus(`正在处理任务 ${i + 1}/${queue.length}...`);

        if (task.type === 'tts') {
          const role = effectiveQueue.getRole(task.roleId || '');
          const voice = task.voice || (role ? role.voice : null) || 'zh-CN-XiaoxiaoNeural';
          const rate = effectiveQueue.convertRateToEdge(task.rate || 1.0);
          const res = await api.synthesizeTTS(task.text || '', voice, rate);
          if (!res?.success || !res.path) {
            this.updateStatus('导出失败：TTS 合成失败');
            return;
          }
          segments.push({ type: 'file', path: res.path });
        } else if (task.type === 'effect') {
          const effect = projectEffects.find(e => e.id === task.effectId);
          if (!effect) continue;

          let effectPath = effect.path;
          if (!effectPath && effect.source === 'builtin') {
            const builtin = builtinSounds.find(b => b.filename === effect.filename);
            if (builtin) effectPath = builtin.path;
          }

          if (!effectPath) continue;
          segments.push({
            type: 'file',
            path: effectPath,
            maxDuration: task.maxDuration || null,
            fadeDuration: task.fadeDuration || null
          });
        } else if (task.type === 'silence') {
          const dur = Number(task.duration || 0);
          if (dur > 0) segments.push({ type: 'silence', duration: dur });
        }
      }

      if (!segments.length) return this.updateStatus('导出失败：没有可导出片段');
      if (typeof api.composeMp3 !== 'function') return this.updateStatus('导出失败：composeMp3 不可用');

      this.updateStatus('正在合成 MP3...');
      const result = await api.composeMp3(targetPath, segments);
      await api.cleanupTemp?.();

      if (result?.success) {
        this.updateStatus('导出完成');
        setTimeout(() => window.app?.updateStatus?.('就绪'), 1200);
      } else {
        this.updateStatus('导出失败：' + (result?.error || '未知错误'));
      }
    } catch (error) {
      console.error('导出过程出错:', error);
      this.updateStatus('导出出错: ' + (error?.message || String(error)));
    }
  }
}
