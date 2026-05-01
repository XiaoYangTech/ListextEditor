const fs = require('fs');
const path = require('path');
const { app, ipcMain, dialog } = require('electron');
const { ensureDir } = require('./utils');
const { loadEffectsConfig, saveEffectsConfig } = require('./config-handler');

const soundsDir = path.join(path.dirname(app.getPath('exe')), 'sounds');

function scanSoundsFolder() {
  ensureDir(soundsDir);
  const files = fs.readdirSync(soundsDir);
  const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];

  const sounds = [];
  files.forEach(file => {
    const ext = path.extname(file).toLowerCase();
    if (audioExtensions.includes(ext)) {
      sounds.push({
        filename: file,
        name: path.basename(file, ext),
        path: path.join(soundsDir, file)
      });
    }
  });

  return sounds;
}

function registerSoundHandlers(ipcMain, mainWindow) {
  ipcMain.handle('load-effects', async () => {
    ensureDir(soundsDir);
    const config = loadEffectsConfig();
    const sounds = scanSoundsFolder();
    const effects = {};

    sounds.forEach(sound => {
      const customId = config[sound.filename] || sound.name;
      effects[customId] = sound.path;
    });

    Object.keys(config).forEach(key => {
      if (!sounds.find(s => s.filename === key || s.name === key)) {
        if (config[key] && fs.existsSync(config[key])) {
          effects[key] = config[key];
        }
      }
    });

    return effects;
  });

  ipcMain.handle('list-sounds', async () => scanSoundsFolder());

  ipcMain.handle('set-effect-id', async (event, filename, customId) => {
    const config = loadEffectsConfig();
    config[filename] = customId;
    return { success: saveEffectsConfig(config) };
  });

  ipcMain.handle('remove-effect-mapping', async (event, filename) => {
    const config = loadEffectsConfig();
    delete config[filename];
    return { success: saveEffectsConfig(config) };
  });

  ipcMain.handle('delete-sound', async (event, filename) => {
    try {
      const target = path.join(soundsDir, filename);
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
      }
      const config = loadEffectsConfig();
      delete config[filename];
      saveEffectsConfig(config);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-sounds-path', async () => {
    ensureDir(soundsDir);
    return soundsDir;
  });

  ipcMain.handle('import-sound', async (event, sourcePath) => {
    try {
      ensureDir(soundsDir);
      const filename = path.basename(sourcePath);
      const destPath = path.join(soundsDir, filename);

      let finalPath = destPath;
      let counter = 1;
      while (fs.existsSync(finalPath)) {
        const ext = path.extname(filename);
        const name = path.basename(filename, ext);
        finalPath = path.join(soundsDir, `${name}_${counter}${ext}`);
        counter++;
      }

      fs.copyFileSync(sourcePath, finalPath);
      return { success: true, path: finalPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('select-audio-file', async () => {
    const win = mainWindow || require('electron').BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, {
      filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }],
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
  soundsDir
};
