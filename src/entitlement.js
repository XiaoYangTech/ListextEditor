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
    toast.querySelector('.vip-toast-text').textContent = `「${featureName}」是专业版功能，请前往 api.yfyw.top 购买会员后使用。`;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }
}

window.entitlement = new Entitlement();
