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

class SettingsManager {
  constructor() {
    this.currentPage = 'shortcuts';
    this.shortcuts = {};
    this.defaultShortcuts = window.SHORTCUT_DEFAULTS || {};
    this.init();
  }

  async init() {
    this.bindNavigation();
    this.switchPage(this.currentPage);
    await this.loadAll();
    this.bindEvents();
    this.bindCachePage();
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
      layout: '布局',
      proxy: '网络代理',
      cache: '缓存管理'
    };
    document.getElementById('page-title').textContent = titles[page] || '';
    if (page === 'cache') this.loadCacheStats();
  }

  formatBytes(n) {
    if (!n || n <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let v = n, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  async loadCacheStats() {
    if (!window.electronAPI?.getCacheStats) return;
    try {
      const stats = await window.electronAPI.getCacheStats();
      const map = {
        cacheSizeLogs: stats.logs,
        cacheSizeTemp: stats.temp,
        cacheSizeProjectSounds: stats.projectSounds,
        cacheSizeImportedSounds: stats.importedSounds
      };
      for (const [id, size] of Object.entries(map)) {
        const el = document.getElementById(id);
        if (el) el.textContent = this.formatBytes(size);
      }
    } catch (e) { console.error('读取缓存统计失败:', e); }
  }

  bindCachePage() {
    const bindClear = (id, category) => {
      document.getElementById(id)?.addEventListener('click', async () => {
        if (!window.electronAPI?.clearCache) return;
        console.log('[动作] 清除缓存:', category);
        const res = await window.electronAPI.clearCache(category);
        if (!res?.success) console.error('清除缓存失败:', res?.error);
        this.loadCacheStats();
      });
    };
    bindClear('btnClearLogs', 'logs');
    bindClear('btnClearTemp', 'temp');
    bindClear('btnClearProjectSounds', 'projectSounds');
    // 素材库清除需二次确认：未保存/未引用的导入音效只有这一份
    document.getElementById('btnClearImportedSounds')?.addEventListener('click', async () => {
      if (!window.electronAPI?.clearCache) return;
      const ok = window.confirm(
        '确定清除导入的音效素材库吗？\n\n已保存工程中的自定义音效都已打进工程包（.lstx），不受影响；\n仅当前尚未保存工程里的导入音效将丢失。');
      if (!ok) return;
      console.log('[动作] 清除音效素材库');
      const res = await window.electronAPI.clearCache('importedSounds');
      if (!res?.success) console.error('清除素材库失败:', res?.error);
      this.loadCacheStats();
    });
    document.getElementById('btnOpenLogsDir')?.addEventListener('click', () => {
      window.electronAPI?.openLogsDir?.();
    });
  }

  async loadAll() {
    this.loadLayout();
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
    if (input._shortcutBound) return;
    input._shortcutBound = true;

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
    if (!this.checkConflicts()) return;

    if (!window.electronAPI?.saveShortcuts) return;

    await window.electronAPI.saveShortcuts(this.shortcuts);
  }

  resetShortcuts() {
    this.shortcuts = { ...this.defaultShortcuts };
    this.renderShortcuts();
    const warning = document.getElementById('conflict-warning');
    warning.style.display = 'none';
  }

  async loadProxy() {
    if (!window.electronAPI?.getSettings) return;
    
    const settings = await window.electronAPI.getSettings();
    const proxyMode = document.getElementById('proxyMode');
    const proxyUrl = document.getElementById('proxyUrl');
    
    if (proxyMode) proxyMode.value = settings?.proxyMode || 'system';
    if (proxyUrl) proxyUrl.value = settings?.proxyUrl || '';
    this.toggleProxyUrl();
  }

  async saveProxy() {
    if (!window.electronAPI?.saveSettings) return;

    const current = await window.electronAPI.getSettings();
    const payload = {
      ...current,
      proxyMode: document.getElementById('proxyMode')?.value || 'system',
      proxyUrl: document.getElementById('proxyUrl')?.value.trim() || ''
    };
    
    await window.electronAPI.saveSettings(payload);
  }

  loadLayout() {
    const saved = localStorage.getItem('toolbarAlign') || 'center';
    document.querySelectorAll('input[name="toolbarAlign"]').forEach(r => {
      r.checked = r.value === saved;
    });
  }

  bindEvents() {
    document.getElementById('btnSaveShortcuts')?.addEventListener('click', () => this.saveShortcuts());
    document.getElementById('btnResetShortcuts')?.addEventListener('click', () => this.resetShortcuts());

    document.getElementById('btnSaveProxy')?.addEventListener('click', () => this.saveProxy());
    document.getElementById('btnReloadProxy')?.addEventListener('click', () => this.loadProxy());

    document.getElementById('proxyMode')?.addEventListener('change', () => this.toggleProxyUrl());

    document.querySelectorAll('input[name="toolbarAlign"]').forEach(r => {
      r.addEventListener('change', () => {
        if (r.checked) {
          localStorage.setItem('toolbarAlign', r.value);
          if (window.electronAPI?.setToolbarAlign) {
            window.electronAPI.setToolbarAlign(r.value);
          }
        }
      });
    });
  }

  toggleProxyUrl() {
    const mode = document.getElementById('proxyMode')?.value;
    const group = document.getElementById('proxyUrlGroup');
    if (group) group.style.display = mode === 'manual' ? '' : 'none';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.settingsManager = new SettingsManager();
});
