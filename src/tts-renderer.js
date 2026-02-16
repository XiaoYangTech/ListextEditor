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
    if (btnExport) btnExport.addEventListener('click', () => this.app.exportHandler.exportAudio());
    
    // 播放队列回调
    this.playQueue.onProgress = (info) => {
      this.app.updateStatus(`播放中 ${info.current + 1}/${info.total}`);
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
      // 可视化高亮当前播放块
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
    this.app.updateStatus('开始播放...');
  }

  stopPlay() {
    this.playQueue.stop();
    this.app.updateStatus('播放停止');
    
    // 清除高亮
    document.querySelectorAll('.block.playing').forEach(el => {
      el.classList.remove('playing');
    });
  }
  
  highlightCurrentBlock(node, highlight) {
    if (this.app.currentMode !== 'block') return;
    
    // 尝试找到对应的块
    if (node.uiId) {
      const block = document.getElementById('blockContainer').querySelector(`.block[data-id="${node.uiId}"]`);
      if (block) {
        if (highlight) {
          block.classList.add('playing');
          block.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          block.classList.remove('playing');
        }
      }
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TTSRenderer;
}
