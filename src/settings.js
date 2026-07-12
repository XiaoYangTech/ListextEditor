class SettingsManager {
  constructor() {
    this.currentPage = 'shortcuts';
    this.shortcuts = {};
    this.defaultShortcuts = window.SHORTCUT_DEFAULTS || {
      save: 'Ctrl+S', toggleMode: 'Ctrl+M', addBlock: 'Ctrl+N', deleteBlock: 'Delete',
      openEffects: 'Ctrl+Shift+E', previewPlay: 'F5', undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z',
      cut: 'Ctrl+X', copy: 'Ctrl+C', paste: 'Ctrl+V', selectAll: 'Ctrl+A',
      insertSay: 'Ctrl+1', insertPause: 'Ctrl+2', insertRepeat: 'Ctrl+3',
      insertSection: 'Ctrl+4', insertFx: 'Ctrl+5', insertDivider: 'Ctrl+6'
    };
    this.init();
  }

  async init() {
    this.bindNavigation();
    await this.loadAll();
    this.bindEvents();
  }

  bindNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const page = item.dataset.page;
        this.switchPage(page);
      });
    });
  }

  switchPage(page) {
    this.currentPage = page;
    
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });
    
    document.querySelectorAll('.settings-page').forEach(p => {
      p.classList.toggle('active', p.id === `${page}-page`);
    });
    
    const titles = {
      shortcuts: '快捷键',
      proxy: '网络代理'
    };
    document.getElementById('page-title').textContent = titles[page] || '';
  }

  async loadAll() {
    await Promise.all([
      this.loadShortcuts(),
      this.loadProxy()
    ]);
  }

  async loadShortcuts() {
    if (!window.electronAPI?.getShortcuts) {
      this.shortcuts = { ...this.defaultShortcuts };
      this.renderShortcuts();
      return;
    }
    
    const saved = await window.electronAPI.getShortcuts();
    this.shortcuts = { ...this.defaultShortcuts, ...saved };
    this.renderShortcuts();
  }

  renderShortcuts() {
    document.querySelectorAll('.shortcut-input').forEach(input => {
      const action = input.dataset.action;
      if (action && this.shortcuts[action]) {
        input.value = this.shortcuts[action];
      }
      this.bindShortcutInput(input);
    });
  }

  bindShortcutInput(input) {
    input.addEventListener('focus', () => {
      input.value = '';
      input.placeholder = '按下快捷键...';
      input.classList.add('editing');
    });

    input.addEventListener('blur', () => {
      input.classList.remove('editing');
      const action = input.dataset.action;
      if (!input.value && action && this.shortcuts[action]) {
        input.value = this.shortcuts[action];
      }
      input.placeholder = '按下快捷键';
    });

    input.addEventListener('keydown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const modifiers = [];
      if (e.ctrlKey) modifiers.push('Ctrl');
      if (e.altKey) modifiers.push('Alt');
      if (e.shiftKey) modifiers.push('Shift');
      if (e.metaKey) modifiers.push('Meta');

      let key = e.key;
      if (key.length === 1) key = key.toUpperCase();
      else if (key === ' ') key = 'Space';
      else if (key.startsWith('Arrow')) key = key.slice(5);
      else if (key === 'Escape') {
        input.blur();
        return;
      }

      // 忽略单独的修饰键
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        return;
      }

      const shortcut = modifiers.length > 0 ? `${modifiers.join('+')}+${key}` : key;
      input.value = shortcut;
      input.blur();

      const action = input.dataset.action;
      if (action) {
        this.shortcuts[action] = shortcut;
      }

      this.checkConflicts();
    });
  }

  checkConflicts() {
    const warning = document.getElementById('conflict-warning');
    const msg = document.getElementById('conflict-msg');
    const inputs = document.querySelectorAll('.shortcut-input');
    
    // 清除之前的冲突状态
    inputs.forEach(input => input.classList.remove('conflict'));
    
    // 检测冲突
    const shortcutMap = {};
    let hasConflict = false;

    inputs.forEach(input => {
      const shortcut = input.value;
      if (!shortcut) return;
      
      const action = input.dataset.action;
      if (shortcutMap[shortcut]) {
        hasConflict = true;
        input.classList.add('conflict');
        const prevInput = shortcutMap[shortcut].input;
        if (prevInput) prevInput.classList.add('conflict');
      } else {
        shortcutMap[shortcut] = { action, input };
      }
    });

    if (hasConflict) {
      warning.style.display = 'flex';
      msg.textContent = '检测到快捷键冲突，请修改后保存';
    } else {
      warning.style.display = 'none';
    }

    return !hasConflict;
  }

  async saveShortcuts() {
    if (!this.checkConflicts()) {
      this.setStatus('存在快捷键冲突，无法保存');
      return;
    }

    if (!window.electronAPI?.saveShortcuts) {
      this.setStatus('保存成功（本地）');
      return;
    }

    const result = await window.electronAPI.saveShortcuts(this.shortcuts);
    this.setStatus(result?.success ? '快捷键已保存' : '保存失败');
  }

  resetShortcuts() {
    this.shortcuts = { ...this.defaultShortcuts };
    this.renderShortcuts();
    const warning = document.getElementById('conflict-warning');
    warning.style.display = 'none';
    this.setStatus('已恢复默认快捷键');
  }

  async loadProxy() {
    if (!window.electronAPI?.getSettings) return;
    
    const settings = await window.electronAPI.getSettings();
    const proxyMode = document.getElementById('proxyMode');
    const proxyUrl = document.getElementById('proxyUrl');
    
    if (proxyMode) proxyMode.value = settings?.proxyMode || 'system';
    if (proxyUrl) proxyUrl.value = settings?.proxyUrl || '';
  }

  async saveProxy() {
    if (!window.electronAPI?.saveSettings) {
      this.setStatus('保存成功（本地）');
      return;
    }

    const current = await window.electronAPI.getSettings();
    const payload = {
      ...current,
      proxyMode: document.getElementById('proxyMode')?.value || 'system',
      proxyUrl: document.getElementById('proxyUrl')?.value.trim() || ''
    };
    
    const result = await window.electronAPI.saveSettings(payload);
    this.setStatus(result?.success ? '代理设置已保存' : '保存失败');
  }

  bindEvents() {
    document.getElementById('btnSaveShortcuts')?.addEventListener('click', () => this.saveShortcuts());
    document.getElementById('btnResetShortcuts')?.addEventListener('click', () => this.resetShortcuts());

    document.getElementById('btnSaveProxy')?.addEventListener('click', () => this.saveProxy());
    document.getElementById('btnReloadProxy')?.addEventListener('click', () => this.loadProxy());
  }

  setStatus(text) {
    const status = document.getElementById('status');
    if (status) status.textContent = text;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.settingsManager = new SettingsManager();
});
