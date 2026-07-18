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

  bind() {
    this.roleType.addEventListener('change', async () => {
      if (this.roleType.value === 'local') {
        await this.getLocalVoices();
      }
      await this.populateVoices();
    });
    this.btnSave.addEventListener('click', () => this.saveRole());
    this.btnClear.addEventListener('click', () => this.clearForm());

    if (window.electronAPI?.onProjectRolesChanged) {
      window.electronAPI.onProjectRolesChanged(() => this.renderRoles());
    }

    document.getElementById('roleManagerClose')?.addEventListener('click', () => this.close());
  }

  close() {
    document.getElementById('roleManagerDialog')?.classList.remove('active');
  }

  async init() {
    if (this.disableLocalTts) {
      const localOption = this.roleType.querySelector('option[value="local"]');
      if (localOption) localOption.disabled = true;
      this.roleType.value = 'edge';
    }

    this.roleType.value = 'edge';
    await this.populateVoices();
    await this.renderRoles();
  }

  async getRoles() {
    if (window.electronAPI) {
      try {
        const data = await window.electronAPI.getProjectData();
        return data?.roles || [];
      } catch {
        return [];
      }
    }
    return [];
  }

  async setRoles(roles) {
    if (window.electronAPI) {
      await window.electronAPI.setProjectRoles(roles);
    }
  }

  getRolesFromCode(content) {
    const roles = [];
    const regex = /<role\s+([^>]+)\/?>/gi;
    let m;
    while ((m = regex.exec(content)) !== null) {
      const attrs = {};
      const attrRegex = /(\w+)=["']([^"']*)["']/g;
      let am;
      while ((am = attrRegex.exec(m[1])) !== null) {
        attrs[am[1]] = am[2];
      }
      if (attrs.id) {
        roles.push({
          id: attrs.id,
          name: attrs.name || attrs.id,
          type: attrs.type || 'edge',
          voice: attrs.voice || '',
          source: 'code'
        });
      }
    }
    return roles;
  }

  async getLocalVoices() {
    if (!('speechSynthesis' in window)) return [];
    try { speechSynthesis.getVoices(); } catch { /* ignored */ }
    return await new Promise(resolve => {
      let done = false;
      const finish = (voices) => {
        if (done) return;
        done = true;
        resolve(Array.from(voices || []));
      };
      const immediate = speechSynthesis.getVoices();
      if (immediate.length) { finish(immediate); return; }
      const handler = () => { speechSynthesis.removeEventListener('voiceschanged', handler); finish(speechSynthesis.getVoices()); };
      speechSynthesis.addEventListener('voiceschanged', handler);
      setTimeout(() => finish(speechSynthesis.getVoices()), 3000);
    });
  }

  async populateVoices() {
    const type = this.roleType.value;
    this.roleVoice.innerHTML = '<option value="">加载中...</option>';

    if (type === 'local' && this.disableLocalTts) {
      this.roleVoice.innerHTML = '<option value="">当前平台禁用系统TTS</option>';
      return;
    }

    if (type === 'edge' && window.electronAPI?.listEdgeVoices) {
      const res = await window.electronAPI.listEdgeVoices();
      const voices = res?.voices || [];
      this.roleVoice.innerHTML = voices.length
        ? voices.map(v => `<option value="${v}">${v}</option>`).join('')
        : '<option value="">未获取到 EdgeTTS 发音人</option>';
      return;
    }

    const voices = await this.getLocalVoices();
    this.roleVoice.innerHTML = voices.length
      ? voices.map(v => `<option value="${v.name}">${v.name} (${v.lang})</option>`).join('')
      : '<option value="">未获取到本地发音人</option>';
  }

  async renderRoles() {
    const uiRoles = (await this.getRoles()).filter(r => r.source !== 'code');

    let codeContent = '';
    try {
      const data = await window.electronAPI.getProjectData();
      codeContent = data?.content || '';
    } catch {}
    const codeRoles = this.getRolesFromCode(codeContent);

    if (!uiRoles.length && !codeRoles.length) {
      this.roleList.innerHTML = '<div class="empty">尚未添加角色。可通过此界面添加，或在代码中使用 &lt;role&gt; 标签定义。</div>';
      return;
    }

    let html = '';

    if (codeRoles.length) {
      html += '<div style="margin-bottom:8px;font-size:12px;color:#757575;">代码中定义的角色（只读）</div>';
      html += codeRoles.map(role => `
        <div class="rm-list-item" data-id="${role.id}">
          <div>
            <div><strong>${role.name}</strong> (${role.id})<span class="rm-source-tag rm-source-code">代码定义</span></div>
            <div class="rm-meta">${role.type === 'local' ? '系统TTS' : 'EdgeTTS'} · ${role.voice || '未设置'}</div>
          </div>
        </div>
      `).join('');
    }

    if (uiRoles.length) {
      if (codeRoles.length) html += '<div style="margin:12px 0 8px;font-size:12px;color:#757575;">手动添加的角色</div>';
      html += uiRoles.map(role => `
        <div class="rm-list-item" data-id="${role.id}">
          <div>
            <div><strong>${role.name}</strong> (${role.id})<span class="rm-source-tag rm-source-ui">手动添加</span></div>
            <div class="rm-meta">${role.type === 'edge' ? 'EdgeTTS' : '系统TTS'} · ${role.voice || '未设置'}</div>
          </div>
          <div class="rm-actions">
            <button class="btn btn-ghost" data-action="edit" data-id="${role.id}">编辑</button>
            <button class="btn btn-danger" data-action="delete" data-id="${role.id}">删除</button>
          </div>
        </div>
      `).join('');
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

    if (this.disableLocalTts && this.roleType.value === 'local') {
      this.roleType.value = 'edge';
    }

    await this.populateVoices();
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
    this.roleVoice.value = '';
  }

  async saveRole() {
    const id = this.roleId.value.trim();
    const name = this.roleName.value.trim();
    const type = this.roleType.value;
    const voice = this.roleVoice.value.trim();

    if (!id || !name) {
      alert('请填写角色ID和角色名称');
      return;
    }

    if (type === 'local' && this.disableLocalTts) {
      alert('当前平台禁用系统TTS，请改为 EdgeTTS');
      return;
    }

    const roles = await this.getRoles();
    const payload = { id, name, type, voice, source: 'ui' };
    const idx = roles.findIndex(r => r.id === id && r.source !== 'code');
    if (idx >= 0) roles[idx] = payload;
    else roles.push(payload);

    await this.setRoles(roles);
    await this.clearForm();
    await this.renderRoles();
  }
}
