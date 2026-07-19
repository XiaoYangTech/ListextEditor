class TabManager {
  constructor(editor) {
    this.editor = editor;
    this.tabs = [];
    this.activeTabId = null;
    this.homeTabId = null;

    this.container = document.getElementById('fileTabBar');
    this.newTabBtn = document.getElementById('btnNewTab');
    this.contextMenu = document.getElementById('tabContextMenu');
    this.homePage = document.getElementById('homePage');
    this.editorPanel = document.getElementById('editorPanel');
    this.blockMode = document.getElementById('blockMode');
    this.codeMode = document.getElementById('codeMode');
    this.toolbar = document.getElementById('sharedToolbar');

    this.init();
  }

  init() {
    this.createHomeTab();

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

    this.initHomePage();
  }

  createHomeTab() {
    const tab = { id: '__home__', title: '首页', isHome: true };
    this.tabs.push(tab);
    this.homeTabId = tab.id;
    this.activateTab(tab.id);
  }

  initHomePage() {
    const newBtn = document.getElementById('homeNewProject');
    if (newBtn) {
      newBtn.addEventListener('click', () => {
        this.createNewTab('', '', null, true);
      });
    }

    document.querySelectorAll('.home-nav-item').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.home-nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        const section = item.dataset.section;
        document.getElementById('homeDashboard').style.display = section === 'dashboard' ? '' : 'none';
        document.getElementById('homeAnnouncements').style.display = section === 'announcements' ? '' : 'none';
        document.getElementById('homeTemplates').style.display = section === 'templates' ? '' : 'none';
        if (section === 'announcements') this.loadAnnouncements();
        if (section === 'templates') this.loadRoutines();
      });
    });

    this.renderRecentProjects();
    this.applyBannerImage();
    this.loadBanners();
    this.loadAnnouncements();
    this.loadRoutines();
  }

  setBannerImage(url) {
    try { localStorage.setItem('bannerImage', url || ''); } catch (e) { console.error('保存横幅图片失败:', e); }
    this.applyBannerImage();
  }

  applyBannerImage() {
    const banner = document.getElementById('homeBanner');
    const placeholder = document.getElementById('homeBannerPlaceholder');
    if (!banner) return;
    const url = localStorage.getItem('bannerImage') || '';
    if (url) {
      banner.style.setProperty('--banner-image', `url(${url})`);
      if (placeholder) placeholder.style.display = 'none';
    } else {
      banner.style.setProperty('--banner-image', 'none');
      if (placeholder) placeholder.style.display = 'flex';
    }
  }

  async loadBanners() {
    if (!window.electronAPI?.fetchBanners) return;
    try {
      const list = await window.electronAPI.fetchBanners();
      if (list && list.length) {
        const banner = list[0]; // use first banner by order
        this.setBannerImage(banner.image_url || '');
      }
    } catch { /* offline or API error — keep placeholder */ }
  }

  async loadAnnouncements() {
    const el = document.getElementById('homeAnnounceList');
    if (!el) return;
    if (!window.electronAPI?.fetchAnnouncements) {
      el.innerHTML = '<div class="home-empty-hint">功能即将上线</div>';
      return;
    }
    try {
      const list = await window.electronAPI.fetchAnnouncements();
      if (!list || !list.length) {
        el.innerHTML = '<div class="home-empty-hint">暂无公告</div>';
        return;
      }
      el.innerHTML = list.map(a => {
        const date = a.created_at ? a.created_at.split(' ')[0] : '';
        if (a.kind === 'url' && a.content) {
          return `<div class="home-card"><div class="home-card-title">${a.title} <span style="font-size:11px;color:#999;font-weight:400">${date}</span></div><div class="home-card-body"><a href="#" onclick="window.electronAPI?.openExternal?.('${a.content.replace(/'/g, '\\\'')}');return false">查看详情 →</a></div></div>`;
        }
        return `<div class="home-card"><div class="home-card-title">${a.title} <span style="font-size:11px;color:#999;font-weight:400">${date}</span></div><div class="home-card-body">${a.content || ''}</div></div>`;
      }).join('');
    } catch {
      el.innerHTML = '<div class="home-empty-hint">加载失败，请检查网络</div>';
    }
  }

  async loadRoutines() {
    const el = document.getElementById('homeTemplateList');
    if (!el) return;
    if (!window.electronAPI?.fetchRoutines) {
      el.innerHTML = '<div class="home-empty-hint">功能即将上线</div>';
      return;
    }
    try {
      const list = await window.electronAPI.fetchRoutines();
      if (!list || !list.length) {
        el.innerHTML = '<div class="home-empty-hint">暂无例程模板</div>';
        return;
      }
      el.innerHTML = list.map(r => {
        const date = r.published_at || '';
        const downloadBtn = r.download_url
          ? `<a href="#" onclick="window.electronAPI.openExternal('${r.download_url}');return false" class="home-action-btn primary" style="display:inline-flex;margin-top:8px"><span class="material-icons" style="font-size:16px">download</span>下载</a>`
          : '';
        return `<div class="home-card"><div class="home-card-title">${r.title} <span style="font-size:11px;color:#999;font-weight:400">${date}</span></div><div class="home-card-body">${r.content || ''}<br>${downloadBtn}</div></div>`;
      }).join('');
    } catch {
      el.innerHTML = '<div class="home-empty-hint">加载失败，请检查网络</div>';
    }
  }

  recordRecentProject(filePath, title) {
    if (!filePath) return;
    try {
      let list = JSON.parse(localStorage.getItem('recentProjects') || '[]');
      list = list.filter(p => p.path !== filePath);
      list.unshift({ path: filePath, title: title || filePath.split(/[/\\]/).pop(), time: Date.now() });
      if (list.length > 20) list = list.slice(0, 20);
      localStorage.setItem('recentProjects', JSON.stringify(list));
      this.renderRecentProjects();
    } catch (e) { console.error('记录最近工程失败:', e); }
  }

  renderRecentProjects() {
    const el = document.getElementById('homeRecentList');
    if (!el) return;
    try {
      const list = JSON.parse(localStorage.getItem('recentProjects') || '[]');
      if (!list.length) {
        el.innerHTML = '<div class="home-empty-hint">暂无最近工程，点击「新建工程」开始创作</div>';
        return;
      }
      el.innerHTML = list.map(p => {
        const timeAgo = this.timeAgo(p.time);
        return `<div class="home-card" data-path="${this.escapeHtml(p.path)}">
          <button class="home-card-delete" data-path="${this.escapeHtml(p.path)}" title="从列表中移除"><span class="material-icons">close</span></button>
          <div class="home-card-body">
            <div class="home-card-title">${this.escapeHtml(p.title || '未命名')}</div>
            <div class="home-card-meta">${this.escapeHtml(p.path)} · ${timeAgo}</div>
          </div>
        </div>`;
      }).join('');

      // Click card body to open project
      el.querySelectorAll('.home-card-body').forEach(body => {
        body.addEventListener('click', (e) => {
          const path = e.target.closest('.home-card')?.dataset?.path;
          if (!path) return;
          this.openRecentProject(path);
        });
      });

      // Click delete button
      el.querySelectorAll('.home-card-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const path = btn.dataset.path;
          this.removeRecentProject(path);
        });
      });
    } catch (e) { console.error('渲染最近工程失败:', e); }
  }

  openRecentProject(filePath) {
    // If already open, switch to its tab
    const existing = this.tabs.find(t => t.filePath === filePath);
    if (existing) {
      this.activateTab(existing.id);
      return;
    }
    if (window.app?.fileManager) {
      window.app.fileManager.openProjectByPath(filePath);
    }
  }

  removeRecentProject(filePath) {
    const delCard = document.querySelector(`.home-card[data-path="${CSS.escape(filePath)}"]`);
    const delBtn = delCard?.querySelector('.home-card-delete');
    const msg = `要同时删除工程文件吗？\n\n「仅移除记录」：从列表中移除，保留文件\n「移除并删除」：从列表移除并永久删除文件\n\n${filePath}`;

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay confirm-dialog';
    overlay.innerHTML = `<div class="dialog-card" style="max-width:420px;">
      <div class="dialog-title">移除最近工程</div>
      <div class="dialog-body" style="white-space:pre-wrap;font-size:13px;color:#555;">${this.escapeHtml(msg)}</div>
      <div class="dialog-footer" style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-ghost" data-action="cancel">取消</button>
        <button class="btn btn-outline" data-action="record-only">仅移除记录</button>
        <button class="btn btn-danger" data-action="delete-file">移除并删除文件</button>
      </div>
    </div>`;

    const cleanup = () => { if (overlay.parentNode) overlay.remove(); };

    overlay.addEventListener('click', async (e) => {
      if (e.target === overlay) cleanup();
      const action = e.target.closest('[data-action]')?.dataset?.action;
      if (!action || action === 'cancel') { cleanup(); return; }

      try {
        let list = JSON.parse(localStorage.getItem('recentProjects') || '[]');
        list = list.filter(p => p.path !== filePath);
        localStorage.setItem('recentProjects', JSON.stringify(list));
      } catch (e) { console.error('读取最近工程失败:', e); }

      if (action === 'delete-file') {
        if (window.electronAPI?.deleteFile) {
          await window.electronAPI.deleteFile(filePath);
        }
        const tab = this.tabs.find(t => t.filePath === filePath);
        if (tab) {
          tab.isDirty = false;
          this.closeTab(tab.id);
        }
      }

      cleanup();
      this.renderRecentProjects();
    });

    document.body.appendChild(overlay);
  }

  timeAgo(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return `${Math.floor(diff / 86400000)} 天前`;
  }

  escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

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
    if (!forceNew && this.tabs.length === 2) {
      const current = this.tabs.find(t => !t.isHome);
      if (current && !current.filePath && !current.isDirty && !current.content) {
        this.updateTab(current.id, {
          title: title || this.generateUntitledName(),
          content,
          filePath,
          isDirty: false,
          roles: projectData?.roles || [],
          effects: projectData?.effects || []
        });
        this.activateTab(current.id);
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
      if (currentTab && !currentTab.isHome) {
        this.saveEditorStateToTab(currentTab);
      }
    }

    this.activeTabId = id;
    const newTab = this.tabs.find(t => t.id === id);

    if (newTab?.isHome) {
      this.showHomePage(true);
    } else {
      this.showHomePage(false);
      if (newTab) this.restoreEditorStateFromTab(newTab);
      window.getSelection()?.removeAllRanges();
      window.electronAPI?.sendTabContext?.(false);
    }

    this.renderTabs();
    this.scrollToActiveTab();
  }

  showHomePage(show) {
    if (this.homePage) this.homePage.style.display = show ? 'flex' : 'none';
    if (this.editorPanel) this.editorPanel.style.display = show ? 'none' : 'flex';
    if (show) {
      this.renderRecentProjects();
      window.electronAPI?.sendTabContext?.(true);
    }
  }

  async closeTab(id) {
    const tab = this.tabs.find(t => t.id === id);
    if (!tab) return false;
    if (tab.isHome) return false;

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

    if (tab.filePath && window.electronAPI?.releaseFileLock) {
      try { window.electronAPI.releaseFileLock(tab.filePath); } catch (e) { console.error('释放文件锁失败:', e); }
    }

    if (this.activeTabId === id) {
      if (this.tabs.length > 1) {
        const newIndex = Math.max(1, Math.min(index, this.tabs.length - 1));
        this.activateTab(this.tabs[newIndex].id);
      } else {
        this.activateTab(this.homeTabId);
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
    const ids = this.tabs.slice(index + 1).filter(t => !t.isHome).map(t => t.id);
    await this.closeTabsSequential(ids);
  }

  async closeTabsOthers(id) {
    const ids = this.tabs.filter(t => t.id !== id && !t.isHome).map(t => t.id);
    await this.closeTabsSequential(ids);
  }

  showContextMenu(tabId, x, y) {
    if (!this.contextMenu) return;
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab?.isHome) return;

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
    tab.roles = this.editor.codeEditor?.projectRoles || tab.roles || [];
    tab.effects = this.editor.codeEditor?.projectEffects || tab.effects || [];
  }

  restoreEditorStateFromTab(tab) {
    if (!tab) return;
    this.editor.setContent(tab.content || '', tab.mode || 'block');
    this.editor.updateStatusForTab(tab);
    if (this.editor.codeEditor) {
      this.editor.codeEditor.projectRoles = tab.roles || [];
      this.editor.codeEditor.projectEffects = tab.effects || [];
    }
  }

  renderTabs() {
    if (!this.container) return;

    this.container.innerHTML = '';

    this.tabs.forEach(tab => {
      const tabEl = document.createElement('div');
      tabEl.className = `tab-item ${tab.id === this.activeTabId ? 'active' : ''}`;
      tabEl.title = tab.isHome ? '首页' : (tab.filePath || tab.title);

      const titleSpan = document.createElement('span');
      titleSpan.className = 'tab-title';
      titleSpan.textContent = tab.isHome ? '首页' : (tab.title + (tab.isDirty ? ' *' : ''));

      tabEl.appendChild(titleSpan);

      if (!tab.isHome) {
        const closeBtn = document.createElement('div');
        closeBtn.className = 'tab-close';
        closeBtn.innerHTML = '<span class="material-icons" style="font-size: 14px;">close</span>';
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeTab(tab.id);
        });
        tabEl.appendChild(closeBtn);
      }

      tabEl.addEventListener('click', () => {
        this.activateTab(tab.id);
      });

      if (!tab.isHome) {
        tabEl.addEventListener('mouseup', (e) => {
          if (e.button === 1) this.closeTab(tab.id);
        });

        tabEl.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.showContextMenu(tab.id, e.clientX, e.clientY);
        });
      }

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
