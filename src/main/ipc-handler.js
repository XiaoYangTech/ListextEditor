const { ipcMain, shell, app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const AdmZip = require('adm-zip');
const { ensureDir } = require('./utils');
const { openRoleManager, openSettingsWindow, openEffectManager } = require('./window-manager');
const { getBuiltInDir, getBuiltInRoots, scanBuiltInSounds } = require('./sound-handler');

const tempDir = path.join(app.getPath('temp'), 'listext-editor');

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

function parseRoleDefs(content) {
  const roles = [];
  const regex = /<role\s+([^>]+)\/?>/gi;
  let m;
  while ((m = regex.exec(content || '')) !== null) {
    const attrs = {};
    const attrRegex = /(\w+)=["']([^"']*)["']/g;
    let am;
    while ((am = attrRegex.exec(m[1])) !== null) {
      attrs[am[1]] = am[2];
    }
    if (attrs.id) {
      roles.push({
        id: attrs.id,
        name: attrs.name || attrs.id,
        type: attrs.type || 'edge',
        voice: attrs.voice || ''
      });
    }
  }
  return roles;
}

function saveProjectPackage(filePath, payload) {
  const safePath = normalizeExt(filePath);
  const content = payload?.content || '';
  const roles = payload?.roles || [];
  const projectEffects = payload?.effects || [];
  const tabTitle = payload?.title || 'untitled.lstx';

  const codeRoles = parseRoleDefs(content);
  const mergedRoles = [...codeRoles];
  for (const r of roles) {
    if (!mergedRoles.find(m => m.id === r.id)) {
      mergedRoles.push(r);
    }
  }

  const zip = new AdmZip();
  const builtInSounds = scanBuiltInSounds();
  const usedFxIds = parseFxIds(content);

  zip.addFile('project.json', Buffer.from(JSON.stringify({
    title: tabTitle,
    content,
    roles: mergedRoles,
    effects: projectEffects
  }, null, 2), 'utf-8'));

  for (const fxId of usedFxIds) {
    const effect = projectEffects.find(e => e.id === fxId);
    if (!effect) continue;

    let absPath = null;
    if (effect.source === 'builtin') {
      const builtin = builtInSounds.find(b => b.filename === effect.filename);
      if (builtin) absPath = builtin.path;
    } else if (effect.source === 'imported') {
      absPath = effect.path;
    }

    if (absPath && fs.existsSync(absPath)) {
      const filename = path.basename(absPath);
      const buf = fs.readFileSync(absPath);
      zip.addFile('sounds/' + filename, buf);
    }
  }

  ensureDir(path.dirname(safePath));
  zip.writeZip(safePath);
  return { success: true, filePath: safePath };
}

function openProjectPackage(filePath) {
  if (!fs.existsSync(filePath)) return { success: false, error: '文件不存在' };

  let zip;
  try {
    zip = new AdmZip(filePath);
  } catch (e) {
    return { success: false, error: '文件已损坏，无法读取：' + (e.message || '未知错误') };
  }

  const projectEntry = zip.getEntry('project.json');
  if (!projectEntry) return { success: false, error: '无效项目文件：缺少 project.json' };

  let project;
  try {
    project = JSON.parse(projectEntry.getData().toString('utf-8'));
  } catch {
    return { success: false, error: '无效项目文件：project.json 格式错误' };
  }

  if (typeof project.content !== 'string') {
    return { success: false, error: '无效项目文件：content 字段异常' };
  }

  const codeRoles = parseRoleDefs(project.content || '');
  const fileRoles = Array.isArray(project.roles) ? project.roles : [];
  const mergedRoles = [...codeRoles];
  for (const r of fileRoles) {
    if (!mergedRoles.find(m => m.id === r.id)) {
      mergedRoles.push(r);
    }
  }

  const warnings = [];
  const projectEffects = Array.isArray(project.effects) ? project.effects : [];
  const soundEntries = zip.getEntries().filter(e => e.entryName.startsWith('sounds/') && !e.isDirectory);
  const tempDir = path.join(app.getPath('temp'), 'listext-editor', 'project_' + Date.now());
  ensureDir(tempDir);

  for (const entry of soundEntries) {
    const filename = path.basename(entry.entryName);
    const out = path.join(tempDir, filename);
    try {
      fs.writeFileSync(out, entry.getData());
    } catch (e) {
      warnings.push(`音效文件「${filename}」解压失败，已跳过`);
      continue;
    }

    const existing = projectEffects.find(e => e.filename === filename);
    if (existing && !existing.path) {
      existing.path = out;
    }
  }

  // Check for effects with missing sound files
  for (const fx of projectEffects) {
    if (!fx.id) continue;
    if (fx.filename && !fx.path) {
      warnings.push(`音效「${fx.id}」引用的文件「${fx.filename}」在工程中缺失，将无法播放`);
    }
  }

  return {
    success: true,
    content: project.content || '',
    roles: mergedRoles,
    effects: projectEffects,
    title: project.title || path.basename(filePath),
    filePath,
    warnings
  };
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpegBin = ffmpegStatic || 'ffmpeg';
    execFile(ffmpegBin, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve({ stdout, stderr });
    });
  });
}

async function composeMp3(targetPath, segments) {
  ensureDir(tempDir);
  const jobDir = path.join(tempDir, 'compose_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
  ensureDir(jobDir);

  await runFfmpeg(['-version']);

  const partPaths = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const part = path.join(jobDir, 'part_' + String(i).padStart(4, '0') + '.mp3');

    if (seg.type === 'silence') {
      const dur = Math.max(0, Number(seg.duration || 0));
      if (dur <= 0) continue;
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', String(dur), '-q:a', '4', part]);
      partPaths.push(part);
      continue;
    }

    if (seg.type === 'file') {
      const args = ['-y', '-i', seg.path];
      if (seg.maxDuration && Number(seg.maxDuration) > 0) args.push('-t', String(Number(seg.maxDuration)));
      if (seg.fadeDuration && Number(seg.fadeDuration) > 0 && seg.maxDuration && Number(seg.maxDuration) > 0) {
        const st = Math.max(0, Number(seg.maxDuration) - Number(seg.fadeDuration));
        args.push('-af', 'afade=t=out:st=' + st + ':d=' + Number(seg.fadeDuration));
      }
      args.push('-ac', '2', '-ar', '44100', '-q:a', '4', part);
      await runFfmpeg(args);
      partPaths.push(part);
    }
  }

  if (!partPaths.length) return { success: false, error: '没有可合成片段' };

  const listFile = path.join(jobDir, 'concat.txt');
  const listContent = partPaths.map(p => "file '" + p.replace(/'/g, "''") + "'").join(os.EOL);
  fs.writeFileSync(listFile, listContent, 'utf-8');

  ensureDir(path.dirname(targetPath));
  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', targetPath]);

  return { success: true, filePath: targetPath };
}

function registerIpcHandlers() {
  ipcMain.handle('save-file', async (event, filePath, content, meta = {}) => {
    try { return saveProjectPackage(filePath, { content, ...meta }); }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('open-project-file', async (event, filePath) => {
    try { return openProjectPackage(filePath); }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('compose-mp3', async (event, targetPath, segments) => {
    try {
      if (!targetPath || !Array.isArray(segments)) return { success: false, error: '参数不完整' };
      return await composeMp3(targetPath, segments);
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
  ipcMain.handle('close-role-manager-window', async (event) => {
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
    return { success: true };
  });
  ipcMain.handle('open-settings-window', async () => { openSettingsWindow(); return { success: true }; });
  ipcMain.handle('open-effect-manager-window', async () => { openEffectManager(); return { success: true }; });

  ipcMain.handle('delete-file', async (event, filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return { success: true };
      }
      return { success: false, error: '文件不存在' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('save-binary', async (event, filePath, base64) => {
    if (!filePath || !base64) return { success: false, error: '参数不完整' };
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    return { success: true };
  });

  ipcMain.handle('get-audio-file', async (event, filePath) => {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath);
      return { success: true, data: data.toString('base64') };
    }
    return { success: false, error: '文件不存在' };
  });

  ipcMain.handle('cleanup-temp', async () => {
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      files.forEach(file => {
        const p = path.join(tempDir, file);
        try {
          if (fs.lstatSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true });
          else fs.unlinkSync(p);
        } catch (e) { console.error('清理临时文件失败:', e); }
      });
    }
    return { success: true };
  });

  ipcMain.handle('select-export-path', async () => {
    const { dialog, BrowserWindow } = require('electron');
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win, {
      filters: [{ name: 'MP3 Audio', extensions: ['mp3'] }],
      defaultPath: 'export.mp3'
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

  ipcMain.handle('select-directory', async (event, defaultPath) => {
    const { dialog, BrowserWindow } = require('electron');
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, {
      defaultPath: defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  ipcMain.handle('list-builtin-sounds', async () => {
    return scanBuiltInSounds();
  });

  ipcMain.handle('get-built-in-paths', async () => {
    return {
      roots: getBuiltInRoots(),
      primary: getBuiltInDir()
    };
  });

  ipcMain.handle('select-audio-file', async () => {
    const { dialog, BrowserWindow } = require('electron');
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, {
      filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }],
      properties: ['openFile']
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  const projectDataStore = { effects: [], roles: [] };

  ipcMain.handle('get-project-data', async () => {
    return projectDataStore;
  });

  ipcMain.handle('set-project-effects', async (event, effects) => {
    projectDataStore.effects = effects || [];
    const { BrowserWindow } = require('electron');
    const mainWin = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().includes('index.html'));
    if (mainWin) {
      mainWin.webContents.send('project-effects-changed', projectDataStore.effects);
    }
    return { success: true };
  });

  ipcMain.handle('set-project-roles', async (event, roles) => {
    projectDataStore.roles = roles || [];
    const { BrowserWindow } = require('electron');
    const mainWin = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().includes('index.html'));
    if (mainWin) {
      mainWin.webContents.send('project-roles-changed', projectDataStore.roles);
    }
    return { success: true };
  });
}

module.exports = {
  registerIpcHandlers,
  tempDir,
  parseRoleDefs,
  parseFxIds
};
