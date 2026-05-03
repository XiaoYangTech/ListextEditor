/**
 * Listext Editor 主程序
 */

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
      onInput: () => this.fileManager.markUnsaved()
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
    window.electronAPI.onExportAudio((filePath) => {
      const content = this.getContent();
      this.exportHandler.exportAudio(content, this.parser, this.playQueue, filePath);
    });

    window.electronAPI.onShowSyntaxHelp(() => this.uiManager.showSyntaxHelp());
    window.electronAPI.onShowRoleManager(() => this.uiManager.openRoleManager());
    window.electronAPI.onShowSettings(() => this.uiManager.showSettingsDialog());

    window.electronAPI.onMenuEdit((action) => this.handleEditAction(action));
  }

  loadDefaultContent() {
    if (this.tabManager) this.fileManager.newFile();
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
      const code = this.parser.stringify(ast);
      this.codeEditor.setValue(code.trim());
    }
  }

  syncCodeToBlocks() {
    const code = this.codeEditor.getValue();
    this.originalCode = code;
    const ast = this.parser.parse(code);
    this.renderer.render(ast);
    this.uiManager.refreshSectionJump();
  }

  getContent() {
    if (this.currentMode === 'block') {
      return this.parser.stringify(this.renderer.collectAST()).trim();
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

