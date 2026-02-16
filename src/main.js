/**
 * Listext Editor 主程序
 */

class ListextEditor {
  constructor() {
    this.parser = new ListextParser();
    this.renderer = null; // BlockRenderer
    this.ttsEngine = new TTSEngine();
    this.playQueue = new PlayQueue(this.ttsEngine, this.parser);
    
    // 初始化 UI 模式（当前显示状态）
    this.currentMode = 'block';
    
    // 初始化组件
    this.init();
    
    // 初始化标签页管理器 (需在 init 之后，因为需要 DOM 元素)
    this.tabManager = new TabManager(this);
    
    // 加载默认内容 (新建一个标签页)
    this.loadDefaultContent();
  }

  init() {
    // 1. 初始化 UI 管理器 (DOM 元素, Dialogs, Toolbar, Shortcuts)
    this.uiManager = new UIManager(this);
    
    // 2. 初始化积木渲染器
    this.initBlockRenderer();
    
    // 3. 初始化代码编辑器
    this.initCodeEditor();
    
    // 4. 初始化文件管理器
    this.fileManager = new FileManager(this);
    
    // 5. 初始化导出处理器
    this.exportHandler = new ExportHandler(this);

    // 6. 初始化 TTS 渲染器 (Playback control)
    this.ttsRenderer = new TTSRenderer(this, this.playQueue, this.parser);
    
    // 7. 初始化 Electron 事件
    this.initElectronEvents();
    
    // 8. 检查公告
    this.uiManager.checkNotice();
  }

  initBlockRenderer() {
    this.renderer = new BlockRenderer(this.uiManager.blockContainer, this.parser);
    
    this.renderer.onChange(() => {
      this.fileManager.markUnsaved();
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
      }
    });
  }

  initElectronEvents() {
    if (!window.electronAPI) return;
    
    window.electronAPI.onMenuNew(() => this.fileManager.newFile());
    window.electronAPI.onMenuSave(() => this.fileManager.saveFile());
    window.electronAPI.onSaveAs(async (filePath) => await this.fileManager.saveFileAs(filePath));
    window.electronAPI.onFileOpened((content, filePath) => this.fileManager.openFile(content, filePath));
    
    window.electronAPI.onPreviewPlay(() => this.ttsRenderer.previewPlay());
    window.electronAPI.onStopPlay(() => this.ttsRenderer.stopPlay());
    window.electronAPI.onExportAudio((filePath) => this.exportHandler.exportAudio(null, null, null, filePath));
    
    window.electronAPI.onShowSyntaxHelp(() => this.uiManager.showSyntaxHelp());
    window.electronAPI.onShowRoleManager(() => this.uiManager.openRoleManager());
    window.electronAPI.onShowSettings(() => this.uiManager.showSettingsDialog());

    window.electronAPI.onMenuEdit((action) => {
      this.handleEditAction(action);
    });
  }

  loadDefaultContent() {
    if (this.tabManager) {
      this.fileManager.newFile();
    }
  }

  /**
   * 切换编辑模式
   * @param {string} mode 'block' | 'code'
   * @param {boolean} sync 是否同步内容 (切换标签页时不需要同步，只需加载)
   */
  switchMode(mode, sync = true) {
    if (mode === this.currentMode && sync) return;
    
    // 同步内容
    if (sync) {
      if (this.currentMode === 'block') {
        this.syncBlocksToCode();
      } else {
        this.syncCodeToBlocks();
      }
    }
    
    // 切换显示
    this.uiManager.updateModeUI(mode);
    
    this.currentMode = mode;
    if (mode === 'block') {
      this.codeEditor.hideSuggestions();
    } else {
      this.codeEditor.updateCodeHighlight();
      this.codeEditor.validateCode();
    }
    
    // 更新当前标签页的模式状态
    if (this.tabManager) {
      const activeTab = this.tabManager.getActiveTab();
      if (activeTab) {
        activeTab.mode = mode;
      }
    }
  }

  syncBlocksToCode() {
    const ast = this.renderer.collectAST();
    // 使用 parser.stringify 直接生成带注释的代码
    const code = this.parser.stringify(ast);
    this.codeEditor.setValue(code.trim());
  }

  syncCodeToBlocks() {
    const code = this.codeEditor.getValue();
    // parse 方法现在会自动处理注释节点
    const ast = this.parser.parse(code);
    this.renderer.render(ast);
  }

  /**
   * 获取当前编辑器内容
   */
  getContent() {
    if (this.currentMode === 'block') {
      return this.parser.stringify(this.renderer.collectAST()).trim();
    } else {
      return this.codeEditor.getValue();
    }
  }
  
  /**
   * 设置编辑器内容
   * @param {string} content 内容
   * @param {string} mode 目标模式
   */
  setContent(content, mode = 'block') {
    // 强制切换模式且不进行同步
    this.switchMode(mode, false);
    
    this.codeEditor.setValue(content);
    
    // 如果是积木模式，需要渲染积木
    // 如果是代码模式，积木渲染可以延迟到切换时
    if (mode === 'block') {
      const ast = this.parser.parse(content);
      this.renderer.render(ast);
    } else {
      // 清空积木以避免混淆
      this.renderer.clear();
    }
  }

  updateStatus(text) {
    if (this.uiManager && this.uiManager.statusText) {
      this.uiManager.statusText.textContent = text;
    }
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
      if (['undo', 'redo', 'cut', 'paste'].includes(action)) {
        this.fileManager.markUnsaved();
      }
      return;
    }
    if (this.codeEditor) this.codeEditor.focus();
    const commandMap = {
      undo: 'undo',
      redo: 'redo',
      cut: 'cut',
      copy: 'copy',
      paste: 'paste',
      selectAll: 'selectAll'
    };
    const cmd = commandMap[action];
    if (cmd) {
      document.execCommand(cmd);
    }
  }
}

// 启动应用
window.addEventListener('DOMContentLoaded', () => {
  window.app = new ListextEditor();
});
