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
 * 渲染进程日志转发（index.html 与 settings.html 共用，须在其他脚本之前引入）
 * - console.log/warn/error 双写控制台与主进程日志文件
 * - 未捕获错误与未处理的 Promise 拒绝一并落盘
 * 说明：主进程 logger 只包装了主进程 console，渲染进程必须经 append-log IPC 才能进日志文件
 */
(function () {
  const api = window.electronAPI;
  if (!api?.appendLog) return;

  const serialize = (a) => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'object' && a !== null) {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  };

  for (const level of ['log', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      orig(...args);
      try { api.appendLog(level, args.map(serialize)); } catch { /* 日志失败不影响业务 */ }
    };
  }

  window.addEventListener('error', (e) => {
    try {
      const where = e.filename ? ` @${e.filename}:${e.lineno}:${e.colno}` : '';
      api.appendLog('error', [`[未捕获错误] ${e.message}${where}`]);
    } catch { /* 忽略 */ }
  });

  window.addEventListener('unhandledrejection', (e) => {
    try { api.appendLog('error', ['[未处理的 Promise 拒绝]', serialize(e.reason)]); } catch { /* 忽略 */ }
  });
})();
