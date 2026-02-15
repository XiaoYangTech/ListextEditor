const { app, BrowserWindow, ipcMain, dialog, Menu, net, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
let nodeRandomUUID = null;
try {
  nodeRandomUUID = require('crypto').randomUUID;
} catch (e) {
  nodeRandomUUID = null;
}
if (!global.crypto) {
  global.crypto = {};
}
if (!global.crypto.randomUUID) {
  global.crypto.randomUUID = nodeRandomUUID || uuidv4;
}

let mainWindow;
let effectManagerWindow = null;

// sounds 文件夹路径
const soundsDir = path.join(path.dirname(app.getPath('exe')), 'sounds');

// 临时音频文件目录
const tempDir = path.join(app.getPath('temp'), 'listext-editor');

// 确保目录存在
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 音效映射配置文件路径
const effectsConfigPath = path.join(path.dirname(app.getPath('exe')), 'effects-config.json');
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

// EdgeTTS 语音配置
const voiceConfig = {
  male_announcer: 'zh-CN-YunjianNeural',    // 男声播音员：云健
  female_announcer: 'zh-CN-XiaoyiNeural',   // 女声播音员：晓伊
  male: 'zh-CN-YunxiNeural',                 // 普通男声：云希
  female: 'zh-CN-XiaoxiaoNeural',            // 普通女声：晓晓
  male_en: 'en-US-GuyNeural',                // 英文男声
  female_en: 'en-US-JennyNeural'             // 英文女声
};

let edgeTTSModule = null;

async function loadEdgeTTS() {
  if (edgeTTSModule) return edgeTTSModule;
  try {
    edgeTTSModule = await import('edge-tts/out/index.js');
    return edgeTTSModule;
  } catch (error) {
    console.error('EdgeTTS 加载失败:', error);
    throw error;
  }
}

// 读取音效配置
function loadEffectsConfig() {
  try {
    if (fs.existsSync(effectsConfigPath)) {
      const data = fs.readFileSync(effectsConfigPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('读取音效配置失败:', error);
  }
  return {};
}

// 保存音效配置
function saveEffectsConfig(config) {
  try {
    fs.writeFileSync(effectsConfigPath, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('保存音效配置失败:', error);
    return false;
  }
}

// 扫描 sounds 文件夹并返回可用音效
function scanSoundsFolder() {
  ensureDir(soundsDir);
  const files = fs.readdirSync(soundsDir);
  const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];
  
  const sounds = [];
  files.forEach(file => {
    const ext = path.extname(file).toLowerCase();
    if (audioExtensions.includes(ext)) {
      sounds.push({
        filename: file,
        name: path.basename(file, ext),
        path: path.join(soundsDir, file)
      });
    }
  });
  
  return sounds;
}

// 使用 edge-tts 命令行工具合成语音
async function synthesizeWithEdgeTTS(text, voice, rate = '+0%', outputPath) {
  return new Promise((resolve, reject) => {
    const voiceName = voiceConfig[voice] || voiceConfig.female;
    
    // 使用 edge-tts 命令行
    const cmd = `npx edge-tts --voice "${voiceName}" --text "${text.replace(/"/g, '\\"')}" --rate="${rate}" --write-media "${outputPath}"`;
    
    exec(cmd, { timeout: 60000, cwd: app.getAppPath() }, (error, stdout, stderr) => {
      if (error) {
        console.error('EdgeTTS 合成失败:', error);
        reject(error);
      } else {
        resolve(outputPath);
      }
    });
  });
}

// 使用 Python edge-tts 合成（备用方案）
async function synthesizeWithPython(text, voice, rate, outputPath) {
  return new Promise((resolve, reject) => {
    const voiceName = voiceConfig[voice] || voiceConfig.female;
    const ratePercent = rate.replace('%', '').replace('+', '');
    
    const pythonScript = `
import asyncio
import edge_tts

async def main():
    communicate = edge_tts.Communicate("${text.replace(/"/g, '\\"')}", "${voiceName}", rate="${rate}")
    await communicate.save("${outputPath.replace(/\\/g, '\\\\')}")

asyncio.run(main())
`;
    
    const scriptPath = path.join(tempDir, 'tts_script.py');
    fs.writeFileSync(scriptPath, pythonScript);
    
    exec(`python "${scriptPath}"`, { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(outputPath);
      }
    });
  });
}

function isNetworkError(error) {
  const code = error?.code || error?.cause?.code;
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDefaultSettings() {
  return {
    proxyMode: 'system',
    proxyUrl: '',
    noticeDismissDate: ''
  };
}

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      return { ...getDefaultSettings(), ...JSON.parse(data || '{}') };
    }
  } catch (error) {
    console.error('读取设置失败:', error);
  }
  return getDefaultSettings();
}

function saveSettings(settings) {
  try {
    ensureDir(path.dirname(settingsPath));
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('保存设置失败:', error);
    return false;
  }
}

async function applyProxySettings(settings) {
  const mode = settings?.proxyMode || 'system';
  const url = (settings?.proxyUrl || '').trim();
  if (mode === 'manual' && url) {
    process.env.HTTP_PROXY = url;
    process.env.HTTPS_PROXY = url;
    await session.defaultSession.setProxy({ proxyRules: url });
    return;
  }
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  if (mode === 'direct') {
    await session.defaultSession.setProxy({ mode: 'direct' });
  } else {
    await session.defaultSession.setProxy({ mode: 'system' });
  }
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url, session: session.defaultSession });
    request.on('response', (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer.toString('utf-8'));
      });
    });
    request.on('error', (error) => reject(error));
    request.end();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'Listext Editor'
  });

  mainWindow.loadFile('index.html');

  const sendEditAction = (action) => {
    const target = BrowserWindow.getFocusedWindow() || mainWindow;
    if (target && target.webContents) {
      target.webContents.send('menu-edit', action);
    }
  };

  // 创建菜单
  const menuTemplate = [
    {
      label: '文件',
      submenu: [
        {
          label: '新建',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.send('menu-new')
        },
        {
          label: '打开',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              filters: [{ name: 'Listext Files', extensions: ['lxt', 'txt'] }],
              properties: ['openFile']
            });
            if (!result.canceled && result.filePaths.length > 0) {
              const content = fs.readFileSync(result.filePaths[0], 'utf-8');
              mainWindow.webContents.send('file-opened', content, result.filePaths[0]);
            }
          }
        },
        {
          label: '保存',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.send('menu-save')
        },
        {
          label: '另存为',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: async () => {
            const result = await dialog.showSaveDialog(mainWindow, {
              filters: [{ name: 'Listext Files', extensions: ['lxt'] }],
              defaultPath: 'untitled.lxt'
            });
            if (!result.canceled) {
              mainWindow.webContents.send('menu-save-as', result.filePath);
            }
          }
        },
        { type: 'separator' },
        {
          label: '导出音频',
          accelerator: 'CmdOrCtrl+E',
          click: async () => {
            const result = await dialog.showSaveDialog(mainWindow, {
              filters: [{ name: 'WAV Audio', extensions: ['wav'] }],
              defaultPath: 'listening.wav'
            });
            if (!result.canceled) {
              mainWindow.webContents.send('export-audio', result.filePath);
            }
          }
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', click: () => sendEditAction('undo') },
        { label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', click: () => sendEditAction('redo') },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', click: () => sendEditAction('cut') },
        { label: '复制', accelerator: 'CmdOrCtrl+C', click: () => sendEditAction('copy') },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', click: () => sendEditAction('paste') },
        { label: '全选', accelerator: 'CmdOrCtrl+A', click: () => sendEditAction('selectAll') }
      ]
    },
    // {
    //   label: '视图',
    //   submenu: [
    //     { role: 'reload', label: '重新加载' },
    //     { role: 'toggleDevTools', label: '开发者工具' },
    //     { type: 'separator' },
    //     { role: 'resetZoom', label: '实际大小' },
    //     { role: 'zoomIn', label: '放大' },
    //     { role: 'zoomOut', label: '缩小' },
    //     { type: 'separator' },
    //     { role: 'togglefullscreen', label: '全屏' }
    //   ]
    // },
    {
      label: '工具',
      submenu: [
        {
          label: '音效管理器',
          click: () => openEffectManager()
        },
        {
          label: '设置',
          click: () => mainWindow.webContents.send('show-settings')
        },
        {
          label: '角色管理器',
          click: () => mainWindow.webContents.send('show-role-manager')
        },
        {
          label: '打开 sounds 文件夹',
          click: () => {
            ensureDir(soundsDir);
            require('electron').shell.openPath(soundsDir);
          }
        },
        { type: 'separator' },
        {
          label: '预览播放',
          accelerator: 'F5',
          click: () => mainWindow.webContents.send('preview-play')
        },
        {
          label: '停止播放',
          accelerator: 'Escape',
          click: () => mainWindow.webContents.send('stop-play')
        }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: 'Listext 语法说明',
          click: () => mainWindow.webContents.send('show-syntax-help')
        },
        { type: 'separator' },
        {
          label: '关于',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于 Listext Editor',
              message: 'Listext Editor v1.0.0',
              detail: '外语听力材料合成程序\n\n使用 Listext 语法快速创建听力材料\n语音合成：EdgeTTS'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

function openEffectManager() {
  if (effectManagerWindow) {
    effectManagerWindow.focus();
    return;
  }

  effectManagerWindow = new BrowserWindow({
    width: 700,
    height: 600,
    parent: mainWindow,
    modal: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: '音效管理器'
  });

  effectManagerWindow.loadFile('effects-manager.html');
  effectManagerWindow.setMenu(null);
  effectManagerWindow.setMenuBarVisibility(false);

  effectManagerWindow.on('closed', () => {
    effectManagerWindow = null;
  });
}

// IPC 处理
ipcMain.handle('save-file', async (event, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 加载音效（合并扫描结果和用户配置）
ipcMain.handle('load-effects', async () => {
  ensureDir(soundsDir);
  
  const config = loadEffectsConfig();
  const sounds = scanSoundsFolder();
  
  const effects = {};
  
  // 首先添加扫描到的音效
  sounds.forEach(sound => {
    const customId = config[sound.filename] || sound.name;
    effects[customId] = sound.path;
  });
  
  // 添加用户自定义映射（如果文件存在）
  Object.keys(config).forEach(key => {
    if (!sounds.find(s => s.filename === key || s.name === key)) {
      // 检查是否是路径映射
      if (config[key] && fs.existsSync(config[key])) {
        effects[key] = config[key];
      }
    }
  });
  
  return effects;
});

// 获取 sounds 文件夹中的音效列表
ipcMain.handle('list-sounds', async () => {
  return scanSoundsFolder();
});

// 设置音效ID映射
ipcMain.handle('set-effect-id', async (event, filename, customId) => {
  const config = loadEffectsConfig();
  config[filename] = customId;
  return { success: saveEffectsConfig(config) };
});

// 删除音效ID映射
ipcMain.handle('remove-effect-mapping', async (event, filename) => {
  const config = loadEffectsConfig();
  delete config[filename];
  return { success: saveEffectsConfig(config) };
});

// 获取 sounds 文件夹路径
ipcMain.handle('get-sounds-path', async () => {
  ensureDir(soundsDir);
  return soundsDir;
});

// 复制音效文件到 sounds 文件夹
ipcMain.handle('import-sound', async (event, sourcePath) => {
  try {
    ensureDir(soundsDir);
    const filename = path.basename(sourcePath);
    const destPath = path.join(soundsDir, filename);
    
    // 如果文件已存在，添加数字后缀
    let finalPath = destPath;
    let counter = 1;
    while (fs.existsSync(finalPath)) {
      const ext = path.extname(filename);
      const name = path.basename(filename, ext);
      finalPath = path.join(soundsDir, `${name}_${counter}${ext}`);
      counter++;
    }
    
    fs.copyFileSync(sourcePath, finalPath);
    return { success: true, path: finalPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('select-audio-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }],
    properties: ['openFile']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('select-export-path', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'WAV Audio', extensions: ['wav'] }],
    defaultPath: 'listening.wav'
  });
  if (!result.canceled) {
    return result.filePath;
  }
  return null;
});
 
ipcMain.handle('select-listext-path', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'Listext Files', extensions: ['lxt'] }],
    defaultPath: 'untitled.lxt'
  });
  if (!result.canceled) {
    return result.filePath;
  }
  return null;
});

ipcMain.handle('get-settings', async () => {
  return loadSettings();
});

ipcMain.handle('save-settings', async (event, settings) => {
  const merged = { ...getDefaultSettings(), ...(settings || {}) };
  const success = saveSettings(merged);
  if (success) {
    await applyProxySettings(merged);
  }
  return { success };
});

ipcMain.handle('get-notice', async () => {
  try {
    const notice = (await fetchText('https://yifang.yxxblog.top/api/listext-notice/notice.txt')).trim();
    const url = (await fetchText('https://yifang.yxxblog.top/api/listext-notice/url.txt')).trim();
    return { success: true, notice, url };
  } catch (error) {
    return { success: false, notice: '', url: '', error: error?.message || '获取公告失败' };
  }
});

ipcMain.handle('open-external', async (event, url) => {
  if (!url) return { success: false };
  await shell.openExternal(url);
  return { success: true };
});

ipcMain.handle('save-binary', async (event, filePath, base64) => {
  try {
    if (!filePath || !base64) {
      return { success: false, error: '参数不完整' };
    }
    ensureDir(path.dirname(filePath));
    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(filePath, buffer);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============ EdgeTTS 相关 IPC ============

// 获取可用语音列表
ipcMain.handle('get-voices', async () => {
  return voiceConfig;
});

// 使用 EdgeTTS 合成语音
ipcMain.handle('synthesize-tts', async (event, text, voice, rate = '+0%') => {
  try {
    ensureDir(tempDir);
    
    const edge = await loadEdgeTTS();
    
    const voiceName = voiceConfig[voice] || voice || voiceConfig.female;
    const outputPath = path.join(tempDir, `tts_${Date.now()}.mp3`);
    
    // edge-tts 选项
    const options = {
      voice: voiceName,
      rate: rate,
      volume: '+0%',
      pitch: '+0Hz'
    };
    
    await edge.ttsSave(text, outputPath, options);
    
    if (fs.existsSync(outputPath)) {
      return { success: true, path: outputPath };
    } else {
      return { success: false, error: '音频文件生成失败' };
    }
  } catch (error) {
    if (isNetworkError(error)) {
      return { success: false, error: 'EdgeTTS 网络不可用' };
    }
    console.error('EdgeTTS 合成失败:', error);
    return { success: false, error: error.message || 'EdgeTTS 合成失败' };
  }
});

// 批量合成语音
ipcMain.handle('synthesize-batch', async (event, items) => {
  const results = [];
  
  for (const item of items) {
    const result = await ipcMain.invoke('synthesize-tts', item.text, item.voice, item.rate);
    results.push({
      ...item,
      ...result
    });
  }
  
  return results;
});

// 列出 EdgeTTS 发音人
ipcMain.handle('list-edge-voices', async () => {
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const edge = await loadEdgeTTS();
      const voices = await edge.getVoices();
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
      console.error('获取发音人列表失败:', error);
      return { success: false, voices: Object.values(voiceConfig) };
    }
  }
});

// 获取临时音频文件
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

// 清理临时文件
ipcMain.handle('cleanup-temp', async () => {
  try {
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(tempDir, file));
      });
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

app.whenReady().then(async () => {
  const settings = loadSettings();
  await applyProxySettings(settings);
  createWindow();
});

app.on('window-all-closed', () => {
  // 清理临时文件
  try {
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(tempDir, file));
      });
    }
  } catch (e) {}
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
