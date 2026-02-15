/**
 * Listext 语法解析器
 * 将 Listext 文本解析为可操作的 DOM 树结构
 */

class ListextParser {
  constructor() {
    // 标签定义：名称、类型、属性
    this.tagDefinitions = {
      'say': { type: 'content', name: '朗读', description: '朗读文本，可设置角色与语速' },
      'pause': { type: 'control', name: '停顿', description: '静音间隔（秒）' },
      'repeat': { type: 'structure', name: '重复', description: '内部内容重复播放 count 次' },
      'fx': { type: 'control', name: '音效', description: '播放音效' },
      'divider': { type: 'control', name: '分割线', description: '可视化分割线，不影响播放' },
      'v': { type: 'content', name: '角色', description: '自定义角色，使用 id 指定' }
    };

    // EdgeTTS 语音配置
    this.voiceConfig = {
      male: 'zh-CN-YunxiNeural',      // 男声：云希
      female: 'zh-CN-XiaoxiaoNeural',  // 女声：晓晓
      male_announcer: 'zh-CN-YunjianNeural', // 男声播音员：云健
      female_announcer: 'zh-CN-XiaoyiNeural' // 女声播音员：晓伊
    };
  }

  /**
   * 验证 Listext 文本格式
   * @param {string} text Listext 文本
   * @returns {Array} 错误信息数组 {line, message}
   */
  validate(text) {
    const errors = [];
    const lines = text.split('\n');
    const stack = [];
    
    // 简单的正则匹配标签
    const tagRegex = /<\/?([a-zA-Z]+)([^>]*)>/g;
    
    let match;
    while ((match = tagRegex.exec(text)) !== null) {
      const isClosing = match[0].startsWith('</');
      const tagName = match[1].toLowerCase();
      const fullTag = match[0];
      const index = match.index;
      
      // 计算行号
      const lineNum = text.slice(0, index).split('\n').length;
      
      if (!this.tagDefinitions[tagName]) {
        errors.push({ line: lineNum, message: `未知标签: <${tagName}>` });
        continue;
      }
      
      if (isClosing) {
        if (this.isSelfClosing(tagName)) {
           // 自闭合标签不应该有闭合标签，但在 HTML/XML 中通常允许为空元素
           // 这里我们允许 <pause></pause> 这种写法，但如果是单标签写法 <pause /> (Listext 不支持 />)，
           // Listext 解析器其实是把 <pause> 当作自闭合。
           // 如果用户写了 </pause>，说明前面应该有 <pause>
           // 检查栈顶
           if (stack.length > 0 && stack[stack.length - 1] === tagName) {
             stack.pop();
           } else {
             // 可能是自闭合标签的闭合部分，或者多余的闭合标签
             if (!this.isSelfClosing(tagName)) {
               errors.push({ line: lineNum, message: `多余的闭合标签: </${tagName}>` });
             }
           }
        } else {
          // 普通标签
          if (stack.length === 0 || stack[stack.length - 1] !== tagName) {
             errors.push({ line: lineNum, message: `不匹配的闭合标签: </${tagName}>` });
          } else {
            stack.pop();
          }
        }
      } else {
        // 开始标签
        if (!this.isSelfClosing(tagName)) {
          stack.push(tagName);
        }
        
        // 检查属性格式
        const attrStr = match[2];
        if (attrStr && attrStr.trim()) {
           // 简单检查属性是否符合 key="value" 或 key=value
           // 暂时不做严格检查
        }
      }
    }
    
    // 检查未闭合的标签
    if (stack.length > 0) {
      errors.push({ line: lines.length, message: `未闭合的标签: <${stack.join('>, <')}>` });
    }
    
    return errors;
  }

  /**
   * 解析 Listext 文本为 AST
   * @param {string} text Listext 文本
   * @returns {Array} AST 节点数组
   */
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

  /**
   * 解析单个节点
   */
  parseNode(text, pos) {
    // 跳过空白
    while (pos < text.length && /\s/.test(text[pos])) {
      pos++;
    }

    if (pos >= text.length) return null;

    // 查找标签开始
    // 优先匹配注释
    if (text.startsWith('<!--', pos)) {
      const commentEnd = text.indexOf('-->', pos);
      if (commentEnd !== -1) {
        const content = text.slice(pos + 4, commentEnd).trim();
        return {
          node: { type: 'comment', content },
          pos: commentEnd + 3
        };
      }
    }

    const tagMatch = text.slice(pos).match(/^<([a-zA-Z]+)([^>]*)>/);
    if (!tagMatch) {
      // 纯文本节点
      const textEnd = text.indexOf('<', pos);
      const content = textEnd === -1 
        ? text.slice(pos).trim() 
        : text.slice(pos, textEnd).trim();
      
      if (content) {
        return {
          node: { type: 'text', content },
          pos: textEnd === -1 ? text.length : textEnd
        };
      }
      return null;
    }

    const tagName = tagMatch[1].toLowerCase();
    const attrStr = tagMatch[2].trim();
    const tagStart = pos;
    pos += tagMatch[0].length;

    // 解析属性
    const attrs = this.parseAttributes(attrStr);

    // 查找闭合标签
    const closeTag = `</${tagName}>`;
    const closePos = text.indexOf(closeTag, pos);

    let children = [];
    let content = '';

    if (closePos !== -1) {
      // 自闭合标签检查
      if (this.isSelfClosing(tagName)) {
        content = '';
        pos = tagStart + tagMatch[0].length;
      } else {
        const innerContent = text.slice(pos, closePos);
        
        // 递归解析子节点
        if (this.hasChildren(tagName)) {
          children = this.parse(innerContent);
        } else {
          content = innerContent.trim();
        }
        pos = closePos + closeTag.length;
      }
    } else {
      // 无闭合标签，作为自闭合处理
      content = '';
    }

    const node = {
      type: 'element',
      tagName,
      attrs,
      children,
      content,
      definition: this.tagDefinitions[tagName] || null
    };

    return { node, pos };
  }

  /**
   * 解析属性字符串
   */
  parseAttributes(attrStr) {
    const attrs = {};
    
    // 匹配属性：name="value" 或 name=value 或单独的 name
    const attrRegex = /(\w+)(?:=(?:"([^"]*)"|(\S+)))?/g;
    let match;

    while ((match = attrRegex.exec(attrStr)) !== null) {
      const name = match[1];
      const value = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : true);
      attrs[name] = value;
    }

    return attrs;
  }

  /**
   * 判断是否为自闭合标签
   */
  isSelfClosing(tagName) {
    return ['pause', 'fx', 'divider'].includes(tagName);
  }

  /**
   * 判断标签是否包含子节点
   */
  hasChildren(tagName) {
    return ['repeat'].includes(tagName);
  }

  /**
   * 将 AST 转换回 Listext 文本
   * @param {Array} ast AST 节点数组
   * @param {number} indent 缩进层级
   * @returns {string} Listext 文本
   */
  stringify(ast, indent = 0) {
    let result = '';
    const indentStr = '  '.repeat(indent);

    for (const node of ast) {
      if (node.type === 'comment') {
        result += indentStr + `<!-- ${node.content} -->\n`;
      } else if (node.type === 'text') {
        if (node.content.trim()) {
          result += indentStr + node.content.trim() + '\n';
        }
      } else if (node.type === 'element') {
        const attrs = this.stringifyAttrs(node.attrs);
        const attrStr = attrs ? ` ${attrs}` : '';

        if (this.isSelfClosing(node.tagName)) {
          result += indentStr + `<${node.tagName}${attrStr}>\n`;
        } else if (node.children && node.children.length > 0) {
          result += indentStr + `<${node.tagName}${attrStr}>\n`;
          result += this.stringify(node.children, indent + 1);
          result += indentStr + `</${node.tagName}>\n`;
        } else {
          result += indentStr + `<${node.tagName}${attrStr}>${node.content}</${node.tagName}>\n`;
        }
      }
    }

    return result;
  }

  /**
   * 将属性对象转换为字符串
   */
  stringifyAttrs(attrs) {
    const parts = [];
    for (const [key, value] of Object.entries(attrs)) {
      if (value === true) {
        parts.push(key);
      } else {
        parts.push(`${key}="${value}"`);
      }
    }
    return parts.join(' ');
  }

  /**
   * 获取节点的语音配置
   */
  selectVoiceForNode(node) {
    const tagName = node.tagName;
    
    switch (tagName) {
      default:
        return 'female';
    }
  }

  /**
   * 获取节点的语速配置
   */
  getSpeedForNode(node) {
    return 1.0;
  }

  /**
   * 验证 AST 结构
   */
  validate(ast) {
    const errors = [];

    const validateNode = (node, path = '') => {
      if (node.type === 'element') {
        const pathStr = path ? `${path}/${node.tagName}` : node.tagName;

        // 检查未知标签
        if (!this.tagDefinitions[node.tagName]) {
          errors.push({ path: pathStr, message: `未知标签: ${node.tagName}` });
        }

        // 检查必需属性
        if (node.tagName === 'fx' && !node.attrs.id) {
          errors.push({ path: pathStr, message: 'fx 标签缺少 id 属性' });
        }

        if (node.tagName === 's' && !node.attrs.dur && !Object.keys(node.attrs).length) {
          // s 标签可能没有显式属性，检查是否在属性中有数字
          const text = node.attrs[Object.keys(node.attrs)[0]];
          if (!text && !node.attrs.dur) {
            // 尝试从标签内容获取
          }
        }

        // 递归验证子节点
        if (node.children) {
          for (const child of node.children) {
            validateNode(child, pathStr);
          }
        }
      }
    };

    for (const node of ast) {
      validateNode(node);
    }

    return errors;
  }
}

// 导出解析器
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ListextParser;
}
