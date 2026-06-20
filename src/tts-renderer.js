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
      const est = this.playQueue.formatDuration(this.playQueue.getTotalEstimatedDuration());
      this.app.updateStatus(`播放中 ${info.current + 1}/${info.total}  预估剩余 ${est}`);
    };

    this.playQueue.onComplete = () => {
      this.app.updateStatus('播放完成');
    };

    this.playQueue.onTtsFallback = () => {
      this.app.updateStatus('EdgeTTS 失败，已尝试系统TTS');
    };

    this.playQueue.onTtsError = (message) => {
      this.app.updateStatus(message || 'TTS 调用失败');
    };

    this.playQueue.onBlockHighlight = (node, highlight) => {
      this.highlightCurrentBlock(node, highlight);
    };
  }

  previewPlay() {
    const content = this.app.getContent();
    const ast = this.parser.parse(content);

    if (ast.length === 0) {
      this.app.updateStatus('没有可播放的内容');
      return;
    }

    this.playQueue.play(ast);
    const est = this.playQueue.formatDuration(this.playQueue.getTotalEstimatedDuration());
    this.app.updateStatus(`开始播放...  预估时长 ${est}`);
  }

  stopPlay() {
    this.playQueue.stop();
    this.app.updateStatus('播放停止');

    document.querySelectorAll('.block.playing').forEach(el => el.classList.remove('playing'));
  }

  updateEstimatedDuration() {
    const el = document.getElementById('estimatedDuration');
    if (!el) return;
    try {
      const content = this.app.getContent();
      const ast = this.parser.parse(content);
      if (!ast.length) { el.textContent = ''; return; }
      const queue = this.playQueue.buildQueue(ast);
      const total = queue.reduce((sum, t) => sum + (t.estimatedDuration || 0), 0);
      if (total <= 0) { el.textContent = ''; return; }
      const mins = Math.floor(total / 60);
      const secs = Math.floor(total % 60);
      el.textContent = `预估时长 ${mins}:${secs.toString().padStart(2, '0')}`;
    } catch {
      el.textContent = '';
    }
  }

  highlightCurrentBlock(node, highlight) {
    if (this.app.currentMode !== 'block') return;
    if (!node.uiId) return;

    const block = document.getElementById('blockContainer').querySelector(`.block[data-id="${node.uiId}"]`);
    if (!block) return;

    if (highlight) {
      block.classList.add('playing');
      block.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      block.classList.remove('playing');
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TTSRenderer;
}
