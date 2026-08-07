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
const { ensureDir, isNetworkError, sleep } = require('./src/main/utils');
const { DEFAULT_EDGE_VOICE } = require('./src/listext-constants');

const tempDir = path.join(os.tmpdir(), 'ListextEditor');

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

async function synthesizeTTS(text, voice, rate = '+0%') {
  try {
    if (!text || !text.trim()) {
      return { success: false, error: '朗读内容为空' };
    }
    ensureDir(tempDir);
    const rawVoice = voice || DEFAULT_EDGE_VOICE;

    const ent = await ipcRenderer.invoke('api-get-entitlement');
    const isPro = ent?.plan === 'pro' && !ent?.expired;
    const isFreeDisplay = ent?.free_display?.enabled;
    if (!isPro && !isFreeDisplay) {
      if (!rawVoice.startsWith('zh-CN') && !rawVoice.startsWith('en-US')) {
        return { success: false, error: '小语种 TTS 是专业版功能，请升级后使用' };
      }
    }

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
      return { success: false, network: true, error: '语音合成结果不完整（网络中断），请稍后重试' };
    }
    return { success: false, error: '音频文件生成失败' };
  } catch (error) {
    if (isNetworkError(error)) return { success: false, network: true, error: 'EdgeTTS 网络不可用，请检查网络连接后重试' };
    console.error('EdgeTTS 合成失败:', error);
    return { success: false, error: error.message || 'EdgeTTS 合成失败' };
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
          return { success: false, voices: ['zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural'], error: 'EdgeTTS 网络不可用' };
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

  onShowSettings: (callback) => ipcRenderer.on('show-settings', () => callback()),
  onRequestCloseCheck: (callback) => ipcRenderer.on('request-close-check', () => callback()),
  sendCloseCheckResult: (shouldClose) => ipcRenderer.send('close-check-result', shouldClose),

  openSettingsWindow: () => ipcRenderer.invoke('open-settings-window'),
  composeMp3: (targetPath, segments, skipWatermark) => ipcRenderer.invoke('compose-mp3', targetPath, segments, skipWatermark),
  checkFfmpeg: () => ipcRenderer.invoke('check-ffmpeg'),

  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getCacheStats: () => ipcRenderer.invoke('get-cache-stats'),
  clearCache: (category) => ipcRenderer.invoke('clear-cache', category),
  openLogsDir: () => ipcRenderer.invoke('open-logs-dir'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  getShortcuts: () => ipcRenderer.invoke('get-shortcuts'),
  saveShortcuts: (shortcuts) => ipcRenderer.invoke('save-shortcuts', shortcuts),

  selectDirectory: (defaultPath) => ipcRenderer.invoke('select-directory', defaultPath),

  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),
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

  login: (email, pw, deviceName, osName, removeDeviceId) => ipcRenderer.invoke('api-login', email, pw, deviceName, osName, removeDeviceId),
  logout: () => ipcRenderer.invoke('api-logout'),
  getProfile: () => ipcRenderer.invoke('api-profile'),
  getDevices: () => ipcRenderer.invoke('api-devices'),
  removeDevice: (id) => ipcRenderer.invoke('api-remove-device', id),
  isLoggedIn: () => ipcRenderer.invoke('api-is-logged-in'),
  getEntitlement: () => ipcRenderer.invoke('api-get-entitlement'),
  getUser: () => ipcRenderer.invoke('api-get-user'),

  getExportQuota: () => ipcRenderer.invoke('api-export-quota'),
  consumeExport: () => ipcRenderer.invoke('api-export-consume'),
  pasteFromClipboard: () => ipcRenderer.invoke('paste-from-clipboard'),
  getStatus: () => ipcRenderer.invoke('api-status'),
  fileExists: (filePath) => ipcRenderer.invoke('file-exists', filePath),

  onAuthLost: (callback) => ipcRenderer.on('auth-lost', () => callback()),

  checkUpdate: () => ipcRenderer.invoke('check-update'),
  onCheckUpdate: (callback) => ipcRenderer.on('check-update', () => callback()),

  setToolbarAlign: (align) => ipcRenderer.invoke('set-toolbar-align', align),
  onToolbarAlignChanged: (callback) => ipcRenderer.on('toolbar-align-changed', (e, align) => callback(align))
});
