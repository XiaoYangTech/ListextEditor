const fs = require('fs');
const path = require('path');
const { app, session } = require('electron');
const { ensureDir } = require('./utils');

const effectsConfigPath = path.join(path.dirname(app.getPath('exe')), 'effects-config.json');
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function getDefaultSettings() {
  return {
    proxyMode: 'system',
    proxyUrl: '',
    noticeDismissDate: ''
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

function loadEffectsConfig() {
  try {
    if (fs.existsSync(effectsConfigPath)) {
      const data = fs.readFileSync(effectsConfigPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('读取音效配置失败:', error);
  }
  return {};
}

function saveEffectsConfig(config) {
  try {
    fs.writeFileSync(effectsConfigPath, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('保存音效配置失败:', error);
    return false;
  }
}

function registerConfigHandlers(ipcMain) {
  ipcMain.handle('get-settings', async () => loadSettings());
  
  ipcMain.handle('save-settings', async (event, settings) => {
    const merged = { ...getDefaultSettings(), ...(settings || {}) };
    const success = saveSettings(merged);
    if (success) {
      await applyProxySettings(merged);
    }
    return { success };
  });
}

module.exports = {
  loadSettings,
  saveSettings,
  applyProxySettings,
  loadEffectsConfig,
  saveEffectsConfig,
  registerConfigHandlers
};
