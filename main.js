const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { createMainWindow, getMainWindow } = require('./src/main/window-manager');
const { registerIpcHandlers } = require('./src/main/ipc-handler');
const { registerConfigHandlers, loadSettings, applyProxySettings } = require('./src/main/config-handler');
const { registerSoundHandlers } = require('./src/main/sound-handler');
const { registerApiHandlers, apiClient } = require('./src/main/api-client');
const { setupCrypto, ensureDir } = require('./src/main/utils');

// Setup global polyfills
setupCrypto();

async function initApp() {
  // Load settings
  const settings = loadSettings();

  await app.whenReady();
  
  // Apply settings (proxy, etc.) after app is ready
  await applyProxySettings(settings);
  
  // Create main window
  const mainWindow = createMainWindow();

  // F12 toggle DevTools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // Register IPC handlers
  registerIpcHandlers();
  registerConfigHandlers(ipcMain);
  registerSoundHandlers(ipcMain);
  registerApiHandlers();

  apiClient.onAuthLost = () => {
    mainWindow?.webContents?.send('auth-lost');
  };
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
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

