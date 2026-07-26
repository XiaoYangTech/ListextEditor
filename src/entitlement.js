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

class Entitlement {
  constructor() {
    this._cache = null;
  }

  async refresh() {
    if (!window.electronAPI) return;
    try { this._cache = await window.electronAPI.getEntitlement(); } catch {}
  }

  get plan() { return this._cache?.plan || 'free'; }
  get isPro() { return this.plan === 'pro' && !this._cache?.expired; }
  get isFreeDisplay() { return !!this._cache?.free_display?.enabled; }

  isUnlocked() {
    if (this.isFreeDisplay) return true;
    return this.isPro;
  }

  showVipToast(featureName) {
    const toast = document.getElementById('vipToast');
    if (!toast) return;
    toast.querySelector('.vip-toast-text').textContent = `「${featureName}」是专业版功能，请前往 ${window.LISTEXT_CONSTANTS?.API_BASE_URL || '官网'} 购买会员后使用。`;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }
}

window.entitlement = new Entitlement();
