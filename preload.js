// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 文件操作
  saveFile: (filePath, content) => ipcRenderer.invoke('save-file', filePath, content),
  onSaveAs: (callback) => ipcRenderer.on('menu-save-as', (event, filePath) => callback(filePath)),
  onFileOpened: (callback) => ipcRenderer.on('file-opened', (event, content, filePath) => callback(content, filePath)),
  onMenuNew: (callback) => ipcRenderer.on('menu-new', () => callback()),
  onMenuSave: (callback) => ipcRenderer.on('menu-save', () => callback()),
  onMenuEdit: (callback) => ipcRenderer.on('menu-edit', (event, action) => callback(action)),

  // 音效管理
  loadEffects: () => ipcRenderer.invoke('load-effects'),
  listSounds: () => ipcRenderer.invoke('list-sounds'),
  setEffectId: (filename, customId) => ipcRenderer.invoke('set-effect-id', filename, customId),
  removeEffectMapping: (filename) => ipcRenderer.invoke('remove-effect-mapping', filename),
  getSoundsPath: () => ipcRenderer.invoke('get-sounds-path'),
  importSound: (sourcePath) => ipcRenderer.invoke('import-sound', sourcePath),
  selectAudioFile: () => ipcRenderer.invoke('select-audio-file'),

  // TTS 相关
  getVoices: () => ipcRenderer.invoke('get-voices'),
  synthesizeTTS: (text, voice, rate) => ipcRenderer.invoke('synthesize-tts', text, voice, rate),
  synthesizeBatch: (items) => ipcRenderer.invoke('synthesize-batch', items),
  getAudioFile: (filePath) => ipcRenderer.invoke('get-audio-file', filePath),
  cleanupTemp: () => ipcRenderer.invoke('cleanup-temp'),
  listEdgeVoices: () => ipcRenderer.invoke('list-edge-voices'),
  saveBinary: (filePath, base64) => ipcRenderer.invoke('save-binary', filePath, base64),

  // 播放控制
  onPreviewPlay: (callback) => ipcRenderer.on('preview-play', () => callback()),
  onStopPlay: (callback) => ipcRenderer.on('stop-play', () => callback()),
  onExportAudio: (callback) => ipcRenderer.on('export-audio', (event, filePath) => callback(filePath)),

  // 帮助
  onShowSyntaxHelp: (callback) => ipcRenderer.on('show-syntax-help', () => callback()),
  onShowRoleManager: (callback) => ipcRenderer.on('show-role-manager', () => callback()),
  onShowSettings: (callback) => ipcRenderer.on('show-settings', () => callback()),

  // 设置
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getNotice: () => ipcRenderer.invoke('get-notice'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // 导出
  selectExportPath: () => ipcRenderer.invoke('select-export-path'),
  selectListextPath: () => ipcRenderer.invoke('select-listext-path')
});
