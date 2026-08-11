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
    console.log('[动作] 保存角色配置，共', roles?.length || 0, '个角色');
    // 角色表变化后刷新所有朗读块头部属性显示（角色被删则显示回落）
    window.app?.renderer?.refreshSayRoleOptions?.();
  }

  // 语言标识：特殊地区/方言定制 + Intl.DisplayNames 自动生成（全语种覆盖）
  _localeLabel(v) {
    const SPECIAL = {
      'zh-CN': '中文（简体）', 'zh-TW': '中文（台湾）', 'zh-HK': '中文（香港）',
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
      return region ? `${langName}（${region}）` : langName;
    } catch { return ''; }
  }

  _voiceText(v) {
    const label = this._localeLabel(v);
    return label ? `${label} · ${v}` : v;
  }

  // 自定义发音人下拉：分组 + 语言标识 + 收起状态跑马灯；面板挂 body 级 fixed 定位可伸出对话框
  _buildVoiceDropdown(voices, selected) {
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

    const rank = (v) => v.startsWith('zh-') ? 0 : v.startsWith('en-') ? 1 : (/^(ja|ru|es)-/.test(v) ? 2 : 3);
    const groupNames = ['中文', '英语', '日语 / 俄语 / 西班牙语', '其他语言'];
    // 加载失败/为空：占位 + 点击重试
    if (!voices.length) {
      wrap.innerHTML = `
        <div class="rm-select-face rm-select-face-retry" id="roleVoiceFace" title="未获取到 EdgeTTS 发音人，点击重试">
          <span class="rm-select-face-text"><span class="rm-select-face-inner" style="color:var(--md-on-surface-variant);">未获取到发音人，点击重试加载</span></span>
          <span class="material-icons">refresh</span>
        </div>`;
      wrap.querySelector('#roleVoiceFace').addEventListener('click', (e) => {
        e.stopPropagation();
        wrap.querySelector('.rm-select-face-inner').textContent = '加载中…';
        this.populateVoices(this.roleVoice.value || '');
      });
      return;
    }
    let panelHtml = '';
    let lastRank = -1;
    for (const v of voices) {
      const r = rank(v);
      if (r !== lastRank) { panelHtml += `<div class="rm-select-group">${groupNames[r]}</div>`; lastRank = r; }
      panelHtml += `<div class="rm-select-item${v === selected ? ' active' : ''}" data-v="${v}">${this._voiceText(v)}</div>`;
    }
    wrap.innerHTML = `
      <div class="rm-select-face" id="roleVoiceFace">
        <span class="rm-select-face-text"><span class="rm-select-face-inner">${this._voiceText(selected)}</span></span>
        <span class="material-icons">arrow_drop_down</span>
      </div>
    `;
    panel.innerHTML = panelHtml || '<div class="rm-select-group">无可用发音人</div>';

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
        wrap.querySelector('.rm-select-face-inner').textContent = this._voiceText(v);
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
    // Edge 用自定义下拉，其他类型恢复原生 select 并收起 body 级面板
    const wrap0 = document.getElementById('roleVoiceCustom');
    if (wrap0) wrap0.style.display = type === 'edge' ? '' : 'none';
    if (this._voicePanel) this._voicePanel.style.display = type === 'edge' ? this._voicePanel.style.display : 'none';
    this.roleVoice.style.display = type === 'edge' ? 'none' : '';
    this.roleVoice.innerHTML = '<option value="">加载中...</option>';

    if (type === 'local' && this.disableLocalTts) {
      this.roleVoice.innerHTML = '<option value="">当前平台禁用系统TTS</option>';
      return;
    }

    if (type === 'edge' && window.electronAPI?.listEdgeVoices) {
      const res = await window.electronAPI.listEdgeVoices();
      // 排序：中文（含港澳台及方言） → 英语（全部地区） → 日/俄/西 → 其他语言；
      // 英语组内美式/英式靠前，其他地区口音排后面
      const rank = (v) => v.startsWith('zh-') ? 0
        : v.startsWith('en-') ? 1
        : (/^(ja|ru|es)-/.test(v) ? 2 : 3);
      const enRank = (v) => v.startsWith('en-US') ? 0 : v.startsWith('en-GB') ? 1 : 2;
      let voices = (res?.voices || []).sort((a, b) => rank(a) - rank(b) || enRank(a) - enRank(b) || a.localeCompare(b));
      const isUnlocked = window.entitlement?.isUnlocked();
      if (!isUnlocked) {
        // 免费版放行：全部中文（含港澳台及方言口音）+ 全部英语
        voices = voices.filter(v => v.startsWith('zh-') || v.startsWith('en-') || v === preserveVoice);
      }
      // 选中：编辑已有角色保持其音色；新建默认英文 Jenny，都没有退列表首位
      const selected = (preserveVoice && voices.includes(preserveVoice))
        ? preserveVoice
        : (voices.includes('en-US-JennyNeural') ? 'en-US-JennyNeural' : (voices[0] || ''));
      // 原生 select 隐藏仅作数据存储，自定义下拉（语言标识+分组+跑马灯）接管交互
      this.roleVoice.innerHTML = voices.map(v => `<option value="${v}">${v}</option>`).join('');
      this.roleVoice.value = selected;
      this._buildVoiceDropdown(voices, selected);
      return;
    }

    const voices = await this.getLocalVoices();
    this.roleVoice.innerHTML = voices.length
      ? voices.map(v => `<option value="${v.name}">${v.name} (${v.lang})</option>`).join('')
      : '<option value="">未获取到本地发音人</option>';
  }

  async renderRoles() {
    // 角色与代码中的 <role> 标签全镜像同步，不再区分来源
    const allRoles = await this.getRoles();
    const isUnlocked = window.entitlement?.isUnlocked();
    const isFreeDisplay = window.entitlement?.isFreeDisplay;
    const total = allRoles.length;
    const siteUrl = window.LISTEXT_CONSTANTS?.API_BASE_URL || 'https://api.yfyw.top';

    let html = '';

    if (!isUnlocked) {
      html += `<div class="rm-vip-bar">
        ${isFreeDisplay ? '🎉 全服限免中' : '📋 免费版'} · 日/俄/西等 30+ 语种需专业版解锁
        <a href="#" class="rm-upgrade-link" onclick="window.electronAPI?.openExternal?.('${siteUrl}');return false">💎 升级专业版</a>
      </div>`;
    }

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

    if (type === 'edge' && !window.entitlement?.isUnlocked()
        && voice && !voice.startsWith('zh-') && !voice.startsWith('en-')) {
      window.entitlement?.showVipToast('该发音人音色');
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
