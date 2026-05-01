const { BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const { ensureDir } = require('./utils');

let mainWindow;
let effectManagerWindow = null;
let roleManagerWindow = null;
let settingsWindow = null;
const soundsDir = path.join(path.dirname(process.execPath), 'sounds');

function getMainWindow() {
  return mainWindow;
}

function getMainTargetWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && focused === mainWindow) return focused;
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return focused || null;
}

function sendToMain(channel, ...args) {
  const target = getMainTargetWindow();
  if (target && target.webContents && !target.webContents.isDestroyed()) {
    target.webContents.send(channel, ...args);
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../../preload.js'),
      sandbox: false
    },
    title: 'Listext Editor'
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    if (effectManagerWindow && !effectManagerWindow.isDestroyed()) effectManagerWindow.close();
    if (roleManagerWindow && !roleManagerWindow.isDestroyed()) roleManagerWindow.close();
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
  });

  createMenu();

  return mainWindow;
}

function createMenu() {
  const sendEditAction = (action) => {
    sendToMain('menu-edit', action);
  };

  const menuTemplate = [
    {
      label: '文件',
      submenu: [
        {
          label: '新建',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendToMain('menu-new')
        },
        {
          label: '打开',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const owner = getMainTargetWindow() || mainWindow;
            const result = await dialog.showOpenDialog(owner, {
              filters: [{ name: 'Listext Files', extensions: ['lxt', 'txt'] }],
              properties: ['openFile']
            });
            if (!result.canceled && result.filePaths.length > 0) {
              const fs = require('fs');
              const content = fs.readFileSync(result.filePaths[0], 'utf-8');
              sendToMain('file-opened', content, result.filePaths[0]);
            }
          }
        },
        {
          label: '保存',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendToMain('menu-save')
        },
        {
          label: '另存为',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: async () => {
            const owner = getMainTargetWindow() || mainWindow;
            const result = await dialog.showSaveDialog(owner, {
              filters: [{ name: 'Listext Files', extensions: ['lxt'] }],
              defaultPath: 'untitled.lxt'
            });
            if (!result.canceled) {
              sendToMain('menu-save-as', result.filePath);
            }
          }
        },
        { type: 'separator' },
        {
          label: '导出音频',
          accelerator: 'CmdOrCtrl+E',
          click: async () => {
            const owner = getMainTargetWindow() || mainWindow;
            const result = await dialog.showSaveDialog(owner, {
              filters: [{ name: 'WAV Audio', extensions: ['wav'] }],
              defaultPath: 'listening.wav'
            });
            if (!result.canceled) {
              sendToMain('export-audio', result.filePath);
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
    {
      label: '工具',
      submenu: [
        {
          label: '音效管理器',
          click: () => openEffectManager()
        },
        {
          label: '角色管理器',
          click: () => openRoleManager()
        },
        {
          label: '设置',
          click: () => openSettingsWindow()
        },
        {
          label: '打开 sounds 文件夹',
          click: () => {
            ensureDir(soundsDir);
            shell.openPath(soundsDir);
          }
        },
        { type: 'separator' },
        {
          label: '预览播放',
          accelerator: 'F5',
          click: () => sendToMain('preview-play')
        },
        {
          label: '停止播放',
          accelerator: 'Escape',
          click: () => sendToMain('stop-play')
        }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: 'Listext 语法说明',
          click: () => sendToMain('show-syntax-help')
        },
        { type: 'separator' },
        {
          label: '关于',
          click: () => {
            const owner = getMainTargetWindow() || mainWindow;
            dialog.showMessageBox(owner, {
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

function buildChildWindow(options) {
  return new BrowserWindow({
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../../preload.js'),
      sandbox: false
    },
    ...options
  });
}

function openEffectManager() {
  if (effectManagerWindow && !effectManagerWindow.isDestroyed()) {
    effectManagerWindow.focus();
    return;
  }

  effectManagerWindow = buildChildWindow({
    width: 700,
    height: 600,
    title: '音效管理器'
  });

  effectManagerWindow.loadFile('effects-manager.html');
  effectManagerWindow.setMenu(null);
  effectManagerWindow.setMenuBarVisibility(false);

  effectManagerWindow.on('closed', () => {
    effectManagerWindow = null;
  });
}

function openRoleManager() {
  if (roleManagerWindow && !roleManagerWindow.isDestroyed()) {
    roleManagerWindow.focus();
    return;
  }

  roleManagerWindow = buildChildWindow({
    width: 760,
    height: 680,
    title: '角色管理器'
  });

  roleManagerWindow.loadFile('role-manager.html');
  roleManagerWindow.setMenu(null);
  roleManagerWindow.setMenuBarVisibility(false);

  roleManagerWindow.on('closed', () => {
    roleManagerWindow = null;
  });
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = buildChildWindow({
    width: 520,
    height: 360,
    resizable: false,
    title: '设置'
  });

  settingsWindow.loadFile('settings.html');
  settingsWindow.setMenu(null);
  settingsWindow.setMenuBarVisibility(false);

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

module.exports = {
  createMainWindow,
  getMainWindow,
  openEffectManager,
  openRoleManager,
  openSettingsWindow
};

