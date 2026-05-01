const fs = require('fs');
const path = require('path');
const { app, dialog, BrowserWindow } = require('electron');
const { ensureDir } = require('./utils');
const { loadEffectsConfig, saveEffectsConfig, DEFAULT_GROUPS } = require('./config-handler');

const userSoundsDir = path.join(app.getPath('userData'), 'sounds-user');
const builtInSoundsDir = path.join(process.resourcesPath, 'default-sounds');
const devBuiltInSoundsDir = path.join(process.cwd(), 'assets', 'default-sounds');

const BUILTIN_GROUP_DIRS = {
  '开场音乐': 'opening-music',
  '常见音效': 'common-effects',
  '环境音': 'ambient'
};

function getBuiltInDir() {
  if (fs.existsSync(builtInSoundsDir)) return builtInSoundsDir;
  return devBuiltInSoundsDir;
}

function ensureBuiltInGroupDirs() {
  const root = getBuiltInDir();
  try {
    ensureDir(root);
    for (const folder of Object.values(BUILTIN_GROUP_DIRS)) {
      ensureDir(path.join(root, folder));
    }
  } catch (_) {
    // packaged resources may be read-only, ignore
  }
}

function getEntryKey(source, group, filename) {
  return `${source}:${group}:${filename}`;
}

function scanAudioFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir);
  const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];
  return files.filter(file => audioExtensions.includes(path.extname(file).toLowerCase()));
}

function scanBuiltInSounds() {
  const root = getBuiltInDir();
  const list = [];

  for (const [groupName, folder] of Object.entries(BUILTIN_GROUP_DIRS)) {
    const dir = path.join(root, folder);
    if (!fs.existsSync(dir)) continue;
    const files = scanAudioFiles(dir);
    for (const file of files) {
      list.push({
        key: getEntryKey('builtin', groupName, file),
        source: 'builtin',
        group: groupName,
        filename: file,
        name: path.basename(file, path.extname(file)),
        path: path.join(dir, file),
        deletable: false
      });
    }
  }

  return list;
}

function scanUserSounds() {
  ensureDir(userSoundsDir);
  const files = scanAudioFiles(userSoundsDir);
  const list = [];
  for (const file of files) {
    list.push({
      key: getEntryKey('user', '用户音效', file),
      source: 'user',
      group: '用户音效',
      filename: file,
      name: path.basename(file, path.extname(file)),
      path: path.join(userSoundsDir, file),
      deletable: true
    });
  }
  return list;
}

function scanSoundsFolder() {
  ensureBuiltInGroupDirs();
  const builtIn = scanBuiltInSounds();
  const user = scanUserSounds();
  return [...builtIn, ...user];
}

function ensureGroupExists(config, group) {
  if (!group) return;
  if (!Array.isArray(config.groups)) config.groups = [];
  if (!config.groups.includes(group)) config.groups.push(group);
}

function withMeta(entry, config) {
  const meta = config.meta?.[entry.key] || {};
  const displayId = config.mappings?.[entry.key] || entry.name;
  return {
    ...entry,
    group: meta.group || entry.group,
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
    if (DEFAULT_GROUPS.includes(name)) return { success: false, error: '默认分组不支持删除' };

    const config = loadEffectsConfig();
    const used = Object.values(config.meta || {}).some(m => m?.group === name);
    if (used) return { success: false, error: '分组下仍有音效，不能删除' };

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
      const [source, group, ...rest] = String(key || '').split(':');
      const filename = rest.join(':');
      if (source !== 'user') return { success: false, error: '默认自带音效不支持删除' };

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
    ensureBuiltInGroupDirs();
    ensureDir(userSoundsDir);
    return { builtin: getBuiltInDir(), user: userSoundsDir, builtinFolders: BUILTIN_GROUP_DIRS };
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
      const key = getEntryKey('user', '用户音效', finalFilename);

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
    if (!result.canceled && result.filePaths.length > 0) return result.filePaths[0];
    return null;
  });
}

module.exports = {
  scanSoundsFolder,
  registerSoundHandlers,
  userSoundsDir,
  getBuiltInDir,
  buildEffectsMap,
  BUILTIN_GROUP_DIRS
};
