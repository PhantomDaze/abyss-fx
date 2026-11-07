// Worker 单元测试：用内存假 D1 覆盖校验、upsert、排序与冠军聚合
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { dayKeyCST, validateSubmission, cleanName, clampInt } from '../src/index.js';

class FakeD1 {
  constructor() {
    this.rows = new Map();
  }

  prepare(sql) {
    const db = this;
    let args = [];
    return {
      bind(...a) {
        args = a;
        return this;
      },
      async run() {
        if (/INSERT INTO scores/.test(sql)) {
          const [dayKey, playerId, name, score, equity, dd, trades, hits, modId, createdAt, updatedAt] = args;
          const key = dayKey + '|' + playerId;
          const prev = db.rows.get(key);
          if (!prev || score > prev.score) {
            db.rows.set(key, { dayKey, playerId, name, score, equity, dd, trades, hits, modId, createdAt, updatedAt });
          }
          return { success: true };
        }
        throw new Error('unexpected run: ' + sql);
      },
      async first() {
        if (/SELECT score, updated_at FROM scores WHERE day_key = \? AND player_id = \?/.test(sql)) {
          const [dayKey, playerId] = args;
          const r = db.rows.get(dayKey + '|' + playerId);
          return r ? { score: r.score, updated_at: r.updatedAt } : null;
        }
        if (/score > \? OR \(score = \? AND updated_at < \?\)/.test(sql)) {
          const [dayKey, score, score2, updatedAt] = args;
          const n = [...db.rows.values()].filter((r) => r.dayKey === dayKey
            && (r.score > score || (r.score === score2 && r.updatedAt < updatedAt))).length;
          return { n };
        }
        if (/SELECT COUNT\(\*\) AS n FROM scores WHERE day_key = \?$/.test(sql.trim())) {
          const [dayKey] = args;
          return { n: [...db.rows.values()].filter((r) => r.dayKey === dayKey).length };
        }
        throw new Error('unexpected first: ' + sql);
      },
      async all() {
        if (/FROM scores WHERE day_key = \? ORDER BY score DESC, updated_at ASC LIMIT \?/.test(sql)) {
          const [dayKey, limit] = args;
          const rows = [...db.rows.values()]
            .filter((r) => r.dayKey === dayKey)
            .sort((a, b) => b.score - a.score || a.updatedAt - b.updatedAt)
            .slice(0, limit)
            .map((r) => ({
              name: r.name, score: r.score, equity: r.equity, dd: r.dd,
              trades: r.trades, hits: r.hits, modId: r.modId, at: r.updatedAt,
            }));
          return { results: rows };
        }
        if (/ROW_NUMBER\(\) OVER/.test(sql)) {
          const [fromDay, toDay, limit] = args;
          const best = new Map();
          for (const r of db.rows.values()) {
            if (r.dayKey < fromDay || r.dayKey > toDay) continue;
            const cur = best.get(r.dayKey);
            if (!cur || r.score > cur.score || (r.score === cur.score && r.updatedAt < cur.updatedAt)) {
              best.set(r.dayKey, r);
            }
          }
          const rows = [...best.values()]
            .sort((a, b) => b.dayKey.localeCompare(a.dayKey))
            .slice(0, limit)
            .map((r) => ({ dayKey: r.dayKey, name: r.name, score: r.score }));
          return { results: rows };
        }
        throw new Error('unexpected all: ' + sql);
      },
    };
  }
}

const TODAY = dayKeyCST(Date.now());
const YESTERDAY = dayKeyCST(Date.now() - 86400000);

function submission(over) {
  return Object.assign({
    playerId: 'player_abcdefgh',
    name: '测试玩家',
    score: 500,
    equity: 11800,
    dd: 9.1,
    trades: 14,
    hits: 2,
    modId: 'high-vol',
    version: 1,
  }, over || {});
}

async function call(db, path, init) {
  const res = await worker.fetch(new Request('https://example.test' + path, init), { DB: db });
  return { status: res.status, headers: res.headers, body: await res.json() };
}

test('北京时间日期键', () => {
  assert.equal(dayKeyCST(Date.UTC(2026, 9, 30, 15, 59)), '2026-10-30');
  assert.equal(dayKeyCST(Date.UTC(2026, 9, 30, 16, 0)), '2026-10-31');
});

test('校验拒绝非法输入', () => {
  assert.equal(validateSubmission(submission(), '2026/10/31', Date.now()).error, '日期格式无效');
  assert.equal(validateSubmission(submission(), TODAY, Date.now()).value.name, '测试玩家');
  assert.equal(validateSubmission(submission({ playerId: 'x' }), TODAY, Date.now()).error, 'playerId 无效');
  assert.equal(validateSubmission(submission({ name: '   ' }), TODAY, Date.now()).error, '昵称不能为空');
  // 0 分与负分现在是有效成绩
  assert.equal(validateSubmission(submission({ score: 0 }), TODAY, Date.now()).value.score, 0);
  assert.equal(validateSubmission(submission({ score: -320 }), TODAY, Date.now()).value.score, -320);
  assert.equal(validateSubmission(submission({ score: -1000001 }), TODAY, Date.now()).error, '分数无效');
  assert.equal(validateSubmission(submission({ score: 1.5 }), TODAY, Date.now()).error, '分数无效');
  assert.equal(validateSubmission(submission({ trades: 0 }), TODAY, Date.now()).error, '成交笔数无效');
  assert.equal(validateSubmission(submission({ dd: 101 }), TODAY, Date.now()).error, '回撤无效');
  assert.equal(validateSubmission(submission({ modId: '' }), TODAY, Date.now()).error, '词条无效');
  assert.equal(validateSubmission(submission(), '2020-01-01', Date.now()).error, '日期无效或已过期');
});

test('昵称清洗与参数夹取', () => {
  assert.equal(cleanName('  ab\u0001cd  '), 'abcd');
  assert.equal(cleanName('x'.repeat(30)).length, 16);
  assert.equal(clampInt('999', 1, 100, 50), 100);
  assert.equal(clampInt('abc', 1, 100, 50), 50);
});

test('提交、只保留最高分、排序与我的名次', async () => {
  const db = new FakeD1();
  let r = await call(db, '/api/daily/' + TODAY + '/scores', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(submission({ score: 500 })),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.rank, 1);

  r = await call(db, '/api/daily/' + TODAY + '/scores', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(submission({ playerId: 'player_other_1', name: '对手', score: 800 })),
  });
  assert.equal(r.body.rank, 1);

  // 低分不覆盖
  r = await call(db, '/api/daily/' + TODAY + '/scores', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(submission({ score: 400 })),
  });
  assert.equal(r.body.best, 500);
  assert.equal(r.body.rank, 2);

  // 高分覆盖
  r = await call(db, '/api/daily/' + TODAY + '/scores', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(submission({ score: 900 })),
  });
  assert.equal(r.body.best, 900);
  assert.equal(r.body.rank, 1);

  r = await call(db, '/api/daily/' + TODAY + '/scores?limit=50&playerId=player_abcdefgh');
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 2);
  assert.deepEqual(r.body.rows.map((x) => x.score), [900, 800]);
  assert.deepEqual(r.body.me, { score: 900, rank: 1 });
});

test('负分与 0 分也能上榜并按分数排序', async () => {
  const db = new FakeD1();
  await call(db, '/api/daily/' + TODAY + '/scores', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(submission({ playerId: 'player_neg_1', name: '负分甲', score: -200 })),
  });
  await call(db, '/api/daily/' + TODAY + '/scores', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(submission({ playerId: 'player_zero_1', name: '零分乙', score: 0 })),
  });
  const r = await call(db, '/api/daily/' + TODAY + '/scores?limit=50');
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 2);
  assert.deepEqual(r.body.rows.map((x) => x.score), [0, -200]);
});

test('历史冠军取每天最高分', async () => {
  const db = new FakeD1();
  await call(db, '/api/daily/' + YESTERDAY + '/scores', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(submission({ playerId: 'player_yesterday', name: '昨天冠军', score: 700 })),
  });
  await call(db, '/api/daily/' + TODAY + '/scores', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(submission({ playerId: 'player_a_today', name: '今天亚军', score: 600 })),
  });
  await call(db, '/api/daily/' + TODAY + '/scores', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(submission({ playerId: 'player_b_today', name: '今天冠军', score: 1000 })),
  });

  const r = await call(db, '/api/daily/champions?limit=30');
  assert.equal(r.status, 200);
  assert.equal(r.body.days, 30);
  assert.equal(r.body.toDay, TODAY);
  assert.deepEqual(r.body.rows, [
    { dayKey: TODAY, name: '今天冠军', score: 1000 },
    { dayKey: YESTERDAY, name: '昨天冠军', score: 700 },
  ]);
});

test('历史冠军按最近 N 个自然日过滤，不混入更早记录', async () => {
  const db = new FakeD1();
  const OLD = dayKeyCST(Date.now() - 40 * 86400000);
  db.rows.set(OLD + '|player_old', {
    dayKey: OLD, playerId: 'player_old', name: '更早冠军', score: 9999,
    equity: 20000, dd: 1, trades: 10, hits: 2, modId: 'trend',
    createdAt: 1, updatedAt: 1,
  });
  await call(db, '/api/daily/' + TODAY + '/scores', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(submission({ playerId: 'player_today_x', name: '今天冠军', score: 800 })),
  });

  let r = await call(db, '/api/daily/champions?days=30');
  assert.equal(r.status, 200);
  assert.equal(r.body.days, 30);
  assert.equal(r.body.fromDay, dayKeyCST(Date.now() - 29 * 86400000));
  assert.deepEqual(r.body.rows, [{ dayKey: TODAY, name: '今天冠军', score: 800 }]);

  // limit 兼容旧客户端，但仍按“天数”解释
  r = await call(db, '/api/daily/champions?limit=30');
  assert.equal(r.body.days, 30);
  assert.equal(r.body.rows.length, 1);

  // 只取最近 1 天时也应排除昨天和更早
  await call(db, '/api/daily/' + YESTERDAY + '/scores', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(submission({ playerId: 'player_yesterday_x', name: '昨天冠军', score: 900 })),
  });
  r = await call(db, '/api/daily/champions?days=1');
  assert.equal(r.body.days, 1);
  assert.equal(r.body.fromDay, TODAY);
  assert.deepEqual(r.body.rows, [{ dayKey: TODAY, name: '今天冠军', score: 800 }]);
});

test('CORS 与错误响应', async () => {
  const db = new FakeD1();
  const r = await call(db, '/api/daily/' + TODAY + '/scores');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const bad = await call(db, '/api/daily/abc/scores');
  assert.equal(bad.status, 400);
  const missing = await call(db, '/api/nope');
  assert.equal(missing.status, 404);
});
