class FileManager {
  constructor(app) {
    this.app = app;
    this.api = window.electronAPI;
  }

  newFile() {
    if (this.app.tabManager) {
      this.app.tabManager.createNewTab('未命名', '', null, true);
    }
  }

  openFile(content, filePath) {
    if (this.app.tabManager) {
      const fileName = filePath.split(/[/\\]/).pop();
      this.app.tabManager.createNewTab(fileName, content, filePath);
    }
  }

  async saveFile() {
    const tab = this.app.tabManager.getActiveTab();
    if (!tab) return;
    
    if (tab.filePath) {
      await this.saveFileAs(tab.filePath);
    } else {
      const filePath = await this.api?.selectListextPath();
      if (filePath) {
        await this.saveFileAs(filePath);
      }
    }
  }

  async saveFileAs(filePath) {
    const tab = this.app.tabManager.getActiveTab();
    if (!tab) return;
    
    // 获取当前最新内容
    const content = this.app.getContent();
    
    const result = await this.api?.saveFile(filePath, content);
    
    if (result?.success) {
      // 更新标签页状态
      const fileName = filePath.split(/[/\\]/).pop();
      this.app.tabManager.updateTab(tab.id, {
        filePath: filePath,
        title: fileName,
        content: content,
        isDirty: false
      });
      
      this.updateStatusForTab(this.app.tabManager.getActiveTab());
      this.app.statusText.textContent = '已保存';
      return true;
    } else {
      this.app.statusText.textContent = '保存失败: ' + (result?.error || '未知错误');
      return false;
    }
  }

  markUnsaved() {
    if (this.app.tabManager) {
      this.app.tabManager.markActiveTabDirty(true);
      this.updateStatusForTab(this.app.tabManager.getActiveTab());
    }
  }

  updateStatusForTab(tab) {
    if (!tab) return;
    
    const name = tab.filePath || '未保存';
    const dirty = tab.isDirty ? ' *' : '';
    if (this.app.currentFileEl) {
      this.app.currentFileEl.textContent = `${name}${dirty}`;
    }
    this.app.statusText.textContent = tab.isDirty ? '有未保存更改' : '就绪';
  }

  async saveSpecificTab(tabId) {
    const activeId = this.app.tabManager.activeTabId;
    if (activeId && activeId !== tabId) {
      this.app.tabManager.activateTab(tabId);
    }
    await this.saveFile();
    const tab = this.app.tabManager.getActiveTab();
    const saved = tab && !tab.isDirty;
    if (activeId && activeId !== tabId) {
      this.app.tabManager.activateTab(activeId);
    }
    return saved;
  }
}
