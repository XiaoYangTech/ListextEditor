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

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { ensureDir } = require('./utils');

const builtInSoundsDir = path.join(app.getAppPath(), 'assets', 'default-sounds');
const devBuiltInSoundsDir = path.join(process.cwd(), 'assets', 'default-sounds');

function getBuiltInRoots() {
  const roots = [];
  if (fs.existsSync(builtInSoundsDir)) roots.push(builtInSoundsDir);
  if (fs.existsSync(devBuiltInSoundsDir) && devBuiltInSoundsDir !== builtInSoundsDir) roots.push(devBuiltInSoundsDir);
  if (!roots.length) roots.push(devBuiltInSoundsDir);
  return roots;
}

function getBuiltInDir() {
  return getBuiltInRoots()[0];
}

const BUILTIN_GROUP_DIRS = {
  '开场音乐': 'opening-music',
  '常见音效': 'common-effects',
  '环境音': 'ambient'
};

function scanAudioFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir);
  const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];
  return files.filter(file => audioExtensions.includes(path.extname(file).toLowerCase()));
}

function scanBuiltInSounds() {
  const roots = getBuiltInRoots();
  const list = [];
  const dedupe = new Set();

  for (const root of roots) {
    for (const [groupName, folder] of Object.entries(BUILTIN_GROUP_DIRS)) {
      const dir = path.join(root, folder);
      if (!fs.existsSync(dir)) continue;
      const files = scanAudioFiles(dir);
      for (const file of files) {
        const dKey = `${groupName}::${file}`;
        if (dedupe.has(dKey)) continue;
        dedupe.add(dKey);

        const sndName = path.basename(file, path.extname(file));
        list.push({
          id: sndName,
          source: 'builtin',
          group: groupName,
          filename: file,
          path: path.join(dir, file)
        });
      }
    }
  }

  return list;
}

module.exports = {
  scanBuiltInSounds,
  getBuiltInDir,
  getBuiltInRoots,
  BUILTIN_GROUP_DIRS
};
