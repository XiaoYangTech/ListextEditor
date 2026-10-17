#!/usr/bin/env node
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
 * 本地打包「纯净版」Windows x64 安装包（给熟人/学校等场景用，不对外发布）
 *
 * 纯净版 = 打开 src/build-flags.json 的 cleanEdition 开关后构建：
 * 界面上隐藏系统公告、例程模板库、主页轮播、帮助里的作者/自媒体链接、关于里的作者信息、
 * 捐助/更新等弹窗，并停用所有公开接口与更新检查（素材文件保持原样，不做任何替换）。
 *
 * 用法：node scripts/build-clean.js
 * 产物：dist/ListextEditor-<版本>-clean-Setup.exe
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const flagsPath = path.join(root, 'src', 'build-flags.json');

function main() {
  const flagsBackup = fs.readFileSync(flagsPath, 'utf-8');
  // 构建产物名与标准版相同（ListextEditor-<版本>-Setup.exe），会覆盖 dist 里已有的标准版安装包，
  // 先备份、构建并改名后还原，避免纯净版构建把标准版产物弄丢
  const distDir = path.join(root, 'dist');
  const existingStandard = fs.existsSync(distDir)
    ? fs.readdirSync(distDir).find(f => /^ListextEditor-.*-Setup\.exe$/i.test(f))
    : null;
  const existingStandardData = existingStandard ? fs.readFileSync(path.join(distDir, existingStandard)) : null;

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    try { fs.writeFileSync(flagsPath, flagsBackup); } catch (e) { console.warn('[纯净版] 还原构建开关失败:', e.message); }
    if (existingStandardData) {
      try {
        fs.writeFileSync(path.join(distDir, existingStandard), existingStandardData);
        console.log('[纯净版] 已还原标准版安装包:', existingStandard);
      } catch (e) { console.warn('[纯净版] 还原标准版安装包失败:', e.message); }
    }
  };
  process.on('exit', restore);
  process.on('SIGINT', () => { restore(); process.exit(1); });
  process.on('SIGTERM', () => { restore(); process.exit(1); });

  try {
    console.log('[纯净版] 1/4 打开 cleanEdition 开关');
    fs.writeFileSync(flagsPath, JSON.stringify({ cleanEdition: true }, null, 2) + '\n');

    console.log('[纯净版] 2/4 开始构建 Windows x64 安装包（可能需要几分钟）…');
    // 用 node 直接跑 electron-builder 的 CLI 入口：Windows 上 execFileSync('npx.cmd') 会 EINVAL
    const builderCli = require.resolve('electron-builder/out/cli/cli.js');
    // 构建所需的 NSIS/winCodeSign 等资源默认从 GitHub 下载，国内容易超时；
    // 默认走 npmmirror 镜像（可用环境变量 ELECTRON_BUILDER_BINARIES_MIRROR 覆盖）
    const env = {
      ...process.env,
      LISTEXT_CLEAN: '1',
      ELECTRON_BUILDER_BINARIES_MIRROR: process.env.ELECTRON_BUILDER_BINARIES_MIRROR
        || 'https://npmmirror.com/mirrors/electron-builder-binaries/'
    };
    execFileSync(process.execPath, [builderCli, '--win', 'nsis', '--x64', '--publish', 'never'], {
      cwd: root,
      stdio: 'inherit',
      env
    });

    console.log('[纯净版] 3/4 产物改名');
    const distDir = path.join(root, 'dist');
    const setup = fs.readdirSync(distDir).find(f => /^ListextEditor-.*-Setup\.exe$/i.test(f));
    if (!setup) {
      console.warn('[纯净版] 未找到安装包产物，请检查 dist 目录');
      return;
    }
    const cleanName = setup.replace(/-Setup\.exe$/i, '-clean-Setup.exe');
    const to = path.join(distDir, cleanName);
    fs.renameSync(path.join(distDir, setup), to);
    console.log('[纯净版] 4/4 完成:', to, `（${(fs.statSync(to).size / 1024 / 1024).toFixed(1)} MB）`);
  } finally {
    restore();
    console.log('[纯净版] 已还原源码构建开关');
  }
}

main();
