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
    if (!tab) return false;

    const content = this.app.getContent();
    const result = await this.api?.saveFile(filePath, content);

    if (result?.success) {
      const fileName = filePath.split(/[/\\]/).pop();
      this.app.tabManager.updateTab(tab.id, {
        filePath,
        title: fileName,
        content,
        isDirty: false
      });

      this.updateStatusForTab(this.app.tabManager.getActiveTab());
      this.app.updateStatus('已保存');
      return true;
    }

    this.app.updateStatus('保存失败: ' + (result?.error || '未知错误'));
    return false;
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
    if (this.app.uiManager?.currentFileEl) {
      this.app.uiManager.currentFileEl.textContent = `${name}${dirty}`;
    }
    this.app.updateStatus(tab.isDirty ? '有未保存更改' : '就绪');
  }

  async saveSpecificTab(tabId) {
    const activeId = this.app.tabManager.activeTabId;
    if (activeId && activeId !== tabId) {
      this.app.tabManager.activateTab(tabId);
    }

    const ok = await this.saveFile();

    if (activeId && activeId !== tabId) {
      this.app.tabManager.activateTab(activeId);
    }

    if (!ok) return false;
    const tab = this.app.tabManager.tabs.find(t => t.id === tabId);
    return !!tab && !tab.isDirty;
  }
}
