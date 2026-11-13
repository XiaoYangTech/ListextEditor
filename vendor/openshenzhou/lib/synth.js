'use strict';
// synth.js —— 三段模型推理：音素 ID → 24kHz 波形
const fs = require('fs');
const path = require('path');

const MEL_SCALE = 0.25; // 引擎实测：decoder 输出转置后 ×0.25 给 vocoder

function f32(arr, dims) {
  const ort = require('onnxruntime-node');
  return new ort.Tensor('float32', Float32Array.from(arr), dims);
}

function chunkPlan(T) {
  // 引擎 decoder 分块调度（与 Python 版 streaming.chunk_plan 一致）
  if (T <= 0) return [];
  const first = T > 64 ? 64 : Math.min(32, T);
  const plan = [first];
  let rest = T - first;
  while (rest > 0) {
    if (rest > 64) { plan.push(64); rest -= 64; }
    else if (rest > 32) { plan.push(32); rest -= 32; }
    else { plan.push(rest); rest = 0; }
  }
  return plan;
}

async function synthesize(sessions, ids, outPath, speed = 1.0) {
  const ort = require('onnxruntime-node');
  const [enc, dec, voc] = sessions;
  const n = ids.length;

  const encOut = await enc.run({
    inputs: new ort.Tensor('int32', Int32Array.from(ids), [1, n]),
    speed_ratios: new ort.Tensor('float32', Float32Array.from(new Array(n).fill(speed)), [1, n]),
  });
  const dIn = encOut.decoder_inputs; // [1, T, 256]
  const T = dIn.dims[1];
  const DTYPE = dIn.data.constructor;
  const zero = () => new ort.Tensor('float32', new Float32Array(128), [1, 1, 128]);

  // 引擎 decoder 是分块调用的（首块 64，剩余 >64 发 64、>32 发 32，末块 flush），
  // 每块的量化 scale 在块内现算，跨块携带 LSTM 状态——一次性整段解码会与引擎产生
  // ~4% 能量差异。这里按引擎同款分块调度跑 decoder。
  const plan = chunkPlan(T);
  let h1 = zero(); let c1 = zero(); let h2 = zero(); let c2 = zero();
  const melParts = [];
  let pos = 0;
  const flat = dIn.data;
  for (let ci = 0; ci < plan.length; ci++) {
    const n = plan[ci];
    const seg = new DTYPE(flat.subarray(pos * 256, (pos + n) * 256));
    const decOut = await dec.run({
      decoder_inputs: new ort.Tensor('float32', seg, [1, n, 256]),
      h1, c1, h2, c2,
    });
    melParts.push(new Float32Array(decOut.output_mels.data));
    h1 = new ort.Tensor('float32', new Float32Array(decOut.h1_new.data), [1, 1, 128]);
    c1 = new ort.Tensor('float32', new Float32Array(decOut.c1_new.data), [1, 1, 128]);
    h2 = new ort.Tensor('float32', new Float32Array(decOut.h2_new.data), [1, 1, 128]);
    c2 = new ort.Tensor('float32', new Float32Array(decOut.c2_new.data), [1, 1, 128]);
    pos += n;
  }
  const src = new Float32Array(T * 80);
  let off = 0;
  for (let ci = 0; ci < melParts.length; ci++) {
    src.set(melParts[ci], off);
    off += melParts[ci].length;
  }
  const C = 80;
  // 转置 [1,80,T] 并 ×0.25
  const mel = new Float32Array(C * T);
  for (let t = 0; t < T; t++) {
    for (let c = 0; c < C; c++) mel[c * T + t] = src[t * C + c] * MEL_SCALE;
  }

  const vocOut = await voc.run({
    mel: new ort.Tensor('float32', mel, [1, C, T]),
    state1_in: new ort.Tensor('float32', new Float32Array(128), [1, 128]),
    state2_in: new ort.Tensor('float32', new Float32Array(64), [1, 64]),
  });
  const audio = vocOut.waveform ? vocOut.waveform.data : Object.values(vocOut)[0].data;

  if (outPath) writeWav(outPath, audio, 24000);
  return audio;
}

// 整段一次性解码（不按块）：没有引擎流式卷积缓存时，对中文/韩文这类模型
// 整段推理反而比「按块启停、无缓存」更接近 Python 精确输出（实测 zh 0.96→0.99、
// ko 0.84→0.96）；英文等模型按块解码更接近（0.53 vs 0.9988），故按语言选择。
async function synthesizeWhole(sessions, ids) {
  const ort = require('onnxruntime-node');
  const [enc, dec, voc] = sessions;
  const n = ids.length;
  const encOut = await enc.run({
    inputs: new ort.Tensor('int32', Int32Array.from(ids), [1, n]),
    speed_ratios: new ort.Tensor('float32', new Float32Array(n).fill(1.0), [1, n]),
  });
  const dIn = encOut.decoder_inputs;
  const T = dIn.dims[1];
  const zero = () => new ort.Tensor('float32', new Float32Array(128), [1, 1, 128]);
  const decOut = await dec.run({
    decoder_inputs: new ort.Tensor('float32', new Float32Array(dIn.data), [1, T, 256]),
    h1: zero(), c1: zero(), h2: zero(), c2: zero(),
  });
  const melOut = decOut.output_mels.data;
  const C = 80;
  const mel = new Float32Array(C * T);
  for (let t = 0; t < T; t++) {
    for (let c = 0; c < C; c++) mel[c * T + t] = melOut[t * C + c] * MEL_SCALE;
  }
  const vocOut = await voc.run({
    mel: new ort.Tensor('float32', mel, [1, C, T]),
    state1_in: new ort.Tensor('float32', new Float32Array(128), [1, 128]),
    state2_in: new ort.Tensor('float32', new Float32Array(64), [1, 64]),
  });
  return vocOut.waveform ? vocOut.waveform.data : Object.values(vocOut)[0].data;
}

function writeWav(file, samples, sampleRate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, buf);
}

module.exports = { synthesize, synthesizeWhole, writeWav };
