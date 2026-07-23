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
  }

  async loadShortcuts() {
    const defaults = window.SHORTCUT_DEFAULTS || {
      save: 'Ctrl+S', toggleMode: 'Ctrl+M', addBlock: 'Ctrl+N', deleteBlock: 'Delete',
      openEffects: 'Ctrl+Shift+E', previewPlay: 'F5', undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z',
      cut: 'Ctrl+X', copy: 'Ctrl+C', paste: 'Ctrl+V', selectAll: 'Ctrl+A',
      insertSay: 'Ctrl+1', insertPause: 'Ctrl+2', insertRepeat: 'Ctrl+3',
      insertSection: 'Ctrl+4', insertFx: 'Ctrl+5', insertDivider: 'Ctrl+6'
    };
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
      key: parts[parts.length - 1].toLowerCase()
    };
  }

  matchShortcut(e, shortcut) {
    const s = this.parseShortcut(shortcut);
    const isMod = e.ctrlKey || e.metaKey;
    return (isMod === s.ctrl) &&
           (e.altKey === s.alt) &&
           (e.shiftKey === s.shift) &&
           (e.key.toLowerCase() === s.key);
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
      this.app.uiManager?.showInfoDialog?.('提示', `未找到: ${keyword}`);
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
      sections.map((s, i) => `<option value="${s.id}">${i + 1}. ${s.title}</option>`).join('');
  }

  handleAddBlock(type, insertBefore = false) {
    if (this.app.currentMode === 'code') {
      this.handleAddToCode(type);
      return;
    }
    if (!this.app.renderer) return;

    const opts = { insertBefore };
    if (type === 'pause') {
      this.showSilenceDialog((duration) => this.app.renderer.addBlock('pause', { ...opts, duration }));
    } else if (type === 'fx') {
      this.showEffectDialog((effectId, duration, fade) => {
        if (!effectId) {
          this.app.updateStatus('请先选择音效');
          return;
        }
        this.app.renderer.addBlock('fx', { ...opts, effectId, duration, fade });
      });
    } else if (type === 'repeat') {
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
        const duration = parseInt(sDuration?.value, 10) || 1;
        if (this.silenceCallback) this.silenceCallback(duration);
        silenceDialog.classList.remove('active');
      });
    }
  }

  showSilenceDialog(callback) {
    this.silenceCallback = callback;
    document.getElementById('silenceDuration').value = 1;
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
    this._effectCallback = null;
    this._previewAudio = null;

    dialog.querySelector('.dialog-close')?.addEventListener('click', () => { this._stopPreview(); dialog.classList.remove('active'); });
    document.getElementById('effectDialogCancel')?.addEventListener('click', () => { this._stopPreview(); dialog.classList.remove('active'); });
    document.getElementById('effectDialogConfirm')?.addEventListener('click', () => {
      if (!this._selectedEffectId) { this.app.updateStatus('请先选择音效'); return; }
      const dur = parseInt(document.getElementById('effectDialogDuration')?.value, 10) || null;
      const fade = parseInt(document.getElementById('effectDialogFade')?.value, 10) || null;

      if (this._effectTab === 'builtin') {
        const builtin = this._effectBuiltinSounds.find(b => (b.id || b.name) === this._selectedEffectId);
        if (builtin) {
          const tab = this.app?.tabManager?.getActiveTab();
          if (tab && !(tab.effects || []).find(e => (e.id || e.name) === this._selectedEffectId)) {
            tab.effects = [...(tab.effects || []), {
              id: builtin.name || builtin.id,
              name: builtin.name || builtin.id,
              source: 'builtin',
              filename: builtin.filename,
              group: builtin.group
            }];
            if (window.electronAPI) window.electronAPI.setProjectEffects(tab.effects);
          }
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

  async showEffectDialog(callback) {
    this._effectCallback = callback;
    this._selectedEffectId = null;
    this._previewingPath = null;
    this._stopPreview();

    if (window.electronAPI?.listBuiltinSounds) {
      try { this._effectBuiltinSounds = await window.electronAPI.listBuiltinSounds() || []; } catch { this._effectBuiltinSounds = []; }
    }

    this._effectCustomEffects = [];
    if (window.electronAPI?.getProjectData) {
      try {
        const data = await window.electronAPI.getProjectData();
        this._effectCustomEffects = (data?.effects || []).filter(e => e.source !== 'builtin');
      } catch { this._effectCustomEffects = []; }
    }

    const groups = [...new Set(this._effectBuiltinSounds.map(s => s.group).filter(Boolean))];
    const filter = document.getElementById('effectGroupFilter');
    filter.innerHTML = '<option value="">全部分类</option>' + groups.map(g => `<option value="${g}">${g}</option>`).join('');
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
      html += `<div class="effect-group-card"><div class="effect-group-header">${group} (${items.length})</div>`;
      for (const item of items) {
        const id = item.id || item.name;
        const meta = item.filename ? ` · ${item.filename}` : '';
        const selected = this._selectedEffectId === id ? ' selected' : '';
        const filePath = item.path || '';
        const isPlaying = this._previewingPath === filePath;
        html += `<div class="effect-item${selected}" data-effect-id="${id}">
          ${filePath ? `<button class="effect-item-preview${isPlaying ? ' playing' : ''}" data-play-path="${filePath.replace(/"/g, '&quot;')}" title="${isPlaying ? '停止' : '试听'}"><span class="material-icons" style="font-size:16px">${isPlaying ? 'stop' : 'play_arrow'}</span></button>` : '<span class="material-icons" style="font-size:16px;margin-left:6px">music_note</span>'}
          <div class="effect-item-info"><div class="effect-item-name">${id}</div><div class="effect-item-meta">${group}${meta}</div></div>
          ${isBuiltin ? `<button class="effect-item-action" data-use="${id}">使用</button>` : `<button class="effect-item-remove" data-remove="${id}" title="删除"><span class="material-icons" style="font-size:16px">remove_circle</span></button>`}
        </div>`;
      }
      html += '</div>';
    }
    el.innerHTML = html;

    el.querySelectorAll('.effect-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('[data-use]') || e.target.closest('[data-remove]') || e.target.closest('[data-play-path]')) return;
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

    el.querySelectorAll('[data-use]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._selectedEffectId = btn.dataset.use;
        this._renderEffectList();
      });
    });

    el.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.remove;
        this._effectCustomEffects = this._effectCustomEffects.filter(e => e.id !== id);
        if (window.electronAPI?.setProjectEffects) {
          await window.electronAPI.setProjectEffects(this._effectCustomEffects);
        }
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
      const proto = url.startsWith('/') ? 'file://' + url : 'file:///' + url;
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
    if (this._effectCustomEffects.some(e => e.id === name)) { this.app.uiManager?.showInfoDialog?.('提示', '音效ID已存在'); return; }
    this._effectCustomEffects.push({ id: name, source: 'imported', filename, group: '用户音效', path: filePath });
    if (window.electronAPI?.setProjectEffects) {
      await window.electronAPI.setProjectEffects(this._effectCustomEffects);
    }
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
        this.app.uiManager?.showInfoDialog?.('错误', '设置保存失败');
      }
    });
  }

  initAboutDialog() {
    const dialog = document.getElementById('aboutDialog');
    dialog?.querySelector('.about-close')?.addEventListener('click', () => dialog.classList.remove('active'));
    dialog?.querySelector('.about-close-btn')?.addEventListener('click', () => dialog.classList.remove('active'));
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

    dialog.querySelectorAll('.about-bili-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.electronAPI?.openExternal) {
          window.electronAPI.openExternal(link.href);
        }
      });
    }, { once: true });

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
        this.app.renderer.undo();
        this.app.fileManager.markUnsaved();
        return;
      }

      if (this.matchShortcut(e, this.shortcuts.redo)) {
        e.preventDefault();
        this.app.renderer.redo();
        this.app.fileManager.markUnsaved();
        return;
      }

      if (this.matchShortcut(e, this.shortcuts.cut)) {
        e.preventDefault();
        this.app.renderer.cutSelectedBlocks();
        this.app.fileManager.markUnsaved();
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
        this.app.fileManager.markUnsaved();
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

      if (textActive) return;

      if (e.key === 'ArrowDown' && !isMod) { e.preventDefault(); this.app.renderer.selectNextBlock(); return; }
      if (e.key === 'ArrowUp' && !isMod) { e.preventDefault(); this.app.renderer.selectPrevBlock(); return; }

      if (isMod && e.key === 'ArrowDown') { e.preventDefault(); this.app.renderer.moveSelectedBlock(1); this.app.fileManager.markUnsaved(); return; }
      if (isMod && e.key === 'ArrowUp') { e.preventDefault(); this.app.renderer.moveSelectedBlock(-1); this.app.fileManager.markUnsaved(); return; }

      if (e.key === 'Enter') { e.preventDefault(); this.app.renderer.focusSelectedBlockEditor(); return; }
      if (e.key === ' ') { e.preventDefault(); this.app.ttsRenderer.previewPlay(); return; }

      if (e.key === 'Backspace' && this.app.renderer.selectedBlocks?.size > 0) {
        e.preventDefault();
        this.app.renderer.deleteSelectedBlocks();
        this.app.fileManager.markUnsaved();
        return;
      }

      if (this.matchShortcut(e, this.shortcuts.deleteBlock) && this.app.renderer.selectedBlocks?.size > 0) {
        e.preventDefault();
        this.app.renderer.deleteSelectedBlocks();
        this.app.fileManager.markUnsaved();
      }
    });
  }
}
