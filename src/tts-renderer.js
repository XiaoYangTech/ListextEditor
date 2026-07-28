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

class TTSRenderer {
  constructor(app, playQueue, parser) {
    this.app = app;
    this.playQueue = playQueue;
    this.parser = parser;
    this.initPlayback();
  }

  initPlayback() {
    const btnPreview = document.getElementById('btnPreview');
    const btnStop = document.getElementById('btnStop');
    const btnExport = document.getElementById('btnExport');

    if (btnPreview) btnPreview.addEventListener('click', () => this.previewPlay());
    if (btnStop) btnStop.addEventListener('click', () => this.stopPlay());
    if (btnExport) {
      btnExport.addEventListener('click', () => {
        this.app.exportHandler.showExportDialog();
      });
    }

    this.playQueue.onProgress = (info) => {
      this.app.updateStatus(`播放中 ${info.current + 1}/${info.total}`);
    };

    this.playQueue.onComplete = () => {
      this.app.updateStatus('播放完成');
    };

    this.playQueue.onTtsFallback = () => {
      this.app.uiManager?.showInfoDialog?.('提示', 'EdgeTTS 失败，已尝试系统TTS');
    };

    this.playQueue.onTtsError = (message) => {
      this.app.uiManager?.showInfoDialog?.('错误', message || 'TTS 调用失败');
    };

    this.playQueue.onBlockHighlight = (node, highlight, task) => {
      this.highlightCurrentBlock(node, highlight, task);
    };
  }

  previewPlay() {
    // 全文播放前全量体检：语法/语义/角色问题，弹窗列出并中止
    if (this.app.preflightCheck && !this.app.preflightCheck()) return;
    // 积木模式直接使用带有 uiId 的 AST，避免重新解析代码后丢失块映射。
    const ast = this.app.currentMode === 'block'
      ? this.app.renderer.collectAST()
      : this.parser.parse(this.app.getContent());

    if (ast.length === 0) {
      this.app.updateStatus('没有可播放的内容');
      return;
    }

    this.playQueue.play(ast);
    this.app.updateStatus('开始播放...');
  }

  stopPlay() {
    this.playQueue.stop();
    this.app.updateStatus('播放停止');

    document.querySelectorAll('.block.playing').forEach(el => el.classList.remove('playing'));
  }

  highlightCurrentBlock(node, highlight, task) {
    if (this.app.currentMode !== 'block') return;

    const container = this.app.renderer?.container || document.getElementById('blockContainer');
    if (!container) return;

    // 优先按结构路径定位（跨重渲染稳定），失败回退易失的 data-id
    let block = null;
    const path = task?.path || node?.path;
    if (path && typeof this.app.renderer?.getBlockByPath === 'function') {
      block = this.app.renderer.getBlockByPath(path);
    }
    if (!block && node?.uiId) {
      block = container.querySelector(`.block[data-id="${node.uiId}"]`);
    }
    if (!block) return;

    if (highlight) {
      container.querySelectorAll('.block.playing').forEach(el => el.classList.remove('playing'));
      block.classList.add('playing');
      const containerRect = container.getBoundingClientRect();
      const blockRect = block.getBoundingClientRect();
      const top = container.scrollTop + blockRect.top - containerRect.top
        - (container.clientHeight - blockRect.height) / 2;
      container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    } else {
      block.classList.remove('playing');
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TTSRenderer;
}
