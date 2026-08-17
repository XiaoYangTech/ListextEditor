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

// 水印音频开头宣传文案（与 freeWatermark.mp3 的语音内容一致）：
// 水印勾选时写入 LRC 字幕开头，随水印播放逐句显示，正文时间轴整体后移水印时长
const WATERMARK_LRC_TEXT =
  '本听力材料使用亿方听力大师免费制作，制作高质量听力材料。' +
  '就用亿方听力大师，会搭积木就会做听力，操作简单易学，所有功能全部免费使用。' +
  '内置微软拟真自然语音引擎，语音自然无机械感，支持多种语言和音色，满足新高考需求。';

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

    // 导出进度弹窗：显式取消/重试按钮（不再依赖隐藏的 ESC 逻辑）
    document.getElementById('exportProgressCancel')?.addEventListener('click', () => this._requestCancelExport());
    document.getElementById('exportProgressRetry')?.addEventListener('click', () => this._resolveNetworkPause('retry'));
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
      // 【免费模式】隐藏免费版水印警告条（水印改为下方复选框可选）
      if (warn) warn.style.display = 'none';
      // if (warn) warn.style.display = window.entitlement?.isPro ? 'none' : 'block';
      // 水印复选框每次打开默认勾选，用户可自行取消
      const wmBox = document.getElementById('exportWatermark');
      if (wmBox) wmBox.checked = true;
      this._refreshLrcGate();
      dialog.classList.add('active');
    });
  }

  // 【免费模式】LRC 字幕免费可用，不再拦截勾选
  _refreshLrcGate() {
    if (window.LISTEXT_CONSTANTS?.FREE_MODE) return;
    // 以下为原付费门控逻辑：非专业版点击时拦截勾选并引导升级（不置灰，否则点击无反馈）
    const lrcBox = document.getElementById('exportLrc');
    if (!lrcBox) return;
    lrcBox.checked = false;
    if (!lrcBox.dataset.gateBound) {
      lrcBox.dataset.gateBound = '1';
      lrcBox.addEventListener('click', () => {
        if (!window.entitlement?.isPro) {
          // click 事件先于勾选状态更新触发，下一 tick 再复位并引导升级
          setTimeout(() => { lrcBox.checked = false; }, 0);
          window.entitlement?.showVipToast?.('LRC 字幕导出');
        }
      });
    }
  }

  // 由逐片段时长与台词文本生成 LRC 字幕内容
  // watermark：{ text, duration }——水印置音频开头时，先写水印文案（按句拆分、
  // 按字数比例分摊水印时长），正文时间轴从水印结束处起算，保证与音频对齐
  _buildLrc(segmentTexts, durations, watermark) {
    const fmt = (sec) => {
      const m = Math.floor(sec / 60);
      const s = sec - m * 60;
      return `[${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}]`;
    };
    const lines = [];
    let t = 0;
    const wmDuration = Number(watermark?.duration) || 0;
    const wmText = (watermark?.text || '').trim();
    if (wmText && wmDuration > 0) {
      const sentences = wmText.split(/(?<=[。！？])/).map(s => s.trim()).filter(Boolean);
      const totalChars = sentences.reduce((sum, s) => sum + s.length, 0) || 1;
      let acc = 0;
      for (let i = 0; i < sentences.length; i++) {
        lines.push(`${fmt(acc)}${sentences[i]}`);
        acc = i === sentences.length - 1
          ? wmDuration
          : acc + (wmDuration * sentences[i].length) / totalChars;
      }
      t = wmDuration;
    }
    for (let i = 0; i < durations.length; i++) {
      const text = (segmentTexts[i] || '').trim();
      if (text) lines.push(`${fmt(t)}${text}`);
      t += Number(durations[i]) || 0;
    }
    return lines.join('\r\n') + '\r\n';
  }

  async _ensureAuthForExport(onSuccess) {
    // 【免费模式】无需登录与配额校验，直接放行
    if (window.LISTEXT_CONSTANTS?.FREE_MODE) { onSuccess(); return; }
    /* 以下为原付费门控逻辑（登录校验 + 权益判定 + 免费配额检查）
    const loggedIn = await this.api?.isLoggedIn();
    if (!loggedIn) {
      window.app?.authManager?.showLoginDialog('请登录后使用导出功能');
      return;
    }
    // 打开导出前强制刷新订阅状态，避免用陈旧权益判断水印/专业版门控
    await window.entitlement?.refresh(true);
    const ent = await this.api?.getEntitlement();
    // 远端下线/会话过期时服务端返回 401，主进程已随之清除登录态：
    // 立即引导重新登录，不再走配额检查（否则会被误判为“次数用完”）
    if (!(await this.api?.isLoggedIn())) {
      window.app?.authManager?.showLoginDialog('登录已失效，请重新登录后使用导出功能');
      return;
    }
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
      // 配额查询期间同样可能因 401 被清除登录态，再校验一次
      if (!(await this.api?.isLoggedIn())) {
        window.app?.authManager?.showLoginDialog('登录已失效，请重新登录后使用导出功能');
        return;
      }
      const limitText = typeof quota?.limit === 'number' ? `${quota.limit}次` : '';
      window.app?.uiManager?.showInfoDialog?.('提示', `本月免费版${limitText}带水印导出次数已用完，请购买会员后继续使用。`);
      return;
    }

    onSuccess();
    */
  }

  updateStatus(text) {
    if (this.statusCallback) this.statusCallback(text);
    if (window.app?.updateStatus) window.app.updateStatus(text);
  }

  _showProgress() {
    const dlg = document.getElementById('exportProgressDialog');
    if (!dlg) return;
    this._cancelRequested = false;
    this._pauseResolver = null;
    document.getElementById('exportProgressTitle').textContent = '正在导出';
    document.getElementById('exportProgressText').textContent = '准备中...';
    document.getElementById('exportProgressFill').style.width = '0%';
    document.getElementById('exportProgressPercent').textContent = '0%';
    const retryBtn = document.getElementById('exportProgressRetry');
    if (retryBtn) retryBtn.style.display = 'none';
    const cancelBtn = document.getElementById('exportProgressCancel');
    if (cancelBtn) cancelBtn.style.display = '';
    const log = document.getElementById('exportProgressLog');
    if (log) log.innerHTML = '';
    dlg.classList.add('active');
  }

  // 用户点击“取消导出”：置位取消标志；若正停在网络错误等待选择，直接按取消处理
  _requestCancelExport() {
    this._cancelRequested = true;
    if (this._pauseResolver) this._resolveNetworkPause('cancel');
  }

  // 网络错误后暂停导出，引导用户稍后重试或更换网络；返回 'retry' 或 'cancel'
  _pauseForNetworkError() {
    document.getElementById('exportProgressTitle').textContent = '导出已暂停';
    document.getElementById('exportProgressText').textContent =
      '网络连接错误。请稍后重试，或更换网络环境（如使用手机流量）后重试。';
    this._logProgress('网络连接错误，导出已暂停，等待用户选择…');
    const retryBtn = document.getElementById('exportProgressRetry');
    if (retryBtn) retryBtn.style.display = '';
    return new Promise(resolve => { this._pauseResolver = resolve; });
  }

  _resolveNetworkPause(choice) {
    if (!this._pauseResolver) return;
    const resolver = this._pauseResolver;
    this._pauseResolver = null;
    const retryBtn = document.getElementById('exportProgressRetry');
    if (retryBtn) retryBtn.style.display = 'none';
    if (choice === 'retry') {
      document.getElementById('exportProgressTitle').textContent = '正在导出';
    }
    resolver(choice);
  }

  // 中止导出：清理临时文件、关闭进度弹窗
  async _abortExport(api) {
    this._hideProgress();
    await api.cleanupTemp?.();
    this.updateStatus('已取消导出');
    console.log('[动作] 导出已取消');
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
        // 内置二进制与运行架构不匹配时（如 Linux arm64）回退系统 ffmpeg，此时提示用户自行安装
        const hint = api.platform === 'linux'
          ? '请安装系统 ffmpeg 后重试（如 sudo apt install ffmpeg）'
          : '请确保程序安装目录完整';
        window.app?.uiManager?.showInfoDialog?.('错误', `导出失败：未找到 ffmpeg 编码器\n${hint}`);
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
      // 与 segments 一一对应的台词文本（音效/静默为空串），供 LRC 时间轴对齐
      const segmentTexts = [];
      const skipWarnings = [];
      const totalTasks = queue.length;
      this._updateProgress(5, `正在构建导出任务（${totalTasks}）...`);
      console.log('[动作] 导出开始:', targetPath, `共 ${totalTasks} 个任务`);
      if (effectiveQueue._skippedEmpty > 0) {
        this._logProgress(`已跳过 ${effectiveQueue._skippedEmpty} 个空白朗读块`);
      }

      for (let i = 0; i < queue.length; i++) {
        if (this._cancelRequested) { await this._abortExport(api); return; }
        const task = queue[i];
        const taskPct = 5 + Math.round((i / queue.length) * 70);
        this._updateProgress(taskPct, `正在处理任务 ${i + 1}/${totalTasks}...`);

        if (task.type === 'tts') {
          const voice = effectiveQueue.resolveVoice(task) || LISTEXT_CONSTANTS.DEFAULT_EDGE_VOICE;
          const rate = effectiveQueue.convertRateToEdge(task.rate || 1.0);
          const preview = (task.text || '').slice(0, 10);
          this._logProgress(`[${i + 1}/${totalTasks}] 合成中："${preview}…"`);
          let res = null;
          let retryTask = false;
          const maxAttempts = 3;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (this._cancelRequested) { await this._abortExport(api); return; }
            if (attempt > 1) {
              this._updateProgress(taskPct, `正在处理任务 ${i + 1}/${totalTasks}（第 ${attempt}/${maxAttempts} 次重试）...`);
            }
            res = await api.synthesizeTTS(task.text || '', voice, rate);
            if (this._cancelRequested) { await this._abortExport(api); return; }
            if (res?.success && res.path) break;
            const reason = res?.error || '未知原因';
            const isNetwork = !!res?.network || /网络/.test(reason);
            this._logProgress(`[${i + 1}/${totalTasks}] 第 ${attempt} 次尝试失败：${reason}`);
            if (!isNetwork) {
              // 非网络错误：立即中止整个导出
              this._hideProgress();
              await api.cleanupTemp?.();
              window.app?.uiManager?.showInfoDialog?.('错误',
                `第 ${i + 1} 条语音（"${preview}…"）合成失败：${reason}，导出已取消`);
              return;
            }
            if (attempt < maxAttempts) {
              this._logProgress(`[${i + 1}/${totalTasks}] 2 秒后重试…`);
              await this._sleep(2000);
              continue;
            }
            // 网络错误且重试用尽：单个语音失败不掐掉整个项目，暂停导出引导用户
            this._updateProgress(taskPct, `任务 ${i + 1}/${totalTasks} 网络连接错误，导出已暂停`);
            const choice = await this._pauseForNetworkError();
            if (choice !== 'retry' || this._cancelRequested) { await this._abortExport(api); return; }
            this._updateProgress(taskPct, `正在处理任务 ${i + 1}/${totalTasks}...`);
            retryTask = true;
            break;
          }
          if (retryTask) { i--; continue; }
          segments.push({ type: 'file', path: res.path });
          segmentTexts.push(task.text || '');
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
          segmentTexts.push('');
        } else if (task.type === 'silence') {
          const dur = Number(task.duration || 0);
          if (dur > 0) {
            segments.push({ type: 'silence', duration: dur });
            segmentTexts.push('');
          }
        }
      }

      if (!segments.length) { this._hideProgress(); window.app?.uiManager?.showInfoDialog?.('提示', '导出失败：没有可导出片段'); return; }
      if (typeof api.composeMp3 !== 'function') { this._hideProgress(); window.app?.uiManager?.showInfoDialog?.('错误', '导出失败：composeMp3 不可用'); return; }

      this._updateProgress(80, '正在合成 MP3...');
      // 合成阶段无法中途取消，收起取消按钮避免误导
      document.getElementById('exportProgressCancel').style.display = 'none';
      // 【免费模式】水印改为可选：勾选在音频开头加水印（默认），取消勾选则不加
      const skipWatermark = !document.getElementById('exportWatermark')?.checked;
      // const skipWatermark = true;
      // 以下为原付费水印判定：仅真正的付费会员去水印，导出前先刷新权益
      // await window.entitlement?.refresh();
      // const skipWatermark = window.entitlement?.isPro === true;
      // LRC 字幕勾选即生成（与水印复选框互相独立：水印置开头时，
      // 字幕开头同样写水印文案，正文时间轴按主进程返回的水印时长整体后移）
      const wantLrc = !!document.getElementById('exportLrc')?.checked;
      this._updateProgress(80, wantLrc ? '正在合成 MP3（含字幕时间轴）...' : '正在合成 MP3...');
      const result = await api.composeMp3(targetPath, segments, skipWatermark, wantLrc ? { withDurations: true } : undefined);
      await api.cleanupTemp?.();

      // 合成成功后写 LRC（与 MP3 同名同目录）；写盘失败不影响 MP3 交付
      let lrcPath = null;
      if (wantLrc && result?.success && Array.isArray(result.durations)) {
        try {
          lrcPath = targetPath.replace(/\.mp3$/i, '.lrc');
          const lrc = this._buildLrc(segmentTexts, result.durations, {
            text: WATERMARK_LRC_TEXT,
            duration: result.watermarkDuration
          });
          const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(lrc)));
          const wr = await api.saveBinary?.(lrcPath, b64);
          if (wr?.success) this._logProgress('LRC 字幕已生成: ' + lrcPath);
          else { this._logProgress('LRC 字幕写入失败: ' + (wr?.error || '未知错误')); lrcPath = null; }
        } catch (e) {
          console.error('LRC 生成失败:', e);
          this._logProgress('LRC 字幕生成失败: ' + (e?.message || e));
          lrcPath = null;
        }
      }

      if (result?.success) {
        this._updateProgress(95, '正在保存...');
        // 【免费模式】不再向服务端扣减导出次数
        // await api.consumeExport?.().catch((e) => {
        //   console.error('导出次数扣减:', e);
        // });
        this._updateProgress(100, '导出完成');
        this.updateStatus(lrcPath ? '导出完成（含 LRC 字幕）' : '导出完成');
        console.log('[动作] 导出完成:', targetPath, lrcPath ? `（字幕: ${lrcPath}）` : '');
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
