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
 * 开放神州（OpenShenzhou）语音模型管理
 *
 * 语音包来自 Windows「讲述人自然语音」的 MSIX/APPX 包（用户自备，程序不携带）：
 * - APPX/MSIX 本质是 zip：解包后找含 phones.txt + am_v5_encoder.bin 的目录；
 *   微软官方包的 zip 是流式写入的（data descriptor），adm-zip 可能读不了，
 *   此时退回系统解压器（Windows 用 .NET ZipFile，macOS/Linux 用 unzip）
 * - 语言判定：包内 voice-info.json（分发版）→ AppxManifest.xml 的 Resource Language
 *   → 最后兜底 MSTTSLoc*.dat 体积最大者
 * - 存放到 userData/openshenzhou-voices/<名称>_<语言>/，SDK 靠目录名识别语言
 * - 支持列目录、导入、删除、打开目录
 */
const { app, ipcMain, dialog, BrowserWindow, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const AdmZip = require('adm-zip');

// 注意：main.js 是在 app ready 之前才把 userData 改到 ListextEditor 的，
// 而本模块在 main.js 顶部就被 require 了，所以目录必须惰性取，不能在模块加载时算死。
function getVoicesDir() {
  return path.join(app.getPath('userData'), 'openshenzhou-voices');
}
const META_FILE = 'meta.json';
const APPX_EXTS = ['.zip', '.appx', '.msix', '.appxbundle'];

// 讲述人语音包的语言标记文件 → 标准 locale
const LOCALE_MAP = {
  ZhCN: 'zh-CN', ZhTW: 'zh-TW', ZhHK: 'zh-HK',
  EnUS: 'en-US', EnGB: 'en-GB', EnIN: 'en-IN', EnAU: 'en-AU', EnCA: 'en-CA',
  JaJP: 'ja-JP', KoKR: 'ko-KR',
  EsES: 'es-ES', EsMX: 'es-MX', FrFR: 'fr-FR', DeDE: 'de-DE', PtBR: 'pt-BR', PtPT: 'pt-PT'
};

// 一个可用语音包必须具备的文件（缺一不可，SDK 加载时会直接报错）
const REQUIRED_FILES = ['phones.txt', 'am_v5_encoder.bin', 'am_v5_decoder.bin', 'device_vocoder_v6_streaming.bin'];

// SDK 文本前端支持的语言（其余语种会直接报"暂不支持的语言"）
const SUPPORTED_LANG = ['zh', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt'];
const LANG_DEFAULT_REGION = { zh: 'CN', en: 'US', ja: 'JP', ko: 'KR', es: 'ES', fr: 'FR', de: 'DE', pt: 'BR' };

/** 把各种写法的语言标记（de-DE / de_DE / DeDE / zh-CN）规范成 LOCALE_MAP 里的标准 locale，不支持则返回 '' */
function normalizeLocale(raw) {
  const m = /^([A-Za-z]{2,3})(?:[-_]([A-Za-z]{2,4}))?/.exec(String(raw || '').trim());
  if (!m) return '';
  const lang = m[1].toLowerCase();
  if (!SUPPORTED_LANG.includes(lang)) return '';
  const key = (v) => v[0].toUpperCase() + v.slice(1);
  const region = (m[2] || LANG_DEFAULT_REGION[lang]).toUpperCase();
  return LOCALE_MAP[key(lang) + region] || LOCALE_MAP[key(lang) + LANG_DEFAULT_REGION[lang]] || '';
}

/** 读取分发版 zip 里写入的 voice-info.json（含规范名/英文名/locale） */
function readVoiceInfo(dir) {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(dir, 'voice-info.json'), 'utf-8').replace(/^\uFEFF/, ''));
    return info && typeof info === 'object' ? info : null;
  } catch {
    return null;
  }
}

/** 从 APPX 清单读取 <Resource Language="xx-XX"/>（官方 appx/msix 包里的权威语言信息） */
function readManifestLocale(dir) {
  try {
    const xml = fs.readFileSync(path.join(dir, 'AppxManifest.xml'), 'utf-8').replace(/^\uFEFF/, '');
    const m = xml.match(/<Resource\s+Language="([^"]+)"/i);
    return m ? normalizeLocale(m[1]) : '';
  } catch {
    return '';
  }
}

function ensureVoicesDir() {
  const dir = getVoicesDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function hasRequiredFiles(dir) {
  try {
    const names = new Set(fs.readdirSync(dir).map(n => n.toLowerCase()));
    return REQUIRED_FILES.every(f => names.has(f.toLowerCase()));
  } catch {
    return false;
  }
}

function missingRequiredFiles(dir) {
  try {
    const names = new Set(fs.readdirSync(dir).map(n => n.toLowerCase()));
    return REQUIRED_FILES.filter(f => !names.has(f.toLowerCase()));
  } catch {
    return [...REQUIRED_FILES];
  }
}

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else { try { total += fs.statSync(p).size; } catch { /* 忽略单个文件 */ } }
    }
  }
  return total;
}

// 从目录里或上一级找 MSTTSLoc<Lang>.dat 判语言
function detectLocale(dir) {
  // 语言判定优先级：分发包 voice-info.json → APPX 清单 Resource Language → 最大 MSTTSLoc 数据
  // （讲述人语音包常同时带多语种数据，只看文件大小容易误判，前两者才是权威信息）
  const candidates = [dir, path.dirname(dir)];
  for (const d of candidates) {
    const info = readVoiceInfo(d);
    if (info) {
      const loc = normalizeLocale(info.locale);
      if (loc) return loc;
    }
    const fromManifest = readManifestLocale(d);
    if (fromManifest) return fromManifest;
  }
  for (const d of candidates) {
    let names = [];
    try { names = fs.readdirSync(d); } catch { continue; }
    let best = null;
    for (const n of names) {
      const m = /^MSTTSLoc([A-Za-z]+)\.dat$/i.exec(n);
      if (!m) continue;
      let size = 0;
      try { size = fs.statSync(path.join(d, n)).size; } catch { /* 忽略 */ }
      const hit = Object.keys(LOCALE_MAP).find(k => k.toLowerCase() === m[1].toLowerCase());
      if (!hit) continue;
      if (!best || size > best.size) best = { locale: LOCALE_MAP[hit], size };
    }
    if (best) return best.locale;
  }
  return '';
}

/**
 * 解压 zip / appx / msix。
 * adm-zip 读不了「流式写入」的包（微软官方 APPX/MSIX 用 data descriptor 记录 entry 长度），
 * 会抛 "Descriptor data is malformed"；此时退回系统解压器：
 * Windows 用 .NET ZipFile，macOS/Linux 用 unzip。
 */
function extractArchive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  try {
    const zip = new AdmZip(src);
    zip.extractAllTo(dest, true);
    return { via: 'adm-zip' };
  } catch (e) {
    console.warn('[开放神州] adm-zip 解包失败，改用系统解压器:', e.message);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
  }
  if (process.platform === 'win32') {
    const esc = (p) => String(p).replace(/'/g, "''");
    const ps = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${esc(src)}','${esc(dest)}')`;
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) return { via: 'powershell' };
    throw new Error(((r.stderr || '') + (r.stdout || '')).trim() || '系统解压失败');
  }
  const r = spawnSync('unzip', ['-q', '-o', src, '-d', dest], { encoding: 'utf8' });
  if (r.status === 0) return { via: 'unzip' };
  throw new Error(((r.stderr || '') + (r.stdout || '')).trim() || 'unzip 解包失败');
}

/** 递归找第一个匹配扩展名的文件 */
function findFileByExt(root, re) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (re.test(e.name)) return p;
    }
  }
  return null;
}

// 深度优先找「含 phones.txt 且含 am_v5_encoder.bin」的目录
function findVoiceDir(root) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    const names = new Set(entries.map(e => e.name.toLowerCase()));
    if (names.has('phones.txt') && names.has('am_v5_encoder.bin')) return dir;
    for (const e of entries) if (e.isDirectory()) stack.push(path.join(dir, e.name));
  }
  return null;
}

function readMeta(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, META_FILE), 'utf-8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

/** 列出已导入的语音模型 */
function listVoices() {
  ensureVoicesDir();
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(getVoicesDir(), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(getVoicesDir(), e.name);
    const meta = readMeta(dir) || {};
    const ok = hasRequiredFiles(dir);
    out.push({
      id: e.name,
      name: meta.name || e.name,
      locale: meta.locale || '',
      size: Number(meta.size) || dirSize(dir),
      importedAt: meta.importedAt || '',
      sourceFile: meta.sourceFile || '',
      ready: ok,
      missing: ok ? [] : missingRequiredFiles(dir)
    });
  }
  // 新导入的排在前面
  out.sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt)));
  return out;
}

/** 导入一个 APPX/MSIX/APPXBUNDLE/ZIP 语音包 */
function importVoice(appxPath) {
  const src = typeof appxPath === 'string' ? appxPath : '';
  if (!src || !fs.existsSync(src)) {
    return { success: false, error: '找不到所选文件，请重新选择语音包（.zip / .appx / .msix）' };
  }
  const ext = path.extname(src).toLowerCase();
  if (!APPX_EXTS.includes(ext)) {
    return { success: false, error: `不支持的文件类型「${ext || '无扩展名'}」，请选择 .zip / .appx / .msix / .appxbundle 语音包` };
  }

  ensureVoicesDir();
  const tempRoot = path.join(app.getPath('temp'), 'ListextEditor', 'osz-import-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));

  try {
    let sourcePath = src;
    const extractRoot = path.join(tempRoot, 'pack');

    // APPXBUNDLE：先展开外层，找出里面第一个 .appx 再解
    if (ext === '.appxbundle') {
      const bundleDir = path.join(tempRoot, 'bundle');
      try {
        extractArchive(src, bundleDir);
      } catch (e) {
        return { success: false, error: `无法读取该文件，可能不是有效的语音包压缩文件（${e.message}）` };
      }
      const nested = findFileByExt(bundleDir, /\.appx$/i);
      if (!nested) {
        return { success: false, error: '这个 appxbundle 里没有找到 .appx 语音包，文件可能已损坏' };
      }
      sourcePath = nested;
    }

    try {
      extractArchive(sourcePath, extractRoot);
    } catch (e) {
      return { success: false, error: `无法读取该文件，可能不是有效的语音包压缩文件（${e.message}）` };
    }

    const voiceDir = findVoiceDir(extractRoot);
    if (!voiceDir) {
      return {
        success: false,
        error: '这个文件里没有找到语音包：解包后应包含 phones.txt 与 am_v5_encoder.bin。请确认下载的是「讲述人自然语音」模型包（APPX/MSIX），或从模型下载页下载应用支持的分发版 .zip。'
      };
    }

    const locale = detectLocale(voiceDir) || detectLocale(tempRoot);
    if (!locale) {
      return {
        success: false,
        error: '无法识别这个语音包的语言：包内没有 voice-info.json、AppxManifest.xml 或 MSTTSLoc 语言数据。请使用官方「讲述人自然语音」语音包，或到模型下载页重新下载。'
      };
    }
    const voiceInfo = readVoiceInfo(voiceDir) || readVoiceInfo(tempRoot) || null;
    // 名称取 appx 文件名（去掉 Microsoft. 前缀与版本后缀，便于识别）
    let baseName = path.basename(sourcePath, path.extname(sourcePath))
      .replace(/^Microsoft\./i, '')
      .replace(/[_\-][\d.]+[_\-].*$/, '')
      .trim();
    baseName = sanitizeName(baseName) || '语音包';
    // 分发版 zip 里带规范名（中文名 + 英文名）时优先用它作为显示名
    if (voiceInfo && voiceInfo.name) {
      const nice = voiceInfo.englishName ? `${voiceInfo.name}（${voiceInfo.englishName}）` : String(voiceInfo.name);
      baseName = sanitizeName(nice) || baseName;
    }
    // 目录名带 locale：SDK 靠目录名（含 zh-cn 这类标记）判断语言。
    // 文件名本身已带 locale（如 Aria_Female_en-US.msix）时不再重复拼接，避免出现 _en-US_en-US
    const baseHasLocale = locale && baseName.toLowerCase().includes(locale.toLowerCase());
    const idBase = locale && !baseHasLocale ? `${baseName}_${locale}` : baseName;
    let id = idBase;
    let n = 2;
    const voicesRoot = getVoicesDir();
    while (fs.existsSync(path.join(voicesRoot, id))) { id = `${idBase}-${n++}`; }

    const dest = path.join(voicesRoot, id);
    fs.cpSync(voiceDir, dest, { recursive: true });

    if (!hasRequiredFiles(dest)) {
      const missing = missingRequiredFiles(dest).join('、');
      try { fs.rmSync(dest, { recursive: true, force: true }); } catch { /* 忽略 */ }
      return { success: false, error: `语音包不完整，缺少：${missing}。请重新下载完整的语音包。` };
    }

    const size = dirSize(dest);
    const meta = {
      name: baseName,
      locale,
      size,
      sourceFile: path.basename(src),
      importedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(dest, META_FILE), JSON.stringify(meta, null, 2), 'utf-8');
    console.log('[开放神州] 导入语音包成功:', id, locale || '未知语言', `${(size / 1024 / 1024).toFixed(1)}MB`);
    return { success: true, voice: { id, name: baseName, locale, size, importedAt: meta.importedAt, ready: true, missing: [] } };
  } catch (e) {
    console.error('[开放神州] 导入语音包失败:', e.message);
    return { success: false, error: `导入失败：${e.message}` };
  } finally {
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* 忽略清理失败 */ }
  }
}

/** 删除一个已导入的语音模型（仅限语音目录内，防止路径穿越） */
function deleteVoice(id) {
  const name = String(id || '');
  if (!name) return { success: false, error: '缺少语音包标识' };
  const voicesRoot = getVoicesDir();
  const target = path.join(voicesRoot, name);
  const rel = path.relative(voicesRoot, target);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') {
    return { success: false, error: '无效的语音包标识' };
  }
  if (!fs.existsSync(target)) return { success: false, error: '语音包不存在（可能已被删除）' };
  try {
    fs.rmSync(target, { recursive: true, force: true });
    ttsCache.delete(name); // 释放已加载的推理实例
    console.log('[开放神州] 已删除语音包:', name);
    return { success: true };
  } catch (e) {
    console.error('[开放神州] 删除语音包失败:', e.message);
    return { success: false, error: `删除失败：${e.message}（文件可能正被占用）` };
  }
}

// ===== 合成（开放神州公测）=====

// TTS 实例缓存：onnxruntime 会话常驻内存，按语音包缓存（超出上限按插入顺序淘汰最早的）
const ttsCache = new Map();
const TTS_CACHE_LIMIT = 4;

function getTts(voiceId) {
  const id = String(voiceId || '').trim();
  const voicesRoot = getVoicesDir();
  const dir = path.join(voicesRoot, id);
  if (!id || !fs.existsSync(dir)) {
    const avail = listVoices().map(v => v.id);
    const hint = avail.length
      ? `已导入的语音模型：${avail.slice(0, 8).join('、')}${avail.length > 8 ? ' 等' : ''}。请到「设置 → 语音模型」改选发音人，或导入这个语音包`
      : '还没有导入任何语音包。请到「设置 → 语音模型」，点「导入语音模型」选择 .zip / .appx / .msix 文件导入';
    throw new Error(`语音模型「${id || '未设置'}」不存在。${hint}`);
  }
  if (!hasRequiredFiles(dir)) {
    const missing = missingRequiredFiles(dir).join('、');
    throw new Error(`语音模型「${id}」文件不完整（缺少 ${missing}），请重新导入`);
  }
  if (ttsCache.has(id)) return ttsCache.get(id);

  let TTS;
  try {
    ({ TTS } = require('../../vendor/openshenzhou/index.js'));
  } catch (e) {
    throw new Error(`开放神州引擎加载失败：${e.message}。可能是 onnxruntime 依赖缺失，请重新安装软件`);
  }
  let tts;
  try {
    tts = new TTS(dir);
  } catch (e) {
    throw new Error(`语音模型「${id}」加载失败：${e.message}`);
  }
  if (!tts.lang || tts.lang === 'unknown') {
    throw new Error(`语音模型「${id}」无法识别语言：目录名需包含语言标记（如 zh-CN），请重新导入或改成 <名称>_<语言>`);
  }
  ttsCache.set(id, tts);
  if (ttsCache.size > TTS_CACHE_LIMIT) {
    const oldest = ttsCache.keys().next().value;
    ttsCache.delete(oldest);
  }
  console.log('[开放神州] 已加载语音模型:', id, '语言', tts.lang);
  return tts;
}

/** 用指定语音模型合成一段文本，返回 WAV 临时文件路径 */
async function synthesizeVoice(text, voiceId, speed = 1.0) {
  const clean = String(text || '').trim();
  if (!clean) return { success: false, error: '朗读文本为空，无法合成' };
  const sp = Math.max(0.5, Math.min(2, Number(speed) || 1.0));
  try {
    const tts = getTts(voiceId);
    const outDir = path.join(app.getPath('temp'), 'ListextEditor', 'osz-synth');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `osz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);
    const started = Date.now();
    const audio = await tts.speak(clean, outPath, sp);
    const seconds = audio.length / 24000;
    console.log('[开放神州] 合成完成:', voiceId, `${clean.length} 字 → ${seconds.toFixed(2)}s`, `耗时 ${Date.now() - started}ms`);
    return { success: true, path: outPath, duration: seconds, ms: Date.now() - started };
  } catch (e) {
    let msg = e?.message || String(e);
    if (/Cannot find module|onnxruntime/i.test(msg)) {
      msg = '开放神州推理引擎（onnxruntime）加载失败，请重新安装软件';
    } else if (/暂不支持的语言/.test(msg)) {
      msg += '。当前支持中文/英文/日文/韩文/西班牙语/法语/德语/葡萄牙语语音包';
    }
    console.error('[开放神州] 合成失败:', msg);
    return { success: false, error: msg };
  }
}

function registerOpenShenzhouHandlers() {
  ipcMain.handle('openshenzhou-synthesize', async (event, opts = {}) =>
    synthesizeVoice(opts.text, opts.voiceId, opts.speed));

  ipcMain.handle('openshenzhou-list-voices', () => {
    try { return { success: true, voices: listVoices() }; }
    catch (e) { return { success: false, voices: [], error: e.message }; }
  });

  ipcMain.handle('openshenzhou-import-voice', async (event, appxPath) => {
    let target = typeof appxPath === 'string' ? appxPath : '';
    if (!target) {
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      const result = await dialog.showOpenDialog(win, {
        title: '选择语音模型包（.zip / .appx / .msix）',
        filters: [
          { name: '语音模型包', extensions: ['zip', 'appx', 'msix', 'appxbundle'] },
          { name: '所有文件', extensions: ['*'] }
        ],
        properties: ['openFile']
      });
      if (result.canceled || !result.filePaths?.length) return { success: false, canceled: true };
      target = result.filePaths[0];
    }
    return importVoice(target);
  });

  ipcMain.handle('openshenzhou-delete-voice', (event, id) => deleteVoice(id));

  ipcMain.handle('openshenzhou-open-voices-dir', async () => {
    try {
      const dir = ensureVoicesDir();
      const err = await shell.openPath(dir);
      if (err) return { success: false, error: err };
      return { success: true, dir };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = { registerOpenShenzhouHandlers, listVoices, importVoice, deleteVoice, synthesizeVoice, getVoicesDir };
