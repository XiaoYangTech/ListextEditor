const { ipcMain, shell, net, session, app } = require('electron');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { ensureDir } = require('./utils');
const { openRoleManager, openSettingsWindow, openEffectManager } = require('./window-manager');
const { userSoundsDir, buildEffectsMap } = require('./sound-handler');

const tempDir = path.join(app.getPath('temp'), 'listext-editor');

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url, session: session.defaultSession });
    request.on('response', (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
    request.on('error', (error) => reject(error));
    request.end();
  });
}

function normalizeExt(filePath) {
  if (!filePath) return filePath;
  return filePath.toLowerCase().endsWith('.lstx') ? filePath : `${filePath}.lstx`;
}

function parseFxIds(content) {
  const ids = new Set();
  const regex = /<fx\s+[^>]*id\s*=\s*"([^"]+)"[^>]*>/gi;
  let m;
  while ((m = regex.exec(content || '')) !== null) {
    if (m[1]) ids.add(m[1]);
  }
  return Array.from(ids);
}

function saveProjectPackage(filePath, payload) {
  const safePath = normalizeExt(filePath);
  const content = payload?.content || '';
  const roles = payload?.roles || [];
  const tabTitle = payload?.title || 'untitled.lstx';

  const zip = new AdmZip();
  const effectMap = buildEffectsMap(); // id -> abs path
  const usedFxIds = parseFxIds(content);
  const bundledSounds = [];

  zip.addFile('project.json', Buffer.from(JSON.stringify({
    version: 1,
    title: tabTitle,
    content,
    roles,
    savedAt: new Date().toISOString()
  }, null, 2), 'utf-8'));

  for (const fxId of usedFxIds) {
    const absPath = effectMap[fxId];
    if (!absPath || !fs.existsSync(absPath)) continue;
    const filename = path.basename(absPath);
    const buf = fs.readFileSync(absPath);
    zip.addFile(`sounds/${filename}`, buf);
    bundledSounds.push({ fxId, filename });
  }

  zip.addFile('assets-map.json', Buffer.from(JSON.stringify({ bundledSounds }, null, 2), 'utf-8'));
  ensureDir(path.dirname(safePath));
  zip.writeZip(safePath);
  return { success: true, filePath: safePath, bundled: bundledSounds.length };
}

function openProjectPackage(filePath) {
  if (!fs.existsSync(filePath)) return { success: false, error: '文件不存在' };
  const zip = new AdmZip(filePath);

  const projectEntry = zip.getEntry('project.json');
  if (!projectEntry) return { success: false, error: '无效项目文件：缺少 project.json' };

  const project = JSON.parse(projectEntry.getData().toString('utf-8'));

  const entries = zip.getEntries().filter(e => e.entryName.startsWith('sounds/') && !e.isDirectory);
  if (entries.length > 0) {
    ensureDir(userSoundsDir);
    for (const entry of entries) {
      const filename = path.basename(entry.entryName);
      const out = path.join(userSoundsDir, filename);
      fs.writeFileSync(out, entry.getData());
    }
  }

  return {
    success: true,
    content: project.content || '',
    roles: Array.isArray(project.roles) ? project.roles : [],
    title: project.title || path.basename(filePath),
    filePath
  };
}

function registerIpcHandlers() {
  ipcMain.handle('save-file', async (event, filePath, content, meta = {}) => {
    try {
      return saveProjectPackage(filePath, { content, ...meta });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('open-project-file', async (event, filePath) => {
    try {
      return openProjectPackage(filePath);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('open-external', async (event, url) => {
    if (!url) return { success: false };
    await shell.openExternal(url);
    return { success: true };
  });

  ipcMain.handle('open-role-manager-window', async () => { openRoleManager(); return { success: true }; });
  ipcMain.handle('open-settings-window', async () => { openSettingsWindow(); return { success: true }; });
  ipcMain.handle('open-effect-manager-window', async () => { openEffectManager(); return { success: true }; });

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
      if (!filePath || !base64) return { success: false, error: '参数不完整' };
      ensureDir(path.dirname(filePath));
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
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
        files.forEach(file => fs.unlinkSync(path.join(tempDir, file)));
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
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle('select-project-path', async () => {
    const { dialog, BrowserWindow } = require('electron');
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win, {
      filters: [{ name: 'Listext Project', extensions: ['lstx'] }],
      defaultPath: 'untitled.lstx'
    });
    return result.canceled ? null : normalizeExt(result.filePath);
  });
}

module.exports = {
  registerIpcHandlers,
  tempDir
};
