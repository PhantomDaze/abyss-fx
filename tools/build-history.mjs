// 由 ECB 日度参考汇率生成游戏用的紧凑历史数据（js/data/history.js）
// 数据源：https://api.frankfurter.dev/v1（欧洲央行参考汇率，每个工作日 16:00 CET）
// 用法：node tools/build-history.mjs
import fs from 'node:fs';

const RAW = new URL('./ecb-raw.json', import.meta.url);
const OUT = new URL('../js/data/history.js', import.meta.url);
const raw = JSON.parse(fs.readFileSync(RAW, 'utf8'));
const dates = Object.keys(raw.rates).sort();

// EUR 计价原始汇率 → 各货币对
function toPair(code, r) {
  switch (code) {
    case 'EURUSD': return r.USD;
    case 'GBPUSD': return r.USD / r.GBP;
    case 'USDJPY': return r.JPY / r.USD;
    case 'USDCHF': return r.CHF / r.USD;
    case 'EURCHF': return r.CHF;
    case 'AUDUSD': return r.USD / r.AUD;
    case 'USDCAD': return r.CAD / r.USD;
    case 'EURJPY': return r.JPY;
    case 'GBPJPY': return r.JPY / r.GBP;
  }
  throw new Error('unknown pair ' + code);
}

const CODES = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'EURCHF', 'AUDUSD', 'USDCAD', 'EURJPY', 'GBPJPY'];
const SCALE = 1e5; // 统一放大到整数，避免浮点误差
const pairs = {};
for (const code of CODES) pairs[code] = [];

for (const d of dates) {
  const r = raw.rates[d];
  if (!r || !r.USD || !r.JPY) continue;
  for (const code of CODES) {
    const v = toPair(code, r);
    pairs[code].push(Math.round(v * SCALE));
  }
}

const out = {
  v: 1,
  source: 'ECB reference rates via frankfurter.dev',
  scale: SCALE,
  dates,
  pairs,
};
fs.writeFileSync(OUT, 'window.FX = window.FX || {};\nwindow.FX.HISTORY = ' + JSON.stringify(out) + ';\n');
const st = fs.statSync(OUT);
console.log(`dates=${dates.length} (${dates[0]} → ${dates.at(-1)})  size=${(st.size / 1024).toFixed(1)} KiB`);
for (const code of CODES) {
  const a = pairs[code];
  console.log(code, (a.at(-1) / SCALE).toFixed(5), 'min', (Math.min(...a) / SCALE).toFixed(5), 'max', (Math.max(...a) / SCALE).toFixed(5));
}
