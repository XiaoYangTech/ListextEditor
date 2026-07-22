class AuthManager {
  constructor() {
    this.api = window.electronAPI;
    this._devicesCache = null;
  }

  async init() {
    const loggedIn = await this.api?.isLoggedIn();
    console.log('[AUTH] init 登录状态:', loggedIn);
    if (loggedIn) {
      try {
        await this.refreshProfile();
        await this.api?.getStatus();
        console.log('[AUTH] init 个人资料刷新成功');
      } catch (e) {
        console.log('[AUTH] init 个人资料刷新失败:', e.message);
      }
    }
    await window.entitlement?.refresh();
    this.updateAccountUI();
    this.bindEvents();
  }

  bindEvents() {
    const accountEl = document.getElementById('homeAccount');
    if (accountEl) {
      accountEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleAccountMenu();
      });
    }

    document.addEventListener('click', () => {
      this.hideAccountMenu();
    });

    document.getElementById('loginCancel')?.addEventListener('click', () => this.hideLoginDialog());
    document.getElementById('loginClose')?.addEventListener('click', () => this.hideLoginDialog());
    document.getElementById('loginSubmit')?.addEventListener('click', () => this.doLogin());
    document.getElementById('loginRegister')?.addEventListener('click', () => {
      this.api?.openExternal?.('https://api.yfyw.top');
    });

    const loginEmail = document.getElementById('loginEmail');
    const loginPassword = document.getElementById('loginPassword');
    const loginSubmit = document.getElementById('loginSubmit');

    const updateLoginBtn = () => {
      if (loginSubmit) {
        loginSubmit.disabled = !(loginEmail?.value.trim() && loginPassword?.value.trim());
      }
    };
    loginEmail?.addEventListener('input', updateLoginBtn);
    loginPassword?.addEventListener('input', updateLoginBtn);

    if (loginPassword) {
      loginPassword.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !loginSubmit?.disabled) this.doLogin();
      });
    }

    document.getElementById('deviceLimitCancel')?.addEventListener('click', () => this.hideDeviceLimitDialog());
    document.getElementById('deviceLimitClose')?.addEventListener('click', () => this.hideDeviceLimitDialog());
    document.getElementById('deviceLimitConfirm')?.addEventListener('click', () => this.doDeviceRemoveAndLogin());

    document.getElementById('btnLogout')?.addEventListener('click', () => this.doLogout());
    document.getElementById('btnAccountManage')?.addEventListener('click', () => {
      this.api?.openExternal?.('https://api.yfyw.top');
    });
    document.getElementById('btnBuyPro')?.addEventListener('click', () => {
      this.api?.openExternal?.('https://api.yfyw.top');
    });
  }

  async refreshProfile() {
    if (!this.api) return;
    try {
      const userData = await this.api.getUser();
      const entData = await this.api.getEntitlement();
      console.log('REFRESH_PROFILE userData:', JSON.stringify(userData));
      console.log('REFRESH_PROFILE entData:', JSON.stringify(entData));
      if (userData) this._userCache = userData;
      if (entData) this._entitlementCache = entData;
    } catch {}
  }

  async doLogin() {
    const email = document.getElementById('loginEmail')?.value.trim();
    const password = document.getElementById('loginPassword')?.value.trim();
    const submitBtn = document.getElementById('loginSubmit');
    if (!email || !password || submitBtn?.disabled) {
      if (!email || !password) {
        document.getElementById('loginError').textContent = '请填写邮箱和密码';
        document.getElementById('loginError').style.display = 'block';
      }
      return;
    }

    this._loginEmail = email;
    this._loginPassword = password;
    this._pendingDeviceName = document.getElementById('loginDeviceName')?.value || '';

    document.getElementById('loginSubmit').disabled = true;
    document.getElementById('loginSubmit').textContent = '登录中...';
    document.getElementById('loginError').style.display = 'none';

    try {
      const result = await this.api.login(email, password, this._pendingDeviceName, this.api.platform || 'Windows');
      console.log('LOGIN_RESULT:', JSON.stringify(result));
      document.getElementById('loginSubmit').disabled = false;
      document.getElementById('loginSubmit').textContent = '登录';

      if (result.ok) {
        const loggedIn = await this.api?.isLoggedIn();
        if (!loggedIn) {
          const errMsg = result.error?.message || result.message || JSON.stringify(result);
          document.getElementById('loginError').textContent = errMsg;
          document.getElementById('loginError').style.display = 'block';
          document.getElementById('loginSubmit').disabled = false;
          document.getElementById('loginSubmit').textContent = '登录';
          return;
        }
        this.hideLoginDialog();
        await this.refreshProfile();
        this.updateAccountUI();
        return;
      }

      if (result.device_limit && result.devices) {
        this._devicesCache = result.devices;
        this._maxDevices = result.max_devices || 3;
        this.showDeviceLimitDialog();
        return;
      }

      document.getElementById('loginError').textContent = result.error?.message || '登录失败';
      document.getElementById('loginError').style.display = 'block';
    } catch {
      document.getElementById('loginSubmit').disabled = false;
      document.getElementById('loginSubmit').textContent = '登录';
      document.getElementById('loginError').textContent = '网络连接失败';
      document.getElementById('loginError').style.display = 'block';
    }
  }

  async doDeviceRemoveAndLogin() {
    const selected = document.querySelector('input[name="deviceRadio"]:checked');
    if (!selected) return;
    const removeId = parseInt(selected.value, 10);

    document.getElementById('deviceLimitConfirm').disabled = true;
    document.getElementById('deviceLimitConfirm').textContent = '登录中...';

    try {
      const result = await this.api.login(this._loginEmail, this._loginPassword, this._pendingDeviceName, this.api.platform || 'Windows', removeId);
      if (result.ok) {
        this.hideDeviceLimitDialog();
        this.hideLoginDialog();
        await this.refreshProfile();
        this.updateAccountUI();
      } else {
        document.getElementById('deviceLimitError').textContent = result.error?.message || '操作失败';
        document.getElementById('deviceLimitError').style.display = 'block';
      }
    } catch {
      document.getElementById('deviceLimitError').textContent = '网络连接失败';
      document.getElementById('deviceLimitError').style.display = 'block';
    }
    document.getElementById('deviceLimitConfirm').disabled = false;
    document.getElementById('deviceLimitConfirm').textContent = '下线并登录';
  }

  async doLogout() {
    this.hideAccountMenu();
    await this.api?.logout();
    this._userCache = null;
    this._entitlementCache = null;
    this.updateAccountUI();
  }

  showLoginDialog(reason) {
    const el = document.getElementById('loginDialog');
    if (!el) return;
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginError').style.display = 'none';
    document.getElementById('loginSubmit').disabled = true;
    document.getElementById('loginSubmit').textContent = '登录';
    const reasonEl = document.getElementById('loginReason');
    reasonEl.style.display = reason ? 'block' : 'none';
    if (reason) reasonEl.textContent = reason;
    el.classList.add('active');
  }

  hideLoginDialog() {
    document.getElementById('loginDialog')?.classList.remove('active');
  }

  showDeviceLimitDialog() {
    const el = document.getElementById('deviceLimitDialog');
    if (!el) return;
    const list = document.getElementById('deviceLimitList');
    list.innerHTML = (this._devicesCache || []).map((d, i) =>
      `<label class="device-radio">
        <input type="radio" name="deviceRadio" value="${d.id}" ${i === 0 ? 'checked' : ''}>
        <div class="device-info">
          <div class="device-name">${d.name || d.os}</div>
          <div class="device-meta">${d.ip || ''} · 最后活跃: ${d.last_seen_at || ''}</div>
        </div>
      </label>`
    ).join('');
    document.getElementById('deviceLimitError').style.display = 'none';
    document.getElementById('deviceLimitConfirm').disabled = false;
    document.getElementById('deviceLimitConfirm').textContent = '下线并登录';
    el.classList.add('active');
  }

  hideDeviceLimitDialog() {
    document.getElementById('deviceLimitDialog')?.classList.remove('active');
  }

  toggleAccountMenu() {
    const menu = document.getElementById('accountMenu');
    if (!menu) return;
    if (menu.style.display === 'block') { this.hideAccountMenu(); return; }
    this.renderAccountMenu();
    const account = document.getElementById('homeAccount');
    if (account) {
      const rect = account.getBoundingClientRect();
      menu.style.left = (rect.right - 240) + 'px';
      menu.style.top = (rect.bottom + 4) + 'px';
    }
    menu.style.display = 'block';
  }

  hideAccountMenu() {
    const menu = document.getElementById('accountMenu');
    if (menu) menu.style.display = 'none';
  }

  renderAccountMenu() {
    const el = document.getElementById('accountMenuBody');
    if (!el) return;

    const isLoggedIn = !!(this._userCache);
    const ent = this._entitlementCache || {};

    if (!isLoggedIn) {
      el.innerHTML = `
        <div class="am-user"><span class="material-icons">account_circle</span><span>未登录</span></div>
        <div class="am-divider"></div>
        <button class="am-btn" id="am-btn-login">登录</button>
        <button class="am-btn" id="am-btn-register">注册账号</button>`;
      el.querySelector('#am-btn-login')?.addEventListener('click', () => { this.hideAccountMenu(); this.showLoginDialog(); });
      el.querySelector('#am-btn-register')?.addEventListener('click', () => { this.api?.openExternal?.('https://api.yfyw.top'); });
      return;
    }

    const user = this._userCache || {};
    const avatar = user.avatar ? `<img src="${user.avatar}" class="am-avatar">` : '<span class="material-icons am-avatar-icon">account_circle</span>';
    const planLabel = ent.plan === 'pro' ? '专业版' : '免费版';
    const planColor = ent.plan === 'pro' ? '#4caf50' : '#757575';

    let html = '';
    if (ent.free_display?.enabled) {
      html += '<div class="am-banner">🎉 全服限免中</div>';
    }
    html += `
      <div class="am-user">${avatar}<div><div class="am-username">${user.username || user.email}</div><div class="am-email">${user.email || ''}</div></div></div>
      <div class="am-divider"></div>
      <div class="am-info">订阅计划: <span style="color:${planColor}">${planLabel}</span></div>`;

    if (ent.plan === 'pro') {
      if (ent.subscription_until) {
        html += `<div class="am-info">到期时间: ${ent.subscription_until}</div>`;
      } else {
        html += `<div class="am-info">到期时间: 永久有效</div>`;
      }
    } else {
      html += `<div class="am-info am-quota" id="am-quota-row">本月导出: <span id="am-quota-text">加载中...</span></div>`;
    }

    html += `
      <div class="am-divider"></div>
      <button class="am-btn" id="am-btn-manage">账户管理</button>
      ${ent.plan !== 'pro' ? '<button class="am-btn am-btn-pro" id="am-btn-buy">💎 购买会员</button>' : ''}
      <div class="am-divider"></div>
      <button class="am-btn am-btn-logout" id="am-btn-logout">退出登录</button>`;

    el.innerHTML = html;
    if (ent.plan !== 'pro') this._loadQuotaDisplay();
    el.querySelector('#am-btn-manage')?.addEventListener('click', () => this.api?.openExternal?.('https://api.yfyw.top'));
    el.querySelector('#am-btn-buy')?.addEventListener('click', () => this.api?.openExternal?.('https://api.yfyw.top'));
    el.querySelector('#am-btn-logout')?.addEventListener('click', () => this.doLogout());
  }

  async _loadQuotaDisplay() {
    const el = document.getElementById('am-quota-text');
    if (!el) { console.log('QUOTA_EL_NOT_FOUND', new Error().stack); return; }
    console.log('QUOTA_START');
    try {
      const q = await Promise.race([
        this.api?.getExportQuota(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
      ]);
      console.log('QUOTA_RESULT:', JSON.stringify(q));
      if (q?.ok !== false && typeof q?.used !== 'undefined') {
        if (!q?.limit || q.limit > 1000000) {
          el.textContent = `已用 ${q.used} 次（无限制）`;
        } else {
          el.textContent = `${q.used}/${q.limit} 次`;
        }
      } else {
        el.textContent = '需联网查询';
      }
    } catch (e) {
      console.error('QUOTA_ERROR:', e);
      el.textContent = '需联网查询';
    }
  }

  updateAccountUI() {
    const accountEl = document.getElementById('homeAccount');
    if (!accountEl) return;
    const isLoggedIn = !!(this._userCache);
    if (isLoggedIn) {
      const user = this._userCache;
      const avatarHtml = user.avatar
        ? `<img src="${user.avatar}" style="width:28px;height:28px;border-radius:50%;object-fit:cover">`
        : '<span class="material-icons">account_circle</span>';
      accountEl.innerHTML = `${avatarHtml}<span>${user.username || user.email}</span>`;
    } else {
      accountEl.innerHTML = '<span class="material-icons">account_circle</span><span>未登录</span>';
    }
  }
}
