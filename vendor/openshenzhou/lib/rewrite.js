'use strict';
// rewrite.js —— 把微软私有算子换成标准 ONNX 算子（onnx-proto 直接改图）
const fs = require('fs');
const protobuf = require('protobufjs');
const onnxProto = require('onnx-proto');

const onnx = onnxProto.onnx;

function asList(v) {
  if (v === undefined || v === null) return null;
  return Array.isArray(v) ? v : [v];
}

function attrValue(attr) {
  switch (attr.type) {
    case 1: return attr.f ? attr.f : 0;        // FLOAT
    case 2: return attr.i || 0;                 // INT
    case 3: return attr.s ? Buffer.from(attr.s).toString() : ''; // STRING
    case 4: return attr.t;                      // TENSOR
    case 5: return attr.g;                      // GRAPH
    case 6: return attr.floats || [];           // FLOATS
    case 7: return attr.ints || [];             // INTS
    case 8: return attr.strings || [];
    default: return undefined;
  }
}

function mkAttrInts(name, vals) {
  return { name, type: 7, ints: vals };
}
function mkAttrInt(name, v) {
  return { name, type: 2, i: v };
}
function mkAttrString(name, v) {
  return { name, type: 3, s: Buffer.from(v, 'utf8') };
}

const CONTROL = new Set(['streaming_control', 'streaming_control_input']);

function rewriteModel(model) {
  const g = model.graph;
  const nodes = [];
  for (const node of g.node) {
    if (node.domain !== 'test.customop') {
      nodes.push(node);
      continue;
    }
    const attrs = {};
    for (const a of node.attribute || []) attrs[a.name] = attrValue(a);
    const ins = node.input.filter((n) => !CONTROL.has(n));
    const outs = node.output.slice();
    const name = node.name;
    if (node.opType === 'StreamingConv') {
      const n = {
        input: ins, output: outs, name: name + '_conv', opType: 'Conv', domain: '',
        attribute: [
          ...(asList(attrs.kernel_shape) ? [mkAttrInts('kernel_shape', asList(attrs.kernel_shape))] : []),
          ...(asList(attrs.pads) ? [mkAttrInts('pads', asList(attrs.pads))] : []),
          ...(asList(attrs.strides) ? [mkAttrInts('strides', asList(attrs.strides))] : []),
          ...(asList(attrs.dilations) ? [mkAttrInts('dilations', asList(attrs.dilations))] : []),
          mkAttrInt('group', attrs.group || 1),
        ],
      };
      nodes.push(n);
    } else if (node.opType === 'StreamingConvTranspose') {
      nodes.push({
        input: ins, output: outs, name: name + '_convt', opType: 'ConvTranspose', domain: '',
        attribute: [
          ...(asList(attrs.kernel_shape) ? [mkAttrInts('kernel_shape', asList(attrs.kernel_shape))] : []),
          ...(asList(attrs.pads) ? [mkAttrInts('pads', asList(attrs.pads))] : []),
          ...(asList(attrs.strides) ? [mkAttrInts('strides', asList(attrs.strides))] : []),
          ...(asList(attrs.dilations) ? [mkAttrInts('dilations', asList(attrs.dilations))] : []),
          mkAttrInt('group', attrs.group || 1),
          ...(asList(attrs.output_padding) ? [mkAttrInts('output_padding', asList(attrs.output_padding))] : []),
        ],
      });
    } else if (node.opType === 'StreamingPad') {
      nodes.push({
        input: ins, output: outs, name: name + '_pad', opType: 'Pad', domain: '',
        attribute: [mkAttrString('mode', attrs.mode || 'constant')],
      });
    } else if (node.opType === 'StreamingAdd') {
      nodes.push({ input: ins, output: outs, name: name + '_add', opType: 'Add', domain: '', attribute: [] });
    } else {
      nodes.push(node);
    }
  }
  g.node = nodes;
  // 清理未使用的 graph input
  const used = new Set();
  for (const n of g.node) for (const i of n.input) used.add(i);
  g.input = g.input.filter((i) => used.has(i.name));
  return model;
}

function rewriteFile(src, dst) {
  const buf = fs.readFileSync(src);
  const model = onnx.ModelProto.decode(buf);
  rewriteModel(model);
  fs.writeFileSync(dst, onnx.ModelProto.encode(model).finish());
}

module.exports = { rewriteModel, rewriteFile };
