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

const fs = require('fs');
const path = require('path');
const { app, session } = require('electron');
const { ensureDir } = require('./utils');
const { getLogDir } = require('./logger');
const SHORTCUT_DEFAULTS = require('../shortcut-defaults');

// 注意：settingsPath 必须运行时求值——main.js 在 require 本模块之后才
// setPath('userData')，模块顶层取值会拿到切换前的旧目录（产品名目录）
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function getDefaultSettings() {
  return {
    proxyMode: 'system',
    proxyUrl: '',

    shortcuts: getDefaultShortcuts(),

    // 启动引导状态：首次启动日期（首次调用 get-launch-state 时写入）
    // 与捐助弹窗「我已捐助」永久关闭标记
    firstLaunchDate: null,
    donationDismissed: false,

    // 匿名设备标识（人数统计用）：仅本机随机串，不含任何账号信息
    anonDeviceKey: ''
  };
}

function getDefaultShortcuts() {
  return { ...SHORTCUT_DEFAULTS };
}

function loadSettings() {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      return { ...getDefaultSettings(), ...JSON.parse(data || '{}') };
    }
  } catch (error) {
    console.error('读取设置失败:', error);
  }
  return getDefaultSettings();
}

function saveSettings(settings) {
  try {
    const settingsPath = getSettingsPath();
    ensureDir(path.dirname(settingsPath));
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('保存设置失败:', error);
    return false;
  }
}

// 匿名设备标识：首次调用时本地生成并落盘，之后长期复用（人数统计按此去重）
function getOrCreateAnonDeviceKey() {
  try {
    const settings = loadSettings();
    if (settings.anonDeviceKey) return settings.anonDeviceKey;
    const key = 'le_' + require('crypto').randomBytes(16).toString('hex');
    settings.anonDeviceKey = key;
    saveSettings(settings);
    return key;
  } catch (e) {
    console.error('生成匿名设备标识失败:', e.message);
    return '';
  }
}

async function applyProxySettings(settings) {
  const mode = settings?.proxyMode || 'system';
  const url = (settings?.proxyUrl || '').trim();
  // 代理统一交给 Chromium：渲染层请求与主进程的 net.fetch 都遵循 session 代理设置。
  // 不再使用 undici（它只是开发环境的传递依赖，打包后不存在，曾导致
  // 「恢复直连失败: Cannot find module 'undici'」）。
  // preload 的 EdgeTTS 通过 get-settings 读取本设置，自行构造代理 agent。
  try {
    if (mode === 'manual' && url) {
      await session.defaultSession.setProxy({ proxyRules: url });
    } else if (mode === 'direct') {
      await session.defaultSession.setProxy({ mode: 'direct' });
    } else {
      await session.defaultSession.setProxy({ mode: 'system' });
    }
  } catch (e) {
    console.error('应用代理设置失败:', e.message);
  }
}

function getShortcuts() {
  const settings = loadSettings();
  return { ...getDefaultShortcuts(), ...(settings.shortcuts || {}) };
}

function saveShortcuts(shortcuts) {
  const settings = loadSettings();
  settings.shortcuts = { ...getDefaultShortcuts(), ...shortcuts };
  return saveSettings(settings);
}

function registerConfigHandlers(ipcMain) {
  ipcMain.handle('get-settings', async () => loadSettings());

  ipcMain.handle('save-settings', async (event, settings) => {
    const merged = { ...getDefaultSettings(), ...(settings || {}) };
    const success = saveSettings(merged);
    if (success) await applyProxySettings(merged);
    return { success };
  });

  // 快捷键相关
  ipcMain.handle('get-shortcuts', async () => getShortcuts());
  ipcMain.handle('save-shortcuts', async (event, shortcuts) => {
    return { success: saveShortcuts(shortcuts) };
  });

  // 启动引导状态：首次启动时写入 firstLaunchDate 并返回 firstLaunch=true，
  // 之后返回已使用天数与捐助弹窗关闭标记，供渲染层决定弹新手教程还是捐助弹窗
  ipcMain.handle('get-launch-state', async () => {
    const settings = loadSettings();
    const firstLaunch = !settings.firstLaunchDate;
    if (firstLaunch) {
      settings.firstLaunchDate = new Date().toISOString();
      saveSettings(settings);
    }
    const daysUsed = Math.floor(
      (Date.now() - new Date(settings.firstLaunchDate).getTime()) / 86400000
    );
    return {
      firstLaunch,
      firstLaunchDate: settings.firstLaunchDate,
      donationDismissed: !!settings.donationDismissed,
      daysUsed
    };
  });

  // 捐助弹窗「我已捐助」：永久关闭，之后每次启动不再弹
  ipcMain.handle('set-donation-dismissed', async () => {
    const settings = loadSettings();
    settings.donationDismissed = true;
    return { success: saveSettings(settings) };
  });

  // 缓存管理：大小统计 / 分类清除 / 打开日志目录
  ipcMain.handle('get-cache-stats', async () => {
    const { app } = require('electron');
    const { dirSize } = require('./logger');
    const tempDir = path.join(app.getPath('temp'), 'ListextEditor');
    return {
      logs: dirSize(getLogDir()),
      temp: dirSize(tempDir),
      projectSounds: dirSize(path.join(app.getPath('userData'), 'project-sounds')),
      importedSounds: dirSize(path.join(app.getPath('userData'), 'imported-sounds'))
    };
  });

  ipcMain.handle('clear-cache', async (event, category) => {
    const { app } = require('electron');
    const targets = {
      logs: getLogDir(),
      temp: path.join(app.getPath('temp'), 'ListextEditor'),
      projectSounds: path.join(app.getPath('userData'), 'project-sounds'),
      importedSounds: path.join(app.getPath('userData'), 'imported-sounds')
    };
    const dir = targets[category];
    if (!dir) return { success: false, error: '未知分类' };
    try {
      if (fs.existsSync(dir)) {
        for (const entry of fs.readdirSync(dir)) {
          fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
        }
      }
      console.log('[缓存] 已清除:', category);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('open-logs-dir', async () => {
    try {
      const { shell } = require('electron');
      await shell.openPath(getLogDir());
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = {
  loadSettings,
  getOrCreateAnonDeviceKey,
  saveSettings,
  applyProxySettings,
  registerConfigHandlers,
  getShortcuts,
  saveShortcuts,
  getDefaultShortcuts
};
