/*
 * 亿方听力大师 (ListextEditor)
 * Copyright (C) 2026 The InspireWorks Development Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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
const crypto = require('crypto');

const tempDir = path.join(app.getPath('temp'), 'ListextEditor');

// ffmpeg-static 只预置 win32 x64/ia32 二进制，Windows ARM64 上其 path 为 null；
// 但安装时包内 ffmpeg.exe（x64）实际存在，可经 Windows 内置 x64 模拟层直接运行
function resolveFfmpegBin() {
  if (ffmpegStatic) return ffmpegStatic;
  try {
    const bundled = path.join(require.resolve('ffmpeg-static/package.json'), '..',
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    if (fs.existsSync(bundled)) {
      console.warn('[FFmpeg] 当前架构无原生二进制，回退使用包内 x64 版本:', bundled);
      return bundled;
    }
  } catch { /* 解析失败走系统 PATH 兜底 */ }
  return 'ffmpeg';
}

function normalizeExt(filePath) {
  if (!filePath) return filePath;
  return filePath.toLowerCase().endsWith('.lstx') ? filePath : `${filePath}.lstx`;
}

// linux 发行版 ID（/etc/os-release 的 ID 字段，小写），用于识别统信 UOS/深度等国产系统
function getLinuxDistro() {
  if (process.platform !== 'linux') return null;
  try {
    const text = fs.readFileSync('/etc/os-release', 'utf-8');
    const m = text.match(/^ID=(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '').toLowerCase() : null;
  } catch {
    return null;
  }
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
    content,
    mode: payload?.mode || 'block',
    roles: mergedRoles,
    effects: projectEffects
  }, null, 2), 'utf-8'));

  // 引用的全部音效（含内置音效）都打入 sounds/<fxId>/，保证工程自包含。
  // 旧工程包内已有副本而本次源文件缺失的，沿用旧副本，避免"保存即丢音效"
  const oldSoundEntries = new Map();
  if (fs.existsSync(safePath)) {
    try {
      const oldZip = new AdmZip(fileLocker.isLocked(safePath) ? fileLocker.readLocked(safePath) : safePath);
      for (const e of oldZip.getEntries()) {
        if (e.entryName.startsWith('sounds/') && !e.isDirectory) {
          const parts = e.entryName.split('/');
          const fxId = parts.length >= 3 ? parts[1] : null;
          if (fxId && !oldSoundEntries.has(fxId)) oldSoundEntries.set(fxId, e);
        }
      }
    } catch { /* 旧包读取失败则按无旧副本处理 */ }
  }

  // 工程自包含：被引用的音效 + 项目里全部自定义（非内置）音效都打入 sounds/<fxId>/，
  // 自定义音效随工程走，不依赖全局素材库
  const packFxIds = new Set(usedFxIds);
  for (const e of projectEffects) {
    if (e?.id && e.source !== 'builtin') packFxIds.add(e.id);
  }

  for (const fxId of packFxIds) {
    const effect = projectEffects.find(e => e.id === fxId);
    if (!effect) continue;

    const absPath = resolveEffectPath(effect);
    if (absPath && fs.existsSync(absPath)) {
      const filename = path.basename(absPath);
      const buf = fs.readFileSync(absPath);
      zip.addFile(`sounds/${fxId}/${filename}`, buf);
    } else if (oldSoundEntries.has(fxId)) {
      const old = oldSoundEntries.get(fxId);
      zip.addFile(old.entryName, old.getData());
    }
  }

  const missingSounds = [];
  for (const fxId of packFxIds) {
    const effect = projectEffects.find(e => e.id === fxId);
    if (!effect) {
      missingSounds.push(`音效 "${fxId}" 未在项目中配置，保存后将无法播放`);
      continue;
    }
    const absPath = resolveEffectPath(effect);
    if (!absPath || !fs.existsSync(absPath)) {
      if (oldSoundEntries.has(fxId)) {
        missingSounds.push(`音效 "${fxId}" 的源文件 "${effect.filename || '未知'}" 在磁盘上不存在，已保留工程内旧副本`);
      } else if (usedFxIds.includes(fxId)) {
        missingSounds.push(`音效 "${fxId}" 的文件 "${effect.filename || '未知'}" 在磁盘上不存在，保存后将无法播放`);
      } else {
        missingSounds.push(`音效 "${fxId}" 的文件 "${effect.filename || '未知'}" 在磁盘上不存在，未打入工程包`);
      }
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

  // 清理 7 天未使用的工程音效解压目录（重开工程会重新解压，自愈合）
  try {
    const psRoot = path.join(app.getPath('userData'), 'project-sounds');
    if (fs.existsSync(psRoot)) {
      const now = Date.now();
      for (const d of fs.readdirSync(psRoot)) {
        const p = path.join(psRoot, d);
        try {
          const st = fs.statSync(p);
          if (now - st.mtimeMs > 7 * 24 * 3600 * 1000) fs.rmSync(p, { recursive: true, force: true });
        } catch { /* 忽略单目录清理失败 */ }
      }
    }
  } catch { /* 忽略清理失败 */ }

  const soundEntries = zip.getEntries().filter(e => e.entryName.startsWith('sounds/') && !e.isDirectory);
  // 解压到 userData/project-sounds/<工程路径哈希>/：稳定目录，不受 24h 临时清理影响；
  // 同工程重复打开=清空重建，无残留泄漏
  const projKey = crypto.createHash('sha1').update(String(filePath)).digest('hex').slice(0, 16);
  const projectTempDir = path.join(app.getPath('userData'), 'project-sounds', projKey);
  try { fs.rmSync(projectTempDir, { recursive: true, force: true }); } catch {}
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
    filePath,
    warnings
  };
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpegBin = resolveFfmpegBin();
    execFile(ffmpegBin, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        // ffmpeg 报错会把版本 banner 和编译配置全喷出来，只留最后几行有用信息
        const lines = String(stderr || error.message || '').split('\n')
          .map(l => l.trim()).filter(Boolean);
        reject(new Error(lines.slice(-5).join('\n')));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// ffmpeg 是外部进程，读不了 asar 虚拟路径；asar 内的文件先落临时目录
function stageIfInAsar(filePath, jobDir, index) {
  if (!filePath || !filePath.includes('.asar')) return filePath;
  try {
    const data = fs.readFileSync(filePath);
    const staged = path.join(jobDir, `staged_${index}${path.extname(filePath) || '.mp3'}`);
    fs.writeFileSync(staged, data);
    return staged;
  } catch (e) {
    console.warn('[导出] asar 内文件落盘失败，按原路径尝试:', filePath, e.message);
    return filePath;
  }
}

// 探测音频实际时长（秒）：LRC 字幕需要逐片段精确时间轴
async function probeDuration(file) {
  try {
    const { stderr } = await runFfmpeg(['-i', file, '-f', 'null', '-']);
    const m = String(stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  } catch (e) {
    console.warn('[导出] 片段时长探测失败:', file, e.message);
  }
  return 0;
}

async function composeMp3(targetPath, segments, skipWatermark = false, options = {}) {
  ensureDir(tempDir);
  const jobDir = path.join(tempDir, 'compose_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
  ensureDir(jobDir);

  await runFfmpeg(['-version']);

  const partPaths = [];
  const durations = []; // options.withDurations 时逐片段探测时长，供上层生成 LRC
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const part = path.join(jobDir, 'part_' + String(i).padStart(4, '0') + '.mp3');

    if (seg.type === 'silence') {
      const dur = Math.max(0, Number(seg.duration || 0));
      if (dur <= 0) continue;
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', String(dur), '-q:a', '4', part]);
      partPaths.push(part);
      if (options.withDurations) durations.push(dur);
      continue;
    }

    if (seg.type === 'file') {
      const inputPath = stageIfInAsar(seg.path, jobDir, i);
      const args = ['-y', '-i', inputPath];
      if (seg.maxDuration && Number(seg.maxDuration) > 0) args.push('-t', String(Number(seg.maxDuration)));
      if (seg.fadeDuration && Number(seg.fadeDuration) > 0 && seg.maxDuration && Number(seg.maxDuration) > 0) {
        const st = Math.max(0, Number(seg.maxDuration) - Number(seg.fadeDuration));
        args.push('-af', 'afade=t=out:st=' + st + ':d=' + Number(seg.fadeDuration));
      }
      args.push('-ac', '2', '-ar', '44100', '-q:a', '4', part);
      await runFfmpeg(args);
      partPaths.push(part);
      // 截断/淡出后的实际时长以输出文件为准，不能用输入时长
      if (options.withDurations) durations.push(await probeDuration(part));
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
    // 打包后水印在 app.asar 内，ffmpeg 是外部进程读不了 asar 虚拟路径，
    // 先用 Electron 的 fs（能读 asar）把水印落到任务目录，再交给 ffmpeg
    let wmData = null;
    for (const p of [
      path.join(app.getAppPath(), 'assets', 'freeWatermark.mp3'),
      path.join(process.cwd(), 'assets', 'freeWatermark.mp3')
    ]) {
      try { wmData = fs.readFileSync(p); break; } catch {}
    }

    if (wmData) {
      const wmLocal = path.join(jobDir, 'watermark.mp3');
      fs.writeFileSync(wmLocal, wmData);
      const wmList = path.join(jobDir, 'wm_concat.txt');
      fs.writeFileSync(wmList,
        "file '" + rawOutput.replace(/'/g, "''") + "'\n" +
        "file '" + wmLocal.replace(/'/g, "''") + "'\n", 'utf-8');
      await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', wmList,
        '-metadata', 'artist=亿方听力大师',
        '-c', 'copy', targetPath]);
      return { success: true, filePath: targetPath, durations: options.withDurations ? durations : undefined };
    }
    console.error('[导出] 免费版水印文件缺失，导出将不带水印');
  }

  await runFfmpeg(['-y', '-i', rawOutput, '-metadata', 'artist=亿方听力大师', '-c', 'copy', targetPath]);
  return { success: true, filePath: targetPath, durations: options.withDurations ? durations : undefined };
}

function registerIpcHandlers() {
  ipcMain.handle('save-file', async (event, filePath, content, meta = {}) => {
    try { return saveProjectPackage(filePath, { content, ...meta }); }
    catch (error) { console.error('[IPC失败] save-file:', error.message); return { success: false, error: error.message }; }
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
      // 业务性失败（文件损坏/不存在等）也落日志
      if (!result?.success) console.error('[打开工程失败]', filePath, result?.error);
      return result;
    }
    catch (error) { console.error('[IPC失败] open-project-file:', error.message); return { success: false, error: error.message }; }
  });

  ipcMain.handle('check-ffmpeg', async () => {
    try {
      await runFfmpeg(['-version']);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('compose-mp3', async (event, targetPath, segments, skipWatermark, options) => {
    try {
      if (!targetPath || !Array.isArray(segments)) return { success: false, error: '参数不完整' };
      return await composeMp3(targetPath, segments, skipWatermark, options);
    } catch (error) {
      console.error('[IPC失败] compose-mp3:', error.message);
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

  ipcMain.handle('select-project-path', async (event, defaultName) => {
    const { dialog, BrowserWindow } = require('electron');
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win, {
      filters: [{ name: 'Listext Project', extensions: ['lstx'] }],
      // 默认文件名跟随标签当前标题，避免与标题栏显示不一致
      defaultPath: defaultName || 'untitled.lstx'
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

  // 导入音效：复制到应用受控目录（userData/imported-sounds），源文件删/移不再影响工程
  ipcMain.handle('import-audio-file', async (event, srcPath) => {
    try {
      if (!srcPath || typeof srcPath !== 'string' || !fs.existsSync(srcPath)) {
        return { success: false, error: '文件不存在' };
      }
      const dir = path.join(app.getPath('userData'), 'imported-sounds');
      ensureDir(dir);
      const ext = path.extname(srcPath);
      const base = path.basename(srcPath, ext);
      let candidate = path.join(dir, base + ext);
      // 内容一致的同名文件直接复用，否则加序号
      let n = 1;
      while (fs.existsSync(candidate)) {
        try {
          if (fs.readFileSync(candidate).equals(fs.readFileSync(srcPath))) {
            return { success: true, path: candidate };
          }
        } catch {}
        candidate = path.join(dir, `${base}-${n}${ext}`);
        n++;
      }
      fs.copyFileSync(srcPath, candidate);
      return { success: true, path: candidate };
    } catch (e) {
      return { success: false, error: e.message || '导入失败' };
    }
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
    arch: process.arch,
    distro: getLinuxDistro()
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
