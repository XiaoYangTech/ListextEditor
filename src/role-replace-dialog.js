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

class RoleReplaceDialog {
  show(projectRoles, content, callback) {
    this._callback = callback;
    this._roles = [...projectRoles];
    this._content = content || '';

    this._selectedIndices = new Set();
    this._roleRefCounts = this._countRefs();
    this._replaceMap = {};

    this._render();
    document.getElementById('roleReplaceDialog').classList.add('active');
  }

  _countRefs() {
    const counts = {};
    for (const r of this._roles) {
      const regex = new RegExp(`<say\\s+[^>]*role\\s*=\\s*["']${this._escapeRe(r.id)}["'][^>]*>`, 'gi');
      const matches = this._content.match(regex);
      counts[r.id] = matches ? matches.length : 0;
    }
    return counts;
  }

  _escapeRe(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  _escapeHtml(s) { return window.escapeHtml(s); }

  _render() {
    // 【免费模式】不限角色数，全部角色保留；原逻辑为免费版仅保留前 3 个、其余强制替换
    const maxRoles = window.LISTEXT_CONSTANTS?.FREE_MODE
      ? this._roles.length
      : (window.LISTEXT_CONSTANTS?.MAX_FREE_ROLES || 3);
    const list = document.getElementById('roleReplaceList');
    if (!list) return;

    // 全部角色参与保留/替换选择（角色与代码全镜像，不再区分来源），按选择计数而非原始索引
    const uiEntries = this._roles
      .map((r, i) => ({ role: r, index: i }));
    const keptEntries = uiEntries.slice(0, maxRoles);

    let html = '';
    uiEntries.forEach(({ role: r, index: i }, uiIdx) => {
      const refs = this._roleRefCounts[r.id] || 0;
      const refInfo = refs > 0 ? `<span style="color:#757575;font-size:11px">· ${refs}处引用</span>` : '';
      const nameHtml = `<strong>${this._escapeHtml(r.name || r.id)}</strong> <span style="color:#757575;font-size:11px">(${this._escapeHtml(r.id)})</span>`;

      if (uiIdx < maxRoles) {
        this._selectedIndices.add(i);
        html += `<label class="rr-item rr-keep">
          <input type="checkbox" checked data-index="${i}" class="rr-check">
          <div class="rr-item-info">${nameHtml}</div>
          <div class="rr-item-meta">${refInfo}</div>
        </label>`;
      } else {
        const replaceOpts = keptEntries.map(({ role: rp }, k) =>
          `<option value="${this._escapeHtml(rp.id)}"${k === 0 ? ' selected' : ''}>${this._escapeHtml(rp.name || rp.id)}</option>`
        ).join('');
        html += `<label class="rr-item rr-remove">
          <input type="checkbox" data-index="${i}" class="rr-check">
          <div class="rr-item-info">${nameHtml}</div>
          <div class="rr-item-meta">${refInfo}</div>
          <div class="rr-replace" data-index="${i}">
            替换为: <select class="rr-select">${replaceOpts}</select>
          </div>
        </label>`;
      }
    });

    list.innerHTML = html;

    // Checkbox change handler
    list.querySelectorAll('.rr-check').forEach(cb => {
      cb.addEventListener('change', () => {
        const idx = parseInt(cb.dataset.index, 10);
        if (cb.checked) this._selectedIndices.add(idx);
        else this._selectedIndices.delete(idx);
        this._updateButton();
      });
    });

    // Replace select change；同时记录默认选中项，避免未触碰下拉框时替换映射缺失
    list.querySelectorAll('.rr-select').forEach(sel => {
      const idx = parseInt(sel.closest('.rr-replace').dataset.index, 10);
      this._replaceMap[idx] = sel.value;
      sel.addEventListener('change', () => {
        this._replaceMap[idx] = sel.value;
      });
    });

    this._updateButton();

    // Button handler
    document.getElementById('roleReplaceConfirm').onclick = () => {
      this._doReplace();
    };
    document.getElementById('roleReplaceCancel').onclick = () => {
      document.getElementById('roleReplaceDialog').classList.remove('active');
      this._callback?.(null);
    };
    document.getElementById('roleReplaceClose').onclick = () => {
      document.getElementById('roleReplaceDialog').classList.remove('active');
      this._callback?.(null);
    };
  }

  _updateButton() {
    const count = this._selectedIndices.size;
    const btn = document.getElementById('roleReplaceConfirm');
    if (count > 3) {
      btn.disabled = true;
      btn.textContent = `已选${count}个，最多3个`;
    } else if (count === 0) {
      btn.disabled = true;
      btn.textContent = '至少选择1个角色';
    } else {
      btn.disabled = false;
      btn.textContent = `确认并导入（${count}个角色）`;
    }
  }

  _doReplace() {
    const keptRoles = [];
    const removedIds = new Set();

    this._roles.forEach((r, i) => {
      if (this._selectedIndices.has(i)) {
        keptRoles.push(r);
      } else {
        removedIds.add(r.id);
      }
    });

    let newContent = this._content;

    // Replace removed role references in code
    for (const idx of Object.keys(this._replaceMap)) {
      const oldRole = this._roles[parseInt(idx, 10)];
      const newRoleId = this._replaceMap[idx];
      if (oldRole && newRoleId && removedIds.has(oldRole.id)) {
        const regex = new RegExp(`(<say\\s+[^>]*role\\s*=\\s*["'])${this._escapeRe(oldRole.id)}(["'][^>]*>)`, 'gi');
        newContent = newContent.replace(regex, `$1${newRoleId}$2`);
      }
    }

    // Remove <role> tag definitions for removed roles
    for (const rid of removedIds) {
      const regex = new RegExp(`<role\\s+[^>]*id\\s*=\\s*["']${this._escapeRe(rid)}["'][^>]*>\\s*\\n?`, 'gi');
      newContent = newContent.replace(regex, '');
    }

    document.getElementById('roleReplaceDialog').classList.remove('active');
    this._callback?.({ roles: keptRoles, content: newContent.trim() });
  }
}

window._roleReplaceDialog = new RoleReplaceDialog();
