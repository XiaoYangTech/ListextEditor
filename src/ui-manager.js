class UIManager {
  constructor(app) {
    this.app = app;
    this.initElements();
    this.initModeSwitcher();
    this.initToolbar();
    this.initDialogs();
    this.initKeyboardShortcuts();
  }

  initElements() {
    this.blockMode = document.getElementById('blockMode');
    this.codeMode = document.getElementById('codeMode');
    this.blockContainer = document.getElementById('blockContainer');
    this.statusText = document.getElementById('statusText');
    this.currentFileEl = document.getElementById('currentFile');
    
    // Dialog elements
    this.unsavedDialog = document.getElementById('unsavedDialog');
    this.unsavedDialogBody = document.getElementById('unsavedDialogBody');
    this.unsavedSaveBtn = document.getElementById('unsavedSave');
    this.unsavedDiscardBtn = document.getElementById('unsavedDiscard');
    this.unsavedCancelBtn = document.getElementById('unsavedCancel');
    
    this.noticeDialog = document.getElementById('noticeDialog');
    this.noticeContent = document.getElementById('noticeContent');
    this.noticeDismissToday = document.getElementById('noticeDismissToday');
    this.noticeCloseBtn = document.getElementById('noticeClose');
    this.noticeCloseTopBtn = document.getElementById('noticeCloseTop');
    this.noticeOpenUrlBtn = document.getElementById('noticeOpenUrl');
    
    this.settingsDialog = document.getElementById('settingsDialog');
    this.proxyModeSelect = document.getElementById('proxyModeSelect');
    this.proxyUrlInput = document.getElementById('proxyUrlInput');
    this.settingsSaveBtn = document.getElementById('settingsSave');
    this.settingsCancelBtn = document.getElementById('settingsCancel');
    this.settingsCloseTopBtn = document.getElementById('settingsCloseTop');
  }

  initModeSwitcher() {
    const tabs = document.querySelectorAll('.mode-tab');
    if (tabs && tabs.length) {
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          const mode = tab.dataset.mode;
          this.app.switchMode(mode);
        });
      });
    }
  }

  updateModeUI(mode) {
    document.querySelectorAll('.mode-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.mode === mode);
    });
    
    if (this.blockMode) this.blockMode.classList.toggle('active', mode === 'block');
    if (this.codeMode) this.codeMode.classList.toggle('active', mode === 'code');
  }

  initToolbar() {
    const addBtns = document.querySelectorAll('.add-block-btn');
    if (addBtns && addBtns.length) {
      addBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const type = btn.dataset.type;
          this.handleAddBlock(type);
        });
      });
    }
    const roleMgrBtn = document.getElementById('btnRoleManager');
    if (roleMgrBtn) {
      roleMgrBtn.addEventListener('click', () => {
        this.openRoleManager();
      });
    }
  }

  handleAddBlock(type) {
    if (this.app.currentMode !== 'block') {
      this.app.switchMode('block');
    }
    
    if (!this.app.renderer) return;

    if (type === 'pause') {
      this.showSilenceDialog((duration) => {
        this.app.renderer.addBlock('pause', { duration });
      });
    } else if (type === 'fx') {
      this.showEffectDialog((effectId, duration) => {
        this.app.renderer.addBlock('fx', { effectId, duration });
      });
    } else if (type === 'repeat') {
      this.app.renderer.addBlock('repeat');
    } else if (type === 'say') {
      const block = this.app.renderer.addBlock('say');
      const textarea = block.querySelector('textarea');
      if (textarea) textarea.focus();
    } else {
      this.app.renderer.addBlock(type);
    }
    
    this.app.fileManager.markUnsaved();
  }

  initDialogs() {
    this.initSilenceDialog();
    this.initEffectDialog();
    this.initUnsavedDialog();
    this.initRoleManagerDialog();
    this.initSyntaxHelpDialog();
    this.initNoticeDialog();
    this.initSettingsDialog();
  }

  initSilenceDialog() {
    const silenceDialog = document.getElementById('silenceDialog');
    const sDuration = document.getElementById('silenceDuration');
    const sConfirm = document.getElementById('silenceConfirm');
    
    if (silenceDialog) {
      const sClose = silenceDialog.querySelector('.dialog-close');
      if (sClose) sClose.addEventListener('click', () => silenceDialog.classList.remove('active'));
      const sCancel = silenceDialog.querySelector('.btn-cancel');
      if (sCancel) sCancel.addEventListener('click', () => silenceDialog.classList.remove('active'));
    }
    
    if (sConfirm) {
      const newConfirm = sConfirm.cloneNode(true);
      sConfirm.parentNode.replaceChild(newConfirm, sConfirm);
      
      newConfirm.addEventListener('click', () => {
        const duration = parseInt(sDuration?.value) || 1;
        if (this.silenceCallback) this.silenceCallback(duration);
        silenceDialog.classList.remove('active');
      });
    }
  }

  showSilenceDialog(callback) {
    this.silenceCallback = callback;
    const silenceDialog = document.getElementById('silenceDialog');
    const sDuration = document.getElementById('silenceDuration');
    if (sDuration) sDuration.value = 1;
    if (silenceDialog) silenceDialog.classList.add('active');
  }

  initEffectDialog() {
    const effectDialog = document.getElementById('effectDialog');
    const effectSelect = document.getElementById('effectSelect');
    const effectDuration = document.getElementById('effectDuration');
    const effectConfirm = document.getElementById('effectConfirm');
    
    if (effectDialog) {
      const eClose = effectDialog.querySelector('.dialog-close');
      if (eClose) eClose.addEventListener('click', () => effectDialog.classList.remove('active'));
      const eCancel = effectDialog.querySelector('.btn-cancel');
      if (eCancel) eCancel.addEventListener('click', () => effectDialog.classList.remove('active'));
    }
    
    if (effectConfirm) {
      const newConfirm = effectConfirm.cloneNode(true);
      effectConfirm.parentNode.replaceChild(newConfirm, effectConfirm);

      newConfirm.addEventListener('click', () => {
        const dur = effectDuration?.value ? parseInt(effectDuration.value) : null;
        if (this.effectCallback) this.effectCallback(effectSelect?.value, dur);
        effectDialog.classList.remove('active');
      });
    }
  }

  async showEffectDialog(callback) {
    this.effectCallback = callback;
    const effectDialog = document.getElementById('effectDialog');
    const effectSelect = document.getElementById('effectSelect');
    const effectDuration = document.getElementById('effectDuration');

    const effects = await window.electronAPI?.loadEffects() || {};
    if (effectSelect) {
      effectSelect.innerHTML = Object.keys(effects).length > 0
        ? Object.keys(effects).map(id => `<option value="${id}">${id}</option>`).join('')
        : '<option value="bell">bell (默认)</option>';
    }
    if (effectDuration) effectDuration.value = '';
    if (effectDialog) effectDialog.classList.add('active');
  }

  initUnsavedDialog() {
    if (this.unsavedDialog) {
      const closeBtn = this.unsavedDialog.querySelector('.dialog-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this.resolveUnsavedDialog('cancel'));
      }
      if (this.unsavedCancelBtn) {
        this.unsavedCancelBtn.addEventListener('click', () => this.resolveUnsavedDialog('cancel'));
      }
      if (this.unsavedDiscardBtn) {
        this.unsavedDiscardBtn.addEventListener('click', () => this.resolveUnsavedDialog('discard'));
      }
      if (this.unsavedSaveBtn) {
        this.unsavedSaveBtn.addEventListener('click', () => this.resolveUnsavedDialog('save'));
      }
    }
  }

  showUnsavedDialog(title) {
    if (!this.unsavedDialog) return Promise.resolve('cancel');
    this.unsavedDialogBody.textContent = `"${title}" 有未保存的更改`;
    this.unsavedDialog.classList.add('active');
    return new Promise(resolve => {
      this.unsavedDialogResolver = resolve;
    });
  }

  resolveUnsavedDialog(action) {
    if (!this.unsavedDialog) return;
    this.unsavedDialog.classList.remove('active');
    if (this.unsavedDialogResolver) {
      const resolver = this.unsavedDialogResolver;
      this.unsavedDialogResolver = null;
      resolver(action);
    }
  }

  initRoleManagerDialog() {
    const roleMgrDialog = document.getElementById('roleManagerDialog');
    if (roleMgrDialog) {
      this.initRoleManagerLogic(roleMgrDialog);
      
      const rClose = roleMgrDialog.querySelector('.dialog-close');
      if (rClose) rClose.addEventListener('click', () => roleMgrDialog.classList.remove('active'));
      
      const roleCancelBtn = document.getElementById('roleCancelBtn');
      if (roleCancelBtn) {
        roleCancelBtn.addEventListener('click', () => {
          roleMgrDialog.classList.remove('active');
        });
      }
    }
  }

  initRoleManagerLogic(roleMgrDialog) {
    const roleList = document.getElementById('roleList');
    const roleIdInput = document.getElementById('roleIdInput');
    const roleNameInput = document.getElementById('roleNameInput');
    const roleTypeSelect = document.getElementById('roleTypeSelect');
    const roleVoiceSelect = document.getElementById('roleVoiceSelect');
    const roleSaveBtn = document.getElementById('roleSaveBtn');
    
    const loadRoles = () => {
      const roles = JSON.parse(localStorage.getItem('listext_roles') || '[]');
      roleList.innerHTML = roles.length > 0
        ? roles.map(r => `<div class="role-item" data-id="${r.id}" style="display:flex;align-items:center;justify-content:space-between;border:1px solid var(--md-divider);border-radius:4px;padding:8px 12px;margin-bottom:8px">
          <div><strong>${r.name}</strong> <span style="opacity:0.7">(${r.id})</span> — ${r.type === 'edge' ? 'EdgeTTS' : '系统TTS'}: ${r.voice || ''}</div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-primary btn-edit-role" data-id="${r.id}" style="padding:4px 8px">编辑</button>
            <button class="btn btn-cancel btn-delete-role" data-id="${r.id}" style="padding:4px 8px">删除</button>
          </div>
        </div>`).join('')
        : '<div style="opacity:0.7">尚未添加角色</div>';
        
      roleList.querySelectorAll('.btn-delete-role').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const roles = JSON.parse(localStorage.getItem('listext_roles') || '[]');
          const next = roles.filter(x => x.id !== id);
          localStorage.setItem('listext_roles', JSON.stringify(next));
          loadRoles();
        });
      });
      
      roleList.querySelectorAll('.btn-edit-role').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const roles = JSON.parse(localStorage.getItem('listext_roles') || '[]');
          const r = roles.find(x => x.id === id);
          if (!r) return;
          roleIdInput.value = r.id;
          roleNameInput.value = r.name || '';
          roleTypeSelect.value = r.type || 'local';
          populateRoleVoices().then(() => {
            if (roleVoiceSelect) {
              roleVoiceSelect.value = r.voice || '';
            }
          });
        });
      });
    };
    
    const populateRoleVoices = async () => {
      const type = roleTypeSelect ? roleTypeSelect.value : 'local';
      if (!roleVoiceSelect) return;
      roleVoiceSelect.innerHTML = '<option value="">加载中...</option>';
      if (type === 'edge' && window.electronAPI) {
        const res = await window.electronAPI.listEdgeVoices();
        const voices = res?.voices || [];
        roleVoiceSelect.innerHTML = voices.length
          ? voices.map(v => `<option value="${v}">${v}</option>`).join('')
          : '<option value="">未获取到 EdgeTTS 发音人</option>';
      } else {
        const voices = speechSynthesis.getVoices();
        roleVoiceSelect.innerHTML = voices.length
          ? voices.map(v => `<option value="${v.name}">${v.name} (${v.lang})</option>`).join('')
          : '<option value="">未获取到系统TTS发音人</option>';
      }
    };
    
    if (roleTypeSelect) {
      roleTypeSelect.addEventListener('change', () => populateRoleVoices());
      setTimeout(populateRoleVoices, 1000); 
    }
    
    if (roleSaveBtn) roleSaveBtn.addEventListener('click', () => {
      const id = roleIdInput.value.trim();
      const name = roleNameInput.value.trim();
      const type = roleTypeSelect.value;
      const voice = roleVoiceSelect ? roleVoiceSelect.value.trim() : '';
      if (!id || !name) return;
      const roles = JSON.parse(localStorage.getItem('listext_roles') || '[]');
      const existingIndex = roles.findIndex(r => r.id === id);
      const payload = { id, name, type, voice };
      if (existingIndex >= 0) {
        roles[existingIndex] = payload;
      } else {
        roles.push(payload);
      }
      localStorage.setItem('listext_roles', JSON.stringify(roles));
      roleIdInput.value = '';
      roleNameInput.value = '';
      if (roleVoiceSelect) roleVoiceSelect.value = '';
      loadRoles();
    });

    this.loadRoles = loadRoles;
  }

  openRoleManager() {
    if (this.loadRoles) this.loadRoles();
    const roleMgrDialog = document.getElementById('roleManagerDialog');
    if (roleMgrDialog) roleMgrDialog.classList.add('active');
  }

  initSyntaxHelpDialog() {
    const syntaxHelpDialog = document.getElementById('syntaxHelpDialog');
    if (syntaxHelpDialog) {
      const hClose = syntaxHelpDialog.querySelector('.dialog-close');
      if (hClose) hClose.addEventListener('click', () => syntaxHelpDialog.classList.remove('active'));
    }
  }

  showSyntaxHelp() {
    const syntaxHelpDialog = document.getElementById('syntaxHelpDialog');
    if (syntaxHelpDialog) syntaxHelpDialog.classList.add('active');
  }

  initNoticeDialog() {
    if (this.noticeDialog) {
      if (this.noticeCloseTopBtn) this.noticeCloseTopBtn.addEventListener('click', () => this.closeNoticeDialog());
      if (this.noticeCloseBtn) this.noticeCloseBtn.addEventListener('click', () => this.closeNoticeDialog());
      if (this.noticeOpenUrlBtn) {
        this.noticeOpenUrlBtn.addEventListener('click', async () => {
          if (this.noticeUrl && window.electronAPI) {
            await window.electronAPI.openExternal(this.noticeUrl);
          }
        });
      }
    }
  }

  async checkNotice() {
    if (!window.electronAPI || !this.noticeDialog) return;
    const settings = await window.electronAPI.getSettings();
    const today = this.getTodayKey();
    if (settings?.noticeDismissDate === today) return;
    const res = await window.electronAPI.getNotice();
    if (!res?.success || !res.notice) return;
    this.noticeUrl = res.url || '';
    if (this.noticeContent) this.noticeContent.textContent = res.notice;
    if (this.noticeDismissToday) this.noticeDismissToday.checked = false;
    if (this.noticeOpenUrlBtn) {
      this.noticeOpenUrlBtn.style.display = this.noticeUrl ? 'inline-flex' : 'none';
    }
    this.noticeDialog.classList.add('active');
  }

  getTodayKey() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  async closeNoticeDialog() {
    if (!this.noticeDialog) return;
    this.noticeDialog.classList.remove('active');
    if (!window.electronAPI) return;
    if (this.noticeDismissToday && this.noticeDismissToday.checked) {
      const settings = await window.electronAPI.getSettings();
      await window.electronAPI.saveSettings({
        ...settings,
        noticeDismissDate: this.getTodayKey()
      });
    }
  }

  initSettingsDialog() {
    if (this.settingsDialog) {
      if (this.settingsCloseTopBtn) this.settingsCloseTopBtn.addEventListener('click', () => this.settingsDialog.classList.remove('active'));
      if (this.settingsCancelBtn) this.settingsCancelBtn.addEventListener('click', () => this.settingsDialog.classList.remove('active'));
      if (this.settingsSaveBtn) {
        this.settingsSaveBtn.addEventListener('click', async () => {
          if (!window.electronAPI) return;
          const proxyMode = this.proxyModeSelect ? this.proxyModeSelect.value : 'system';
          const proxyUrl = this.proxyUrlInput ? this.proxyUrlInput.value.trim() : '';
          const current = await window.electronAPI.getSettings();
          const result = await window.electronAPI.saveSettings({
            ...current,
            proxyMode,
            proxyUrl
          });
          if (result?.success) {
            this.app.updateStatus('设置已保存');
            this.settingsDialog.classList.remove('active');
          } else {
            this.app.updateStatus('设置保存失败');
          }
        });
      }
    }
  }

  async showSettingsDialog() {
    if (!this.settingsDialog || !window.electronAPI) return;
    const settings = await window.electronAPI.getSettings();
    if (this.proxyModeSelect) this.proxyModeSelect.value = settings?.proxyMode || 'system';
    if (this.proxyUrlInput) this.proxyUrlInput.value = settings?.proxyUrl || '';
    this.settingsDialog.classList.add('active');
  }

  initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const isMod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      
      // 积木模式快捷键
      if (this.app.currentMode === 'block' && this.app.renderer && !this.app.isTextInputActive()) {
        if (isMod) {
          if (key === 'z') {
            e.preventDefault();
            if (e.shiftKey) {
              this.app.renderer.redo();
            } else {
              this.app.renderer.undo();
            }
            this.app.fileManager.markUnsaved();
            return;
          }
          if (key === 'y') {
            e.preventDefault();
            this.app.renderer.redo();
            this.app.fileManager.markUnsaved();
            return;
          }
          if (key === 'c') {
            e.preventDefault();
            this.app.renderer.copySelectedBlocks();
            return;
          }
          if (key === 'x') {
            e.preventDefault();
            this.app.renderer.cutSelectedBlocks();
            this.app.fileManager.markUnsaved();
            return;
          }
          if (key === 'v') {
            e.preventDefault();
            this.app.renderer.pasteClipboard();
            this.app.fileManager.markUnsaved();
            return;
          }
          if (key === 'a') {
            e.preventDefault();
            this.app.renderer.selectAllBlocks();
            return;
          }
        } else if (key === 'delete' || key === 'backspace') {
          if (this.app.renderer.selectedBlocks && this.app.renderer.selectedBlocks.size > 0) {
            e.preventDefault();
            this.app.renderer.deleteSelectedBlocks();
            this.app.fileManager.markUnsaved();
            return;
          }
        }
      }
      
      // Ctrl+S 保存
      if (isMod && key === 's') {
        e.preventDefault();
        this.app.fileManager.saveFile();
      }
      
      // Escape 停止播放
      if (e.key === 'Escape') {
        this.app.ttsRenderer.stopPlay();
        document.querySelectorAll('.dialog.active').forEach(d => d.classList.remove('active'));
      }
      
      // F5 预览
      if (e.key === 'F5') {
        e.preventDefault();
        this.app.ttsRenderer.previewPlay();
      }
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = UIManager;
}
