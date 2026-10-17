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
const { execFile, spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const AdmZip = require('adm-zip');
const { ensureDir } = require('./utils');
const { openSettingsWindow } = require('./window-manager');
const { getBuiltInDir, getBuiltInRoots, scanBuiltInSounds } = require('./sound-handler');
const fileLocker = require('./file-locker');
const crypto = require('crypto');

const tempDir = path.join(app.getPath('temp'), 'ListextEditor');

// ffmpeg-static 的架构白名单不全（win32 无 arm64），且 Linux arm64 包在 x64 机器上交叉构建时
// 其导出路径指向的二进制实际不存在；统一先验文件存在，缺失时回退到包内文件再兜底系统 PATH
function resolveFfmpegBin() {
  if (ffmpegStatic && fs.existsSync(ffmpegStatic)) return ffmpegStatic;
  try {
    const bundled = path.join(require.resolve('ffmpeg-static/package.json'), '..',
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    if (fs.existsSync(bundled)) {
      if (!ffmpegStatic) console.warn('[FFmpeg] 当前架构无原生二进制，回退使用包内 x64 版本:', bundled);
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
    // maxBuffer 必须放宽：ebur128 等滤镜会给长音频打大量 stderr（20 分钟约 4MB），
    // 默认 1MB 会抛 ERR_CHILD_PROCESS_STDIO_MAXBUFFER，长音频会因此静默走回退逻辑
    execFile(ffmpegBin, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
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

// 带进度的 ffmpeg 调用：解析 `-progress pipe:1` 输出的 out_time_ms（单位其实是微秒）回调已处理时长
function runFfmpegStreaming(args, onOutTimeSec) {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveFfmpegBin(), args, { windowsHide: true });
    let stderr = '';
    proc.stdout.on('data', (buf) => {
      for (const m of String(buf).matchAll(/out_time_ms=(\d+)/g)) {
        try { onOutTimeSec?.(Number(m[1]) / 1e6); } catch { /* 忽略进度回调异常 */ }
      }
    });
    // 只为报错保留最后一段输出，避免长任务把内存吃满
    proc.stderr.on('data', (buf) => { stderr = (stderr + String(buf)).slice(-8000); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) return resolve({ stderr });
      const lines = stderr.split('\n').map(l => l.trim()).filter(Boolean);
      reject(new Error(lines.slice(-5).join('\n') || `ffmpeg 退出码 ${code}`));
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

// 导出音频的 ID3 标签（水印分支 / 无水印分支 / 音质劣化分支共用）
const MP3_METADATA_ARGS = [
  '-metadata', 'title=本音频使用亿方听力大师免费制作',
  '-metadata', 'artist=官网lstx.yfyw.top',
  '-metadata', 'album=亿方听力大师'
];

// 音质损伤（炸麦效果）：先用增益把信号怼进硬削波、叠加位深压缩，再把整体响度拉满，
// 模拟考场喇叭/劣质麦克风过载的破音。滑块同时控制「失真程度」和「音量」：
// 损坏越狠 → 削波越重、响度越高（100% 时整体响度拉到约 0 LUFS，与 B 站全损音质梗曲同一量级）。
// 频响只轻微收窄（参考梗曲 >4kHz 仅低约 2dB），主要靠削波和响度制造「炸」感。
function buildDegradeFilter(level) {
  const l = Math.max(1, Math.min(100, Math.round(Number(level) || 0)));
  const t = l / 100;
  const hp = Math.round(120 + t * 180);       // 120 → 300 Hz：轻收低频
  const lp = Math.round(8000 - t * 2500);     // 8000 → 5500 Hz：轻微收高频（不闷）
  const driveDb = +(8 + t * 24).toFixed(1);   // +8 → +32 dB：把波形怼成砖墙
  const clipThreshold = +(1.0 - t * 0.5).toFixed(2); // 1.0 → 0.5：削波越来越狠
  const ratio = +(4 + t * 2).toFixed(1);      // 4 → 6：动态压得越来越扁
  const chain = [
    `highpass=f=${hp}`,
    `lowpass=f=${lp}`,
    `acompressor=threshold=-30dB:ratio=${ratio}:attack=4:release=80`,
    `volume=${driveDb}dB`,
    `asoftclip=type=hard:threshold=${clipThreshold}`
  ];
  if (l >= 60) {
    const bits = Math.max(6, Math.round(12 - t * 6)); // 12 → 6 bit，颗粒感/破音
    const mix = +(0.15 + t * 0.35).toFixed(2);
    chain.push(`acrusher=bits=${bits}:mix=${mix}:mode=log`);
  }
  return {
    af: chain.join(','),
    ac: l >= 60 ? 1 : 2,
    ar: l >= 85 ? 16000 : (l >= 50 ? 22050 : 44100),
    abr: l >= 85 ? '48k' : (l >= 50 ? '64k' : '96k'),
    level: l, driveDb, clipThreshold
  };
}

// 解析 ffmpeg ebur128 输出的整体响度（LUFS）：Summary 里以 "I:" 开头的那行
function parseLoudness(stderr) {
  const matches = [...String(stderr || '').matchAll(/^\s*I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/gm)];
  if (!matches.length) return null;
  const v = Number(matches[matches.length - 1][1]);
  return Number.isFinite(v) ? v : null;
}

// 测量一段音频（可选先过滤镜链）的整体响度，供响度归一化用
// framelog=quiet：关掉 ebur128 每 100ms 一行的逐帧日志，只保留结尾 Summary，
// 否则长音频（20 分钟约 4MB）会撑爆 execFile 默认 1MB 的 stderr 缓冲
async function measureLoudness(filePath, afPrefix) {
  const af = afPrefix
    ? `${afPrefix},ebur128=peak=true:framelog=quiet`
    : 'ebur128=peak=true:framelog=quiet';
  const { stderr } = await runFfmpeg(['-hide_banner', '-nostdin', '-i', filePath, '-af', af, '-f', 'null', '-']);
  return parseLoudness(stderr);
}

// 单次解码同时测「源响度」与「劣化链响度」：asplit 两路各接一个 ebur128，两路输出到 null 设备。
// 比两次独立解码少一次完整解码（180 秒素材实测 ~8.5s → ~6.3s）。
// 两个 ebur128 的 Summary 块靠**滤镜实例序号**区分：源分支的 ebur128 在滤镜串里先创建、序号更小。
async function measureLoudnessPair(inputPath, chainAf) {
  const filterComplex = `[0:a]asplit=2[src][proc];[src]ebur128=peak=true:framelog=quiet[s];[proc]${chainAf},ebur128=peak=true:framelog=quiet[p]`;
  const { stderr } = await runFfmpeg(['-hide_banner', '-nostdin', '-i', inputPath,
    '-filter_complex', filterComplex,
    '-map', '[s]', '-f', 'null', os.devNull,
    '-map', '[p]', '-f', 'null', os.devNull]);
  const log = String(stderr || '');
  // 每个 ebur128 结束时打印一个 Summary 块；按实例序号排序后：第一个是源、第二个是劣化链
  const heads = [...log.matchAll(/\[Parsed_ebur128_(\d+)[^\]]*\]\s*Summary:/g)];
  const blocks = heads.map((m, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : log.length;
    const seg = log.slice(m.index, end);
    const im = seg.match(/^\s*I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/m);
    return { idx: Number(m[1]), lufs: im ? Number(im[1]) : null };
  }).filter(b => Number.isFinite(b.lufs)).sort((a, b) => a.idx - b.idx);
  return {
    srcLufs: blocks[0]?.lufs ?? null,
    chainLufs: blocks[1]?.lufs ?? null
  };
}

// 把已合成的成品整体劣化：滤镜链改变不了容器里的编码参数，必须重编码。
// 响度归一化：把滑块进度 t 映射成「源响度 → 0 LUFS」的目标响度（不降低、不越界），
// 增益后再硬削波，保证音量足够「炸」且与参考梗曲同量级。
// onProgress({stage, percent}) 用于向渲染层上报进度：measure（测响度）→ encode（生成）→ done
async function degradeAudio(inputPath, outputPath, level, onProgress) {
  const cfg = buildDegradeFilter(level);
  const t = Math.max(0, Math.min(100, Math.round(Number(level) || 0))) / 100;
  const report = (stage, percent) => { try { onProgress?.({ stage, percent }); } catch { /* 忽略进度回调异常 */ } };

  report('measure', 5);
  // 一次解码同时测两路响度；若合并测量解析失败（滤镜串/日志格式变化），回退到两次独立测量
  let srcLufs = null;
  let chainLufs = null;
  try {
    const pair = await measureLoudnessPair(inputPath, cfg.af);
    srcLufs = pair.srcLufs;
    chainLufs = pair.chainLufs;
  } catch (e) {
    console.warn('[全损] 合并响度测量失败，回退两次独立测量:', e.message);
  }
  if (chainLufs == null) {
    const [s, c] = await Promise.all([
      measureLoudness(inputPath, null).catch(() => null),
      measureLoudness(inputPath, cfg.af).catch(() => null)
    ]);
    srcLufs = srcLufs ?? s;
    chainLufs = c;
  }

  let targetLufs = null;
  let gainDb = 0;
  if (Number.isFinite(chainLufs)) {
    // 目标响度：源响度与 0 LUFS 之间按滑块插值；且不低于滤镜链本身的响度（只增不减）
    const base = Number.isFinite(srcLufs) ? srcLufs : chainLufs;
    targetLufs = Math.max(chainLufs, base + (0 - base) * t);
    gainDb = Math.max(0, Math.min(40, targetLufs - chainLufs));
  }
  report('encode', 45);

  const finalAf = cfg.af
    + (gainDb >= 0.1 ? `,volume=${gainDb.toFixed(1)}dB` : '')
    + ',asoftclip=type=hard:threshold=1.0';
  const totalDur = await probeDuration(inputPath);
  await runFfmpegStreaming(['-y', '-hide_banner', '-nostdin', '-i', inputPath, '-af', finalAf,
    '-ac', String(cfg.ac), '-ar', String(cfg.ar),
    '-c:a', 'libmp3lame', '-b:a', cfg.abr,
    ...MP3_METADATA_ARGS, '-progress', 'pipe:1', '-nostats', outputPath], (sec) => {
    if (!totalDur || totalDur <= 0) return;
    const ratio = Math.max(0, Math.min(1, sec / totalDur));
    report('encode', Math.round(45 + ratio * 54));
  });
  report('done', 100);
  return {
    ...cfg,
    af: finalAf,
    gainDb: Number(gainDb.toFixed(1)),
    srcLufs,
    chainLufs: Number.isFinite(chainLufs) ? Number(chainLufs.toFixed(1)) : null,
    targetLufs: Number.isFinite(targetLufs) ? Number(targetLufs.toFixed(1)) : null
  };
}

async function composeMp3(targetPath, segments, skipWatermark = false, options = {}) {
  ensureDir(tempDir);
  const jobDir = path.join(tempDir, 'compose_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
  ensureDir(jobDir);
  // 合成进度上报（渲染层把条形进度映射到 80%~98%，避免长时间停在 80% 看起来卡住）
  const report = (percent, stage) => { try { options.onProgress?.({ percent, stage }); } catch { /* 忽略进度回调异常 */ } };

  await runFfmpeg(['-version']);

  const partPaths = [];
  const durations = []; // options.withDurations 时逐片段探测时长，供上层生成 LRC
  for (let i = 0; i < segments.length; i++) {
    report(Math.round((i / Math.max(1, segments.length)) * 62), `正在合成片段 ${i + 1}/${segments.length}`);
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
  report(66, '正在合并音频片段');
  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', rawOutput]);

  // 音质损伤（0-100）：>0 时先合成未劣化的成品，再整体过一遍劣化滤镜链输出到目标文件；
  // =0 走原来的 -c copy 快路径，输出与历史版本完全一致。
  const degrade = Math.max(0, Math.min(100, Math.round(Number(options.degrade) || 0)));
  const muxTarget = degrade > 0 ? path.join(jobDir, 'final_raw.mp3') : targetPath;
  let watermarkDuration = 0;
  let muxed = false;

  // 水印为可选：skipWatermark 由渲染层复选框决定；加水印时拼在音频开头
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
      // 水印置开头占用的实际时长：LRC 正文时间轴要整体后移这段时长，避免字幕提前
      watermarkDuration = options.withDurations ? await probeDuration(wmLocal) : 0;
      const wmList = path.join(jobDir, 'wm_concat.txt');
      // 水印置开头：先水印后正文
      fs.writeFileSync(wmList,
        "file '" + wmLocal.replace(/'/g, "''") + "'\n" +
        "file '" + rawOutput.replace(/'/g, "''") + "'\n", 'utf-8');
      await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', wmList,
        ...MP3_METADATA_ARGS, '-c', 'copy', muxTarget]);
      muxed = true;
    } else {
      console.error('[导出] 水印文件缺失，导出将不带水印');
    }
  }

  if (!muxed) {
    report(70, '正在封装输出');
    await runFfmpeg(['-y', '-i', rawOutput, ...MP3_METADATA_ARGS, '-c', 'copy', muxTarget]);
  }

  let degradeInfo = null;
  if (muxTarget !== targetPath) {
    report(72, '正在做音质劣化');
    degradeInfo = await degradeAudio(muxTarget, targetPath, degrade, ({ stage, percent }) => {
      // 劣化自身 0~100 映射到 72~98
      const p = Number.isFinite(Number(percent)) ? Number(percent) : 0;
      report(72 + Math.round(Math.min(100, Math.max(0, p)) * 0.26), stage === 'measure' ? '正在测量响度' : '正在做音质劣化');
    });
  }
  report(100, '完成');

  return {
    success: true,
    filePath: targetPath,
    durations: options.withDurations ? durations : undefined,
    watermarkDuration: options.withDurations ? watermarkDuration : undefined,
    degrade: degrade || undefined,
    degradeInfo: degradeInfo || undefined
  };
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
      const sender = event.sender;
      const onProgress = (p) => { try { if (!sender.isDestroyed()) sender.send('compose-progress', p); } catch { /* 忽略 */ } };
      return await composeMp3(targetPath, segments, skipWatermark, { ...(options || {}), onProgress });
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

  // 混音小工具：选择输出文件
  ipcMain.handle('select-audio-save-path', async (event, defaultName) => {
    const { dialog, BrowserWindow } = require('electron');
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win, {
      filters: [{ name: 'MP3 Audio', extensions: ['mp3'] }],
      defaultPath: defaultName || '混音输出.mp3'
    });
    return result.canceled ? null : result.filePath;
  });

  // 混音小工具：给音频加背景音乐（可调原声/BGM 音量、BGM 循环填充与结尾淡出）
  ipcMain.handle('mix-audio', async (event, opts) => {
    try {
      const o = opts || {};
      const voicePath = typeof o.voicePath === 'string' ? o.voicePath : '';
      const bgmPath = typeof o.bgmPath === 'string' ? o.bgmPath : '';
      if (!voicePath || !fs.existsSync(voicePath)) return { success: false, error: '原声文件不存在' };
      if (!bgmPath || !fs.existsSync(bgmPath)) return { success: false, error: '背景音乐文件不存在' };

      const voiceVolume = Math.min(4, Math.max(0, Number(o.voiceVolume ?? 1)));
      const bgmVolume = Math.min(4, Math.max(0, Number(o.bgmVolume ?? 0.3)));
      const loopBgm = o.loopBgm !== false;
      const fadeOut = Math.min(60, Math.max(0, Number(o.fadeOut ?? 3)));
      const isPreview = !o.targetPath || o.preview === true;

      ensureDir(tempDir);
      const jobDir = path.join(tempDir, 'mix_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
      ensureDir(jobDir);

      // 原声时长决定成品长度（duration=first）与 BGM 淡出起点
      const voiceDur = await probeDuration(voicePath);
      if (!voiceDur || voiceDur <= 0) return { success: false, error: '无法读取原声时长，请确认文件为有效音频' };

      const bgmFilters = [`volume=${bgmVolume.toFixed(3)}`];
      if (fadeOut > 0) {
        const st = Math.max(0, voiceDur - fadeOut);
        bgmFilters.push(`afade=t=out:st=${st.toFixed(3)}:d=${fadeOut}`);
      }
      // normalize=0：避免 amix 默认按输入数衰减整体音量
      const filter = `[0:a]volume=${voiceVolume.toFixed(3)}[v];[1:a]${bgmFilters.join(',')}[b];[v][b]amix=inputs=2:duration=first:normalize=0[aout]`;

      let outPath;
      if (isPreview) {
        outPath = path.join(jobDir, 'preview.mp3');
      } else {
        outPath = String(o.targetPath);
        if (!/\.mp3$/i.test(outPath)) outPath = outPath.replace(/\.[^.\/\\]+$/, '') + '.mp3';
        ensureDir(path.dirname(outPath));
      }

      const args = ['-y', '-i', voicePath];
      if (loopBgm) args.push('-stream_loop', '-1');
      args.push('-i', bgmPath,
        '-filter_complex', filter, '-map', '[aout]',
        '-ac', '2', '-ar', '44100', '-q:a', '2', outPath);
      await runFfmpeg(args);

      console.log('[混音] 完成:', outPath, `原声${(voiceVolume * 100).toFixed(0)}% BGM${(bgmVolume * 100).toFixed(0)}%`, `时长${voiceDur.toFixed(2)}s`);
      return { success: true, filePath: outPath, preview: isPreview, duration: voiceDur };
    } catch (error) {
      console.error('[混音] 失败:', error.message);
      return { success: false, error: error.message };
    }
  });

  // 一键全损音质工具：把已有音频过一遍炸麦劣化滤镜（复用导出「音质损伤」同一套链路）
  ipcMain.handle('degrade-audio', async (event, opts) => {
    try {
      const o = opts || {};
      const inputPath = typeof o.inputPath === 'string' ? o.inputPath : '';
      if (!inputPath || !fs.existsSync(inputPath)) return { success: false, error: '音频文件不存在' };
      const level = Math.max(1, Math.min(100, Math.round(Number(o.level ?? 60))));
      const isPreview = !o.targetPath || o.preview === true;

      ensureDir(tempDir);
      const jobDir = path.join(tempDir, 'lossy_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
      ensureDir(jobDir);

      let outPath;
      if (isPreview) {
        outPath = path.join(jobDir, 'preview.mp3');
      } else {
        outPath = String(o.targetPath);
        if (!/\.mp3$/i.test(outPath)) outPath = outPath.replace(/\.[^.\/\\]+$/, '') + '.mp3';
        ensureDir(path.dirname(outPath));
      }

      const cfg = await degradeAudio(inputPath, outPath, level, ({ stage, percent }) => {
        try { if (!event.sender.isDestroyed()) event.sender.send('degrade-audio-progress', { stage, percent }); } catch { /* 忽略 */ }
      });
      const duration = await probeDuration(outPath);
      console.log('[全损] 完成:', outPath, `损坏${level}%`, `时长${duration.toFixed(2)}s`);
      return { success: true, filePath: outPath, preview: isPreview, level, duration, params: cfg };
    } catch (error) {
      console.error('[全损] 失败:', error.message);
      return { success: false, error: error.message };
    }
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
