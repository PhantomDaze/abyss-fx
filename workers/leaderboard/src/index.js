/* 每日挑战全球排行榜 Worker（Cloudflare Workers + D1）
   接口：
     GET  /api/daily/:dayKey/scores?limit=50&playerId=...
     POST /api/daily/:dayKey/scores
     GET  /api/daily/champions?limit=30
   只做基础校验；分数由客户端上报，休闲榜不保证防伪造。
*/
const CST_OFFSET = 8 * 3600 * 1000;
const MAX_BODY = 4096;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MOD_RE = /^[A-Za-z0-9_-]{1,24}$/;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    }, corsHeaders()),
  });
}

function fail(message, status = 400) {
  return json({ error: message }, status);
}

/** 北京时间（UTC+8）日期键 */
export function dayKeyCST(ms) {
  return new Date(Number(ms || Date.now()) + CST_OFFSET).toISOString().slice(0, 10);
}

export function cleanName(v) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 16);
}

export function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function validateSubmission(body, dayKey, nowMs) {
  if (!body || typeof body !== 'object') return { error: '请求体无效' };
  if (!DAY_RE.test(String(dayKey || ''))) return { error: '日期格式无效' };
  const today = dayKeyCST(nowMs);
  const yesterday = dayKeyCST(nowMs - 86400000);
  if (dayKey !== today && dayKey !== yesterday) return { error: '日期无效或已过期' };

  const playerId = String(body.playerId || '');
  if (!ID_RE.test(playerId)) return { error: 'playerId 无效' };

  const name = cleanName(body.name);
  if (!name) return { error: '昵称不能为空' };

  // 允许负分与 0 分（亏损、打平也是有效成绩），只限制整数与合理范围
  const score = Number(body.score);
  if (!Number.isInteger(score) || score < -1000000 || score > 1000000) return { error: '分数无效' };

  const equity = Number(body.equity);
  if (!Number.isFinite(equity) || equity < 0 || equity > 1e9) return { error: '权益无效' };

  const dd = Number(body.dd);
  if (!Number.isFinite(dd) || dd < 0 || dd > 100) return { error: '回撤无效' };

  const trades = Number(body.trades);
  if (!Number.isInteger(trades) || trades < 1 || trades > 10000) return { error: '成交笔数无效' };

  const hits = Number(body.hits);
  if (!Number.isInteger(hits) || hits < 0 || hits > 10000) return { error: '命中次数无效' };

  const modId = String(body.modId || '');
  if (!MOD_RE.test(modId)) return { error: '词条无效' };

  return { value: { playerId, name, score, equity, dd, trades, hits, modId } };
}

async function topScores(url, env, dayKey) {
  const limit = clampInt(url.searchParams.get('limit'), 1, 100, 50);
  const playerId = url.searchParams.get('playerId') || '';
  const { results } = await env.DB.prepare(
    'SELECT name, score, equity, dd, trades, hits, mod_id AS modId, updated_at AS at ' +
    'FROM scores WHERE day_key = ? ORDER BY score DESC, updated_at ASC LIMIT ?'
  ).bind(dayKey, limit).all();
  const rows = (results || []).map((r, i) => ({
    rank: i + 1,
    name: r.name,
    score: r.score,
    equity: r.equity,
    dd: r.dd,
    trades: r.trades,
    hits: r.hits,
    modId: r.modId,
    at: r.at,
  }));
  const totalRow = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM scores WHERE day_key = ?'
  ).bind(dayKey).first();

  let me = null;
  if (ID_RE.test(playerId)) {
    const mine = await env.DB.prepare(
      'SELECT score, updated_at FROM scores WHERE day_key = ? AND player_id = ?'
    ).bind(dayKey, playerId).first();
    if (mine) {
      const rankRow = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM scores WHERE day_key = ? AND (score > ? OR (score = ? AND updated_at < ?))'
      ).bind(dayKey, mine.score, mine.score, mine.updated_at).first();
      me = { score: mine.score, rank: (rankRow ? rankRow.n : 0) + 1 };
    }
  }

  return json({
    dayKey,
    total: totalRow ? totalRow.n : rows.length,
    rows,
    me,
  });
}

async function submitScore(request, env, dayKey) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) return fail('请求体过大', 413);
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return fail('JSON 无效');
  }
  if (JSON.stringify(body).length > MAX_BODY) return fail('请求体过大', 413);

  const now = Date.now();
  const checked = validateSubmission(body, dayKey, now);
  if (checked.error) return fail(checked.error);
  const d = checked.value;

  await env.DB.prepare(
    'INSERT INTO scores (day_key, player_id, name, score, equity, dd, trades, hits, mod_id, created_at, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(day_key, player_id) DO UPDATE SET ' +
    'name = excluded.name, score = excluded.score, equity = excluded.equity, dd = excluded.dd, ' +
    'trades = excluded.trades, hits = excluded.hits, mod_id = excluded.mod_id, updated_at = excluded.updated_at ' +
    'WHERE excluded.score > scores.score'
  ).bind(
    dayKey, d.playerId, d.name, d.score, d.equity, d.dd, d.trades, d.hits, d.modId, now, now
  ).run();

  const best = await env.DB.prepare(
    'SELECT score, updated_at FROM scores WHERE day_key = ? AND player_id = ?'
  ).bind(dayKey, d.playerId).first();
  if (!best) return fail('服务器错误', 500);
  const rankRow = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM scores WHERE day_key = ? AND (score > ? OR (score = ? AND updated_at < ?))'
  ).bind(dayKey, best.score, best.score, best.updated_at).first();

  return json({ ok: true, best: best.score, rank: (rankRow ? rankRow.n : 0) + 1 });
}

async function champions(url, env) {
  const limit = clampInt(url.searchParams.get('limit'), 1, 90, 30);
  const { results } = await env.DB.prepare(
    'SELECT day_key AS dayKey, name, score FROM (' +
    '  SELECT day_key, name, score, ' +
    '         ROW_NUMBER() OVER (PARTITION BY day_key ORDER BY score DESC, updated_at ASC) AS rn ' +
    '  FROM scores' +
    ') WHERE rn = 1 ORDER BY day_key DESC LIMIT ?'
  ).bind(limit).all();
  return json({ rows: results || [] });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') return json({ ok: true });
      if (request.method === 'GET' && url.pathname === '/api/daily/champions') {
        return champions(url, env);
      }
      const m = url.pathname.match(/^\/api\/daily\/([^/]+)\/scores$/);
      if (m) {
        const dayKey = decodeURIComponent(m[1]);
        if (!DAY_RE.test(dayKey)) return fail('日期格式无效');
        if (request.method === 'GET') return topScores(url, env, dayKey);
        if (request.method === 'POST') return submitScore(request, env, dayKey);
        return fail('方法不允许', 405);
      }
      return fail('未找到接口', 404);
    } catch (err) {
      console.error('leaderboard worker error', err);
      return fail('服务器错误', 500);
    }
  },
};
