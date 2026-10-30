#!/usr/bin/env node
'use strict';
// cli.js —— node cli.js --voice <语音包目录> --text "..." --out out.wav [--speed 1.0]
const { TTS } = require('./index');

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--voice') a.voice = argv[++i];
    else if (k === '--text') a.text = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--speed') a.speed = parseFloat(argv[++i]);
  }
  return a;
}

(async () => {
  const a = parseArgs(process.argv);
  if (!a.voice || !a.text) {
    console.error('用法: openshenzhou --voice <语音包目录> --text "..." --out out.wav [--speed 1.0]');
    process.exit(2);
  }
  const tts = new TTS(a.voice);
  const wav = await tts.speak(a.text, a.out || 'out.wav', a.speed || 1.0);
  console.log(`已写入 ${a.out || 'out.wav'}（${(wav.length / 24000).toFixed(2)} 秒, ${wav.length} 采样）`);
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
