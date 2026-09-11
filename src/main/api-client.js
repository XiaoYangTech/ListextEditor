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
 * 仅保留无需登录的公开接口：公告 / 例行维护 / 首页轮播 / 版本信息。
 * 付费与用户体系（登录、设备、权益、导出配额）已随免费运营模式整体移除。
 */

const { ipcMain } = require('electron');
const { API_BASE_URL } = require('../listext-constants');

class ApiClient {
  constructor() {
    this.baseUrl = API_BASE_URL;
    this.appBaseUrl = `${API_BASE_URL}/apps/lstx`;
  }

  async requestNoAuthApp(route) {
    const url = `${this.appBaseUrl}/api.php?route=${route}`;
    try {
      const response = await fetch(url);
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
}

const apiClient = new ApiClient();

function registerApiHandlers() {
  ipcMain.handle('api-announcements', async () => {
    return await apiClient.getAnnouncements();
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

module.exports = { apiClient, registerApiHandlers };
