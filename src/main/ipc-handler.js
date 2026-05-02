const { ipcMain, shell, net, session, app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const AdmZip = require('adm-zip');
const { ensureDir } = require('./utils');
const { openRoleManager, openSettingsWindow, openEffectManager } = require('./window-manager');
const { userSoundsDir, buildEffectsMap } = require('./sound-handler');
const { loadEffectsConfig, saveEffectsConfig } = require('./config-handler');

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
  const effectMap = buildEffectsMap();
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
    zip.addFile('sounds/' + filename, buf);
    bundledSounds.push({ fxId, filename });
  }

  zip.addFile('assets-map.json', Buffer.from(JSON.stringify({ bundledSounds }, null, 2), 'utf-8'));
  ensureDir(path.dirname(safePath));
  zip.writeZip(safePath);
  return { success: true, filePath: safePath, bundled: bundledSounds.length };
}

function makeSafeProjectGroup(title) {
  const safe = String(title || '未命名项目').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  return '来自项目:' + safe;
}

function writeProjectSoundsAndMappings(zip, projectTitle) {
  const config = loadEffectsConfig();
  const group = makeSafeProjectGroup(projectTitle);
  if (!config.groups) config.groups = [];
  if (!config.groups.includes(group)) config.groups.push(group);
  if (!config.meta) config.meta = {};
  if (!config.mappings) config.mappings = {};

  const assetsMapEntry = zip.getEntry('assets-map.json');
  let bundledSounds = [];
  if (assetsMapEntry) {
    try {
      const assetsMap = JSON.parse(assetsMapEntry.getData().toString('utf-8'));
      bundledSounds = Array.isArray(assetsMap.bundledSounds) ? assetsMap.bundledSounds : [];
    } catch {}
  }

  const soundEntries = zip.getEntries().filter(e => e.entryName.startsWith('sounds/') && !e.isDirectory);
  ensureDir(userSoundsDir);

  for (const entry of soundEntries) {
    const originalFilename = path.basename(entry.entryName);
    let finalFilename = originalFilename;
    let out = path.join(userSoundsDir, finalFilename);
    let counter = 1;
    while (fs.existsSync(out)) {
      const ext = path.extname(originalFilename);
      const base = path.basename(originalFilename, ext);
      finalFilename = base + '_' + counter + ext;
      out = path.join(userSoundsDir, finalFilename);
      counter++;
    }

    fs.writeFileSync(out, entry.getData());

    const key = 'user:用户音效:' + finalFilename;
    config.meta[key] = { ...(config.meta[key] || {}), group, origin: 'lstx-import', project: projectTitle || '' };

    const mapItem = bundledSounds.find(x => x.filename === originalFilename);
    if (mapItem && mapItem.fxId) config.mappings[key] = mapItem.fxId;
  }

  saveEffectsConfig(config);
}

function openProjectPackage(filePath) {
  if (!fs.existsSync(filePath)) return { success: false, error: '文件不存在' };

  const zip = new AdmZip(filePath);
  const projectEntry = zip.getEntry('project.json');
  if (!projectEntry) return { success: false, error: '无效项目文件：缺少 project.json' };

  let project;
  try {
    project = JSON.parse(projectEntry.getData().toString('utf-8'));
  } catch {
    return { success: false, error: '无效项目文件：project.json 解析失败' };
  }

  if (typeof project.content !== 'string') {
    return { success: false, error: '无效项目文件：content 字段异常' };
  }

  writeProjectSoundsAndMappings(zip, project.title || path.basename(filePath));

  return {
    success: true,
    content: project.content || '',
    roles: Array.isArray(project.roles) ? project.roles : [],
    title: project.title || path.basename(filePath),
    filePath
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
        files.forEach(file => {
          const p = path.join(tempDir, file);
          try {
            if (fs.lstatSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true });
            else fs.unlinkSync(p);
          } catch {}
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
}

module.exports = {
  registerIpcHandlers,
  tempDir
};
