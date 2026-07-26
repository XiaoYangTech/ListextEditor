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

let fsExt = null;
try {
  fsExt = require('fs-native-extensions');
} catch (e) {
  console.warn('fs-native-extensions 不可用，文件锁定功能已禁用:', e.message);
}

class FileLocker {
  constructor() {
    this._locks = new Map();
  }

  lock(filePath) {
    if (!filePath || typeof filePath !== 'string') return null;
    filePath = path.resolve(filePath);

    if (this._locks.has(filePath)) return true;
    if (!fs.existsSync(filePath)) return null;
    // 原生模块不可用时降级为无锁模式，而不是误报"被占用"
    if (!fsExt) return null;

    let fd = null;
    try {
      fd = fs.openSync(filePath, 'r+');
      if (!fsExt.tryLock(fd)) {
        fs.closeSync(fd);
        return false;
      }
      this._locks.set(filePath, fd);
      return true;
    } catch (e) {
      if (fd != null) { try { fs.closeSync(fd); } catch {} }
      return false;
    }
  }

  unlock(filePath) {
    if (!filePath) return;
    filePath = path.resolve(filePath);
    const fd = this._locks.get(filePath);
    if (fd == null) return;

    try {
      fsExt.unlock(fd);
    } catch (e) {
      console.error('释放文件锁失败, unlock:', filePath, e);
    }

    try {
      fs.closeSync(fd);
    } catch (e) {
      console.error('关闭文件描述符失败:', filePath, e);
    }

    this._locks.delete(filePath);
  }

  // 通过持有锁的 fd 读取文件内容（Windows 排他锁会拒绝经其他句柄读写，包括本进程）
  readLocked(filePath) {
    if (!filePath) return null;
    const fd = this._locks.get(path.resolve(filePath));
    if (fd == null) return null;
    try {
      const size = fs.fstatSync(fd).size;
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, 0);
      return buf;
    } catch (e) {
      console.error('读取锁定文件失败:', filePath, e);
      return null;
    }
  }

  // 通过持有锁的 fd 覆盖写入文件内容
  writeLocked(filePath, buf) {
    if (!filePath || !Buffer.isBuffer(buf)) return false;
    const fd = this._locks.get(path.resolve(filePath));
    if (fd == null) return false;
    try {
      fs.ftruncateSync(fd, 0);
      fs.writeSync(fd, buf, 0, buf.length, 0);
      return true;
    } catch (e) {
      console.error('写入锁定文件失败:', filePath, e);
      return false;
    }
  }

  isLocked(filePath) {
    if (!filePath) return false;
    return this._locks.has(path.resolve(filePath));
  }

  unlockAll() {
    for (const filePath of this._locks.keys()) {
      this.unlock(filePath);
    }
  }
}

const fileLocker = new FileLocker();
module.exports = fileLocker;
