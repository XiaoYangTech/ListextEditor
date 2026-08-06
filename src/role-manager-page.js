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

  // 语言标识映射：音色 ID → 中文可读语言名
  _localeLabel(v) {
    const loc = v.split('-').slice(0, 2).join('-');
    const MAP = {
      'zh-CN': '中文（简体）', 'zh-TW': '中文（台湾）', 'zh-HK': '中文（香港）',
      'en-US': '英语（美式）', 'en-GB': '英语（英式）', 'en-AU': '英语（澳大利亚）',
      'en-CA': '英语（加拿大）', 'en-IN': '英语（印度）', 'en-IE': '英语（爱尔兰）',
      'en-NZ': '英语（新西兰）', 'en-SG': '英语（新加坡）', 'en-HK': '英语（香港）', 'en-ZA': '英语（南非）',
      'ja-JP': '日语', 'ru-RU': '俄语',
      'es-ES': '西班牙语（西班牙）', 'es-MX': '西班牙语（墨西哥）', 'es-AR': '西班牙语（阿根廷）',
      'es-US': '西班牙语（美国）', 'es-CO': '西班牙语（哥伦比亚）', 'es-CL': '西班牙语（智利）',
      'fr-FR': '法语', 'de-DE': '德语', 'ko-KR': '韩语',
      'pt-BR': '葡萄牙语（巴西）', 'pt-PT': '葡萄牙语（葡萄牙）',
      'it-IT': '意大利语', 'ar-EG': '阿拉伯语', 'hi-IN': '印地语',
      'th-TH': '泰语', 'vi-VN': '越南语', 'id-ID': '印尼语',
      'tr-TR': '土耳其语', 'nl-NL': '荷兰语', 'pl-PL': '波兰语',
      'sv-SE': '瑞典语', 'uk-UA': '乌克兰语'
    };
    if (MAP[loc]) return MAP[loc];
    const LANG = { fr: '法语', de: '德语', ar: '阿拉伯语', hi: '印地语', th: '泰语', vi: '越南语', id: '印尼语', tr: '土耳其语', nl: '荷兰语', pl: '波兰语', sv: '瑞典语', fi: '芬兰语', da: '丹麦语', nb: '挪威语', uk: '乌克兰语', cs: '捷克语', el: '希腊语', he: '希伯来语', hu: '匈牙利语', ro: '罗马尼亚语', bg: '保加利亚语', hr: '克罗地亚语', sk: '斯洛伐克语', sl: '斯洛文尼亚语', et: '爱沙尼亚语', lv: '拉脱维亚语', lt: '立陶宛语', ms: '马来语', ta: '泰米尔语', te: '泰卢固语', ml: '马拉雅拉姆语', kn: '卡纳达语', bn: '孟加拉语', mr: '马拉地语', gu: '古吉拉特语', pa: '旁遮普语', ur: '乌尔都语', fa: '波斯语', sw: '斯瓦希里语', af: '南非荷兰语', ca: '加泰罗尼亚语', is: '冰岛语', ga: '爱尔兰语', mt: '马耳他语', cy: '威尔士语', fil: '菲律宾语', jv: '爪哇语', su: '巽他语', my: '缅甸语', km: '高棉语', lo: '老挝语', mn: '蒙古语', ne: '尼泊尔语', si: '僧伽罗语', kk: '哈萨克语', uz: '乌兹别克语', az: '阿塞拜疆语', hy: '亚美尼亚语', ka: '格鲁吉亚语', am: '阿姆哈拉语', sq: '阿尔巴尼亚语', mk: '马其顿语', sr: '塞尔维亚语', bs: '波斯尼亚语', lb: '卢森堡语' };
    return LANG[v.split('-')[0]] || '';
  }

  _voiceText(v) {
    const label = this._localeLabel(v);
    return label ? `${label} · ${v}` : v;
  }

  // 自定义发音人下拉：分组 + 语言标识 + 收起状态跑马灯
  _buildVoiceDropdown(voices, selected, isUnlocked) {
    let wrap = document.getElementById('roleVoiceCustom');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'roleVoiceCustom';
      wrap.className = 'rm-select';
      this.roleVoice.parentNode.insertBefore(wrap, this.roleVoice.nextSibling);
      document.addEventListener('click', (e) => {
        const panel = wrap.querySelector('.rm-select-panel');
        if (panel && !wrap.contains(e.target)) panel.style.display = 'none';
      });
    }
    const rank = (v) => v.startsWith('zh-CN') ? 0 : v.startsWith('en-US') ? 1 : (/^(ja|ru|es)-/.test(v) ? 2 : 3);
    const groupNames = ['中文', '英语', '日语 / 俄语 / 西班牙语', '其他语言'];
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
      <div class="rm-select-panel" style="display:none;">${panelHtml || '<div class="rm-select-group">无可用发音人</div>'}</div>
      ${!isUnlocked ? '<div class="rm-select-hint">💎 日/俄/西等 30+ 语种需专业版解锁</div>' : ''}
    `;
    const face = wrap.querySelector('#roleVoiceFace');
    const panel = wrap.querySelector('.rm-select-panel');
    face.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    wrap.querySelectorAll('.rm-select-item').forEach(item => {
      item.addEventListener('click', () => {
        const v = item.dataset.v;
        this.roleVoice.value = v;
        wrap.querySelector('.rm-select-face-inner').textContent = this._voiceText(v);
        wrap.querySelectorAll('.rm-select-item').forEach(i => i.classList.toggle('active', i === item));
        panel.style.display = 'none';
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
    // Edge 用自定义下拉，其他类型恢复原生 select
    const wrap0 = document.getElementById('roleVoiceCustom');
    if (wrap0) wrap0.style.display = type === 'edge' ? '' : 'none';
    this.roleVoice.style.display = type === 'edge' ? 'none' : '';
    this.roleVoice.innerHTML = '<option value="">加载中...</option>';

    if (type === 'local' && this.disableLocalTts) {
      this.roleVoice.innerHTML = '<option value="">当前平台禁用系统TTS</option>';
      return;
    }

    if (type === 'edge' && window.electronAPI?.listEdgeVoices) {
      const res = await window.electronAPI.listEdgeVoices();
      // 排序：中文 → 英文 → 日/俄/西 → 其他语言
      const rank = (v) => v.startsWith('zh-CN') ? 0
        : v.startsWith('en-US') ? 1
        : (/^(ja|ru|es)-/.test(v) ? 2 : 3);
      let voices = (res?.voices || []).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
      const isUnlocked = window.entitlement?.isUnlocked();
      if (!isUnlocked) {
        voices = voices.filter(v => v.startsWith('zh-CN') || v.startsWith('en-US') || v === preserveVoice);
      }
      // 选中：编辑已有角色保持其音色；新建默认英文 Jenny，都没有退列表首位
      const selected = (preserveVoice && voices.includes(preserveVoice))
        ? preserveVoice
        : (voices.includes('en-US-JennyNeural') ? 'en-US-JennyNeural' : (voices[0] || ''));
      // 原生 select 隐藏仅作数据存储，自定义下拉（语言标识+分组+跑马灯）接管交互
      this.roleVoice.innerHTML = voices.map(v => `<option value="${v}">${v}</option>`).join('');
      this.roleVoice.value = selected;
      this._buildVoiceDropdown(voices, selected, isUnlocked);
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
        ${isFreeDisplay ? '🎉 全服限免中' : '📋 免费版'} · 小语种音色需专业版解锁
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
        && voice && !voice.startsWith('zh-CN') && !voice.startsWith('en-US')) {
      window.entitlement?.showVipToast('小语种发音人');
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
