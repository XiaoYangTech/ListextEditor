const fs = require('fs');
const path = require('path');
const { app, dialog, BrowserWindow } = require('electron');
const { ensureDir } = require('./utils');
const { loadEffectsConfig, saveEffectsConfig, DEFAULT_GROUPS } = require('./config-handler');

const userSoundsDir = path.join(app.getPath('userData'), 'sounds-user');
const builtInSoundsDir = path.join(process.resourcesPath, 'default-sounds');
const devBuiltInSoundsDir = path.join(process.cwd(), 'assets', 'default-sounds');

function getBuiltInDir() {
  if (fs.existsSync(builtInSoundsDir)) return builtInSoundsDir;
  return devBuiltInSoundsDir;
}

function getEntryKey(source, filename) {
  return `${source}:${filename}`;
}

function scanDir(dir, source) {
  if (!dir || !fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir);
  const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];
  const list = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!audioExtensions.includes(ext)) continue;
    list.push({
      key: getEntryKey(source, file),
      source,
      filename: file,
      name: path.basename(file, ext),
      path: path.join(dir, file),
      deletable: source === 'user'
    });
  }
  return list;
}

function scanSoundsFolder() {
  ensureDir(userSoundsDir);
  const builtIn = scanDir(getBuiltInDir(), 'builtin');
  const user = scanDir(userSoundsDir, 'user');
  return [...builtIn, ...user];
}

function ensureGroupExists(config, group) {
  if (!group) return;
  if (!Array.isArray(config.groups)) config.groups = [];
  if (!config.groups.includes(group)) config.groups.push(group);
}

function withMeta(entry, config) {
  const meta = config.meta?.[entry.key] || {};
  const fallback = entry.source === 'builtin' ? '常见音效' : '用户音效';
  const displayId = config.mappings?.[entry.key] || entry.name;
  return {
    ...entry,
    group: meta.group || fallback,
    displayId,
    isDefault: entry.source === 'builtin'
  };
}

function buildEffectsMap() {
  const config = loadEffectsConfig();
  const sounds = scanSoundsFolder().map(s => withMeta(s, config));
  const effects = {};
  for (const sound of sounds) {
    const customId = config.mappings?.[sound.key] || sound.name;
    if (customId) effects[customId] = sound.path;
  }
  return effects;
}

function registerSoundHandlers(ipcMain, mainWindow) {
  ipcMain.handle('load-effects', async () => buildEffectsMap());

  ipcMain.handle('list-sounds', async () => {
    const config = loadEffectsConfig();
    const list = scanSoundsFolder().map(s => withMeta(s, config));
    return list.sort((a, b) => {
      if (a.group !== b.group) return a.group.localeCompare(b.group, 'zh-CN');
      if (a.source !== b.source) return a.source === 'builtin' ? -1 : 1;
      return a.filename.localeCompare(b.filename, 'zh-CN');
    });
  });

  ipcMain.handle('list-effect-groups', async () => {
    const config = loadEffectsConfig();
    const dynamic = new Set(config.groups || []);
    dynamic.add('用户音效');
    for (const g of DEFAULT_GROUPS) dynamic.add(g);
    return Array.from(dynamic);
  });

  ipcMain.handle('add-effect-group', async (event, groupName) => {
    const name = (groupName || '').trim();
    if (!name) return { success: false, error: '分组名不能为空' };
    const config = loadEffectsConfig();
    ensureGroupExists(config, name);
    return { success: saveEffectsConfig(config) };
  });

  ipcMain.handle('delete-effect-group', async (event, groupName) => {
    const name = (groupName || '').trim();
    if (!name) return { success: false, error: '分组名不能为空' };
    if (DEFAULT_GROUPS.includes(name)) {
      return { success: false, error: '默认分组不支持删除' };
    }

    const config = loadEffectsConfig();
    const used = Object.values(config.meta || {}).some(m => m?.group === name);
    if (used) {
      return { success: false, error: '分组下仍有音效，不能删除' };
    }

    config.groups = (config.groups || []).filter(g => g !== name);
    return { success: saveEffectsConfig(config) };
  });

  ipcMain.handle('set-effect-id', async (event, key, customId) => {
    const config = loadEffectsConfig();
    if (!config.mappings) config.mappings = {};
    config.mappings[key] = customId;
    return { success: saveEffectsConfig(config) };
  });

  ipcMain.handle('set-sound-group', async (event, key, group) => {
    const g = (group || '').trim();
    if (!g) return { success: false, error: '分组不能为空' };
    const config = loadEffectsConfig();
    ensureGroupExists(config, g);
    if (!config.meta) config.meta = {};
    config.meta[key] = { ...(config.meta[key] || {}), group: g };
    return { success: saveEffectsConfig(config) };
  });

  ipcMain.handle('remove-effect-mapping', async (event, key) => {
    const config = loadEffectsConfig();
    if (config.mappings) delete config.mappings[key];
    return { success: saveEffectsConfig(config) };
  });

  ipcMain.handle('delete-sound', async (event, key) => {
    try {
      const [source, ...rest] = String(key || '').split(':');
      const filename = rest.join(':');
      if (source !== 'user') {
        return { success: false, error: '默认自带音效不支持删除' };
      }

      const target = path.join(userSoundsDir, filename);
      if (fs.existsSync(target)) fs.unlinkSync(target);

      const config = loadEffectsConfig();
      if (config.mappings) delete config.mappings[key];
      if (config.meta) delete config.meta[key];
      saveEffectsConfig(config);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-sounds-path', async () => {
    ensureDir(userSoundsDir);
    return {
      builtin: getBuiltInDir(),
      user: userSoundsDir
    };
  });

  ipcMain.handle('import-sound', async (event, sourcePath, groupName) => {
    try {
      ensureDir(userSoundsDir);
      const filename = path.basename(sourcePath);
      let finalPath = path.join(userSoundsDir, filename);

      let counter = 1;
      while (fs.existsSync(finalPath)) {
        const ext = path.extname(filename);
        const name = path.basename(filename, ext);
        finalPath = path.join(userSoundsDir, `${name}_${counter}${ext}`);
        counter += 1;
      }

      fs.copyFileSync(sourcePath, finalPath);
      const finalFilename = path.basename(finalPath);
      const key = getEntryKey('user', finalFilename);

      const config = loadEffectsConfig();
      const group = (groupName || '').trim() || '用户音效';
      ensureGroupExists(config, group);
      if (!config.meta) config.meta = {};
      config.meta[key] = { ...(config.meta[key] || {}), group };
      saveEffectsConfig(config);

      return { success: true, path: finalPath, key };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('select-audio-file', async () => {
    const focused = BrowserWindow.getFocusedWindow();
    const win = focused || mainWindow;
    const result = await dialog.showOpenDialog(win, {
      filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }],
      properties: ['openFile']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });
}

module.exports = {
  scanSoundsFolder,
  registerSoundHandlers,
  userSoundsDir,
  getBuiltInDir,
  buildEffectsMap
};

