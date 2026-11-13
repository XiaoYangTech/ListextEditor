'use strict';
// rateadjust.js —— 引擎 RateAdjustment 的精确复刻（基音同步拼接）
// 逆向自引擎 DLL v0.2.10：FUN_1800b0514 / afcd8 / afbd4 / afea0 / b0784
// 与 python 分支 openshenzhou/rateadjust.py 同一算法（int16 域）。
const MIN_P = 60;
const MAX_P = 369;
const STEP = 738;

function detectPeriod(x, pos, hist) {
  const n = x.length;
  let sadBest = 0;
  let bestL = 0;
  let u3 = 0;
  let u4 = 0xff;
  for (let lag = MIN_P; lag <= MAX_P; lag++) {
    if (pos + 2 * lag > n) break;
    let sad = 0;
    for (let i = 0; i < lag; i++) {
      const d = x[pos + i] - x[pos + lag + i];
      sad += d < 0 ? -d : d;
    }
    if (bestL === 0 || sad * bestL < lag * sadBest) {
      sadBest = sad;
      bestL = lag;
    }
    let cand = lag;
    let sad2 = sad;
    if (sad * u4 <= lag * u3) {
      cand = u4;
      sad2 = u3;
    }
    u3 = sad2;
    u4 = cand;
  }
  if (bestL === 0) return 0;
  const res8 = Math.floor(sadBest / bestL);
  const res20 = u4 ? Math.floor(u3 / u4) : 0;
  let period = bestL;
  const [prevP, prevRes] = hist;
  if (res8 !== 0 && prevP !== 0) {
    if (!(res8 * 3 < res20 || res8 * 2 <= prevRes * 3)) period = prevP;
  }
  hist[0] = bestL;
  hist[1] = res8;
  return period;
}

function truncDiv(a, b) {
  return a >= 0 ? Math.floor(a / b) : -Math.floor(-a / b);
}

function crossfade(a, b, count) {
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const v = truncDiv(a[i] * (count - i) + b[i] * i, count);
    out[i] = v < -32768 ? -32768 : (v > 32767 ? 32767 : v);
  }
  return out;
}

function adjustInt16(xin, rate) {
  const buf = Array.from(xin, v => v | 0);
  const out = [];
  let pos = 0;
  let carry = 0;
  const hist = [0, 0];
  const r = Math.fround(rate);
  const one = Math.fround(1.0);
  const two = Math.fround(2.0);
  const half = Math.fround(0.5);

  function process() {
    while (pos + STEP <= buf.length) {
      if (carry < 1) {
        const p = detectPeriod(buf, pos, hist);
        if (p <= 0) break;
        if (r > one) {
          // 引擎用单精度：每一步乘/除后都做 float32 舍入
          const f10 = Math.fround(one / Math.fround(r - one));
          let olen;
          if (r < two) {
            carry = Math.trunc(Math.fround(Math.fround(Math.fround(two - r) * Math.fround(p)) * f10));
            olen = p;
          } else {
            olen = Math.trunc(Math.fround(f10 * Math.fround(p)));
            carry = 0;
          }
          const look = Math.max(p, olen);
          if (pos + p + look > buf.length) break;
          const a = buf.slice(pos, pos + p);
          const b = buf.slice(pos + p, pos + p + look);
          out.push(...crossfade(a, b, olen));
          pos += olen + p;
        } else {
          const f10 = Math.fround(one / Math.fround(one - r));
          let olen;
          if (r >= half) {
            carry = Math.trunc(Math.fround(Math.fround(Math.fround(r + r - one) * Math.fround(p)) * f10));
            olen = p;
          } else {
            olen = Math.trunc(Math.fround(Math.fround(Math.fround(p) * r) * f10));
          }
          if (pos + 2 * p > buf.length) break;
          const a = buf.slice(pos, pos + p);
          const b = buf.slice(pos + p, pos + 2 * p);
          for (let i = 0; i < p; i++) out.push(a[i]);
          out.push(...crossfade(b, a, olen));
          pos += olen;
        }
      } else {
        const m = Math.min(STEP, carry);
        if (pos + m > buf.length) break;
        for (let i = 0; i < m; i++) out.push(buf[pos + i]);
        pos += m;
        carry -= m;
      }
    }
    if (pos > 0) {
      buf.splice(0, pos);
      pos = 0;
    }
  }

  process();
  const before = out.length;
  const pending = buf.length;
  for (let i = 0; i < 2 * STEP; i++) buf.push(0);
  process();
  const nKeep = Math.trunc(pending / rate + 0.5);
  const total = Math.min(out.length, before + nKeep);
  const res = new Int16Array(total);
  for (let i = 0; i < total; i++) {
    let v = out[i];
    v = v < -32768 ? -32768 : (v > 32767 ? 32767 : v);
    res[i] = v;
  }
  return res;
}

function adjustFloat(audio, rate) {
  const x = new Int16Array(audio.length);
  for (let i = 0; i < audio.length; i++) {
    let a = audio[i];
    a = a < -1 ? -1 : (a > 1 ? 1 : a);
    x[i] = Math.trunc(a * 32767);
  }
  const y = adjustInt16(x, rate);
  const out = new Float32Array(y.length);
  for (let i = 0; i < y.length; i++) out[i] = y[i] / 32767;
  return out;
}

function engineRateFactor(pct) {
  // 引擎：float32(pct * 0.01f)——不是 pct/100 的双精度除法（85 时两者差 1 ulp，
  // 会使 carry 截断差 1、整段相位漂移；与 python 分支 engine_rate_factor 一致）
  return Math.fround(Math.fround(pct) * Math.fround(0.01));
}

module.exports = { adjustInt16, adjustFloat, detectPeriod, engineRateFactor };
