class RoleManagerPage {
  constructor() {
    this.roleList = document.getElementById('roleList');
    this.roleId = document.getElementById('roleId');
    this.roleName = document.getElementById('roleName');
    this.roleType = document.getElementById('roleType');
    this.roleVoice = document.getElementById('roleVoice');
    this.btnSave = document.getElementById('btnSave');
    this.btnClear = document.getElementById('btnClear');

    this.platform = window.electronAPI?.platform || '';
    this.disableLocalTts = this.platform === 'linux' || this.platform === 'darwin';

    this.bind();
    this.init();
  }

  _showError(msg) {
    window.app?.uiManager?.showInfoDialog?.('提示', msg);
  }

  bind() {
    this.roleType.removeEventListener('change', this._onTypeChange);
    this.btnSave.replaceWith(this.btnSave.cloneNode(true));
    this.btnClear.replaceWith(this.btnClear.cloneNode(true));
    this.roleType = document.getElementById('roleType');
    this.btnSave = document.getElementById('btnSave');
    this.btnClear = document.getElementById('btnClear');
    this.roleId = document.getElementById('roleId');
    this.roleName = document.getElementById('roleName');
    this.roleVoice = document.getElementById('roleVoice');
    this.roleList = document.getElementById('roleList');

    this._onTypeChange = async () => {
      if (this.roleType.value === 'local') await this.getLocalVoices();
      await this.populateVoices();
    };
    this.roleType.addEventListener('change', this._onTypeChange);
    this.btnSave.addEventListener('click', () => this.saveRole());
    this.btnClear.addEventListener('click', () => this.clearForm());
  }

  close() {
    document.getElementById('roleManagerDialog')?.classList.remove('active');
  }

  async init() {
    if (this.disableLocalTts) {
      const localOption = this.roleType.querySelector('option[value="local"]');
      if (localOption) localOption.disabled = true;
    }
    this.roleType.value = 'edge';
    await this.populateVoices();
    await this.renderRoles();
  }

  async getRoles() {
    if (window.electronAPI) {
      try { const data = await window.electronAPI.getProjectData(); return data?.roles || []; }
      catch { return []; }
    }
    return [];
  }

  async setRoles(roles) {
    if (window.electronAPI) await window.electronAPI.setProjectRoles(roles);
  }

  async getLocalVoices() {
    if (!('speechSynthesis' in window)) return [];
    try { speechSynthesis.getVoices(); } catch { /* ignored */ }
    return await new Promise(resolve => {
      let done = false;
      const finish = (voices) => { if (done) return; done = true; resolve(Array.from(voices || []).filter(v => v.localService)); };
      const immediate = speechSynthesis.getVoices();
      if (immediate.length) { finish(immediate); return; }
      const handler = () => { speechSynthesis.removeEventListener('voiceschanged', handler); finish(speechSynthesis.getVoices()); };
      speechSynthesis.addEventListener('voiceschanged', handler);
      setTimeout(() => finish(speechSynthesis.getVoices()), 3000);
    });
  }

  async populateVoices(preserveVoice = '') {
    const type = this.roleType.value;
    this.roleVoice.innerHTML = '<option value="">加载中...</option>';

    if (type === 'local' && this.disableLocalTts) {
      this.roleVoice.innerHTML = '<option value="">当前平台禁用系统TTS</option>';
      return;
    }

    if (type === 'edge' && window.electronAPI?.listEdgeVoices) {
      const res = await window.electronAPI.listEdgeVoices();
      let voices = res?.voices || [];
      const isUnlocked = window.entitlement?.isUnlocked();
      if (!isUnlocked) {
        voices = voices.filter(v => v.startsWith('zh-CN') || v.startsWith('en-US') || v === preserveVoice);
      }
      let html = voices.length
        ? voices.map(v => `<option value="${v}">${v}</option>`).join('')
        : '<option value="">未获取到 EdgeTTS 发音人</option>';
      if (!isUnlocked) {
        html += '<option disabled>── 以下30+语种需专业版 ──</option>';
        html += '<option value="" disabled>💎 升级专业版解锁日语/俄语/西班牙语等小语种</option>';
      }
      this.roleVoice.innerHTML = html;
      if (voices.length) this.roleVoice.value = voices[0];
      return;
    }

    const voices = await this.getLocalVoices();
    this.roleVoice.innerHTML = voices.length
      ? voices.map(v => `<option value="${v.name}">${v.name} (${v.lang})</option>`).join('')
      : '<option value="">未获取到本地发音人</option>';
  }

  async renderRoles() {
    // 代码定义角色由 syncCodeRolesToProject / 工程导入时打上 source:'code' 标记
    const allRoles = await this.getRoles();
    const uiRoles = allRoles.filter(r => r.source !== 'code');
    const codeRoles = allRoles.filter(r => r.source === 'code');
    const isUnlocked = window.entitlement?.isUnlocked();
    const isFreeDisplay = window.entitlement?.isFreeDisplay;
    const uiCount = uiRoles.length;
    const totalRoles = uiCount + codeRoles.length;
    const maxRoles = window.LISTEXT_CONSTANTS?.MAX_FREE_ROLES || 3;
    const siteUrl = window.LISTEXT_CONSTANTS?.API_BASE_URL || 'https://api.yfyw.top';
    const isOverLimit = !isUnlocked && uiCount > maxRoles;

    let html = '';

    if (!isUnlocked) {
      html += `<div class="rm-vip-bar">
        ${isFreeDisplay ? '🎉 全服限免中' : '📋 免费版'} · ${uiCount}/${maxRoles} 个角色已添加 · 共 ${totalRoles} 个
        <a href="#" class="rm-upgrade-link" onclick="window.electronAPI?.openExternal?.('${siteUrl}');return false">💎 升级专业版</a>
      </div>`;
      if (isOverLimit) {
        html += `<div class="rm-overlimit-warn">⚠️ 角色数(${uiCount})超过免费版限制(${maxRoles}个)。多余的角色仅可查看，无法编辑或添加新角色。</div>`;
      }
    }

    if (!uiRoles.length && !codeRoles.length) {
      html += '<div class="effect-empty">尚未添加角色。可通过此界面添加，或在代码中使用 &lt;role&gt; 标签定义。</div>';
    } else {
      if (codeRoles.length) {
        html += '<div style="margin-bottom:8px;font-size:12px;color:#757575;">代码中定义的角色（只读）</div>';
        html += codeRoles.map(role => `
          <div class="rm-list-item" data-id="${this.escapeHtml(role.id)}">
            <div>
              <div><strong>${this.escapeHtml(role.name)}</strong> (${this.escapeHtml(role.id)})<span class="rm-source-tag rm-source-code">代码定义</span></div>
              <div class="rm-meta">${role.type === 'local' ? '系统TTS' : 'EdgeTTS'} · ${this.escapeHtml(role.voice || '未设置')}</div>
            </div>
          </div>
        `).join('');
      }

      if (uiRoles.length) {
        if (codeRoles.length) html += '<div style="margin:12px 0 8px;font-size:12px;color:#757575;">手动添加的角色</div>';
        html += uiRoles.map((role, i) => {
          const overLimit = isOverLimit && i >= maxRoles;
          return `<div class="rm-list-item${overLimit ? ' rm-overlimit' : ''}" data-id="${this.escapeHtml(role.id)}">
            <div>
              <div><strong>${this.escapeHtml(role.name)}</strong> (${this.escapeHtml(role.id)})<span class="rm-source-tag rm-source-ui">手动添加</span>${overLimit ? '<span class="rm-source-tag rm-source-lock">🔒 超限</span>' : ''}</div>
              <div class="rm-meta">${role.type === 'edge' ? 'EdgeTTS' : '系统TTS'} · ${this.escapeHtml(role.voice || '未设置')}</div>
            </div>
            ${overLimit ? '' : `<div class="rm-actions"><button class="btn btn-ghost" data-action="edit" data-id="${this.escapeHtml(role.id)}">编辑</button><button class="btn btn-danger" data-action="delete" data-id="${this.escapeHtml(role.id)}">删除</button></div>`}
          </div>`;
        }).join('');
      }
    }

    this.roleList.innerHTML = html;

    this.roleList.querySelectorAll('button[data-action="edit"]').forEach(btn => btn.addEventListener('click', async () => await this.editRole(btn.dataset.id)));
    this.roleList.querySelectorAll('button[data-action="delete"]').forEach(btn => btn.addEventListener('click', async () => await this.deleteRole(btn.dataset.id)));
  }

  async editRole(id) {
    const roles = await this.getRoles();
    const role = roles.find(r => r.id === id);
    if (!role) return;
    this.roleId.value = role.id;
    this.roleName.value = role.name || '';
    this.roleType.value = role.type || 'edge';
    if (this.disableLocalTts && this.roleType.value === 'local') this.roleType.value = 'edge';
    await this.populateVoices(role.voice || '');
    this.roleVoice.value = role.voice || '';
  }

  async deleteRole(id) {
    const roles = (await this.getRoles()).filter(r => r.id !== id);
    await this.setRoles(roles);
    await this.renderRoles();
  }

  async clearForm() {
    this.roleId.value = '';
    this.roleName.value = '';
    this.roleType.value = 'edge';
    await this.populateVoices();
  }

  async saveRole() {
    const id = this.roleId.value.trim();
    const name = this.roleName.value.trim();
    const type = this.roleType.value;
    const voice = this.roleVoice.value.trim();

    if (!id || !name) {
      this._showError('请填写角色ID和角色名称');
      return;
    }

    if (type === 'local' && this.disableLocalTts) {
      this._showError('当前平台禁用系统TTS，请改为 EdgeTTS');
      return;
    }

    if (type === 'edge' && !window.entitlement?.isUnlocked()
        && voice && !voice.startsWith('zh-CN') && !voice.startsWith('en-US')) {
      window.entitlement?.showVipToast('小语种发音人');
      return;
    }

    const roles = await this.getRoles();
    const payload = { id, name, type, voice, source: 'ui' };
    const codeConflict = roles.find(r => r.id === id && r.source === 'code');
    if (codeConflict) {
      this._showError('角色ID与代码中定义的角色重复，请修改代码或使用其他ID');
      return;
    }
    const idx = roles.findIndex(r => r.id === id && r.source !== 'code');

    if (idx < 0) {
      const uiCount = roles.filter(r => r.source !== 'code').length;
      const maxRoles = window.LISTEXT_CONSTANTS?.MAX_FREE_ROLES || 3;
      if (!window.entitlement?.isUnlocked() && uiCount >= maxRoles) {
        window.entitlement?.showVipToast('无限角色个数');
        return;
      }
    }

    if (idx >= 0) roles[idx] = payload;
    else roles.push(payload);

    await this.setRoles(roles);
    await this.clearForm();
    await this.renderRoles();
  }

  escapeHtml(s) { return window.escapeHtml(s); }
}
