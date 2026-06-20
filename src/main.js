class ListextEditor {
  constructor() {
    this.parser = new ListextParser();
    this.renderer = null;
    this.ttsEngine = new TTSEngine();
    this.playQueue = new PlayQueue(this.ttsEngine, this.parser);
    this.currentMode = 'block';
    this.originalCode = '';

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
    this.uiManager.checkNotice();
  }

  initBlockRenderer() {
    this.renderer = new BlockRenderer(this.uiManager.blockContainer, this.parser);
    this.renderer.onChange(() => {
      this.fileManager.markUnsaved();
      this.uiManager.refreshSectionJump();
      this.ttsRenderer?.updateEstimatedDuration();
    });
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
        this.ttsRenderer?.updateEstimatedDuration();
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
      }
    });

    window.addEventListener('beforeunload', () => {
      if (window.app?.playQueue?.isPlaying) {
        window.app.playQueue.stop();
      }
    });
  }

  loadDefaultContent() {
    if (this.tabManager) this.fileManager.newFile();
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
    if (mode !== 'block' && mode !== 'code') return;
    if (mode === this.currentMode && sync) return;

    if (sync) {
      try {
        if (this.currentMode === 'block') this.syncBlocksToCode();
        else this.syncCodeToBlocks();
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
    } else {
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

    if (this.tabManager) {
      const activeTab = this.tabManager.getActiveTab();
      if (activeTab) activeTab.mode = mode;
    }
  }

  syncBlocksToCode() {
    if (this.originalCode) {
      this.codeEditor.setValue(this.originalCode);
      this.originalCode = '';
    } else {
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
  }

  syncCodeToBlocks() {
    const code = this.codeEditor.getValue();
    this.originalCode = code;
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

    const existingRoles = tab.roles || [];
    const existingMap = new Map(existingRoles.map(r => [r.id, r]));

    for (const cr of codeRoles) {
      if (!cr.id) continue;
      if (!existingMap.has(cr.id)) {
        existingRoles.push({ ...cr, source: 'code' });
      }
    }

    tab.roles = existingRoles;
    if (window.electronAPI) {
      window.electronAPI.setProjectRoles(existingRoles);
    }
  }

  getContent() {
    if (this.currentMode === 'block') {
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
    return this.codeEditor.getValue();
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

    setTimeout(() => this.ttsRenderer?.updateEstimatedDuration(), 100);
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
    if (this.currentMode === 'block' && this.renderer && !this.isTextInputActive()) {
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
