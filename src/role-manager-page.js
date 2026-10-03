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
      const type = this.roleType.value;
      // 先把上一次的下拉收起来并显示加载态：本地发音人要向本机桥查询，若等结果回来再刷新，
      // 用户在这段时间里看到的仍是上一次的 EdgeTTS 列表（实测切换后最长约 3 秒）
      if (this._voicePanel) this._voicePanel.style.display = 'none';
      const wrap0 = document.getElementById('roleVoiceCustom');
      const faceInner = wrap0 && wrap0.querySelector('.rm-select-face-inner');
      if (faceInner) faceInner.textContent = '加载中…';
      if (this.roleVoice) this.roleVoice.innerHTML = '<option value="">加载中...</option>';
      if (type === 'local') await this.getLocalVoices();
      await this.populateVoices();
    };
    this.roleType.addEventListener('change', this._onTypeChange);
    // 预热本机合成常驻进程：等用户真正试听时就不必再等 PowerShell 启动
    window.electronAPI?.warmLocalTts?.();
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
    console.log('[动作] 保存角色配置，共', roles?.length || 0, '个角色');
    // 角色表变化后刷新所有朗读块头部属性显示（角色被删则显示回落）
    window.app?.renderer?.refreshSayRoleOptions?.();
  }

  // 语言标识：特殊地区/方言定制 + Intl.DisplayNames 自动生成（全语种覆盖）
  _localeLabel(v) {
    const SPECIAL = {
      'zh-CN': '中文（简体）', 'zh-TW': '中文（中国台湾）', 'zh-HK': '中文（中国香港）',
      'en-US': '英语（美式）', 'en-GB': '英语（英式）',
      'zh-CN-liaoning-XiaobeiNeural': '中文（辽宁话）',
      'zh-CN-shaanxi-XiaoniNeural': '中文（陕西话）'
    };
    if (SPECIAL[v]) return SPECIAL[v];
    try {
      const parts = v.split('-');
      if (!this._dnLang) {
        this._dnLang = new Intl.DisplayNames(['zh-CN'], { type: 'language' });
        this._dnRegion = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
      }
      const lang = this._dnLang.of(parts[0]);
      if (!lang) return '';
      // Chromium 对个别语言码无中文名，手动补
      const langName = parts[0] === 'iu' ? '因纽特语' : lang;
      // 三段码（方言口音如 zh-CN-liaoning）地区字段非法时退回纯语言名
      let region = '';
      if (parts[1]) {
        try { region = this._dnRegion.of(parts[1]) || ''; } catch { region = ''; }
      }
      // 港澳台地区名统一规范：Intl 会输出「台湾/香港/澳门」，一律加「中国」前缀
      const REGION_FIX = { TW: '中国台湾', HK: '中国香港', MO: '中国澳门' };
      const REGION_NAME_FIX = { '台湾': '中国台湾', '香港': '中国香港', '澳门': '中国澳门' };
      if (REGION_FIX[parts[1]]) region = REGION_FIX[parts[1]];
      else if (REGION_NAME_FIX[region]) region = REGION_NAME_FIX[region];
      return region ? `${langName}（${region}）` : langName;
    } catch { return ''; }
  }

  _voiceText(v, locale, gender) {
    const label = this._localeLabel(locale || v);
    const genderText = gender === 'Female' ? '女声' : (gender === 'Male' ? '男声' : '');
    const head = label ? `${label} · ${v}` : v;
    return genderText ? `${head} · ${genderText}` : head;
  }

  // 语言归类：中文（含港澳台及方言） → 英语（美式/英式靠前） → 日/俄/西 → 其他语言
  _voiceGroupIndex(locale) {
    const s = String(locale || '');
    if (/^zh/i.test(s)) return 0;
    if (/^en/i.test(s)) return 1;
    return /^(ja|ru|es)/i.test(s) ? 2 : 3;
  }

  _sortVoiceDescs(voices) {
    const enRank = (locale) => /^en-US/i.test(locale) ? 0 : /^en-GB/i.test(locale) ? 1 : 2;
    return [...voices].sort((a, b) =>
      this._voiceGroupIndex(a.locale) - this._voiceGroupIndex(b.locale)
      || enRank(a.locale) - enRank(b.locale)
      || String(a.locale || '').localeCompare(String(b.locale || ''))
      || String(a.value).localeCompare(String(b.value)));
  }

  // 自定义发音人下拉：分组 + 语言标识 + 收起状态跑马灯；面板挂 body 级 fixed 定位可伸出对话框
  // voices 为描述对象数组：[{ value, locale, gender }]（EdgeTTS 与系统 TTS 共用同一套交互）
  _buildVoiceDropdown(voices, selected, emptyHint) {
    let wrap = document.getElementById('roleVoiceCustom');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'roleVoiceCustom';
      wrap.className = 'rm-select';
      this.roleVoice.parentNode.insertBefore(wrap, this.roleVoice.nextSibling);
    }
    // 面板重建（挂 body，突破对话框 overflow 限制）
    if (this._voicePanel) this._voicePanel.remove();
    const panel = document.createElement('div');
    panel.className = 'rm-select-panel rm-select-panel-fixed';
    panel.style.display = 'none';
    document.body.appendChild(panel);
    this._voicePanel = panel;

    const groupNames = ['中文', '英语', '日语 / 俄语 / 西班牙语', '其他语言'];
    const list = this._sortVoiceDescs(voices);

    // 加载失败/为空：占位 + 点击重试
    if (!list.length) {
      const hint = emptyHint || '未获取到发音人，点击重试加载';
      wrap.innerHTML = `
        <div class="rm-select-face rm-select-face-retry" id="roleVoiceFace" title="${this.escapeHtml(hint)}">
          <span class="rm-select-face-text"><span class="rm-select-face-inner" style="color:var(--md-on-surface-variant);">${this.escapeHtml(hint)}</span></span>
          <span class="material-icons">refresh</span>
        </div>`;
      wrap.querySelector('#roleVoiceFace').addEventListener('click', (e) => {
        e.stopPropagation();
        wrap.querySelector('.rm-select-face-inner').textContent = '加载中…';
        this.populateVoices(this.roleVoice.value || '');
      });
      return;
    }

    const textOf = new Map(list.map(d => [d.value, this._voiceText(d.value, d.locale, d.gender)]));
    let panelHtml = '';
    let lastGroup = -1;
    for (const d of list) {
      const g = this._voiceGroupIndex(d.locale);
      if (g !== lastGroup) { panelHtml += `<div class="rm-select-group">${groupNames[g]}</div>`; lastGroup = g; }
      panelHtml += `<div class="rm-select-item${d.value === selected ? ' active' : ''}" data-v="${this.escapeHtml(d.value)}">${this.escapeHtml(textOf.get(d.value))}</div>`;
    }
    wrap.innerHTML = `
      <div class="rm-select-face" id="roleVoiceFace">
        <span class="rm-select-face-text"><span class="rm-select-face-inner">${this.escapeHtml(textOf.get(selected) || this._voiceText(selected))}</span></span>
        <span class="material-icons">arrow_drop_down</span>
      </div>
    `;
    panel.innerHTML = panelHtml;

    const face = wrap.querySelector('#roleVoiceFace');
    const closePanel = () => { panel.style.display = 'none'; };
    const openPanel = () => {
      const r = face.getBoundingClientRect();
      const margin = 8;
      const spaceBelow = window.innerHeight - r.bottom - margin;
      const spaceAbove = r.top - margin;
      panel.style.left = `${r.left}px`;
      panel.style.width = `${r.width}px`;
      // 下方空间够就向下展开，不够且上方更大就向上翻
      if (spaceBelow >= 220 || spaceBelow >= spaceAbove) {
        panel.style.top = `${r.bottom + 4}px`;
        panel.style.bottom = 'auto';
        panel.style.maxHeight = `${Math.min(300, Math.max(120, spaceBelow))}px`;
      } else {
        panel.style.bottom = `${window.innerHeight - r.top + 4}px`;
        panel.style.top = 'auto';
        panel.style.maxHeight = `${Math.min(300, Math.max(120, spaceAbove))}px`;
      }
      panel.style.display = 'block';
    };
    face.addEventListener('click', (e) => {
      e.stopPropagation();
      if (panel.style.display === 'none') openPanel(); else closePanel();
    });
    if (!this._voiceDocBound) {
      this._voiceDocBound = true;
      document.addEventListener('click', (e) => {
        if (this._voicePanel && this._voicePanel.style.display !== 'none'
          && !this._voicePanel.contains(e.target)
          && !document.getElementById('roleVoiceFace')?.contains(e.target)) {
          this._voicePanel.style.display = 'none';
        }
      });
      // 角色管理器关闭时同时收起面板
      const dlg = document.getElementById('roleManagerDialog');
      if (dlg) new MutationObserver(() => {
        if (!dlg.classList.contains('active') && this._voicePanel) this._voicePanel.style.display = 'none';
      }).observe(dlg, { attributes: true, attributeFilter: ['class'] });
    }
    panel.querySelectorAll('.rm-select-item').forEach(item => {
      item.addEventListener('click', () => {
        const v = item.dataset.v;
        this.roleVoice.value = v;
        wrap.querySelector('.rm-select-face-inner').textContent = textOf.get(v) || this._voiceText(v);
        panel.querySelectorAll('.rm-select-item').forEach(i => i.classList.toggle('active', i === item));
        closePanel();
        this._updateFaceMarquee(wrap);
      });
    });
    this._updateFaceMarquee(wrap);
  }

  _updateFaceMarquee(wrap) {
    const outer = wrap.querySelector('.rm-select-face-text');
    const inner = wrap.querySelector('.rm-select-face-inner');
    if (!outer || !inner) return;
    outer.classList.remove('rm-marquee');
    inner.style.removeProperty('--rm-shift');
    requestAnimationFrame(() => {
      const shift = inner.scrollWidth - outer.clientWidth;
      if (shift > 2) {
        inner.style.setProperty('--rm-shift', `-${shift}px`);
        outer.classList.add('rm-marquee');
      }
    });
  }

  async getLocalVoices() {
    // 统一走 app：合并 Chromium 可见音色与本机全部 SAPI5 音色（含自然音色）
    if (window.app?.getAllLocalVoices) {
      try {
        const merged = await window.app.getAllLocalVoices();
        if (merged.length) return merged;
      } catch { /* 回退到 Chromium 列表 */ }
    }
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
    const wrap0 = document.getElementById('roleVoiceCustom');
    if (this._voicePanel) this._voicePanel.style.display = 'none';
    this.roleVoice.innerHTML = '<option value="">加载中...</option>';

    // macOS/Linux 明确禁用系统 TTS：不提供本地发音人列表
    if (type === 'local' && this.disableLocalTts) {
      if (wrap0) wrap0.style.display = 'none';
      this.roleVoice.style.display = '';
      this.roleVoice.innerHTML = '<option value="">当前平台禁用系统TTS</option>';
      return;
    }

    // 两种类型都用自定义下拉（语言标识 + 分组 + 跑马灯），原生 select 隐藏仅作数据容器
    if (wrap0) wrap0.style.display = '';
    this.roleVoice.style.display = 'none';

    if (type === 'edge' && window.electronAPI?.listEdgeVoices) {
      const res = await window.electronAPI.listEdgeVoices();
      const voices = res?.voices || [];
      // 选中：编辑已有角色保持其音色；新建默认英文 Jenny，都没有退列表首位
      const selected = (preserveVoice && voices.includes(preserveVoice))
        ? preserveVoice
        : (voices.includes('en-US-JennyNeural') ? 'en-US-JennyNeural' : (voices[0] || ''));
      this.roleVoice.innerHTML = voices.map(v => `<option value="${this.escapeHtml(v)}">${this.escapeHtml(v)}</option>`).join('');
      this.roleVoice.value = selected;
      // Edge 音色名自带地区码（如 zh-CN-XiaoxiaoNeural），语言标识可由名字推导
      this._buildVoiceDropdown(voices.map(v => ({ value: v, locale: v })), selected, '未获取到 EdgeTTS 发音人，点击重试加载');
      return;
    }

    const voices = await this.getLocalVoices();
    const descs = this._sortVoiceDescs(voices.map(v => ({ value: v.name, locale: v.lang || v.name, gender: v.gender || '' })));
    // 选中：编辑已有角色保持其音色；新建取排序首位（中文在前，避免默认英语音色读中文只得到空音频）
    const selected = (preserveVoice && descs.some(d => d.value === preserveVoice))
      ? preserveVoice
      : (descs[0]?.value || '');
    this.roleVoice.innerHTML = descs.length
      ? descs.map(d => `<option value="${this.escapeHtml(d.value)}">${this.escapeHtml(d.value)}</option>`).join('')
      : '<option value="">未获取到本地发音人</option>';
    this.roleVoice.value = selected;
    this._buildVoiceDropdown(descs, selected, '未获取到本地发音人，点击重试加载');
  }

  async renderRoles() {
    // 角色与代码中的 <role> 标签全镜像同步，不再区分来源
    const allRoles = await this.getRoles();
    const total = allRoles.length;

    let html = '';

    if (!total) {
      html += '<div class="effect-empty">尚未添加角色。可通过此界面添加，或在代码中使用 &lt;role&gt; 标签定义。</div>';
    } else {
      html += allRoles.map((role) => {
        return `<div class="rm-list-item" data-id="${this.escapeHtml(role.id)}">
          <div>
            <div><strong>${this.escapeHtml(role.name)}</strong> (${this.escapeHtml(role.id)})</div>
            <div class="rm-meta">${role.type === 'local' ? '系统TTS' : 'EdgeTTS'} · ${this.escapeHtml(role.voice || '未设置')}</div>
          </div>
          <div class="rm-actions"><button class="btn btn-ghost" data-action="edit" data-id="${this.escapeHtml(role.id)}">编辑</button><button class="btn btn-danger" data-action="delete" data-id="${this.escapeHtml(role.id)}">删除</button></div>
        </div>`;
      }).join('');
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

    const roles = await this.getRoles();
    const payload = { id, name, type, voice };
    const idx = roles.findIndex(r => r.id === id);

    if (idx >= 0) roles[idx] = payload;
    else roles.push(payload);

    await this.setRoles(roles);
    await this.clearForm();
    await this.renderRoles();
  }

  escapeHtml(s) { return window.escapeHtml(s); }
}
