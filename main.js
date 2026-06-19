const { app, BrowserWindow, ipcMain } = require('electron');
app.commandLine.appendSwitch('no-sandbox');
const path = require('path');
const { createMainWindow, getMainWindow } = require('./src/main/window-manager');
const { registerIpcHandlers } = require('./src/main/ipc-handler');
const { registerConfigHandlers, loadSettings, applyProxySettings } = require('./src/main/config-handler');
const { registerSoundHandlers } = require('./src/main/sound-handler');
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
  
  // Register IPC handlers
  registerIpcHandlers();
  registerConfigHandlers(ipcMain);
  registerSoundHandlers(ipcMain);
  
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
  // Cleanup temporary files
  const { tempDir } = require('./src/main/ipc-handler');
  try {
    const fs = require('fs');
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tempDir, file));
      }
      fs.rmdirSync(tempDir);
    }
  } catch (e) {
    console.error('Cleanup failed:', e);
  }
});

