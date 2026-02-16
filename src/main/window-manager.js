const { BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const { ensureDir } = require('./utils');

let mainWindow;
let effectManagerWindow = null;
const soundsDir = path.join(path.dirname(process.execPath), 'sounds');

function getMainWindow() {
  return mainWindow;
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
      preload: path.join(__dirname, '../../preload.js')
    },
    title: 'Listext Editor'
  });

  mainWindow.loadFile('index.html');

  createMenu();
  
  return mainWindow;
}

function createMenu() {
  const sendEditAction = (action) => {
    const target = BrowserWindow.getFocusedWindow() || mainWindow;
    if (target && target.webContents) {
      target.webContents.send('menu-edit', action);
    }
  };

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
              const fs = require('fs');
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
            shell.openPath(soundsDir);
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
      preload: path.join(__dirname, '../../preload.js')
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

module.exports = {
  createMainWindow,
  getMainWindow,
  openEffectManager
};
