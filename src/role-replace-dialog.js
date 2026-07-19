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
      if (r.source === 'code') continue;
      const regex = new RegExp(`<say\\s+[^>]*role\\s*=\\s*["']${this._escapeRe(r.id)}["'][^>]*>`, 'gi');
      const matches = this._content.match(regex);
      counts[r.id] = matches ? matches.length : 0;
    }
    return counts;
  }

  _escapeRe(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  _render() {
    const maxRoles = 3;
    const list = document.getElementById('roleReplaceList');
    if (!list) return;

    let html = '';
    this._roles.forEach((r, i) => {
      if (r.source === 'code') return; // skip code-defined roles

      const refs = this._roleRefCounts[r.id] || 0;
      const refInfo = refs > 0 ? `<span style="color:#757575;font-size:11px">· ${refs}处引用</span>` : '';

      if (i < maxRoles) {
        this._selectedIndices.add(i);
        html += `<label class="rr-item rr-keep">
          <input type="checkbox" checked data-index="${i}" class="rr-check">
          <div class="rr-item-info"><strong>${r.name || r.id}</strong> <span style="color:#757575;font-size:11px">(${r.id})</span></div>
          <div class="rr-item-meta">${refInfo}</div>
        </label>`;
      } else {
        const replaceOpts = this._roles.slice(0, maxRoles).filter(rp => rp.source !== 'code').map(rp =>
          `<option value="${rp.id}"${rp.id === this._roles[0]?.id ? ' selected' : ''}>${rp.name || rp.id}</option>`
        ).join('');
        html += `<label class="rr-item rr-remove">
          <input type="checkbox" data-index="${i}" class="rr-check">
          <div class="rr-item-info"><strong>${r.name || r.id}</strong> <span style="color:#757575;font-size:11px">(${r.id})</span></div>
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

    // Replace select change
    list.querySelectorAll('.rr-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const idx = parseInt(sel.closest('.rr-replace').dataset.index, 10);
        this._replaceMap[idx] = sel.value;
      });
    });

    document.getElementById('roleReplaceConfirm').disabled = false;
    document.getElementById('roleReplaceConfirm').textContent = '确认并导入';

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
      if (r.source === 'code') {
        keptRoles.push(r);
        return;
      }
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
