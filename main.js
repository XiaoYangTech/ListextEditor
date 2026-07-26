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

// F12 toggle DevTools
function bindDevToolsShortcut(win) {
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

