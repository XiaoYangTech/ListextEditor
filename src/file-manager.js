class FileManager {
  constructor(app) {
    this.app = app;
    this.api = window.electronAPI;
  }

  newFile() {
    if (this.app.tabManager) {
      this.app.tabManager.createNewTab('', '', null, true);
      if (this.api) {
        this.api.setProjectEffects([]);
        this.api.setProjectRoles([]);
      }
    }
  }

  async normalizeImportedRoles(roles) {
    const list = Array.isArray(roles) ? roles : [];
    const platform = this.api?.platform || 'win32';
    const edgeVoiceSet = new Set();
    const localVoiceSet = new Set();

    try {
      const r = await this.api?.listEdgeVoices?.();
      (r?.voices || []).forEach(v => edgeVoiceSet.add(v));
    } catch {}

    if (platform === 'win32') {
      try {
        const localVoices = await this.getLocalVoices();
        localVoices.forEach(v => localVoiceSet.add(v.name));
      } catch {}
    }

    const notes = [];
    const needsPrompt = [];
    const normalized = list.map(role => {
      const copy = { ...role };

      if ((platform === 'linux' || platform === 'darwin') && copy.type === 'local') {
        copy.type = 'edge';
        notes.push(`角色 ${copy.id || copy.name || 'unknown'} 已从系统TTS切换为EdgeTTS`);
      }

      if (copy.type === 'edge') {
        if (!copy.voice || (edgeVoiceSet.size > 0 && !edgeVoiceSet.has(copy.voice))) {
          const fallback = 'zh-CN-XiaoxiaoNeural';
          notes.push(`角色 ${copy.id || copy.name || 'unknown'} EdgeTTS语音缺失，已替换为 ${fallback}`);
          copy.voice = fallback;
        }
      }

      if (copy.type === 'local' && platform === 'win32') {
        if (!copy.voice || (localVoiceSet.size > 0 && !localVoiceSet.has(copy.voice))) {
          needsPrompt.push(copy);
        }
      }

      return copy;
    });

    if (needsPrompt.length > 0) {
      const result = await this.showVoiceReplaceDialog(needsPrompt, edgeVoiceSet);
      if (result) {
        for (const [idx, replacement] of Object.entries(result)) {
          const i = parseInt(idx, 10);
          if (replacement === '__edge__') {
            normalized[i].type = 'edge';
            normalized[i].voice = normalized[i].voice || 'zh-CN-XiaoxiaoNeural';
            notes.push(`角色 ${normalized[i].id} 系统TTS语音不可用，已切换为EdgeTTS`);
          } else if (replacement === '__remove__') {
            normalized[i].type = 'edge';
            normalized[i].voice = 'zh-CN-XiaoxiaoNeural';
            notes.push(`角色 ${normalized[i].id} 系统TTS语音不可用，已切换为EdgeTTS默认语音`);
          } else if (replacement) {
            normalized[i].voice = replacement;
            notes.push(`角色 ${normalized[i].id} 语音已替换为 ${replacement}`);
          }
        }
      }
    }

    return { roles: normalized, notes };
  }

  getLocalVoices() {
    return new Promise(resolve => {
      if (!('speechSynthesis' in window)) { resolve([]); return; }
      try { speechSynthesis.getVoices(); } catch {}
      const finish = (voices) => resolve(Array.from(voices || []).filter(v => v.localService));
      const immediate = speechSynthesis.getVoices();
      if (immediate.length) { finish(immediate); return; }
      speechSynthesis.onvoiceschanged = () => finish(speechSynthesis.getVoices());
      setTimeout(() => finish(speechSynthesis.getVoices()), 3000);
    });
  }

  async showVoiceReplaceDialog(roles, edgeVoiceSet) {
    const edgeVoices = Array.from(edgeVoiceSet);
    const fallbackVoice = 'zh-CN-XiaoxiaoNeural';

    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'dialog active';
      overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;';

      const roleOptions = roles.map((role, i) => `
        <div style="margin-bottom:16px;padding:12px;background:#f5f5f5;border-radius:8px;">
          <div style="font-weight:500;margin-bottom:8px;">角色: ${role.name || role.id} (当前语音: ${role.voice || '未设置'})</div>
          <div style="font-size:12px;color:#757575;margin-bottom:8px;">该系统TTS语音在当前系统不可用，请选择替换方案：</div>
          <select id="voiceReplace_${i}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;">
            <option value="__edge__">切换为 EdgeTTS (${fallbackVoice})</option>
            ${edgeVoices.filter(v => v !== fallbackVoice).slice(0, 20).map(v => `<option value="${v}">${v}</option>`).join('')}
          </select>
        </div>
      `).join('');

      overlay.innerHTML = `
        <div style="background:white;border-radius:12px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.2);">
          <h3 style="margin:0 0 16px;font-size:16px;">角色语音替换</h3>
          <p style="font-size:13px;color:#666;margin:0 0 16px;">以下角色使用的系统TTS语音在当前系统不可用：</p>
          ${roleOptions}
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
            <button id="voiceReplaceCancel" style="padding:8px 16px;border:1px solid #ddd;border-radius:6px;background:white;cursor:pointer;">全部跳过</button>
            <button id="voiceReplaceConfirm" style="padding:8px 16px;border:none;border-radius:6px;background:#1976D2;color:white;cursor:pointer;">确认替换</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const cleanup = () => { overlay.remove(); };

      overlay.querySelector('#voiceReplaceCancel').addEventListener('click', () => {
        cleanup();
        resolve(null);
      });

      overlay.querySelector('#voiceReplaceConfirm').addEventListener('click', () => {
        const result = {};
        roles.forEach((role, i) => {
          const select = overlay.querySelector(`#voiceReplace_${i}`);
          if (select) result[i] = select.value;
        });
        cleanup();
        resolve(result);
      });

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { cleanup(); resolve(null); }
      });
    });
  }

  async openProjectByPath(filePath) {
    if (!filePath || !this.api?.openProjectFile) return false;
    const result = await this.api.openProjectFile(filePath);

    if (!result?.success) {
      this.app.updateStatus('打开失败: ' + (result?.error || '未知错误'));
      return false;
    }

    const normalized = await this.normalizeImportedRoles(result.roles || []);
    const effects = result.effects || [];

    const title = result.title || filePath.split(/[/\\]/).pop();
    if (this.app.tabManager) {
      this.app.tabManager.createNewTab(title, result.content || '', filePath, true, {
        roles: normalized.roles,
        effects: effects
      });
    }

    await this.api.setProjectEffects(effects);
    await this.api.setProjectRoles(normalized.roles);

    if (normalized.notes.length) {
      alert('导入提示：\n' + normalized.notes.join('\n'));
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
    const roles = tab.roles || [];
    const effects = tab.effects || [];
    const result = await this.api?.saveFile(filePath, content, {
      title: tab.title,
      roles,
      effects
    });

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
    if (window.electronAPI && typeof require !== 'undefined') {
      try {
        const { getCurrentWindow } = require('@electron/remote') || {};
        if (getCurrentWindow) getCurrentWindow().setTitle(`${name}${dirty} - 亿方听力大师`);
      } catch {}
    }
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
