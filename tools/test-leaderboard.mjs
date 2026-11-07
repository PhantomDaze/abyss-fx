// 客户端排行榜单测：负分提交、无昵称暂存、设置昵称后补交、4xx/5xx 队列策略
// 用法：node --test tools/test-leaderboard.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const CODE = fs.readFileSync(new URL('../js/core/leaderboard.js', import.meta.url), 'utf8');
const DAY = '2026-11-01';

function makeStore(seed = {}) {
  const mem = new Map(Object.entries(seed));
  return {
    get(k, d) { return mem.has(k) ? JSON.parse(JSON.stringify(mem.get(k))) : d; },
    set(k, v) { mem.set(k, JSON.parse(JSON.stringify(v))); },
    remove(k) { mem.delete(k); },
  };
}

function boot({ fetchImpl } = {}) {
  const calls = [];
  const fetchFn = fetchImpl || (async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, async json() { return { ok: true, best: 0, rank: 1 }; } };
  });
  const window = {
    FX: { U: { store: makeStore() } },
    FX_LEADERBOARD_API: 'https://test.local',
    crypto: { randomUUID: () => 'abcdef0123456789' },
  };
  const context = {
    window,
    navigator: { onLine: true },
    fetch: fetchFn,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
  };
  vm.createContext(context);
  vm.runInContext(CODE, context);
  return { L: window.FX.Leaderboard, calls };
}

const entry = (over = {}) => Object.assign(
  { score: 500, equity: 11000, dd: 5, trades: 10, hits: 1, modId: 'trend' }, over,
);

test('无昵称提交：入队并返回 needName，不发起请求', async () => {
  const { L, calls } = boot();
  const res = await L.submit(DAY, entry({ score: -120 }));
  assert.equal(res.needName, true);
  assert.equal(res.queued, true);
  assert.equal(calls.length, 0);
  assert.equal(L.pending(DAY).score, -120);
});

test('设置昵称后 flushPending 用当前昵称补交并清空队列', async () => {
  const { L, calls } = boot();
  await L.submit(DAY, entry({ score: -120 }));
  L.setName('测试玩家');
  const res = await L.flushPending(DAY);
  assert.equal(res.flushed, 1);
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.name, '测试玩家');
  assert.equal(body.score, -120);
  assert.equal(L.pending(DAY), null);
});

test('有昵称时负分直接提交，成功后不入队', async () => {
  const { L, calls } = boot();
  L.setName('测试玩家');
  const res = await L.submit(DAY, entry({ score: -300 }));
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].init.body).score, -300);
  assert.equal(L.pending(DAY), null);
});

test('5xx 可重试入队，4xx 永久错误不入队', async () => {
  let status = 500;
  const { L } = boot({
    fetchImpl: async () => ({ ok: false, status, async json() { return { error: 'x' }; } }),
  });
  L.setName('测试玩家');
  await L.submit(DAY, entry({ score: -50 }));
  assert.equal(L.pending(DAY).score, -50);

  status = 400;
  await L.submit(DAY, entry({ score: -60 }));
  // 4xx 不覆盖、不入队：队列仍是刚才那条
  assert.equal(L.pending(DAY).score, -50);
});

test('flushPending 遇到永久 4xx 会丢弃队列，避免无限重试', async () => {
  const { L } = boot({
    fetchImpl: async () => ({ ok: false, status: 400, async json() { return { error: '分数无效' }; } }),
  });
  await L.submit(DAY, entry({ score: -70 })); // 无昵称，入队且不发请求
  L.setName('测试玩家');
  const res = await L.flushPending(DAY);
  assert.equal(res.flushed, 0);
  assert.equal(L.pending(DAY), null);
});

test('历史冠军请求最近 30 个自然日，失败时回退缓存', async () => {
  let fail = false;
  const calls = [];
  const { L } = boot({
    fetchImpl: async (url) => {
      calls.push(url);
      if (fail) return { ok: false, status: 400, async json() { return { error: 'x' }; } };
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true, days: 30, rows: [{ dayKey: '2026-10-30', name: '昨天冠军', score: 700 }] };
        },
      };
    },
  });
  const res = await L.champions(30);
  assert.equal(res.ok, true);
  assert.equal(res.days, 30);
  assert.match(calls[0], /\/api\/daily\/champions\?days=30&limit=30$/);
  assert.equal(res.rows[0].name, '昨天冠军');

  fail = true;
  const cached = await L.champions(30);
  assert.equal(cached.ok, false);
  assert.equal(cached.cached, true);
  assert.equal(cached.days, 30);
  assert.equal(cached.rows[0].name, '昨天冠军');
});
