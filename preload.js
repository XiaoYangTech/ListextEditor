const { contextBridge, ipcRenderer } = require('electron');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ensureDir, isNetworkError, sleep } = require('./src/main/utils');

const tempDir = path.join(os.tmpdir(), 'listext-editor');

async function synthesizeTTS(text, voice, rate = '+0%') {
  try {
    ensureDir(tempDir);
    const rawVoice = voice || 'zh-CN-XiaoxiaoNeural';

    const ent = await ipcRenderer.invoke('api-get-entitlement');
    const isPro = ent?.plan === 'pro' && !ent?.expired;
    const isFreeDisplay = ent?.free_display?.enabled;
    if (!isPro && !isFreeDisplay) {
      if (!rawVoice.startsWith('zh-CN') && !rawVoice.startsWith('en-US')) {
        return { success: false, error: '小语种 TTS 是专业版功能，请升级后使用' };
      }
    }

    const outputPath = path.join(tempDir, `tts_${Date.now()}.mp3`);

    const tts = new MsEdgeTTS();
    await tts.setMetadata(rawVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const writeStream = fs.createWriteStream(outputPath);
    const { audioStream } = await tts.toStream(text, { rate });
    audioStream.pipe(writeStream);

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      audioStream.on('error', reject);
    });

    if (fs.existsSync(outputPath)) return { success: true, path: outputPath };
    return { success: false, error: '音频文件生成失败' };
  } catch (error) {
    if (isNetworkError(error)) return { success: false, error: 'EdgeTTS 网络不可用' };
    console.error('EdgeTTS 合成失败:', error);
    return { success: false, error: error.message || 'EdgeTTS 合成失败' };
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (filePath, content, meta) => ipcRenderer.invoke('save-file', filePath, content, meta),
  openProjectFile: (filePath) => ipcRenderer.invoke('open-project-file', filePath),
  selectProjectPath: () => ipcRenderer.invoke('select-project-path'),

  onSaveAs: (callback) => ipcRenderer.on('menu-save-as', (event, filePath) => callback(filePath)),
  onMenuOpenProject: (callback) => ipcRenderer.on('menu-open-project', (event, filePath) => callback(filePath)),
  onMenuNew: (callback) => ipcRenderer.on('menu-new', () => callback()),
  onMenuSave: (callback) => ipcRenderer.on('menu-save', () => callback()),
  onMenuEdit: (callback) => ipcRenderer.on('menu-edit', (event, action) => callback(action)),

  listBuiltinSounds: () => ipcRenderer.invoke('list-builtin-sounds'),
  getBuiltInPaths: () => ipcRenderer.invoke('get-built-in-paths'),

  getVoices: async () => [],
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
  listEdgeVoices: async () => {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const tts = new MsEdgeTTS();
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
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  getShortcuts: () => ipcRenderer.invoke('get-shortcuts'),
  saveShortcuts: (shortcuts) => ipcRenderer.invoke('save-shortcuts', shortcuts),

  getStoragePaths: () => ipcRenderer.invoke('get-storage-paths'),
  saveStoragePaths: (paths) => ipcRenderer.invoke('save-storage-paths', paths),
  resetStoragePaths: () => ipcRenderer.invoke('reset-storage-paths'),
  selectDirectory: (defaultPath) => ipcRenderer.invoke('select-directory', defaultPath),

  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),
  selectExportPath: () => ipcRenderer.invoke('select-export-path'),
  platform: process.platform,
  arch: process.arch,
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  getProjectData: () => ipcRenderer.invoke('get-project-data'),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  setProjectEffects: (effects) => ipcRenderer.invoke('set-project-effects', effects),
  setProjectRoles: (roles) => ipcRenderer.invoke('set-project-roles', roles),
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

  onAuthLost: (callback) => ipcRenderer.on('auth-lost', () => callback())
});
