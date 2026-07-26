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

class UIManager {
  constructor(app) {
    this.app = app;
    this.shortcuts = {};
    this.initElements();
    this.initModeSwitcher();
    this.initToolbar();

    try {
      if (localStorage.getItem('toolbarAlign') === 'left') document.body.classList.add('toolbar-left');
    } catch (e) {}

    this.initDialogs();
    this.initSplitDivider();
    this.loadShortcuts().then(() => this.initKeyboardShortcuts());

    if (window.electronAPI?.onCheckUpdate) {
      window.electronAPI.onCheckUpdate(() => this.checkForUpdates());
    }

    if (window.electronAPI?.onToolbarAlignChanged) {
      window.electronAPI.onToolbarAlignChanged((align) => {
        document.body.classList.toggle('toolbar-left', align === 'left');
      });
    }

    setTimeout(() => this.checkForUpdates(), 3000);
  }

  async loadShortcuts() {
    const defaults = window.SHORTCUT_DEFAULTS || {};
    try {
      if (window.electronAPI?.getShortcuts) {
        const saved = await window.electronAPI.getShortcuts();
        this.shortcuts = { ...defaults, ...saved };
      } else {
        this.shortcuts = defaults;
      }
    } catch (_) {
      this.shortcuts = defaults;
    }
  }

  parseShortcut(shortcut) {
    const parts = shortcut.split('+');
    return {
      ctrl: parts.includes('Ctrl'),
      alt: parts.includes('Alt'),
      shift: parts.includes('Shift'),
      meta: parts.includes('Meta'),
      key: parts[parts.length - 1].toLowerCase()
    };
  }

  normalizeKeyName(key) {
    if (key === ' ') return 'space';
    if (key.startsWith('Arrow')) return key.slice(5).toLowerCase();
    return key.toLowerCase();
  }

  matchShortcut(e, shortcut) {
    const s = this.parseShortcut(shortcut);
    const modPressed = e.ctrlKey || e.metaKey;
    const ctrlOk = s.ctrl ? modPressed : !e.ctrlKey;
    const metaOk = s.meta ? e.metaKey : (s.ctrl ? true : !e.metaKey);
    return ctrlOk && metaOk &&
           (e.altKey === s.alt) &&
           (e.shiftKey === s.shift) &&
           (this.normalizeKeyName(e.key) === s.key);
  }

  initElements() {
    this.blockMode = document.getElementById('blockMode');
    this.codeMode = document.getElementById('codeMode');
    this.blockContainer = document.getElementById('blockContainer');
    this.statusText = document.getElementById('statusText');
    this.currentFileEl = document.getElementById('currentFile');
    this.viewModeSwitch = document.querySelector('.view-mode-switch');

    this.sectionJumpSelect = document.getElementById('sectionJumpSelect');
    this.blockSearchInput = document.getElementById('blockSearchInput');

    this.unsavedDialog = document.getElementById('unsavedDialog');
    this.unsavedDialogBody = document.getElementById('unsavedDialogBody');
    this.unsavedSaveBtn = document.getElementById('unsavedSave');
    this.unsavedDiscardBtn = document.getElementById('unsavedDiscard');
    this.unsavedCancelBtn = document.getElementById('unsavedCancel');

    this.infoDialog = document.getElementById('infoDialog');
    this.infoDialogTitle = document.getElementById('infoDialogTitle');
    this.infoDialogBody = document.getElementById('infoDialogBody');

    this.settingsDialog = document.getElementById('settingsDialog');
    this.proxyModeSelect = document.getElementById('proxyModeSelect');
    this.proxyUrlInput = document.getElementById('proxyUrlInput');
    this.settingsSaveBtn = document.getElementById('settingsSave');
    this.settingsCancelBtn = document.getElementById('settingsCancel');
    this.settingsCloseTopBtn = document.getElementById('settingsCloseTop');

    this.updateDialog = document.getElementById('updateDialog');
    this.updateAppName = document.getElementById('updateAppName');
    this.updateVersionOld = document.getElementById('updateVersionOld');
    this.updateVersionNew = document.getElementById('updateVersionNew');
    this.updateReleaseDate = document.getElementById('updateReleaseDate');
    this.updateChangelog = document.getElementById('updateChangelog');
    this.updateDownloadBtn = document.getElementById('updateDownloadBtn');
    this.updateLaterBtn = document.getElementById('updateLaterBtn');
  }

  initModeSwitcher() {
    document.querySelectorAll('.mode-tab').forEach(tab => {
      tab.addEventListener('click', () => this.app.switchMode(tab.dataset.mode));
    });
  }

  updateModeUI(mode) {
    const isHome = this.app.tabManager?.getActiveTab()?.isHome;
    if (isHome) return;
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    const splitContainer = document.getElementById('splitContainer');
    const blockModeEl = this.blockMode;
    const codeModeEl = this.codeMode;

    splitContainer.classList.toggle('split', mode === 'split');

    blockModeEl.classList.toggle('split-pane', mode === 'split');
    codeModeEl.classList.toggle('split-pane', mode === 'split');

    blockModeEl.classList.toggle('active', mode === 'block' || mode === 'split');
    codeModeEl.classList.toggle('active', mode === 'code' || mode === 'split');

    const blockOnly = document.getElementById('blockOnlyItems');
    if (blockOnly) blockOnly.style.display = (mode === 'block' || mode === 'split') ? '' : 'none';

    const divider = document.getElementById('splitDivider');
    if (divider) divider.style.display = mode === 'split' ? '' : 'none';
  }

  initSplitDivider() {
    const divider = document.getElementById('splitDivider');
    if (!divider) return;
    let startX = 0, startLeftW = 0;

    divider.addEventListener('mousedown', (e) => {
      startX = e.clientX;
      const codePane = document.getElementById('codeMode');
      startLeftW = codePane ? codePane.getBoundingClientRect().width : 0;
      divider.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev) => {
        const dx = startX - ev.clientX;
        const parent = divider.parentElement;
        const totalW = parent ? parent.getBoundingClientRect().width : window.innerWidth;
        const newLeftW = Math.max(280, Math.min(totalW - 280, startLeftW + dx));
        const pct = (newLeftW / totalW) * 100;
        const codePane = document.getElementById('codeMode');
        const blockPane = document.getElementById('blockMode');
        if (codePane) codePane.style.flex = `0 0 ${pct}%`;
        if (blockPane) blockPane.style.flex = '1 1 0';
      };

      const onUp = () => {
        divider.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  initToolbar() {
    document.querySelectorAll('.add-block-btn[data-type]').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleAddBlock(btn.dataset.type, e.shiftKey));
    });

    document.getElementById('btnRoleManager')?.addEventListener('click', () => this.openRoleManager());
    document.getElementById('btnBlockSearch')?.addEventListener('click', () => this.searchInBlocks());

    this.sectionJumpSelect?.addEventListener('change', () => {
      const blockId = this.sectionJumpSelect.value;
      if (!blockId) return;
      this.app.renderer.scrollToBlockId(blockId);
    });

    this.blockSearchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.searchInBlocks();
    });
  }

  searchInBlocks() {
    const keyword = (this.blockSearchInput?.value || '').trim();
    if (!keyword) return;
    const found = this.app.renderer.findBlockByKeyword(keyword);
    if (!found) {
      this.showInfoDialog?.('提示', `未找到: ${keyword}`);
      return;
    }
    this.app.renderer.scrollToBlockId(found.dataset.id);
    this.app.renderer.selectSingleBlock(found);
    this.app.updateStatus(`已定位: ${keyword}`);
  }

  refreshSectionJump() {
    if (!this.sectionJumpSelect || !this.app.renderer) return;
    const sections = this.app.renderer.getSections();
    this.sectionJumpSelect.innerHTML = '<option value="">跳转到分节...</option>' +
      sections.map((s, i) => `<option value="${this.escapeHtml(s.id)}">${i + 1}. ${this.escapeHtml(s.title)}</option>`).join('');
  }

  handleAddBlock(type, insertBefore = false) {
    if (this.app.currentMode === 'code') {
      this.handleAddToCode(type);
      return;
    }
    if (!this.app.renderer) return;

    const opts = { insertBefore };
    if (type === 'pause') {
      this.showSilenceDialog((duration) => {
        this.app.renderer.addBlock('pause', { ...opts, duration });
        this.app.fileManager.markUnsaved();
        this.refreshSectionJump();
      });
      return;
    }
    if (type === 'fx') {
      this.showEffectDialog((effectId, duration, fade) => {
        if (!effectId) {
          this.app.updateStatus('请先选择音效');
          return;
        }
        this.app.renderer.addBlock('fx', { ...opts, effectId, duration, fade });
        this.app.fileManager.markUnsaved();
        this.refreshSectionJump();
      });
      return;
    }
    if (type === 'repeat') {
      this.app.renderer.addBlock('repeat', opts);
    } else if (type === 'section') {
      this.app.renderer.addBlock('section', { ...opts, title: `分节 ${Date.now().toString().slice(-4)}` });
      this.refreshSectionJump();
    } else {
      const block = this.app.renderer.addBlock(type, opts);
      block?.querySelector?.('textarea')?.focus();
    }

    this.app.fileManager.markUnsaved();
    this.refreshSectionJump();
  }

  handleAddToCode(type) {
    const editor = this.app.codeEditor;
    if (!editor) return;

    if (type === 'pause') {
      this.showSilenceDialog((duration) => {
        editor.insertCodeAtCursor(`<pause dur="${duration}">`);
      });
    } else if (type === 'fx') {
      this.showEffectDialog((effectId, duration, fade) => {
        if (!effectId) {
          this.app.updateStatus('请先选择音效');
          return;
        }
        let attrs = `id="${effectId}"`;
        if (duration) attrs += ` dur="${duration}"`;
        if (fade) attrs += ` fade="${fade}"`;
        editor.insertCodeAtCursor(`<fx ${attrs}>`);
      });
    } else if (type === 'say') {
      editor.insertCodeAtCursor('<say role=""></say>', -6);
    } else if (type === 'repeat') {
      editor.insertCodeAtCursor('<repeat count="2">\n  \n</repeat>', -4);
    } else if (type === 'section') {
      editor.insertCodeAtCursor('<section title="分节标题">');
    } else if (type === 'divider') {
      editor.insertCodeAtCursor('<divider>');
    }
  }

  initDialogs() {
    this.initSilenceDialog();
    this.initEffectDialog();
    this.initUnsavedDialog();
    this.initInfoDialog();
    this.initRoleManagerDialog();
    this.initSettingsDialog();
    this.initAboutDialog();
    this.initUpdateDialog();
  }

  initSilenceDialog() {
    const silenceDialog = document.getElementById('silenceDialog');
    const sDuration = document.getElementById('silenceDuration');
    const sConfirm = document.getElementById('silenceConfirm');

    silenceDialog?.querySelector('.dialog-close')?.addEventListener('click', () => silenceDialog.classList.remove('active'));
    silenceDialog?.querySelector('.btn-cancel')?.addEventListener('click', () => silenceDialog.classList.remove('active'));

    if (sConfirm) {
      const newConfirm = sConfirm.cloneNode(true);
      sConfirm.parentNode.replaceChild(newConfirm, sConfirm);
      newConfirm.addEventListener('click', () => {
        const duration = parseInt(sDuration?.value, 10) || LISTEXT_CONSTANTS.DEFAULT_PAUSE_DURATION;
        if (this.silenceCallback) this.silenceCallback(duration);
        silenceDialog.classList.remove('active');
      });
    }
  }

  showSilenceDialog(callback) {
    this.silenceCallback = callback;
    document.getElementById('silenceDuration').value = LISTEXT_CONSTANTS.DEFAULT_PAUSE_DURATION;
    document.getElementById('silenceDialog')?.classList.add('active');
  }

  initEffectDialog() {
    const dialog = document.getElementById('effectDialog');
    if (!dialog) return;

    this._effectTab = 'builtin';
    this._selectedEffectId = null;
    this._previewingPath = null;
    this._effectBuiltinSounds = [];
    this._effectCustomEffects = [];
    this._effectProjectBuiltin = [];
    this._effectCallback = null;
    this._previewAudio = null;

    dialog.querySelector('.dialog-close')?.addEventListener('click', () => { this._stopPreview(); dialog.classList.remove('active'); });
    document.getElementById('effectDialogCancel')?.addEventListener('click', () => { this._stopPreview(); dialog.classList.remove('active'); });
    document.getElementById('effectDialogConfirm')?.addEventListener('click', () => {
      if (!this._selectedEffectId) { this.app.updateStatus('请先选择音效'); return; }
      const dur = parseInt(document.getElementById('effectDialogDuration')?.value, 10) || null;
      const fade = parseInt(document.getElementById('effectDialogFade')?.value, 10) || null;

      if (this._effectTab === 'builtin') {
        const builtin = this._effectBuiltinSounds.find(b => b.id === this._selectedEffectId);
        if (builtin && !(this._effectProjectBuiltin || []).find(e => e.id === this._selectedEffectId)) {
          this._effectProjectBuiltin = [...(this._effectProjectBuiltin || []), {
            id: builtin.id,
            source: 'builtin',
            filename: builtin.filename,
            group: builtin.group
          }];
          this._commitEffects();
        }
      }

      if (this._effectCallback) this._effectCallback(this._selectedEffectId, dur, fade);
      this._stopPreview();
      dialog.classList.remove('active');
    });

    document.getElementById('btnImportLocalFx')?.addEventListener('click', () => this._importLocalEffect());

    document.getElementById('effectGroupFilter')?.addEventListener('change', () => this._renderEffectList());

    document.getElementById('effectTabBuiltin')?.addEventListener('click', () => {
      this._effectTab = 'builtin';
      document.getElementById('effectTabBuiltin').classList.add('active');
      document.getElementById('effectTabCustom').classList.remove('active');
      document.getElementById('effectToolbar').style.display = 'flex';
      document.getElementById('effectCustomActions').style.display = 'none';
      this._renderEffectList();
    });

    document.getElementById('effectTabCustom')?.addEventListener('click', () => {
      this._effectTab = 'custom';
      document.getElementById('effectTabCustom').classList.add('active');
      document.getElementById('effectTabBuiltin').classList.remove('active');
      document.getElementById('effectToolbar').style.display = 'none';
      document.getElementById('effectCustomActions').style.display = 'flex';
      this._renderEffectList();
    });
  }

  async showEffectDialog(callback, preselectedId = null) {
    this._effectCallback = callback;
    this._selectedEffectId = preselectedId;
    this._previewingPath = null;
    this._stopPreview();

    if (window.electronAPI?.listBuiltinSounds) {
      try { this._effectBuiltinSounds = await window.electronAPI.listBuiltinSounds() || []; } catch { this._effectBuiltinSounds = []; }
    }

    this._effectCustomEffects = [];
    this._effectProjectBuiltin = [];
    if (window.electronAPI?.getProjectData) {
      try {
        const data = await window.electronAPI.getProjectData();
        this._effectProjectBuiltin = (data?.effects || []).filter(e => e.source === 'builtin');
        this._effectCustomEffects = (data?.effects || []).filter(e => e.source !== 'builtin');
      } catch { this._effectCustomEffects = []; this._effectProjectBuiltin = []; }
    }

    const groups = [...new Set(this._effectBuiltinSounds.map(s => s.group).filter(Boolean))];
    const filter = document.getElementById('effectGroupFilter');
    filter.innerHTML = '<option value="">全部分类</option>' + groups.map(g => `<option value="${this.escapeHtml(g)}">${this.escapeHtml(g)}</option>`).join('');
    filter.value = '';

    this._effectTab = 'builtin';
    document.getElementById('effectTabBuiltin').classList.add('active');
    document.getElementById('effectTabCustom').classList.remove('active');
    document.getElementById('effectToolbar').style.display = 'flex';
    document.getElementById('effectCustomActions').style.display = 'none';
    document.getElementById('effectDialogDuration').value = '';
    document.getElementById('effectDialogFade').value = '';

    this._renderEffectList();
    document.getElementById('effectDialog').classList.add('active');
  }

  _commitEffects() {
    // 提交全量音效列表，保留项目中已有的内置音效条目
    if (window.electronAPI?.setProjectEffects) {
      window.electronAPI.setProjectEffects([...(this._effectProjectBuiltin || []), ...this._effectCustomEffects]);
    }
  }

  escapeHtml(s) { return window.escapeHtml(s); }

  _renderEffectList() {
    const el = document.getElementById('effectList');
    if (!el) return;
    const effects = this._effectTab === 'builtin' ? this._effectBuiltinSounds : this._effectCustomEffects;
    const isBuiltin = this._effectTab === 'builtin';

    if (!effects || !effects.length) {
      el.innerHTML = `<div class="effect-empty">${isBuiltin ? '暂无系统音效' : '暂无自定义音效，点击下方按钮导入'}</div>`;
      return;
    }

    const groups = {};
    for (const e of effects) {
      const g = e.group || '未分组';
      if (!groups[g]) groups[g] = [];
      groups[g].push(e);
    }

    const activeFilter = isBuiltin ? document.getElementById('effectGroupFilter')?.value : '';

    let html = '';
    for (const [group, items] of Object.entries(groups)) {
      if (activeFilter && group !== activeFilter) continue;
      html += `<div class="effect-group-card"><div class="effect-group-header">${this.escapeHtml(group)} (${items.length})</div>`;
      for (const item of items) {
        const id = item.id;
        const meta = item.filename ? ` · ${this.escapeHtml(item.filename)}` : '';
        const selected = this._selectedEffectId === id ? ' selected' : '';
        const filePath = item.path || '';
        const isPlaying = this._previewingPath === filePath;
        html += `<div class="effect-item${selected}" data-effect-id="${this.escapeHtml(id)}">
          ${filePath ? `<button class="effect-item-preview${isPlaying ? ' playing' : ''}" data-play-path="${this.escapeHtml(filePath)}" title="${isPlaying ? '停止' : '试听'}"><span class="material-icons" style="font-size:16px">${isPlaying ? 'stop' : 'play_arrow'}</span></button>` : '<span class="material-icons" style="font-size:16px;margin-left:6px">music_note</span>'}
          <div class="effect-item-info"><div class="effect-item-name">${this.escapeHtml(id)}</div><div class="effect-item-meta">${this.escapeHtml(group)}${meta}</div></div>
          ${!isBuiltin ? `<button class="effect-item-remove" data-remove="${this.escapeHtml(id)}" title="删除"><span class="material-icons" style="font-size:16px">remove_circle</span></button>` : ''}
        </div>`;
      }
      html += '</div>';
    }
    el.innerHTML = html;

    el.querySelectorAll('.effect-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('[data-remove]') || e.target.closest('[data-play-path]')) return;
        this._selectedEffectId = item.dataset.effectId;
        this._renderEffectList();
      });
    });

    el.querySelectorAll('[data-play-path]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._previewSound(btn.dataset.playPath);
      });
    });

    el.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.remove;
        this._effectCustomEffects = this._effectCustomEffects.filter(e => e.id !== id);
        this._commitEffects();
        if (this._selectedEffectId === id) this._selectedEffectId = null;
        this._renderEffectList();
      });
    });
  }

  _previewSound(filePath) {
    if (!filePath) return;
    if (this._previewingPath === filePath) { this._stopPreview(); return; }
    this.app.ttsRenderer?.stopPlay();
    this._stopPreview();
    try {
      const url = filePath.replace(/\\/g, '/');
      const proto = url.startsWith('/') ? 'file://' + encodeURI(url) : 'file:///' + encodeURI(url);
      this._previewAudio = new Audio(proto);
      this._previewAudio.addEventListener('ended', () => this._stopPreview());
      this._previewAudio.play();
      this._previewingPath = filePath;
      this._renderEffectList();
    } catch (e) { console.error('音效预览失败:', e); }
  }

  _stopPreview() {
    if (this._previewAudio) { this._previewAudio.pause(); this._previewAudio = null; }
    if (this._previewingPath) { this._previewingPath = null; this._renderEffectList(); }
  }

  async _importLocalEffect() {
    if (!window.electronAPI?.selectAudioFile) return;
    const filePath = await window.electronAPI.selectAudioFile();
    if (!filePath) return;
    const parts = filePath.replace(/\\/g, '/').split('/');
    const filename = parts[parts.length - 1];
    const name = filename.replace(/\.[^.]+$/, '');
    if (this._effectCustomEffects.some(e => e.id === name)) { this.showInfoDialog?.('提示', '音效ID已存在'); return; }
    this._effectCustomEffects.push({ id: name, source: 'imported', filename, group: '用户音效', path: filePath });
    this._commitEffects();
    this._renderEffectList();
    this.app.updateStatus('已导入本地音效');
  }

  initUnsavedDialog() {
    if (!this.unsavedDialog) return;
    this.unsavedDialog.querySelector('.dialog-close')?.addEventListener('click', () => this.resolveUnsavedDialog('cancel'));
    this.unsavedCancelBtn?.addEventListener('click', () => this.resolveUnsavedDialog('cancel'));
    this.unsavedDiscardBtn?.addEventListener('click', () => this.resolveUnsavedDialog('discard'));
    this.unsavedSaveBtn?.addEventListener('click', () => this.resolveUnsavedDialog('save'));
  }

  initInfoDialog() {
    const close = () => this.infoDialog?.classList.remove('active');
    this.infoDialog?.querySelector('.dialog-close')?.addEventListener('click', close);
    this.infoDialog?.querySelector('#infoDialogConfirm')?.addEventListener('click', close);
  }

  showInfoDialog(title, message) {
    if (!this.infoDialog) return;
    this.infoDialogTitle.textContent = title || '提示';
    this.infoDialogBody.textContent = message || '';
    this.infoDialog.classList.add('active');
  }

  showUnsavedDialog(title) {
    if (!this.unsavedDialog) return Promise.resolve('cancel');
    this.unsavedDialogBody.textContent = `"${title}" 有未保存的更改`;
    this.unsavedDialog.classList.add('active');
    return new Promise(resolve => { this.unsavedDialogResolver = resolve; });
  }

  resolveUnsavedDialog(action) {
    if (!this.unsavedDialog) return;
    this.unsavedDialog.classList.remove('active');
    if (this.unsavedDialogResolver) {
      const resolver = this.unsavedDialogResolver;
      this.unsavedDialogResolver = null;
      resolver(action);
    }
  }

  initRoleManagerDialog() {
    const dialog = document.getElementById('roleManagerDialog');
    if (!dialog) return;
    dialog.querySelector('.dialog-close')?.addEventListener('click', () => dialog.classList.remove('active'));
  }
  async openRoleManager() {
    const dialog = document.getElementById('roleManagerDialog');
    if (!dialog) return;
    dialog.classList.add('active');
    if (!window._roleManagerPage) window._roleManagerPage = new RoleManagerPage();
    else {
      window._roleManagerPage.bind();
      await window._roleManagerPage.renderRoles();
      await window._roleManagerPage.clearForm();
    }
    setTimeout(() => {
      document.getElementById('roleId')?.focus();
    }, 100);
  }

  initSettingsDialog() {
    this.settingsCloseTopBtn?.addEventListener('click', () => this.settingsDialog.classList.remove('active'));
    this.settingsCancelBtn?.addEventListener('click', () => this.settingsDialog.classList.remove('active'));
    this.settingsSaveBtn?.addEventListener('click', async () => {
      if (!window.electronAPI) return;
      const proxyMode = this.proxyModeSelect?.value || 'system';
      const proxyUrl = this.proxyUrlInput?.value.trim() || '';
      const current = await window.electronAPI.getSettings();
      const result = await window.electronAPI.saveSettings({ ...current, proxyMode, proxyUrl });
      if (result?.success) {
        this.app.updateStatus('设置已保存');
        this.settingsDialog.classList.remove('active');
      } else {
        this.showInfoDialog?.('错误', '设置保存失败');
      }
    });
  }

  initAboutDialog() {
    const dialog = document.getElementById('aboutDialog');
    dialog?.querySelector('.about-close')?.addEventListener('click', () => dialog.classList.remove('active'));
    dialog?.querySelector('.about-close-btn')?.addEventListener('click', () => dialog.classList.remove('active'));
  }

  initUpdateDialog() {
    if (!this.updateDialog) return;
    this.updateLaterBtn?.addEventListener('click', () => this.updateDialog.classList.remove('active'));
    this.updateDownloadBtn?.addEventListener('click', () => {
      const url = this._updateDownloadUrl;
      if (url && window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(url);
      }
      this.updateDialog.classList.remove('active');
    });
  }

  showUpdateDialog(updateInfo, appInfo) {
    if (!this.updateDialog) return;
    const { latest_version, latest_download_url, latest_release_date, latest_changelog } = updateInfo;
    this._updateDownloadUrl = latest_download_url;

    if (this.updateAppName) this.updateAppName.textContent = appInfo?.name || '亿方听力大师';
    if (this.updateVersionOld) this.updateVersionOld.textContent = `v${appInfo?.version || ''}`;
    if (this.updateVersionNew) this.updateVersionNew.textContent = latest_version || '';
    if (this.updateReleaseDate) this.updateReleaseDate.textContent = latest_release_date ? `发布日期: ${latest_release_date}` : '';
    if (this.updateChangelog) this.updateChangelog.textContent = latest_changelog || '暂无更新说明';
    this.updateDialog.classList.add('active');
  }

  isNewerVersion(latest, current) {
    const a = (latest || '').replace(/^v/i, '').split('.').map(Number);
    const b = (current || '').replace(/^v/i, '').split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] || 0) > (b[i] || 0)) return true;
      if ((a[i] || 0) < (b[i] || 0)) return false;
    }
    return false;
  }

  async checkForUpdates() {
    if (!window.electronAPI?.checkUpdate || !window.electronAPI?.getAppInfo) return;
    try {
      const [updateInfo, appInfo] = await Promise.all([
        window.electronAPI.checkUpdate(),
        window.electronAPI.getAppInfo()
      ]);
      if (!updateInfo || !updateInfo.latest_version) return;
      if (this.isNewerVersion(updateInfo.latest_version, appInfo?.version)) {
        this.showUpdateDialog(updateInfo, appInfo);
      }
    } catch (e) {
      console.error('检查更新失败:', e);
    }
  }

  showAboutDialog() {
    const dialog = document.getElementById('aboutDialog');
    if (!dialog) return;

    const verEl = document.getElementById('aboutVersion');
    const platEl = document.getElementById('aboutPlatform');
    if (window.electronAPI?.getAppInfo) {
      window.electronAPI.getAppInfo().then(info => {
        if (verEl && info?.version) verEl.textContent = `v${info.version}`;
        if (platEl && info?.platform) {
          const osMap = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
          const archMap = { x64: 'x64', arm64: 'ARM64', loong64: 'LoongArch64' };
          const osName = osMap[info.platform] || info.platform;
          const archName = archMap[info.arch] || info.arch;
          platEl.textContent = `${osName} · ${archName}`;
        }
      }).catch(() => {});
    }

    dialog.classList.add('active');
  }

  async showSettingsDialog() {
    if (window.electronAPI?.openSettingsWindow) {
      await window.electronAPI.openSettingsWindow();
      return;
    }

    if (!this.settingsDialog || !window.electronAPI) return;
    const settings = await window.electronAPI.getSettings();
    this.proxyModeSelect.value = settings?.proxyMode || 'system';
    this.proxyUrlInput.value = settings?.proxyUrl || '';
    this.settingsDialog.classList.add('active');
  }

  initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const isMod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const inBlockMode = this.app.currentMode === 'block' && this.app.renderer;
      const textActive = this.app.isTextInputActive();
      const codeEditorActive = document.activeElement === this.app.codeEditor?.editor;
      const isHome = this.app.tabManager?.getActiveTab()?.isHome === true;

      if (this.matchShortcut(e, this.shortcuts.save)) {
        e.preventDefault();
        if (!isHome) this.app.fileManager.saveFile();
        return;
      }

      if (this.matchShortcut(e, this.shortcuts.toggleMode)) {
        e.preventDefault();
        this.app.switchMode(this.app.currentMode === 'block' ? 'code' : 'block');
        return;
      }

      if (isHome) return;

      if (this.matchShortcut(e, this.shortcuts.openEffects)) {
        e.preventDefault();
        this.showEffectDialog(() => {});
        return;
      }

      if (e.key === 'Escape') {
        this.app.ttsRenderer.stopPlay();
        document.querySelectorAll('.dialog.active').forEach(d => d.classList.remove('active'));
        return;
      }

      if (codeEditorActive) {
        if (this.matchShortcut(e, this.shortcuts.insertSay)) {
          e.preventDefault();
          this.app.codeEditor.insertTagTemplate('say');
          return;
        }
        if (this.matchShortcut(e, this.shortcuts.insertPause)) {
          e.preventDefault();
          this.app.codeEditor.insertTagTemplate('pause');
          return;
        }
        if (this.matchShortcut(e, this.shortcuts.insertRepeat)) {
          e.preventDefault();
          this.app.codeEditor.insertTagTemplate('repeat');
          return;
        }
        if (this.matchShortcut(e, this.shortcuts.insertSection)) {
          e.preventDefault();
          this.app.codeEditor.insertTagTemplate('section');
          return;
        }
        if (this.matchShortcut(e, this.shortcuts.insertFx)) {
          e.preventDefault();
          this.app.codeEditor.insertTagTemplate('fx');
          return;
        }
        if (this.matchShortcut(e, this.shortcuts.insertDivider)) {
          e.preventDefault();
          this.app.codeEditor.insertTagTemplate('divider');
          return;
        }
        return;
      }

      // 新建标签页（全局：代码模式 + 积木模式均可用）
      if (this.matchShortcut(e, this.shortcuts.addBlock)) {
        e.preventDefault();
        this.app.tabManager?.createNewTab();
        return;
      }

      if (!inBlockMode) return;

      if (textActive) return;

      if (this.matchShortcut(e, this.shortcuts.previewPlay)) {
        e.preventDefault();
        this.app.ttsRenderer.previewPlay();
        return;
      }

      if (this.matchShortcut(e, this.shortcuts.undo)) {
        e.preventDefault();
        if (this.app.renderer.undo()) {
          this.app.fileManager.markUnsaved();
          this.refreshSectionJump();
        }
        return;
      }

      if (this.matchShortcut(e, this.shortcuts.redo)) {
        e.preventDefault();
        if (this.app.renderer.redo()) {
          this.app.fileManager.markUnsaved();
          this.refreshSectionJump();
        }
        return;
      }

      if (this.matchShortcut(e, this.shortcuts.cut)) {
        e.preventDefault();
        this.app.renderer.cutSelectedBlocks();
        return;
      }

      if (this.matchShortcut(e, this.shortcuts.copy)) {
        e.preventDefault();
        this.app.renderer.copySelectedBlocks();
        return;
      }

      if (this.matchShortcut(e, this.shortcuts.paste)) {
        e.preventDefault();
        this.app.renderer.pasteClipboard();
        return;
      }

      if (this.matchShortcut(e, this.shortcuts.selectAll)) {
        e.preventDefault();
        this.app.renderer.selectAllBlocks();
        return;
      }

      if (this.matchShortcut(e, this.shortcuts.insertSay)) {
        e.preventDefault();
        this.handleAddBlock('say', e.shiftKey);
        return;
      }
      if (this.matchShortcut(e, this.shortcuts.insertPause)) {
        e.preventDefault();
        this.handleAddBlock('pause', e.shiftKey);
        return;
      }
      if (this.matchShortcut(e, this.shortcuts.insertRepeat)) {
        e.preventDefault();
        this.handleAddBlock('repeat', e.shiftKey);
        return;
      }
      if (this.matchShortcut(e, this.shortcuts.insertSection)) {
        e.preventDefault();
        this.handleAddBlock('section', e.shiftKey);
        return;
      }
      if (this.matchShortcut(e, this.shortcuts.insertFx)) {
        e.preventDefault();
        this.handleAddBlock('fx', e.shiftKey);
        return;
      }
      if (this.matchShortcut(e, this.shortcuts.insertDivider)) {
        e.preventDefault();
        this.handleAddBlock('divider', e.shiftKey);
        return;
      }

      if (e.key === 'ArrowDown' && !isMod) { e.preventDefault(); this.app.renderer.selectNextBlock(); return; }
      if (e.key === 'ArrowUp' && !isMod) { e.preventDefault(); this.app.renderer.selectPrevBlock(); return; }

      if (isMod && e.key === 'ArrowDown') { e.preventDefault(); this.app.renderer.moveSelectedBlock(1); return; }
      if (isMod && e.key === 'ArrowUp') { e.preventDefault(); this.app.renderer.moveSelectedBlock(-1); return; }

      if (e.key === 'Enter') { e.preventDefault(); this.app.renderer.focusSelectedBlockEditor(); return; }
      if (e.key === ' ') { e.preventDefault(); this.app.ttsRenderer.previewPlay(); return; }

      if (e.key === 'Backspace' && this.app.renderer.selectedBlocks?.size > 0) {
        e.preventDefault();
        this.app.renderer.deleteSelectedBlocks();
        return;
      }

      if (this.matchShortcut(e, this.shortcuts.deleteBlock) && this.app.renderer.selectedBlocks?.size > 0) {
        e.preventDefault();
        this.app.renderer.deleteSelectedBlocks();
      }
    });
  }
}
