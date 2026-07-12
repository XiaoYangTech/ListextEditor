class CodeEditor {
  constructor(elements, parser, callbacks) {
    this.editor = elements.codeEditor;
    this.lineNumbers = elements.lineNumbers;
    this.highlight = elements.codeHighlight;
    this.suggestions = elements.codeSuggestions;
    this.errorContainer = elements.errorContainer;
    this.parser = parser;
    this.callbacks = callbacks || {};
    this.updateScheduled = false;
    this.projectRoles = [];
    this.projectEffects = [];
    this.edgeVoices = [];
    this.localVoices = [];
    this._lastKeyDown = null;
    this.init();
  }

  setProjectContext(roles, effects) {
    this.projectRoles = roles || [];
    this.projectEffects = effects || [];
  }

  async loadEdgeVoices() {
    if (this.edgeVoices.length) return;
    if (window.electronAPI?.listEdgeVoices) {
      try { const r = await window.electronAPI.listEdgeVoices(); this.edgeVoices = r?.voices || []; } catch { this.edgeVoices = []; }
    }
  }

  async loadLocalVoices() {
    if (this.localVoices.length) return;
    if (window.electronAPI?.platform !== 'win32') return;
    if (!('speechSynthesis' in window)) return;
    try { speechSynthesis.getVoices(); } catch {}
    const finish = (voices) => {
      this.localVoices = Array.from(voices || []).filter(v => v.localService).map(v => v.name);
    };
    const immediate = speechSynthesis.getVoices();
    if (immediate.length) { finish(immediate); return; }
    speechSynthesis.onvoiceschanged = () => finish(speechSynthesis.getVoices());
    setTimeout(() => finish(speechSynthesis.getVoices()), 3000);
  }

  async syncFromIPC() {
    if (!window.electronAPI) return;
    try {
      const data = await window.electronAPI.getProjectData();
      if (data?.effects) this.projectEffects = data.effects;
      if (data?.roles) this.projectRoles = data.roles;
    } catch {}
  }

  init() {
    this.refreshView();
    this.loadEdgeVoices();
    this.loadLocalVoices();
    this.syncFromIPC();
    this.editor.addEventListener('input', () => {
      this.refreshView();
      if (this.callbacks.onInput) this.callbacks.onInput();
      this.updateSuggestions();
    });
    this.editor.addEventListener('paste', e => e.stopPropagation());
    this.editor.addEventListener('click', () => this.updateSuggestions());
    this.editor.addEventListener('keyup', () => {
      if (['ArrowDown','ArrowUp','Enter','Tab','Escape'].includes(this._lastKeyDown)) { this._lastKeyDown = null; return; }
      this._lastKeyDown = null;
      this.updateSuggestions();
    });
    this.editor.addEventListener('blur', () => setTimeout(() => this.hideSuggestions(), 200));
    this.editor.addEventListener('scroll', () => this.syncScroll());
    this.editor.addEventListener('keydown', e => { if (this.handleKeydown(e)) return; });
  }

  insertTagTemplate(tag) {
    const t = {
      say: '<say role="">|</say>', pause: '<pause dur="1">',
      repeat: '<repeat count="2">\n  |\n</repeat>', section: '<section title="分节标题">\n  |\n</section>',
      fx: '<fx id="">', divider: '<divider>', role: '<role id="" name="" type="edge" voice=""/>'
    }[tag] || '';
    const p = t.indexOf('|');
    const ins = t.replace('|', '');
    const s = this.editor.selectionStart, e = this.editor.selectionEnd;
    const b = this.editor.value.substring(0, s), a = this.editor.value.substring(e);
    this.editor.value = b + ins + a;
    const np = s + (p >= 0 ? p : ins.length);
    this.editor.setSelectionRange(np, np);
    this.updateScheduled = false;
    this.updateLineNumbers(); this.updateCodeHighlight(); this.validateCode(); this.syncScroll();
    if (this.callbacks.onInput) this.callbacks.onInput();
    this.editor.focus();
  }

  getValue() { return this.editor.value; }
  setValue(v) { this.editor.value = v; this.updateScheduled = false; this.updateLineNumbers(); this.updateCodeHighlight(); this.validateCode(); this.syncScroll(); }
  focus() { this.editor.focus(); }

  insertCodeAtCursor(code, cursorOffset) {
    const s = this.editor.selectionStart;
    const e = this.editor.selectionEnd;
    const before = this.editor.value.substring(0, s);
    const after = this.editor.value.substring(e);
    const needNewline = before.length > 0 && !before.endsWith('\n');
    const insert = (needNewline ? '\n' : '') + code;
    this.editor.value = before + insert + after;
    const pos = s + insert.length + (cursorOffset || 0);
    this.editor.setSelectionRange(pos, pos);
    this.editor.focus();
    this.updateScheduled = false;
    this.updateLineNumbers();
    this.updateCodeHighlight();
    this.validateCode();
    this.syncScroll();
    if (this.callbacks.onInput) this.callbacks.onInput();
  }

  refreshView() {
    if (this.updateScheduled) return;
    this.updateScheduled = true;
    requestAnimationFrame(() => { this.updateLineNumbers(); this.updateCodeHighlight(); this.validateCode(); this.syncScroll(); this.updateScheduled = false; });
  }

  syncScroll() {
    if (this.lineNumbers) this.lineNumbers.scrollTop = this.editor.scrollTop;
    if (this.highlight) { this.highlight.scrollTop = this.editor.scrollTop; this.highlight.scrollLeft = this.editor.scrollLeft; }
  }

  updateLineNumbers() {
    const h = this.editor.value.split('\n').map((_, i) => `<div class="line-number">${i + 1}</div>`).join('');
    if (this.lineNumbers.innerHTML !== h) this.lineNumbers.innerHTML = h;
  }

  updateCodeHighlight() {
    if (!this.highlight) return;
    const h = this.highlightListext(this.editor.value);
    if (this.highlight.innerHTML !== h) this.highlight.innerHTML = h;
  }

  highlightListext(text) {
    const e = this.escapeHtml(text);
    return e.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="token-comment">$1</span>')
      .replace(/(&lt;\/?)([a-zA-Z]+)((?:[^&]|&(?!gt;))*)(\/?&gt;)/g, (m, o, t, a, c) => {
        const at = a.replace(/([a-zA-Z-:]+)(=)(&quot;[^&]*?&quot;|&apos;[^&]*?&apos;|[^\s&]+)/g,
          '<span class="token-attr">$1</span><span class="token-punct">$2</span><span class="token-value">$3</span>');
        return `<span class="token-punct">${o}</span><span class="token-tag">${t}</span>${at}<span class="token-punct">${c}</span>`;
      });
  }

  escapeHtml(t) { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }

  handleKeydown(e) {
    this._lastKeyDown = e.key;
    if (this.suggestions && this.suggestions.style.display !== 'none') {
      const items = Array.from(this.suggestions.querySelectorAll('.code-suggestion-item'));
      if (['ArrowDown','ArrowUp','Enter','Tab','Escape'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') { this.hideSuggestions(); return true; }
        let idx = items.findIndex(i => i.classList.contains('active'));
        if (e.key === 'ArrowDown') idx = (idx + 1) % items.length;
        else if (e.key === 'ArrowUp') idx = (idx - 1 + items.length) % items.length;
        else { if (idx < 0) idx = 0; const v = items[idx]?.dataset?.value; if (v) this.applySuggestion(v); return true; }
        items.forEach((it, i) => it.classList.toggle('active', i === idx));
        return true;
      }
    }
    if (e.key === 'Tab') {
      const hasSelection = this.editor.selectionStart !== this.editor.selectionEnd;
      if (hasSelection || e.shiftKey) {
        e.preventDefault();
        e.shiftKey ? this.outdentSelection() : this.indentSelection();
        return true;
      }
      return false;
    }
    return false;
  }

  updateSuggestions() {
    if (!this.suggestions || !this.editor || document.activeElement !== this.editor) return;
    const caret = this.editor.selectionStart;
    const before = this.editor.value.slice(0, caret);
    const inDQ = (before.match(/"/g)||[]).length % 2 === 1;
    const inSQ = (before.match(/'/g)||[]).length % 2 === 1;

    if (inDQ || inSQ) {
      const qc = inDQ ? '"' : "'";
      const lq = before.lastIndexOf(qc);
      const ctx = before.slice(0, lq);
      const ls = ctx.lastIndexOf(' ');
      const attr = (ls === -1 ? ctx : ctx.slice(ls + 1)).replace(/=$/, '');
      const input = before.slice(lq + 1);

      if (attr === 'role') {
        const items = this.projectRoles.map(r=>r.id).filter(Boolean).filter(r=>r.toLowerCase().includes(input.toLowerCase()));
        if (items.length) { this.suggestions.dataset.mode='value'; this.showSuggestionsAtCursor(items,input,caret-input.length,'角色'); return; }
      }
      if (attr === 'id' && this.isInsideTag(before,'fx')) {
        const items = this.projectEffects.map(e=>e.id).filter(Boolean).filter(e=>e.toLowerCase().includes(input.toLowerCase()));
        if (items.length) { this.suggestions.dataset.mode='value'; this.showSuggestionsAtCursor(items,input,caret-input.length,'音效'); return; }
      }
      if (attr === 'voice' && this.isInsideTag(before,'role')) {
        const tagStart = before.lastIndexOf('<role');
        const tagContent = before.slice(tagStart);
        const typeMatch = tagContent.match(/\btype\s*=\s*"([^"]*)"/);
        const roleType = typeMatch ? typeMatch[1] : 'edge';
        if (roleType === 'local') {
          const localItems = this.localVoices.filter(v=>v.toLowerCase().includes(input.toLowerCase()));
          if (localItems.length) { this.suggestions.dataset.mode='value'; this.showSuggestionsAtCursor(localItems.slice(0,30),input,caret-input.length,'本地发音人'); return; }
        } else {
          const items = this.edgeVoices.filter(v=>v.toLowerCase().includes(input.toLowerCase()));
          if (items.length) { this.suggestions.dataset.mode='value'; this.showSuggestionsAtCursor(items.slice(0,30),input,caret-input.length,'发音人'); return; }
        }
      }
      this.hideSuggestions();
      return;
    }

    const tm = before.match(/<([a-zA-Z]+)([^<>]*)$/);
    if (!tm) {
      const om = before.match(/<([a-zA-Z]*)$/);
      if (!om) { this.hideSuggestions(); return; }
      const p = om[1]||'';
      const items = Object.keys(this.parser.tagDefinitions||{}).filter(t=>t.startsWith(p));
      if (!items.length) { this.hideSuggestions(); return; }
      this.suggestions.dataset.mode='tag'; this.showSuggestionsAtCursor(items,p,caret-p.length,'标签');
      return;
    }

    const tn = tm[1].toLowerCase(), ap = tm[2]||'';
    if (/\s/.test(ap)) {
      const am = ap.match(/(?:^|\s)([a-zA-Z-]*)$/);
      const p = am?am[1]:'';
      const items = this.getAttributeSuggestions(tn).filter(a=>a.startsWith(p));
      if (!items.length) { this.hideSuggestions(); return; }
      this.suggestions.dataset.mode='attribute'; this.showSuggestionsAtCursor(items,p,caret-p.length,'属性');
      return;
    }

    const tpm = before.match(/<([a-zA-Z]*)$/);
    if (!tpm) { this.hideSuggestions(); return; }
    const p = tpm[1]||'';
    const items = Object.keys(this.parser.tagDefinitions||{}).filter(t=>t.startsWith(p));
    if (!items.length) { this.hideSuggestions(); return; }
    this.suggestions.dataset.mode='tag'; this.showSuggestionsAtCursor(items,p,caret-p.length,'标签');
  }

  isInsideTag(text, tag) {
    const lo = text.lastIndexOf(`<${tag}`);
    if (lo === -1) return false;
    return text.slice(lo).indexOf('>') === -1;
  }

  showSuggestionsAtCursor(items, prefix, replaceStart, hint) {
    const rect = this.editor.getBoundingClientRect();
    const b = this.editor.value.slice(0, this.editor.selectionStart);
    const lh = 22.4, ln = b.lastIndexOf('\n');
    const line = b.slice(0, this.editor.selectionStart).split('\n').length - 1;
    const col = ln === -1 ? b.length : b.length - ln - 1;
    const left = rect.left + 50 + 16 + col * 8 - this.editor.scrollLeft;
    const top = rect.top + 16 + line * lh - this.editor.scrollTop + lh;
    this.renderSuggestions(items, { left: Math.min(left, window.innerWidth - 340), top: Math.min(top, window.innerHeight - 260) }, prefix, replaceStart, hint);
  }

  renderSuggestions(items, pos, prefix, replaceStart, hint) {
    this.suggestions.innerHTML = items.map((t,i) => `<div class="code-suggestion-item ${i===0?'active':''}" data-value="${t}"><span>${t}</span><span class="hint">${hint}</span></div>`).join('');
    this.suggestions.style.display = 'block';
    this.suggestions.style.left = `${pos.left}px`;
    this.suggestions.style.top = `${Math.max(0, pos.top)}px`;
    this.suggestions.dataset.replaceStart = replaceStart;
    this.suggestions.dataset.prefix = prefix;
    this.suggestions.querySelectorAll('.code-suggestion-item').forEach(it => {
      it.addEventListener('mousedown', e => { e.preventDefault(); this.applySuggestion(it.dataset.value); });
    });
  }

  applySuggestion(value) {
    const mode = this.suggestions.dataset.mode;
    const rs = parseInt(this.suggestions.dataset.replaceStart||'0',10);
    const c = this.editor.selectionStart;
    const b = this.editor.value.substring(0, rs);
    const a = this.editor.value.substring(c);
    if (mode === 'value') {
      this.editor.value = `${b}${value}${a}`; this.editor.selectionStart = this.editor.selectionEnd = b.length + value.length;
    } else if (mode === 'attribute') {
      this.editor.value = `${b}${value}=""${a}`; this.editor.selectionStart = this.editor.selectionEnd = b.length + value.length + 2;
    } else {
      let ins = value, co = value.length;
      if (mode === 'tag' && b.endsWith('<')) {
        const sc = ['pause','fx','divider','section','role'].includes(value);
        ins = sc ? `${value}>` : `${value}></${value}>`; co = value.length + 1;
      }
      this.editor.value = `${b}${ins}${a}`; this.editor.selectionStart = this.editor.selectionEnd = b.length + co;
    }
    this.hideSuggestions(); this.updateScheduled = false;
    this.updateLineNumbers(); this.updateCodeHighlight(); this.validateCode(); this.syncScroll();
    if (this.callbacks.onInput) this.callbacks.onInput();
  }

  getAttributeSuggestions(tag) {
    return { say:['role','rate'], pause:['dur'], fx:['id','dur','fade'], repeat:['count'], section:['title'], role:['id','name','type','voice'] }[tag] || [];
  }

  indentSelection() {
    const v=this.editor.value, s=this.editor.selectionStart, e=this.editor.selectionEnd;
    if (s===e) { this.editor.value=v.substring(0,s)+'  '+v.substring(e); this.editor.selectionStart=this.editor.selectionEnd=s+2; this.refreshView(); if(this.callbacks.onInput)this.callbacks.onInput(); return; }
    const ls=v.lastIndexOf('\n',s-1)+1, le=v.indexOf('\n',e), ep=le===-1?v.length:le;
    const lines=v.slice(ls,ep).split('\n'); const ind=lines.map(l=>'  '+l).join('\n');
    this.editor.value=v.slice(0,ls)+ind+v.slice(ep); this.editor.selectionStart=s+2; this.editor.selectionEnd=e+lines.length*2;
    this.refreshView(); if(this.callbacks.onInput)this.callbacks.onInput();
  }

  outdentSelection() {
    const v=this.editor.value, s=this.editor.selectionStart, e=this.editor.selectionEnd;
    const ls=v.lastIndexOf('\n',s-1)+1, le=v.indexOf('\n',e), ep=le===-1?v.length:le;
    const lines=v.slice(ls,ep).split('\n'); let rm=0;
    const out=lines.map(l=>{if(l.startsWith('  ')){rm+=2;return l.slice(2);}if(l.startsWith('\t')){rm+=1;return l.slice(1);}return l;}).join('\n');
    this.editor.value=v.slice(0,ls)+out+v.slice(ep); this.editor.selectionStart=Math.max(ls,s-2); this.editor.selectionEnd=Math.max(ls,e-rm);
    this.refreshView(); if(this.callbacks.onInput)this.callbacks.onInput();
  }

  hideSuggestions() { if(this.suggestions){this.suggestions.style.display='none';this.suggestions.innerHTML='';} }

  validateCode() {
    if (!this.errorContainer) return;
    let errors = [];
    try {
      errors = this.parser.validate(this.editor.value);
      errors = errors.concat(this.validateSemantics(this.editor.value));
      if (this.callbacks.validateExtra) { const ex = this.callbacks.validateExtra(this.editor.value); if(ex?.length) errors=errors.concat(ex); }
    } catch { errors = [{line:1,message:'代码校验失败'}]; }
    if (errors.length) {
      this.errorContainer.style.display='block';
      this.errorContainer.innerHTML=errors.map(e=>`<div>第${e.line}行: ${e.message}</div>`).join('');
    } else { this.errorContainer.style.display='none'; this.errorContainer.innerHTML=''; }
  }

  validateSemantics(code) {
    const errors=[], lines=code.split('\n');
    const rids=new Set(this.projectRoles.map(r=>r.id));
    const eids=new Set(this.projectEffects.map(e=>e.id));
    for (let i=0;i<lines.length;i++) {
      const l=lines[i], n=i+1;
      const rm=l.match(/<say\s+[^>]*role\s*=\s*"([^"]+)"/);
      if(rm&&rm[1]&&!rids.has(rm[1])) errors.push({line:n,message:`角色 "${rm[1]}" 未定义`});
      const fm=l.match(/<fx\s+[^>]*id\s*=\s*"([^"]+)"/);
      if(fm&&fm[1]&&!eids.has(fm[1])) errors.push({line:n,message:`音效 "${fm[1]}" 不存在于项目中`});
      if(l.match(/<role\s+/)){const im=l.match(/\bid\s*=\s*"([^"]*)"/);if(im&&!im[1])errors.push({line:n,message:'角色定义缺少 id'});}
      const rtm=l.match(/<say\s+[^>]*rate\s*=\s*"([^"]+)"/);
      if(rtm&&rtm[1]){const r=parseFloat(rtm[1]);if(isNaN(r)||r<0.1||r>10)errors.push({line:n,message:`语速 ${rtm[1]} 不合理`});}
      const dm=l.match(/<pause\s+[^>]*dur\s*=\s*"([^"]+)"/);
      if(dm&&dm[1]){const d=parseInt(dm[1],10);if(isNaN(d)||d<1)errors.push({line:n,message:`停顿时长 ${dm[1]} 无效`});}
    }
    return errors;
  }
}
