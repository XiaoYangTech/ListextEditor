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
 * 开发启动器：剔除宿主注入的 ELECTRON_RUN_AS_NODE 后再启动 Electron。
 *
 * 部分开发环境（Electron 系 IDE / Agent 运行时，如 DeepSeek Harness）会给派生的子进程
 * 注入 ELECTRON_RUN_AS_NODE=1，用于让它自己的 Electron 二进制以 Node 模式执行脚本。
 * 这个变量会被 `npm start` 继承，导致 `electron .` 退化成纯 Node：主进程里
 * `require('electron').ipcMain` 为 undefined，启动即崩（window-manager.js 报
 * "Cannot read properties of undefined (reading 'on')"）。
 *
 * 这里只剔除这一个标志，其余环境变量原样传递，命令行参数照旧透传给 Electron。
 */
const { spawn } = require('child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });

child.on('close', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
