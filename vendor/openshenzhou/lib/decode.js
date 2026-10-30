'use strict';
// decode.js —— 微软语音包 .bin 模型解码（94 字节头 + 90 字节循环密钥 XOR）
const fs = require('fs');
const path = require('path');

const HEADER = 94;
const KEY = Buffer.from(
  'ZCjZ7nHDSLvf4gpELteM4AnzaWUjTpn7UkV7D@vvksl0w1SNgon6d1905WANbktDc9S39oaA4r29HJNayXvTq8fJsq',
  'ascii');

function decodeBin(buf) {
  const payload = buf.subarray(HEADER);
  const out = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ KEY[i % KEY.length];
  return out;
}

function decodeFile(src, dst) {
  const out = decodeBin(fs.readFileSync(src));
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, out);
  return out.length;
}

module.exports = { decodeBin, decodeFile, KEY, HEADER };
