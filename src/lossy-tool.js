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
 * 一键全损音质工具：把任意已有音频过一遍「炸麦」劣化滤镜。
 * 与导出对话框里的「音质损伤」共用主进程同一套处理链（buildDegradeFilter / degradeAudio）。
 * - 支持常见音频格式，原文件不会被修改
 * - 「试听」生成临时文件播放，满意再导出 MP3
 * - 损坏程度 10-100，另有 轻微破音 / 明显炸麦 / 全损 三个快捷档
 */
class LossyAudioTool {
  constructor() {
    this.inputPath = '';
    // 损坏程度的唯一权威值：滑块位置与文字都从它派生，避免两者不同步
    this.level = 80;
    this._previewAudio = null;
    this._busy = false;
    this.bind();
  }

  _el(id) { return document.getElementById(id); }

  bind() {
    if (this._bound) return; // 只绑定一次：每次打开重复挂监听会造成叠加
    this._bound = true;

    this._el('lossyToolCloseTop')?.addEventListener('click', () => this.close());
    this._el('lossyCancel')?.addEventListener('click', () => this.close());
    this._el('lossyPickInput')?.addEventListener('click', () => this._pick());
    this._el('lossyPreview')?.addEventListener('click', () => this._run(true));
    this._el('lossyExport')?.addEventListener('click', () => this._run(false));

    const range = this._el('lossyLevel');
    const syncFromRange = () => {
      const v = Number(range?.value);
      if (Number.isFinite(v)) this.level = Math.max(10, Math.min(100, Math.round(v)));
      this._syncLevelLabel();
    };
    // input 覆盖拖动/键盘，change 兜住个别只触发 change 的情况
    range?.addEventListener('input', syncFromRange);
    range?.addEventListener('change', syncFromRange);
    document.querySelectorAll('.lossy-quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const lvl = Number(btn.dataset.level);
        if (Number.isFinite(lvl)) this.level = Math.max(10, Math.min(100, Math.round(lvl)));
        this._applyLevelToRange();
      });
    });
    this._applyLevelToRange();
  }

  // 把 this.level 同时写回滑块与文字（滑块重写值会强制重绘滑块本身）
  _applyLevelToRange() {
    const range = this._el('lossyLevel');
    if (range) range.value = String(this.level);
    this._syncLevelLabel();
  }

  _level() {
    return this.level;
  }

  _syncLevelLabel() {
    const lvl = this.level;
    const label = this._el('lossyLevelLabel');
    if (label) {
      // 与导出对话框的「音质损伤」用同一套档位阈值，避免同一数值两处叫法不同
      const hint = lvl < 30 ? '轻微破音' : lvl < 60 ? '明显炸麦' : lvl < 90 ? '严重炸麦' : '全损炸麦';
      label.textContent = `${lvl}% · ${hint}`;
    }
  }

  open() {
    this.bind();
    this._setHint('选一段音频、调损坏程度，先「试听」听听效果，满意再「一键全损并导出」。输出为 MP3，原文件不会被修改。');
    this._el('lossyToolDialog')?.classList.add('active');
    // 对话框刚从 display:none 变为可见时，range 的滑块偶尔会停在旧位置（轨道已按新值着色）；
    // 下一帧重新写入一次值，强制重绘滑块并同步文字，保证「看到的位置 = 显示的数字」。
    const range = this._el('lossyLevel');
    requestAnimationFrame(() => {
      if (!range) return;
      range.value = String(this.level);
      this._syncLevelLabel();
      requestAnimationFrame(() => {
        if (Number(range.value) !== this.level) range.value = String(this.level);
        this._syncLevelLabel();
      });
    });
  }

  close() {
    this._stopPreview();
    this._el('lossyToolDialog')?.classList.remove('active');
  }

  _setHint(text) {
    const el = this._el('lossyHint');
    if (el) el.textContent = text;
  }

  async _pick() {
    const api = window.electronAPI;
    if (!api?.selectAudioFile) { this._setHint('当前环境不支持选择文件'); return; }
    const filePath = await api.selectAudioFile();
    if (!filePath) return;
    this.inputPath = filePath;
    const input = this._el('lossyInputPath');
    if (input) input.value = filePath;
    this._stopPreview();
    this._setHint('已选择文件，选好损坏程度后点「试听」或「一键全损并导出」。');
  }

  _baseName() {
    const name = (this.inputPath.split(/[\\/]/).pop() || '音频').replace(/\.[^.]+$/, '');
    return name || '音频';
  }

  async _run(isPreview) {
    const api = window.electronAPI;
    if (!api?.degradeAudio) { this._setHint('当前环境不支持音质处理'); return; }
    if (this._busy) return;
    if (!this.inputPath) { this._setHint('请先选择一个音频文件'); return; }
    const level = this._level();

    let targetPath = null;
    if (!isPreview) {
      targetPath = await api.selectAudioSavePath?.(`${this._baseName()}-全损.mp3`);
      if (!targetPath) return;
    }

    this._busy = true;
    this._stopPreview();
    this._setHint(isPreview ? `正在生成 ${level}% 试听…` : `正在全损处理（${level}%）…`);
    try {
      const res = await api.degradeAudio({ inputPath: this.inputPath, level, targetPath, preview: isPreview });
      if (!res?.success) {
        this._setHint('失败：' + (res?.error || '未知错误'));
        return;
      }
      if (isPreview) {
        this._setHint(`试听中（损坏程度 ${level}%），可换档位再次试听。`);
        this._playPreview(res.filePath);
      } else {
        this._setHint('导出完成：' + res.filePath);
        window.app?.uiManager?.showInfoDialog?.('导出完成', `全损音质文件已保存：\n${res.filePath}`);
      }
    } catch (e) {
      this._setHint('失败：' + (e?.message || e));
    } finally {
      this._busy = false;
    }
  }

  _playPreview(filePath) {
    try {
      const url = String(filePath).replace(/\\/g, '/');
      const proto = url.startsWith('/') ? 'file://' + encodeURI(url) : 'file:///' + encodeURI(url);
      this._previewAudio = new Audio(proto);
      this._previewAudio.addEventListener('ended', () => { this._previewAudio = null; });
      this._previewAudio.play();
    } catch (e) {
      console.error('试听失败:', e);
    }
  }

  _stopPreview() {
    if (this._previewAudio) {
      try { this._previewAudio.pause(); } catch { /* 忽略 */ }
      this._previewAudio = null;
    }
  }
}
