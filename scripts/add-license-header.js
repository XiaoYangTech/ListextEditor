/**
 * 为项目源文件批量添加 GPLv3 许可声明头部（幂等，可重复运行）。
 * 覆盖：main.js、preload.js，以及 src、pages、styles 目录下全部 .js / .html / .css（递归）
 * 用法：node scripts/add-license-header.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MARKER = 'GNU General Public License';

const NOTICE_LINES = [
  '亿方听力大师 (ListextEditor)',
  'Copyright (C) 2026 The InspireWorks Development Team',
  '',
  'This program is free software: you can redistribute it and/or modify',
  'it under the terms of the GNU General Public License as published by',
  'the Free Software Foundation, either version 3 of the License, or',
  '(at your option) any later version.',
  '',
  'This program is distributed in the hope that it will be useful,',
  'but WITHOUT ANY WARRANTY; without even the implied warranty of',
  'MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the',
  'GNU General Public License for more details.',
  '',
  'You should have received a copy of the GNU General Public License',
  'along with this program.  If not, see <https://www.gnu.org/licenses/>.',
];

function blockComment(eol) {
  return ['/*', ...NOTICE_LINES.map(l => (l ? ' * ' + l : ' *')), ' */'].join(eol) + eol + eol;
}
function htmlComment(eol) {
  return ['<!--', ...NOTICE_LINES.map(l => (l ? '  ' + l : '')), '-->'].join(eol) + eol + eol;
}

/** 递归收集目录下指定扩展名的文件 */
function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, exts, out);
    else if (exts.includes(path.extname(entry.name).toLowerCase())) out.push(p);
  }
  return out;
}

function collectTargets() {
  const files = [];
  for (const f of ['main.js', 'preload.js']) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) files.push(p);
  }
  files.push(...walk(path.join(ROOT, 'src'), ['.js']));
  files.push(...walk(path.join(ROOT, 'pages'), ['.html']));
  files.push(...walk(path.join(ROOT, 'styles'), ['.css']));
  return files;
}

let added = 0, skipped = 0;
for (const file of collectTargets()) {
  const raw = fs.readFileSync(file, 'utf8');
  if (raw.slice(0, 800).includes(MARKER)) { skipped++; continue; }

  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const ext = path.extname(file).toLowerCase();
  let content;
  if (ext === '.html') {
    const header = htmlComment(eol);
    // HTML 注释不能放在 <!DOCTYPE> 之前（会触发怪异模式），插到 DOCTYPE 之后
    const m = raw.match(/^\s*<!DOCTYPE[^>]*>\s*(\r?\n)?/i);
    content = m ? raw.slice(0, m[0].length) + header + raw.slice(m[0].length) : header + raw;
  } else {
    content = blockComment(eol) + raw;
  }
  fs.writeFileSync(file, content);
  added++;
  console.log('added :', path.relative(ROOT, file));
}
console.log(`\n完成：新增 ${added} 个文件，跳过（已有声明）${skipped} 个`);
