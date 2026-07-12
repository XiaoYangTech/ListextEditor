(function() {
  var defaults = {
    save: 'Ctrl+S',
    toggleMode: 'Ctrl+M',
    addBlock: 'Ctrl+N',
    deleteBlock: 'Delete',
    openEffects: 'Ctrl+Shift+E',
    previewPlay: 'F5',
    undo: 'Ctrl+Z',
    redo: 'Ctrl+Shift+Z',
    cut: 'Ctrl+X',
    copy: 'Ctrl+C',
    paste: 'Ctrl+V',
    selectAll: 'Ctrl+A',
    insertSay: 'Ctrl+1',
    insertPause: 'Ctrl+2',
    insertRepeat: 'Ctrl+3',
    insertSection: 'Ctrl+4',
    insertFx: 'Ctrl+5',
    insertDivider: 'Ctrl+6'
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = defaults;
  }
  if (typeof window !== 'undefined') {
    window.SHORTCUT_DEFAULTS = defaults;
  }
})();
