/**
 * 积木渲染器
 * 将 AST 节点渲染为可视化积木块，支持属性编辑
 */

class BlockRenderer {
  constructor(container, parser) {
    this.container = container;
    this.parser = parser;
    this.blocks = [];
    this.effectLibrary = {};
    this.editDialog = null;
    this.selectedBlocks = new Set();
    this.clipboard = null;
    this.history = [];
    this.historyIndex = -1;
    this.isRestoring = false;
    this.lastSnapshot = '';
    
    this.init();
  }

  init() {
    // 加载音效库
    this.loadEffectLibrary();
    // 创建编辑对话框
    this.createEditDialog();
    this.draggingBlock = null;
    this.placeholderEl = null;
    if (this.container) {
      this.container.addEventListener('click', (e) => {
        if (e.target === this.container || e.target.closest('.empty-state')) {
          this.clearSelection();
        }
      });
    }
  }

  async loadEffectLibrary() {
    if (window.electronAPI) {
      this.effectLibrary = await window.electronAPI.loadEffects();
    }
  }

  /**
   * 创建通用编辑对话框
   */
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
        <div class="dialog-body" id="editDialogBody">
          <!-- 动态内容 -->
        </div>
        <div class="dialog-footer">
          <button class="btn btn-cancel">取消</button>
          <button class="btn btn-primary" id="editDialogConfirm">确定</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    this.editDialog = dialog;
    
    // 绑定事件
    dialog.querySelector('.dialog-close').addEventListener('click', () => {
      dialog.classList.remove('active');
    });
    dialog.querySelector('.btn-cancel').addEventListener('click', () => {
      dialog.classList.remove('active');
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        dialog.classList.remove('active');
      }
    });
  }

  /**
   * 渲染 AST 为积木块
   */
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
    this.enableDropZone(this.container);
    this.recordHistory();
  }

  /**
   * 清空积木
   */
  clear() {
    this.container.innerHTML = '';
    this.blocks = [];
    this.showEmptyState();
  }

  /**
   * 显示空状态
   */
  showEmptyState() {
    this.container.innerHTML = `
      <div class="empty-state">
        <span class="material-icons">add_circle_outline</span>
        <p>点击上方按钮添加积木块，或切换到代码模式输入 Listext 语法</p>
      </div>
    `;
  }

  /**
   * 渲染单个节点
   */
  renderNode(node, parentBlock = null) {
    if (node.type === 'text' && !node.content.trim()) {
      return null;
    }

    switch (node.tagName) {
      case 'say':
        return this.renderSayBlock(node);
      case 'pause':
        return this.renderSilenceBlock(node);
      case 'repeat':
        return this.renderRepeatBlock(node);
      case 'fx':
        return this.renderEffectBlock(node);
      case 'divider':
        return this.renderDividerBlock(node);
      case 'v':
        return this.renderRoleBlock(node);
      default:
        return null;
    }
  }

  /**
   * 渲染分割线块
   */
  renderDividerBlock(node) {
    const block = this.createBaseBlock('divider', node);
    // 分割线不需要标题头，只是一个视觉分隔
    const content = document.createElement('div');
    content.className = 'block-content';
    content.innerHTML = `
      <div class="divider-visual" style="height: 2px; background: #e0e0e0; margin: 10px 0; position: relative;">
        <span class="divider-label" style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); background: white; padding: 0 10px; color: #999; font-size: 12px;">分割线</span>
      </div>
    `;
    
    // 添加删除按钮
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'block-action-btn btn-delete';
    deleteBtn.innerHTML = '<span class="material-icons">delete</span>';
    deleteBtn.title = '删除';
    deleteBtn.style.position = 'absolute';
    deleteBtn.style.right = '0';
    deleteBtn.style.top = '-10px';
    
    block.appendChild(content);
    block.appendChild(deleteBtn);
    block.style.position = 'relative';
    
    this.attachBlockEvents(block);
    
    return block;
  }

  /**
   * 创建基础块结构
   */
  createBaseBlock(tagName, node) {
    const block = document.createElement('div');
    block.className = `block block-${tagName}`;
    block.dataset.tagName = tagName;
    block.dataset.id = this.generateId();
    block.setAttribute('draggable', 'true');

    // 存储节点数据
    block._nodeData = node;

    return block;
  }

  /**
   * 创建块头部（带编辑按钮）
   */
  createBlockHeader(tagName, title, icon, hasEdit = true) {
    const header = document.createElement('div');
    header.className = 'block-header';
    
    const iconWrapper = document.createElement('div');
    iconWrapper.className = 'block-icon';
    iconWrapper.innerHTML = `<span class="material-icons">${icon}</span>`;
    
    const titleEl = document.createElement('span');
    titleEl.className = 'block-title';
    titleEl.textContent = title;
    
    const actions = document.createElement('div');
    actions.className = 'block-actions';
    
    // 编辑按钮（对于可编辑属性的块）
    if (hasEdit && ['say', 'pause', 'fx', 'repeat', 'v'].includes(tagName)) {
      actions.innerHTML = `
        <button class="block-action-btn btn-edit" title="编辑属性">
          <span class="material-icons">edit</span>
        </button>
        <button class="block-action-btn btn-delete" title="删除">
          <span class="material-icons">delete</span>
        </button>
      `;
    } else {
      actions.innerHTML = `
        <button class="block-action-btn btn-delete" title="删除">
          <span class="material-icons">delete</span>
        </button>
      `;
    }
    
    header.appendChild(iconWrapper);
    header.appendChild(titleEl);
    header.appendChild(actions);
    
    return header;
  }

  /**
   * 渲染标题块
   */
  renderHeaderBlock(node) {
    const block = this.createBaseBlock('h', node);
    const header = this.createBlockHeader('h', '标题', 'title', false);
    const content = document.createElement('div');
    content.className = 'block-content';
    
    const textarea = document.createElement('textarea');
    textarea.className = 'block-textarea';
    textarea.placeholder = '输入考试标题...';
    textarea.value = node.content || '';
    textarea.rows = 2;
    
    content.appendChild(textarea);
    block.appendChild(header);
    block.appendChild(content);
    
    this.attachBlockEvents(block, textarea);
    
    return block;
  }

  /**
   * 渲染指导语块
   */
  renderInstructionBlock(node) {
    const block = this.createBaseBlock('i', node);
    const header = this.createBlockHeader('i', '指导语', 'info', false);
    const content = document.createElement('div');
    content.className = 'block-content';
    
    const textarea = document.createElement('textarea');
    textarea.className = 'block-textarea';
    textarea.placeholder = '输入指导语内容...';
    textarea.value = node.content || '';
    textarea.rows = 3;
    
    content.appendChild(textarea);
    block.appendChild(header);
    block.appendChild(content);
    
    this.attachBlockEvents(block, textarea);
    
    return block;
  }

  /**
   * 渲染测试块
   */
  renderTestBlock(node) {
    const block = this.createBaseBlock('t', node);
    const header = this.createBlockHeader('t', '测试块', 'settings', false);
    const content = document.createElement('div');
    content.className = 'block-content';
    
    // 渲染子节点
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        const childBlock = this.renderNode(child, block);
        if (childBlock) {
          content.appendChild(childBlock);
        }
      }
    } else {
      content.innerHTML = `
        <div class="empty-state" style="padding: 20px;">
          <p>拖入对话块</p>
        </div>
      `;
    }
    
    block.appendChild(header);
    block.appendChild(content);
    
    this.attachBlockEvents(block);
    this.enableDropZone(content);
    
    return block;
  }

  /**
   * 渲染重复块
   */
  renderRepeatBlock(node) {
    const block = this.createBaseBlock('repeat', node);
    const repeatCount = node.attrs?.count ? parseInt(node.attrs.count) : 2;
    const header = this.createBlockHeader('repeat', '重复块', 'repeat', true);
    
    // 添加重复次数标签
    const repeatBadge = document.createElement('span');
    repeatBadge.className = 'repeat-badge';
    repeatBadge.innerHTML = `<span class="material-icons" style="font-size:14px">refresh</span> 播放 ${repeatCount} 遍`;
    header.querySelector('.block-title').after(repeatBadge);
    
    const content = document.createElement('div');
    content.className = 'block-content';
    
    // 渲染子节点
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        const childBlock = this.renderNode(child, block);
        if (childBlock) {
          content.appendChild(childBlock);
        }
      }
    } else {
      content.innerHTML = `
        <div class="empty-state" style="padding: 20px;">
          <p>拖入对话块，内部内容将自动播放 ${repeatCount} 遍</p>
        </div>
      `;
    }
    
    block.appendChild(header);
    block.appendChild(content);
    
    block._repeatCount = repeatCount;
    this.attachBlockEvents(block, null, 'repeat');
    this.enableDropZone(content);
    
    return block;
  }

  renderSayBlock(node) {
    const block = this.createBaseBlock('say', node);
    const header = this.createBlockHeader('say', '朗读', 'record_voice_over', true);
    const content = document.createElement('div');
    content.className = 'block-content';
    const textarea = document.createElement('textarea');
    textarea.className = 'block-textarea';
    textarea.placeholder = '输入朗读内容...';
    textarea.value = node.content || '';
    textarea.rows = 2;
    content.appendChild(textarea);
    block.appendChild(header);
    block.appendChild(content);
    block._roleId = node.attrs?.role || '';
    block._rate = node.attrs?.rate ? parseFloat(node.attrs.rate) : 1.0;
    this.attachBlockEvents(block, textarea, 'say');
    return block;
  }

  /**
   * 渲染对话块
   */
  renderDialogBlock(node, role) {
    const isMale = role === 'a';
    const block = this.createBaseBlock(role, node);
    const header = this.createBlockHeader(role, isMale ? '男声' : '女声', 'person', false);
    const content = document.createElement('div');
    content.className = 'block-content';
    
    const row = document.createElement('div');
    row.className = 'dialog-row';
    
    const avatar = document.createElement('div');
    avatar.className = `dialog-avatar ${isMale ? 'male' : 'female'}`;
    avatar.innerHTML = `<span class="material-icons">person</span>`;
    
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'dialog-content-wrapper';
    
    const textarea = document.createElement('textarea');
    textarea.className = 'dialog-input';
    textarea.placeholder = `输入${isMale ? '男声' : '女声'}对话内容...`;
    textarea.value = node.content || '';
    textarea.rows = 2;
    
    contentWrapper.appendChild(textarea);
    row.appendChild(avatar);
    row.appendChild(contentWrapper);
    content.appendChild(row);
    
    block.appendChild(header);
    block.appendChild(content);
    
    this.attachBlockEvents(block, textarea);
    
    return block;
  }

  renderRoleBlock(node) {
    const block = this.createBaseBlock('v', node);
    const header = this.createBlockHeader('v', '角色', 'person', true);
    const roleId = node.attrs?.id || '';
    const roleName = this.getRoleName(roleId) || roleId || '未选择';
    header.querySelector('.block-title').textContent = `角色: ${roleName}`;
    const content = document.createElement('div');
    content.className = 'block-content';
    const row = document.createElement('div');
    row.className = 'dialog-row';
    const avatar = document.createElement('div');
    avatar.className = 'dialog-avatar';
    avatar.innerHTML = `<span class="material-icons">person</span>`;
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'dialog-content-wrapper';
    const textarea = document.createElement('textarea');
    textarea.className = 'dialog-input';
    textarea.placeholder = '输入角色对话内容...';
    textarea.value = node.content || '';
    textarea.rows = 2;
    contentWrapper.appendChild(textarea);
    row.appendChild(avatar);
    row.appendChild(contentWrapper);
    content.appendChild(row);
    block.appendChild(header);
    block.appendChild(content);
    block._roleId = roleId;
    this.attachBlockEvents(block, textarea, 'v');
    return block;
  }

  /**
   * 渲染问题块
   */
  renderQuestionBlock(node) {
    const block = this.createBaseBlock('q', node);
    const header = this.createBlockHeader('q', '问题', 'help', false);
    const content = document.createElement('div');
    content.className = 'block-content';
    
    const textarea = document.createElement('textarea');
    textarea.className = 'block-textarea';
    textarea.placeholder = '输入问题内容...';
    textarea.value = node.content || '';
    textarea.rows = 2;
    
    content.appendChild(textarea);
    block.appendChild(header);
    block.appendChild(content);
    
    this.attachBlockEvents(block, textarea);
    
    return block;
  }

  /**
   * 渲染静音块
   */
  renderSilenceBlock(node) {
    const block = this.createBaseBlock('pause', node);
    const header = this.createBlockHeader('pause', '停顿', 'timer', true);
    const content = document.createElement('div');
    content.className = 'block-content';
    
    // 获取静音时长
    let duration = 10;
    if (node.attrs) {
      if (node.attrs.dur) {
        duration = parseInt(node.attrs.dur) || 10;
      } else {
        const keys = Object.keys(node.attrs);
        if (keys.length > 0) {
          const firstKey = keys[0];
          if (!isNaN(parseInt(firstKey))) {
            duration = parseInt(firstKey);
          } else if (!isNaN(parseInt(node.attrs[firstKey]))) {
            duration = parseInt(node.attrs[firstKey]);
          }
        }
      }
    }
    
    content.innerHTML = `
      <div class="silence-display" style="display: flex; align-items: center; justify-content: center; padding: 16px; cursor: pointer;">
        <span class="silence-value">${duration}</span>
        <span class="silence-unit">秒</span>
        <span class="material-icons" style="margin-left: 8px; opacity: 0.5; font-size: 18px;">edit</span>
      </div>
    `;
    
    block.appendChild(header);
    block.appendChild(content);
    
    block._duration = duration;
    this.attachBlockEvents(block, null, 'pause');
    
    // 双击编辑
    content.querySelector('.silence-display').addEventListener('dblclick', () => {
      this.showSilenceEditor(block);
    });
    
    return block;
  }

  /**
   * 渲染音效块
   */
  renderEffectBlock(node) {
    const block = this.createBaseBlock('fx', node);
    const header = this.createBlockHeader('fx', '音效', 'music_note', true);
    const content = document.createElement('div');
    content.className = 'block-content';
    
    const effectId = node.attrs?.id || 'unknown';
    const duration = node.attrs?.dur || null;
    const fade = node.attrs?.fade || null;
    
    let displayText = effectId;
    if (duration) {
      displayText += ` (${duration}秒)`;
    }
    if (fade) {
      displayText += ` 淡出${fade}秒`;
    }
    
    content.innerHTML = `
      <div class="effect-display" style="display: flex; align-items: center; gap: 12px; padding: 12px; cursor: pointer;">
        <span class="material-icons" style="font-size: 32px; color: var(--tag-fx-border);">music_note</span>
        <span class="effect-text" style="font-size: 16px; font-weight: 500;">${displayText}</span>
        <span class="material-icons" style="margin-left: auto; opacity: 0.5; font-size: 18px;">edit</span>
      </div>
    `;
    
    block.appendChild(header);
    block.appendChild(content);
    
    block._effectId = effectId;
    block._effectDuration = duration;
    block._effectFade = fade ? parseInt(fade) : null;
    this.attachBlockEvents(block, null, 'fx');
    
    // 双击编辑
    content.querySelector('.effect-display').addEventListener('dblclick', () => {
      this.showEffectEditor(block);
    });
    
    return block;
  }

  /**
   * 绑定块事件
   */
  attachBlockEvents(block, textarea = null, editType = null) {
    // 删除按钮
    const deleteBtn = block.querySelector('.btn-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        block.remove();
        this.onBlockChange();
      });
    }
    
    // 编辑按钮
    const editBtn = block.querySelector('.btn-edit');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (editType === 'pause') {
          this.showSilenceEditor(block);
        } else if (editType === 'fx') {
          this.showEffectEditor(block);
        } else if (editType === 'repeat') {
          this.showRepeatEditor(block);
        } else if (editType === 'v') {
          this.showRoleEditor(block);
        } else if (editType === 'say') {
          this.showSayEditor(block);
        }
      });
    }
    
    // 文本变化
    if (textarea) {
      textarea.addEventListener('input', () => {
        this.onBlockChange();
      });
      textarea.addEventListener('dragstart', (e) => {
        e.stopPropagation();
      });
      const disableDrag = () => {
        block.setAttribute('draggable', 'false');
      };
      const enableDrag = () => {
        block.setAttribute('draggable', 'true');
      };
      textarea.addEventListener('pointerdown', disableDrag);
      textarea.addEventListener('pointerup', enableDrag);
      textarea.addEventListener('pointerleave', enableDrag);
      textarea.addEventListener('pointercancel', enableDrag);
      textarea.addEventListener('blur', enableDrag);
    }

    block.addEventListener('click', (e) => {
      const ignore = e.target.closest('textarea, input, select');
      if (ignore) return;
      if (e.ctrlKey || e.metaKey) {
        this.toggleBlockSelection(block);
      } else {
        this.selectSingleBlock(block);
      }
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
      if (!this.placeholderEl) {
        this.placeholderEl = this.createPlaceholder();
      }
    });
    block.addEventListener('dragend', () => {
      block.classList.remove('dragging');
      this.clearPlaceholder();
      this.draggingBlock = null;
    });
  }

  /**
   * 显示静音编辑器
   */
  showSilenceEditor(block) {
    const dialog = this.editDialog;
    const title = dialog.querySelector('#editDialogTitle');
    const body = dialog.querySelector('#editDialogBody');
    
    title.textContent = '设置静音时长';
    body.innerHTML = `
      <div class="form-group">
        <label>时长（秒）</label>
        <input type="number" id="editSilenceDuration" min="1" max="300" value="${block._duration || 10}">
      </div>
    `;
    
    const confirmBtn = dialog.querySelector('#editDialogConfirm');
    const handleConfirm = () => {
      const duration = parseInt(document.getElementById('editSilenceDuration').value) || 10;
      block._duration = duration;
      
      // 更新显示
      const display = block.querySelector('.silence-display');
      display.innerHTML = `
        <span class="silence-value">${duration}</span>
        <span class="silence-unit">秒</span>
        <span class="material-icons" style="margin-left: 8px; opacity: 0.5; font-size: 18px;">edit</span>
      `;
      display.addEventListener('dblclick', () => this.showSilenceEditor(block));
      
      dialog.classList.remove('active');
      this.onBlockChange();
      confirmBtn.removeEventListener('click', handleConfirm);
    };
    
    confirmBtn.addEventListener('click', handleConfirm);
    dialog.classList.add('active');
  }

  /**
   * 显示音效编辑器
   */
  async showEffectEditor(block) {
    const dialog = this.editDialog;
    const title = dialog.querySelector('#editDialogTitle');
    const body = dialog.querySelector('#editDialogBody');
    
    await this.loadEffectLibrary();
    const effectIds = Object.keys(this.effectLibrary);
    
    title.textContent = '选择音效';
    body.innerHTML = `
      <div class="form-group">
        <label>音效</label>
        <select id="editEffectId">
          ${effectIds.length > 0 
            ? effectIds.map(id => `<option value="${id}" ${id === block._effectId ? 'selected' : ''}>${id}</option>`).join('')
            : '<option value="">请先在音效管理器中添加音效</option>'
          }
        </select>
      </div>
      <div class="form-group">
        <label>持续时间（秒，留空表示播放完整音效）</label>
        <input type="number" id="editEffectDuration" min="1" max="300" placeholder="留空自动" value="${block._effectDuration || ''}">
      </div>
      <div class="form-group">
        <label>淡出时长（秒，可选）</label>
        <input type="number" id="editEffectFade" min="1" max="60" placeholder="留空不淡出" value="${block._effectFade || ''}">
      </div>
    `;
    
    const confirmBtn = dialog.querySelector('#editDialogConfirm');
    const handleConfirm = () => {
      const effectId = document.getElementById('editEffectId').value;
      const duration = document.getElementById('editEffectDuration').value;
      const fade = document.getElementById('editEffectFade').value;
      
      block._effectId = effectId;
      block._effectDuration = duration ? parseInt(duration) : null;
      block._effectFade = fade ? parseInt(fade) : null;
      
      // 更新显示
      let displayText = effectId;
      if (duration) {
        displayText += ` (${duration}秒)`;
      }
      if (fade) {
        displayText += ` 淡出${fade}秒`;
      }
      const textEl = block.querySelector('.effect-text');
      if (textEl) {
        textEl.textContent = displayText;
      }
      
      dialog.classList.remove('active');
      this.onBlockChange();
      confirmBtn.removeEventListener('click', handleConfirm);
    };
    
    confirmBtn.addEventListener('click', handleConfirm);
    dialog.classList.add('active');
  }

  /**
   * 显示重复次数编辑器
   */
  showRepeatEditor(block) {
    const dialog = this.editDialog;
    const title = dialog.querySelector('#editDialogTitle');
    const body = dialog.querySelector('#editDialogBody');
    
    title.textContent = '设置重复次数';
    body.innerHTML = `
      <div class="form-group">
        <label>播放次数</label>
        <input type="number" id="editRepeatCount" min="1" max="10" value="${block._repeatCount || 2}">
      </div>
    `;
    
    const confirmBtn = dialog.querySelector('#editDialogConfirm');
    const handleConfirm = () => {
      const count = parseInt(document.getElementById('editRepeatCount').value) || 2;
      block._repeatCount = count;
      
      // 更新显示
      const badge = block.querySelector('.repeat-badge');
      if (badge) {
        badge.innerHTML = `<span class="material-icons" style="font-size:14px">refresh</span> 播放 ${count} 遍`;
      }
      
      // 更新空状态提示
      const emptyState = block.querySelector('.empty-state p');
      if (emptyState) {
        emptyState.textContent = `拖入对话块，内部内容将自动播放 ${count} 遍`;
      }
      
      dialog.classList.remove('active');
      this.onBlockChange();
      confirmBtn.removeEventListener('click', handleConfirm);
    };
    
    confirmBtn.addEventListener('click', handleConfirm);
    dialog.classList.add('active');
  }

  showSayEditor(block) {
    const dialog = this.editDialog;
    const title = dialog.querySelector('#editDialogTitle');
    const body = dialog.querySelector('#editDialogBody');
    const roles = this.getRoles();
    title.textContent = '设置朗读属性';
    body.innerHTML = `
      <div class="form-group">
        <label>角色ID（可选）</label>
        <select id="editSayRole">
          <option value="">不使用角色</option>
          ${roles.map(r => `<option value="${r.id}" ${r.id === (block._roleId || '') ? 'selected' : ''}>${r.name} (${r.id})</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>语速（0.5 - 2.0）</label>
        <input type="number" id="editSayRate" min="0.5" max="2.0" step="0.1" value="${block._rate || 1.0}">
      </div>
    `;
    const confirmBtn = dialog.querySelector('#editDialogConfirm');
    const handleConfirm = () => {
      block._roleId = document.getElementById('editSayRole').value || '';
      block._rate = parseFloat(document.getElementById('editSayRate').value) || 1.0;
      dialog.classList.remove('active');
      this.onBlockChange();
      confirmBtn.removeEventListener('click', handleConfirm);
    };
    confirmBtn.addEventListener('click', handleConfirm);
    dialog.classList.add('active');
  }

  showRoleEditor(block) {
    const dialog = this.editDialog;
    const title = dialog.querySelector('#editDialogTitle');
    const body = dialog.querySelector('#editDialogBody');
    const roles = this.getRoles();
    title.textContent = '选择角色';
    body.innerHTML = `
      <div class="form-group">
        <label>角色ID</label>
        <select id="editRoleId">
          ${roles.length > 0 
            ? roles.map(r => `<option value="${r.id}" ${r.id === (block._roleId || '') ? 'selected' : ''}>${r.name} (${r.id})</option>`).join('')
            : '<option value="">请先在角色管理器中添加角色</option>'
          }
        </select>
      </div>
    `;
    const confirmBtn = dialog.querySelector('#editDialogConfirm');
    const handleConfirm = () => {
      const roleId = document.getElementById('editRoleId').value;
      block._roleId = roleId;
      const roleName = this.getRoleName(roleId) || roleId || '未选择';
      const titleEl = block.querySelector('.block-title');
      if (titleEl) {
        titleEl.textContent = `角色: ${roleName}`;
      }
      dialog.classList.remove('active');
      this.onBlockChange();
      confirmBtn.removeEventListener('click', handleConfirm);
    };
    confirmBtn.addEventListener('click', handleConfirm);
    dialog.classList.add('active');
  }

  /**
   * 块变化回调
   */
  onBlockChange() {
    this.recordHistory();
    if (this.onChangeCallback) {
      this.onChangeCallback();
    }
  }

  recordHistory() {
    if (this.isRestoring) return;
    const snapshot = this.parser.stringify(this.collectAST()).trim();
    if (snapshot === this.lastSnapshot) {
      return;
    }
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
    const blocks = this.container.querySelectorAll(':scope > .block');
    blocks.forEach(block => {
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
      if (insertAfter && insertAfter.parentElement === container) {
        insertAfter.after(block);
      } else {
        container.appendChild(block);
      }
      this.blocks.push(block);
      insertAfter = block;
    });
    if (insertAfter) {
      this.selectSingleBlock(insertAfter);
    }
    this.onBlockChange();
  }

  getPasteTarget() {
    const selected = this.getSelectedBlocksOrdered();
    if (!selected.length) {
      return { container: this.container, after: null };
    }
    const last = selected[selected.length - 1];
    const parent = last.parentElement;
    return { container: parent || this.container, after: last };
  }

  /**
   * 从积木块收集 AST
   */
  collectAST() {
    const ast = [];
    
    // 收集顶层块
    const topLevelBlocks = this.container.querySelectorAll(':scope > .block');
    topLevelBlocks.forEach(block => {
      const node = this.blockToNode(block);
      if (node) {
        ast.push(node);
      }
    });
    
    return ast;
  }

  /**
   * 将单个块转换为节点
   */
  blockToNode(block) {
    const tagName = block.dataset.tagName;

    if (['repeat'].includes(tagName)) {
      // 容器块 - 递归收集子节点
      const contentContainer = block.querySelector('.block-content');
      const children = [];
      
      contentContainer.querySelectorAll(':scope > .block').forEach(childBlock => {
        const childNode = this.blockToNode(childBlock);
        if (childNode) {
          children.push(childNode);
        }
      });
      
      const attrs = {};
      if (tagName === 'repeat' && block._repeatCount && block._repeatCount !== 2) {
        attrs.count = block._repeatCount.toString();
      }
      
      return {
        type: 'element',
        tagName,
        attrs,
        children,
        content: '',
        definition: this.parser.tagDefinitions[tagName]
      };
    }
    
    // 文本块
    const textarea = block.querySelector('textarea');
    const content = textarea ? textarea.value.trim() : '';
    
    // 停顿块
    if (tagName === 'pause') {
      const duration = block._duration || 10;
      return {
        type: 'element',
        tagName: 'pause',
        attrs: { dur: duration.toString() },
        children: [],
        content: '',
        definition: this.parser.tagDefinitions['pause'],
        uiId: block.dataset.id
      };
    }
    
    // 音效块
    if (tagName === 'fx') {
      const attrs = { id: block._effectId || 'unknown' };
      if (block._effectDuration) {
        attrs.dur = block._effectDuration.toString();
      }
      if (block._effectFade) {
        attrs.fade = block._effectFade.toString();
      }
      return {
        type: 'element',
        tagName: 'fx',
        attrs,
        children: [],
        content: '',
        definition: this.parser.tagDefinitions['fx'],
        uiId: block.dataset.id
      };
    }
    
    if (tagName === 'v') {
      const textarea = block.querySelector('textarea');
      const content = textarea ? textarea.value.trim() : '';
      const attrs = {};
      if (block._roleId) {
        attrs.id = block._roleId;
      }
      return {
        type: 'element',
        tagName: 'v',
        attrs,
        children: [],
        content,
        definition: this.parser.tagDefinitions['v'],
        uiId: block.dataset.id
      };
    }
    
    if (tagName === 'say') {
      const attrs = {};
      if (block._roleId) attrs.role = block._roleId;
      if (block._rate && block._rate !== 1.0) attrs.rate = block._rate.toString();
      return {
        type: 'element',
        tagName: 'say',
        attrs,
        children: [],
        content,
        definition: this.parser.tagDefinitions['say'],
        uiId: block.dataset.id
      };
    }
    
    // 普通文本块
    return {
      type: 'element',
      tagName,
      attrs: {},
      children: [],
      content,
      definition: this.parser.tagDefinitions[tagName]
    };
  }

  /**
   * 添加新块
   */
  addBlock(tagName, options = {}) {
    const node = {
      type: 'element',
      tagName,
      attrs: options.attrs || {},
      children: [],
      content: '',
      definition: this.parser.tagDefinitions[tagName]
    };
    
    // 特殊处理
    if (tagName === 'pause') {
      node.attrs = { dur: (options.duration || 10).toString() };
    } else if (tagName === 'fx') {
      node.attrs = { id: options.effectId || 'bell' };
      if (options.duration) {
        node.attrs.dur = options.duration.toString();
      }
      if (options.fade) {
        node.attrs.fade = options.fade.toString();
      }
    } else if (tagName === 'repeat') {
      if (options.repeatCount && options.repeatCount !== 2) {
        node.attrs = { count: options.repeatCount.toString() };
      }
    } else if (tagName === 'v') {
      if (options.roleId) {
        node.attrs = { id: options.roleId };
      }
    } else if (tagName === 'say') {
      if (options.roleId) node.attrs.role = options.roleId;
      if (options.rate) node.attrs.rate = options.rate.toString();
    }
    
    const block = this.renderNode(node);
    if (block) {
      // 移除空状态
      const emptyState = this.container.querySelector('.empty-state');
      if (emptyState) {
        emptyState.remove();
      }
      
      this.container.appendChild(block);
      this.blocks.push(block);
      
      // 聚焦到新块的文本框
      const textarea = block.querySelector('textarea');
      if (textarea) {
        textarea.focus();
      }
      
      this.onBlockChange();
    }
    
    return block;
  }

  /**
   * 生成唯一ID
   */
  generateId() {
    return 'block_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * 设置变化回调
   */
  onChange(callback) {
    this.onChangeCallback = callback;
  }

  /**
   * 清空所有块
   */
  clear() {
    this.container.innerHTML = '';
    this.blocks = [];
    this.showEmptyState();
  }
  
  enableDropZone(container) {
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!this.draggingBlock) return;
      const children = Array.from(container.querySelectorAll(':scope > .block'));
      let insertBefore = null;
      for (const child of children) {
        const rect = child.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          insertBefore = child;
          break;
        }
      }
      if (!this.placeholderEl) {
        this.placeholderEl = this.createPlaceholder();
      }
      if (insertBefore) {
        if (this.placeholderEl.parentElement !== container || this.placeholderEl.nextSibling !== insertBefore) {
          container.insertBefore(this.placeholderEl, insertBefore);
        }
      } else {
        if (this.placeholderEl.parentElement !== container || this.placeholderEl.nextSibling !== null) {
          container.appendChild(this.placeholderEl);
        }
      }
    });
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!this.draggingBlock || !this.placeholderEl) return;
      const parent = container;
      parent.insertBefore(this.draggingBlock, this.placeholderEl);
      this.clearPlaceholder();
      this.draggingBlock.classList.remove('dragging');
      this.draggingBlock = null;
      this.onBlockChange();
    });
  }
  
  createPlaceholder() {
    const el = document.createElement('div');
    el.className = 'sortable-placeholder';
    return el;
  }
  
  clearPlaceholder() {
    if (this.placeholderEl && this.placeholderEl.parentElement) {
      this.placeholderEl.parentElement.removeChild(this.placeholderEl);
    }
    this.placeholderEl = null;
  }
  
  getRoles() {
    try {
      const raw = localStorage.getItem('listext_roles') || '[]';
      return JSON.parse(raw);
    } catch (e) {
      return [];
    }
  }
  
  getRoleName(id) {
    if (!id) return null;
    const roles = this.getRoles();
    const r = roles.find(x => x.id === id);
    return r ? r.name : null;
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BlockRenderer;
}
