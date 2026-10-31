// 浏览器冒烟测试：加载、下单、平仓、模式切换、截图
// 用法：先启动 `python3 -m http.server 8099`，再 node tools/test-ui.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8099/';
const EXE = process.env.CHROME || '/home/antom/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const OUT = '/tmp/abyss-shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const log = (...a) => console.log(...a);
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  log('shot', name);
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
// 关闭首次欢迎弹窗
if (await page.locator('#modal:not(.hidden)').count()) {
  const start = page.locator('#modalActions button', { hasText: '直接开始' });
  if (await start.count()) await start.first().click();
  else await page.locator('#modalClose').click();
  await page.waitForTimeout(300);
}
log('title', await page.title());

// 基本 DOM
const pairs = await page.locator('#pairList .pair-row').count();
const equity = await page.locator('#equityValue').textContent();
log('pairs', pairs, 'equity', equity);
if (pairs < 7) throw new Error('货币对列表异常: ' + pairs);
await shot('01-desktop');

// 等行情推进
await page.waitForTimeout(2500);
const price1 = await page.locator('#currentPrice').textContent();

// 检查 canvas 有内容
const canvasInfo = await page.evaluate(() => {
  const c = document.getElementById('chart');
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, Math.min(c.width, 600), Math.min(c.height, 300)).data;
  let nonzero = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 0) nonzero++;
  return { w: c.width, h: c.height, nonzero };
});
log('canvas', canvasInfo);
if (canvasInfo.nonzero < 1000) throw new Error('图表 canvas 基本为空');

// 下单
await page.fill('#lotsInput', '0.10');
await page.click('#longBtn');
await page.waitForTimeout(600);
const posCount = await page.locator('#posCount').textContent();
log('positions', posCount);
if (Number(posCount) < 1) throw new Error('做多后没有持仓');
await shot('02-position');

// 平仓
const closeBtn = page.locator('#positionsList .pos-btn.primary').first();
if (await closeBtn.count()) await closeBtn.click();
await page.waitForTimeout(500);
const hisCount = await page.locator('#hisCount').textContent();
log('history', hisCount);

// 挂单
await page.click('#orderTypeSeg button[data-type="limit"]');
await page.fill('#lotsInput', '0.05');
await page.click('#longBtn');
await page.waitForTimeout(400);
const ordCount = await page.locator('#ordCount').textContent();
log('orders', ordCount);

// 切主题
await page.click('#settingsBtn');
await page.waitForTimeout(200);
await page.click('#themeSeg button[data-theme="day"]');
await page.waitForTimeout(400);
await shot('03-day');
await page.click('#setOk');
await page.waitForTimeout(300);

// 存档导出 / 导入
const saveIO = await page.evaluate(() => {
  FX.game.save();
  const text = FX.SaveIO.build();
  const obj = FX.SaveIO.parse(text);
  let rejected = false;
  try { FX.SaveIO.parse('{}'); } catch (_) { rejected = true; }
  return { magic: obj.magic, keys: Object.keys(obj.data), size: text.length, rejected };
});
log('saveio', saveIO);
if (saveIO.magic !== 'abyss-fx-save' || !saveIO.keys.length || !saveIO.rejected) {
  throw new Error('存档导入导出接口异常');
}
await page.click('#settingsBtn');
await page.waitForTimeout(200);
await page.click('#setExport');
await page.waitForTimeout(300);
const exportLen = await page.evaluate(() => {
  const ta = document.getElementById('saveExportText');
  return ta ? ta.value.length : 0;
});
log('save export modal', exportLen);
if (!exportLen) throw new Error('导出弹窗没有存档内容');
await page.click('#modalClose');
await page.waitForTimeout(200);
await page.click('#setClose');
await page.waitForTimeout(200);

// 战役
await page.click('#modeTabs .mode-tab[data-mode="battle"]');
await page.waitForTimeout(400);
const battleCards = await page.locator('#battleGrid .battle-card').count();
log('battle cards', battleCards);
await shot('04-battles');
await page.locator('#battleGrid .battle-card').first().click();
await page.waitForTimeout(300);
await shot('05-story');
await page.click('#storyStart');
await page.waitForTimeout(800);
await shot('06-battle');
for (let i = 0; i < 3; i++) {
  await page.click('#nextDayBtn');
  await page.waitForTimeout(600);
}
await shot('07-battle-3days');
const badge = await page.locator('#modeBadge').textContent();
log('mode badge', badge);

// 每日挑战（新建 browser context 会缺存档，这里直接开）
await page.click('#modeTabs .mode-tab[data-mode="challenge"]');
await page.waitForTimeout(300);
await shot('08-challenge-modal');
const chStart = page.locator('#chStart');
if (await chStart.isEnabled()) {
  await chStart.click();
  await page.waitForTimeout(1200);
  await shot('09-challenge');
}

// 经历一次强平场景：回模拟，最大杠杆重仓
await page.click('#modeTabs .mode-tab[data-mode="sim"]');
await page.waitForTimeout(400);
await page.selectOption('#leverageSelect', '500').catch(() => {});
await page.click('.quick-lots button[data-lots="max"]');
await page.click('#longBtn');
await page.waitForTimeout(600);
await shot('10-max');

// 分享
await page.click('#shareBtn');
await page.waitForTimeout(800);
await shot('11-share');
const shareInfo = await page.evaluate(() => {
  const c = document.getElementById('shareCanvas');
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, 200, 200).data;
  let nonzero = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 0) nonzero++;
  return { w: c.width, h: c.height, nonzero };
});
log('share', shareInfo);
await page.click('#shareClose2');

// 移动端
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
mobile.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
await mobile.goto(BASE, { waitUntil: 'networkidle' });
await mobile.waitForTimeout(1400);
if (await mobile.locator('#modal:not(.hidden)').count()) {
  const start = mobile.locator('#modalActions button', { hasText: '直接开始' });
  if (await start.count()) await start.first().click();
  await mobile.waitForTimeout(400);
}
await mobile.screenshot({ path: `${OUT}/12-mobile.png`, fullPage: false });
const scrollW = await mobile.evaluate(() => document.documentElement.scrollWidth);
log('mobile scrollWidth', scrollW);
if (scrollW > 400) log('WARN: 移动端可能横向滚动', scrollW);
await mobile.close();

log('errors', JSON.stringify(errors, null, 2));
await browser.close();
if (errors.length) process.exitCode = 1;
