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

#!/usr/bin/env node
/*
 * 把 OpenShenzhou 的 g2p 数据同步到 vendor/data（62MB，不进 git）
 * 用法：node scripts/sync-openshenzhou-data.js [OpenShenzhou 仓库路径]
 * 默认路径：../OpenShenzhou
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = process.argv[2] || path.join(root, '..', 'OpenShenzhou');
const srcData = path.join(src, 'data');
const dstData = path.join(root, 'vendor', 'data');

if (!fs.existsSync(srcData)) {
  console.error('[同步] 找不到数据目录：' + srcData);
  console.error('       请先克隆 OpenShenzhou（任一分支都带 data/），或传入路径参数');
  process.exit(1);
}
fs.rmSync(dstData, { recursive: true, force: true });
fs.mkdirSync(path.dirname(dstData), { recursive: true });
fs.cpSync(srcData, dstData, { recursive: true });
const size = (() => { let t = 0; const st = [dstData]; while (st.length) { const c = st.pop(); for (const e of fs.readdirSync(c, { withFileTypes: true })) { const p = path.join(c, e.name); if (e.isDirectory()) st.push(p); else t += fs.statSync(p).size; } } return t; })();
console.log('[同步] 完成：' + dstData);
console.log('       大小 ' + (size / 1024 / 1024).toFixed(1) + ' MB');
