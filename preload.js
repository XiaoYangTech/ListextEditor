// preload.js
const { contextBridge, ipcRenderer } = require('electron');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ensureDir, isNetworkError, sleep } = require('./src/main/utils');

const tempDir = path.join(os.tmpdir(), 'listext-editor');

const voiceConfig = {
  male_announcer: 'zh-CN-YunjianNeural',
  female_announcer: 'zh-CN-XiaoyiNeural',
  male: 'zh-CN-YunxiNeural',
  female: 'zh-CN-XiaoxiaoNeural',
  male_en: 'en-US-GuyNeural',
  female_en: 'en-US-JennyNeural'
};

async function synthesizeTTS(text, voice, rate = '+0%') {
  try {
    ensureDir(tempDir);
    const voiceName = voiceConfig[voice] || voice || voiceConfig.female;
    const outputPath = path.join(tempDir, `tts_${Date.now()}.mp3`);

    const tts = new MsEdgeTTS();
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

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
  // 文件/项目
  saveFile: (filePath, content, meta) => ipcRenderer.invoke('save-file', filePath, content, meta),
  openProjectFile: (filePath) => ipcRenderer.invoke('open-project-file', filePath),
  selectProjectPath: () => ipcRenderer.invoke('select-project-path'),

  onSaveAs: (callback) => ipcRenderer.on('menu-save-as', (event, filePath) => callback(filePath)),
  onMenuOpenProject: (callback) => ipcRenderer.on('menu-open-project', (event, filePath) => callback(filePath)),
  onMenuNew: (callback) => ipcRenderer.on('menu-new', () => callback()),
  onMenuSave: (callback) => ipcRenderer.on('menu-save', () => callback()),
  onMenuEdit: (callback) => ipcRenderer.on('menu-edit', (event, action) => callback(action)),

  // 音效管理
  loadEffects: () => ipcRenderer.invoke('load-effects'),
  listSounds: () => ipcRenderer.invoke('list-sounds'),
  setEffectId: (key, customId) => ipcRenderer.invoke('set-effect-id', key, customId),
  removeEffectMapping: (filename) => ipcRenderer.invoke('remove-effect-mapping', filename),
  deleteSound: (key) => ipcRenderer.invoke('delete-sound', key),
  getSoundsPath: () => ipcRenderer.invoke('get-sounds-path'),
  importSound: (sourcePath) => ipcRenderer.invoke('import-sound', sourcePath),
  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),
  listEffectGroups: () => ipcRenderer.invoke('list-effect-groups'),
  addEffectGroup: (name) => ipcRenderer.invoke('add-effect-group', name),
  deleteEffectGroup: (name) => ipcRenderer.invoke('delete-effect-group', name),
  setSoundGroup: (key, group) => ipcRenderer.invoke('set-sound-group', key, group),

  // TTS
  getVoices: async () => voiceConfig,
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
          return { success: false, voices: Object.values(voiceConfig), error: 'EdgeTTS 网络不可用' };
        }
        console.error('获取发音人列表失败', error);
        return { success: false, voices: Object.values(voiceConfig) };
      }
    }
  },
  saveBinary: (filePath, base64) => ipcRenderer.invoke('save-binary', filePath, base64),

  // 播放控制
  onPreviewPlay: (callback) => ipcRenderer.on('preview-play', () => callback()),
  onStopPlay: (callback) => ipcRenderer.on('stop-play', () => callback()),
  onExportAudio: (callback) => ipcRenderer.on('export-audio', (event, filePath) => callback(filePath)),

  // 帮助与窗口
  onShowSyntaxHelp: (callback) => ipcRenderer.on('show-syntax-help', () => callback()),
  onShowRoleManager: (callback) => ipcRenderer.on('show-role-manager', () => callback()),
  onShowSettings: (callback) => ipcRenderer.on('show-settings', () => callback()),

  openRoleManagerWindow: () => ipcRenderer.invoke('open-role-manager-window'),
  openSettingsWindow: () => ipcRenderer.invoke('open-settings-window'),
  openEffectManagerWindow: () => ipcRenderer.invoke('open-effect-manager-window'),
  composeMp3: (targetPath, segments) => ipcRenderer.invoke('compose-mp3', targetPath, segments),

  // 设置
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getNotice: () => ipcRenderer.invoke('get-notice'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // 快捷键
  getShortcuts: () => ipcRenderer.invoke('get-shortcuts'),
  saveShortcuts: (shortcuts) => ipcRenderer.invoke('save-shortcuts', shortcuts),

  // 存储路径
  getStoragePaths: () => ipcRenderer.invoke('get-storage-paths'),
  saveStoragePaths: (paths) => ipcRenderer.invoke('save-storage-paths', paths),
  resetStoragePaths: () => ipcRenderer.invoke('reset-storage-paths'),
  selectDirectory: (defaultPath) => ipcRenderer.invoke('select-directory', defaultPath),

  // 项目音效
  addProjectSound: (soundEntry) => ipcRenderer.invoke('add-project-sound', soundEntry),

  // 导出
  selectExportPath: () => ipcRenderer.invoke('select-export-path'),
  platform: process.platform
});

