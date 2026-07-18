const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let effectManagerWindow = null;
let roleManagerWindow = null;
let settingsWindow = null;

function readPackageMeta() {
  const candidates = [
    path.join(app.getAppPath(), 'package.json'),
    path.join(process.resourcesPath || '', 'app', 'package.json'),
    path.join(process.resourcesPath || '', 'app.asar', 'package.json'),
    path.join(__dirname, '../../package.json')
  ].filter(Boolean);

  for (const pkgPath of candidates) {
    try {
      if (!fs.existsSync(pkgPath)) continue;
      const raw = fs.readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw.replace(/^\uFEFF/, ""));
      return {
        name: pkg.productName || pkg.name || app.getName() || '亿方听力大师',
        version: app.getVersion() || pkg.version || '0.0.0',
        description: pkg.description || '',
        author: typeof pkg.author === 'string' ? pkg.author : (pkg.author?.name || '')
      };
    } catch (e) { console.warn('读取package.json失败:', e); }
  }

  return {
    name: app.getName() || '亿方听力大师',
    version: app.getVersion() || '0.0.0',
    description: '',
    author: ''
  };
}

function getMainWindow() { return mainWindow; }

function getMainTargetWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && focused === mainWindow) return focused;
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return focused || null;
}

function sendToMain(channel, ...args) {
  const target = getMainTargetWindow();
  if (target && target.webContents && !target.webContents.isDestroyed()) target.webContents.send(channel, ...args);
}

function getAppTitle() {
  const meta = readPackageMeta();
  const osName = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
  return `亿方听力大师 v${meta.version} ${osName}`;
}

function createMainWindow() {
  let isClosing = false;

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
    title: getAppTitle()
  });

  mainWindow.loadFile('pages/index.html');

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.setTitle(getAppTitle());
  });

  mainWindow.on('close', (e) => {
    if (isClosing) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;

    e.preventDefault();
    isClosing = true;

    mainWindow.webContents.send('request-close-check');

    const closeTimeout = setTimeout(() => {
      mainWindow.destroy();
    }, 5000);

    ipcMain.once('close-check-result', (event, shouldClose) => {
      clearTimeout(closeTimeout);
      if (shouldClose) {
        mainWindow.destroy();
      } else {
        isClosing = false;
      }
    });
  });

  mainWindow.on('closed', () => {
    if (effectManagerWindow && !effectManagerWindow.isDestroyed()) effectManagerWindow.close();
    if (roleManagerWindow && !roleManagerWindow.isDestroyed()) roleManagerWindow.close();
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
    mainWindow = null;
  });

  createMenu();
  return mainWindow;
}

let menuItems = {};

function setMenuContext(isHome) {
  const editItems = ['edit-undo', 'edit-redo', 'edit-cut', 'edit-copy', 'edit-paste', 'edit-select-all'];
  const fileItems = ['file-save', 'file-save-as', 'file-export'];
  const playItems = ['play-preview', 'play-stop'];

  const targets = isHome ? [...editItems, ...fileItems, ...playItems] : [...editItems, ...fileItems, ...playItems];
  for (const id of targets) {
    const item = menuItems[id];
    if (item) item.enabled = !isHome;
  }
}

function createMenu() {
  const sendEditAction = (action) => sendToMain('menu-edit', action);

  const menuTemplate = [
    {
      label: '文件',
      submenu: [
        { id: 'file-new', label: '新建', accelerator: 'CmdOrCtrl+Shift+N', click: () => sendToMain('menu-new') },
        {
          id: 'file-open', label: '打开项目', accelerator: 'CmdOrCtrl+O', click: async () => {
            const owner = getMainTargetWindow() || mainWindow;
            const result = await dialog.showOpenDialog(owner, {
              filters: [{ name: 'Listext Project', extensions: ['lstx'] }],
              properties: ['openFile']
            });
            if (!result.canceled && result.filePaths.length > 0) sendToMain('menu-open-project', result.filePaths[0]);
          }
        },
        { id: 'file-save', label: '保存项目', accelerator: 'CmdOrCtrl+S', click: () => sendToMain('menu-save') },
        {
          id: 'file-save-as', label: '项目另存为', accelerator: 'CmdOrCtrl+Shift+S', click: async () => {
            const owner = getMainTargetWindow() || mainWindow;
            const result = await dialog.showSaveDialog(owner, {
              filters: [{ name: 'Listext Project', extensions: ['lstx'] }],
              defaultPath: 'untitled.lstx'
            });
            if (!result.canceled) sendToMain('menu-save-as', result.filePath);
          }
        },
        { type: 'separator' },
        {
          id: 'file-export', label: '导出音频', accelerator: 'CmdOrCtrl+E', click: () => {
            sendToMain('export-audio');
          }
        },
        { type: 'separator' },
        { id: 'file-preferences', label: '首选项', click: () => openSettingsWindow() },
        { type: 'separator' },
        { id: 'file-quit', role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { id: 'edit-undo', label: '撤销', accelerator: 'CmdOrCtrl+Z', click: () => sendEditAction('undo') },
        { id: 'edit-redo', label: '重做', accelerator: 'CmdOrCtrl+Shift+Z', click: () => sendEditAction('redo') },
        { type: 'separator' },
        { id: 'edit-cut', label: '剪切', accelerator: 'CmdOrCtrl+X', click: () => sendEditAction('cut') },
        { id: 'edit-copy', label: '复制', accelerator: 'CmdOrCtrl+C', click: () => sendEditAction('copy') },
        { id: 'edit-paste', label: '粘贴', accelerator: 'CmdOrCtrl+V', click: () => sendEditAction('paste') },
        { id: 'edit-select-all', label: '全选', accelerator: 'CmdOrCtrl+A', click: () => sendEditAction('selectAll') }
      ]
    },
    {
      label: '播放',
      submenu: [
        { id: 'play-preview', label: '预览播放', accelerator: 'F5', click: () => sendToMain('preview-play') },
        { id: 'play-stop', label: '停止播放', accelerator: 'Escape', click: () => sendToMain('stop-play') }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { id: 'help-syntax', label: '语法说明', click: () => sendToMain('show-syntax-help') },
        { type: 'separator' },
        {
          id: 'help-about', label: '关于',
          click: () => {
            const owner = getMainTargetWindow() || mainWindow;
            const meta = readPackageMeta();
            const detail = [meta.description || '', meta.author ? `开发者：${meta.author}` : ''].filter(Boolean).join('\n');
            dialog.showMessageBox(owner, {
              type: 'info',
              title: `关于 ${meta.name}`,
              message: `${meta.name} v${meta.version}`,
              detail: detail || `版本：${meta.version}`
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  menuItems = {};
  for (const topLabel of menuTemplate) {
    const topItem = menu.items.find(m => m.label === topLabel.label);
    if (topItem && topItem.submenu) {
      for (const sub of topLabel.submenu) {
        if (!sub.id) continue;
        const subItem = topItem.submenu.items.find(s => s.label === sub.label);
        if (subItem) menuItems[sub.id] = subItem;
      }
    }
  }

  return menu;
}

ipcMain.on('tab-context-changed', (event, isHome) => {
  setMenuContext(isHome);
});

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
  if (effectManagerWindow && !effectManagerWindow.isDestroyed()) return effectManagerWindow.focus();
  effectManagerWindow = buildChildWindow({ modal: true, parent: mainWindow, width: 860, height: 680, title: '音效管理器' });
  effectManagerWindow.loadFile('pages/effects-manager.html');
  effectManagerWindow.setMenu(null);
  effectManagerWindow.setMenuBarVisibility(false);
  effectManagerWindow.on('closed', () => { effectManagerWindow = null; });
}

function openRoleManager() {
  if (roleManagerWindow && !roleManagerWindow.isDestroyed()) return roleManagerWindow.focus();
  roleManagerWindow = buildChildWindow({ modal: true, parent: mainWindow, width: 760, height: 680, title: '角色管理器' });
  roleManagerWindow.loadFile('pages/role-manager.html');
  roleManagerWindow.setMenu(null);
  roleManagerWindow.setMenuBarVisibility(false);
  roleManagerWindow.on('closed', () => { roleManagerWindow = null; });
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) return settingsWindow.focus();
  settingsWindow = buildChildWindow({ width: 800, height: 600, resizable: true, title: '设置' });
  settingsWindow.loadFile('pages/settings.html');
  settingsWindow.setMenu(null);
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

module.exports = { createMainWindow, getMainWindow, openEffectManager, openRoleManager, openSettingsWindow };
