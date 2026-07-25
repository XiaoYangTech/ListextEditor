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
