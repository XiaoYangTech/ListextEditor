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

const { app, BrowserWindow, ipcMain } = require('electron');
const { createMainWindow, getMainWindow } = require('./src/main/window-manager');
const { registerIpcHandlers } = require('./src/main/ipc-handler');
const { registerConfigHandlers, loadSettings, applyProxySettings } = require('./src/main/config-handler');
const { registerApiHandlers, apiClient } = require('./src/main/api-client');
const { setupCrypto } = require('./src/main/utils');

// Setup global polyfills
setupCrypto();

// 数据目录统一为 appid 同名（原跟随 productName 落在中文目录，现直接切换不迁移，旧目录保留不动）
// 必须在 app ready 前设置
{
  const path = require('path');
  app.setPath('userData', path.join(app.getPath('appData'), 'ListextEditor'));
}

// F12 toggle DevTools
// 打包生产默认禁用 F12；后门：开发环境、LISTEXT_DEVTOOLS=1、或 --devtools 参数
function bindDevToolsShortcut(win) {
  const allow = !app.isPackaged
    || process.env.LISTEXT_DEVTOOLS === '1'
    || process.argv.includes('--devtools');
  if (!allow) return;
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

async function initApp() {
  // Load settings
  const settings = loadSettings();

  await app.whenReady();

  // 日志系统（主进程 console 双写 + 崩溃记录 + 渲染日志落盘）
  try { require('./src/main/logger').initLogger(); } catch (e) { console.error('日志系统初始化失败:', e.message); }

  // Apply settings (proxy, etc.) after app is ready
  await applyProxySettings(settings);

  // Create main window
  bindDevToolsShortcut(createMainWindow());

  // Register IPC handlers
  registerIpcHandlers();
  registerConfigHandlers(ipcMain);
  registerApiHandlers();

  apiClient.onAuthLost = () => {
    getMainWindow()?.webContents?.send('auth-lost');
  };

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      bindDevToolsShortcut(createMainWindow());
    }
  });
}

initApp();

app.on('window-all-closed', () => {
  // 窗口全关后没有 UI 能操作文件：立即放掉所有文件锁。
  // 尤其 macOS 关窗不退出，主进程存活时内存锁表若不清，文件会永久"被占用"
  try { require('./src/main/file-locker').unlockAll(); } catch {}
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  const { tempDir } = require('./src/main/ipc-handler');
  try {
    const fs = require('fs');
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  } catch (e) {
    console.error('Cleanup failed:', e.message);
  }
});

