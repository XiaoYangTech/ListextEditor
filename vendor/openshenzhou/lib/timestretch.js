'use strict';
// timestretch.js —— 保音高的时长伸缩（WSOLA），用于近似复刻引擎 RateAdjustment
// 见 python 分支 openshenzhou/timestretch.py 的说明与 rea_work/findings_engine.md §34
const FRAME = 960;      // 40 ms（24 kHz）
const SYN_HOP = 240;    // 10 ms
const TOL = 1440;       // 相似度搜索半径（60 ms）

function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

function wsola(x, ratio, frame = FRAME, synHop = SYN_HOP, tol = TOL) {
  if (!(ratio > 0) || Math.abs(ratio - 1) < 1e-6) return Float32Array.from(x);
  const n = x.length;
  if (!n) return Float32Array.from(x);
  const target = Math.round(n * ratio);
  if (target <= frame) {
    const out = new Float32Array(target);
    for (let i = 0; i < target; i++) {
      const p = (i * (n - 1)) / Math.max(1, target - 1);
      const i0 = Math.floor(p), f = p - i0;
      out[i] = i0 + 1 < n ? x[i0] * (1 - f) + x[i0 + 1] * f : x[i0];
    }
    return out;
  }
  const anaHop = Math.max(1, Math.round(synHop * ratio));
  const win = hann(frame);
  const out = new Float32Array(target + frame);
  const wsum = new Float32Array(target + frame);
  let pos = 0;
  let k = 0;
  let prevTail = null;
  while (true) {
    const a = Math.round(pos);
    if (a + frame > n) break;
    const o = k * synHop;
    if (o >= target) break;
    let start = a;
    if (prevTail && prevTail.length >= 8) {
      const lo = Math.max(0, a - tol);
      const hi = Math.min(n - frame, a + tol);
      if (hi > lo) {
        const p = prevTail;
        let npn = 0;
        for (let i = 0; i < p.length; i++) npn += p[i] * p[i];
        if (npn > 1e-12) {
          const score = (cand) => {
            let dot = 0, vv = 0;
            for (let i = 0; i < p.length; i++) {
              const v = x[cand + i];
              dot += v * p[i];
              vv += v * v;
            }
            return dot / (Math.sqrt(vv * npn) + 1e-9);
          };
          let best = -2;
          for (let cand = lo; cand < hi; cand += 4) {
            const c = score(cand);
            if (c > best) { best = c; start = cand; }
          }
          const lo2 = Math.max(lo, start - 3), hi2 = Math.min(hi, start + 4);
          for (let cand = lo2; cand < hi2; cand++) {
            const c = score(cand);
            if (c > best) { best = c; start = cand; }
          }
        }
      }
    }
    for (let i = 0; i < frame; i++) {
      const w = win[i];
      out[o + i] += x[start + i] * w;
      wsum[o + i] += w;
    }
    prevTail = x.subarray(start + synHop, start + frame);
    pos += anaHop;
    k += 1;
  }
  for (let i = 0; i < out.length; i++) if (wsum[i] > 1e-6) out[i] /= wsum[i];
  return out.subarray(0, target);
}

module.exports = { wsola };
