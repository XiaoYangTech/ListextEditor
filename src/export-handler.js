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
      const fileName = document.getElementById('exportFileName')?.value?.trim() || this._defaultFileName();
      const dir = this.exportDir;
      if (!dir) {
        window.app?.uiManager?.showInfoDialog?.('提示', '请选择保存目录');
        return;
      }
      const sep = this.api?.platform === 'win32' ? '\\' : '/';
      const fullPath = dir + sep + fileName;
      this.doExport(fullPath);
    });
  }

  _defaultFileName() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `亿方听力大师-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.mp3`;
  }

  async _uniquePath(basePath) {
    const sep = this.api?.platform === 'win32' ? '\\' : '/';
    const dir = basePath.substring(0, basePath.lastIndexOf(sep) + 1);
    const name = basePath.substring(dir.length);
    const extIdx = name.lastIndexOf('.');
    const stem = extIdx > 0 ? name.substring(0, extIdx) : name;
    const ext = extIdx > 0 ? name.substring(extIdx) : '.mp3';

    if (!this.api?.fileExists) return basePath;

    let candidate = basePath;
    let counter = 1;
    while (await this.api.fileExists(candidate)) {
      candidate = dir + stem + ` (${counter})` + ext;
      counter++;
    }
    return candidate;
  }

  showExportDialog() {
    const dialog = document.getElementById('exportDialog');
    if (!dialog) { this.doExport(null); return; }

    this._ensureAuthForExport(async () => {
      const fileName = document.getElementById('exportFileName');
      const dirInput = document.getElementById('exportDir');
      const info = document.getElementById('exportInfo');
      const warn = document.getElementById('exportWatermarkWarn');

      if (fileName) {
        fileName.value = this._defaultFileName();
      }
      if (dirInput) dirInput.value = this.exportDir || '';
      if (info) info.textContent = '';
      if (warn) warn.style.display = window.entitlement?.isUnlocked() ? 'none' : 'block';
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
        console.log('EXPORT_QUOTA_CHECK:', JSON.stringify(quota));
        if (quota && typeof quota.remaining === 'number' && quota.remaining > 0) {
          onSuccess();
          return;
        }
      } catch (e) {
        console.error('QUOTA_CHECK_ERROR:', e);
      }
      window.app?.uiManager?.showInfoDialog?.('提示', '本月免费版3次带水印导出次数已用完，请前往 api.yfyw.top 购买会员后继续使用。');
      return;
    }

    if (isPro || isFreeDisplay) {
      onSuccess();
      return;
    }

    window.app?.uiManager?.showInfoDialog?.('提示', '请连接网络后使用导出功能');
  }

  updateStatus(text) {
    if (this.statusCallback) this.statusCallback(text);
    if (window.app?.updateStatus) window.app.updateStatus(text);
  }

  _showProgress() {
    const dlg = document.getElementById('exportProgressDialog');
    if (!dlg) return;
    document.getElementById('exportProgressTitle').textContent = '正在导出';
    document.getElementById('exportProgressText').textContent = '准备中...';
    document.getElementById('exportProgressFill').style.width = '0%';
    document.getElementById('exportProgressPercent').textContent = '0%';
    dlg.classList.add('active');
  }

  _updateProgress(percent, text) {
    const fill = document.getElementById('exportProgressFill');
    const pct = document.getElementById('exportProgressPercent');
    const txt = document.getElementById('exportProgressText');
    const val = Math.min(100, Math.max(0, Math.round(percent)));
    if (fill) fill.style.width = val + '%';
    if (pct) pct.textContent = val + '%';
    if (txt && text) txt.textContent = text;
  }

  _hideProgress() {
    document.getElementById('exportProgressDialog')?.classList.remove('active');
  }

  async doExport(filePath) {
    const api = this.api || window.electronAPI;
    if (!api) { this._hideProgress(); window.app?.uiManager?.showInfoDialog?.('错误', '导出失败：当前环境不支持'); return; }

    this._showProgress();

    try {
      const effectiveContent = window.app?.getContent?.() || '';
      const effectiveParser = window.app?.parser;
      const effectiveQueue = window.app?.playQueue;
      if (!effectiveParser || !effectiveQueue) {
        this._hideProgress();
        window.app?.uiManager?.showInfoDialog?.('错误', '导出失败：导出上下文缺失');
        return;
      }

      let targetPath = filePath;
      if (!targetPath) {
        if (typeof api.selectExportPath !== 'function') {
          this._hideProgress();
          window.app?.uiManager?.showInfoDialog?.('错误', '导出失败：selectExportPath 不可用');
          return;
        }
        targetPath = await api.selectExportPath();
      }
      if (!targetPath) { this._hideProgress(); return this.updateStatus('已取消导出'); }
      if (!/\.mp3$/i.test(targetPath)) targetPath = targetPath.replace(/\.[^\.]+$/, '') + '.mp3';

      targetPath = await this._uniquePath(targetPath);

      const ast = effectiveParser.parse(effectiveContent || '');
      if (!ast.length) { this._hideProgress(); window.app?.uiManager?.showInfoDialog?.('提示', '没有可导出的内容'); return; }

      const queue = effectiveQueue.buildQueue(ast);
      const projectData = window.app?.getActiveProjectData();
      const projectEffects = projectData?.effects || [];
      const builtinSounds = await api.listBuiltinSounds() || [];

      const segments = [];
      const totalTasks = queue.length;
      this._updateProgress(5, `正在构建导出任务（${totalTasks}）...`);

      for (let i = 0; i < queue.length; i++) {
        const task = queue[i];
        const taskPct = 5 + Math.round((i / queue.length) * 70);
        this._updateProgress(taskPct, `正在处理任务 ${i + 1}/${totalTasks}...`);

        if (task.type === 'tts') {
          const role = effectiveQueue.getRole(task.roleId || '');
          const voice = task.voice || (role ? role.voice : null) || 'zh-CN-XiaoxiaoNeural';
          const rate = effectiveQueue.convertRateToEdge(task.rate || 1.0);
          const res = await api.synthesizeTTS(task.text || '', voice, rate);
          if (!res?.success || !res.path) {
            this._hideProgress();
            window.app?.uiManager?.showInfoDialog?.('错误', '导出失败：TTS 合成失败');
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

      if (!segments.length) { this._hideProgress(); window.app?.uiManager?.showInfoDialog?.('提示', '导出失败：没有可导出片段'); return; }
      if (typeof api.composeMp3 !== 'function') { this._hideProgress(); window.app?.uiManager?.showInfoDialog?.('错误', '导出失败：composeMp3 不可用'); return; }

      this._updateProgress(80, '正在合成 MP3...');
      const skipWatermark = window.entitlement?.isUnlocked();
      const result = await api.composeMp3(targetPath, segments, skipWatermark);
      await api.cleanupTemp?.();

      if (result?.success) {
        this._updateProgress(95, '正在保存...');
        await api.consumeExport?.().catch((e) => {
          console.error('导出次数扣减失败:', e);
        });
        this._updateProgress(100, '导出完成');
        this.updateStatus('导出完成');
        setTimeout(() => { this._hideProgress(); window.app?.updateStatus?.('就绪'); }, 1500);
      } else {
        this._hideProgress();
        window.app?.uiManager?.showInfoDialog?.('错误', '导出失败：' + (result?.error || '未知错误'));
      }
    } catch (error) {
      console.error('导出过程出错:', error);
      this._hideProgress();
      window.app?.uiManager?.showInfoDialog?.('错误', '导出出错: ' + (error?.message || String(error)));
    }
  }
}
