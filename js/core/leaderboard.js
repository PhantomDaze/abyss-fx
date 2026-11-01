/* 每日挑战全球排行榜客户端
   原则：排行榜是可选增强。所有方法都返回 Promise 且永不 reject；
   网络失败、超时、未配置、离线都只返回 { ok:false }，不抛异常、不影响单机。
*/
(function () {
  'use strict';
  const FX = (window.FX = window.FX || {});
  const U = FX.U;

  // 部署 Worker 后把地址填在这里，例如 https://abyss-fx-leaderboard.example.workers.dev
  // 留空则全球榜功能关闭，游戏保持完全离线。
  const DEFAULT_API = 'https://abyss-fx-leaderboard.phantomc261.workers.dev';
  const TIMEOUT_MS = 4000;
  const PLAYER_KEY = 'player';
  const PENDING_KEY = 'leaderboard-pending';
  const CACHE_KEY = 'leaderboard-cache';

  function normalizeBase(raw) {
    if (!raw) return '';
    return String(raw).trim().replace(/\/+$/, '');
  }

  /** 优先级：window.FX_LEADERBOARD_API（测试/自建） > localStorage > 内置常量 */
  function resolveBase() {
    if (typeof window.FX_LEADERBOARD_API === 'string') return normalizeBase(window.FX_LEADERBOARD_API);
    const saved = U.store.get('leaderboardApi', '');
    if (typeof saved === 'string' && saved) return normalizeBase(saved);
    return normalizeBase(DEFAULT_API);
  }

  function randomId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID().replace(/-/g, '');
      }
    } catch (_) {}
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function cleanName(v) {
    return String(v == null ? '' : v)
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 16);
  }

  function validDayKey(k) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(k || ''));
  }

  const Leaderboard = {
    TIMEOUT_MS,
    apiBase: resolveBase(),

    /** 运行时配置地址（开发/自建部署用） */
    configure(base) {
      this.apiBase = normalizeBase(base);
      U.store.set('leaderboardApi', this.apiBase);
      return this.apiBase;
    },

    available() {
      return !!this.apiBase;
    },

    online() {
      return typeof navigator === 'undefined' || navigator.onLine !== false;
    },

    // ---------- 玩家身份 ----------
    player() {
      let p = U.store.get(PLAYER_KEY, null);
      if (!p || typeof p !== 'object' || !p.id) {
        p = { id: randomId(), name: '' };
        U.store.set(PLAYER_KEY, p);
      }
      return { id: String(p.id), name: cleanName(p.name) };
    },

    setName(name) {
      const p = this.player();
      p.name = cleanName(name);
      U.store.set(PLAYER_KEY, p);
      return p.name;
    },

    displayName() {
      const p = this.player();
      return p.name || '玩家' + p.id.slice(-4);
    },

    // ---------- 接口 ----------
    /** 提交成绩；成功返回 { ok, best, rank }，失败入待提交队列 */
    submit(dayKey, entry) {
      if (!validDayKey(dayKey)) return Promise.resolve({ ok: false, error: '日期无效' });
      const p = this.player();
      if (!p.name) return Promise.resolve({ ok: false, needName: true });
      const body = {
        playerId: p.id,
        name: p.name,
        score: Math.round(Number(entry.score) || 0),
        equity: Number(entry.equity) || 0,
        dd: Number(entry.dd) || 0,
        trades: Math.round(Number(entry.trades) || 0),
        hits: Math.round(Number(entry.hits) || 0),
        modId: String(entry.modId || '').slice(0, 24),
        version: 1,
      };
      return this._request('/api/daily/' + encodeURIComponent(dayKey) + '/scores', {
        method: 'POST',
        body,
      }).then((res) => {
        if (res.ok) this._dropPending(dayKey, body.score);
        else this._queuePending(dayKey, body);
        return res;
      });
    },

    /** 今日榜；失败时回退到最近一次缓存 */
    top(dayKey, limit, playerId) {
      if (!validDayKey(dayKey)) return Promise.resolve({ ok: false, error: '日期无效' });
      const q = new URLSearchParams({ limit: String(limit || 50) });
      if (playerId) q.set('playerId', playerId);
      return this._request('/api/daily/' + encodeURIComponent(dayKey) + '/scores?' + q.toString())
        .then((res) => {
          if (res.ok) {
            this._cacheTop(dayKey, res);
            return res;
          }
          const cached = this._cachedTop(dayKey);
          if (cached) return Object.assign({}, cached, { ok: false, cached: true, offline: true });
          return res;
        });
    },

    /** 近 N 天每日冠军 */
    champions(limit) {
      return this._request('/api/daily/champions?limit=' + (limit || 30)).then((res) => {
        if (res.ok) {
          this._cacheChampions(res.rows || []);
          return res;
        }
        const cached = this._cachedChampions();
        if (cached) return { ok: false, cached: true, offline: true, rows: cached };
        return res;
      });
    },

    /** 重试待提交队列；可只重试某一天 */
    flushPending(dayKey) {
      const all = this._pending();
      const keys = dayKey ? [dayKey] : Object.keys(all);
      return keys.reduce((p, k) => p.then((acc) => {
        const body = all[k];
        if (!body) return acc;
        return this._request('/api/daily/' + encodeURIComponent(k) + '/scores', {
          method: 'POST', body,
        }).then((res) => {
          if (res.ok) this._dropPending(k, body.score);
          return { ok: acc.ok && res.ok, flushed: acc.flushed + (res.ok ? 1 : 0) };
        });
      }), Promise.resolve({ ok: true, flushed: 0 }));
    },

    pending(dayKey) {
      const all = this._pending();
      return dayKey ? all[dayKey] || null : all;
    },

    // ---------- 网络 ----------
    _request(path, opts = {}) {
      if (!this.apiBase) return Promise.resolve({ ok: false, disabled: true });
      if (!this.online()) return Promise.resolve({ ok: false, offline: true });
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
      const init = {
        method: opts.method || 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      };
      if (opts.body) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(opts.body);
      }
      if (ctrl) init.signal = ctrl.signal;
      return fetch(this.apiBase + path, init)
        .then((res) => res.json().catch(() => ({})).then((data) => {
          if (!res.ok) {
            return { ok: false, status: res.status, error: (data && data.error) || ('HTTP ' + res.status) };
          }
          return Object.assign({ ok: true }, data || {});
        }))
        .catch((err) => ({
          ok: false,
          offline: true,
          timeout: !!(err && err.name === 'AbortError'),
          error: err && err.message ? err.message : String(err),
        }))
        .then((res) => {
          if (timer) clearTimeout(timer);
          return res;
        }, (err) => {
          if (timer) clearTimeout(timer);
          return { ok: false, offline: true, error: String(err) };
        });
    },

    // ---------- 待提交队列 ----------
    _pending() {
      const v = U.store.get(PENDING_KEY, null);
      return v && typeof v === 'object' ? v : {};
    },

    _queuePending(dayKey, body) {
      const all = this._pending();
      const prev = all[dayKey];
      if (!prev || body.score > prev.score) {
        all[dayKey] = body;
        U.store.set(PENDING_KEY, all);
      }
    },

    _dropPending(dayKey, score) {
      const all = this._pending();
      if (all[dayKey] && (!score || all[dayKey].score <= score)) {
        delete all[dayKey];
        U.store.set(PENDING_KEY, all);
      }
    },

    // ---------- 缓存（离线时展示上次数据） ----------
    _cache() {
      const v = U.store.get(CACHE_KEY, null);
      return v && typeof v === 'object' ? v : { top: {}, champions: null };
    },

    _cacheTop(dayKey, data) {
      const c = this._cache();
      if (!c.top) c.top = {};
      c.top[dayKey] = {
        ts: Date.now(),
        dayKey,
        total: data.total || 0,
        rows: data.rows || [],
        me: data.me || null,
      };
      const keys = Object.keys(c.top).sort();
      while (keys.length > 7) delete c.top[keys.shift()];
      U.store.set(CACHE_KEY, c);
    },

    _cachedTop(dayKey) {
      const c = this._cache();
      return (c.top && c.top[dayKey]) || null;
    },

    _cacheChampions(rows) {
      const c = this._cache();
      c.champions = { ts: Date.now(), rows: rows || [] };
      U.store.set(CACHE_KEY, c);
    },

    _cachedChampions() {
      const c = this._cache();
      return c.champions ? c.champions.rows : null;
    },
  };

  FX.Leaderboard = Leaderboard;
})();
