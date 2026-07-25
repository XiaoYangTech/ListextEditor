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

    shortcuts: getDefaultShortcuts()
  };
}

function getDefaultShortcuts() {
  return { ...SHORTCUT_DEFAULTS };
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
}

module.exports = {
  loadSettings,
  saveSettings,
  applyProxySettings,
  registerConfigHandlers,
  getShortcuts,
  saveShortcuts,
  getDefaultShortcuts
};
