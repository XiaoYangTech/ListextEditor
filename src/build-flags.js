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
 * 构建开关（纯净版）
 *
 * cleanEdition=true 时软件会隐藏所有与作者/运营相关的入口，并停用联网功能：
 * - 隐藏：系统公告、例程模板库、主页轮播 banner
 * - 隐藏：帮助菜单里的官网/视频教程/文档/作者 B 站/捐助/检查更新
 * - 隐藏：关于对话框里的作者信息、捐助弹窗、启动弹窗公告、更新弹窗
 * - 停用：所有公开接口请求（公告/轮播/例程/版本）与匿名设备上报
 * - 导出音频不写作者相关 ID3 标签、不加水印音频
 * 用于给熟人或学校等场景分发。
 *
 * 开启方式：
 * - 开发调试：环境变量 LISTEXT_CLEAN=1
 * - 打包：把同目录 build-flags.json 里的 cleanEdition 改为 true（scripts/build-clean.js 会自动处理）
 */
const fs = require('fs');
const path = require('path');

let fromFile = false;
try {
  // 注意：JSON 文件可能带 UTF-8 BOM（编辑器/工具写出的），JSON.parse 会直接报错，先剥掉
  const raw = fs.readFileSync(path.join(__dirname, 'build-flags.json'), 'utf-8').replace(/^\uFEFF/, '');
  fromFile = JSON.parse(raw).cleanEdition === true;
} catch (e) {
  // 缺文件或解析失败按标准版处理
}

const cleanEdition = process.env.LISTEXT_CLEAN === '1' || fromFile;

module.exports = { cleanEdition };
