class UIManager {
  constructor(app) {
    this.app = app;
    this.initElements();
    this.initModeSwitcher();
    this.initToolbar();
    this.initDialogs();
    this.initKeyboardShortcuts();
  }

  initElements() {
    this.blockMode = document.getElementById('blockMode');
    this.codeMode = document.getElementById('codeMode');
    this.blockContainer = document.getElementById('blockContainer');
    this.statusText = document.getElementById('statusText');
    this.currentFileEl = document.getElementById('currentFile');

    this.sectionJumpSelect = document.getElementById('sectionJumpSelect');
    this.blockSearchInput = document.getElementById('blockSearchInput');

    this.unsavedDialog = document.getElementById('unsavedDialog');
    this.unsavedDialogBody = document.getElementById('unsavedDialogBody');
    this.unsavedSaveBtn = document.getElementById('unsavedSave');
    this.unsavedDiscardBtn = document.getElementById('unsavedDiscard');
    this.unsavedCancelBtn = document.getElementById('unsavedCancel');

    this.noticeDialog = document.getElementById('noticeDialog');
    this.noticeContent = document.getElementById('noticeContent');
    this.noticeDismissToday = document.getElementById('noticeDismissToday');
    this.noticeCloseBtn = document.getElementById('noticeClose');
    this.noticeCloseTopBtn = document.getElementById('noticeCloseTop');
    this.noticeOpenUrlBtn = document.getElementById('noticeOpenUrl');

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
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    this.blockMode?.classList.toggle('active', mode === 'block');
    this.codeMode?.classList.toggle('active', mode === 'code');
  }

  initToolbar() {
    document.querySelectorAll('.add-block-btn[data-type]').forEach(btn => {
      btn.addEventListener('click', () => this.handleAddBlock(btn.dataset.type));
    });

    document.getElementById('btnRoleManager')?.addEventListener('click', () => this.openRoleManager());
    document.getElementById('btnBlockSearch')?.addEventListener('click', () => this.searchInBlocks());
    document.getElementById('btnSectionRefresh')?.addEventListener('click', () => this.refreshSectionJump());

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
      this.app.updateStatus(`未找到: ${keyword}`);
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

  handleAddBlock(type) {
    if (this.app.currentMode !== 'block') this.app.switchMode('block');
    if (!this.app.renderer) return;

    if (type === 'pause') {
      this.showSilenceDialog((duration) => this.app.renderer.addBlock('pause', { duration }));
    } else if (type === 'fx') {
      this.showEffectDialog((effectId, duration) => {
        if (!effectId) {
          this.app.updateStatus('请先导入音效');
          return;
        }
        this.app.renderer.addBlock('fx', { effectId, duration });
      });
    } else if (type === 'repeat') {
      this.app.renderer.addBlock('repeat');
    } else if (type === 'section') {
      this.app.renderer.addBlock('section', { title: `分节 ${Date.now().toString().slice(-4)}` });
      this.refreshSectionJump();
    } else {
      const block = this.app.renderer.addBlock(type);
      block?.querySelector?.('textarea')?.focus();
    }

    this.app.fileManager.markUnsaved();
    this.refreshSectionJump();
  }

  initDialogs() {
    this.initSilenceDialog();
    this.initEffectDialog();
    this.initUnsavedDialog();
    this.initRoleManagerDialog();
    this.initSyntaxHelpDialog();
    this.initNoticeDialog();
    this.initSettingsDialog();
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
    const effectDialog = document.getElementById('effectDialog');
    const effectSelect = document.getElementById('effectSelect');
    const effectDuration = document.getElementById('effectDuration');
    const effectConfirm = document.getElementById('effectConfirm');

    document.getElementById('btnOpenEffectManager')?.addEventListener('click', async () => {
      await window.electronAPI?.openEffectManagerWindow?.();
    });

    effectDialog?.querySelector('.dialog-close')?.addEventListener('click', () => effectDialog.classList.remove('active'));
    effectDialog?.querySelector('.btn-cancel')?.addEventListener('click', () => effectDialog.classList.remove('active'));

    if (effectConfirm) {
      const newConfirm = effectConfirm.cloneNode(true);
      effectConfirm.parentNode.replaceChild(newConfirm, effectConfirm);
      newConfirm.addEventListener('click', () => {
        const dur = effectDuration?.value ? parseInt(effectDuration.value, 10) : null;
        if (this.effectCallback) this.effectCallback(effectSelect?.value, dur);
        effectDialog.classList.remove('active');
      });
    }
  }

  async showEffectDialog(callback) {
    this.effectCallback = callback;
    const effectDialog = document.getElementById('effectDialog');
    const effectSelect = document.getElementById('effectSelect');
    const effectDuration = document.getElementById('effectDuration');

    const effects = await window.electronAPI?.loadEffects() || {};
    const ids = Object.keys(effects);
    effectSelect.innerHTML = ids.length
      ? ids.map(id => `<option value="${id}">${id}</option>`).join('')
      : '<option value="">（暂无音效，请先在音效管理器导入）</option>';

    effectDuration.value = '';
    effectDialog.classList.add('active');
  }

  initUnsavedDialog() {
    if (!this.unsavedDialog) return;
    this.unsavedDialog.querySelector('.dialog-close')?.addEventListener('click', () => this.resolveUnsavedDialog('cancel'));
    this.unsavedCancelBtn?.addEventListener('click', () => this.resolveUnsavedDialog('cancel'));
    this.unsavedDiscardBtn?.addEventListener('click', () => this.resolveUnsavedDialog('discard'));
    this.unsavedSaveBtn?.addEventListener('click', () => this.resolveUnsavedDialog('save'));
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

  initRoleManagerDialog() {}
  async openRoleManager() { await window.electronAPI?.openRoleManagerWindow?.(); }

  initSyntaxHelpDialog() {
    const dialog = document.getElementById('syntaxHelpDialog');
    dialog?.querySelector('.dialog-close')?.addEventListener('click', () => dialog.classList.remove('active'));
    document.getElementById('btnCopySyntaxExample')?.addEventListener('click', async () => {
      const text = document.getElementById('syntaxExampleCode')?.textContent || '';
      try {
        await navigator.clipboard.writeText(text);
        this.app.updateStatus('语法示例已复制');
      } catch {
        this.app.updateStatus('复制失败，请手动复制');
      }
    });
  }

  showSyntaxHelp() { document.getElementById('syntaxHelpDialog')?.classList.add('active'); }

  initNoticeDialog() {
    this.noticeCloseTopBtn?.addEventListener('click', () => this.closeNoticeDialog());
    this.noticeCloseBtn?.addEventListener('click', () => this.closeNoticeDialog());
    this.noticeOpenUrlBtn?.addEventListener('click', async () => {
      if (this.noticeUrl && window.electronAPI) await window.electronAPI.openExternal(this.noticeUrl);
    });
  }

  async checkNotice() {
    if (!window.electronAPI || !this.noticeDialog) return;
    const settings = await window.electronAPI.getSettings();
    const today = this.getTodayKey();
    if (settings?.noticeDismissDate === today) return;

    const res = await window.electronAPI.getNotice();
    if (!res?.success || !res.notice) return;

    this.noticeUrl = res.url || '';
    if (this.noticeContent) this.noticeContent.textContent = res.notice;
    if (this.noticeDismissToday) this.noticeDismissToday.checked = false;
    if (this.noticeOpenUrlBtn) this.noticeOpenUrlBtn.style.display = this.noticeUrl ? 'inline-flex' : 'none';
    this.noticeDialog.classList.add('active');
  }

  getTodayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  async closeNoticeDialog() {
    if (!this.noticeDialog) return;
    this.noticeDialog.classList.remove('active');
    if (!window.electronAPI) return;
    if (this.noticeDismissToday?.checked) {
      const settings = await window.electronAPI.getSettings();
      await window.electronAPI.saveSettings({ ...settings, noticeDismissDate: this.getTodayKey() });
    }
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
        this.app.updateStatus('设置保存失败');
      }
    });
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

      // Global
      if (isMod && key === 's') {
        e.preventDefault();
        this.app.fileManager.saveFile();
        return;
      }

      if (e.key === 'F5') {
        e.preventDefault();
        this.app.ttsRenderer.previewPlay();
        return;
      }

      if (e.key === 'Escape') {
        this.app.ttsRenderer.stopPlay();
        document.querySelectorAll('.dialog.active').forEach(d => d.classList.remove('active'));
        return;
      }

      if (!inBlockMode) return;

      // 快捷新增（Alt + 数字）——文本编辑状态也可用
      const addMap = {
        '1': 'say',
        '2': 'pause',
        '3': 'repeat',
        '4': 'section',
        '5': 'fx',
        '6': 'divider'
      };
      if (e.altKey && addMap[key]) {
        e.preventDefault();
        this.handleAddBlock(addMap[key]);
        return;
      }

      // 文本编辑状态下：只保留 Alt+数字新增，其它交给文本输入
      if (textActive) return;

      // 块选择导航
      if (e.key === 'ArrowDown' && !isMod) {
        e.preventDefault();
        this.app.renderer.selectNextBlock();
        return;
      }
      if (e.key === 'ArrowUp' && !isMod) {
        e.preventDefault();
        this.app.renderer.selectPrevBlock();
        return;
      }

      // 块重排
      if (isMod && e.key === 'ArrowDown') {
        e.preventDefault();
        this.app.renderer.moveSelectedBlock(1);
        this.app.fileManager.markUnsaved();
        return;
      }
      if (isMod && e.key === 'ArrowUp') {
        e.preventDefault();
        this.app.renderer.moveSelectedBlock(-1);
        this.app.fileManager.markUnsaved();
        return;
      }

      // 选中块编辑
      if (e.key === 'Enter') {
        e.preventDefault();
        this.app.renderer.focusSelectedBlockEditor();
        return;
      }

      // 播放
      if (e.key === ' ') {
        e.preventDefault();
        this.app.ttsRenderer.previewPlay();
        return;
      }

      // 原有编辑快捷键
      if (isMod) {
        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) this.app.renderer.redo();
          else this.app.renderer.undo();
          this.app.fileManager.markUnsaved();
          return;
        }
        if (key === 'y') {
          e.preventDefault();
          this.app.renderer.redo();
          this.app.fileManager.markUnsaved();
          return;
        }
        if (key === 'c') { e.preventDefault(); this.app.renderer.copySelectedBlocks(); return; }
        if (key === 'x') { e.preventDefault(); this.app.renderer.cutSelectedBlocks(); this.app.fileManager.markUnsaved(); return; }
        if (key === 'v') { e.preventDefault(); this.app.renderer.pasteClipboard(); this.app.fileManager.markUnsaved(); return; }
        if (key === 'a') { e.preventDefault(); this.app.renderer.selectAllBlocks(); return; }
      }

      if (key === 'delete' || key === 'backspace') {
        if (this.app.renderer.selectedBlocks?.size > 0) {
          e.preventDefault();
          this.app.renderer.deleteSelectedBlocks();
          this.app.fileManager.markUnsaved();
        }
      }
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = UIManager;
}
