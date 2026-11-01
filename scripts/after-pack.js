#!/usr/bin/env node
/*
 * electron-builder afterPack 钩子：按目标平台/架构裁剪 onnxruntime-node 的全平台原生库。
 *
 * onnxruntime-node 的 npm 包里同时带 5 个平台/架构的原生目录：
 *   bin/napi-v6/{win32,linux}/{x64,arm64} 与 bin/napi-v6/darwin/arm64（解压约 293MiB）。
 * 每个安装包实际只需要自己平台/架构的那一份（win32/x64 约 65MiB、linux/x64 约 46MiB、
 * linux/arm64 约 25MiB、darwin/arm64 约 87MiB），其余约 200–270MiB 属于每个包里的死重，
 * 会让 Linux 安装包膨胀到 450MB 级别。
 *
 * 另外 linux/x64 上 onnxruntime 的 postinstall 默认还会从 nuget 下载 CUDA EP 组件
 * （libonnxruntime_providers_{cuda,shared,tensorrt}.so，解压约 272MiB）。本项目只用默认
 * CPU EP（vendor/openshenzhou 未传 executionProviders），CI 里通过
 * ONNXRUNTIME_NODE_INSTALL=skip 从源头跳过；这里再兜底删除一次，防止本地/未来构建把
 * CUDA 组件打进包。
 *
 * asar 打包时 onnxruntime-node 因为含 .node/.dll/.so 会被 electron-builder 整包解包到
 * resources/app.asar.unpacked/，本钩子在生成 NSIS/dmg/AppImage/deb 之前执行，
 * 因此直接删除这里的非目标目录即可减小最终安装包体积。
 * 只要保留的目录里 onnxruntime_binding.node 存在，运行时按
 * `../bin/napi-v6/${process.platform}/${process.arch}/onnxruntime_binding.node` 加载不受影响。
 */
'use strict';

const fs = require('fs');
const path = require('path');

// builder-util 的 Arch 枚举数值（避免在 hook 里依赖 builder-util 解析路径）
const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

function log(message) {
  console.log(`[after-pack] ${message}`);
}

function statTree(dir) {
  let files = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = statTree(full);
      files += sub.files;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      files += 1;
      try {
        bytes += fs.statSync(full).size;
      } catch {
        // 忽略已被并发删除的文件
      }
    }
  }
  return { files, bytes };
}

function removeTree(dir) {
  try {
    const { files, bytes } = statTree(dir);
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    return { files, bytes };
  } catch (error) {
    log(`删除失败（忽略）：${dir} -> ${error.message}`);
    return { files: 0, bytes: 0 };
  }
}

function findResourcesDir(context) {
  const { appOutDir, electronPlatformName } = context;
  if (electronPlatformName === 'darwin') {
    const productFilename = context.packager && context.packager.appInfo && context.packager.appInfo.productFilename;
    const expected = productFilename ? path.join(appOutDir, `${productFilename}.app`) : null;
    if (expected && fs.existsSync(expected)) {
      return path.join(expected, 'Contents', 'Resources');
    }
    const appDirs = fs
      .readdirSync(appOutDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'));
    if (appDirs.length === 0) {
      throw new Error(`after-pack: 在 ${appOutDir} 下找不到 .app 目录`);
    }
    return path.join(appOutDir, appDirs[0].name, 'Contents', 'Resources');
  }
  return path.join(appOutDir, 'resources');
}

// 本项目只用 onnxruntime 的默认 CPU EP，CUDA/TensorRT EP 是对应平台上的死重。
// 正常情况下 CI 已用 ONNXRUNTIME_NODE_INSTALL=skip 避免下载，这里兜底清理历史残留。
const CUDA_PROVIDER_PATTERN = /^libonnxruntime_providers_.*\.so$/;

function removeCudaProviders(keepDir) {
  let removed = { files: 0, bytes: 0 };
  if (!fs.existsSync(keepDir)) {
    return removed;
  }
  for (const entry of fs.readdirSync(keepDir, { withFileTypes: true })) {
    if (!entry.isFile() || !CUDA_PROVIDER_PATTERN.test(entry.name)) {
      continue;
    }
    const full = path.join(keepDir, entry.name);
    try {
      const size = fs.statSync(full).size;
      fs.rmSync(full, { force: true });
      removed.files += 1;
      removed.bytes += size;
    } catch (error) {
      log(`CUDA EP 组件删除失败（忽略）：${full} -> ${error.message}`);
    }
  }
  return removed;
}

module.exports = async function afterPack(context) {
  const { electronPlatformName, arch } = context;
  const archName = ARCH_NAMES[arch] || String(arch);
  if (electronPlatformName !== 'win32' && electronPlatformName !== 'darwin' && electronPlatformName !== 'linux') {
    log(`未知平台 ${electronPlatformName}，跳过 onnxruntime 裁剪`);
    return;
  }
  if (archName === 'universal') {
    // universal 包需要同时保留多个架构，当前没有这种构建；跳过以免误删
    log('universal 架构不同时裁剪 onnxruntime，跳过');
    return;
  }

  const resourcesDir = findResourcesDir(context);
  const napiRoot = path.join(
    resourcesDir,
    'app.asar.unpacked',
    'node_modules',
    'onnxruntime-node',
    'bin',
    'napi-v6'
  );
  if (!fs.existsSync(napiRoot)) {
    log(`未找到 onnxruntime-node 原生目录，跳过裁剪：${napiRoot}`);
    return;
  }

  const keepDir = path.join(napiRoot, electronPlatformName, archName);
  const bindingPath = path.join(keepDir, 'onnxruntime_binding.node');
  if (!fs.existsSync(bindingPath)) {
    throw new Error(
      `after-pack: 目标平台/架构的 onnxruntime 原生绑定缺失：${bindingPath}（平台 ${electronPlatformName} / 架构 ${archName}）`
    );
  }

  let removed = { files: 0, bytes: 0 };
  for (const platformEntry of fs.readdirSync(napiRoot, { withFileTypes: true })) {
    const platformDir = path.join(napiRoot, platformEntry.name);
    if (!platformEntry.isDirectory()) {
      continue;
    }
    if (platformEntry.name !== electronPlatformName) {
      const cut = removeTree(platformDir);
      removed.files += cut.files;
      removed.bytes += cut.bytes;
      continue;
    }
    for (const archEntry of fs.readdirSync(platformDir, { withFileTypes: true })) {
      if (archEntry.name === archName) {
        continue;
      }
      const cut = removeTree(path.join(platformDir, archEntry.name));
      removed.files += cut.files;
      removed.bytes += cut.bytes;
    }
  }

  const kept = statTree(path.join(napiRoot, electronPlatformName));
  const cudaCut = removeCudaProviders(keepDir);
  log(
    `onnxruntime 裁剪完成（平台 ${electronPlatformName}/${archName}）：` +
      `删除 ${removed.files} 个文件 / ${(removed.bytes / 1024 / 1024).toFixed(1)} MiB，` +
      `保留 ${kept.files} 个文件 / ${(kept.bytes / 1024 / 1024).toFixed(1)} MiB`
  );
  if (cudaCut.files > 0) {
    log(
      `额外删除 CUDA/TensorRT EP 组件 ${cudaCut.files} 个文件 / ` +
        `${(cudaCut.bytes / 1024 / 1024).toFixed(1)} MiB（本项目只用 CPU EP）`
    );
  }
};
