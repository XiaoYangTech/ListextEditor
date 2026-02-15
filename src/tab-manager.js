/**
 * 标签页管理器
 * 管理多文件编辑状态
 */

class TabManager {
  constructor(editor) {
    this.editor = editor;
    this.tabs = [];
    this.activeTabId = null;
    
    // DOM 元素
    this.container = document.getElementById('fileTabBar');
    this.newTabBtn = document.getElementById('btnNewTab');
    this.contextMenu = document.getElementById('tabContextMenu');
    
    this.init();
  }

  init() {
    // 绑定新建按钮事件
    if (this.newTabBtn) {
      this.newTabBtn.addEventListener('click', () => {
        this.createNewTab('未命名', '', null, true);
      });
    }
    
    // 滚轮横向滚动
    if (this.container) {
      this.container.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) {
          e.preventDefault();
          this.container.scrollLeft += e.deltaY;
        }
      });
    }
    if (this.contextMenu) {
      document.addEventListener('click', () => this.hideContextMenu());
      window.addEventListener('blur', () => this.hideContextMenu());
      document.addEventListener('contextmenu', (e) => {
        if (!e.target.closest('.tab-item')) {
          this.hideContextMenu();
        }
      });
    }
  }

  /**
   * 生成唯一 ID
   */
  generateId() {
    return 'tab_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * 获取当前激活的标签页对象
   */
  getActiveTab() {
    return this.tabs.find(t => t.id === this.activeTabId);
  }

  /**
   * 创建新标签页
   * @param {string} title 标题
   * @param {string} content 内容
   * @param {string} filePath 文件路径
   */
  createNewTab(title = '未命名', content = '', filePath = null, forceNew = false) {
    // 如果当前只有一个空标签页且未修改，直接复用
    if (!forceNew && this.tabs.length === 1) {
      const current = this.tabs[0];
      if (!current.filePath && !current.isDirty && !current.content) {
        this.updateTab(current.id, { title, content, filePath, isDirty: false });
        return current.id;
      }
    }

    const tab = {
      id: this.generateId(),
      title: title || '未命名',
      filePath: filePath,
      content: content || '',
      mode: 'block', // 默认为积木模式
      isDirty: false,
      scrollPos: 0
    };

    this.tabs.push(tab);
    this.renderTabs();
    this.activateTab(tab.id);
    
    return tab.id;
  }

  /**
   * 更新标签页信息
   */
  updateTab(id, data) {
    const tab = this.tabs.find(t => t.id === id);
    if (tab) {
      Object.assign(tab, data);
      this.renderTabs(); // 更新 UI（如标题变化）
    }
  }

  /**
   * 标记当前标签页为未保存
   */
  markActiveTabDirty(isDirty = true) {
    const tab = this.getActiveTab();
    if (tab && tab.isDirty !== isDirty) {
      tab.isDirty = isDirty;
      this.renderTabs();
    }
  }

  /**
   * 激活标签页
   */
  activateTab(id) {
    if (this.activeTabId === id) return;

    // 1. 保存当前标签页的状态（如果存在）
    if (this.activeTabId) {
      const currentTab = this.tabs.find(t => t.id === this.activeTabId);
      if (currentTab) {
        this.saveEditorStateToTab(currentTab);
      }
    }

    // 2. 切换激活 ID
    this.activeTabId = id;
    
    // 3. 恢复新标签页的状态到编辑器
    const newTab = this.tabs.find(t => t.id === id);
    if (newTab) {
      this.restoreEditorStateFromTab(newTab);
    }

    // 4. 更新 UI 选中状态
    this.renderTabs();
    
    // 5. 确保标签可见
    this.scrollToActiveTab();
  }

  /**
   * 关闭标签页
   */
  async closeTab(id) {
    const tab = this.tabs.find(t => t.id === id);
    if (!tab) return false;

    // 检查未保存更改
    if (tab.isDirty) {
      const action = await this.editor.showUnsavedDialog(tab.title);
      if (action === 'cancel') return false;
      if (action === 'save') {
        const saved = await this.editor.saveSpecificTab(tab.id);
        if (!saved) return false;
      }
    }

    const index = this.tabs.indexOf(tab);
    this.tabs.splice(index, 1);

    // 如果关闭的是当前激活的标签页
    if (this.activeTabId === id) {
      if (this.tabs.length > 0) {
        // 激活相邻的标签页（优先左侧，否则右侧）
        const newIndex = Math.max(0, index - 1);
        this.activateTab(this.tabs[newIndex].id);
      } else {
        // 如果没有标签页了，创建一个新的空标签页
        this.activeTabId = null; // 先清空，避免 saveEditorStateToTab 报错
        this.editor.clearEditor(); // 清空编辑器
        this.createNewTab();
      }
    } else {
      // 仅更新 UI
      this.renderTabs();
    }
    return true;
  }

  async closeTabsSequential(ids) {
    for (const id of ids) {
      const closed = await this.closeTab(id);
      if (!closed) return false;
    }
    return true;
  }

  async closeTabsRight(id) {
    const index = this.tabs.findIndex(t => t.id === id);
    if (index === -1) return;
    const ids = this.tabs.slice(index + 1).map(t => t.id);
    await this.closeTabsSequential(ids);
  }

  async closeTabsOthers(id) {
    const ids = this.tabs.filter(t => t.id !== id).map(t => t.id);
    await this.closeTabsSequential(ids);
  }

  showContextMenu(tabId, x, y) {
    if (!this.contextMenu) return;
    const items = [
      { label: '保存', action: 'save' },
      { label: '关闭当前标签页', action: 'close' },
      { label: '关闭右侧标签页', action: 'closeRight' },
      { label: '关闭其他标签页', action: 'closeOthers' }
    ];
    this.contextMenu.innerHTML = items.map(item => (
      `<div class="tab-context-item" data-action="${item.action}">${item.label}</div>`
    )).join('');
    this.contextMenu.style.display = 'block';
    const maxX = window.innerWidth - this.contextMenu.offsetWidth - 4;
    const maxY = window.innerHeight - this.contextMenu.offsetHeight - 4;
    this.contextMenu.style.left = `${Math.max(4, Math.min(x, maxX))}px`;
    this.contextMenu.style.top = `${Math.max(4, Math.min(y, maxY))}px`;
    this.contextMenu.querySelectorAll('.tab-context-item').forEach(item => {
      item.addEventListener('click', async () => {
        const action = item.dataset.action;
        this.hideContextMenu();
        if (action === 'save') {
          await this.editor.saveSpecificTab(tabId);
        } else if (action === 'close') {
          await this.closeTab(tabId);
        } else if (action === 'closeRight') {
          await this.closeTabsRight(tabId);
        } else if (action === 'closeOthers') {
          await this.closeTabsOthers(tabId);
        }
      });
    });
  }

  hideContextMenu() {
    if (!this.contextMenu) return;
    this.contextMenu.style.display = 'none';
    this.contextMenu.innerHTML = '';
  }

  /**
   * 将编辑器当前状态保存到标签页对象
   */
  saveEditorStateToTab(tab) {
    if (!tab) return;
    
    // 获取当前内容和模式
    tab.content = this.editor.getContent();
    tab.mode = this.editor.currentMode;
    // 可以在这里保存滚动位置等
  }

  /**
   * 将标签页对象状态恢复到编辑器
   */
  restoreEditorStateFromTab(tab) {
    if (!tab) return;

    // 恢复模式
    if (this.editor.currentMode !== tab.mode) {
      this.editor.switchMode(tab.mode, false); // false 表示不进行内容同步，因为我们要手动设置内容
    }

    // 恢复内容
    this.editor.setContent(tab.content, tab.mode);
    
    // 更新编辑器状态栏或其他 UI
    this.editor.updateStatusForTab(tab);
  }

  /**
   * 渲染标签页栏
   */
  renderTabs() {
    if (!this.container) return;

    this.container.innerHTML = '';
    
    this.tabs.forEach(tab => {
      const tabEl = document.createElement('div');
      tabEl.className = `tab-item ${tab.id === this.activeTabId ? 'active' : ''}`;
      tabEl.title = tab.filePath || tab.title;
      
      // 标题
      const titleSpan = document.createElement('span');
      titleSpan.className = 'tab-title';
      titleSpan.textContent = tab.title + (tab.isDirty ? ' *' : '');
      
      // 关闭按钮
      const closeBtn = document.createElement('div');
      closeBtn.className = 'tab-close';
      closeBtn.innerHTML = '<span class="material-icons" style="font-size: 14px;">close</span>';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // 阻止触发 tab 点击
        this.closeTab(tab.id);
      });

      tabEl.appendChild(titleSpan);
      tabEl.appendChild(closeBtn);
      
      // 点击切换
      tabEl.addEventListener('click', () => {
        this.activateTab(tab.id);
      });
      
      // 中键关闭
      tabEl.addEventListener('mouseup', (e) => {
        if (e.button === 1) { // Middle click
          this.closeTab(tab.id);
        }
      });

      tabEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showContextMenu(tab.id, e.clientX, e.clientY);
      });

      this.container.appendChild(tabEl);
    });
  }

  /**
   * 滚动到当前激活的标签页
   */
  scrollToActiveTab() {
    const activeEl = this.container.querySelector('.tab-item.active');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TabManager;
}
