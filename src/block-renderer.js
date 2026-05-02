class BlockRenderer {
  constructor(container, parser) {
    this.container = container;
    this.parser = parser;
    this.blocks = [];
    this.effectLibrary = {};
    this.selectedBlocks = new Set();
    this.clipboard = null;
    this.history = [];
    this.historyIndex = -1;
    this.isRestoring = false;
    this.lastSnapshot = '';
    this.draggingBlock = null;
    this.placeholderEl = null;

    this.init();
  }

  init() {
    this.loadEffectLibrary();
    this.createEditDialog();

    if (this.container) {
      this.container.addEventListener('click', (e) => {
        if (e.target === this.container || e.target.closest('.empty-state')) {
          this.clearSelection();
        }
      });
      this.enableDropZone(this.container);
    }
  }

  async loadEffectLibrary() {
    if (window.electronAPI) {
      this.effectLibrary = await window.electronAPI.loadEffects();
    }
  }

  createEditDialog() {
    const dialog = document.createElement('div');
    dialog.id = 'blockEditDialog';
    dialog.className = 'dialog';
    dialog.innerHTML = `
      <div class="dialog-content dialog-small">
        <div class="dialog-header">
          <h2 id="editDialogTitle">编辑属性</h2>
          <button class="dialog-close">&times;</button>
        </div>
        <div class="dialog-body" id="editDialogBody"></div>
        <div class="dialog-footer">
          <button class="btn btn-cancel">取消</button>
          <button class="btn btn-primary" id="editDialogConfirm">确定</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    this.editDialog = dialog;

    dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.classList.remove('active'));
    dialog.querySelector('.btn-cancel').addEventListener('click', () => dialog.classList.remove('active'));
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.classList.remove('active'); });
  }

  render(ast) {
    this.container.innerHTML = '';
    this.blocks = [];
    this.clearSelection();

    if (!ast || ast.length === 0) {
      this.showEmptyState();
      this.recordHistory();
      return;
    }

    for (const node of ast) {
      const block = this.renderNode(node);
      if (block) {
        this.container.appendChild(block);
        this.blocks.push(block);
      }
    }

    this.recordHistory();
  }

  clear() {
    this.container.innerHTML = '';
    this.blocks = [];
    this.showEmptyState();
  }

  showEmptyState() {
    this.container.innerHTML = `
      <div class="empty-state">
        <span class="material-icons">add_circle_outline</span>
        <p>点击上方按钮添加积木块，或切换到代码模式输入 Listext 语法</p>
      </div>
    `;
  }

  renderNode(node) {
    if (node.type === 'comment') {
      const block = document.createElement('div');
      block.className = 'block block-comment';
      block.dataset.type = 'comment';
      block.style.display = 'none';
      block._nodeData = node;
      return block;
    }

    if (node.type === 'text') {
      if (!node.content || !node.content.trim()) return null;
      const block = document.createElement('div');
      block.className = 'block block-text';
      block.dataset.type = 'text';
      block.dataset.id = this.generateId();
      block.setAttribute('draggable', 'true');
      block.innerHTML = `
        <div class="block-content">
          <span class="text-content" style="font-style:italic;color:#666;">${this.escapeHtml(node.content)}</span>
        </div>
        <button class="block-action-btn btn-delete" title="删除"><span class="material-icons">delete</span></button>
      `;
      this.attachBlockEvents(block);
      return block;
    }

    switch ((node.tagName || '').toLowerCase()) {
      case 'say': return this.renderSayBlock(node);
      case 'pause': return this.renderPauseBlock(node);
      case 'repeat': return this.renderRepeatBlock(node);
      case 'fx': return this.renderFxBlock(node);
      case 'divider': return this.renderDividerBlock(node);
      case 'section': return this.renderSectionBlock(node);
      default: return null;
    }
  }

  createBaseBlock(tagName, node) {
    const block = document.createElement('div');
    block.className = `block block-${tagName}`;
    block.dataset.tagName = tagName;
    block.dataset.id = this.generateId();
    block.setAttribute('draggable', 'true');
    block._nodeData = node;
    return block;
  }

  createBlockHeader(tagName, title, icon, hasEdit = true) {
    const header = document.createElement('div');
    header.className = 'block-header';
    header.innerHTML = `
      <div class="block-icon"><span class="material-icons">${icon}</span></div>
      <span class="block-title">${title}</span>
      <div class="block-actions">
        ${hasEdit ? `<button class="block-action-btn btn-edit" title="编辑属性"><span class="material-icons">edit</span></button>` : ''}
        <button class="block-action-btn btn-delete" title="删除"><span class="material-icons">delete</span></button>
      </div>
    `;
    return header;
  }

  renderSayBlock(node) {
    const block = this.createBaseBlock('say', node);
    const header = this.createBlockHeader('say', '朗读', 'record_voice_over', true);
    const content = document.createElement('div');
    content.className = 'block-content repeat-drop-zone';
    const textarea = document.createElement('textarea');
    textarea.className = 'block-textarea';
    textarea.placeholder = '输入朗读内容...';
    textarea.rows = 2;
    textarea.value = node.content || '';
    content.appendChild(textarea);

    block._roleId = node.attrs?.role || '';
    block._rate = node.attrs?.rate ? parseFloat(node.attrs.rate) : 1.0;

    block.appendChild(header);
    block.appendChild(content);
    this.attachBlockEvents(block, textarea, 'say');
    return block;
  }

  renderPauseBlock(node) {
    const block = this.createBaseBlock('pause', node);
    const header = this.createBlockHeader('pause', '停顿', 'timer', true);
    const duration = parseInt(node.attrs?.dur || '10', 10) || 10;
    block._duration = duration;

    const content = document.createElement('div');
    content.className = 'block-content';
    content.innerHTML = `<div class="silence-display" style="padding:12px;cursor:pointer;">停顿 ${duration} 秒</div>`;

    block.appendChild(header);
    block.appendChild(content);
    this.attachBlockEvents(block, null, 'pause');
    content.querySelector('.silence-display').addEventListener('dblclick', () => this.showPauseEditor(block));
    return block;
  }

  renderFxBlock(node) {
    const block = this.createBaseBlock('fx', node);
    const header = this.createBlockHeader('fx', '音效', 'music_note', true);

    block._effectId = node.attrs?.id || '';
    block._effectDuration = node.attrs?.dur ? parseInt(node.attrs.dur, 10) : null;
    block._effectFade = node.attrs?.fade ? parseInt(node.attrs.fade, 10) : null;

    const content = document.createElement('div');
    content.className = 'block-content';
    content.innerHTML = `<div class="effect-display" style="padding:12px;cursor:pointer;"><span class="effect-text">${this.describeFx(block)}</span></div>`;

    block.appendChild(header);
    block.appendChild(content);
    this.attachBlockEvents(block, null, 'fx');
    content.querySelector('.effect-display').addEventListener('dblclick', () => this.showFxEditor(block));
    return block;
  }

  renderDividerBlock(node) {
    const block = this.createBaseBlock('divider', node);
    const content = document.createElement('div');
    content.className = 'block-content';
    content.innerHTML = `<div class="divider-visual" style="height:2px;background:#e0e0e0;margin:10px 0;position:relative;"><span style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:#fff;padding:0 8px;color:#999;font-size:12px;">分割线</span></div>`;
    const del = document.createElement('button');
    del.className = 'block-action-btn btn-delete';
    del.innerHTML = '<span class="material-icons">delete</span>';
    del.style.position = 'absolute'; del.style.right = '0'; del.style.top = '-8px';

    block.style.position = 'relative';
    block.appendChild(content);
    block.appendChild(del);
    this.attachBlockEvents(block);
    return block;
  }

  renderSectionBlock(node) {
    const block = this.createBaseBlock('section', node);
    const header = this.createBlockHeader('section', '分节', 'bookmark', true);
    const title = node.attrs?.title || '未命名分节';
    block._sectionTitle = title;
    const content = document.createElement('div');
    content.className = 'block-content';
    content.innerHTML = `<div class="section-display" style="padding:10px 12px;background:#FFF8E1;border:1px solid #FFE082;border-radius:6px;cursor:pointer;">📌 ${this.escapeHtml(title)}</div>`;

    block.appendChild(header);
    block.appendChild(content);
    this.attachBlockEvents(block, null, 'section');
    content.querySelector('.section-display').addEventListener('dblclick', () => this.showSectionEditor(block));
    return block;
  }

  renderRepeatBlock(node) {
    const block = this.createBaseBlock('repeat', node);
    const count = parseInt(node.attrs?.count || '2', 10) || 2;
    block._repeatCount = count;
    const header = this.createBlockHeader('repeat', `重复（${count} 次）`, 'repeat', true);
    const content = document.createElement('div');
    content.className = 'block-content';

    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        const childBlock = this.renderNode(child);
        if (childBlock) content.appendChild(childBlock);
      }
    } else {
      content.innerHTML = `<div class="empty-state" style="padding:16px;"><p>拖入积木到重复体内</p></div>`;
    }

    block.appendChild(header);
    block.appendChild(content);

    this.attachBlockEvents(block, null, 'repeat');
    this.enableDropZone(content);
    return block;
  }

  attachBlockEvents(block, textarea = null, editType = null) {
    const deleteBtn = block.querySelector('.btn-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        block.remove();
        this.onBlockChange();
      });
    }

    const editBtn = block.querySelector('.btn-edit');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (editType === 'pause') this.showPauseEditor(block);
        else if (editType === 'fx') this.showFxEditor(block);
        else if (editType === 'repeat') this.showRepeatEditor(block);
        else if (editType === 'say') this.showSayEditor(block);
        else if (editType === 'section') this.showSectionEditor(block);
      });
    }

    if (textarea) {
      textarea.addEventListener('input', () => this.onBlockChange());
      textarea.addEventListener('dragstart', (e) => e.stopPropagation());
      const disableDrag = () => block.setAttribute('draggable', 'false');
      const enableDrag = () => block.setAttribute('draggable', 'true');
      textarea.addEventListener('pointerdown', disableDrag);
      textarea.addEventListener('pointerup', enableDrag);
      textarea.addEventListener('blur', enableDrag);
    }

    block.addEventListener('click', (e) => {
      if (e.target.closest('textarea, input, select')) return;
      if (e.ctrlKey || e.metaKey) this.toggleBlockSelection(block);
      else this.selectSingleBlock(block);
    });

    block.addEventListener('dragstart', (e) => {
      if (e.target.closest('textarea')) {
        e.preventDefault();
        return;
      }
      this.draggingBlock = block;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', block.dataset.id);
      block.classList.add('dragging');
      if (!this.placeholderEl) this.placeholderEl = this.createPlaceholder();
    });

    block.addEventListener('dragend', () => {
      block.classList.remove('dragging');
      this.clearPlaceholder();
      this.draggingBlock = null;
    });
  }

  showPauseEditor(block) {
    const dialog = this.editDialog;
    dialog.querySelector('#editDialogTitle').textContent = '设置停顿时长';
    dialog.querySelector('#editDialogBody').innerHTML = `
      <div class="form-group"><label>秒数</label><input id="editPauseDuration" type="number" min="1" max="300" value="${block._duration || 10}" /></div>
    `;

    const confirmBtn = dialog.querySelector('#editDialogConfirm');
    const handler = () => {
      block._duration = parseInt(document.getElementById('editPauseDuration').value, 10) || 10;
      block.querySelector('.silence-display').textContent = `停顿 ${block._duration} 秒`;
      dialog.classList.remove('active');
      confirmBtn.removeEventListener('click', handler);
      this.onBlockChange();
    };
    confirmBtn.addEventListener('click', handler);
    dialog.classList.add('active');
  }

  async showFxEditor(block) {
    await this.loadEffectLibrary();
    const ids = Object.keys(this.effectLibrary);

    const dialog = this.editDialog;
    dialog.querySelector('#editDialogTitle').textContent = '设置音效';
    dialog.querySelector('#editDialogBody').innerHTML = `
      <div class="form-group"><label>音效ID</label><select id="editFxId">${ids.length ? ids.map(id => `<option value="${id}" ${id === block._effectId ? 'selected' : ''}>${id}</option>`).join('') : '<option value="">（暂无音效，请先导入）</option>'}</select></div>
      <div class="form-group"><label>持续秒数（可选）</label><input id="editFxDur" type="number" min="1" max="300" value="${block._effectDuration || ''}" /></div>
      <div class="form-group"><label>淡出秒数（可选）</label><input id="editFxFade" type="number" min="1" max="60" value="${block._effectFade || ''}" /></div>
    `;

    const confirmBtn = dialog.querySelector('#editDialogConfirm');
    const handler = () => {
      block._effectId = document.getElementById('editFxId').value || '';
      if (!block._effectId) {
        window.app?.updateStatus?.('请先选择音效');
      }
      block._effectDuration = parseInt(document.getElementById('editFxDur').value, 10) || null;
      block._effectFade = parseInt(document.getElementById('editFxFade').value, 10) || null;
      block.querySelector('.effect-text').textContent = this.describeFx(block);
      dialog.classList.remove('active');
      confirmBtn.removeEventListener('click', handler);
      this.onBlockChange();
    };
    confirmBtn.addEventListener('click', handler);
    dialog.classList.add('active');
  }

  showRepeatEditor(block) {
    const dialog = this.editDialog;
    dialog.querySelector('#editDialogTitle').textContent = '设置重复次数';
    dialog.querySelector('#editDialogBody').innerHTML = `
      <div class="form-group"><label>次数</label><input id="editRepeatCount" type="number" min="1" max="20" value="${block._repeatCount || 2}" /></div>
    `;

    const confirmBtn = dialog.querySelector('#editDialogConfirm');
    const handler = () => {
      block._repeatCount = parseInt(document.getElementById('editRepeatCount').value, 10) || 2;
      block.querySelector('.block-title').textContent = `重复（${block._repeatCount} 次）`;
      dialog.classList.remove('active');
      confirmBtn.removeEventListener('click', handler);
      this.onBlockChange();
    };
    confirmBtn.addEventListener('click', handler);
    dialog.classList.add('active');
  }

  showSectionEditor(block) {
    const dialog = this.editDialog;
    dialog.querySelector('#editDialogTitle').textContent = '设置分节标题';
    dialog.querySelector('#editDialogBody').innerHTML = `
      <div class="form-group"><label>标题</label><input id="editSectionTitle" type="text" value="${this.escapeHtml(block._sectionTitle || '未命名分节')}" /></div>
    `;

    const confirmBtn = dialog.querySelector('#editDialogConfirm');
    const handler = () => {
      block._sectionTitle = document.getElementById('editSectionTitle').value.trim() || '未命名分节';
      block.querySelector('.section-display').textContent = `📌 ${block._sectionTitle}`;
      dialog.classList.remove('active');
      confirmBtn.removeEventListener('click', handler);
      this.onBlockChange();
      window.app?.uiManager?.refreshSectionJump?.();
    };
    confirmBtn.addEventListener('click', handler);
    dialog.classList.add('active');
  }

  showSayEditor(block) {
    const roles = this.getRoles();
    const dialog = this.editDialog;
    dialog.querySelector('#editDialogTitle').textContent = '设置朗读属性';
    dialog.querySelector('#editDialogBody').innerHTML = `
      <div class="form-group"><label>角色ID（可选）</label><select id="editSayRole"><option value="">不使用角色</option>${roles.map(r => `<option value="${r.id}" ${r.id === (block._roleId || '') ? 'selected' : ''}>${r.name} (${r.id})</option>`).join('')}</select></div>
      <div class="form-group"><label>语速（0.5 - 2.0）</label><input id="editSayRate" type="number" min="0.5" max="2" step="0.1" value="${block._rate || 1.0}" /></div>
    `;

    const confirmBtn = dialog.querySelector('#editDialogConfirm');
    const handler = () => {
      block._roleId = document.getElementById('editSayRole').value || '';
      block._rate = parseFloat(document.getElementById('editSayRate').value) || 1.0;
      dialog.classList.remove('active');
      confirmBtn.removeEventListener('click', handler);
      this.onBlockChange();
    };
    confirmBtn.addEventListener('click', handler);
    dialog.classList.add('active');
  }

  describeFx(block) {
    let text = block._effectId || '（未选择音效）';
    if (block._effectDuration) text += ` (${block._effectDuration}秒)`;
    if (block._effectFade) text += ` 淡出${block._effectFade}秒`;
    return text;
  }

  onBlockChange() {
    this.recordHistory();
    if (this.onChangeCallback) this.onChangeCallback();
  }

  recordHistory() {
    if (this.isRestoring) return;
    const snapshot = this.parser.stringify(this.collectAST()).trim();
    if (snapshot === this.lastSnapshot) return;
    this.lastSnapshot = snapshot;
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }
    this.history.push(snapshot);
    this.historyIndex = this.history.length - 1;
  }

  undo() {
    if (this.historyIndex <= 0) return;
    this.historyIndex -= 1;
    this.restoreFromHistory();
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex += 1;
    this.restoreFromHistory();
  }

  restoreFromHistory() {
    const snapshot = this.history[this.historyIndex] || '';
    this.isRestoring = true;
    const ast = snapshot ? this.parser.parse(snapshot) : [];
    this.render(ast);
    this.isRestoring = false;
  }

  selectSingleBlock(block) {
    this.clearSelection();
    if (block) {
      block.classList.add('selected');
      this.selectedBlocks.add(block);
    }
  }

  toggleBlockSelection(block) {
    if (!block) return;
    if (this.selectedBlocks.has(block)) {
      block.classList.remove('selected');
      this.selectedBlocks.delete(block);
    } else {
      block.classList.add('selected');
      this.selectedBlocks.add(block);
    }
  }

  clearSelection() {
    this.selectedBlocks.forEach(b => b.classList.remove('selected'));
    this.selectedBlocks.clear();
  }

  selectAllBlocks() {
    this.clearSelection();
    this.container.querySelectorAll(':scope > .block').forEach(block => {
      block.classList.add('selected');
      this.selectedBlocks.add(block);
    });
  }

  getSelectedBlocksOrdered() {
    const list = Array.from(this.selectedBlocks);
    return list.sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      return 0;
    });
  }

  copySelectedBlocks() {
    const selected = this.getSelectedBlocksOrdered();
    if (!selected.length) return;
    const nodes = selected.map(block => this.blockToNode(block)).filter(Boolean);
    if (!nodes.length) return;
    this.clipboard = nodes;
  }

  cutSelectedBlocks() {
    this.copySelectedBlocks();
    this.deleteSelectedBlocks();
  }

  deleteSelectedBlocks() {
    const selected = this.getSelectedBlocksOrdered();
    if (!selected.length) return;
    selected.forEach(block => block.remove());
    this.clearSelection();
    this.onBlockChange();
    window.app?.uiManager?.refreshSectionJump?.();
  }

  pasteClipboard() {
    if (!this.clipboard || !this.clipboard.length) return;
    const { container, after } = this.getPasteTarget();
    if (!container) return;

    const emptyState = container.querySelector?.(':scope > .empty-state');
    if (emptyState) emptyState.remove();

    let insertAfter = after;
    this.clipboard.forEach(node => {
      const clone = JSON.parse(JSON.stringify(node));
      const block = this.renderNode(clone);
      if (!block) return;
      if (insertAfter && insertAfter.parentElement === container) insertAfter.after(block);
      else container.appendChild(block);
      this.blocks.push(block);
      insertAfter = block;
    });

    if (insertAfter) this.selectSingleBlock(insertAfter);
    this.onBlockChange();
    window.app?.uiManager?.refreshSectionJump?.();
  }

  getPasteTarget() {
    const selected = this.getSelectedBlocksOrdered();
    if (!selected.length) return { container: this.container, after: null };
    const last = selected[selected.length - 1];
    return { container: last.parentElement || this.container, after: last };
  }

  collectAST() {
    const ast = [];
    const topLevelBlocks = this.container.querySelectorAll(':scope > .block');
    topLevelBlocks.forEach(block => {
      const node = this.blockToNode(block);
      if (node) ast.push(node);
    });
    return ast;
  }

  blockToNode(block) {
    if (block.dataset.type === 'comment') return block._nodeData || { type: 'comment', content: '' };
    if (block.dataset.type === 'text') {
      const textSpan = block.querySelector('.text-content');
      return { type: 'text', content: textSpan ? textSpan.textContent : '' };
    }

    const tagName = block.dataset.tagName;

    if (tagName === 'repeat') {
      const contentContainer = block.querySelector('.block-content');
      const children = [];
      contentContainer.querySelectorAll(':scope > .block').forEach(childBlock => {
        const childNode = this.blockToNode(childBlock);
        if (childNode) children.push(childNode);
      });
      const attrs = {};
      if (block._repeatCount && block._repeatCount !== 2) attrs.count = String(block._repeatCount);
      return {
        type: 'element', tagName: 'repeat', attrs, children, content: '',
        definition: this.parser.tagDefinitions.repeat
      };
    }

    if (tagName === 'pause') {
      return {
        type: 'element', tagName: 'pause', attrs: { dur: String(block._duration || 10) }, children: [], content: '',
        definition: this.parser.tagDefinitions.pause, uiId: block.dataset.id
      };
    }

    if (tagName === 'fx') {
      const attrs = {};
      if (block._effectId) attrs.id = block._effectId;
      if (block._effectDuration) attrs.dur = String(block._effectDuration);
      if (block._effectFade) attrs.fade = String(block._effectFade);
      return {
        type: 'element', tagName: 'fx', attrs, children: [], content: '',
        definition: this.parser.tagDefinitions.fx, uiId: block.dataset.id
      };
    }

    if (tagName === 'divider') {
      return {
        type: 'element', tagName: 'divider', attrs: {}, children: [], content: '',
        definition: this.parser.tagDefinitions.divider, uiId: block.dataset.id
      };
    }

    if (tagName === 'section') {
      return {
        type: 'element', tagName: 'section', attrs: { title: block._sectionTitle || '未命名分节' }, children: [], content: '',
        definition: this.parser.tagDefinitions.section, uiId: block.dataset.id
      };
    }

    if (tagName === 'say') {
      const textarea = block.querySelector('textarea');
      const content = textarea ? textarea.value.trim() : '';
      const attrs = {};
      if (block._roleId) attrs.role = block._roleId;
      if (block._rate && block._rate !== 1.0) attrs.rate = String(block._rate);
      return {
        type: 'element', tagName: 'say', attrs, children: [], content,
        definition: this.parser.tagDefinitions.say, uiId: block.dataset.id
      };
    }

    return null;
  }

  addBlock(tagName, options = {}) {
    const node = {
      type: 'element',
      tagName,
      attrs: options.attrs || {},
      children: [],
      content: '',
      definition: this.parser.tagDefinitions[tagName]
    };

    if (tagName === 'pause') {
      node.attrs = { dur: String(options.duration || 10) };
    } else if (tagName === 'fx') {
      node.attrs = {};
      if (options.effectId) node.attrs.id = options.effectId;
      if (options.duration) node.attrs.dur = String(options.duration);
      if (options.fade) node.attrs.fade = String(options.fade);
    } else if (tagName === 'repeat') {
      if (options.repeatCount && options.repeatCount !== 2) node.attrs = { count: String(options.repeatCount) };
    } else if (tagName === 'say') {
      if (options.roleId) node.attrs.role = options.roleId;
      if (options.rate) node.attrs.rate = String(options.rate);
    } else if (tagName === 'section') {
      node.attrs = { title: options.title || '未命名分节' };
    }

    const block = this.renderNode(node);
    if (block) {
      const emptyState = this.container.querySelector('.empty-state');
      if (emptyState) emptyState.remove();
      this.container.appendChild(block);
      this.blocks.push(block);

      const textarea = block.querySelector('textarea');
      if (textarea) textarea.focus();

      this.onBlockChange();
      window.app?.uiManager?.refreshSectionJump?.();
    }

    return block;
  }

  onChange(callback) {
    this.onChangeCallback = callback;
  }

  enableDropZone(container) {
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!this.draggingBlock) return;
      if (container === this.draggingBlock || this.draggingBlock.contains(container)) return;
      const children = Array.from(container.querySelectorAll(':scope > .block'));
      let insertBefore = null;
      for (const child of children) {
        const rect = child.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          insertBefore = child;
          break;
        }
      }
      if (!this.placeholderEl) this.placeholderEl = this.createPlaceholder();
      if (insertBefore) {
        if (this.placeholderEl.parentElement !== container || this.placeholderEl.nextSibling !== insertBefore) {
          container.insertBefore(this.placeholderEl, insertBefore);
        }
      } else if (this.placeholderEl.parentElement !== container || this.placeholderEl.nextSibling !== null) {
        container.appendChild(this.placeholderEl);
      }
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!this.draggingBlock || !this.placeholderEl) return;
      if (container === this.draggingBlock || this.draggingBlock.contains(container)) return;

      const emptyState = container.querySelector(':scope > .empty-state');
      if (emptyState) emptyState.remove();

      container.insertBefore(this.draggingBlock, this.placeholderEl);
      this.clearPlaceholder();
      this.draggingBlock.classList.remove('dragging');
      this.draggingBlock = null;
      this.onBlockChange();
      window.app?.uiManager?.refreshSectionJump?.();
    });
  }

  createPlaceholder() {
    const el = document.createElement('div');
    el.className = 'sortable-placeholder';
    return el;
  }

  clearPlaceholder() {
    if (this.placeholderEl?.parentElement) this.placeholderEl.parentElement.removeChild(this.placeholderEl);
    this.placeholderEl = null;
  }

  getRoles() {
    try {
      return JSON.parse(localStorage.getItem('listext_roles') || '[]');
    } catch {
      return [];
    }
  }

  getSections() {
    const list = [];
    this.container.querySelectorAll('.block[data-tag-name="section"]').forEach(block => {
      list.push({ id: block.dataset.id, title: block._sectionTitle || '未命名分节' });
    });
    return list;
  }

  scrollToBlockId(blockId) {
    if (!blockId) return;
    const target = this.container.querySelector(`.block[data-id="${blockId}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('selected');
    setTimeout(() => target.classList.remove('selected'), 1200);
  }

  findBlockByKeyword(keyword) {
    const q = (keyword || '').toLowerCase();
    if (!q) return null;

    const blocks = Array.from(this.container.querySelectorAll('.block'));
    for (const block of blocks) {
      const tag = block.dataset.tagName || '';
      if (tag === 'section' && (block._sectionTitle || '').toLowerCase().includes(q)) return block;
      if (tag === 'fx' && (block._effectId || '').toLowerCase().includes(q)) return block;
      const text = block.querySelector('textarea')?.value || block.textContent || '';
      if (text.toLowerCase().includes(q)) return block;
    }
    return null;
  }

  getTopLevelBlocks() {
    return Array.from(this.container.querySelectorAll(':scope > .block'));
  }

  getPrimarySelectedBlock() {
    const ordered = this.getSelectedBlocksOrdered();
    return ordered.length ? ordered[0] : null;
  }

  selectNextBlock() {
    const blocks = this.getTopLevelBlocks();
    if (!blocks.length) return;
    const current = this.getPrimarySelectedBlock();
    if (!current) {
      this.selectSingleBlock(blocks[0]);
      return;
    }
    const idx = blocks.indexOf(current);
    const next = blocks[Math.min(blocks.length - 1, idx + 1)];
    if (next) this.selectSingleBlock(next);
  }

  selectPrevBlock() {
    const blocks = this.getTopLevelBlocks();
    if (!blocks.length) return;
    const current = this.getPrimarySelectedBlock();
    if (!current) {
      this.selectSingleBlock(blocks[0]);
      return;
    }
    const idx = blocks.indexOf(current);
    const prev = blocks[Math.max(0, idx - 1)];
    if (prev) this.selectSingleBlock(prev);
  }

  moveSelectedBlock(offset) {
    const block = this.getPrimarySelectedBlock();
    if (!block || !offset) return;
    const parent = block.parentElement;
    if (!parent) return;
    const siblings = Array.from(parent.querySelectorAll(':scope > .block'));
    const idx = siblings.indexOf(block);
    if (idx < 0) return;
    const targetIdx = idx + offset;
    if (targetIdx < 0 || targetIdx >= siblings.length) return;

    if (offset < 0) {
      parent.insertBefore(block, siblings[targetIdx]);
    } else {
      const ref = siblings[targetIdx].nextSibling;
      parent.insertBefore(block, ref);
    }

    this.selectSingleBlock(block);
    this.onBlockChange();
    window.app?.uiManager?.refreshSectionJump?.();
  }

  focusSelectedBlockEditor() {
    const block = this.getPrimarySelectedBlock();
    if (!block) return;
    const textarea = block.querySelector('textarea');
    if (textarea) {
      textarea.focus();
      return;
    }
    const tag = block.dataset.tagName;
    if (tag === 'pause') this.showPauseEditor(block);
    else if (tag === 'fx') this.showFxEditor(block);
    else if (tag === 'repeat') this.showRepeatEditor(block);
    else if (tag === 'section') this.showSectionEditor(block);
    else if (tag === 'say') this.showSayEditor(block);
  }

  generateId() {
    return `block_${Math.random().toString(36).slice(2, 10)}`;
  }

  escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BlockRenderer;
}

