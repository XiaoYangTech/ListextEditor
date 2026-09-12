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
const { createMainWindow } = require('./src/main/window-manager');
const { registerIpcHandlers } = require('./src/main/ipc-handler');
const { registerConfigHandlers, loadSettings, applyProxySettings } = require('./src/main/config-handler');
const { registerApiHandlers, startAnonymousPing } = require('./src/main/api-client');
const { setupCrypto } = require('./src/main/utils');

// Setup global polyfills
setupCrypto();

// 数据目录统一为 appid 同名（原跟随 productName 落在中文目录，现直接切换不迁移，旧目录保留不动）
// 必须在 app ready 前设置
{
  const path = require('path');
  app.setPath('userData', path.join(app.getPath('appData'), 'ListextEditor'));
}

// Linux 上部分机器缺少或不兼容 VA-API 驱动时，Chromium 会打印
// 「libva error: vaGetDriverNameByIndex() failed」「vaInitialize failed」等警告；
// 这只是硬件解码不可用（会自动回退软件渲染），不影响任何功能。
// 需要彻底静音时：LISTEXT_DISABLE_GPU=1 listexteditor（或加 --disable-gpu 参数）。
if (process.platform === 'linux' && process.env.LISTEXT_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
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

  // 匿名设备上报（人数统计）：启动后一次 + 每 8 分钟一次，纯匿名、失败静默
  startAnonymousPing();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      bindDevToolsShortcut(createMainWindow());
    }
  });
}

initApp();

// 进程级异常落盘：渲染进程崩溃、GPU/网络等子进程退出（日志体系补齐）
app.on('render-process-gone', (event, webContents, details) => {
  console.error('[进程] 渲染进程异常退出:', details?.reason, `exitCode=${details?.exitCode}`);
});
app.on('child-process-gone', (event, details) => {
  console.error('[进程] 子进程异常退出:', details?.type, details?.reason, `exitCode=${details?.exitCode}`);
});

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

