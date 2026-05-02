class FileManager {
  constructor(app) {
    this.app = app;
    this.api = window.electronAPI;
  }

  newFile() {
    if (this.app.tabManager) {
      this.app.tabManager.createNewTab('untitled.lstx', '', null, true);
    }
  }

  async normalizeImportedRoles(roles) {
    const list = Array.isArray(roles) ? roles : [];
    const platform = this.api?.platform || 'win32';
    const edgeVoiceSet = new Set();

    try {
      const r = await this.api?.listEdgeVoices?.();
      (r?.voices || []).forEach(v => edgeVoiceSet.add(v));
    } catch {}

    const notes = [];
    const normalized = list.map(role => {
      const copy = { ...role };

      // Linux/macOS 默认禁用 local -> edge
      if ((platform === 'linux' || platform === 'darwin') && copy.type === 'local') {
        copy.type = 'edge';
        notes.push(`角色 ${copy.id || copy.name || 'unknown'} 已从系统TTS切换为EdgeTTS`);
      }

      if (copy.type === 'edge') {
        if (!copy.voice || (edgeVoiceSet.size > 0 && !edgeVoiceSet.has(copy.voice))) {
          const fallback = 'zh-CN-XiaoxiaoNeural';
          notes.push(`角色 ${copy.id || copy.name || 'unknown'} 语音缺失，已替换为 ${fallback}`);
          copy.voice = fallback;
        }
      }

      return copy;
    });

    return { roles: normalized, notes };
  }

  async openProjectByPath(filePath) {
    if (!filePath || !this.api?.openProjectFile) return false;
    const result = await this.api.openProjectFile(filePath);

    if (!result?.success) {
      this.app.updateStatus('打开失败: ' + (result?.error || '未知错误'));
      return false;
    }

    const normalized = await this.normalizeImportedRoles(result.roles || []);
    localStorage.setItem('listext_roles', JSON.stringify(normalized.roles));

    if (normalized.notes.length) {
      alert('导入提示：\n' + normalized.notes.join('\n'));
    }

    const title = result.title || filePath.split(/[/\\]/).pop();
    if (this.app.tabManager) {
      this.app.tabManager.createNewTab(title, result.content || '', filePath, true);
    }

    this.app.uiManager?.refreshSectionJump?.();
    this.app.updateStatus('项目已打开');
    return true;
  }

  async saveFile() {
    const tab = this.app.tabManager.getActiveTab();
    if (!tab) return false;

    if (tab.filePath) {
      return await this.saveFileAs(tab.filePath);
    }

    const filePath = await this.api?.selectProjectPath?.();
    if (!filePath) return false;
    return await this.saveFileAs(filePath);
  }

  async saveFileAs(filePath) {
    const tab = this.app.tabManager.getActiveTab();
    if (!tab) return false;

    const content = this.app.getContent();
    const roles = JSON.parse(localStorage.getItem('listext_roles') || '[]');
    const result = await this.api?.saveFile(filePath, content, { title: tab.title, roles });

    if (result?.success) {
      const finalPath = result.filePath || filePath;
      const fileName = finalPath.split(/[/\\]/).pop();
      this.app.tabManager.updateTab(tab.id, {
        filePath: finalPath,
        title: fileName,
        content,
        isDirty: false
      });

      this.updateStatusForTab(this.app.tabManager.getActiveTab());
      this.app.updateStatus(`已保存项目（打包 ${result.bundled || 0} 个音效）`);
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
    if (this.app.uiManager?.currentFileEl) this.app.uiManager.currentFileEl.textContent = `${name}${dirty}`;
    this.app.updateStatus(tab.isDirty ? '有未保存更改' : '就绪');
  }

  async saveSpecificTab(tabId) {
    const activeId = this.app.tabManager.activeTabId;
    if (activeId && activeId !== tabId) this.app.tabManager.activateTab(tabId);

    const ok = await this.saveFile();

    if (activeId && activeId !== tabId) this.app.tabManager.activateTab(activeId);

    if (!ok) return false;
    const tab = this.app.tabManager.tabs.find(t => t.id === tabId);
    return !!tab && !tab.isDirty;
  }
}
