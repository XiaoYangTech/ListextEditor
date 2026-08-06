/*
 * 亿方听力大师 (ListextEditor)
 * Copyright (C) 2026 The InspireWorks Development Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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
    document.getElementById('exportUpgradeLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.api?.openExternal?.(window.LISTEXT_CONSTANTS?.API_BASE_URL);
    });
    confirmBtn?.addEventListener('click', () => {
      dialog.classList.remove('active');
      const fileName = (document.getElementById('exportFileName')?.value?.trim() || this._defaultFileName())
        .replace(/[\/\\:*?"<>|]/g, '_');
      const dir = this.exportDir;
      if (!dir) {
        window.app?.uiManager?.showInfoDialog?.('提示', '请选择保存目录');
        return;
      }
      const fullPath = dir + this._sep() + fileName;
      this.doExport(fullPath);
    });
  }

  _sep() {
    return this.api?.platform === 'win32' ? '\\' : '/';
  }

  _defaultFileName() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `亿方听力大师-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.mp3`;
  }

  async _uniquePath(basePath) {
    const sep = this._sep();
    const dir = basePath.substring(0, basePath.lastIndexOf(sep) + 1);
    const name = basePath.substring(dir.length);
    const extIdx = name.lastIndexOf('.');
    const stem = extIdx > 0 ? name.substring(0, extIdx) : name;
    const ext = extIdx > 0 ? name.substring(extIdx) : '';

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
    if (!dialog) { this._ensureAuthForExport(() => this.doExport(null)); return; }

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
      if (warn) warn.style.display = window.entitlement?.isPro ? 'none' : 'block';
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
      let quota = null;
      try {
        quota = await this.api?.getExportQuota();
        if (quota && typeof quota.remaining === 'number' && quota.remaining > 0) {
          onSuccess();
          return;
        }
      } catch (e) {
        console.error('导出配额查询失败:', e);
      }
      const limitText = typeof quota?.limit === 'number' ? `${quota.limit}次` : '';
      window.app?.uiManager?.showInfoDialog?.('提示', `本月免费版${limitText}带水印导出次数已用完，请购买会员后继续使用。`);
      return;
    }

    onSuccess();
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
    const log = document.getElementById('exportProgressLog');
    if (log) log.innerHTML = '';
    dlg.classList.add('active');
  }

  _logProgress(msg) {
    const log = document.getElementById('exportProgressLog');
    if (!log) return;
    const line = document.createElement('div');
    line.textContent = msg;
    log.appendChild(line);
    while (log.children.length > 50) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    this._updateProgress(1, '正在检查编码器...');

    if (typeof api.checkFfmpeg === 'function') {
      const ffCheck = await api.checkFfmpeg();
      if (!ffCheck?.ok) {
        this._hideProgress();
        window.app?.uiManager?.showInfoDialog?.('错误', '导出失败：未找到 ffmpeg 编码器\n请确保程序安装目录完整');
        return;
      }
    }

    try {
      const effectiveContent = window.app?.getContent?.() || '';
      // 导出前全量体检：语法/语义/角色问题，弹窗列出并拒绝导出
      if (window.app?.preflightCheck && !window.app.preflightCheck()) { this._hideProgress(); return; }
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
      if (!/\.mp3$/i.test(targetPath)) {
        targetPath = /\.[^.\/\\]+$/.test(targetPath)
          ? targetPath.replace(/\.[^.\/\\]+$/, '.mp3')
          : targetPath + '.mp3';
      }

      targetPath = await this._uniquePath(targetPath);

      const ast = effectiveParser.parse(effectiveContent || '');
      if (!ast.length) { this._hideProgress(); window.app?.uiManager?.showInfoDialog?.('提示', '没有可导出的内容'); return; }

      const queue = effectiveQueue.buildQueue(ast);
      const projectData = window.app?.getActiveProjectData();
      const projectEffects = projectData?.effects || [];
      const builtinSounds = await api.listBuiltinSounds() || [];

      const segments = [];
      const skipWarnings = [];
      const totalTasks = queue.length;
      this._updateProgress(5, `正在构建导出任务（${totalTasks}）...`);
      console.log('[动作] 导出开始:', targetPath, `共 ${totalTasks} 个任务`);
      if (effectiveQueue._skippedEmpty > 0) {
        this._logProgress(`已跳过 ${effectiveQueue._skippedEmpty} 个空白朗读块`);
      }

      for (let i = 0; i < queue.length; i++) {
        const task = queue[i];
        const taskPct = 5 + Math.round((i / queue.length) * 70);
        this._updateProgress(taskPct, `正在处理任务 ${i + 1}/${totalTasks}...`);

        if (task.type === 'tts') {
          const voice = effectiveQueue.resolveVoice(task) || LISTEXT_CONSTANTS.DEFAULT_EDGE_VOICE;
          const rate = effectiveQueue.convertRateToEdge(task.rate || 1.0);
          const preview = (task.text || '').slice(0, 10);
          this._logProgress(`[${i + 1}/${totalTasks}] 合成中："${preview}…"`);
          let res = null;
          const maxAttempts = 3;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (attempt > 1) {
              this._updateProgress(taskPct, `正在处理任务 ${i + 1}/${totalTasks}（第 ${attempt}/${maxAttempts} 次重试）...`);
            }
            res = await api.synthesizeTTS(task.text || '', voice, rate);
            if (res?.success && res.path) break;
            const reason = res?.error || '未知原因';
            const isNetwork = !!res?.network || /网络/.test(reason);
            this._logProgress(`[${i + 1}/${totalTasks}] 第 ${attempt} 次尝试失败：${reason}`);
            if (attempt < maxAttempts && isNetwork) {
              this._logProgress(`[${i + 1}/${totalTasks}] 2 秒后重试…`);
              await this._sleep(2000);
              continue;
            }
            // 非网络错误或重试已用尽：立即中止整个导出
            this._hideProgress();
            await api.cleanupTemp?.();
            window.app?.uiManager?.showInfoDialog?.('错误',
              `第 ${i + 1} 条语音（"${preview}…"）合成失败：${reason}，导出已取消`);
            return;
          }
          segments.push({ type: 'file', path: res.path });
        } else if (task.type === 'effect') {
          let effect = projectEffects.find(e => e.id === task.effectId);
          let effectPath = null;

          if (!effect) {
            const builtin = builtinSounds.find(b => b.id === task.effectId);
            if (builtin) {
              effect = { source: 'builtin', filename: builtin.filename };
              if (builtin.path) effectPath = builtin.path;
            }
          } else {
            effectPath = effect.path;
            if (!effectPath && effect.source === 'builtin') {
              const builtin = builtinSounds.find(b => b.filename === effect.filename);
              if (builtin) effectPath = builtin.path;
            }
          }

          if (!effectPath) {
            skipWarnings.push(`音效 "${task.effectId}" 文件缺失，已跳过`);
            continue;
          }
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
      // 仅真正的付费会员去水印；free_display 等免费体验仍带水印。
      // 先刷新一次权益，避免云端刚降级后本地仍按旧缓存跳过水印
      await window.entitlement?.refresh();
      const skipWatermark = window.entitlement?.isPro === true;
      const result = await api.composeMp3(targetPath, segments, skipWatermark);
      await api.cleanupTemp?.();

      if (result?.success) {
        this._updateProgress(95, '正在保存...');
        await api.consumeExport?.().catch((e) => {
          console.error('导出次数扣减:', e);
        });
        this._updateProgress(100, '导出完成');
        this.updateStatus('导出完成');
        console.log('[动作] 导出完成:', targetPath);
        if (skipWarnings.length) {
          // 延迟弹出，等进度框关闭后再提示缺失音效
          setTimeout(() => {
            window.app?.uiManager?.showInfoDialog?.('提示',
              '导出已完成，但以下音效缺失：\n' + skipWarnings.join('\n'));
          }, 1800);
        }
        // 停留片刻让用户看到 100% 进度
        setTimeout(() => { this._hideProgress(); window.app?.updateStatus?.('就绪'); }, skipWarnings.length ? 100 : 1500);
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
