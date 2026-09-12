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

/**
 * 官网公开数据客户端（免费运营模式）
 * 保留无需登录的公开接口：公告 / 启动弹窗公告 / 例程模板库 / 首页轮播 / 版本信息 / 匿名设备上报。
 * 付费与用户体系（登录、设备令牌、权益、导出配额）已随免费运营模式整体移除。
 */

const { ipcMain, net } = require('electron');
const os = require('os');
const { API_BASE_URL } = require('../listext-constants');

class ApiClient {
  constructor() {
    this.baseUrl = API_BASE_URL;
    this.appBaseUrl = `${API_BASE_URL}/apps/lstx`;
  }

  async requestNoAuthApp(route) {
    const url = `${this.appBaseUrl}/api.php?route=${route}`;
    try {
      // 走 Electron 的 net.fetch（Chromium 网络栈）：代理设置由 session 统一生效，
      // 不依赖未打包进 asar 的 undici（打包版曾因此报 Cannot find module 'undici'）
      const response = await net.fetch(url);
      return await response.json();
    } catch (e) {
      // 网络失败落日志，避免"首页空白但啥也没报"
      console.error('[API网络失败]', route, e?.cause?.code || e?.code || '', e.message);
      return null;
    }
  }

  async getAnnouncements() {
    const result = await this.requestNoAuthApp('announcements');
    return result?.data || result || [];
  }

  // 启动弹窗公告：客户端启动时拉取，命中则主动弹窗（popup_once=1 表示只弹一次）
  async getPopups() {
    const result = await this.requestNoAuthApp('popup');
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

  async checkUpdate() {
    const result = await this.requestNoAuthApp('app_info');
    return result?.data || result;
  }

  // 匿名设备上报：人数统计的唯一数据源，只有随机设备标识 + 系统信息，不含任何账号信息
  async reportAnonymousPing() {
    let deviceKey = '';
    try {
      deviceKey = require('./config-handler').getOrCreateAnonDeviceKey();
    } catch (e) {
      console.error('[匿名上报] 设备标识不可用:', e.message);
      return null;
    }
    if (!deviceKey) return null;
    const url = `${this.appBaseUrl}/api.php?route=client_ping`;
    try {
      const response = await net.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          device_key: deviceKey,
          os: `${process.platform} ${os.release()} ${process.arch}`,
          device_name: os.hostname()
        })
      });
      return await response.json();
    } catch (e) {
      // 上报失败不影响任何功能，仅记日志
      console.warn('[匿名上报] 失败:', e?.cause?.code || e?.code || '', e.message);
      return null;
    }
  }
}

const apiClient = new ApiClient();

// 启动后上报一次，此后每 8 分钟一次；失败静默，绝不阻塞或打断用户
function startAnonymousPing(intervalMs = 8 * 60 * 1000) {
  const run = () => { apiClient.reportAnonymousPing().catch(() => {}); };
  setTimeout(run, 3000);
  setInterval(run, intervalMs);
}

function registerApiHandlers() {
  ipcMain.handle('api-announcements', async () => {
    return await apiClient.getAnnouncements();
  });

  ipcMain.handle('api-popups', async () => {
    return await apiClient.getPopups();
  });

  ipcMain.handle('api-routines', async () => {
    return await apiClient.getRoutines();
  });

  ipcMain.handle('api-banners', async () => {
    return await apiClient.getBanners();
  });

  ipcMain.handle('paste-from-clipboard', () => {
    return require('electron').clipboard.readText();
  });

  ipcMain.handle('check-update', async () => {
    return await apiClient.checkUpdate();
  });
}

module.exports = { apiClient, registerApiHandlers, startAnonymousPing };
