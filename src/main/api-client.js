const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const authPath = path.join(app.getPath('userData'), 'auth.json');

class ApiClient {
  constructor() {
    this.baseUrl = 'https://api.yfyw.top';
    this.appBaseUrl = 'https://api.yfyw.top/apps/lstx';
    this.token = null;
    this.deviceKey = null;
    this.deviceName = '';
    this.userCache = null;
    this.entitlementCache = null;
    this.heartbeatTimer = null;
    this.loadState();
  }

  loadState() {
    try {
      if (fs.existsSync(authPath)) {
        const data = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
        this.token = data.token || null;
        this.deviceKey = data.deviceKey || this.generateDeviceKey();
        this.deviceName = data.deviceName || this.getDeviceName();
        this.userCache = data.user || null;
        if (data.entitlement) {
          this.entitlementCache = this.verifyEntitlement(data.entitlement) ? data.entitlement : null;
        }
      } else {
        this.deviceKey = this.generateDeviceKey();
        this.deviceName = this.getDeviceName();
        this.saveState();
      }
    } catch (e) {
      console.error('[AUTH] 加载认证数据失败:', e.message);
      if (fs.existsSync(authPath)) {
        try {
          const bk = authPath + '.bak';
          fs.renameSync(authPath, bk);
          console.log('[AUTH] 已损坏的 auth.json 备份为 auth.json.bak');
        } catch {}
      }
      this.token = null;
      this.userCache = null;
      this.entitlementCache = null;
      this.deviceKey = this.generateDeviceKey();
      this.deviceName = this.getDeviceName();
      this.saveState();
    }
  }

  saveState() {
    try {
      fs.writeFileSync(authPath, JSON.stringify({
        token: this.token,
        deviceKey: this.deviceKey,
        deviceName: this.deviceName,
        user: this.userCache,
        entitlement: this.entitlementCache
      }, null, 2), 'utf-8');
    } catch (e) {
      console.error('保存认证数据失败:', e);
    }
  }

  generateDeviceKey() {
    return 'le_' + crypto.randomUUID().replace(/-/g, '').slice(0, 32);
  }

  getDeviceName() {
    return os.hostname();
  }

  signEntitlement(entitlement) {
    if (!this.token || !this.deviceKey) return null;
    const payload = JSON.stringify({
      plan: entitlement.plan,
      subscription_until: entitlement.subscription_until,
      expired: entitlement.expired,
      free_display: entitlement.free_display
    });
    const hmac = crypto.createHmac('sha256', this.deviceKey);
    hmac.update(payload + this.token);
    return hmac.digest('hex');
  }

  verifyEntitlement(cached) {
    if (!cached || !cached.signature || !this.token || !this.deviceKey) return false;
    const payload = JSON.stringify({
      plan: cached.plan,
      subscription_until: cached.subscription_until,
      expired: cached.expired,
      free_display: cached.free_display
    });
    const hmac = crypto.createHmac('sha256', this.deviceKey);
    hmac.update(payload + this.token);
    return hmac.digest('hex') === cached.signature;
  }

  async request(route, method = 'GET', body = null) {
    const url = `${this.baseUrl}/api.php?route=${route}`;
    const headers = { 'Content-Type': 'application/json; charset=utf-8' };
    if (this.token) headers['X-Device-Token'] = this.token;

    const options = { method, headers };
    if (body && method !== 'GET') options.body = JSON.stringify(body);

    let response;
    try {
      response = await fetch(url, options);
    } catch (e) {
      return { ok: false, error: { code: 0, message: '网络连接失败' } };
    }

    let data;
    try {
      data = await response.json();
    } catch {
      return { ok: false, error: { code: response.status, message: '服务器响应异常' } };
    }

    if (data.ok === false) {
      if (data.error?.code === 401 && this.token) {
        console.log('[AUTH] 服务器返回 401，自动清除登录态 (route=' + route + ')');
        this.token = null;
        this.userCache = null;
        this.entitlementCache = null;
        this.saveState();
        this.stopHeartbeat();
      }
    }

    return data;
  }

  async requestNoAuth(route) {
    const url = `${this.baseUrl}/api.php?route=${route}`;
    try {
      const response = await fetch(url);
      return await response.json();
    } catch {
      return null;
    }
  }

  async requestApp(route, method = 'GET', body = null) {
    const url = `${this.appBaseUrl}/api.php?route=${route}`;
    const headers = { 'Content-Type': 'application/json; charset=utf-8' };
    if (this.token) headers['X-Device-Token'] = this.token;

    const options = { method, headers };
    if (body && method !== 'GET') options.body = JSON.stringify(body);

    let response;
    try {
      response = await fetch(url, options);
    } catch (e) {
      return { ok: false, error: { code: 0, message: '网络连接失败' } };
    }

    let data;
    try {
      data = await response.json();
    } catch {
      return { ok: false, error: { code: response.status, message: '服务器响应异常' } };
    }

    if (data.ok === false) {
      if (data.error?.code === 401 && this.token) {
        console.log('[AUTH] 服务器返回 401，自动清除登录态 (route=' + route + ')');
        this.token = null;
        this.userCache = null;
        this.entitlementCache = null;
        this.saveState();
        this.stopHeartbeat();
      }
    }

    return data;
  }

  async requestNoAuthApp(route) {
    const url = `${this.appBaseUrl}/api.php?route=${route}`;
    try {
      const response = await fetch(url);
      return await response.json();
    } catch {
      return null;
    }
  }

  async login(email, password, deviceName, osName, removeDeviceId) {
    const body = {
      email, password,
      device_key: this.deviceKey,
      device_name: deviceName || this.deviceName,
      os: osName || `${os.platform()} ${os.release()}`
    };
    if (removeDeviceId) body.remove_device_id = removeDeviceId;

    const result = await this.request('client_login', 'POST', body);
    const data = result?.data || {};
    if (result.ok && data.token) {
      this.token = data.token;
      this.userCache = data.user || null;
      if (data.entitlement) {
        this.entitlementCache = { ...data.entitlement };
        this.entitlementCache.cached_at = new Date().toISOString();
        this.entitlementCache.signature = this.signEntitlement(this.entitlementCache);
      }
      this.saveState();
      this.startHeartbeat();
    }
    return result;
  }

  async getStatus() {
    const result = await this.requestApp('client_status');
    const data = result?.data || {};
    if (result.ok) {
      this.userCache = data.user || this.userCache;
      if (data.entitlement) {
        this.entitlementCache = { ...data.entitlement };
        this.entitlementCache.cached_at = new Date().toISOString();
        this.entitlementCache.signature = this.signEntitlement(this.entitlementCache);
      }
      this.saveState();
    }
    return result;
  }

  async getProfile() {
    const result = await this.requestApp('client_profile');
    const data = result?.data || {};
    if (result.ok) {
      this.userCache = data.user || this.userCache;
      if (data.entitlement) {
        this.entitlementCache = { ...data.entitlement };
        this.entitlementCache.cached_at = new Date().toISOString();
        this.entitlementCache.signature = this.signEntitlement(this.entitlementCache);
      }
      this.saveState();
    }
    return result;
  }

  async getDevices() {
    const result = await this.requestApp('client_devices');
    return result?.data || result;
  }

  async removeDevice(id) {
    return await this.requestApp('client_devices', 'POST', { id });
  }

  async getAnnouncements() {
    const result = await this.requestNoAuthApp('announcements');
    return result?.data || result || [];
  }

  async getRoutines() {
    const result = await this.requestNoAuthApp('routines');
    return result?.data || result || [];
  }

  async getBanners() {
    const result = await this.requestNoAuthApp('banners');
    return result?.data || result || [];
  }

  async getExportQuota() {
    const result = await this.requestApp('export_quota');
    return result?.data || result;
  }

  async consumeExport() {
    return await this.requestApp('export_consume', 'POST');
  }

  async logout() {
    if (this.token) {
      await this.requestApp('client_logout', 'POST').catch(() => {});
    }
    this.token = null;
    this.userCache = null;
    this.entitlementCache = null;
    this.saveState();
    this.stopHeartbeat();
  }

  async heartbeat() {
    if (!this.token) return;
    const result = await this.requestApp('client_heartbeat', 'POST').catch(() => null);
    if (result && result.ok) {
      await this.getStatus();
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat().catch(() => {});
    }, 10 * 60 * 1000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

const apiClient = new ApiClient();

function registerApiHandlers() {
  ipcMain.handle('api-login', async (e, email, pw, deviceName, osName, removeDeviceId) => {
    return await apiClient.login(email, pw, deviceName, osName, removeDeviceId);
  });

  ipcMain.handle('api-logout', async () => {
    await apiClient.logout();
    return { success: true };
  });

  ipcMain.handle('api-status', async () => {
    return await apiClient.getStatus();
  });

  ipcMain.handle('api-profile', async () => {
    return await apiClient.getProfile();
  });

  ipcMain.handle('api-devices', async () => {
    return await apiClient.getDevices();
  });

  ipcMain.handle('api-remove-device', async (e, id) => {
    return await apiClient.removeDevice(id);
  });

  ipcMain.handle('api-announcements', async () => {
    return await apiClient.getAnnouncements();
  });

  ipcMain.handle('api-routines', async () => {
    return await apiClient.getRoutines();
  });

  ipcMain.handle('api-banners', async () => {
    return await apiClient.getBanners();
  });

  ipcMain.handle('api-export-quota', async () => {
    return await apiClient.getExportQuota();
  });

  ipcMain.handle('api-export-consume', async () => {
    return await apiClient.consumeExport();
  });

  ipcMain.handle('paste-from-clipboard', () => {
    return require('electron').clipboard.readText();
  });

  ipcMain.handle('api-is-logged-in', async () => {
    return !!apiClient.token;
  });

  ipcMain.handle('api-get-entitlement', async () => {
    return apiClient.entitlementCache || null;
  });

  ipcMain.handle('api-get-user', async () => {
    const user = apiClient.userCache;
    if (!user) return null;
    if (user.avatar && !/^https?:\/\//i.test(user.avatar)) {
      user.avatar = apiClient.baseUrl + user.avatar;
    }
    return user;
  });
}

module.exports = { apiClient, registerApiHandlers };
