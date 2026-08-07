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

/**
 * 日志系统：主进程与渲染进程日志统一落盘
 * - 按天写 userData/logs/listext-YYYY-MM-DD.log
 * - 单文件超 5MB 滚动 .1/.2，启动时清理 7 天前旧日志
 * - 主进程 console.* 双写控制台与文件；渲染进程经 append-log IPC 落盘
 * - 崩溃（uncaughtException/unhandledRejection）记录 FATAL
 * 纪律：不写 token/密码等敏感内容
 */

const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');

const MAX_SIZE = 5 * 1024 * 1024;
const KEEP_DAYS = 7;

let logDir = null;
let currentFile = null;
let currentDate = null;

function ensureLogDir() {
  if (!logDir) {
    logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
  }
  return logDir;
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function getLogFile() {
  const t = today();
  if (currentFile && currentDate === t) return currentFile;
  currentDate = t;
  currentFile = path.join(ensureLogDir(), `listext-${t}.log`);
  return currentFile;
}

function formatArg(a) {
  if (a instanceof Error) return a.stack || a.message;
  if (typeof a === 'object' && a !== null) {
    try { return JSON.stringify(a); } catch { return String(a); }
  }
  return String(a);
}

function write(level, args) {
  try {
    const file = getLogFile();
    try {
      const st = fs.existsSync(file) ? fs.statSync(file) : null;
      if (st && st.size > MAX_SIZE) {
        const f1 = file + '.1';
        const f2 = file + '.2';
        if (fs.existsSync(f2)) fs.unlinkSync(f2);
        if (fs.existsSync(f1)) fs.renameSync(f1, f2);
        fs.renameSync(file, f1);
      }
    } catch { /* 滚动失败不阻塞写日志 */ }
    const time = new Date().toISOString();
    const text = (Array.isArray(args) ? args : [args]).map(formatArg).join(' ');
    fs.appendFileSync(file, `[${time}] [${level}] ${text}\n`);
  } catch { /* 日志失败静默，绝不影响业务 */ }
}

function cleanOldLogs() {
  try {
    const dir = ensureLogDir();
    const cutoff = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
    for (const f of fs.readdirSync(dir)) {
      try {
        const st = fs.statSync(path.join(dir, f));
        if (st.mtimeMs < cutoff) fs.unlinkSync(path.join(dir, f));
      } catch { /* 单文件清理失败跳过 */ }
    }
  } catch { /* 忽略清理失败 */ }
}

// 目录大小递归求和（失败按 0）
function dirSize(dir) {
  let total = 0;
  try {
    if (!fs.existsSync(dir)) return 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) total += dirSize(p);
        else total += fs.statSync(p).size;
      } catch { /* 单文件失败跳过 */ }
    }
  } catch { /* 忽略 */ }
  return total;
}

// 目录超限时按 mtime 最旧先删到限内（不删子目录结构本身）
function enforceDirSize(dir, maxBytes) {
  try {
    if (!fs.existsSync(dir)) return;
    const files = [];
    (function walk(d) {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name);
        try {
          if (entry.isDirectory()) walk(p);
          else {
            const st = fs.statSync(p);
            files.push({ p, size: st.size, mtime: st.mtimeMs });
          }
        } catch { /* 跳过 */ }
      }
    })(dir);
    let total = files.reduce((s, f) => s + f.size, 0);
    if (total <= maxBytes) return;
    files.sort((a, b) => a.mtime - b.mtime);
    for (const f of files) {
      if (total <= maxBytes) break;
      try { fs.unlinkSync(f.p); total -= f.size; } catch { /* 跳过 */ }
    }
    console.log(`[日志] 目录限额清理: ${dir} 删除过期文件至 ${(total / 1024 / 1024).toFixed(1)}MB`);
  } catch { /* 忽略 */ }
}

function wrapConsole(level) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    orig(...args);
    write(level.toUpperCase(), args);
  };
}

function initLogger() {
  ensureLogDir();
  cleanOldLogs();
  // 旧版临时目录（listext-editor 小写连字符）一次性清除
  try {
    const oldTempDir = path.join(app.getPath('temp'), 'listext-editor');
    if (fs.existsSync(oldTempDir)) fs.rmSync(oldTempDir, { recursive: true, force: true });
  } catch { /* 忽略 */ }
  // 各类缓存目录 1GB 限额（日志/TTS 临时文件/工程音效解压缓存）
  const G = 1024 * 1024 * 1024;
  const tempDir = path.join(app.getPath('temp'), 'ListextEditor');
  enforceDirSize(getLogDir(), G);
  enforceDirSize(tempDir, G);
  enforceDirSize(path.join(app.getPath('userData'), 'project-sounds'), G);
  wrapConsole('log');
  wrapConsole('warn');
  wrapConsole('error');
  process.on('uncaughtException', (e) => write('FATAL', [e]));
  process.on('unhandledRejection', (e) => write('FATAL', [e]));
  ipcMain.handle('append-log', (event, level, args) => {
    const lv = ['log', 'warn', 'error'].includes(level) ? level.toUpperCase() : 'LOG';
    write(lv, args);
  });
  console.log('[日志] 日志系统已启动:', getLogFile());
}

function getLogDir() {
  return ensureLogDir();
}

module.exports = { initLogger, getLogDir, dirSize, enforceDirSize };
