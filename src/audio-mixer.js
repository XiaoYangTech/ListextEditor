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
 * 混音小工具：给任意音频文件加背景音乐
 * - 可选原声与 BGM 文件、分别调节音量
 * - BGM 可循环填充至原声长度，可设结尾淡出秒数
 * - 试听先混到临时文件播放，导出再写目标 MP3
 */
class AudioMixer {
  constructor() {
    this.voicePath = '';
    this.bgmPath = '';
    this._previewAudio = null;
    this._busy = false;
    this.bind();
  }

  _el(id) { return document.getElementById(id); }

  bind() {
    this._el('audioMixerCloseTop')?.addEventListener('click', () => this.close());
    this._el('mixCancel')?.addEventListener('click', () => this.close());
    this._el('mixPickVoice')?.addEventListener('click', () => this._pick('voice'));
    this._el('mixPickBgm')?.addEventListener('click', () => this._pick('bgm'));
    this._el('mixPreview')?.addEventListener('click', () => this._run(true));
    this._el('mixExport')?.addEventListener('click', () => this._run(false));

    const bindRange = (id, labelId, fallback) => {
      const input = this._el(id);
      const label = this._el(labelId);
      if (!input || !label) return;
      const sync = () => { label.textContent = `${input.value}%`; };
      input.value = String(fallback);
      input.addEventListener('input', sync);
      sync();
    };
    bindRange('mixVoiceVol', 'mixVoiceVolLabel', 100);
    bindRange('mixBgmVol', 'mixBgmVolLabel', 30);
  }

  open() {
    this.bind();
    this._setHint('成品时长与原声一致，输出为 MP3；「试听」会先生成临时混音，不写盘到目标文件。');
    this._el('audioMixerDialog')?.classList.add('active');
  }

  close() {
    this._stopPreview();
    this._el('audioMixerDialog')?.classList.remove('active');
  }

  _setHint(text) {
    const el = this._el('mixHint');
    if (el) el.textContent = text;
  }

  async _pick(kind) {
    const api = window.electronAPI;
    if (!api?.selectAudioFile) { this._setHint('当前环境不支持选择文件'); return; }
    const filePath = await api.selectAudioFile();
    if (!filePath) return;
    if (kind === 'voice') {
      this.voicePath = filePath;
      const input = this._el('mixVoicePath');
      if (input) input.value = filePath;
    } else {
      this.bgmPath = filePath;
      const input = this._el('mixBgmPath');
      if (input) input.value = filePath;
    }
    this._stopPreview();
    this._setHint('已选择文件，可调节音量后「试听」或直接「导出」。');
  }

  _collectOpts(targetPath) {
    const pct = (id, fallback) => {
      const v = Number(this._el(id)?.value);
      return Number.isFinite(v) ? v / 100 : fallback;
    };
    return {
      voicePath: this.voicePath,
      bgmPath: this.bgmPath,
      voiceVolume: pct('mixVoiceVol', 1),
      bgmVolume: pct('mixBgmVol', 0.3),
      loopBgm: this._el('mixLoopBgm')?.checked !== false,
      fadeOut: Number(this._el('mixFadeOut')?.value) || 0,
      targetPath: targetPath || null
    };
  }

  async _run(isPreview) {
    const api = window.electronAPI;
    if (!api?.mixAudio) { this._setHint('当前环境不支持混音'); return; }
    if (this._busy) return;
    if (!this.voicePath || !this.bgmPath) { this._setHint('请先选择原声文件与背景音乐'); return; }

    let targetPath = null;
    if (!isPreview) {
      const base = (this.voicePath.split(/[\\/]/).pop() || '音频').replace(/\.[^.]+$/, '');
      targetPath = await api.selectAudioSavePath?.(`${base}-含背景音乐.mp3`);
      if (!targetPath) return;
    }

    this._busy = true;
    this._stopPreview();
    this._setHint(isPreview ? '正在生成试听混音…' : '正在导出混音…');
    window.app?.updateStatus?.(isPreview ? '正在生成试听混音…' : '正在导出混音…');
    try {
      const res = await api.mixAudio(this._collectOpts(targetPath));
      if (!res?.success) {
        this._setHint('失败：' + (res?.error || '未知错误'));
        window.app?.uiManager?.showInfoDialog?.('混音失败', res?.error || '未知错误');
        return;
      }
      if (isPreview) {
        this._setHint(`试听中（原声 ${this._el('mixVoiceVol').value}% / BGM ${this._el('mixBgmVol').value}%），调节音量后可再次试听。`);
        this._playPreview(res.filePath);
      } else {
        this._setHint('导出完成：' + res.filePath);
        window.app?.uiManager?.showInfoDialog?.('导出完成', `混音文件已保存：\n${res.filePath}`);
      }
    } catch (e) {
      this._setHint('失败：' + (e?.message || e));
    } finally {
      this._busy = false;
      window.app?.updateStatus?.('就绪');
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
