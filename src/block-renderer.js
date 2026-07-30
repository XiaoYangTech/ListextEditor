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

class BlockRenderer {
  constructor(container, parser) {
    this.container = container;
    this.parser = parser;
    this.selectedBlocks = new Set();
    this.clipboard = null;
    this.history = [];
    this.historyIndex = -1;
    this.maxHistory = 100;
    this.isRestoring = false;
    this.lastSnapshot = '';
    this.draggingBlock = null;
    this.draggingMultiBlocks = null;
    this.multiGroupEl = null;
    this.placeholderEl = null;
    this.init();
  }

  init() {
    this.createEditDialog();
    this.createContextMenu();

    if (this.container) {
      this.container.addEventListener('click', (e) => {
        if (e.target === this.container || e.target.closest('.empty-state')) {
          this.clearSelection();
        }
      });
      this.container.addEventListener('contextmenu', (e) => {
        if (!e.target.closest('.block')) {
          e.preventDefault();
          this.hideContextMenu();
        }
      });
      this.enableDropZone(this.container);

      document.addEventListener('dragover', (e) => {
        if (!this.draggingBlock && !this.draggingMultiBlocks) return;
        e.preventDefault();
        this.handleDragAutoScroll(this.container, e.clientY);
      });
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
    this._editDialogHandler = null;

    const closeDialog = () => {
      dialog.classList.remove('active');
      if (this._editDialogHandler) {
        dialog.querySelector('#editDialogConfirm').removeEventListener('click', this._editDialogHandler);
        this._editDialogHandler = null;
      }
    };
    dialog.querySelector('.dialog-close').addEventListener('click', closeDialog);
    dialog.querySelector('.btn-cancel').addEventListener('click', closeDialog);
  }

  openEditDialog(title, bodyHtml, onConfirm) {
    const dialog = this.editDialog;
    dialog.querySelector('#editDialogTitle').textContent = title;
    dialog.querySelector('#editDialogBody').innerHTML = bodyHtml;

    const confirmBtn = dialog.querySelector('#editDialogConfirm');
    if (this._editDialogHandler) {
      confirmBtn.removeEventListener('click', this._editDialogHandler);
    }
    const handler = () => {
      confirmBtn.removeEventListener('click', handler);
      this._editDialogHandler = null;
      dialog.classList.remove('active');
      onConfirm();
    };
    this._editDialogHandler = handler;
    confirmBtn.addEventListener('click', handler);
    dialog.classList.add('active');
  }

  createContextMenu() {
    const menu = document.createElement('div');
    menu.id = 'blockContextMenu';
    menu.className = 'context-menu';
    menu.innerHTML = `
      <div class="context-menu-item" data-action="edit"><span class="material-icons">edit</span>编辑</div>
      <div class="context-menu-item" data-action="duplicate"><span class="material-icons">content_copy</span>复制积木</div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" data-action="copy"><span class="material-icons">file_copy</span>复制</div>
      <div class="context-menu-item" data-action="cut"><span class="material-icons">content_cut</span>剪切</div>
      <div class="context-menu-item" data-action="paste"><span class="material-icons">content_paste</span>粘贴</div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" data-action="moveUp"><span class="material-icons">arrow_upward</span>上移</div>
      <div class="context-menu-item" data-action="moveDown"><span class="material-icons">arrow_downward</span>下移</div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item context-menu-danger" data-action="delete"><span class="material-icons">delete</span>删除</div>
    `;
    document.body.appendChild(menu);
    this.contextMenu = menu;

    menu.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });

    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.context-menu-item');
      if (!item) return;
      e.stopPropagation();
      const action = item.dataset.action;
      const target = this._contextTarget;
      this.hideContextMenu();
      if (target && action) {
        this.handleContextAction(action, target);
      }
    });

    document.addEventListener('mousedown', (e) => {
      if (!menu.contains(e.target)) {
        this.hideContextMenu();
      }
    });
    document.addEventListener('scroll', () => this.hideContextMenu(), true);
  }

  showContextMenu(e, block) {
    e.preventDefault();
    e.stopPropagation();
    this._contextTarget = block;
    this.selectSingleBlock(block);

    const menu = this.contextMenu;
    const tag = block.dataset.tagName;
    const isRepeat = tag === 'repeat';

    menu.querySelector('[data-action="edit"]').style.display = block.querySelector('.btn-edit') ? '' : 'none';

    const parent = block.parentElement;
    const siblings = parent ? Array.from(parent.querySelectorAll(':scope > .block')) : [];
    const idx = siblings.indexOf(block);
    menu.querySelector('[data-action="moveUp"]').style.display = idx > 0 ? '' : 'none';
    menu.querySelector('[data-action="moveDown"]').style.display = idx < siblings.length - 1 ? '' : 'none';
    menu.querySelector('[data-action="paste"]').style.display = this.clipboard ? '' : 'none';

    const children = Array.from(menu.children);
    children.forEach((child, i) => {
      if (!child.classList.contains('context-menu-divider')) return;
      const hasVisibleBefore = children.slice(0, i).some(c =>
        c.classList.contains('context-menu-item') && c.style.display !== 'none'
      );
      const hasVisibleAfter = children.slice(i + 1).some(c =>
        c.classList.contains('context-menu-item') && c.style.display !== 'none'
      );
      child.style.display = (hasVisibleBefore && hasVisibleAfter) ? '' : 'none';
    });

    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.add('active');

    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) menu.style.left = (e.clientX - rect.width) + 'px';
      if (rect.bottom > window.innerHeight) menu.style.top = (e.clientY - rect.height) + 'px';
    });
  }

  hideContextMenu() {
    if (this.contextMenu) this.contextMenu.classList.remove('active');
    this._contextTarget = null;
  }

  handleContextAction(action, block) {
    switch (action) {
      case 'edit': {
        const tag = block.dataset.tagName;
        if (tag === 'say') this.showSayEditor(block);
        else if (tag === 'pause') this.showPauseEditor(block);
        else if (tag === 'fx') this.showFxEditor(block);
        else if (tag === 'repeat') this.showRepeatEditor(block);
        else if (tag === 'section') this.showSectionEditor(block);
        else this.focusSelectedBlockEditor();
        break;
      }
      case 'duplicate': this.duplicateBlock(block); break;
      case 'copy': this.copySelectedBlocks(); break;
      case 'cut': this.cutSelectedBlocks(); break;
      case 'paste': this.pasteClipboard(); break;
      case 'moveUp': this.moveSelectedBlock(-1); break;
      case 'moveDown': this.moveSelectedBlock(1); break;
      case 'delete': this.deleteSelectedBlocks(); break;
    }
  }

  duplicateBlock(block) {
    const node = this.blockToNode(block);
    if (!node) return;
    const clone = JSON.parse(JSON.stringify(node));
    const newBlock = this.renderNode(clone);
    if (!newBlock) return;
    block.after(newBlock);
    this.syncNestedRepeatControl(newBlock);
    this.selectSingleBlock(newBlock);
    this.onBlockChange();
  }

  render(ast) {
    this.container.innerHTML = '';
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
      }
    }

    this.recordHistory();
  }

  // 按结构路径（如 "2.0.1"）定位积木：顶层 .block 按序数取，嵌套逐层下钻 .repeat-drop-zone
  getBlockByPath(path) {
    if (path == null || !this.container) return null;
    const parts = String(path).split('.');
    let scope = this.container;
    let block = null;
    for (let i = 0; i < parts.length; i++) {
      const idx = parseInt(parts[i], 10);
      if (Number.isNaN(idx) || !scope) return null;
      const blocks = Array.from(scope.children).filter(el => el.classList?.contains('block'));
      block = blocks[idx] || null;
      if (!block) return null;
      if (i < parts.length - 1) scope = block.querySelector(':scope > .repeat-drop-zone');
    }
    return block;
  }

  clear() {
    this.container.innerHTML = '';
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
        <button class="block-action-btn btn-play-here" title="从此处播放"><span class="material-icons">play_circle</span></button>
        <button class="block-action-btn btn-play-only" title="只播放此块"><span class="material-icons">play_circle_outline</span></button>
        ${hasEdit ? `<button class="block-action-btn btn-edit" title="编辑属性"><span class="material-icons">edit</span></button>` : ''}
        <button class="block-action-btn btn-delete" title="删除"><span class="material-icons">delete</span></button>
      </div>
    `;
    return header;
  }

  renderSayBlock(node) {
    const block = this.createBaseBlock('say', node);
    const header = this.createBlockHeader('say', '朗读', 'record_voice_over', true);
    // 头部空白条加属性区：角色 · 语速，超出时跑马灯滚动
    const attr = document.createElement('span');
    attr.className = 'block-attr';
    attr.innerHTML = '<span class="block-attr-text"></span>';
    header.insertBefore(attr, header.querySelector('.block-actions'));
    const content = document.createElement('div');
    content.className = 'block-content';
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
    this.updateSayAttr(block);
    return block;
  }

  getRolesSync() {
    return window.app?.tabManager?.getActiveTab()?.roles || [];
  }

  // 刷新朗读块头部属性区显示（角色 · 语速），文字超宽加跑马灯
  updateSayAttr(block) {
    const attr = block?.querySelector('.block-attr');
    const textEl = attr?.querySelector('.block-attr-text');
    if (!attr || !textEl) return;
    const roles = this.getRolesSync();
    const role = block._roleId ? roles.find(r => r.id === block._roleId) : null;
    const roleText = role ? role.name : '不使用角色';
    textEl.textContent = `${roleText} · ${(block._rate ?? 1.0)}x`;
    attr.classList.remove('block-attr-marquee');
    textEl.style.removeProperty('--attr-shift');
    requestAnimationFrame(() => {
      const shift = textEl.scrollWidth - attr.clientWidth;
      if (shift > 2) {
        textEl.style.setProperty('--attr-shift', `-${shift}px`);
        attr.classList.add('block-attr-marquee');
      }
    });
  }

  // 角色表变化后刷新所有朗读块的属性显示（角色被删则显示回落为不使用角色）
  refreshSayRoleOptions() {
    this.container?.querySelectorAll('.block[data-tag-name="say"]').forEach(b => this.updateSayAttr(b));
  }

  renderPauseBlock(node) {
    const block = this.createBaseBlock('pause', node);
    const header = this.createBlockHeader('pause', '停顿', 'timer', true);
    const duration = parseInt(node.attrs?.dur || String(LISTEXT_CONSTANTS.DEFAULT_PAUSE_DURATION), 10) || LISTEXT_CONSTANTS.DEFAULT_PAUSE_DURATION;
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
    const title = node.attrs?.title || LISTEXT_CONSTANTS.DEFAULT_SECTION_TITLE;
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
    const count = parseInt(node.attrs?.count || String(LISTEXT_CONSTANTS.DEFAULT_REPEAT_COUNT), 10) || LISTEXT_CONSTANTS.DEFAULT_REPEAT_COUNT;
    block._repeatCount = count;
    const header = this.createBlockHeader('repeat', `重复（${count} 次）`, 'repeat', true);
    const content = document.createElement('div');
    content.className = 'block-content repeat-drop-zone';

    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        const childBlock = this.renderNode(child);
        if (childBlock) {
          content.appendChild(childBlock);
          this.syncNestedRepeatControl(childBlock);
        }
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

  // 计算积木当前的结构路径（与 getBlockByPath 互逆），供单块/从某处播放预设 node.path
  getBlockPath(block) {
    const parts = [];
    let el = block;
    while (el?.classList?.contains('block')) {
      const scope = el.parentElement;
      if (!scope) return null;
      const blocks = Array.from(scope.children).filter(c => c.classList?.contains('block'));
      const idx = blocks.indexOf(el);
      if (idx < 0) return null;
      parts.unshift(String(idx));
      el = scope.classList?.contains('repeat-drop-zone') ? scope.closest('.block') : null;
    }
    return parts.join('.');
  }

  attachBlockEvents(block, textarea = null, editType = null) {
    block.setAttribute('draggable', 'false');

    const deleteBtn = block.querySelector('.btn-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const parent = block.parentElement;
        console.log('[动作] 删除积木:', block.dataset.tagName || block.dataset.type || '未知');
        block.remove();
        this.ensureRepeatEmptyState(parent);
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

    const playOnlyBtn = block.querySelector('.btn-play-only');
    if (playOnlyBtn) {
      playOnlyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const app = window.app;
        if (app && app.ttsRenderer) {
          const nodeData = this.blockToNode(block);
          if (nodeData) {
            nodeData.path = this.getBlockPath(block);
            const ast = [nodeData];
            app.playQueue.stop();
            app.playQueue.play(ast);
            app.updateStatus('播放当前块...');
          }
        }
      });
    }

    const playHereBtn = block.querySelector('.btn-play-here');
    if (playHereBtn) {
      playHereBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const app = window.app;
        if (app && app.ttsRenderer) {
          const allBlocks = this.collectAllBlocks();
          const idx = allBlocks.indexOf(block);
          if (idx >= 0) {
            const nodes = allBlocks.slice(idx).map(b => {
              const n = this.blockToNode(b);
              if (n) n.path = this.getBlockPath(b);
              return n;
            }).filter(Boolean);
            if (nodes.length) {
              app.playQueue.stop();
              app.playQueue.play(nodes);
              app.updateStatus(`从第 ${idx + 1} 块开始播放...`);
            }
          }
        }
      });
    }

    const headerEl = block.querySelector('.block-header');
    const dragSource = headerEl || block;

    dragSource.setAttribute('draggable', 'true');

    if (textarea) {
      textarea.setAttribute('draggable', 'false');
      textarea.style.userSelect = 'text';
      textarea.style.webkitUserSelect = 'text';
      textarea.addEventListener('input', () => this.onBlockChange());
      textarea.addEventListener('dragstart', (e) => e.preventDefault());
      textarea.addEventListener('mousedown', (e) => e.stopPropagation());
      textarea.addEventListener('pointerdown', (e) => e.stopPropagation());
      textarea.addEventListener('selectstart', (e) => e.stopPropagation());
    }

    block.addEventListener('click', (e) => {
      if (e.target.closest('textarea, input, select')) return;
      if (e.ctrlKey || e.metaKey) this.toggleBlockSelection(block);
      else this.selectSingleBlock(block);
    });

    block.addEventListener('mousedown', (e) => {
      if (e.target.closest('textarea, input, select, .block-action-btn')) return;
      if (e.button !== 0) return;
      if (e.ctrlKey || e.metaKey) return;
      if (this.selectedBlocks.size > 1 && this.selectedBlocks.has(block)) {
        this.updateMultiGroupDisplay();
      }
    });

    block.addEventListener('contextmenu', (e) => {
      if (e.target.closest('textarea, input, select')) return;
      this.showContextMenu(e, block);
    });

    dragSource.addEventListener('dragstart', (e) => {
      if (e.target.closest('.block-action-btn')) {
        e.preventDefault();
        return;
      }
      if (textarea && !e.target.closest('.block-header')) {
        e.preventDefault();
        return;
      }
      if (this.selectedBlocks.size > 1 && this.selectedBlocks.has(block)) {
        this.draggingMultiBlocks = this.getSelectedBlocksOrdered();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'multi');
        if (this.multiGroupEl) {
          e.dataTransfer.setDragImage(this.multiGroupEl, 50, 25);
        }
        this.draggingMultiBlocks.forEach(b => b.classList.add('dragging'));
        if (!this.placeholderEl) this.placeholderEl = this.createPlaceholder();
      } else {
        this.draggingBlock = block;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', block.dataset.id);
        block.classList.add('dragging');
        if (!this.placeholderEl) this.placeholderEl = this.createPlaceholder();
      }
    });

    dragSource.addEventListener('dragend', () => {
      block.classList.remove('dragging');
      this.draggingMultiBlocks?.forEach(b => b.classList.remove('dragging'));
      this.clearPlaceholder();
      this.stopDragAutoScroll();
      if (this.multiGroupEl) {
        this.multiGroupEl._hiddenBlocks?.forEach(b => { b.style.display = ''; });
        this.multiGroupEl.remove();
        this.multiGroupEl = null;
      }
      this.draggingBlock = null;
      this.draggingMultiBlocks = null;
      this.restoreAllRepeatEmptyStates();
    });

    block.addEventListener('dragover', (e) => {
      const placement = this.getDropPlacementForBlock(block, e.clientY);
      if (!placement) return;
      e.preventDefault();
      e.stopPropagation();
      if (!this.placeholderEl) this.placeholderEl = this.createPlaceholder();
      const insertBefore = placement.before ? placement.referenceBlock : placement.referenceBlock.nextSibling;
      if (insertBefore) placement.container.insertBefore(this.placeholderEl, insertBefore);
      else placement.container.appendChild(this.placeholderEl);
      this.handleDragAutoScroll(this.container, e.clientY);
    });

    block.addEventListener('drop', (e) => {
      const placement = this.getDropPlacementForBlock(block, e.clientY);
      if (!placement) return;
      const dragBlocks = this.draggingMultiBlocks || (this.draggingBlock ? [this.draggingBlock] : []);
      if (!dragBlocks.length) return;
      e.preventDefault();
      e.stopPropagation();
      this.stopDragAutoScroll();
      const oldParents = new Set();
      dragBlocks.forEach(b => oldParents.add(b.parentElement));
      const insertBefore = placement.before ? placement.referenceBlock : placement.referenceBlock.nextSibling;
      dragBlocks.forEach(b => {
        b.style.display = '';
        placement.container.insertBefore(b, insertBefore || null);
      });
      this.clearPlaceholder();
      oldParents.forEach(p => this.ensureRepeatEmptyState(p));
      this.ensureRepeatEmptyState(placement.container);
      dragBlocks.forEach(b => this.syncNestedRepeatControl(b));
      dragBlocks.forEach(b => b.classList.remove('dragging'));
      if (this.multiGroupEl) {
        this.multiGroupEl.remove();
        this.multiGroupEl = null;
      }
      this.draggingBlock = null;
      this.draggingMultiBlocks = null;
      this.onBlockChange();
    });
  }

  getDropPlacementForBlock(targetBlock, clientY) {
    const dragBlocks = this.draggingMultiBlocks || (this.draggingBlock ? [this.draggingBlock] : []);
    if (!dragBlocks.length || !targetBlock) return null;
    if (dragBlocks.includes(targetBlock)) return null;
    if (dragBlocks.some(b => b.contains(targetBlock))) return null;

    let container = targetBlock.parentElement;
    let referenceBlock = targetBlock;
    if (!container) return null;

    if (targetBlock.contains(dragBlocks[0])) {
      if (targetBlock.dataset.tagName !== 'repeat') return null;
      container = targetBlock.parentElement;
      referenceBlock = targetBlock;
      if (!container) return null;
    }

    const rect = referenceBlock.getBoundingClientRect();
    return {
      container,
      referenceBlock,
      before: clientY < rect.top + rect.height / 2
    };
  }

  ensureMoveOutButton(block) {
    const actions = block.querySelector('.block-header .block-actions');
    if (!actions || actions.querySelector('.btn-move-out')) return;

    const btn = document.createElement('button');
    btn.className = 'block-action-btn btn-move-out';
    btn.title = '移出重复块';
    btn.innerHTML = '<span class="material-icons">format_indent_decrease</span>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const repeatContent = block.parentElement;
      const repeatBlock = repeatContent?.closest('.block[data-tag-name="repeat"]');
      if (!repeatBlock || !repeatBlock.parentElement) return;
      repeatBlock.after(block);
      this.syncNestedRepeatControl(block);
      this.ensureRepeatEmptyState(repeatContent);
      this.onBlockChange();
    });

    actions.insertBefore(btn, actions.firstChild);
  }

  syncNestedRepeatControl(block) {
    if (!block) return;
    const actions = block.querySelector('.block-header .block-actions');
    if (!actions) return;

    const isNested = !!block.parentElement?.classList?.contains('repeat-drop-zone');
    const existing = actions.querySelector('.btn-move-out');

    if (isNested) {
      if (!existing) this.ensureMoveOutButton(block);
    } else if (existing) {
      existing.remove();
    }
  }

  showPauseEditor(block) {
    this.openEditDialog('设置停顿时长', `
      <div class="form-group"><label>秒数</label><input id="editPauseDuration" type="number" min="1" max="300" value="${block._duration || LISTEXT_CONSTANTS.DEFAULT_PAUSE_DURATION}" /></div>
    `, () => {
      block._duration = parseInt(document.getElementById('editPauseDuration').value, 10) || LISTEXT_CONSTANTS.DEFAULT_PAUSE_DURATION;
      block.querySelector('.silence-display').textContent = `停顿 ${block._duration} 秒`;
      this.onBlockChange();
    });
  }

  async showFxEditor(block) {
    window.app?.uiManager?.showEffectDialog((effectId, duration, fade) => {
      block._effectId = effectId;
      block._effectDuration = duration;
      block._effectFade = fade;
      block.querySelector('.effect-text').textContent = this.describeFx(block);
      this.onBlockChange();
    }, block._effectId);
  }

  showRepeatEditor(block) {
    this.openEditDialog('设置重复次数', `
      <div class="form-group"><label>次数</label><input id="editRepeatCount" type="number" min="1" max="20" value="${block._repeatCount || LISTEXT_CONSTANTS.DEFAULT_REPEAT_COUNT}" /></div>
    `, () => {
      block._repeatCount = parseInt(document.getElementById('editRepeatCount').value, 10) || LISTEXT_CONSTANTS.DEFAULT_REPEAT_COUNT;
      block.querySelector('.block-title').textContent = `重复（${block._repeatCount} 次）`;
      this.onBlockChange();
    });
  }

  showSectionEditor(block) {
    this.openEditDialog('设置分节标题', `
      <div class="form-group"><label>标题</label><input id="editSectionTitle" type="text" value="${this.escapeHtml(block._sectionTitle || LISTEXT_CONSTANTS.DEFAULT_SECTION_TITLE)}" /></div>
    `, () => {
      block._sectionTitle = document.getElementById('editSectionTitle').value.trim() || LISTEXT_CONSTANTS.DEFAULT_SECTION_TITLE;
      block.querySelector('.section-display').textContent = `📌 ${block._sectionTitle}`;
      this.onBlockChange();
    });
  }

  async showSayEditor(block) {
    const roles = await this.getRoles();
    this.openEditDialog('设置朗读属性', `
      <div class="form-group"><label>角色ID（可选）</label><select id="editSayRole"><option value="">不使用角色（默认中文，其他语言可能不准确）</option>${roles.map(r => `<option value="${this.escapeHtml(r.id)}" ${r.id === (block._roleId || '') ? 'selected' : ''}>${this.escapeHtml(r.name)} (${this.escapeHtml(r.id)})</option>`).join('')}</select></div>
      <div class="form-group"><label>语速（0.5 - 2.0）</label><input id="editSayRate" type="number" min="0.5" max="2" step="0.1" value="${block._rate || 1.0}" /></div>
    `, () => {
      block._roleId = document.getElementById('editSayRole').value || '';
      block._rate = parseFloat(document.getElementById('editSayRate').value) || 1.0;
      this.updateSayAttr(block);
      this.onBlockChange();
    });
  }

  describeFx(block) {
    let text = block._effectId || '（未选择音效）';
    if (block._effectDuration) text += ` (${block._effectDuration}秒)`;
    if (block._effectFade) text += ` 淡出${block._effectFade}秒`;
    return text;
  }

  onBlockChange() {
    // 最后一个积木被删走时恢复空态指引
    if (this.container && !this.container.querySelector(':scope > .block')) {
      this.showEmptyState();
    }
    this.recordHistory();
    if (this.onChangeCallback) this.onChangeCallback();
  }

  resetHistory() {
    this.history = [];
    this.historyIndex = -1;
    this.lastSnapshot = '';
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
    if (this.history.length > this.maxHistory) this.history.shift();
    this.historyIndex = this.history.length - 1;
  }

  undo() {
    if (this.historyIndex <= 0) return false;
    this.historyIndex -= 1;
    this.restoreFromHistory();
    return true;
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return false;
    this.historyIndex += 1;
    this.restoreFromHistory();
    return true;
  }

  restoreFromHistory() {
    const snapshot = this.history[this.historyIndex] || '';
    this.isRestoring = true;
    try {
      const ast = snapshot ? this.parser.parse(snapshot) : [];
      this.render(ast);
    } finally {
      this.isRestoring = false;
    }
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
    if (this.multiGroupEl) {
      this.multiGroupEl._hiddenBlocks?.forEach(b => { b.style.display = ''; });
      this.multiGroupEl.remove();
      this.multiGroupEl = null;
    }
  }

  selectAllBlocks() {
    this.clearSelection();
    this.container.querySelectorAll(':scope > .block').forEach(block => {
      if (block.style.display === 'none') return;
      block.classList.add('selected');
      this.selectedBlocks.add(block);
    });
  }

  updateMultiGroupDisplay() {
    const selected = this.getSelectedBlocksOrdered();

    if (selected.length < 2) {
      if (this.multiGroupEl) {
        this.multiGroupEl._hiddenBlocks?.forEach(b => { b.style.display = ''; });
        this.multiGroupEl.remove();
        this.multiGroupEl = null;
      }
      return;
    }

    const firstParent = selected[0].parentElement;
    if (!selected.every(b => b.parentElement === firstParent)) return;

    if (!this.multiGroupEl) {
      this.multiGroupEl = document.createElement('div');
      this.multiGroupEl.className = 'block-multi-group';
      this.multiGroupEl.setAttribute('draggable', 'true');

      this.multiGroupEl.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        this.draggingMultiBlocks = this.getSelectedBlocksOrdered();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'multi');
        this.multiGroupEl.classList.add('dragging');
        this.draggingMultiBlocks.forEach(b => b.classList.add('dragging'));
        if (!this.placeholderEl) this.placeholderEl = this.createPlaceholder();
      });

      this.multiGroupEl.addEventListener('dragend', () => {
        this.multiGroupEl.classList.remove('dragging');
        this.draggingMultiBlocks?.forEach(b => b.classList.remove('dragging'));
        this.clearPlaceholder();
        this.stopDragAutoScroll();
        this.draggingMultiBlocks = null;
        this.restoreAllRepeatEmptyStates();
      });

      this.multiGroupEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.clearSelection();
      });
    }

    firstParent.insertBefore(this.multiGroupEl, selected[0]);

    if (this.multiGroupEl._hiddenBlocks) {
      this.multiGroupEl._hiddenBlocks.forEach(b => { b.style.display = ''; });
    }
    selected.forEach(b => { b.style.display = 'none'; });
    this.multiGroupEl._hiddenBlocks = selected;

    this.multiGroupEl.innerHTML = `
      <span class="material-icons">widgets</span>
      <span class="block-multi-group-text">已选择 <span class="block-multi-group-count">${selected.length}</span> 个积木，拖动以移动</span>
    `;
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
    selected.forEach(block => {
      const parent = block.parentElement;
      block.remove();
      this.ensureRepeatEmptyState(parent);
    });
    this.clearSelection();
    this.onBlockChange();
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
      this.syncNestedRepeatControl(block);
      insertAfter = block;
    });

    if (insertAfter) this.selectSingleBlock(insertAfter);
    this.onBlockChange();
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

  collectAllBlocks() {
    const all = [];
    const walk = (container) => {
      container.querySelectorAll(':scope > .block').forEach(block => {
        if (block._nodeData) all.push(block);
        if (block.dataset.tagName === 'repeat') {
          const inner = block.querySelector('.block-content');
          if (inner) walk(inner);
        }
      });
    };
    walk(this.container);
    return all;
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
        type: 'element', tagName: 'pause', attrs: { dur: String(block._duration || LISTEXT_CONSTANTS.DEFAULT_PAUSE_DURATION) }, children: [], content: '',
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
        type: 'element', tagName: 'section', attrs: { title: block._sectionTitle || LISTEXT_CONSTANTS.DEFAULT_SECTION_TITLE }, children: [], content: '',
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
      node.attrs = { dur: String(options.duration || LISTEXT_CONSTANTS.DEFAULT_PAUSE_DURATION) };
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
      node.attrs = { title: options.title || LISTEXT_CONSTANTS.DEFAULT_SECTION_TITLE };
    }

    const block = this.renderNode(node);
    if (block) {
      const emptyState = this.container.querySelector('.empty-state');
      if (emptyState) emptyState.remove();

      const ref = this.getInsertTarget(options.insertBefore);
      if (ref) {
        ref.parentNode.insertBefore(block, options.insertBefore ? ref : ref.nextSibling);
      } else {
        this.container.appendChild(block);
      }

      const textarea = block.querySelector('textarea');
      if (textarea) textarea.focus();

      this.selectSingleBlock(block);
      block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      console.log('[动作] 添加积木:', tagName);
      this.onBlockChange();
    }

    return block;
  }

  getInsertTarget(insertBefore) {
    const selected = this.getPrimarySelectedBlock();
    if (!selected) return null;
    if (selected.parentElement !== this.container) return null;
    return selected;
  }

  onChange(callback) {
    this.onChangeCallback = callback;
  }

  enableDropZone(container) {
    container.addEventListener('dragover', (e) => {
      const hasDrag = this.draggingBlock || this.draggingMultiBlocks;
      if (!hasDrag) return;
      const dragBlocks = this.draggingMultiBlocks || [this.draggingBlock];
      if (dragBlocks.some(b => container === b || b.contains(container))) return;
      e.preventDefault();
      e.stopPropagation();
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
      this.handleDragAutoScroll(container, e.clientY);
    });

    container.addEventListener('drop', (e) => {
      const dragBlocks = this.draggingMultiBlocks || (this.draggingBlock ? [this.draggingBlock] : []);
      if (!dragBlocks.length || !this.placeholderEl) return;
      if (dragBlocks.some(b => container === b || b.contains(container))) return;
      e.preventDefault();
      e.stopPropagation();
      this.stopDragAutoScroll();

      const emptyState = container.querySelector(':scope > .empty-state');
      if (emptyState) emptyState.remove();

      const oldParents = new Set();
      dragBlocks.forEach(b => oldParents.add(b.parentElement));
      dragBlocks.forEach(b => {
        b.style.display = '';
        container.insertBefore(b, this.placeholderEl);
      });
      this.clearPlaceholder();
      oldParents.forEach(p => this.ensureRepeatEmptyState(p));
      this.ensureRepeatEmptyState(container);
      dragBlocks.forEach(b => this.syncNestedRepeatControl(b));
      dragBlocks.forEach(b => b.classList.remove('dragging'));
      if (this.multiGroupEl) {
        this.multiGroupEl.remove();
        this.multiGroupEl = null;
      }
      this.draggingBlock = null;
      this.draggingMultiBlocks = null;
      this.onBlockChange();
    });
  }

  handleDragAutoScroll(container, clientY) {
    this.stopDragAutoScroll();
    const rect = container.getBoundingClientRect();
    const scrollZone = 120;
    let speed = 0;

    if (clientY > rect.bottom - scrollZone) {
      const ratio = Math.min(1, (clientY - (rect.bottom - scrollZone)) / scrollZone);
      speed = 3 + 22 * Math.pow(ratio, 1.8);
    } else if (clientY < rect.top + scrollZone) {
      const ratio = Math.min(1, ((rect.top + scrollZone) - clientY) / scrollZone);
      speed = -(3 + 22 * Math.pow(ratio, 1.8));
    }

    if (speed === 0) return;

    const step = () => {
      container.scrollTop += speed;
      this._dragScrollTimer = requestAnimationFrame(step);
    };
    this._dragScrollTimer = requestAnimationFrame(step);
  }

  stopDragAutoScroll() {
    if (this._dragScrollTimer) {
      cancelAnimationFrame(this._dragScrollTimer);
      this._dragScrollTimer = null;
    }
  }

  ensureRepeatEmptyState(container) {
    if (!container || !container.classList?.contains('repeat-drop-zone')) return;
    const hasBlocks = container.querySelector(':scope > .block');
    const empty = container.querySelector(':scope > .empty-state');
    if (!hasBlocks && !empty) {
      const el = document.createElement('div');
      el.className = 'empty-state';
      el.style.padding = '16px';
      el.innerHTML = '<p>拖入积木到重复体内</p>';
      container.appendChild(el);
    }
    if (hasBlocks && empty) empty.remove();
  }

  restoreAllRepeatEmptyStates() {
    this.container.querySelectorAll('.repeat-drop-zone').forEach(z => this.ensureRepeatEmptyState(z));
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

  async getRoles() {
    if (window.electronAPI) {
      try {
        const data = await window.electronAPI.getProjectData();
        return data?.roles || [];
      } catch (e) { console.error('getRoles failed:', e); }
    }
    return [];
  }

  getSections() {
    const list = [];
    this.container.querySelectorAll('.block[data-tag-name="section"]').forEach(block => {
      list.push({ id: block.dataset.id, title: block._sectionTitle || LISTEXT_CONSTANTS.DEFAULT_SECTION_TITLE });
    });
    return list;
  }

  scrollToBlockId(blockId) {
    if (!blockId) return;
    const target = this.container.querySelector(`.block[data-id="${blockId}"]`);
    if (!target) return;

    const containerRect = this.container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const top = this.container.scrollTop + (targetRect.top - containerRect.top) - (this.container.clientHeight / 2) + (targetRect.height / 2);
    this.container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });

    target.classList.add('selected');
    setTimeout(() => {
      if (!this.selectedBlocks.has(target)) target.classList.remove('selected');
    }, 1200);
  }

  findBlockByKeyword(keyword) {
    const q = (keyword || '').toLowerCase();
    if (!q) return null;

    const blocks = Array.from(this.container.querySelectorAll('.block'));
    for (const block of blocks) {
      const tag = block.dataset.tagName || '';
      if (tag === 'section' && (block._sectionTitle || '').toLowerCase().includes(q)) return block;
      if (tag === 'fx' && (block._effectId || '').toLowerCase().includes(q)) return block;
      const textarea = block.querySelector('textarea');
      // 无 textarea 的块仅匹配标题，避免按钮/图标的 textContent 噪声
      const text = textarea ? (textarea.value || '') : (block.querySelector('.block-title')?.textContent || '');
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
    return window.escapeHtml(text);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BlockRenderer;
}

