/* 通用工具与事件总线 —— 全局命名空间 FX */
(function () {
  'use strict';
  const FX = (window.FX = window.FX || {});

  const U = (FX.U = {});

  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;

  /** 金额：$10,000.00 / -$120.50 */
  U.money = function (v, digits = 2) {
    if (!isFinite(v)) return '—';
    const sign = v < 0 ? '-' : '';
    const abs = Math.abs(v);
    return (
      sign +
      '$' +
      abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    );
  };

  /** 带正负号的金额：+$120.50 */
  U.moneySigned = function (v, digits = 2) {
    if (!isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + U.money(v, digits);
  };

  U.price = function (v, digits) {
    if (!isFinite(v)) return '—';
    return v.toFixed(digits);
  };

  U.pct = function (v, digits = 2) {
    if (!isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(digits) + '%';
  };

  /** 手数：0.01 手 */
  U.lots = function (v) {
    return (Math.round(v * 100) / 100).toFixed(2) + ' 手';
  };

  /** 点（pip）：0.9 点 */
  U.pips = function (v, digits = 1) {
    if (!isFinite(v)) return '—';
    return (Math.round(v * Math.pow(10, digits)) / Math.pow(10, digits)).toFixed(digits) + ' 点';
  };

  U.pad2 = (n) => String(n).padStart(2, '0');

  /** 日期 → YYYY-MM-DD（本地时区） */
  U.dateISO = function (d) {
    return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1) + '-' + U.pad2(d.getDate());
  };

  /** 日期 → YYYY-MM-DD（UTC 时区，行情内部统一用这个） */
  U.dateUTC = function (d) {
    return new Date(d).toISOString().slice(0, 10);
  };

  /** YYYY-MM-DD → 本地 Date（避免 UTC 偏移） */
  U.parseISO = function (s) {
    const p = String(s).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  };

  U.addDays = function (d, n) {
    const x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  };

  U.dayDiff = function (a, b) {
    const ms = U.parseISO(b).getTime() - U.parseISO(a).getTime();
    return Math.round(ms / 86400000);
  };

  U.weekday = function (d) {
    return d.getDay(); // 0 周日 … 6 周六
  };

  /** 字符串 → 32 位种子 */
  U.hash = function (str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  /** 可复现随机数（mulberry32） */
  U.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /** 标准正态（Box-Muller） */
  U.gauss = function (rand) {
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  U.choice = function (arr, rand) {
    return arr[Math.floor((rand ? rand() : Math.random()) * arr.length)];
  };

  /** 数值安全转换 */
  U.num = function (v, fallback = 0) {
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : fallback;
  };

  U.debounce = function (fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  };

  U.throttle = function (fn, ms) {
    let last = 0;
    return function (...args) {
      const now = Date.now();
      if (now - last >= ms) {
        last = now;
        fn.apply(this, args);
      }
    };
  };

  /** 本地存档（带前缀，异常静默） */
  const PREFIX = 'kurumi-fx:';
  U.store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(PREFIX + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (_) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
        return true;
      } catch (_) {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(PREFIX + key);
      } catch (_) {}
    },
  };

  /** 轻量事件总线 */
  class Bus {
    constructor() {
      this.map = new Map();
    }
    on(evt, fn) {
      if (!this.map.has(evt)) this.map.set(evt, new Set());
      this.map.get(evt).add(fn);
      return () => this.off(evt, fn);
    }
    off(evt, fn) {
      const s = this.map.get(evt);
      if (s) s.delete(fn);
    }
    emit(evt, payload) {
      const s = this.map.get(evt);
      if (!s) return;
      for (const fn of Array.from(s)) {
        try {
          fn(payload);
        } catch (err) {
          console.error('[FX] 事件处理异常', evt, err);
        }
      }
    }
  }
  FX.Bus = Bus;

  /** 简易 DOM 构建：el('div', {class:'x'}, '文本') */
  U.el = function (tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.startsWith('on') && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      }
    }
    if (children != null) {
      const list = Array.isArray(children) ? children : [children];
      for (const c of list) {
        if (c == null) continue;
        node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
      }
    }
    return node;
  };

  /** 闪烁某个元素以提示更新 */
  U.pulse = function (node, cls = 'pulse-up') {
    if (!node) return;
    node.classList.remove('pulse-up', 'pulse-down');
    void node.offsetWidth;
    node.classList.add(cls);
  };

  U.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
})();
