class CodeEditor {
  constructor(elements, parser, callbacks) {
    this.editor = elements.codeEditor;
    this.lineNumbers = elements.lineNumbers;
    this.highlight = elements.codeHighlight;
    this.suggestions = elements.codeSuggestions;
    this.errorContainer = elements.errorContainer;
    this.parser = parser;
    this.callbacks = callbacks || {};

    this.init();
  }

  init() {
    // 行号更新
    this.updateLineNumbers();
    this.updateCodeHighlight();
    
    this.editor.addEventListener('input', () => {
      this.updateLineNumbers();
      if (this.callbacks.onInput) this.callbacks.onInput();
      this.validateCode();
      this.updateCodeHighlight();
      this.updateSuggestions();
    });

    this.editor.addEventListener('click', () => {
      this.updateSuggestions();
    });

    this.editor.addEventListener('keyup', () => {
      this.updateSuggestions();
    });

    this.editor.addEventListener('blur', () => {
      // 延迟隐藏，以便点击建议项时能触发事件
      setTimeout(() => this.hideSuggestions(), 200);
    });
    
    this.editor.addEventListener('scroll', () => {
      this.lineNumbers.scrollTop = this.editor.scrollTop;
      if (this.highlight) {
        this.highlight.scrollTop = this.editor.scrollTop;
      }
    });
    
    // Tab 键支持
    this.editor.addEventListener('keydown', (e) => {
      if (this.handleKeydown(e)) return;
    });
  }

  getValue() {
    return this.editor.value;
  }

  setValue(value) {
    this.editor.value = value;
    this.updateLineNumbers();
    this.updateCodeHighlight();
    this.validateCode();
  }

  focus() {
    this.editor.focus();
  }

  updateLineNumbers() {
    const lines = this.editor.value.split('\n');
    this.lineNumbers.innerHTML = lines.map((_, i) => 
      `<div class="line-number">${i + 1}</div>`
    ).join('');
  }

  updateCodeHighlight() {
    if (!this.highlight) return;
    const source = this.editor.value;
    this.highlight.innerHTML = this.highlightListext(source);
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

  handleKeydown(e) {
    if (this.suggestions && this.suggestions.style.display !== 'none') {
      const items = Array.from(this.suggestions.querySelectorAll('.code-suggestion-item'));
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
    if (!this.suggestions || !this.editor) return;
    // 如果没有焦点，不显示建议
    if (document.activeElement !== this.editor) return;

    const caret = this.editor.selectionStart;
    const before = this.editor.value.slice(0, caret);
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
      this.suggestions.dataset.mode = 'tag';
      this.showSuggestionsAtCursor(items, prefix, caret - prefix.length, '标签');
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
      this.suggestions.dataset.mode = 'attribute';
      this.showSuggestionsAtCursor(items, prefix, caret - prefix.length, '属性');
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
    this.suggestions.dataset.mode = 'tag';
    this.showSuggestionsAtCursor(items, prefix, caret - prefix.length, '标签');
  }

  showSuggestionsAtCursor(items, prefix, replaceStart, hint) {
    const caret = this.editor.selectionStart;
    const before = this.editor.value.slice(0, caret);
    const lineHeight = 22.4; // 假设行高
    const lastNewline = before.lastIndexOf('\n');
    const line = before.slice(0, caret).split('\n').length - 1;
    const col = lastNewline === -1 ? before.length : before.length - lastNewline - 1;
    const left = 50 + 16 + col * 8; // 50(行号) + 16(padding) + col * charWidth
    const top = 16 + line * lineHeight - this.editor.scrollTop + lineHeight;
    
    this.renderSuggestions(items, { left, top }, prefix, replaceStart, hint);
  }

  renderSuggestions(items, position, prefix, replaceStart, hint) {
    this.suggestions.innerHTML = items.map((tag, idx) => `
      <div class="code-suggestion-item ${idx === 0 ? 'active' : ''}" data-value="${tag}">
        <span>${tag}</span>
        <span class="hint">${hint}</span>
      </div>
    `).join('');
    this.suggestions.style.display = 'block';
    this.suggestions.style.left = `${position.left}px`;
    this.suggestions.style.top = `${Math.max(0, position.top)}px`;
    this.suggestions.dataset.replaceStart = replaceStart;
    this.suggestions.dataset.prefix = prefix;
    this.suggestions.querySelectorAll('.code-suggestion-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.applySuggestion(item.dataset.value);
      });
    });
  }

  applySuggestion(value) {
    if (this.suggestions.dataset.mode === 'attribute') {
      this.applyAttributeSuggestion(value);
      return;
    }
    const start = parseInt(this.suggestions.dataset.replaceStart || '0', 10);
    const end = this.editor.selectionStart;
    const before = this.editor.value.substring(0, start);
    const after = this.editor.value.substring(end);
    let insertText = value;
    let cursorOffset = value.length;
    if (this.suggestions.dataset.mode === 'tag' && before.endsWith('<')) {
      insertText = `${value}></${value}>`;
      cursorOffset = value.length + 1;
    }
    this.editor.value = `${before}${insertText}${after}`;
    const nextPos = before.length + cursorOffset;
    this.editor.selectionStart = this.editor.selectionEnd = nextPos;
    this.hideSuggestions();
    this.updateLineNumbers();
    this.updateCodeHighlight();
    if (this.callbacks.onInput) this.callbacks.onInput();
  }

  applyAttributeSuggestion(value) {
    const start = parseInt(this.suggestions.dataset.replaceStart || '0', 10);
    const end = this.editor.selectionStart;
    const before = this.editor.value.substring(0, start);
    const after = this.editor.value.substring(end);
    const insertText = `${value}=""`;
    this.editor.value = `${before}${insertText}${after}`;
    const nextPos = before.length + value.length + 2;
    this.editor.selectionStart = this.editor.selectionEnd = nextPos;
    this.hideSuggestions();
    this.updateLineNumbers();
    this.updateCodeHighlight();
    if (this.callbacks.onInput) this.callbacks.onInput();
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
    const value = this.editor.value;
    const start = this.editor.selectionStart;
    const end = this.editor.selectionEnd;
    if (start === end) {
      this.editor.value = value.substring(0, start) + '  ' + value.substring(end);
      this.editor.selectionStart = this.editor.selectionEnd = start + 2;
      this.updateLineNumbers();
      this.updateCodeHighlight();
      if (this.callbacks.onInput) this.callbacks.onInput();
      return;
    }
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = value.indexOf('\n', end);
    const endPos = lineEnd === -1 ? value.length : lineEnd;
    const selected = value.slice(lineStart, endPos);
    const lines = selected.split('\n');
    const indented = lines.map(line => `  ${line}`).join('\n');
    this.editor.value = value.slice(0, lineStart) + indented + value.slice(endPos);
    const newStart = start + 2;
    const newEnd = end + lines.length * 2;
    this.editor.selectionStart = newStart;
    this.editor.selectionEnd = newEnd;
    this.updateLineNumbers();
    this.updateCodeHighlight();
    if (this.callbacks.onInput) this.callbacks.onInput();
  }

  outdentSelection() {
    const value = this.editor.value;
    const start = this.editor.selectionStart;
    const end = this.editor.selectionEnd;
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
    this.editor.value = value.slice(0, lineStart) + outdented + value.slice(endPos);
    const newStart = Math.max(lineStart, start - 2);
    const newEnd = Math.max(lineStart, end - removedTotal);
    this.editor.selectionStart = newStart;
    this.editor.selectionEnd = newEnd;
    this.updateLineNumbers();
    this.updateCodeHighlight();
    if (this.callbacks.onInput) this.callbacks.onInput();
  }

  hideSuggestions() {
    if (!this.suggestions) return;
    this.suggestions.style.display = 'none';
    this.suggestions.innerHTML = '';
  }

  validateCode() {
    if (!this.errorContainer) return;
    
    const code = this.editor.value;
    let errors = [];
    try {
      errors = this.parser.validate(code);
      if (this.callbacks.validateExtra) {
        const extra = this.callbacks.validateExtra(code);
        if (extra && extra.length) {
          errors = errors.concat(extra);
        }
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
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CodeEditor;
}
