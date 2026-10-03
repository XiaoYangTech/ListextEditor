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

const { contextBridge, ipcRenderer } = require('electron');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { ensureDir, isNetworkError, extractErrorCode, sleep } = require('./src/main/utils');
const { DEFAULT_EDGE_VOICE } = require('./src/listext-constants');

const tempDir = path.join(os.tmpdir(), 'ListextEditor');

// preload 的 console 既不进日志文件、也无法被渲染层的转发脚本拦截（独立上下文）：
// 这里把 warn/error 经 append-log IPC 落盘，避免 EdgeTTS/代理等 preload 报错"啥也没记录"
(function bridgePreloadConsole() {
  const serialize = (a) => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'object' && a !== null) {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  };
  for (const level of ['warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      orig(...args);
      try {
        ipcRenderer.invoke('append-log', level, [`[preload] ${args.map(serialize).join(' ')}`]);
      } catch { /* 日志失败不影响业务 */ }
    };
  }
})();

// 手动代理时 EdgeTTS 的 WebSocket 也要走代理。
// 注意一：LISTEXT_PROXY 设在主进程渲染进程读不到，须经 IPC 取设置。
// 注意二：preload 里 window/document 存在，MsEdgeTTS 会把自己误判为浏览器环境
// （_isBrowser=true 时它内部会丢弃 agent），必须把该标志拨回 false 才能让 agent 生效。
function createMsEdgeTTS(agent) {
  if (agent) {
    const tts = new MsEdgeTTS({ agent });
    tts._isBrowser = false; // 见上方注意二
    return tts;
  }
  return new MsEdgeTTS();
}

async function getProxyAgent() {
  try {
    const settings = await ipcRenderer.invoke('get-settings');
    const url = settings?.proxyMode === 'manual' ? (settings?.proxyUrl || '').trim() : '';
    if (url) {
      const { HttpsProxyAgent } = require('https-proxy-agent');
      return new HttpsProxyAgent(url);
    }
  } catch (e) {
    console.error('获取代理设置失败，按直连处理:', e.message);
  }
  return undefined;
}

// 校验合成结果完整性：网络断流会产生截断文件，交给 ffmpeg 必然报错
function isValidMp3(p) {
  try {
    const st = fs.statSync(p);
    if (st.size < 2048) return false;
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(3);
    fs.readSync(fd, buf, 0, 3, 0);
    fs.closeSync(fd);
    // ID3 头或 MPEG 帧同步字
    return buf.toString('latin1', 0, 3) === 'ID3' || (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0);
  } catch { return false; }
}

// preload 的 console 不进日志文件，错误直接经 append-log 落盘
function logToFile(level, args) {
  try { ipcRenderer.invoke('append-log', level, args); } catch {}
}

async function synthesizeTTS(text, voice, rate = '+0%') {
  let rawVoice = voice || DEFAULT_EDGE_VOICE;
  try {
    if (!text || !text.trim()) {
      return { success: false, error: '朗读内容为空' };
    }
    ensureDir(tempDir);
    rawVoice = voice || DEFAULT_EDGE_VOICE;

    const outputPath = path.join(tempDir, `tts_${Date.now()}.mp3`);

    const tts = createMsEdgeTTS(await getProxyAgent());
    await tts.setMetadata(rawVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const writeStream = fs.createWriteStream(outputPath);
    const { audioStream } = await tts.toStream(text, { rate });
    audioStream.pipe(writeStream);

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      audioStream.on('error', reject);
    });

    if (fs.existsSync(outputPath)) {
      if (isValidMp3(outputPath)) return { success: true, path: outputPath };
      // 截断的残次品：删除并按网络错误处理，触发上层重试
      try { fs.unlinkSync(outputPath); } catch {}
      logToFile('warn', ['[EdgeTTS] 合成结果不完整（网络中断）', `voice=${rawVoice}`]);
      return { success: false, network: true, error: '语音合成结果不完整（网络中断），请稍后重试' };
    }
    logToFile('error', ['[EdgeTTS] 音频文件未生成', `voice=${rawVoice}`]);
    return { success: false, error: '音频文件生成失败' };
  } catch (error) {
    // 完整错误（含堆栈/错误码）落日志，用户态提示携带具体错误码（如 HTTP 403）
    const errCode = extractErrorCode(error);
    const codeText = errCode ? `（${errCode}）` : '';
    logToFile('error', ['[EdgeTTS] 合成失败', errCode || '无错误码', `voice=${rawVoice}`, String(error?.stack || error?.message || error)]);
    if (isNetworkError(error)) return { success: false, network: true, code: errCode, error: `EdgeTTS 网络不可用${codeText}，请检查网络连接后重试` };
    return { success: false, code: errCode, error: `${error.message || 'EdgeTTS 合成失败'}${codeText}` };
  }
}

// ---------- 本地语音（Windows SAPI5 / OneCore；macOS 与 Linux 不使用系统 TTS） ----------
// 枚举与合成统一走 PowerShell 桥 local-tts.ps1：
//   * Windows 11 自然音色（Microsoft Xiaoxiao / Aria 等）只对 System.Speech 可见，
//     Chromium 的 speechSynthesis 完全看不到；
//   * OneCore 独有的音色经典 SAPI5 选不到，脚本内部自动改用 WinRT。
// 解释器与脚本路径都不写死：按候选顺序逐个探测，任一可用即可，适配不同用户环境。
const LOCAL_TTS_CANDIDATES = () => [
  process.env.LISTEXT_LOCAL_TTS_SCRIPT, // 用户/运维可覆盖
  process.resourcesPath ? path.join(process.resourcesPath, 'local-tts.ps1') : '',
  path.join(__dirname, 'src', 'main', 'local-tts.ps1'),
].filter(Boolean);

function localTtsScriptPath() {
  const candidates = LOCAL_TTS_CANDIDATES();
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* 继续探测下一个 */ }
  }
  return candidates[candidates.length - 1] || '';
}

function powerShellCandidates() {
  const windir = process.env.SystemRoot || process.env.windir || '';
  return [...new Set([
    process.env.LISTEXT_POWERSHELL,
    windir && path.join(windir, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    windir && path.join(windir, 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    'powershell.exe', // 交给 PATH
    'pwsh.exe',       // 只装了 PowerShell 7 的环境
  ].filter(Boolean))];
}

// 依次尝试候选解释器：脚本自身失败会返回 JSON（直接采信），解释器不可用才换下一个
function execLocalTts(args, timeout) {
  const script = localTtsScriptPath();
  const attempts = powerShellCandidates();
  return new Promise((resolve) => {
    let index = 0;
    const tryNext = (lastError) => {
      if (index >= attempts.length) {
        resolve({ ok: false, error: lastError || '未找到可用的 PowerShell' });
        return;
      }
      const exe = attempts[index++];
      execFile(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
        { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
        (error, stdout, stderr) => {
          const out = String(stdout || '').trim();
          if (out) {
            try { resolve(JSON.parse(out)); return; } catch { /* 非 JSON 输出，换下一个解释器 */ }
          }
          const detail = String(stderr || '').trim() || (error && error.message) || '';
          tryNext(detail.slice(0, 300));
        });
    };
    tryNext('');
  });
}

// ---------- 常驻合成进程 ----------
// powershell.exe 冷启动在本机约 1.7s，按次启动等于每次合成都要重付这笔钱（实测 3.1s/次）。
// 改为常驻（-Action Serve）：启动+预热只付一次，之后每次只剩合成本身（实测 0.2~0.8s）。
// 父进程退出时 stdin 关闭 → 脚本收到 EOF 自行收摊，不留孤儿进程。
let localTtsWorker = null;       // { child, waiters:Set, buf, dead }
let localTtsWorkerTried = false; // 一次都没成功就不再反复尝试，直接走一次性调用

function localTtsWorkerEnsure() {
  if (process.platform !== 'win32') return null;
  if (localTtsWorker && !localTtsWorker.dead) return localTtsWorker;
  if (localTtsWorkerTried) return null;
  localTtsWorkerTried = true;
  const script = localTtsScriptPath();
  for (const exe of powerShellCandidates()) {
    try {
      const child = spawn(exe,
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'Serve'],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const w = { child, waiters: new Set(), buf: '', dead: false };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        w.buf += chunk;
        let idx;
        while ((idx = w.buf.indexOf('\n')) >= 0) {
          const line = w.buf.slice(0, idx).trim();
          w.buf = w.buf.slice(idx + 1);
          if (!line) continue;
          // 调用方串行发送请求，所以响应按先到先得配对
          const settle = w.waiters.values().next().value;
          if (!settle) continue;
          w.waiters.delete(settle);
          let msg;
          try { msg = JSON.parse(line); } catch { msg = { ok: false, error: 'bad json from bridge: ' + line.slice(0, 120) }; }
          settle(msg);
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (d) => logToFile('warn', ['[本地TTS] 桥 stderr', String(d).trim().slice(0, 300)]));
      const onGone = () => {
        w.dead = true;
        if (localTtsWorker === w) localTtsWorker = null;
        for (const settle of [...w.waiters]) settle(null); // null → 调用方回退到一次性调用
        w.waiters.clear();
      };
      child.on('exit', onGone);
      child.on('error', onGone);
      localTtsWorker = w;
      return w;
    } catch { /* 换下一个解释器候选 */ }
  }
  return null;
}

function localTtsWorkerCall(req, timeout) {
  const w = localTtsWorkerEnsure();
  if (!w) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      w.waiters.delete(settle);
      resolve(val);
    };
    const timer = setTimeout(() => {
      settle(null);
      try { w.child.kill(); } catch { /* 忽略 */ }
    }, timeout || 60000);
    w.waiters.add(settle);
    try { w.child.stdin.write(JSON.stringify(req) + '\n'); } catch { settle(null); }
  });
}

// 常驻优先，失败则回退一次性调用（解释器被安全策略拦截等环境仍可用）
async function localTtsCall(req, timeout) {
  const viaWorker = await localTtsWorkerCall(req, timeout);
  if (viaWorker) return viaWorker;
  if (req.cmd === 'list') return execLocalTts(['-Action', 'List'], 30000);
  const args = ['-Action', 'Say', '-TextFile', req.textFile, '-Rate', String(req.rate), '-Out', req.out];
  if (req.voice) args.push('-Voice', req.voice);
  return execLocalTts(args, timeout || 120000);
}

// 预热常驻进程（打开角色管理器时调用，等用户真正试听时就不必再等启动）
function warmLocalTts() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return localTtsWorkerCall({ cmd: 'list' }, 30000).then(Boolean).catch(() => false);
}

process.on('exit', () => { try { localTtsWorker?.child?.kill(); } catch { /* 忽略 */ } });

let localVoicesCache = { at: 0, voices: null };

async function listLocalVoices() {
  if (process.platform !== 'win32') return { success: true, voices: [] };
  if (localVoicesCache.voices && Date.now() - localVoicesCache.at < 60000) {
    return { success: true, voices: localVoicesCache.voices };
  }
  const res = await localTtsCall({ cmd: 'list' }, 30000);
  const raw = res && Array.isArray(res.voices) ? res.voices : (Array.isArray(res) ? res : (res && res.name ? [res] : []));
  const voices = raw
    .filter(v => v && v.name)
    .map(v => ({ name: String(v.name), lang: String(v.lang || ''), gender: String(v.gender || ''), engine: String(v.engine || 'sapi') }));
  if (voices.length) localVoicesCache = { at: Date.now(), voices };
  return voices.length
    ? { success: true, voices }
    : { success: false, voices: [], error: (res && res.error) || '未获取到本地发音人' };
}

// 合成结果缓存：同一音色+语速+文本再次试听/重复导出时直接复用（导出结束会清临时目录，命中前校验文件仍在）
const localTtsCache = new Map();
const LOCAL_TTS_CACHE_MAX = 200;

function localTtsTextHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}_${s.length}`;
}

function hasCjk(s) { return /[\u3400-\u9fff]/.test(s); }

// 经典 SAPI5 音色只能读自己语言的文本，跨语言时会静默产出空文件（46 字节 WAV）
function describeLocalTtsError(res, voice, text) {
  const lang = String((res && res.lang) || '');
  if (res && res.error === 'empty audio output') {
    const name = voice || lang || '系统默认音色';
    if (/^en/i.test(lang) && hasCjk(text)) return `发音人「${name}」是英语音色，无法朗读中文，请改用中文音色（如 Microsoft Xiaoxiao）`;
    if (/^zh/i.test(lang) && !hasCjk(text)) return `发音人「${name}」是中文音色，无法朗读纯英文，请改用英语音色（如 Microsoft Aria / Jenny）`;
    return `发音人「${name}」未产出音频（该音色可能不支持这段文本的语言）`;
  }
  return (res && res.error) || '本地语音合成失败';
}

async function synthesizeLocalTTS(text, voice, rate = 1.0) {
  if (process.platform !== 'win32') {
    return { success: false, error: '当前平台已禁用系统TTS，请改用 EdgeTTS 角色' };
  }
  const content = String(text || '');
  if (!content.trim()) return { success: false, error: '朗读内容为空' };

  const cacheKey = `${voice || ''}|${Number(rate) || 1}|${localTtsTextHash(content)}`;
  const hitPath = localTtsCache.get(cacheKey);
  if (hitPath && fs.existsSync(hitPath)) return { success: true, path: hitPath, cached: true };

  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const textPath = path.join(tempDir, `sapi_text_${stamp}.txt`);
  const wavPath = path.join(tempDir, `sapi_${stamp}.wav`);
  try {
    ensureDir(tempDir);
    // 文本经 UTF-8 文件中转，避免命令行参数在不同区域设置下被转码
    fs.writeFileSync(textPath, content, 'utf8');
    const res = await localTtsCall({ cmd: 'say', voice: voice || '', textFile: textPath, rate: Number(rate) || 1.0, out: wavPath }, 120000);
    if (res && res.ok && res.path && fs.existsSync(res.path) && fs.statSync(res.path).size > 1024) {
      if (localTtsCache.size >= LOCAL_TTS_CACHE_MAX) localTtsCache.clear();
      localTtsCache.set(cacheKey, res.path);
      // fallback：本机没有该音色，脚本改用系统默认音色（如实上报，不静默替换）
      return { success: true, path: res.path, fallback: !!res.fallback, requested: res.requested || voice || '', notes: res.notes || '' };
    }
    const reason = describeLocalTtsError(res, voice, content);
    logToFile('error', ['[本地TTS] 合成失败', `voice=${voice || '(系统默认)'}`, `lang=${(res && res.lang) || '?'}`, reason]);
    return { success: false, error: reason };
  } catch (error) {
    logToFile('error', ['[本地TTS] 异常', `voice=${voice}`, String(error?.stack || error?.message || error)]);
    return { success: false, error: `本地语音合成异常：${error.message || error}` };
  } finally {
    try { fs.unlinkSync(textPath); } catch { /* 临时文件可能已不存在 */ }
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (filePath, content, meta) => ipcRenderer.invoke('save-file', filePath, content, meta),
  openProjectFile: (filePath) => ipcRenderer.invoke('open-project-file', filePath),
  selectProjectPath: (defaultName) => ipcRenderer.invoke('select-project-path', defaultName),

  onSaveAs: (callback) => ipcRenderer.on('menu-save-as', (event, filePath) => callback(filePath)),
  onMenuOpenProject: (callback) => ipcRenderer.on('menu-open-project', (event, filePath) => callback(filePath)),
  onMenuNew: (callback) => ipcRenderer.on('menu-new', () => callback()),
  onMenuSave: (callback) => ipcRenderer.on('menu-save', () => callback()),
  onMenuEdit: (callback) => ipcRenderer.on('menu-edit', (event, action) => callback(action)),

  listBuiltinSounds: () => ipcRenderer.invoke('list-builtin-sounds'),
  getBuiltInPaths: () => ipcRenderer.invoke('get-built-in-paths'),

  synthesizeTTS,
  listLocalVoices,
  synthesizeLocalTTS,
  warmLocalTts,
  synthesizeBatch: async (items) => {
    const results = [];
    for (const item of items) {
      const result = await synthesizeTTS(item.text, item.voice, item.rate);
      results.push({ ...item, ...result });
    }
    return results;
  },
  getAudioFile: (filePath) => ipcRenderer.invoke('get-audio-file', filePath),
  cleanupTemp: () => ipcRenderer.invoke('cleanup-temp'),
  appendLog: (level, args) => ipcRenderer.invoke('append-log', level, args),
  listEdgeVoices: async () => {
    const maxRetries = 3;
    const agent = await getProxyAgent();
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const tts = createMsEdgeTTS(agent);
        const voices = await tts.getVoices();
        const voiceList = voices.map(v => v.ShortName || v.Name).filter(Boolean);
        return { success: true, voices: voiceList };
      } catch (error) {
        if (attempt < maxRetries && isNetworkError(error)) {
          await sleep(2000);
          continue;
        }
        if (isNetworkError(error)) {
          const errCode = extractErrorCode(error);
          logToFile('error', ['[EdgeTTS] 发音人列表拉取失败（重试耗尽）', errCode || '无错误码', String(error?.message || error)]);
          const codeText = errCode ? `（${errCode}）` : '';
          return { success: false, voices: ['zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural'], error: `EdgeTTS 网络不可用${codeText}` };
        }
        console.error('获取发音人列表失败', error);
        return { success: false, voices: ['zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural'] };
      }
    }
  },
  saveBinary: (filePath, base64) => ipcRenderer.invoke('save-binary', filePath, base64),

  onPreviewPlay: (callback) => ipcRenderer.on('preview-play', () => callback()),
  onStopPlay: (callback) => ipcRenderer.on('stop-play', () => callback()),
  onExportAudio: (callback) => ipcRenderer.on('export-audio', (event, filePath) => callback(filePath)),

  onShowAbout: (callback) => ipcRenderer.on('show-about', () => callback()),
  onOpenAudioMixer: (callback) => ipcRenderer.on('open-audio-mixer', () => callback()),
  onOpenDonate: (callback) => ipcRenderer.on('open-donate', () => callback()),

  onShowSettings: (callback) => ipcRenderer.on('show-settings', () => callback()),
  onRequestCloseCheck: (callback) => ipcRenderer.on('request-close-check', () => callback()),
  sendCloseCheckResult: (shouldClose) => ipcRenderer.send('close-check-result', shouldClose),

  openSettingsWindow: () => ipcRenderer.invoke('open-settings-window'),
  composeMp3: (targetPath, segments, skipWatermark, options) => ipcRenderer.invoke('compose-mp3', targetPath, segments, skipWatermark, options),
  checkFfmpeg: () => ipcRenderer.invoke('check-ffmpeg'),

  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getLaunchState: () => ipcRenderer.invoke('get-launch-state'),
  setDonationDismissed: () => ipcRenderer.invoke('set-donation-dismissed'),
  getCacheStats: () => ipcRenderer.invoke('get-cache-stats'),
  clearCache: (category) => ipcRenderer.invoke('clear-cache', category),
  openLogsDir: () => ipcRenderer.invoke('open-logs-dir'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  getShortcuts: () => ipcRenderer.invoke('get-shortcuts'),
  saveShortcuts: (shortcuts) => ipcRenderer.invoke('save-shortcuts', shortcuts),

  selectDirectory: (defaultPath) => ipcRenderer.invoke('select-directory', defaultPath),

  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),
  selectAudioSavePath: (defaultName) => ipcRenderer.invoke('select-audio-save-path', defaultName),
  mixAudio: (opts) => ipcRenderer.invoke('mix-audio', opts),
  importAudioFile: (filePath) => ipcRenderer.invoke('import-audio-file', filePath),
  selectExportPath: () => ipcRenderer.invoke('select-export-path'),
  platform: process.platform,
  arch: process.arch,
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  getProjectData: () => ipcRenderer.invoke('get-project-data'),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  setProjectEffects: (effects, opts) => ipcRenderer.invoke('set-project-effects', effects, opts),
  setProjectRoles: (roles, opts) => ipcRenderer.invoke('set-project-roles', roles, opts),
  onProjectEffectsChanged: (callback) => ipcRenderer.on('project-effects-changed', (event, effects) => callback(effects)),
  onProjectRolesChanged: (callback) => ipcRenderer.on('project-roles-changed', (event, roles) => callback(roles)),
  releaseFileLock: (filePath) => ipcRenderer.invoke('release-file-lock', filePath),
  sendTabContext: (isHome) => ipcRenderer.send('tab-context-changed', isHome),

  fetchBanners: () => ipcRenderer.invoke('api-banners'),
  fetchAnnouncements: () => ipcRenderer.invoke('api-announcements'),
  fetchRoutines: () => ipcRenderer.invoke('api-routines'),
  fetchPopups: () => ipcRenderer.invoke('api-popups'),

  pasteFromClipboard: () => ipcRenderer.invoke('paste-from-clipboard'),
  fileExists: (filePath) => ipcRenderer.invoke('file-exists', filePath),

  checkUpdate: () => ipcRenderer.invoke('check-update'),
  onCheckUpdate: (callback) => ipcRenderer.on('check-update', () => callback()),

  setToolbarAlign: (align) => ipcRenderer.invoke('set-toolbar-align', align),
  onToolbarAlignChanged: (callback) => ipcRenderer.on('toolbar-align-changed', (e, align) => callback(align))
});
