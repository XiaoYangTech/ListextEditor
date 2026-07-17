class ListextEditor {
  constructor() {
    this.parser = new ListextParser();
    this.renderer = null;
    this.ttsEngine = new TTSEngine();
    this.playQueue = new PlayQueue(this.ttsEngine, this.parser);
    this.currentMode = 'block';
    this._isSyncing = false;
    this._syncTimer = null;

    this.init();
    this.tabManager = new TabManager(this);
    this.loadDefaultContent();
  }

  init() {
    this.uiManager = new UIManager(this);
    this.initBlockRenderer();
    this.initCodeEditor();
    this.fileManager = new FileManager(this);
    this.exportHandler = new ExportHandler(window.electronAPI, (text) => this.updateStatus(text));
    this.ttsRenderer = new TTSRenderer(this, this.playQueue, this.parser);
    this.initElectronEvents();
    this.initHomePage();
  }

  initHomePage() {
    const el = document.getElementById('homePlatformInfo');
    if (!el) return;
    const api = window.electronAPI || {};
    const platformMap = { win32: 'Windows', darwin: 'macOS' };
    const os = platformMap[api.platform] || 'Linux';
    const arch = api.arch || 'x64';
    el.textContent = `v1.1.0 · ${os} ${arch}`;
  }

  initBlockRenderer() {
    this.renderer = new BlockRenderer(this.uiManager.blockContainer, this.parser);
    this._baseBlockChangeHandler = () => {
      this.fileManager.markUnsaved();
      this.uiManager.refreshSectionJump();
    };
    this.renderer.onChange(this._baseBlockChangeHandler);
  }

  initCodeEditor() {
    this.codeEditor = new CodeEditor({
      codeEditor: document.getElementById('codeEditor'),
      lineNumbers: document.getElementById('lineNumbers'),
      codeHighlight: document.getElementById('codeHighlight'),
      codeSuggestions: document.getElementById('codeSuggestions'),
      errorContainer: document.getElementById('errorContainer')
    }, this.parser, {
      onInput: () => {
        this.fileManager.markUnsaved();
        this.syncCodeRolesToProject(this.codeEditor.getValue());
      }
    });
  }

  initElectronEvents() {
    if (!window.electronAPI) return;

    window.electronAPI.onMenuNew(() => this.fileManager.newFile());
    window.electronAPI.onMenuSave(() => this.fileManager.saveFile());
    window.electronAPI.onSaveAs(async (filePath) => await this.fileManager.saveFileAs(filePath));
    window.electronAPI.onMenuOpenProject(async (filePath) => {
      await this.fileManager.openProjectByPath(filePath);
    });

    window.electronAPI.onPreviewPlay(() => this.ttsRenderer.previewPlay());
    window.electronAPI.onStopPlay(() => this.ttsRenderer.stopPlay());
    window.electronAPI.onExportAudio(() => {
      this.exportHandler.showExportDialog();
    });

    window.electronAPI.onShowSyntaxHelp(() => this.uiManager.showSyntaxHelp());
    window.electronAPI.onShowRoleManager(() => this.uiManager.openRoleManager());
    window.electronAPI.onShowSettings(() => this.uiManager.showSettingsDialog());

    window.electronAPI.onMenuEdit((action) => this.handleEditAction(action));

    window.electronAPI.onProjectEffectsChanged((effects) => {
      const tab = this.tabManager?.getActiveTab();
      if (tab) {
        tab.effects = effects;
        this.fileManager.markUnsaved();
      }
      if (this.codeEditor) {
        this.codeEditor.projectEffects = effects || [];
      }
    });

    window.electronAPI.onProjectRolesChanged((roles) => {
      const tab = this.tabManager?.getActiveTab();
      if (tab) {
        tab.roles = roles;
        this.fileManager.markUnsaved();
      }
      if (this.codeEditor) {
        this.codeEditor.projectRoles = roles || [];
        if (this.currentMode === 'code') {
          const code = this.codeEditor.getValue();
          const codeRoles = this.parser.parseRoleDefsFromCode(code);
          const codeRoleIds = new Set(codeRoles.map(r => r.id));
          const missingRoles = (roles || []).filter(r => !codeRoleIds.has(r.id));
          if (missingRoles.length) {
            const roleTags = missingRoles.map(r => {
              const attrs = [`id="${r.id || ''}"`, `name="${r.name || r.id || ''}"`];
              if (r.type) attrs.push(`type="${r.type}"`);
              if (r.voice) attrs.push(`voice="${r.voice}"`);
              return `<role ${attrs.join(' ')}>`;
            }).join('\n');
            this.codeEditor.setValue(roleTags + '\n' + code);
          }
          this.syncRolesToCode(roles);
          // 角色管理器修改后回写代码，再将代码结果同步回项目配置。
          this.syncCodeRolesToProject(this.codeEditor.getValue());
        }
      }
    });

    window.addEventListener('beforeunload', () => {
      if (window.app?.playQueue?.isPlaying) {
        window.app.playQueue.stop();
      }
    });

    window.electronAPI?.onRequestCloseCheck?.(() => this.handleCloseCheck());
  }

  async handleCloseCheck() {
    if (this.playQueue?.isPlaying) this.playQueue.stop();

    const unsavedTabs = this.tabManager?.tabs.filter(t => t.isDirty && !t.isHome) || [];
    if (!unsavedTabs.length) {
      window.electronAPI?.sendCloseCheckResult?.(true);
      return;
    }

    for (const tab of unsavedTabs) {
      const action = await this.showUnsavedDialog(tab.title);
      if (action === 'cancel') {
        window.electronAPI?.sendCloseCheckResult?.(false);
        return;
      }
      if (action === 'save') {
        const saved = await this.fileManager.saveSpecificTab(tab.id);
        if (!saved) {
          window.electronAPI?.sendCloseCheckResult?.(false);
          return;
        }
      }
    }

    window.electronAPI?.sendCloseCheckResult?.(true);
  }

  loadDefaultContent() {
    // Home tab is already created by TabManager, no need to create a new tab
  }

  getActiveProjectData() {
    const tab = this.tabManager?.getActiveTab();
    return {
      roles: tab?.roles || [],
      effects: tab?.effects || []
    };
  }

  updateActiveProjectData(data) {
    const tab = this.tabManager?.getActiveTab();
    if (tab) {
      if (data.roles) tab.roles = data.roles;
      if (data.effects) tab.effects = data.effects;
      this.fileManager.markUnsaved();
    }
  }

  switchMode(mode, sync = true) {
    if (mode !== 'block' && mode !== 'code' && mode !== 'split') return;
    if (mode === this.currentMode && sync) return;

    this.stopSplitSync();

    if (sync && this.currentMode !== mode) {
      try {
        if (this.currentMode === 'block') this.syncBlocksToCode();
        else if (this.currentMode === 'code') this.syncCodeToBlocks();
        else if (this.currentMode === 'split') {
          if (mode === 'code') { /* code already up to date */ }
          else if (mode === 'block') this.syncCodeToBlocks();
        }
      } catch (e) {
        console.warn('模式切换同步失败:', e);
        this.updateStatus('模式切换失败，请先修正语法后再切换');
        return;
      }
    }

    this.uiManager.updateModeUI(mode);
    this.currentMode = mode;

    if (mode === 'block') {
      this.codeEditor.hideSuggestions();
      this.uiManager.refreshSectionJump();
    } else if (mode === 'split') {
      this.codeEditor.hideSuggestions();
      this.uiManager.refreshSectionJump();
      this.refreshCodeContext();
      this.startSplitSync();
    } else {
      this.refreshCodeContext();
    }

    if (this.tabManager) {
      const activeTab = this.tabManager.getActiveTab();
      if (activeTab) activeTab.mode = mode;
    }
  }

  refreshCodeContext() {
    const projectData = this.getActiveProjectData();
    this.codeEditor.projectRoles = projectData.roles || [];
    this.codeEditor.projectEffects = projectData.effects || [];
    if (window.electronAPI) {
      window.electronAPI.getProjectData().then(data => {
        if (data?.effects) this.codeEditor.projectEffects = data.effects;
        if (data?.roles) this.codeEditor.projectRoles = data.roles;
      }).catch(() => {});
    }
    this.codeEditor.refreshView();
  }

  startSplitSync() {
    const baseHandler = this._baseBlockChangeHandler;
    this._splitBlockHandler = () => {
      if (this._isSyncing) return;
      clearTimeout(this._syncTimer);
      this._syncTimer = setTimeout(() => {
        this._isSyncing = true;
        try { this.syncBlocksToCode(); } catch {}
        this._isSyncing = false;
      }, 200);
    };
    this.renderer.onChangeCallback = () => {
      if (baseHandler) baseHandler();
      this._splitBlockHandler();
    };

    this._splitCodeHandler = () => {
      if (this._isSyncing) return;
      clearTimeout(this._syncTimer);
      this._syncTimer = setTimeout(() => {
        this._isSyncing = true;
        try { this.syncCodeToBlocks(); } catch {}
        this._isSyncing = false;
      }, 200);
    };
    this.codeEditor.editor.addEventListener('input', this._splitCodeHandler);
  }

  stopSplitSync() {
    clearTimeout(this._syncTimer);
    this._syncTimer = null;
    if (this._baseBlockChangeHandler) {
      this.renderer.onChangeCallback = this._baseBlockChangeHandler;
    }
    if (this._splitCodeHandler) {
      this.codeEditor.editor.removeEventListener('input', this._splitCodeHandler);
    }
    this._splitBlockHandler = null;
    this._splitCodeHandler = null;
  }

  syncBlocksToCode() {
    const ast = this.renderer.collectAST();
    let code = this.parser.stringify(ast).trim();

    const tab = this.tabManager?.getActiveTab();
    const projectRoles = tab?.roles || [];
    const codeRoles = this.parser.parseRoleDefsFromCode(code);
    const codeRoleIds = new Set(codeRoles.map(r => r.id));

    const missingRoles = projectRoles.filter(r => !codeRoleIds.has(r.id));
    if (missingRoles.length) {
      const roleTags = missingRoles.map(r => {
        const attrs = [`id="${r.id || ''}"`, `name="${r.name || r.id || ''}"`];
        if (r.type) attrs.push(`type="${r.type}"`);
        if (r.voice) attrs.push(`voice="${r.voice}"`);
        return `<role ${attrs.join(' ')}>`;
      }).join('\n');
      code = roleTags + '\n' + code;
    }

    this.codeEditor.setValue(code);
  }

  syncCodeToBlocks() {
    const code = this.codeEditor.getValue();
    const ast = this.parser.parse(code);
    this.renderer.render(ast);
    this.uiManager.refreshSectionJump();

    this.syncCodeRolesToProject(code);
  }

  syncCodeRolesToProject(code) {
    if (!code) return;
    const codeRoles = this.parser.parseRoleDefsFromCode(code);
    if (!codeRoles.length) return;

    const tab = this.tabManager?.getActiveTab();
    if (!tab) return;

    const codeRoleIds = new Set(codeRoles.map(r => r.id));
    const configuredRoles = (tab.roles || []).filter(r => !codeRoleIds.has(r.id));
    const nextRoles = [
      ...codeRoles.map(role => ({ ...role, source: 'code' })),
      ...configuredRoles
    ];
    if (JSON.stringify(tab.roles || []) === JSON.stringify(nextRoles)) return;
    tab.roles = nextRoles;
    if (window.electronAPI) {
      window.electronAPI.setProjectRoles(tab.roles);
    }
  }

  syncRolesToCode(roles) {
    if (this.currentMode !== 'code' && this.currentMode !== 'split') return;
    const code = this.codeEditor?.getValue() || '';
    const roleMap = new Map((roles || []).filter(r => r?.id).map(r => [r.id, r]));
    const usedIds = new Set();
    const roleTag = role => {
      const attrs = [`id="${role.id || ''}"`, `name="${role.name || role.id || ''}"`];
      if (role.type) attrs.push(`type="${role.type}"`);
      if (role.voice) attrs.push(`voice="${role.voice}"`);
      return `<role ${attrs.join(' ')}>`;
    };

    let nextCode = code.replace(/<role\s+([^>]*)>/gi, (full, attrText) => {
      const id = attrText.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
      const role = id ? roleMap.get(id) : null;
      if (!role) return full;
      usedIds.add(id);
      return roleTag(role);
    });

    const missing = (roles || []).filter(role => role?.id && !usedIds.has(role.id));
    if (missing.length) nextCode = missing.map(roleTag).join('\n') + (nextCode ? `\n${nextCode}` : '');
    if (nextCode !== code) this.codeEditor.setValue(nextCode);
  }

  getContent() {
    if (this.currentMode === 'split' || this.currentMode === 'code') {
      return this.codeEditor.getValue();
    }
    let code = this.parser.stringify(this.renderer.collectAST()).trim();

    const tab = this.tabManager?.getActiveTab();
    const projectRoles = tab?.roles || [];
    const codeRoles = this.parser.parseRoleDefsFromCode(code);
    const codeRoleIds = new Set(codeRoles.map(r => r.id));

    const missingRoles = projectRoles.filter(r => !codeRoleIds.has(r.id));
    if (missingRoles.length) {
      const roleTags = missingRoles.map(r => {
        const attrs = [`id="${r.id || ''}"`, `name="${r.name || r.id || ''}"`];
        if (r.type) attrs.push(`type="${r.type}"`);
        if (r.voice) attrs.push(`voice="${r.voice}"`);
        return `<role ${attrs.join(' ')}>`;
      }).join('\n');
      code = roleTags + '\n' + code;
    }

    return code;
  }

  setContent(content, mode = 'block') {
    const safeMode = mode === 'code' ? 'code' : 'block';
    const safeContent = typeof content === 'string' ? content : '';

    this.switchMode(safeMode, false);
    this.codeEditor.setValue(safeContent);

    if (safeMode === 'block') {
      try {
        const ast = this.parser.parse(safeContent);
        this.renderer.render(ast);
      } catch (e) {
        console.warn('恢复积木内容失败:', e);
        this.renderer.clear();
      }
      this.uiManager.refreshSectionJump();
    }

    if (safeMode === 'code') {
      const projectData = this.getActiveProjectData();
      this.codeEditor.setProjectContext(projectData.roles, projectData.effects);
      this.codeEditor.refreshView();
    }

  }

  clearEditor() {
    this.setContent('', 'block');
  }

  showUnsavedDialog(title) { return this.uiManager.showUnsavedDialog(title); }
  saveSpecificTab(tabId) { return this.fileManager.saveSpecificTab(tabId); }
  updateStatusForTab(tab) { return this.fileManager.updateStatusForTab(tab); }

  updateStatus(text) {
    if (this.uiManager?.statusText) this.uiManager.statusText.textContent = text;
  }

  isTextInputActive() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'TEXTAREA' || tag === 'INPUT' || el.isContentEditable;
  }

  handleEditAction(action) {
    if ((this.currentMode === 'block' || this.currentMode === 'split') && this.renderer && !this.isTextInputActive()) {
      if (action === 'undo') this.renderer.undo();
      if (action === 'redo') this.renderer.redo();
      if (action === 'copy') this.renderer.copySelectedBlocks();
      if (action === 'cut') this.renderer.cutSelectedBlocks();
      if (action === 'paste') this.renderer.pasteClipboard();
      if (action === 'selectAll') this.renderer.selectAllBlocks();
      if (['undo', 'redo', 'cut', 'paste'].includes(action)) this.fileManager.markUnsaved();
      return;
    }

    if (this.codeEditor) this.codeEditor.focus();
    const commandMap = { undo: 'undo', redo: 'redo', cut: 'cut', copy: 'copy', paste: 'paste', selectAll: 'selectAll' };
    const cmd = commandMap[action];
    if (cmd) document.execCommand(cmd);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new ListextEditor();
});
