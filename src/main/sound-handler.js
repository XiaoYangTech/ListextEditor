const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { ensureDir } = require('./utils');

const builtInSoundsDir = path.join(app.getAppPath(), 'assets', 'default-sounds');
const devBuiltInSoundsDir = path.join(process.cwd(), 'assets', 'default-sounds');

function getBuiltInRoots() {
  const roots = [];
  if (fs.existsSync(builtInSoundsDir)) roots.push(builtInSoundsDir);
  if (fs.existsSync(devBuiltInSoundsDir) && devBuiltInSoundsDir !== builtInSoundsDir) roots.push(devBuiltInSoundsDir);
  if (!roots.length) roots.push(devBuiltInSoundsDir);
  return roots;
}

function getBuiltInDir() {
  return getBuiltInRoots()[0];
}

const BUILTIN_GROUP_DIRS = {
  '开场音乐': 'opening-music',
  '常见音效': 'common-effects',
  '环境音': 'ambient'
};

function scanAudioFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir);
  const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];
  return files.filter(file => audioExtensions.includes(path.extname(file).toLowerCase()));
}

function scanBuiltInSounds() {
  const roots = getBuiltInRoots();
  const list = [];
  const dedupe = new Set();

  for (const root of roots) {
    for (const [groupName, folder] of Object.entries(BUILTIN_GROUP_DIRS)) {
      const dir = path.join(root, folder);
      if (!fs.existsSync(dir)) continue;
      const files = scanAudioFiles(dir);
      for (const file of files) {
        const dKey = `${groupName}::${file}`;
        if (dedupe.has(dKey)) continue;
        dedupe.add(dKey);

        list.push({
          source: 'builtin',
          group: groupName,
          filename: file,
          name: path.basename(file, path.extname(file)),
          path: path.join(dir, file)
        });
      }
    }
  }

  return list;
}

function registerSoundHandlers(ipcMain) {
  // IPC handlers for builtin sounds are registered in ipc-handler.js
}

module.exports = {
  scanBuiltInSounds,
  registerSoundHandlers,
  getBuiltInDir,
  getBuiltInRoots,
  BUILTIN_GROUP_DIRS
};
