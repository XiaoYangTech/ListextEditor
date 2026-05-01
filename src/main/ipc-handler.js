const { ipcMain, shell, net, session, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./utils');
const { openRoleManager, openSettingsWindow } = require('./window-manager');

const tempDir = path.join(app.getPath('temp'), 'listext-editor');

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url, session: session.defaultSession });
    request.on('response', (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer.toString('utf-8'));
      });
    });
    request.on('error', (error) => reject(error));
    request.end();
  });
}

function registerIpcHandlers() {
  ipcMain.handle('save-file', async (event, filePath, content) => {
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('open-external', async (event, url) => {
    if (!url) return { success: false };
    await shell.openExternal(url);
    return { success: true };
  });

  ipcMain.handle('open-role-manager-window', async () => {
    openRoleManager();
    return { success: true };
  });

  ipcMain.handle('open-settings-window', async () => {
    openSettingsWindow();
    return { success: true };
  });

  ipcMain.handle('get-notice', async () => {
    try {
      const notice = (await fetchText('https://yifang.yxxblog.top/api/listext-notice/notice.txt')).trim();
      const url = (await fetchText('https://yifang.yxxblog.top/api/listext-notice/url.txt')).trim();
      return { success: true, notice, url };
    } catch (error) {
      return { success: false, notice: '', url: '', error: error?.message || '获取公告失败' };
    }
  });

  ipcMain.handle('save-binary', async (event, filePath, base64) => {
    try {
      if (!filePath || !base64) {
        return { success: false, error: '参数不完整' };
      }
      ensureDir(path.dirname(filePath));
      const buffer = Buffer.from(base64, 'base64');
      fs.writeFileSync(filePath, buffer);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-audio-file', async (event, filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath);
        return { success: true, data: data.toString('base64') };
      }
      return { success: false, error: '文件不存在' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('cleanup-temp', async () => {
    try {
      if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        files.forEach(file => {
          fs.unlinkSync(path.join(tempDir, file));
        });
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('select-export-path', async () => {
    const { dialog, BrowserWindow } = require('electron');
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win, {
      filters: [{ name: 'Audio Files', extensions: ['wav', 'mp3'] }],
      defaultPath: 'export.wav'
    });
    if (!result.canceled) {
      return result.filePath;
    }
    return null;
  });

  ipcMain.handle('select-listext-path', async () => {
    const { dialog, BrowserWindow } = require('electron');
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, {
      filters: [{ name: 'Listext Files', extensions: ['lxt', 'txt'] }],
      properties: ['openFile']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });
}

module.exports = {
  registerIpcHandlers,
  tempDir
};
