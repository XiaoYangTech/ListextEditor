/**
 * Listext Editor 主程序
 */

class ListextEditor {
  constructor() {
    this.parser = new ListextParser();
    this.renderer = null;
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
    this.initElements();
    this.initModeSwitcher();
    this.initToolbar();
    this.initBlockRenderer();
    this.initCodeEditor();
    this.initPlayback();
    this.initDialogs();
    this.initElectronEvents();
    this.initKeyboardShortcuts();
    this.checkNotice();
  }

  initElements() {
    this.blockMode = document.getElementById('blockMode');
    this.codeMode = document.getElementById('codeMode');
    this.blockContainer = document.getElementById('blockContainer');
    this.codeEditor = document.getElementById('codeEditor');
    this.lineNumbers = document.getElementById('lineNumbers');
    this.codeHighlight = document.getElementById('codeHighlight');
    this.codeSuggestions = document.getElementById('codeSuggestions');
    this.errorContainer = document.getElementById('errorContainer');
    this.statusText = document.getElementById('statusText');
    this.currentFileEl = document.getElementById('currentFile');
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
    const tabs = document.querySelectorAll('.mode-tab');
    if (tabs && tabs.length) {
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          const mode = tab.dataset.mode;
          this.switchMode(mode);
        });
      });
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
    document.querySelectorAll('.mode-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.mode === mode);
    });
    
    this.blockMode.classList.toggle('active', mode === 'block');
    this.codeMode.classList.toggle('active', mode === 'code');
    
    this.currentMode = mode;
    if (mode === 'block') {
      this.hideSuggestions();
    } else {
      this.updateCodeHighlight();
      this.validateCode();
    }
    
    // 更新当前标签页的模式状态
    if (this.tabManager) {
      const activeTab = this.tabManager.getActiveTab();
      if (activeTab) {
        activeTab.mode = mode;
      }
    }
  }

  initToolbar() {
    // 添加积木按钮
    const addBtns = document.querySelectorAll('.add-block-btn');
    if (addBtns && addBtns.length) {
      addBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const type = btn.dataset.type;
          this.handleAddBlock(type);
        });
      });
    }
    const roleMgrBtn = document.getElementById('btnRoleManager');
    if (roleMgrBtn) {
      roleMgrBtn.addEventListener('click', () => {
        this.openRoleManager();
      });
    }
  }

  handleAddBlock(type) {
    if (this.currentMode !== 'block') {
      this.switchMode('block');
    }
    if (!this.renderer) {
      this.initBlockRenderer();
    }
    
    if (type === 'pause') {
      this.showSilenceDialog((duration) => {
        this.renderer.addBlock('pause', { duration });
      });
    } else if (type === 'fx') {
      this.showEffectDialog((effectId, duration) => {
        this.renderer.addBlock('fx', { effectId, duration });
      });
    } else if (type === 'repeat') {
      this.renderer.addBlock('repeat');
    } else if (type === 'say') {
      const block = this.renderer.addBlock('say');
      const textarea = block.querySelector('textarea');
      if (textarea) textarea.focus();
    } else {
      this.renderer.addBlock(type);
    }
    
    this.markUnsaved();
  }

  initBlockRenderer() {
    this.renderer = new BlockRenderer(this.blockContainer, this.parser);
    
    this.renderer.onChange(() => {
      this.markUnsaved();
    });
  }

  initCodeEditor() {
    // 行号更新
    this.updateLineNumbers();
    this.updateCodeHighlight();
    
    this.codeEditor.addEventListener('input', () => {
      this.updateLineNumbers();
      this.markUnsaved();
      this.validateCode();
      this.updateCodeHighlight();
      this.updateSuggestions();
    });

    this.codeEditor.addEventListener('click', () => {
      this.updateSuggestions();
    });

    this.codeEditor.addEventListener('keyup', () => {
      this.updateSuggestions();
    });

    this.codeEditor.addEventListener('blur', () => {
      this.hideSuggestions();
    });
    
    this.codeEditor.addEventListener('scroll', () => {
      this.lineNumbers.scrollTop = this.codeEditor.scrollTop;
      if (this.codeHighlight) {
        this.codeHighlight.scrollTop = this.codeEditor.scrollTop;
      }
    });
    
    // Tab 键支持
    this.codeEditor.addEventListener('keydown', (e) => {
      if (this.handleCodeEditorKeydown(e)) return;
    });
  }

  updateLineNumbers() {
    const lines = this.codeEditor.value.split('\n');
    this.lineNumbers.innerHTML = lines.map((_, i) => 
      `<div class="line-number">${i + 1}</div>`
    ).join('');
  }

  updateCodeHighlight() {
    if (!this.codeHighlight) return;
    const source = this.codeEditor.value;
    this.codeHighlight.innerHTML = this.highlightListext(source);
  }

  highlightListext(text) {
    const escaped = this.escapeHtml(text);
    const withComments = escaped.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="token-comment">$1</span>');
    const highlighted = withComments.replace(/(&lt;\/?)([a-zA-Z]+)((?:[^&]|&(?!gt;))*)(\/?&gt;)/g, (m, open, tag, attrs, close) => {
      const attrText = attrs.replace(/([a-zA-Z-:]+)(=)(&quot;[^&]*?&quot;|&apos;[^&]*?&apos;|[^\s&]+)/g, '<span class="token-attr">$1</span><span class="token-punct">$2</span><span class="token-value">$3</span>');
      return `<span class="token-punct">${open}</span><span class="token-tag">${tag}</span>${attrText}<span class="token-punct">${close}</span>`;
    });
    return highlighted || '';
  }

  escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  handleCodeEditorKeydown(e) {
    if (this.codeSuggestions && this.codeSuggestions.style.display !== 'none') {
      const items = Array.from(this.codeSuggestions.querySelectorAll('.code-suggestion-item'));
      if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'Escape') {
          this.hideSuggestions();
          return true;
        }
        let index = items.findIndex(item => item.classList.contains('active'));
        if (e.key === 'ArrowDown') {
          index = (index + 1) % items.length;
        } else if (e.key === 'ArrowUp') {
          index = (index - 1 + items.length) % items.length;
        } else {
          if (index < 0) index = 0;
          const value = items[index]?.dataset?.value;
          if (value) {
            this.applySuggestion(value);
          }
          return true;
        }
        items.forEach((item, i) => item.classList.toggle('active', i === index));
        return true;
      }
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        this.outdentSelection();
      } else {
        this.indentSelection();
      }
      return true;
    }
    return false;
  }

  updateSuggestions() {
    if (!this.codeSuggestions || !this.codeEditor) return;
    const caret = this.codeEditor.selectionStart;
    const before = this.codeEditor.value.slice(0, caret);
    const tagMatch = before.match(/<([a-zA-Z]+)([^<>]*)$/);
    if (!tagMatch) {
      const openMatch = before.match(/<([a-zA-Z]*)$/);
      if (!openMatch) {
        this.hideSuggestions();
        return;
      }
      const prefix = openMatch[1] || '';
      const tags = Object.keys(this.parser.tagDefinitions || {});
      const items = tags.filter(tag => tag.startsWith(prefix));
      if (!items.length) {
        this.hideSuggestions();
        return;
      }
      this.codeSuggestions.dataset.mode = 'tag';
      const lineHeight = 22.4;
      const lastNewline = before.lastIndexOf('\n');
      const line = before.slice(0, caret).split('\n').length - 1;
      const col = lastNewline === -1 ? before.length : before.length - lastNewline - 1;
      const left = 50 + 16 + col * 8;
      const top = 16 + line * lineHeight - this.codeEditor.scrollTop + lineHeight;
      this.renderSuggestions(items, { left, top }, prefix, caret - prefix.length, '标签');
      return;
    }

    const tagName = tagMatch[1].toLowerCase();
    const attrsPart = tagMatch[2] || '';
    const inDoubleQuote = (attrsPart.match(/"/g) || []).length % 2 === 1;
    const inSingleQuote = (attrsPart.match(/'/g) || []).length % 2 === 1;
    if (inDoubleQuote || inSingleQuote) {
      this.hideSuggestions();
      return;
    }

    if (/\s/.test(attrsPart)) {
      const attrPrefixMatch = attrsPart.match(/(?:^|\s)([a-zA-Z-]*)$/);
      const prefix = attrPrefixMatch ? attrPrefixMatch[1] : '';
      const attrs = this.getAttributeSuggestions(tagName);
      const items = attrs.filter(attr => attr.startsWith(prefix));
      if (!items.length) {
        this.hideSuggestions();
        return;
      }
      this.codeSuggestions.dataset.mode = 'attribute';
      const lineHeight = 22.4;
      const lastNewline = before.lastIndexOf('\n');
      const line = before.slice(0, caret).split('\n').length - 1;
      const col = lastNewline === -1 ? before.length : before.length - lastNewline - 1;
      const left = 50 + 16 + col * 8;
      const top = 16 + line * lineHeight - this.codeEditor.scrollTop + lineHeight;
      this.renderSuggestions(items, { left, top }, prefix, caret - prefix.length, '属性');
      return;
    }

    const tagPrefixMatch = before.match(/<([a-zA-Z]*)$/);
    if (!tagPrefixMatch) {
      this.hideSuggestions();
      return;
    }
    const prefix = tagPrefixMatch[1] || '';
    const tags = Object.keys(this.parser.tagDefinitions || {});
    const items = tags.filter(tag => tag.startsWith(prefix));
    if (!items.length) {
      this.hideSuggestions();
      return;
    }
    this.codeSuggestions.dataset.mode = 'tag';
    const lineHeight = 22.4;
    const lastNewline = before.lastIndexOf('\n');
    const line = before.slice(0, caret).split('\n').length - 1;
    const col = lastNewline === -1 ? before.length : before.length - lastNewline - 1;
    const left = 50 + 16 + col * 8;
    const top = 16 + line * lineHeight - this.codeEditor.scrollTop + lineHeight;
    this.renderSuggestions(items, { left, top }, prefix, caret - prefix.length, '标签');
  }

  renderSuggestions(items, position, prefix, replaceStart, hint) {
    this.codeSuggestions.innerHTML = items.map((tag, idx) => `
      <div class="code-suggestion-item ${idx === 0 ? 'active' : ''}" data-value="${tag}">
        <span>${tag}</span>
        <span class="hint">${hint}</span>
      </div>
    `).join('');
    this.codeSuggestions.style.display = 'block';
    this.codeSuggestions.style.left = `${position.left}px`;
    this.codeSuggestions.style.top = `${Math.max(0, position.top)}px`;
    this.codeSuggestions.dataset.replaceStart = replaceStart;
    this.codeSuggestions.dataset.prefix = prefix;
    this.codeSuggestions.querySelectorAll('.code-suggestion-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.applySuggestion(item.dataset.value);
      });
    });
  }

  applySuggestion(value) {
    if (this.codeSuggestions.dataset.mode === 'attribute') {
      this.applyAttributeSuggestion(value);
      return;
    }
    const start = parseInt(this.codeSuggestions.dataset.replaceStart || '0', 10);
    const end = this.codeEditor.selectionStart;
    const before = this.codeEditor.value.substring(0, start);
    const after = this.codeEditor.value.substring(end);
    let insertText = value;
    let cursorOffset = value.length;
    if (this.codeSuggestions.dataset.mode === 'tag' && before.endsWith('<')) {
      insertText = `${value}></${value}>`;
      cursorOffset = value.length + 1;
    }
    this.codeEditor.value = `${before}${insertText}${after}`;
    const nextPos = before.length + cursorOffset;
    this.codeEditor.selectionStart = this.codeEditor.selectionEnd = nextPos;
    this.hideSuggestions();
    this.updateLineNumbers();
    this.updateCodeHighlight();
  }

  applyAttributeSuggestion(value) {
    const start = parseInt(this.codeSuggestions.dataset.replaceStart || '0', 10);
    const end = this.codeEditor.selectionStart;
    const before = this.codeEditor.value.substring(0, start);
    const after = this.codeEditor.value.substring(end);
    const insertText = `${value}=""`;
    this.codeEditor.value = `${before}${insertText}${after}`;
    const nextPos = before.length + value.length + 2;
    this.codeEditor.selectionStart = this.codeEditor.selectionEnd = nextPos;
    this.hideSuggestions();
    this.updateLineNumbers();
    this.updateCodeHighlight();
  }

  getAttributeSuggestions(tagName) {
    const map = {
      say: ['role', 'rate'],
      v: ['id', 'rate'],
      pause: ['dur'],
      fx: ['id', 'dur', 'fade'],
      repeat: ['count']
    };
    return map[tagName] || [];
  }

  indentSelection() {
    const value = this.codeEditor.value;
    const start = this.codeEditor.selectionStart;
    const end = this.codeEditor.selectionEnd;
    if (start === end) {
      this.codeEditor.value = value.substring(0, start) + '  ' + value.substring(end);
      this.codeEditor.selectionStart = this.codeEditor.selectionEnd = start + 2;
      this.updateLineNumbers();
      this.updateCodeHighlight();
      return;
    }
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = value.indexOf('\n', end);
    const endPos = lineEnd === -1 ? value.length : lineEnd;
    const selected = value.slice(lineStart, endPos);
    const lines = selected.split('\n');
    const indented = lines.map(line => `  ${line}`).join('\n');
    this.codeEditor.value = value.slice(0, lineStart) + indented + value.slice(endPos);
    const newStart = start + 2;
    const newEnd = end + lines.length * 2;
    this.codeEditor.selectionStart = newStart;
    this.codeEditor.selectionEnd = newEnd;
    this.updateLineNumbers();
    this.updateCodeHighlight();
  }

  outdentSelection() {
    const value = this.codeEditor.value;
    const start = this.codeEditor.selectionStart;
    const end = this.codeEditor.selectionEnd;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = value.indexOf('\n', end);
    const endPos = lineEnd === -1 ? value.length : lineEnd;
    const selected = value.slice(lineStart, endPos);
    const lines = selected.split('\n');
    let removedTotal = 0;
    const outdented = lines.map(line => {
      if (line.startsWith('  ')) {
        removedTotal += 2;
        return line.slice(2);
      }
      if (line.startsWith('\t')) {
        removedTotal += 1;
        return line.slice(1);
      }
      return line;
    }).join('\n');
    this.codeEditor.value = value.slice(0, lineStart) + outdented + value.slice(endPos);
    const newStart = Math.max(lineStart, start - 2);
    const newEnd = Math.max(lineStart, end - removedTotal);
    this.codeEditor.selectionStart = newStart;
    this.codeEditor.selectionEnd = newEnd;
    this.updateLineNumbers();
    this.updateCodeHighlight();
  }

  hideSuggestions() {
    if (!this.codeSuggestions) return;
    this.codeSuggestions.style.display = 'none';
    this.codeSuggestions.innerHTML = '';
  }

  validateCode() {
    if (!this.errorContainer) return;
    
    const code = this.codeEditor.value;
    let errors = [];
    try {
      errors = this.parser.validate(code);
      const extra = this.validateRoleAndEffectRefs(code);
      if (extra.length) {
        errors = errors.concat(extra);
      }
    } catch (e) {
      errors = [{ line: 1, message: '代码校验失败，请检查语法' }];
    }
    
    if (errors.length > 0) {
      this.errorContainer.style.display = 'block';
      this.errorContainer.innerHTML = errors.map(e => 
        `<div>第 ${e.line} 行: ${e.message}</div>`
      ).join('');
    } else {
      this.errorContainer.style.display = 'none';
      this.errorContainer.innerHTML = '';
    }
  }

  validateRoleAndEffectRefs(code) {
    const errors = [];
    const roleIds = this.getRoleIdSet();
    const effectIds = this.effectIdSet || null;
    const tagRegex = /<([a-zA-Z]+)([^>]*)>/g;
    let match;
    while ((match = tagRegex.exec(code)) !== null) {
      const tagName = match[1].toLowerCase();
      const attrStr = match[2] || '';
      const attrs = this.parser.parseAttributes(attrStr);
      const index = match.index;
      const lineNum = code.slice(0, index).split('\n').length;
      if (tagName === 'say' && attrs.role && !roleIds.has(attrs.role)) {
        errors.push({ line: lineNum, message: `角色未定义: ${attrs.role}` });
      }
      if (tagName === 'v' && attrs.id && !roleIds.has(attrs.id)) {
        errors.push({ line: lineNum, message: `角色未定义: ${attrs.id}` });
      }
      if (tagName === 'fx' && attrs.id && effectIds && !effectIds.has(attrs.id)) {
        errors.push({ line: lineNum, message: `音效ID未定义: ${attrs.id}` });
      }
    }
    this.ensureEffectIdSet();
    return errors;
  }

  getRoleIdSet() {
    try {
      const raw = localStorage.getItem('listext_roles') || '[]';
      const roles = JSON.parse(raw);
      return new Set(roles.map(r => r.id));
    } catch (e) {
      return new Set();
    }
  }

  ensureEffectIdSet() {
    if (!window.electronAPI || this.effectIdSetLoading) return;
    if (this.effectIdSet) return;
    this.effectIdSetLoading = true;
    window.electronAPI.loadEffects().then(effects => {
      this.effectIdSet = new Set(Object.keys(effects || {}));
    }).catch(() => {
      this.effectIdSet = null;
    }).finally(() => {
      this.effectIdSetLoading = false;
    });
  }

  initPlayback() {
    const btnPreview = document.getElementById('btnPreview');
    const btnStop = document.getElementById('btnStop');
    const btnExport = document.getElementById('btnExport');
    
    if (btnPreview) btnPreview.addEventListener('click', () => this.previewPlay());
    if (btnStop) btnStop.addEventListener('click', () => this.stopPlay());
    if (btnExport) btnExport.addEventListener('click', () => this.exportAudioTo());
    
    // 播放队列回调
    this.playQueue.onProgress = (info) => {
      this.statusText.textContent = `播放中 ${info.current + 1}/${info.total}`;
    };
    
    this.playQueue.onComplete = () => {
      this.statusText.textContent = '播放完成';
    };

    this.playQueue.onTtsFallback = () => {
      this.statusText.textContent = 'EdgeTTS 失败，已尝试系统TTS';
    };

    this.playQueue.onTtsError = (message) => {
      this.statusText.textContent = message || 'TTS 调用失败';
    };
    
    this.playQueue.onBlockHighlight = (node, highlight) => {
      // 可视化高亮当前播放块
      this.highlightCurrentBlock(node, highlight);
    };
  }

  previewPlay() {
    const content = this.getContent();
    const ast = this.parser.parse(content);
    
    if (ast.length === 0) {
      this.statusText.textContent = '没有可播放的内容';
      return;
    }
    
    this.playQueue.play(ast);
    this.statusText.textContent = '开始播放...';
  }

  stopPlay() {
    this.playQueue.stop();
    this.statusText.textContent = '播放停止';
    
    // 清除高亮
    document.querySelectorAll('.block.playing').forEach(el => {
      el.classList.remove('playing');
    });
  }
  
  highlightCurrentBlock(node, highlight) {
    if (this.currentMode !== 'block') return;
    
    // 尝试找到对应的块
    // 这里需要 BlockRenderer 支持根据 AST 节点反查块，或者在生成 AST 时附带 ID
    // 假设 AST 节点有 uiId
    if (node.uiId) {
      const block = this.blockContainer.querySelector(`.block[data-id="${node.uiId}"]`);
      if (block) {
        if (highlight) {
          block.classList.add('playing');
          block.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          block.classList.remove('playing');
        }
      }
    }
  }

  initDialogs() {
    // 简单的对话框实现，实际项目可能需要更复杂的 UI
    
    // 静音对话框
    let silenceCallback = null;
    const silenceDialog = document.getElementById('silenceDialog');
    const sDuration = document.getElementById('silenceDuration');
    const sConfirm = document.getElementById('silenceConfirm');
    
    if (silenceDialog) {
      const sClose = silenceDialog.querySelector('.dialog-close');
      if (sClose) sClose.addEventListener('click', () => silenceDialog.classList.remove('active'));
      const sCancel = silenceDialog.querySelector('.btn-cancel');
      if (sCancel) sCancel.addEventListener('click', () => silenceDialog.classList.remove('active'));
    }
    
    if (sConfirm) {
      // 移除可能存在的旧监听器（如果多次调用 initDialogs）
      const newConfirm = sConfirm.cloneNode(true);
      sConfirm.parentNode.replaceChild(newConfirm, sConfirm);
      
      newConfirm.addEventListener('click', () => {
        const duration = parseInt(sDuration.value) || 1;
        if (silenceCallback) silenceCallback(duration);
        silenceDialog.classList.remove('active');
      });
    }

    if (this.unsavedDialog) {
      const closeBtn = this.unsavedDialog.querySelector('.dialog-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this.resolveUnsavedDialog('cancel'));
      }
      if (this.unsavedCancelBtn) {
        this.unsavedCancelBtn.addEventListener('click', () => this.resolveUnsavedDialog('cancel'));
      }
      if (this.unsavedDiscardBtn) {
        this.unsavedDiscardBtn.addEventListener('click', () => this.resolveUnsavedDialog('discard'));
      }
      if (this.unsavedSaveBtn) {
        this.unsavedSaveBtn.addEventListener('click', () => this.resolveUnsavedDialog('save'));
      }
    }
    
    this.showSilenceDialog = (callback) => {
      silenceCallback = callback;
      if (sDuration) sDuration.value = 1;
      if (silenceDialog) silenceDialog.classList.add('active');
    };
    
    // 音效对话框
    let effectCallback = null;
    const effectDialog = document.getElementById('effectDialog');
    const effectSelect = document.getElementById('effectSelect');
    const effectDuration = document.getElementById('effectDuration');
    const effectConfirm = document.getElementById('effectConfirm');
    
    if (effectDialog) {
      const eClose = effectDialog.querySelector('.dialog-close');
      if (eClose) eClose.addEventListener('click', () => effectDialog.classList.remove('active'));
      const eCancel = effectDialog.querySelector('.btn-cancel');
      if (eCancel) eCancel.addEventListener('click', () => effectDialog.classList.remove('active'));
    }
    
    if (effectConfirm) {
      const newConfirm = effectConfirm.cloneNode(true);
      effectConfirm.parentNode.replaceChild(newConfirm, effectConfirm);

      newConfirm.addEventListener('click', () => {
        const dur = effectDuration.value ? parseInt(effectDuration.value) : null;
        if (effectCallback) effectCallback(effectSelect.value, dur);
        effectDialog.classList.remove('active');
      });
    }
    
    this.showEffectDialog = async (callback) => {
      effectCallback = callback;
      // 加载可用音效
      const effects = await window.electronAPI?.loadEffects() || {};
      if (effectSelect) {
        effectSelect.innerHTML = Object.keys(effects).length > 0
          ? Object.keys(effects).map(id => `<option value="${id}">${id}</option>`).join('')
          : '<option value="bell">bell (默认)</option>';
      }
      if (effectDuration) effectDuration.value = '';
      if (effectDialog) effectDialog.classList.add('active');
    };

    // 角色管理器对话框
    const roleMgrDialog = document.getElementById('roleManagerDialog');
    
    // 角色管理器逻辑
    if (roleMgrDialog) {
      this.initRoleManagerLogic(roleMgrDialog);
    }

    // 语法帮助对话框
    const syntaxHelpDialog = document.getElementById('syntaxHelpDialog');
    if (syntaxHelpDialog) {
      const hClose = syntaxHelpDialog.querySelector('.dialog-close');
      if (hClose) hClose.addEventListener('click', () => syntaxHelpDialog.classList.remove('active'));
    }

    this.showSyntaxHelp = () => {
      if (syntaxHelpDialog) syntaxHelpDialog.classList.add('active');
    };

    if (this.noticeDialog) {
      if (this.noticeCloseTopBtn) this.noticeCloseTopBtn.addEventListener('click', () => this.closeNoticeDialog());
      if (this.noticeCloseBtn) this.noticeCloseBtn.addEventListener('click', () => this.closeNoticeDialog());
      if (this.noticeOpenUrlBtn) {
        this.noticeOpenUrlBtn.addEventListener('click', async () => {
          if (this.noticeUrl && window.electronAPI) {
            await window.electronAPI.openExternal(this.noticeUrl);
          }
        });
      }
    }

    if (this.settingsDialog) {
      if (this.settingsCloseTopBtn) this.settingsCloseTopBtn.addEventListener('click', () => this.settingsDialog.classList.remove('active'));
      if (this.settingsCancelBtn) this.settingsCancelBtn.addEventListener('click', () => this.settingsDialog.classList.remove('active'));
      if (this.settingsSaveBtn) {
        this.settingsSaveBtn.addEventListener('click', async () => {
          if (!window.electronAPI) return;
          const proxyMode = this.proxyModeSelect ? this.proxyModeSelect.value : 'system';
          const proxyUrl = this.proxyUrlInput ? this.proxyUrlInput.value.trim() : '';
          const current = await window.electronAPI.getSettings();
          const result = await window.electronAPI.saveSettings({
            ...current,
            proxyMode,
            proxyUrl
          });
          if (result?.success) {
            this.statusText.textContent = '设置已保存';
            this.settingsDialog.classList.remove('active');
          } else {
            this.statusText.textContent = '设置保存失败';
          }
        });
      }
    }
  }

  async showSettingsDialog() {
    if (!this.settingsDialog || !window.electronAPI) return;
    const settings = await window.electronAPI.getSettings();
    if (this.proxyModeSelect) this.proxyModeSelect.value = settings?.proxyMode || 'system';
    if (this.proxyUrlInput) this.proxyUrlInput.value = settings?.proxyUrl || '';
    this.settingsDialog.classList.add('active');
  }

  getTodayKey() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
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
    if (this.noticeOpenUrlBtn) {
      this.noticeOpenUrlBtn.style.display = this.noticeUrl ? 'inline-flex' : 'none';
    }
    this.noticeDialog.classList.add('active');
  }

  async closeNoticeDialog() {
    if (!this.noticeDialog) return;
    this.noticeDialog.classList.remove('active');
    if (!window.electronAPI) return;
    if (this.noticeDismissToday && this.noticeDismissToday.checked) {
      const settings = await window.electronAPI.getSettings();
      const result = await window.electronAPI.saveSettings({
        ...settings,
        noticeDismissDate: this.getTodayKey()
      });
      if (!result?.success) {
        this.statusText.textContent = '公告设置保存失败';
      }
    }
  }

  showUnsavedDialog(title) {
    if (!this.unsavedDialog) return Promise.resolve('cancel');
    this.unsavedDialogBody.textContent = `"${title}" 有未保存的更改`;
    this.unsavedDialog.classList.add('active');
    return new Promise(resolve => {
      this.unsavedDialogResolver = resolve;
    });
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

  async saveSpecificTab(tabId) {
    const activeId = this.tabManager.activeTabId;
    if (activeId && activeId !== tabId) {
      this.tabManager.activateTab(tabId);
    }
    await this.saveFile();
    const tab = this.tabManager.getActiveTab();
    const saved = tab && !tab.isDirty;
    if (activeId && activeId !== tabId) {
      this.tabManager.activateTab(activeId);
    }
    return saved;
  }

  initRoleManagerLogic(roleMgrDialog) {
    const roleList = document.getElementById('roleList');
    const roleIdInput = document.getElementById('roleIdInput');
    const roleNameInput = document.getElementById('roleNameInput');
    const roleTypeSelect = document.getElementById('roleTypeSelect');
    const roleVoiceSelect = document.getElementById('roleVoiceSelect');
    const roleSaveBtn = document.getElementById('roleSaveBtn');
    const roleCancelBtn = document.getElementById('roleCancelBtn');
    
    const loadRoles = () => {
      const roles = JSON.parse(localStorage.getItem('listext_roles') || '[]');
      roleList.innerHTML = roles.length > 0
        ? roles.map(r => `<div class="role-item" data-id="${r.id}" style="display:flex;align-items:center;justify-content:space-between;border:1px solid var(--md-divider);border-radius:4px;padding:8px 12px;margin-bottom:8px">
          <div><strong>${r.name}</strong> <span style="opacity:0.7">(${r.id})</span> — ${r.type === 'edge' ? 'EdgeTTS' : '系统TTS'}: ${r.voice || ''}</div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-primary btn-edit-role" data-id="${r.id}" style="padding:4px 8px">编辑</button>
            <button class="btn btn-cancel btn-delete-role" data-id="${r.id}" style="padding:4px 8px">删除</button>
          </div>
        </div>`).join('')
        : '<div style="opacity:0.7">尚未添加角色</div>';
        
      roleList.querySelectorAll('.btn-delete-role').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const roles = JSON.parse(localStorage.getItem('listext_roles') || '[]');
          const next = roles.filter(x => x.id !== id);
          localStorage.setItem('listext_roles', JSON.stringify(next));
          loadRoles();
        });
      });
      
      roleList.querySelectorAll('.btn-edit-role').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const roles = JSON.parse(localStorage.getItem('listext_roles') || '[]');
          const r = roles.find(x => x.id === id);
          if (!r) return;
          roleIdInput.value = r.id;
          roleNameInput.value = r.name || '';
          roleTypeSelect.value = r.type || 'local';
          populateRoleVoices().then(() => {
            if (roleVoiceSelect) {
              roleVoiceSelect.value = r.voice || '';
            }
          });
        });
      });
    };
    
    const populateRoleVoices = async () => {
      const type = roleTypeSelect ? roleTypeSelect.value : 'local';
      if (!roleVoiceSelect) return;
      roleVoiceSelect.innerHTML = '<option value="">加载中...</option>';
      if (type === 'edge' && window.electronAPI) {
        const res = await window.electronAPI.listEdgeVoices();
        const voices = res?.voices || [];
        roleVoiceSelect.innerHTML = voices.length
          ? voices.map(v => `<option value="${v}">${v}</option>`).join('')
          : '<option value="">未获取到 EdgeTTS 发音人</option>';
      } else {
        const voices = speechSynthesis.getVoices();
        roleVoiceSelect.innerHTML = voices.length
          ? voices.map(v => `<option value="${v.name}">${v.name} (${v.lang})</option>`).join('')
          : '<option value="">未获取到系统TTS发音人</option>';
      }
    };
    
    if (roleTypeSelect) {
      roleTypeSelect.addEventListener('change', () => populateRoleVoices());
      // 初始加载一次
      setTimeout(populateRoleVoices, 1000); 
    }
    
    if (roleMgrDialog) {
      const rClose = roleMgrDialog.querySelector('.dialog-close');
      if (rClose) rClose.addEventListener('click', () => roleMgrDialog.classList.remove('active'));
    }
    
    if (roleCancelBtn) {
      roleCancelBtn.addEventListener('click', () => {
        if (roleMgrDialog) roleMgrDialog.classList.remove('active');
      });
    }
    
    if (roleSaveBtn) roleSaveBtn.addEventListener('click', () => {
      const id = roleIdInput.value.trim();
      const name = roleNameInput.value.trim();
      const type = roleTypeSelect.value;
      const voice = roleVoiceSelect ? roleVoiceSelect.value.trim() : '';
      if (!id || !name) return;
      const roles = JSON.parse(localStorage.getItem('listext_roles') || '[]');
      const existingIndex = roles.findIndex(r => r.id === id);
      const payload = { id, name, type, voice };
      if (existingIndex >= 0) {
        roles[existingIndex] = payload;
      } else {
        roles.push(payload);
      }
      localStorage.setItem('listext_roles', JSON.stringify(roles));
      roleIdInput.value = '';
      roleNameInput.value = '';
      if (roleVoiceSelect) roleVoiceSelect.value = '';
      loadRoles();
    });
    
    this.openRoleManager = () => {
      loadRoles();
      if (roleMgrDialog) roleMgrDialog.classList.add('active');
    };
  }

  initElectronEvents() {
    if (!window.electronAPI) return;
    
    window.electronAPI.onMenuNew(() => {
      this.newFile();
    });
    
    window.electronAPI.onMenuSave(() => {
      this.saveFile();
    });
    
    window.electronAPI.onSaveAs(async (filePath) => {
      await this.saveFileAs(filePath);
    });
    
    window.electronAPI.onFileOpened((content, filePath) => {
      this.openFile(content, filePath);
    });
    
    window.electronAPI.onPreviewPlay(() => {
      this.previewPlay();
    });
    
    window.electronAPI.onStopPlay(() => {
      this.stopPlay();
    });
    
    window.electronAPI.onExportAudio((filePath) => {
      this.exportAudioTo(filePath);
    });
    
    window.electronAPI.onShowSyntaxHelp(() => {
      this.showSyntaxHelp();
    });

    window.electronAPI.onShowRoleManager(() => {
      this.openRoleManager();
    });

    window.electronAPI.onShowSettings(() => {
      this.showSettingsDialog();
    });

    window.electronAPI.onMenuEdit((action) => {
      this.handleEditAction(action);
    });
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
        this.markUnsaved();
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

  initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const isMod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (this.currentMode === 'block' && this.renderer && !this.isTextInputActive()) {
        if (isMod) {
          if (key === 'z') {
            e.preventDefault();
            if (e.shiftKey) {
              this.renderer.redo();
            } else {
              this.renderer.undo();
            }
            this.markUnsaved();
            return;
          }
          if (key === 'y') {
            e.preventDefault();
            this.renderer.redo();
            this.markUnsaved();
            return;
          }
          if (key === 'c') {
            e.preventDefault();
            this.renderer.copySelectedBlocks();
            return;
          }
          if (key === 'x') {
            e.preventDefault();
            this.renderer.cutSelectedBlocks();
            this.markUnsaved();
            return;
          }
          if (key === 'v') {
            e.preventDefault();
            this.renderer.pasteClipboard();
            this.markUnsaved();
            return;
          }
          if (key === 'a') {
            e.preventDefault();
            this.renderer.selectAllBlocks();
            return;
          }
        } else if (key === 'delete' || key === 'backspace') {
          if (this.renderer.selectedBlocks && this.renderer.selectedBlocks.size > 0) {
            e.preventDefault();
            this.renderer.deleteSelectedBlocks();
            this.markUnsaved();
            return;
          }
        }
      }
      // Ctrl+S 保存
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        this.saveFile();
      }
      
      // Escape 停止播放
      if (e.key === 'Escape') {
        this.stopPlay();
        document.querySelectorAll('.dialog.active').forEach(d => d.classList.remove('active'));
      }
      
      // F5 预览
      if (e.key === 'F5') {
        e.preventDefault();
        this.previewPlay();
      }
    });
  }

  syncBlocksToCode() {
    const ast = this.renderer.collectAST();
    const code = this.buildCodeWithComments(ast);
    this.codeEditor.value = code.trim();
    this.updateLineNumbers();
    this.updateCodeHighlight();
  }

  syncCodeToBlocks() {
    const code = this.codeEditor.value;
    this.lastCommentTokens = this.extractComments(code);
    const ast = this.parser.parse(code);
    this.renderer.render(ast);
  }

  extractComments(text) {
    const comments = [];
    const tokenRegex = /<!--[\s\S]*?-->|<\s*\/?[a-zA-Z]+[^>]*>/g;
    let elementIndex = 0;
    let match;
    let lastEnd = 0;
    while ((match = tokenRegex.exec(text)) !== null) {
      const token = match[0];
      if (token.startsWith('<!--')) {
        const between = text.slice(lastEnd, match.index);
        const inline = !between.includes('\n');
        comments.push({
          anchorIndex: elementIndex,
          inline,
          text: token
        });
      } else if (!token.startsWith('</')) {
        elementIndex += 1;
      }
      lastEnd = tokenRegex.lastIndex;
    }
    return comments;
  }

  buildCodeWithComments(ast) {
    const { lines, elementLines } = this.serializeAstLines(ast);
    const comments = Array.isArray(this.lastCommentTokens) ? this.lastCommentTokens : [];
    const insertBefore = new Map();
    const appendTo = new Map();
    comments.forEach((c) => {
      if (c.inline && c.anchorIndex > 0) {
        const lineIndex = elementLines[c.anchorIndex - 1];
        if (lineIndex !== undefined) {
          if (!appendTo.has(lineIndex)) appendTo.set(lineIndex, []);
          appendTo.get(lineIndex).push(c.text);
          return;
        }
      }
      const targetIndex = elementLines[c.anchorIndex] ?? lines.length;
      if (!insertBefore.has(targetIndex)) insertBefore.set(targetIndex, []);
      insertBefore.get(targetIndex).push(c.text);
    });
    const output = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (insertBefore.has(i)) {
        const indent = (lines[i].match(/^\s*/) || [''])[0];
        insertBefore.get(i).forEach((text) => {
          output.push(`${indent}${text}`);
        });
      }
      let line = lines[i];
      if (appendTo.has(i)) {
        appendTo.get(i).forEach((text) => {
          line = `${line} ${text}`;
        });
      }
      output.push(line);
    }
    if (insertBefore.has(lines.length)) {
      insertBefore.get(lines.length).forEach((text) => {
        output.push(text);
      });
    }
    return output.join('\n');
  }

  serializeAstLines(ast, indent = 0, lines = [], elementLines = []) {
    const indentStr = '  '.repeat(indent);
    for (const node of ast) {
      if (!node || node.type !== 'element') continue;
      const attrs = this.parser.stringifyAttrs(node.attrs || {});
      const attrStr = attrs ? ` ${attrs}` : '';
      if (this.parser.isSelfClosing(node.tagName)) {
        lines.push(`${indentStr}<${node.tagName}${attrStr}>`);
        elementLines.push(lines.length - 1);
        continue;
      }
      if (node.children && node.children.length > 0) {
        lines.push(`${indentStr}<${node.tagName}${attrStr}>`);
        elementLines.push(lines.length - 1);
        this.serializeAstLines(node.children, indent + 1, lines, elementLines);
        lines.push(`${indentStr}</${node.tagName}>`);
      } else {
        lines.push(`${indentStr}<${node.tagName}${attrStr}>${node.content || ''}</${node.tagName}>`);
        elementLines.push(lines.length - 1);
      }
    }
    return { lines, elementLines };
  }
  
  /**
   * 获取当前编辑器内容
   */
  getContent() {
    if (this.currentMode === 'block') {
      return this.parser.stringify(this.renderer.collectAST()).trim();
    } else {
      return this.codeEditor.value;
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
    
    this.codeEditor.value = content;
    this.updateLineNumbers();
    this.updateCodeHighlight();
    
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
  
  /**
   * 更新当前标签页状态的 UI 显示
   */
  updateStatusForTab(tab) {
    if (!tab) return;
    
    const name = tab.filePath || '未保存';
    const dirty = tab.isDirty ? ' *' : '';
    if (this.currentFileEl) {
      this.currentFileEl.textContent = `${name}${dirty}`;
    }
    this.statusText.textContent = tab.isDirty ? '有未保存更改' : '就绪';
  }

  newFile() {
    this.tabManager.createNewTab('未命名', '', null, true);
  }

  openFile(content, filePath) {
    // 提取文件名作为标题
    const fileName = filePath.split(/[/\\]/).pop();
    this.tabManager.createNewTab(fileName, content, filePath);
  }

  async saveFile() {
    const tab = this.tabManager.getActiveTab();
    if (!tab) return;
    
    if (tab.filePath) {
      await this.saveFileAs(tab.filePath);
    } else {
      const filePath = await window.electronAPI?.selectListextPath();
      if (filePath) {
        await this.saveFileAs(filePath);
      }
    }
  }

  async saveFileAs(filePath) {
    const tab = this.tabManager.getActiveTab();
    if (!tab) return;
    
    // 获取当前最新内容
    const content = this.getContent();
    
    const result = await window.electronAPI?.saveFile(filePath, content);
    
    if (result?.success) {
      // 更新标签页状态
      const fileName = filePath.split(/[/\\]/).pop();
      this.tabManager.updateTab(tab.id, {
        filePath: filePath,
        title: fileName,
        content: content,
        isDirty: false
      });
      
      this.updateStatusForTab(this.tabManager.getActiveTab());
      this.statusText.textContent = '已保存';
    } else {
      this.statusText.textContent = '保存失败: ' + (result?.error || '未知错误');
    }
  }

  markUnsaved() {
    if (this.tabManager) {
      this.tabManager.markActiveTabDirty(true);
      this.updateStatusForTab(this.tabManager.getActiveTab());
    }
  }

  async exportAudioTo(filePath) {
    if (!window.electronAPI) {
      this.statusText.textContent = '导出失败: 当前环境不支持';
      return;
    }
    this.statusText.textContent = '正在导出...';
    let targetPath = filePath;
    if (!targetPath) {
      targetPath = await window.electronAPI.selectExportPath();
    }
    if (!targetPath) {
      this.statusText.textContent = '已取消导出';
      return;
    }
    const content = this.getContent();
    const ast = this.parser.parse(content);
    if (!ast.length) {
      this.statusText.textContent = '没有可导出的内容';
      return;
    }
    const queue = this.playQueue.buildQueue(ast);
    const effects = await window.electronAPI.loadEffects();
    const sampleRate = 44100;
    const channels = 2;
    const buffers = [];
    for (const task of queue) {
      if (task.type === 'tts') {
        const voice = this.playQueue.resolveVoice(task);
        const rate = this.playQueue.convertRateToEdge(task.rate || 1.0);
        const res = await window.electronAPI.synthesizeTTS(task.text || '', voice, rate);
        if (!res?.success || !res.path) {
          this.statusText.textContent = '导出失败: EdgeTTS 不可用';
          return;
        }
        const fileRes = await window.electronAPI.getAudioFile(res.path);
        if (!fileRes?.success || !fileRes.data) {
          this.statusText.textContent = '导出失败: 音频文件读取失败';
          return;
        }
        const decoded = await this.decodeAudioBase64(fileRes.data);
        const normalized = await this.normalizeAudioBuffer(decoded, sampleRate, channels);
        buffers.push(normalized);
      } else if (task.type === 'effect') {
        const effectPath = effects?.[task.effectId];
        if (!effectPath) {
          this.statusText.textContent = `导出失败: 音效未找到 ${task.effectId}`;
          return;
        }
        const fileRes = await window.electronAPI.getAudioFile(effectPath);
        if (!fileRes?.success || !fileRes.data) {
          this.statusText.textContent = '导出失败: 音效读取失败';
          return;
        }
        const decoded = await this.decodeAudioBase64(fileRes.data);
        const normalized = await this.normalizeAudioBuffer(decoded, sampleRate, channels);
        const trimmed = this.applyTrimAndFade(normalized, task.maxDuration, task.fadeDuration, sampleRate, channels);
        buffers.push(trimmed);
      } else if (task.type === 'silence') {
        const silence = this.createSilenceBuffer(task.duration || 0, sampleRate, channels);
        if (silence) buffers.push(silence);
      }
    }
    if (!buffers.length) {
      this.statusText.textContent = '没有可导出的内容';
      return;
    }
    const merged = this.concatAudioBuffers(buffers, sampleRate, channels);
    const wavData = this.encodeWav(merged);
    const base64 = this.arrayBufferToBase64(wavData);
    const result = await window.electronAPI.saveBinary(targetPath, base64);
    await window.electronAPI.cleanupTemp();
    if (result?.success) {
      this.statusText.textContent = '导出完成';
    } else {
      this.statusText.textContent = '导出失败: ' + (result?.error || '未知错误');
    }
  }

  ensureAudioContext() {
    if (!this.audioContext) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new Ctx();
    }
    return this.audioContext;
  }

  base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  async decodeAudioBase64(base64) {
    const arrayBuffer = this.base64ToArrayBuffer(base64);
    const ctx = this.ensureAudioContext();
    return await ctx.decodeAudioData(arrayBuffer);
  }

  async normalizeAudioBuffer(buffer, sampleRate, channels) {
    if (buffer.sampleRate === sampleRate && buffer.numberOfChannels === channels) {
      return buffer;
    }
    const length = Math.max(1, Math.ceil(buffer.duration * sampleRate));
    const offline = new OfflineAudioContext(channels, length, sampleRate);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start(0);
    return await offline.startRendering();
  }

  createSilenceBuffer(duration, sampleRate, channels) {
    const length = Math.floor(Math.max(0, duration) * sampleRate);
    if (length <= 0) return null;
    const ctx = this.ensureAudioContext();
    return ctx.createBuffer(channels, length, sampleRate);
  }

  applyTrimAndFade(buffer, maxDuration, fadeDuration, sampleRate, channels) {
    const maxSamples = maxDuration ? Math.floor(maxDuration * sampleRate) : buffer.length;
    const newLength = Math.max(1, Math.min(buffer.length, maxSamples));
    const ctx = this.ensureAudioContext();
    const out = ctx.createBuffer(channels, newLength, sampleRate);
    for (let ch = 0; ch < channels; ch++) {
      const src = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
      const dst = out.getChannelData(ch);
      dst.set(src.subarray(0, newLength));
    }
    if (fadeDuration && fadeDuration > 0) {
      const fadeSamples = Math.min(newLength, Math.floor(fadeDuration * sampleRate));
      if (fadeSamples > 0) {
        for (let ch = 0; ch < channels; ch++) {
          const dst = out.getChannelData(ch);
          for (let i = 0; i < fadeSamples; i++) {
            const idx = newLength - fadeSamples + i;
            const gain = 1 - i / fadeSamples;
            dst[idx] *= gain;
          }
        }
      }
    }
    return out;
  }

  concatAudioBuffers(buffers, sampleRate, channels) {
    const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);
    const ctx = this.ensureAudioContext();
    const out = ctx.createBuffer(channels, totalLength, sampleRate);
    let offset = 0;
    for (const buffer of buffers) {
      for (let ch = 0; ch < channels; ch++) {
        const dst = out.getChannelData(ch);
        const src = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
        dst.set(src, offset);
      }
      offset += buffer.length;
    }
    return out;
  }

  encodeWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const samples = buffer.length;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples * blockAlign;
    const bufferSize = 44 + dataSize;
    const arrayBuffer = new ArrayBuffer(bufferSize);
    const view = new DataView(arrayBuffer);
    let offset = 0;
    const writeString = (str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
      offset += str.length;
    };
    writeString('RIFF');
    view.setUint32(offset, 36 + dataSize, true);
    offset += 4;
    writeString('WAVE');
    writeString('fmt ');
    view.setUint32(offset, 16, true);
    offset += 4;
    view.setUint16(offset, 1, true);
    offset += 2;
    view.setUint16(offset, numChannels, true);
    offset += 2;
    view.setUint32(offset, sampleRate, true);
    offset += 4;
    view.setUint32(offset, byteRate, true);
    offset += 4;
    view.setUint16(offset, blockAlign, true);
    offset += 2;
    view.setUint16(offset, bytesPerSample * 8, true);
    offset += 2;
    writeString('data');
    view.setUint32(offset, dataSize, true);
    offset += 4;
    const channelData = [];
    for (let ch = 0; ch < numChannels; ch++) {
      channelData.push(buffer.getChannelData(ch));
    }
    for (let i = 0; i < samples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        let sample = channelData[ch][i] || 0;
        sample = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
    return arrayBuffer;
  }

  loadDefaultContent() {
    // 启动时创建一个空标签页
    this.tabManager.createNewTab('未命名');
  }
  
  // 清空编辑器（用于关闭所有标签页时）
  clearEditor() {
    this.codeEditor.value = '';
    this.updateLineNumbers();
    this.renderer.clear(); // 需要在 BlockRenderer 中实现 clear
    if (this.currentFileEl) this.currentFileEl.textContent = '';
  }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
  window.app = new ListextEditor();
});
