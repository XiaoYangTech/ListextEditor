(function() {
  var constants = {
    // 默认 Edge TTS 发音人
    DEFAULT_EDGE_VOICE: 'zh-CN-XiaoxiaoNeural',
    // 服务端 API 地址
    API_BASE_URL: 'https://api.yfyw.top',
    // 免费版角色数量上限
    MAX_FREE_ROLES: 3,
    // 停顿积木默认时长（秒）
    DEFAULT_PAUSE_DURATION: 10,
    // 重复积木默认次数
    DEFAULT_REPEAT_COUNT: 2,
    // 分节默认标题
    DEFAULT_SECTION_TITLE: '未命名分节'
  };

  // 统一的 HTML 转义（各模块的 escapeHtml 方法均委托到这里）
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = constants;
    module.exports.escapeHtml = escapeHtml;
  }
  if (typeof window !== 'undefined') {
    window.LISTEXT_CONSTANTS = constants;
    window.escapeHtml = escapeHtml;
  }
})();
