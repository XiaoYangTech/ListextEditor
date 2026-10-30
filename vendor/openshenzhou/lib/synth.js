'use strict';
// synth.js —— 三段模型推理：音素 ID → 24kHz 波形
const fs = require('fs');
const path = require('path');

const MEL_SCALE = 0.25; // 引擎实测：decoder 输出转置后 ×0.25 给 vocoder

function f32(arr, dims) {
  const ort = require('onnxruntime-node');
  return new ort.Tensor('float32', Float32Array.from(arr), dims);
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
  const zero = new ort.Tensor('float32', new Float32Array(128), [1, 1, 128]);

  const decOut = await dec.run({
    decoder_inputs: dIn,
    h1: zero, c1: zero, h2: zero, c2: zero,
  });
  const mels = decOut.output_mels; // [1, T, 80]
  const C = mels.dims[2];
  // 转置 [1,80,T] 并 ×0.25
  const src = mels.data;
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

module.exports = { synthesize, writeWav };
