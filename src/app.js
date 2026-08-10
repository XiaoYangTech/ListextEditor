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

class ListextEditor {
  constructor() {
    this.initLogForwarding();
    this.parser = new ListextParser();
    this.renderer = null;
    this.ttsEngine = new TTSEngine();
    this.playQueue = new PlayQueue(this.ttsEngine, this.parser);
    this.currentMode = 'block';
    this._isSyncing = false;
    this._syncTimer = null;

    this.init();
    this.tabManager = new TabManager(this);
    this.authManager = new AuthManager();
    this.authManager.init();
    this.loadDefaultContent();
  }

  // 渲染进程日志转发到主进程统一落盘（含未捕获错误与 Promise 拒绝）
  initLogForwarding() {
    if (!window.electronAPI?.appendLog) return;
    const serialize = (a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'object' && a !== null) { try { return JSON.stringify(a); } catch { return String(a); } }
      return String(a);
    };
    for (const level of ['log', 'warn', 'error']) {
      const orig = console[level].bind(console);
      console[level] = (...args) => {
        orig(...args);
        try { window.electronAPI.appendLog(level, args.map(serialize)); } catch {}
      };
    }
    window.addEventListener('error', (e) => {
      try { window.electronAPI.appendLog('error', [`${e.message} @${e.filename}:${e.lineno}:${e.colno}`]); } catch {}
    });
    window.addEventListener('unhandledrejection', (e) => {
      try { window.electronAPI.appendLog('error', ['未处理的 Promise 拒绝:', serialize(e.reason)]); } catch {}
    });
  }

  init() {
    this.uiManager = new UIManager(this);
    this.initBlockRenderer();
    this.initCodeEditor();
    this.fileManager = new FileManager(this);
    this.exportHandler = new ExportHandler(window.electronAPI, (text) => this.updateStatus(text));
    this.ttsRenderer = new TTSRenderer(this, this.playQueue, this.parser);
    this.initElectronEvents();
    this.initHomePage();
  }

  initHomePage() {
    const el = document.getElementById('homePlatformInfo');
    if (!el) return;
    const api = window.electronAPI || {};
    const platformMap = { win32: 'Windows', darwin: 'macOS' };
    const os = platformMap[api.platform] || 'Linux';
    const arch = api.arch || 'x64';
    el.textContent = `${os} ${arch}`;
    api.getAppInfo?.().then(info => {
      if (info?.version) el.textContent = `v${info.version} · ${os} ${arch}`;
    }).catch(() => {});
  }

  initBlockRenderer() {
    this.renderer = new BlockRenderer(this.uiManager.blockContainer, this.parser);
    this._baseBlockChangeHandler = () => {
      // 播放中积木被编辑/移动/删除 → 停止播放，避免按旧结构继续出声
      if (this.playQueue?.isPlaying) this.ttsRenderer?.stopPlay();
      this.fileManager.markUnsaved();
      this.uiManager.refreshSectionJump();
    };
    this.renderer.onChange(this._baseBlockChangeHandler);
  }

  initCodeEditor() {
    this.codeEditor = new CodeEditor({
      codeEditor: document.getElementById('codeEditor'),
      lineNumbers: document.getElementById('lineNumbers'),
      codeHighlight: document.getElementById('codeHighlight'),
      codeSuggestions: document.getElementById('codeSuggestions'),
      errorContainer: document.getElementById('errorContainer')
    }, this.parser, {
      onInput: () => {
        this.fileManager.markUnsaved();
        this.syncCodeRolesToProject(this.codeEditor.getValue());
      }
    });
  }

  initElectronEvents() {
    if (!window.electronAPI) return;

    window.electronAPI.onMenuNew(() => this.fileManager.newFile());
    window.electronAPI.onMenuSave(() => {
      if (this.isHomeActive()) return;
      this.fileManager.saveFile();
    });
    window.electronAPI.onSaveAs(async (filePath) => {
      if (this.isHomeActive()) return;
      await this.fileManager.saveFileAs(filePath);
    });
    window.electronAPI.onMenuOpenProject(async (filePath) => {
      await this.fileManager.openProjectByPath(filePath);
    });

    window.electronAPI.onPreviewPlay(() => {
      if (this.isHomeActive()) return;
      this.ttsRenderer.previewPlay();
    });
    window.electronAPI.onStopPlay(() => this.ttsRenderer.stopPlay());
    window.electronAPI.onExportAudio(() => {
      if (this.isHomeActive()) return;
      this.exportHandler.showExportDialog();
    });

    window.electronAPI.onShowAbout(() => this.uiManager.showAboutDialog());
    window.electronAPI.onShowSettings(() => this.uiManager.showSettingsDialog());

    window.electronAPI.onMenuEdit(async (action) => {
      if (this.isTextInputActive()) {
        if (action === 'paste') {
          const text = await window.electronAPI?.pasteFromClipboard();
          if (text) {
            const el = document.activeElement;
            if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
              const start = el.selectionStart;
              const end = el.selectionEnd;
              el.value = el.value.slice(0, start) + text + el.value.slice(end);
              el.selectionStart = el.selectionEnd = start + text.length;
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
        } else {
          document.execCommand(action);
        }
        return;
      }
      if (this.isHomeActive()) return;
      this.handleEditAction(action);
    });

    window.electronAPI.onProjectEffectsChanged((effects) => {
      const tab = this.tabManager?.getActiveTab();
      if (tab) {
        const changed = JSON.stringify(tab.effects || []) !== JSON.stringify(effects || []);
        tab.effects = effects;
        if (changed) this.fileManager.markUnsaved();
      }
      if (this.codeEditor) {
        this.codeEditor.projectEffects = effects || [];
      }
    });

    window.electronAPI.onProjectRolesChanged((roles) => {
      const tab = this.tabManager?.getActiveTab();
      if (tab) {
        const changed = JSON.stringify(tab.roles || []) !== JSON.stringify(roles || []);
        tab.roles = roles;
        if (changed) this.fileManager.markUnsaved();
      }
      // 刷新朗读块头部属性显示（角色增删即时生效）
      this.renderer?.refreshSayRoleOptions?.();
      if (this.codeEditor) {
        this.codeEditor.projectRoles = roles || [];
        if (this.currentMode !== 'block') {
          const code = this.codeEditor.getValue();
          // 变化若源自代码编辑本身（代码已与角色列表一致），无需回写，避免重写标签/光标跳动
          const fromCode = this.parser.parseRoleDefsFromCode(code);
          if (JSON.stringify(fromCode) === JSON.stringify(roles || [])) return;
          // 角色管理器修改后回写代码（更新/删除/插入标签），再将代码结果同步回项目配置。
          this.syncRolesToCode(roles);
          this.syncCodeRolesToProject(this.codeEditor.getValue());
        } else if (tab) {
          // 积木模式：角色管理器是权威，按模型重建角色标签原文缓存
          tab.roleDefsRaw = (roles || []).filter(r => r?.id).map(r => this.buildRoleTag(r));
        }
      }
    });

    window.addEventListener('beforeunload', () => {
      if (window.app?.playQueue?.isPlaying) {
        window.app.playQueue.stop();
      }
    });

    window.electronAPI?.onRequestCloseCheck?.(() => this.handleCloseCheck());
  }

  async handleCloseCheck() {
    if (this.playQueue?.isPlaying) this.playQueue.stop();

    const unsavedTabs = this.tabManager?.tabs.filter(t => t.isDirty && !t.isHome) || [];
    if (!unsavedTabs.length) {
      window.electronAPI?.sendCloseCheckResult?.(true);
      return;
    }

    for (const tab of unsavedTabs) {
      const action = await this.showUnsavedDialog(tab.title);
      if (action === 'cancel') {
        window.electronAPI?.sendCloseCheckResult?.(false);
        return;
      }
      if (action === 'save') {
        const saved = await this.fileManager.saveSpecificTab(tab.id);
        if (!saved) {
          window.electronAPI?.sendCloseCheckResult?.(false);
          return;
        }
      }
    }

    window.electronAPI?.sendCloseCheckResult?.(true);
  }

  loadDefaultContent() {
    // Home tab is already created by TabManager, no need to create a new tab
  }

  getActiveProjectData() {
    const tab = this.tabManager?.getActiveTab();
    return {
      roles: tab?.roles || [],
      effects: tab?.effects || []
    };
  }

  updateActiveProjectData(data) {
    const tab = this.tabManager?.getActiveTab();
    if (tab) {
      if (data.roles) tab.roles = data.roles;
      if (data.effects) tab.effects = data.effects;
      this.fileManager.markUnsaved();
    }
  }

  switchMode(mode, sync = true) {
    if (mode !== 'block' && mode !== 'code' && mode !== 'split') return;
    if (mode === this.currentMode && sync) return;

    this.stopSplitSync();

    if (sync && this.currentMode !== mode) {
      // 从代码/分屏切到需要渲染积木的模式（积木/分屏）时，先体检代码；
      // 有错弹窗拦截并停留在当前模式，防止错误代码渲染出异常积木
      if (this.currentMode !== 'block' && mode !== 'code') {
        if (!this.showCodeErrorsDialog(this.codeEditor?.getValue() || '')) return;
      }
      try {
        if (this.currentMode === 'block') this.syncBlocksToCode();
        else if (this.currentMode === 'code') this.syncCodeToBlocks();
        else if (this.currentMode === 'split') {
          if (mode === 'code') { /* code already up to date */ }
          else if (mode === 'block') this.syncCodeToBlocks();
        }
      } catch (e) {
        console.warn('模式切换同步失败:', e);
        this.uiManager?.showInfoDialog?.('错误', '模式切换失败，请先修正语法后再切换');
        return;
      }
    }

    this.uiManager.updateModeUI(mode);
    this.currentMode = mode;
    console.log('[动作] 切换编辑模式:', mode);

    if (mode === 'block') {
      this.codeEditor.hideSuggestions();
      this.uiManager.refreshSectionJump();
      // 播放中切回积木模式：DOM 已整树重建，立即按结构路径恢复当前块高亮
      if (this.playQueue?.isPlaying) {
        const task = this.playQueue.queue[this.playQueue.currentIndex];
        if (task?.node) this.ttsRenderer?.highlightCurrentBlock(task.node, true, task);
      }
    } else if (mode === 'split') {
      this.codeEditor.hideSuggestions();
      this.uiManager.refreshSectionJump();
      this.refreshCodeContext();
      this.startSplitSync();
    } else {
      this.refreshCodeContext();
    }

    if (this.tabManager) {
      const activeTab = this.tabManager.getActiveTab();
      if (activeTab) activeTab.mode = mode;
    }
  }

  refreshCodeContext() {
    const projectData = this.getActiveProjectData();
    this.codeEditor.projectRoles = projectData.roles || [];
    this.codeEditor.projectEffects = projectData.effects || [];
    if (window.electronAPI) {
      const reqTabId = this.tabManager?.activeTabId;
      window.electronAPI.getProjectData().then(data => {
        if (this.tabManager?.activeTabId !== reqTabId) return;
        if (data?.effects) this.codeEditor.projectEffects = data.effects;
        if (data?.roles) this.codeEditor.projectRoles = data.roles;
      }).catch(() => {});
    }
    this.codeEditor.refreshView();
  }

  startSplitSync() {
    const baseHandler = this._baseBlockChangeHandler;
    this._splitBlockHandler = () => {
      if (this._isSyncing) return;
      clearTimeout(this._syncTimer);
      this._syncTimer = setTimeout(() => {
        this._isSyncing = true;
        try { this.syncBlocksToCode(); } catch (e) { console.error('split sync blocks→code failed:', e); }
        this._isSyncing = false;
      }, 200);
    };
    this.renderer.onChangeCallback = () => {
      if (baseHandler) baseHandler();
      this._splitBlockHandler();
    };

    this._splitCodeHandler = () => {
      if (this._isSyncing) return;
      clearTimeout(this._syncTimer);
      this._syncTimer = setTimeout(() => {
        this._isSyncing = true;
        try { this.syncCodeToBlocks(); } catch (e) { console.error('split sync code→blocks failed:', e); }
        this._isSyncing = false;
      }, 200);
    };
    this.codeEditor.editor.addEventListener('input', this._splitCodeHandler);
  }

  stopSplitSync() {
    clearTimeout(this._syncTimer);
    this._syncTimer = null;
    if (this._baseBlockChangeHandler) {
      this.renderer.onChangeCallback = this._baseBlockChangeHandler;
    }
    if (this._splitCodeHandler) {
      this.codeEditor.editor.removeEventListener('input', this._splitCodeHandler);
    }
    this._splitBlockHandler = null;
    this._splitCodeHandler = null;
  }

  syncBlocksToCode() {
    const ast = this.renderer.collectAST();
    const code = this.buildCodeWithRoles(this.parser.stringify(ast).trim());
    this.codeEditor.setValue(code);
    // setValue 不再触发 onInput，显式保持代码→模型角色全镜像（不标脏）
    this.syncCodeRolesToProject(code);
  }

  syncCodeToBlocks() {
    const code = this.codeEditor.getValue();
    // 捕获 <role> 标签原文缓存，积木↔代码往返时原样拼回（零丢码，重复定义的行也保留）
    const tab = this.tabManager?.getActiveTab();
    if (tab) tab.roleDefsRaw = this.extractRoleLines(code);
    const ast = this.parser.parse(code);
    this.renderer.render(ast);
    this.uiManager.refreshSectionJump();

    this.syncCodeRolesToProject(code);
  }

  // 代码 → 项目：全镜像，代码中的 <role> 标签集合即项目角色集合（删标签即删角色，清空即清空）
  syncCodeRolesToProject(code) {
    const tab = this.tabManager?.getActiveTab();
    if (!tab) return;
    const codeRoles = this.parser.parseRoleDefsFromCode(code || '');
    if (JSON.stringify(tab.roles || []) === JSON.stringify(codeRoles)) return;
    tab.roles = codeRoles;
    if (window.electronAPI) {
      window.electronAPI.setProjectRoles(tab.roles);
    }
  }

  // 项目 → 代码：更新已有标签、删除多余标签、为缺失角色在顶部插入标签
  syncRolesToCode(roles) {
    if (this.currentMode !== 'code' && this.currentMode !== 'split') return;
    const code = this.codeEditor?.getValue() || '';
    const roleMap = new Map((roles || []).filter(r => r?.id).map(r => [r.id, r]));
    const usedIds = new Set();

    let nextCode = code.replace(/<role\s+([^>]*)>/gi, (full, attrText) => {
      const id = attrText.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
      const role = id ? roleMap.get(id) : null;
      if (!role) return '';
      usedIds.add(id);
      return this.buildRoleTag(role);
    });

    const missing = (roles || []).filter(r => r?.id && !usedIds.has(r.id));
    if (missing.length) {
      nextCode = missing.map(role => this.buildRoleTag(role)).join('\n') + '\n' + nextCode;
    }

    if (nextCode !== code) this.codeEditor.setValue(nextCode);
  }

  buildRoleTag(role) {
    const attrs = [`id="${role.id || ''}"`, `name="${role.name || role.id || ''}"`];
    if (role.type) attrs.push(`type="${role.type}"`);
    if (role.voice) attrs.push(`voice="${role.voice}"`);
    return `<role ${attrs.join(' ')}>`;
  }

  // 为项目角色补齐代码中缺失的 <role> 标签（已有标签不动）
  ensureRoleTags(code) {
    const roles = this.tabManager?.getActiveTab()?.roles || [];
    if (!roles.length) return code;
    const existing = new Set(this.parser.parseRoleDefsFromCode(code).map(r => r.id));
    const missing = roles.filter(r => r?.id && !existing.has(r.id));
    if (!missing.length) return code;
    return missing.map(role => this.buildRoleTag(role)).join('\n') + '\n' + (code || '');
  }

  // 提取代码中的全部 <role> 标签（原文，按出现顺序）
  extractRoleLines(code) {
    if (!code) return [];
    return code.match(/<role\s+[^>]*>/gi) || [];
  }

  // 为不含角色行的正文补齐头部角色区：标签原文缓存优先，模型兜底补缺失（零丢码重建）
  buildCodeWithRoles(body) {
    const tab = this.tabManager?.getActiveTab();
    const raw = tab?.roleDefsRaw || [];
    const roles = tab?.roles || [];
    const coveredIds = new Set();
    for (const line of raw) {
      const id = line.match(/\bid\s*=\s*["']([^"']*)["']/i)?.[1];
      if (id) coveredIds.add(id);
    }
    const missing = roles.filter(r => r?.id && !coveredIds.has(r.id));
    const head = [...raw, ...missing.map(role => this.buildRoleTag(role))];
    if (!head.length) return body || '';
    return head.join('\n') + '\n' + (body || '');
  }

  // 角色专项前置检查（播放前调用）：重复定义 → 返回提示消息或 null（角色个数不再限制）
  preflightRoles() {
    const tab = this.tabManager?.getActiveTab();
    // 重复定义（代码/分屏读编辑器文本，积木读标签原文缓存）
    const roleSource = this.currentMode === 'block'
      ? (tab?.roleDefsRaw || []).join('\n')
      : (this.codeEditor?.getValue() || '');
    const seen = new Set();
    const dups = new Set();
    for (const m of roleSource.matchAll(/<role\s+[^>]*>/gi)) {
      const id = m[0].match(/\bid\s*=\s*["']([^"']*)["']/i)?.[1];
      if (!id) continue;
      if (seen.has(id)) dups.add(id); else seen.add(id);
    }
    if (dups.size) {
      return `角色 ${[...dups].map(id => `"${id}"`).join('、')} 重复定义。\n请删除重复的角色标签。`;
    }
    return null;
  }

  // 全量体检（全文播放/导出前调用）：语法+语义+角色，有问题弹窗列出并返回 false
  preflightCheck() {
    const code = this.currentMode === 'block'
      ? this.buildCodeWithRoles(this.parser.stringify(this.renderer.collectAST()).trim())
      : (this.codeEditor?.getValue() || '');
    return this.showCodeErrorsDialog(code);
  }

  // 校验代码并弹窗列出错误（模式切换拦截与播放/导出体检共用）；无错返回 true
  showCodeErrorsDialog(code) {
    const errors = this.codeEditor?.collectErrors(code) || [];
    if (!errors.length) return true;
    const list = errors.slice(0, 8).map(e => `第${e.line}行: ${e.message}`).join('\n');
    const more = errors.length > 8 ? `\n……共 ${errors.length} 个问题` : '';
    this.uiManager?.showInfoDialog?.('无法继续', `发现以下问题，请先修复：\n${list}${more}`);
    return false;
  }

  getContent() {
    if (this.currentMode === 'split' || this.currentMode === 'code') {
      return this.ensureRoleTags(this.codeEditor.getValue());
    }
    return this.buildCodeWithRoles(this.parser.stringify(this.renderer.collectAST()).trim());
  }

  setContent(content, mode = 'block') {
    const safeMode = mode === 'code' ? 'code' : 'block';
    const safeContent = typeof content === 'string' ? content : '';

    this.switchMode(safeMode, false);
    // 补齐项目角色缺失的 <role> 标签，避免全镜像同步把旧工程的角色清空
    const healedContent = this.ensureRoleTags(safeContent);
    // 捕获 <role> 标签原文缓存，供积木↔代码往返零丢码重建
    const tab = this.tabManager?.getActiveTab();
    if (tab) tab.roleDefsRaw = this.extractRoleLines(healedContent);
    this.codeEditor.setValue(healedContent);
    // setValue 不再触发 onInput，显式保持代码→模型角色全镜像（不标脏）
    this.syncCodeRolesToProject(healedContent);

    if (safeMode === 'block') {
      this.renderer.resetHistory();
      try {
        const ast = this.parser.parse(healedContent);
        this.renderer.render(ast);
      } catch (e) {
        console.warn('恢复积木内容失败:', e);
        this.renderer.clear();
      }
      this.uiManager.refreshSectionJump();
    }

    if (safeMode === 'code') {
      const projectData = this.getActiveProjectData();
      this.codeEditor.setProjectContext(projectData.roles, projectData.effects);
      this.codeEditor.refreshView();
    }

  }

  clearEditor() {
    this.setContent('', 'block');
  }

  showUnsavedDialog(title) { return this.uiManager.showUnsavedDialog(title); }
  saveSpecificTab(tabId) { return this.fileManager.saveSpecificTab(tabId); }
  updateStatusForTab(tab) { return this.fileManager.updateStatusForTab(tab); }

  updateStatus(text) {
    if (this.uiManager?.statusText) this.uiManager.statusText.textContent = text;
  }

  isTextInputActive() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'TEXTAREA' || tag === 'INPUT' || el.isContentEditable;
  }

  isHomeActive() {
    return this.tabManager?.getActiveTab()?.isHome === true;
  }

  handleEditAction(action) {
    if ((this.currentMode === 'block' || this.currentMode === 'split') && this.renderer && !this.isTextInputActive()) {
      if (action === 'undo') this.renderer.undo();
      if (action === 'redo') this.renderer.redo();
      if (action === 'copy') this.renderer.copySelectedBlocks();
      if (action === 'cut') this.renderer.cutSelectedBlocks();
      if (action === 'paste') this.renderer.pasteClipboard();
      if (action === 'selectAll') this.renderer.selectAllBlocks();
      if (['undo', 'redo', 'cut', 'paste'].includes(action)) this.fileManager.markUnsaved();
      return;
    }

    if (this.codeEditor) this.codeEditor.focus();
    const commandMap = { undo: 'undo', redo: 'redo', cut: 'cut', copy: 'copy', paste: 'paste', selectAll: 'selectAll' };
    const cmd = commandMap[action];
    if (cmd) document.execCommand(cmd);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new ListextEditor();
});
