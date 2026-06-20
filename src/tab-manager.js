class TabManager {
  constructor(editor) {
    this.editor = editor;
    this.tabs = [];
    this.activeTabId = null;

    this.container = document.getElementById('fileTabBar');
    this.newTabBtn = document.getElementById('btnNewTab');
    this.contextMenu = document.getElementById('tabContextMenu');

    this.init();
  }

  init() {
    if (this.newTabBtn) {
      this.newTabBtn.addEventListener('click', () => {
        this.createNewTab('', '', null, true);
      });
    }

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

  generateId() {
    return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  generateUntitledName() {
    const existing = this.tabs.filter(t => !t.filePath && t.title.match(/^untitled\d*\.lstx$/));
    return `untitled${existing.length + 1}.lstx`;
  }

  getActiveTab() {
    return this.tabs.find(t => t.id === this.activeTabId);
  }

  createNewTab(title = '', content = '', filePath = null, forceNew = false, projectData = null) {
    if (!forceNew && this.tabs.length === 1) {
      const current = this.tabs[0];
      if (!current.filePath && !current.isDirty && !current.content) {
        this.updateTab(current.id, {
          title: title || this.generateUntitledName(),
          content,
          filePath,
          isDirty: false,
          roles: projectData?.roles || [],
          effects: projectData?.effects || []
        });
        return current.id;
      }
    }

    let tabTitle = title || this.generateUntitledName();

    const tab = {
      id: this.generateId(),
      title: tabTitle,
      filePath,
      content: content || '',
      mode: 'block',
      isDirty: false,
      scrollPos: 0,
      roles: projectData?.roles || [],
      effects: projectData?.effects || []
    };

    this.tabs.push(tab);
    this.renderTabs();
    this.activateTab(tab.id);

    return tab.id;
  }

  updateTab(id, data) {
    const tab = this.tabs.find(t => t.id === id);
    if (tab) {
      Object.assign(tab, data);
      this.renderTabs();
    }
  }

  markActiveTabDirty(isDirty = true) {
    const tab = this.getActiveTab();
    if (tab && tab.isDirty !== isDirty) {
      tab.isDirty = isDirty;
      this.renderTabs();
    }
  }

  activateTab(id) {
    if (this.activeTabId === id) return;

    if (this.activeTabId) {
      const currentTab = this.tabs.find(t => t.id === this.activeTabId);
      if (currentTab) {
        this.saveEditorStateToTab(currentTab);
      }
    }

    this.activeTabId = id;

    const newTab = this.tabs.find(t => t.id === id);
    if (newTab) {
      this.restoreEditorStateFromTab(newTab);
    }

    this.renderTabs();
    this.scrollToActiveTab();
  }

  async closeTab(id) {
    const tab = this.tabs.find(t => t.id === id);
    if (!tab) return false;

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

    if (this.activeTabId === id) {
      if (this.tabs.length > 0) {
        const newIndex = Math.max(0, index - 1);
        this.activateTab(this.tabs[newIndex].id);
      } else {
        this.activeTabId = null;
        this.editor.clearEditor();
        this.createNewTab();
      }
    } else {
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

  saveEditorStateToTab(tab) {
    if (!tab) return;
    tab.content = this.editor.getContent();
    tab.mode = this.editor.currentMode;
  }

  restoreEditorStateFromTab(tab) {
    if (!tab) return;
    this.editor.setContent(tab.content || '', tab.mode || 'block');
    this.editor.updateStatusForTab(tab);
  }

  renderTabs() {
    if (!this.container) return;

    this.container.innerHTML = '';

    this.tabs.forEach(tab => {
      const tabEl = document.createElement('div');
      tabEl.className = `tab-item ${tab.id === this.activeTabId ? 'active' : ''}`;
      tabEl.title = tab.filePath || tab.title;

      const titleSpan = document.createElement('span');
      titleSpan.className = 'tab-title';
      titleSpan.textContent = tab.title + (tab.isDirty ? ' *' : '');

      const closeBtn = document.createElement('div');
      closeBtn.className = 'tab-close';
      closeBtn.innerHTML = '<span class="material-icons" style="font-size: 14px;">close</span>';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(tab.id);
      });

      tabEl.appendChild(titleSpan);
      tabEl.appendChild(closeBtn);

      tabEl.addEventListener('click', () => {
        this.activateTab(tab.id);
      });

      tabEl.addEventListener('mouseup', (e) => {
        if (e.button === 1) {
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

  scrollToActiveTab() {
    const activeEl = this.container.querySelector('.tab-item.active');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }
}
