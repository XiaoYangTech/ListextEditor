const { ipcMain, shell, app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const AdmZip = require('adm-zip');
const { ensureDir } = require('./utils');
const { openSettingsWindow } = require('./window-manager');
const { getBuiltInDir, getBuiltInRoots, scanBuiltInSounds } = require('./sound-handler');
const fileLocker = require('./file-locker');

const tempDir = path.join(app.getPath('temp'), 'listext-editor');

function normalizeExt(filePath) {
  if (!filePath) return filePath;
  return filePath.toLowerCase().endsWith('.lstx') ? filePath : `${filePath}.lstx`;
}

function parseFxIds(content) {
  const ids = new Set();
  const regex = /<fx\s+[^>]*id\s*=\s*["']([^"']+)["'][^>]*>/gi;
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
    if (attrs.id && !roles.some(r => r.id === attrs.id)) {
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

  // 代码中手写引用但未加入项目的内置音效，补录进工程配置，保证自包含
  for (const fxId of usedFxIds) {
    if (!projectEffects.find(e => e.id === fxId)) {
      const builtin = builtInSounds.find(s => s.id === fxId);
      if (builtin) {
        projectEffects.push({ id: builtin.id, source: 'builtin', filename: builtin.filename, group: builtin.group });
      }
    }
  }

  const resolveEffectPath = (effect) => {
    if (!effect) return null;
    if (effect.path) return effect.path;
    if (effect.source === 'builtin') {
      const builtin = builtInSounds.find(s => s.id === effect.id || s.filename === effect.filename);
      if (builtin) return builtin.path;
    }
    return null;
  };

  zip.addFile('project.json', Buffer.from(JSON.stringify({
    version: 1,
    title: tabTitle,
    content,
    mode: payload?.mode || 'block',
    roles: mergedRoles,
    effects: projectEffects
  }, null, 2), 'utf-8'));

  // 引用的全部音效（含内置音效）都打入 sounds/<fxId>/，保证工程自包含
  for (const fxId of usedFxIds) {
    const effect = projectEffects.find(e => e.id === fxId);
    if (!effect) continue;

    const absPath = resolveEffectPath(effect);
    if (absPath && fs.existsSync(absPath)) {
      const filename = path.basename(absPath);
      const buf = fs.readFileSync(absPath);
      zip.addFile(`sounds/${fxId}/${filename}`, buf);
    }
  }

  const missingSounds = [];
  for (const fxId of usedFxIds) {
    const effect = projectEffects.find(e => e.id === fxId);
    if (!effect) {
      missingSounds.push(`音效 "${fxId}" 未在项目中配置，保存后将无法播放`);
      continue;
    }
    const absPath = resolveEffectPath(effect);
    if (!absPath || !fs.existsSync(absPath)) {
      missingSounds.push(`音效 "${fxId}" 的文件 "${effect.filename || '未知'}" 在磁盘上不存在，保存后将无法播放`);
    }
  }

  ensureDir(path.dirname(safePath));
  if (fileLocker.isLocked(safePath)) {
    // 本进程持有排他锁：经锁 fd 写入（Windows 排他锁会拒绝经其他句柄写入）
    if (!fileLocker.writeLocked(safePath, zip.toBuffer())) {
      throw new Error('文件写入失败：文件处于锁定状态');
    }
  } else {
    zip.writeZip(safePath);
  }
  return { success: true, filePath: safePath, warnings: missingSounds };
}

// buffer：本进程持有文件锁时经锁 fd 读出的内容（Windows 排他锁会拒绝经其他句柄读取）
function openProjectPackage(filePath, buffer) {
  if (!buffer && !fs.existsSync(filePath)) return { success: false, error: '文件不存在' };

  let zip;
  try {
    zip = buffer ? new AdmZip(buffer) : new AdmZip(filePath);
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

  // 清理 24 小时前的历史解压目录，避免临时目录膨胀
  try {
    if (fs.existsSync(tempDir)) {
      const now = Date.now();
      for (const d of fs.readdirSync(tempDir)) {
        if (!d.startsWith('project_')) continue;
        const p = path.join(tempDir, d);
        try {
          const st = fs.statSync(p);
          if (now - st.mtimeMs > 24 * 3600 * 1000) fs.rmSync(p, { recursive: true, force: true });
        } catch { /* 忽略单目录清理失败 */ }
      }
    }
  } catch { /* 忽略清理失败 */ }

  const soundEntries = zip.getEntries().filter(e => e.entryName.startsWith('sounds/') && !e.isDirectory);
  const projectTempDir = path.join(tempDir, 'project_' + Date.now());
  ensureDir(projectTempDir);

  for (const entry of soundEntries) {
    // 新版布局 sounds/<fxId>/<filename>，兼容旧版 sounds/<filename>
    const parts = entry.entryName.split('/');
    const fxId = parts.length >= 3 ? parts[1] : null;
    const filename = path.basename(entry.entryName);
    const safeId = fxId ? fxId.replace(/[\/\\]/g, '_').replace(/\.\.+/g, '_') : null;
    const outDir = safeId ? path.join(projectTempDir, safeId) : projectTempDir;
    const out = path.join(outDir, filename);
    try {
      ensureDir(outDir);
      fs.writeFileSync(out, entry.getData());
    } catch (e) {
      warnings.push(`音效文件「${filename}」解压失败，已跳过`);
      continue;
    }

    const existing = fxId
      ? projectEffects.find(e => e.id === fxId)
      : projectEffects.find(e => e.filename === filename);
    if (existing) {
      existing.path = out;
    }
  }

  for (const fx of projectEffects) {
    if (!fx.id) continue;
    if (fx.filename && !fx.path) {
      warnings.push(`音效「${fx.id}」引用的文件「${fx.filename}」在工程中缺失，将无法播放`);
    }
  }

  return {
    success: true,
    content: project.content || '',
    mode: project.mode || 'block',
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

async function composeMp3(targetPath, segments, skipWatermark = false) {
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

  const rawOutput = path.join(jobDir, 'raw_output.mp3');
  const listFile = path.join(jobDir, 'concat.txt');
  const listContent = partPaths.map(p => "file '" + p.replace(/'/g, "''") + "'").join(os.EOL);
  fs.writeFileSync(listFile, listContent, 'utf-8');

  ensureDir(path.dirname(targetPath));
  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', rawOutput]);

  if (!skipWatermark) {
    const wm = path.join(app.getAppPath(), 'assets', 'freeWatermark.mp3');
    const wmDev = path.join(process.cwd(), 'assets', 'freeWatermark.mp3');
    const wmPath = fs.existsSync(wm) ? wm : (fs.existsSync(wmDev) ? wmDev : null);

    if (wmPath) {
      const wmList = path.join(jobDir, 'wm_concat.txt');
      fs.writeFileSync(wmList,
        "file '" + rawOutput.replace(/'/g, "''") + "'\n" +
        "file '" + wmPath.replace(/'/g, "''") + "'\n", 'utf-8');
      await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', wmList,
        '-metadata', 'artist=亿方听力大师',
        '-c', 'copy', targetPath]);
      return { success: true, filePath: targetPath };
    }
  }

  await runFfmpeg(['-y', '-i', rawOutput, '-metadata', 'artist=亿方听力大师', '-c', 'copy', targetPath]);
  return { success: true, filePath: targetPath };
}

function registerIpcHandlers() {
  ipcMain.handle('save-file', async (event, filePath, content, meta = {}) => {
    try { return saveProjectPackage(filePath, { content, ...meta }); }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('open-project-file', async (event, filePath) => {
    try {
      if (fileLocker.isLocked(filePath)) {
        return { success: false, error: '该文件已在其他标签页中打开' };
      }
      const lockResult = fileLocker.lock(filePath);
      if (lockResult === false) {
        return { success: false, error: '文件正在被其他程序占用，无法打开' };
      }
      const lockedBuf = lockResult === true ? fileLocker.readLocked(filePath) : null;
      const result = openProjectPackage(filePath, lockedBuf);
      // 打开失败时释放文件锁，避免同一文件后续被误报"已在其他标签页中打开"
      if (!result?.success && lockResult === true) fileLocker.unlock(filePath);
      return result;
    }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('check-ffmpeg', async () => {
    try {
      await runFfmpeg(['-version']);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('compose-mp3', async (event, targetPath, segments, skipWatermark) => {
    try {
      if (!targetPath || !Array.isArray(segments)) return { success: false, error: '参数不完整' };
      return await composeMp3(targetPath, segments, skipWatermark);
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('open-external', async (event, url) => {
    if (!url || !/^https?:\/\//i.test(url)) return { success: false };
    await shell.openExternal(url);
    return { success: true };
  });

  ipcMain.handle('open-settings-window', async () => { openSettingsWindow(); return { success: true }; });

  ipcMain.handle('release-file-lock', async (event, filePath) => {
    fileLocker.unlock(filePath);
    return { success: true };
  });

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

  ipcMain.handle('file-exists', async (event, filePath) => {
    return fs.existsSync(filePath);
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

  ipcMain.handle('set-project-effects', async (event, effects, opts) => {
    projectDataStore.effects = effects || [];
    if (opts?.silent) return { success: true };
    const { BrowserWindow } = require('electron');
    const mainWin = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().includes('index.html'));
    if (mainWin) {
      mainWin.webContents.send('project-effects-changed', projectDataStore.effects);
    }
    return { success: true };
  });

  ipcMain.handle('set-project-roles', async (event, roles, opts) => {
    projectDataStore.roles = roles || [];
    if (opts?.silent) return { success: true };
    const { BrowserWindow } = require('electron');
    const mainWin = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().includes('index.html'));
    if (mainWin) {
      mainWin.webContents.send('project-roles-changed', projectDataStore.roles);
    }
    return { success: true };
  });

  ipcMain.handle('get-app-info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch
  }));

  ipcMain.handle('set-toolbar-align', async (event, align) => {
    const { BrowserWindow } = require('electron');
    const mainWin = BrowserWindow.getAllWindows().find(
      w => !w.isDestroyed() && w.webContents.getURL().includes('index.html')
    );
    if (mainWin) mainWin.webContents.send('toolbar-align-changed', align);
    return { success: true };
  });
}

app.on('will-quit', () => { fileLocker.unlockAll(); });

module.exports = {
  registerIpcHandlers,
  tempDir,
  parseRoleDefs,
  parseFxIds
};
