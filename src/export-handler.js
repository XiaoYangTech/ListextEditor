class ExportHandler {
  constructor(api, statusCallback) {
    this.api = api || window.electronAPI;
    this.statusCallback = statusCallback;
    this.exportDir = '';
    this.initDialog();
  }

  initDialog() {
    const dialog = document.getElementById('exportDialog');
    if (!dialog) return;
    const closeBtn = dialog.querySelector('.dialog-close');
    const cancelBtn = document.getElementById('exportCancel');
    const confirmBtn = document.getElementById('exportConfirm');
    const browseBtn = document.getElementById('btnBrowseExportDir');

    closeBtn?.addEventListener('click', () => dialog.classList.remove('active'));
    cancelBtn?.addEventListener('click', () => dialog.classList.remove('active'));
    browseBtn?.addEventListener('click', async () => {
      const dir = await this.api?.selectDirectory?.(this.exportDir);
      if (dir) {
        this.exportDir = dir;
        document.getElementById('exportDir').value = dir;
      }
    });
    confirmBtn?.addEventListener('click', () => {
      dialog.classList.remove('active');
      const fileName = document.getElementById('exportFileName')?.value?.trim() || 'listening.mp3';
      const dir = this.exportDir;
      if (!dir) {
        this.updateStatus('请选择保存目录');
        return;
      }
      const sep = this.api?.platform === 'win32' ? '\\' : '/';
      const fullPath = dir + sep + fileName;
      this.doExport(fullPath);
    });
  }

  showExportDialog() {
    const dialog = document.getElementById('exportDialog');
    if (!dialog) { this.doExport(null); return; }

    this._ensureAuthForExport(async () => {
      const fileName = document.getElementById('exportFileName');
      const dirInput = document.getElementById('exportDir');
      const info = document.getElementById('exportInfo');

      if (fileName) {
        const tab = window.app?.tabManager?.getActiveTab();
        const baseName = tab?.filePath ? tab.filePath.split(/[/\\]/).pop().replace(/\.[^.]+$/, '') : 'listening';
        fileName.value = baseName + '.mp3';
      }
      if (dirInput) dirInput.value = this.exportDir || '';
      if (info) info.textContent = '';
      dialog.classList.add('active');
    });
  }

  async _ensureAuthForExport(onSuccess) {
    const loggedIn = await this.api?.isLoggedIn();
    if (!loggedIn) {
      window.app?.authManager?.showLoginDialog('请登录后使用导出功能');
      return;
    }
    const ent = await this.api?.getEntitlement();
    const isPro = ent?.plan === 'pro' && !ent?.expired;
    const isFreeDisplay = ent?.free_display?.enabled;

    if (!isPro && !isFreeDisplay) {
      try {
        const quota = await this.api?.getExportQuota();
        if (quota && typeof quota.remaining === 'number' && quota.remaining > 0) {
          onSuccess();
          return;
        }
      } catch {}
      this.updateStatus('本月导出次数已用完，请前往 api.yfyw.top 升级');
      return;
    }

    if (isPro || isFreeDisplay) {
      onSuccess();
      return;
    }

    this.updateStatus('请连接网络后使用导出功能');
  }

  updateStatus(text) {
    if (this.statusCallback) this.statusCallback(text);
    if (window.app?.updateStatus) window.app.updateStatus(text);
  }

  async doExport(filePath) {
    const api = this.api || window.electronAPI;
    if (!api) return this.updateStatus('导出失败：当前环境不支持');

    this.updateStatus('正在准备导出...');

    try {
      const effectiveContent = window.app?.getContent?.() || '';
      const effectiveParser = window.app?.parser;
      const effectiveQueue = window.app?.playQueue;
      if (!effectiveParser || !effectiveQueue) return this.updateStatus('导出失败：导出上下文缺失');

      let targetPath = filePath;
      if (!targetPath) {
        if (typeof api.selectExportPath !== 'function') return this.updateStatus('导出失败：selectExportPath 不可用');
        targetPath = await api.selectExportPath();
      }
      if (!targetPath) return this.updateStatus('已取消导出');
      if (!/\.mp3$/i.test(targetPath)) targetPath = targetPath.replace(/\.[^\.]+$/, '') + '.mp3';

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
      const skipWatermark = window.entitlement?.isUnlocked();
      const result = await api.composeMp3(targetPath, segments, skipWatermark);
      await api.cleanupTemp?.();

      if (result?.success) {
        await api.consumeExport?.().catch(() => {});
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
