const fs = require('fs');
const path = require('path');
const { app, session } = require('electron');
const { ensureDir } = require('./utils');
const SHORTCUT_DEFAULTS = require('../shortcut-defaults');

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function getDefaultSettings() {
  return {
    proxyMode: 'system',
    proxyUrl: '',

    shortcuts: getDefaultShortcuts(),
    storagePaths: getDefaultStoragePaths()
  };
}

function getDefaultShortcuts() {
  return { ...SHORTCUT_DEFAULTS };
}

function getDefaultStoragePaths() {
  return {
    projects: path.join(app.getPath('documents'), 'ListextEditor', 'Projects'),
    sounds: path.join(app.getPath('userData'), 'sounds-user'),
    cache: path.join(app.getPath('temp'), 'listext-editor'),
    roles: path.join(app.getPath('userData'), 'roles')
  };
}

function loadSettings() {
  try {
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
    ensureDir(path.dirname(settingsPath));
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('保存设置失败:', error);
    return false;
  }
}

async function applyProxySettings(settings) {
  const mode = settings?.proxyMode || 'system';
  const url = (settings?.proxyUrl || '').trim();
  if (mode === 'manual' && url) {
    process.env.HTTP_PROXY = url;
    process.env.HTTPS_PROXY = url;
    await session.defaultSession.setProxy({ proxyRules: url });
    return;
  }
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  if (mode === 'direct') {
    await session.defaultSession.setProxy({ mode: 'direct' });
  } else {
    await session.defaultSession.setProxy({ mode: 'system' });
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

function getStoragePaths() {
  const settings = loadSettings();
  return { ...getDefaultStoragePaths(), ...(settings.storagePaths || {}) };
}

function saveStoragePaths(paths) {
  const settings = loadSettings();
  settings.storagePaths = { ...getDefaultStoragePaths(), ...paths };
  return saveSettings(settings);
}

function resetStoragePaths() {
  const settings = loadSettings();
  settings.storagePaths = getDefaultStoragePaths();
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

  // 存储路径相关
  ipcMain.handle('get-storage-paths', async () => getStoragePaths());
  ipcMain.handle('save-storage-paths', async (event, paths) => {
    return { success: saveStoragePaths(paths) };
  });
  ipcMain.handle('reset-storage-paths', async () => {
    return { success: resetStoragePaths() };
  });
}

module.exports = {
  loadSettings,
  saveSettings,
  applyProxySettings,
  registerConfigHandlers,
  getShortcuts,
  saveShortcuts,
  getStoragePaths,
  saveStoragePaths,
  resetStoragePaths,
  getDefaultShortcuts,
  getDefaultStoragePaths
};
