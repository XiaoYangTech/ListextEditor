class ListextParser {
  constructor() {
    this.tagDefinitions = {
      say: { type: 'content', name: '朗读', description: '朗读文本，可设置角色与语速' },
      pause: { type: 'control', name: '停顿', description: '静音间隔（秒）' },
      repeat: { type: 'structure', name: '重复', description: '内部内容重复播放 count 次' },
      fx: { type: 'control', name: '音效', description: '播放音效' },
      divider: { type: 'control', name: '分割线', description: '可视化分割线，不影响播放' },
      section: { type: 'structure', name: '分节', description: '章节锚点，可快速跳转' },
      role: { type: 'definition', name: '角色', description: '定义角色（ID、名称、发音人）' }
    };
  }

  parse(text) {
    const ast = [];
    let pos = 0;
    while (pos < text.length) {
      const result = this.parseNode(text, pos);
      if (result) {
        ast.push(result.node);
        pos = result.pos;
      } else {
        pos++;
      }
    }
    return ast;
  }

  parseNode(text, pos) {
    while (pos < text.length && /\s/.test(text[pos])) pos++;
    if (pos >= text.length) return null;

    if (text.startsWith('<!--', pos)) {
      const commentEnd = text.indexOf('-->', pos);
      if (commentEnd !== -1) {
        const content = text.slice(pos + 4, commentEnd).trim();
        return { node: { type: 'comment', content }, pos: commentEnd + 3 };
      }
    }

    const tagMatch = text.slice(pos).match(/^<([a-zA-Z]+)([^>]*)>/);
    if (tagMatch) {
      const tagName = tagMatch[1].toLowerCase();
      const attrStr = tagMatch[2].trim();
      const tagStart = pos;
      pos += tagMatch[0].length;

      const attrs = this.parseAttributes(attrStr);
      const closeTag = `</${tagName}>`;
      const closePos = text.indexOf(closeTag, pos);

      let children = [];
      let content = '';

      if (closePos !== -1) {
        if (this.isSelfClosing(tagName)) {
          content = '';
          pos = tagStart + tagMatch[0].length;
        } else {
          const innerContent = text.slice(pos, closePos);
          if (this.hasChildren(tagName)) {
            children = this.parse(innerContent);
          } else {
            content = innerContent.trim();
          }
          pos = closePos + closeTag.length;
        }
      }

      return {
        node: {
          type: 'element',
          tagName,
          attrs,
          children,
          content,
          definition: this.tagDefinitions[tagName] || null
        },
        pos
      };
    }

    let textEnd = pos;
    while (textEnd < text.length) {
      const nextLt = text.indexOf('<', textEnd);
      if (nextLt === -1) {
        textEnd = text.length;
        break;
      }
      if (/^<\/?([a-zA-Z]+)/.test(text.slice(nextLt))) {
        textEnd = nextLt;
        break;
      }
      textEnd = nextLt + 1;
    }

    const content = text.slice(pos, textEnd).trim();
    if (!content) return null;
    return { node: { type: 'text', content }, pos: textEnd };
  }

  parseAttributes(attrStr) {
    const attrs = {};
    const attrRegex = /(\w+)(?:=(?:"([^"]*)"|(\S+)))?/g;
    let match;
    while ((match = attrRegex.exec(attrStr)) !== null) {
      const name = match[1];
      const value = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : true);
      attrs[name] = value;
    }
    return attrs;
  }

  isSelfClosing(tagName) {
    return ['pause', 'fx', 'divider', 'section', 'role'].includes(tagName);
  }

  hasChildren(tagName) {
    return ['repeat'].includes(tagName);
  }

  stringify(ast, indent = 0) {
    let result = '';
    const indentStr = '  '.repeat(indent);

    for (const node of ast) {
      if (node.type === 'comment') {
        result += `${indentStr}<!-- ${node.content} -->\n`;
      } else if (node.type === 'text') {
        if (node.content.trim()) result += `${indentStr}${node.content.trim()}\n`;
      } else if (node.type === 'element') {
        const attrs = this.stringifyAttrs(node.attrs || {});
        const attrStr = attrs ? ` ${attrs}` : '';

        if (this.isSelfClosing(node.tagName)) {
          result += `${indentStr}<${node.tagName}${attrStr}>\n`;
        } else if (node.children && node.children.length > 0) {
          result += `${indentStr}<${node.tagName}${attrStr}>\n`;
          result += this.stringify(node.children, indent + 1);
          result += `${indentStr}</${node.tagName}>\n`;
        } else {
          result += `${indentStr}<${node.tagName}${attrStr}>${node.content || ''}</${node.tagName}>\n`;
        }
      }
    }

    return result;
  }

  stringifyAttrs(attrs) {
    const parts = [];
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === true) parts.push(key);
      else parts.push(`${key}="${value}"`);
    }
    return parts.join(' ');
  }

  validate(text) {
    const errors = [];
    const stack = [];
    const tagRegex = /<\/?([a-zA-Z]+)([^>]*)>/g;
    let match;

    while ((match = tagRegex.exec(text)) !== null) {
      const fullTag = match[0];
      const tagName = match[1].toLowerCase();
      const isClosing = fullTag.startsWith('</');
      const line = text.slice(0, match.index).split('\n').length;

      if (!this.tagDefinitions[tagName]) {
        errors.push({ line, message: `未知标签: <${tagName}>` });
        continue;
      }

      if (isClosing) {
        if (this.isSelfClosing(tagName)) continue;
        if (stack.length === 0 || stack[stack.length - 1] !== tagName) {
          errors.push({ line, message: `不匹配的闭合标签: </${tagName}>` });
        } else {
          stack.pop();
        }
      } else if (!this.isSelfClosing(tagName)) {
        stack.push(tagName);
      }
    }

    if (stack.length > 0) {
      errors.push({ line: text.split('\n').length, message: `未闭合的标签: <${stack.join('>, <')}>` });
    }

    return errors;
  }
}
