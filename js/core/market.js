/* 行情引擎：合成市场（SimMarket）与历史回放（HistoryMarket）
   统一接口：
     quotes[pairId] = {mid,bid,ask,spreadPips}
     now            游戏时间（Date，UTC）
     step()         推进一个逻辑 tick
     series(pairId, tf) -> {bars:[{t,o,h,l,c,v}], forming}
     news / events  新闻与日历
*/
(function () {
  'use strict';
  const FX = (window.FX = window.FX || {});
  const U = FX.U;

  // ---------- 公共常量 ----------
  FX.TICK_MINUTES = 5;            // 合成市场每个 tick 推进的游戏分钟
  FX.SIM_TFS = [
    { id: '15m', label: '15分', min: 15 },
    { id: '1h', label: '1小时', min: 60 },
    { id: '4h', label: '4小时', min: 240 },
    { id: '1d', label: '日线', min: 1440 },
  ];
  FX.HIST_TFS = [
    { id: '1d', label: '日K', min: 1440 },
    { id: '1w', label: '周K', min: 10080 },
    { id: '1M', label: '月K', min: 43200 },
  ];

  // 时段乘数（UTC 小时）
  FX.SESSION_TABLE = [
    { from: 0, to: 2, spread: 1.6, vol: 0.55, label: '悉尼' },
    { from: 2, to: 7, spread: 1.3, vol: 0.65, label: '东京' },
    { from: 7, to: 8, spread: 1.1, vol: 0.85, label: '伦敦前' },
    { from: 8, to: 12, spread: 1.0, vol: 1.15, label: '伦敦' },
    { from: 12, to: 16, spread: 0.85, vol: 1.35, label: '伦敦/纽约重叠' },
    { from: 16, to: 20, spread: 1.15, vol: 0.95, label: '纽约' },
    { from: 20, to: 21, spread: 1.5, vol: 0.6, label: '纽约尾盘' },
    { from: 21, to: 22, spread: 3.0, vol: 0.45, label: '结算/换日' },
    { from: 22, to: 24, spread: 1.8, vol: 0.5, label: '悉尼' },
  ];

  FX.sessionAt = function (hour) {
    for (const s of FX.SESSION_TABLE) if (hour >= s.from && hour < s.to) return s;
    return FX.SESSION_TABLE[0];
  };

  // 经济日历事件模板（sim 模式）
  FX.EVENT_TYPES = [
    { title: '美国 CPI 年率', ccy: 'USD', imp: 3, sigmaHist: 0.2, sigmaEvent: 0.0025, unit: '%', base: 3.1 },
    { title: '美国非农就业', ccy: 'USD', imp: 3, sigmaHist: 50, sigmaEvent: 0.0020, unit: 'k', base: 180, int: true },
    { title: '美联储利率决议', ccy: 'USD', imp: 3, sigmaHist: 0.25, sigmaEvent: 0.0040, unit: '%', base: 4.25, rate: true },
    { title: '欧元区 CPI 年率', ccy: 'EUR', imp: 2, sigmaHist: 0.15, sigmaEvent: 0.0020, unit: '%', base: 2.4 },
    { title: '欧元区 GDP 季率', ccy: 'EUR', imp: 2, sigmaHist: 0.2, sigmaEvent: 0.0015, unit: '%', base: 0.3 },
    { title: '英国 CPI 年率', ccy: 'GBP', imp: 2, sigmaHist: 0.2, sigmaEvent: 0.0022, unit: '%', base: 3.0 },
    { title: '英国零售销售', ccy: 'GBP', imp: 1, sigmaHist: 0.3, sigmaEvent: 0.0015, unit: '%', base: 0.4 },
    { title: '日本央行利率决议', ccy: 'JPY', imp: 3, sigmaHist: 0.1, sigmaEvent: 0.0035, unit: '%', base: 0.5, rate: true },
    { title: '美国失业率', ccy: 'USD', imp: 2, sigmaHist: 0.15, sigmaEvent: 0.0020, unit: '%', base: 4.1, inverse: true },
    { title: '美国 ISM 制造业 PMI', ccy: 'USD', imp: 1, sigmaHist: 1.0, sigmaEvent: 0.0012, unit: '', base: 49.5 },
    { title: '澳洲联储利率决议', ccy: 'AUD', imp: 2, sigmaHist: 0.25, sigmaEvent: 0.0030, unit: '%', base: 3.6, rate: true },
    { title: '瑞士央行政策声明', ccy: 'CHF', imp: 2, sigmaHist: 0.25, sigmaEvent: 0.0028, unit: '%', base: 0.5, rate: true },
  ];

  // 模拟新闻（非日历）
  FX.RUMOR_NEWS = [
    { tag: '传闻', title: '交易员称看到大型亚洲账户买入欧元', ccy: 'EUR', dir: 1, mag: 0.0012 },
    { tag: '传闻', title: '市场传闻某央行正在悄悄抛售日元', ccy: 'JPY', dir: -1, mag: 0.0014 },
    { tag: '快讯', title: '流动性提供商扩大主要货币对报价', ccy: null, dir: 0, mag: 0.0006 },
    { tag: '市场观察', title: '期权行权价附近出现密集防守盘', ccy: null, dir: 0, mag: 0.0005 },
    { tag: '传闻', title: '有对冲基金被指正在平掉套息头寸', ccy: 'JPY', dir: 1, mag: 0.0018 },
    { tag: '风险提示', title: '地缘局势升温，避险货币走强', ccy: 'CHF', dir: 1, mag: 0.0013 },
    { tag: '市场观察', title: '短线资金追逐英镑，图表上突破关键位', ccy: 'GBP', dir: 1, mag: 0.0011 },
    { tag: '快讯', title: '澳洲就业数据被提前泄露，市场谨慎', ccy: 'AUD', dir: -1, mag: 0.0013 },
  ];

  FX.newsTagClass = function (tag) {
    if (tag === '央行' || tag === '央行政策' || tag === '突发决议') return 'brass';
    if (tag === '风险提示' || tag === '地缘') return 'warn';
    if (tag === '传闻') return 'warn';
    if (tag === '快讯' || tag === '数据') return 'info';
    return 'info';
  };

  // 简单蜡烛序列（按固定分钟聚合）
  class CandleStore {
    constructor(pair, tfs) {
      this.pair = pair;
      this.tfs = tfs;
      this.data = {};
      for (const tf of tfs) this.data[tf.id] = { bars: [], cur: null, curStart: 0 };
    }
    /** 用价格与时间更新所有周期的当前 K 线 */
    push(tMin, price, vol) {
      for (const tf of this.tfs) {
        const d = this.data[tf.id];
        const start = Math.floor(tMin / tf.min) * tf.min;
        if (!d.cur || start !== d.curStart) {
          if (d.cur) {
            d.bars.push(d.cur);
            if (d.bars.length > 600) d.bars.shift();
          }
          d.cur = { t: start, o: price, h: price, l: price, c: price, v: vol || 1 };
          d.curStart = start;
        } else {
          const c = d.cur;
          c.h = Math.max(c.h, price);
          c.l = Math.min(c.l, price);
          c.c = price;
          c.v += vol || 1;
        }
      }
    }
    series(tfId) {
      const d = this.data[tfId] || this.data[this.tfs[0].id];
      return { bars: d.bars, forming: d.cur };
    }
  }
  FX.CandleStore = CandleStore;

  // =========================================================
  // 合成市场
  // =========================================================
  class SimMarket {
    /**
     * @param {object} opts {seed, startTime, dayLengthMin, pairs, modifier}
     * modifier: {volMult, spreadMult, drift, newsRate, label}
     */
    constructor(opts = {}) {
      this.kind = 'sim';
      this.seed = opts.seed >>> 0 || 20261102;
      this.rand = U.rng(this.seed);
      this.startTime = opts.startTime || Date.UTC(2026, 10, 2, 6, 0, 0);
      this.now = new Date(this.startTime);
      this.minutes = 0; // 从开始经过的游戏分钟
      this.tickCount = 0;
      this.pairIds = (opts.pairs || FX.PAIRS.map((p) => p.id)).slice();
      this.mod = Object.assign({ volMult: 1, spreadMult: 1, drift: 0, newsRate: 1, label: '' }, opts.modifier || {});
      this.fixedLeverage = opts.fixedLeverage || null;
      this.endAfterDays = opts.endAfterDays || 0; // 挑战模式的天数，0 = 无限
      this.dayCount = 0;
      this.newsEnabled = opts.newsEnabled !== false;
      this.newsFreq = opts.newsFreq || 'mid';
      this.quotes = {};
      this.prices = {};       // 直接盘 mid
      this.anchors = {};      // 均值回归锚
      this.stores = {};
      this.news = [];         // 已推送的快讯
      this.calendar = [];     // 未来事件
      this.firedEvents = [];
      this.activeShocks = [];
      this.closed = false;
      this.lastSession = null;
      this.weekendSkipped = false;
      this._weekendSpread = 1;
      this.dayEventsGenerated = '';
      this.onNews = null;
      this.onCalendar = null;
      this.onWeekend = null;
      this.onEvent = null;
      this.monthVol = 0;

      this._logVol = 0;
      this._driftPhase = this.rand() * 6.28;
      this._dayDrift = {};

      // 初始化价格与 K 线缓存
      for (const id of this.pairIds) {
        const p = FX.PAIR_MAP[id];
        this.prices[id] = p.price;
        this.anchors[id] = p.price;
        this.stores[id] = new CandleStore(id, FX.SIM_TFS);
      }
      this._seedDrift();
      this._ensureCalendar(this.now);
      // 预热：回填约 3 天的 K 线（不触发新闻与账户）
      this._backfill(opts.backfillTicks != null ? Number(opts.backfillTicks) : 864);
      this._syncQuotes(true);
    }

    _seedDrift() {
      for (const id of this.pairIds) {
        this._dayDrift[id] = (this.rand() - 0.5) * 0.0015;
      }
    }

    _isWeekend(date) {
      const d = date.getUTCDay();
      return d === 6 || d === 0;
    }

    _backfill(ticks) {
      for (let i = 0; i < ticks; i++) {
        this.minutes += FX.TICK_MINUTES;
        this.now = new Date(this.startTime + this.minutes * 60000);
        if (this._isWeekend(this.now)) {
          // 预热阶段不处理周末，仅让时间前进到周一
          continue;
        }
        this._updatePrices(false);
        for (const id of this.pairIds) {
          const q = this.quotes[id];
          this.stores[id].push(Math.floor(this.now.getTime() / 60000), q.mid, 1);
        }
      }
      // 预热结束后把起始时间对齐到当前
      this.startTime = this.now.getTime() - 0;
      this.minutes = 0;
      this._ensureCalendar(this.now);
    }

    _session() {
      return FX.sessionAt(this.now.getUTCHours());
    }

    _updatePrices(applyNoise = true) {
      const hour = this.now.getUTCHours();
      const sess = FX.sessionAt(hour);
      // 随机波动率（对数 OU）
      this._logVol += -0.0015 * this._logVol + 0.012 * U.gauss(this.rand);
      const volMul = U.clamp(Math.exp(this._logVol), 0.55, 2.2);
      const volScale = sess.vol * volMul * this._volMult() * this.mod.volMult;
      const minutesPerTick = FX.TICK_MINUTES;

      // 共同因子
      const usd = U.gauss(this.rand) * 0.00019 * Math.sqrt(minutesPerTick / 5);
      const risk = U.gauss(this.rand) * 0.00012 * Math.sqrt(minutesPerTick / 5);
      // 约每 20 分钟一次小跳
      const jumpHit = this.rand() < 0.006;
      const jump = jumpHit ? U.gauss(this.rand) * 0.0012 : 0;
      const load = {
        EURUSD: [-1.0, 0.55], GBPUSD: [-1.0, 0.48], AUDUSD: [-0.9, 1.05],
        USDJPY: [1.0, -0.65], USDCHF: [0.9, -0.45], USDCAD: [1.0, 0.12],
      };
      // 直接盘更新
      for (const id of ['EURUSD', 'GBPUSD', 'AUDUSD', 'USDJPY', 'USDCHF', 'USDCAD']) {
        if (!this.prices[id]) continue;
        const p = FX.PAIR_MAP[id];
        const target = p.vol / Math.sqrt(288);
        const [lu, lr] = load[id];
        const facVar = Math.pow(lu * 0.00019, 2) + Math.pow(lr * 0.00012, 2);
        const idio = Math.sqrt(Math.max(1e-12, target * target * 0.55 - facVar));
        let r = (lu * usd + lr * risk + U.gauss(this.rand) * idio + jump * (0.5 + this.rand())) * volScale;
        // 反转日词条：每 2 天切换一次整体趋势方向
        let drift = this.mod.drift;
        if (this.mod.reversal) drift += (Math.floor(this.dayCount / 2) % 2 === 0 ? 1 : -1) * 0.0022;
        r += this._dayDrift[id] / 288 + drift / 288 * (id === 'USDJPY' ? -0.7 : 0.5);
        // 均值回归
        const theta = 0.000012;
        const mr = theta * Math.log(this.anchors[id] / this.prices[id]);
        if (applyNoise) this.prices[id] *= Math.exp(r + mr);
        else this.prices[id] *= Math.exp(r * 0.6);
        // 锚点缓慢漂移
        this.anchors[id] *= Math.exp(0.000006 * U.gauss(this.rand));
      }
      this._syncQuotes(applyNoise);
    }

    _syncQuotes(shock) {
      const hour = this.now.getUTCHours();
      const sess = FX.sessionAt(hour);
      const newsSpread = this._newsSpreadMult();
      const weekendMult = this._weekendSpread || 1;
      for (const id of this.pairIds) {
        const p = FX.PAIR_MAP[id];
        let mid = this.prices[id];
        if (mid == null) mid = p.price;
        // 交叉盘由直接盘推导，保证三角一致性
        if (id === 'EURCHF') mid = this.prices.EURUSD * this.prices.USDCHF;
        else if (id === 'EURJPY') mid = this.prices.EURUSD * this.prices.USDJPY;
        else if (id === 'GBPJPY') mid = this.prices.GBPUSD * this.prices.USDJPY;
        this.prices[id] = mid;
        let spr = Math.max(0.3, p.spread * sess.spread * newsSpread * this.mod.spreadMult * weekendMult);
        const half = (spr * p.pip) / 2;
        this.quotes[id] = { mid, bid: mid - half, ask: mid + half, spreadPips: spr };
      }
      this.lastSession = sess;
    }

    _newsSpreadMult() {
      let m = 1;
      const t = this.now.getTime();
      for (const s of this.activeShocks) {
        const dtMin = Math.abs(t - s.time) / 60000;
        if (dtMin > 45) continue;
        const A = s.imp === 3 ? 8 : s.imp === 2 ? 4 : 1.8;
        m += (A - 1) * Math.exp(-dtMin / 5);
      }
      return m;
    }

    _volMult() {
      let m = 1;
      const t = this.now.getTime();
      for (const s of this.activeShocks) {
        const dtMin = Math.abs(t - s.time) / 60000;
        if (dtMin > 45) continue;
        const A = s.imp === 3 ? 6 : s.imp === 2 ? 3 : 1.5;
        m += (A - 1) * Math.exp(-dtMin / 9);
      }
      return m;
    }

    _ensureCalendar(date) {
      const key = U.dateUTC(date);
      if (this.dayEventsGenerated === key) return;
      this.dayEventsGenerated = key;
      // 过滤掉已经过去的事件（预热阶段也不补发）
      this.calendar = this.calendar.filter((e) => e.time > date.getTime());
      if (!this.newsEnabled) return;
      const count = this.newsFreq === 'high' ? 3 : this.newsFreq === 'low' ? 1 : 2;
      const slots = [1.5, 7, 9.5, 12.5, 14, 18, 20.5];
      const used = new Set();
      for (let i = 0; i < count; i++) {
        let slot;
        let guard = 0;
        do {
          slot = slots[Math.floor(this.rand() * slots.length)];
          guard++;
        } while (used.has(slot) && guard < 10);
        used.add(slot);
        const impRoll = this.rand();
        const imp = impRoll < 0.15 ? 3 : impRoll < 0.45 ? 2 : 1;
        const pool = FX.EVENT_TYPES.filter((e) => e.imp === imp);
        const useDef = pool[Math.floor(this.rand() * pool.length)] || FX.EVENT_TYPES[0];
        const forecast = useDef.base + U.gauss(this.rand) * useDef.sigmaHist * 0.35;
        let actual = forecast + U.gauss(this.rand) * useDef.sigmaHist;
        if (this.rand() < 0.08) actual = forecast + (actual - forecast) * 2.5; // 肥尾意外
        const t = new Date(date);
        t.setUTCHours(Math.floor(slot), Math.round((slot % 1) * 60), 0, 0);
        if (t.getTime() <= date.getTime()) continue; // 不补发已经过去的时点
        this.calendar.push({
          id: 'ev' + this.seed + '-' + t.getTime(),
          time: t.getTime(),
          ccy: useDef.ccy,
          title: useDef.title,
          imp,
          unit: useDef.unit,
          forecast: Math.round(forecast * 100) / 100,
          actual: Math.round(actual * 100) / 100,
          previous: Math.round(useDef.base * 100) / 100,
          sigmaHist: useDef.sigmaHist,
          sigmaEvent: useDef.sigmaEvent,
          inverse: !!useDef.inverse,
          rate: !!useDef.rate,
          fired: false,
        });
      }
      this.calendar.sort((a, b) => a.time - b.time);
      if (this.onCalendar) this.onCalendar(this.calendar);
    }

    /** 应用所有到期事件与随机传闻 */
    _applyDueEvents() {
      const t = this.now.getTime();
      for (const ev of this.calendar) {
        if (!ev.fired && ev.time <= t) {
          ev.fired = true;
          this._fireEvent(ev);
        }
      }
      // 随机传闻
      if (this.newsEnabled) {
        const p = this.newsFreq === 'high' ? 0.012 : this.newsFreq === 'low' ? 0.003 : 0.006;
        if (this.rand() < p * this.mod.newsRate) this._fireRumor();
      }
    }

    _applyCcyShock(ccy, delta, imp) {
      if (!ccy) return;
      const legs = ['EURUSD', 'GBPUSD', 'AUDUSD', 'USDJPY', 'USDCHF', 'USDCAD'];
      for (const id of legs) {
        const p = FX.PAIR_MAP[id];
        let d = 0;
        if (p.base === ccy) d += delta;
        if (p.quote === ccy) d -= delta;
        if (d) this.prices[id] *= Math.exp(d);
      }
      this._syncQuotes(true);
      this.activeShocks.push({ time: this.now.getTime(), imp: imp || 2 });
      if (this.activeShocks.length > 16) this.activeShocks.shift();
    }

    _fireEvent(ev) {
      const z = U.clamp((ev.actual - ev.forecast) / ev.sigmaHist, -4, 4);
      const dir = ev.inverse ? -1 : 1;
      const delta = dir * z * ev.sigmaEvent;
      this._applyCcyShock(ev.ccy, delta, ev.imp);
      const item = {
        time: this.now.getTime(),
        tag: '数据',
        title: ev.title + '公布：实际 ' + ev.actual + ev.unit + '，预期 ' + ev.forecast + ev.unit,
        body: (ev.inverse ? (z >= 0 ? '数据高于预期' : '数据低于预期') : (z >= 0 ? '数据强于预期' : '数据弱于预期'))
          + '，' + ev.ccy + ' 短线上' + (delta >= 0 ? '走强' : '走弱') + '。',
        kind: 'event',
        ccy: ev.ccy,
        imp: ev.imp,
      };
      this.firedEvents.push(ev);
      if (this.onEvent) this.onEvent(ev, delta);
      this._pushNews(item);
    }

    _fireRumor() {
      const r = FX.RUMOR_NEWS[Math.floor(this.rand() * FX.RUMOR_NEWS.length)];
      if (r.ccy && r.dir) {
        const mag = r.mag * (0.4 + this.rand() * 1.2);
        this._applyCcyShock(r.ccy, r.dir * mag, 1);
      }
      this._pushNews({
        time: this.now.getTime(),
        tag: r.tag,
        title: r.title,
        body: '市场消息未经证实，价格出现短线波动。',
        kind: 'rumor',
        imp: 1,
      });
    }

    _pushNews(item) {
      this.news.unshift(item);
      if (this.news.length > 60) this.news.pop();
      if (this.onNews) this.onNews(item);
    }

    /** 周末缺口 */
    _applyWeekendGap() {
      const gap = {};
      for (const c of Object.keys(FX.CURRENCIES)) {
        gap[c] = U.gauss(this.rand) * 0.0018;
      }
      for (const id of ['EURUSD', 'GBPUSD', 'AUDUSD', 'USDJPY', 'USDCHF', 'USDCAD']) {
        const p = FX.PAIR_MAP[id];
        this.prices[id] *= Math.exp(gap[p.base] - gap[p.quote]);
      }
      this._weekendSpread = 2.2;
      this.news.unshift({
        time: this.now.getTime(),
        tag: '周末',
        title: '周末休市结束，周一开盘出现跳空',
        body: '周五收盘至今的新闻已被计入开盘价；止损单可能以远离触发价的价格成交。',
        kind: 'weekend',
        imp: 2,
      });
      if (this.news.length > 60) this.news.pop();
      if (this.onNews) this.onNews(this.news[0]);
      if (this.onWeekend) this.onWeekend();
    }

    /** 推进一个 tick */
    step() {
      const before = this.now.getTime();
      this.minutes += FX.TICK_MINUTES;
      let next = new Date(before + FX.TICK_MINUTES * 60000);
      // 周五 21:00 后休市 → 直接跳到周日 22:00
      const dow = next.getUTCDay();
      const hour = next.getUTCHours();
      const needSkip = (dow === 5 && hour >= 21) || dow === 6 || (dow === 0 && hour < 22);
      if (needSkip) {
        // 周五 21:00 收盘 → 周日 22:00 开盘；周六全天；周日 22:00 前
        const target = new Date(next);
        if (dow === 5) target.setUTCDate(target.getUTCDate() + 2);
        else if (dow === 6) target.setUTCDate(target.getUTCDate() + 1);
        target.setUTCHours(22, 0, 0, 0);
        this.now = target;
        this.minutes = Math.round((target.getTime() - this.startTime) / 60000);
        this._ensureCalendar(target);
        this._applyWeekendGap();
        this._applyDueEvents();
        this._updatePrices(true);
        this._pushBars();
        this._weekendSpread = 1;
        return { skippedWeekend: true };
      }
      const prevDay = U.dateUTC(this.now);
      this.now = next;
      const newDay = U.dateUTC(this.now);
      if (prevDay !== newDay) {
        this.dayCount++;
        this._seedDrift();
        this._ensureCalendar(this.now);
      }
      this._applyDueEvents();
      this._updatePrices(true);
      this._pushBars();
      this._weekendSpread = 1;
      this.tickCount++;
      return { newDay: prevDay !== newDay };
    }

    _pushBars() {
      const tMin = Math.floor(this.now.getTime() / 60000);
      for (const id of this.pairIds) {
        const q = this.quotes[id];
        if (q) this.stores[id].push(tMin, q.mid, 1);
      }
    }

    series(pairId, tf) {
      const s = this.stores[pairId];
      if (!s) return { bars: [], forming: null };
      return s.series(tf);
    }

    sessionLabel() {
      return (this.lastSession || FX.sessionAt(this.now.getUTCHours())).label;
    }

    upcomingEvents(limit) {
      const t = this.now.getTime();
      return this.calendar.filter((e) => !e.fired && e.time > t).slice(0, limit || 5);
    }

    isFinished() {
      // 按交易日计数（周末跳过不计入挑战天数）
      return !!this.endAfterDays && this.dayCount >= this.endAfterDays;
    }

    /** 把当前价格与全部历史 K 线按比例缩放到目标价格（用于存档恢复） */
    scaleTo(target) {
      for (const id of this.pairIds) {
        const t = target && target[id];
        if (!t || !this.prices[id]) continue;
        const f = t / this.prices[id];
        if (!isFinite(f) || f <= 0) continue;
        this.prices[id] *= f;
        this.anchors[id] *= f;
        const st = this.stores[id];
        if (!st) continue;
        for (const tf in st.data) {
          const d = st.data[tf];
          for (const b of d.bars) {
            b.o *= f; b.h *= f; b.l *= f; b.c *= f;
          }
          if (d.cur) {
            d.cur.o *= f; d.cur.h *= f; d.cur.l *= f; d.cur.c *= f;
          }
        }
      }
      this._syncQuotes(true);
    }

    snapshot() {
      return {
        kind: 'sim',
        prices: this.prices,
        now: this.now.getTime(),
        minutes: this.minutes,
        seed: this.seed,
      };
    }

    restore(snap) {
      if (!snap) return;
      Object.assign(this.prices, snap.prices || {});
      if (snap.now) {
        this.now = new Date(snap.now);
        this.startTime = this.now.getTime() - (snap.minutes || 0) * 60000;
      }
      this._syncQuotes(true);
    }
  }

  // =========================================================
  // 历史回放市场
  // =========================================================
  class HistoryMarket {
    /**
     * @param {object} opts {pairId, start, end, eventDays:{date:{low,high}}, seed}
     */
    constructor(opts) {
      this.kind = 'history';
      this.pairId = opts.pairId;
      this.pair = FX.PAIR_MAP[opts.pairId];
      this.seed = opts.seed >>> 0 || 7;
      this.rand = U.rng(this.seed);
      this.start = opts.start;
      this.end = opts.end;
      this.eventDays = opts.eventDays || {};
      this.autoPlay = false;
      this.done = false;
      this.news = [];
      this.calendar = [];
      this._pendingNews = [];   // 事件日结果新闻，收盘后再揭晓
      this.onNews = null;
      this.activeShocks = [];
      this.weekendSkipped = false;
      this.lastSession = FX.sessionAt(8);
      this.quotes = {};
      // 取出区间
      const H = FX.HISTORY;
      const scale = H.scale;
      const idx = [];
      for (let i = 0; i < H.dates.length; i++) {
        const d = H.dates[i];
        if (d >= this.start && d <= this.end) idx.push(i);
      }
      this.rowIdx = idx;
      this.rowIndex = idx[0];
      this.i = 0;
      this.stepI = 0;
      this.dayPath = null;
      this.dayBar = null;
      this.prevClose = null;
      this.bars = [];
      if (!idx.length) {
        this.done = true;
        this.now = new Date(this.start + 'T00:00:00Z');
        return;
      }
      const first = idx[0];
      const close0 = H.pairs[this.pairId][first] / scale;
      // 起始开盘价取前一交易日收盘，保证第一根 K 线有真实实体
      const prevIdx = Math.max(0, first - 1);
      const open0 = H.pairs[this.pairId][prevIdx] / scale;
      this.prevClose = open0;
      this.prices = { [this.pairId]: open0 };
      this.contextBars = this._buildContext(idx[0]);
      this.dayPath = [open0, open0, open0, open0];
      this.now = new Date(this.start + 'T00:00:00Z');
      this._syncQuotes();
      // 起始日：把当日 K 线建好
      this._prepareDay(true);
    }

    /** 起始日之前约 50 个交易日的 K 线，仅用于图表上下文 */
    _buildContext(firstIndex) {
      const H = FX.HISTORY;
      const out = [];
      const from = Math.max(1, firstIndex - 50);
      for (let k = from; k < firstIndex; k++) {
        const close = H.pairs[this.pairId][k] / H.scale;
        const prev = H.pairs[this.pairId][k - 1] / H.scale;
        const rnd = U.rng(U.hash(this.pairId + '|ctx|' + H.dates[k] + '|' + this.seed));
        const move = Math.abs(Math.log(close / prev));
        const r = Math.max(move, this.pair.vol * (0.3 + rnd()));
        const high = Math.max(prev, close) * Math.exp(r * (0.1 + rnd() * 0.4));
        const low = Math.min(prev, close) * Math.exp(-r * (0.1 + rnd() * 0.4));
        out.push({ t: new Date(H.dates[k] + 'T00:00:00Z').getTime() / 60000, o: prev, h: high, l: low, c: close, v: 1 });
      }
      return out;
    }

    _dayClose(index) {
      return FX.HISTORY.pairs[this.pairId][index] / FX.HISTORY.scale;
    }

    _prepareDay(first) {
      if (this.done) return;
      const index = this.rowIdx[this.i];
      this.rowIndex = index;
      const date = FX.HISTORY.dates[index];
      // 事件日允许用公开盘中值覆盖 ECB 定价时点的收盘/开盘
      const ev = this.eventDays[date];
      let close = this._dayClose(index);
      if (ev && ev.close) close = ev.close;
      const prev = this.prevClose != null ? this.prevClose : FX.HISTORY.pairs[this.pairId][this.rowIdx[Math.max(0, this.i - 1)]] / FX.HISTORY.scale;
      const d = new Date(date + 'T00:00:00Z');
      const rnd = U.rng(U.hash(this.pairId + '|' + date + '|' + this.seed));
      const isMonday = d.getDay() === 1;
      const gap = isMonday ? U.gauss(rnd) * (this.pair.vol * 0.35) : 0;
      let open = prev * Math.exp(gap);
      if (first) open = prev;
      if (ev && ev.open) open = ev.open;
      // 波动幅度：真实日涨跌与常态波动取较大者
      const move = Math.abs(Math.log(close / open));
      const base = this.pair.vol;
      const r = Math.max(move * 1.05, base * (0.35 + rnd() * 1.2));
      let high = Math.max(open, close) * Math.exp(r * (0.15 + rnd() * 0.55));
      let low = Math.min(open, close) * Math.exp(-r * (0.15 + rnd() * 0.55));
      if (ev) {
        // 事件日以公有史实极值为准，不再让随机影线突破
        if (ev.high) high = ev.high;
        if (ev.low) low = ev.low;
        // 周一跳空也不能把开盘推到史实区间之外
        if (ev.high) open = Math.min(open, ev.high);
        if (ev.low) open = Math.max(open, ev.low);
      }
      high = Math.max(high, open, close);
      low = Math.min(low, open, close);
      // 盘中路径：开 → 一个极值 → 另一个极值 → 收
      const up = close >= open;
      const path = up ? [open, low, high, close] : [open, high, low, close];
      this.dayPath = path;
      this.stepI = 0;
      this.dayBar = { t: d.getTime() / 60000, o: open, h: open, l: open, c: open, v: 1 };
      this.dayDate = date;
      this.dayCloseVal = close;
      this.now = new Date(d.getTime() + 8 * 3600000);
      this.prices[this.pairId] = open;
      this._syncQuotes();
      this._applyScenarioNews(date);
    }

    _applyScenarioNews(date) {
      if (!this._scenario) return;
      for (const n of this._scenario.news || []) {
        if (n.date === date && !n._fired) {
          n._fired = true;
          const item = {
            time: this.now.getTime(),
            tag: n.tag || '快讯',
            title: n.title,
            body: n.body,
            kind: 'scenario',
            imp: n.imp || 2,
          };
          // 事件日的结果类新闻收盘后再揭晓，避免“看完答案再下单”
          if (this.eventDays[date]) this._pendingNews.push(item);
          else this._publishNews(item);
          this.activeShocks.push({ time: this.now.getTime(), imp: item.imp });
        }
      }
    }

    _publishNews(item) {
      this.news.unshift(item);
      if (this.news.length > 80) this.news.pop();
      if (this.onNews) this.onNews(item);
    }

    _flushPendingNews() {
      if (!this._pendingNews.length) return;
      const now = this.now.getTime();
      for (const item of this._pendingNews) {
        item.time = now;
        this._publishNews(item);
      }
      this._pendingNews = [];
    }

    setScenario(scenario) {
      // 深拷贝新闻，避免 _fired 写回全局剧本对象（重开战役会永久丢新闻）
      this._scenario = scenario
        ? Object.assign({}, scenario, { news: (scenario.news || []).map((n) => Object.assign({}, n)) })
        : scenario;
      if (scenario) this.calendar = this._scenario.news.slice();
    }

    /** 推进一个子步骤（一天 4 步） */
    step() {
      if (this.done) return { done: true };
      if (!this.dayPath) this._prepareDay(this.i === 0);
      this.stepI++;
      const price = this.dayPath[Math.min(this.stepI, 3)];
      this.prices[this.pairId] = price;
      this._syncQuotes();
      const bar = this.dayBar;
      bar.h = Math.max(bar.h, price);
      bar.l = Math.min(bar.l, price);
      bar.c = price;
      bar.v++;
      const h = 6 + this.stepI * 5;
      this.now = new Date(new Date(this.dayDate + 'T00:00:00Z').getTime() + h * 3600000);
      // 事件日模拟点差扩张
      if (this.activeShocks.length) {
        this.activeShocks = this.activeShocks.filter((s) => this.now.getTime() - s.time < 3 * 3600000);
      }
      if (this.stepI >= 3) {
        // 完成一天
        this.bars.push(bar);
        this._flushPendingNews();
        this.prevClose = this.dayCloseVal;
        this.i++;
        this.stepI = 0;
        this.dayPath = null;
        if (this.i >= this.rowIdx.length) {
          this.done = true;
          return { dayDone: true, done: true };
        }
        return { dayDone: true };
      }
      return { dayDone: false };
    }

    _syncQuotes() {
      const p = this.pair;
      let mult = 1;
      const hour = this.now.getUTCHours();
      const sess = FX.sessionAt(hour);
      mult *= sess.spread;
      if (this.activeShocks.length) mult *= 3;
      const H = FX.HISTORY;
      // 其他货币对按当日收盘价提供参考报价，仅用于换算与展示，不可交易
      for (const other of FX.PAIRS) {
        if (other.id === this.pairId) continue;
        if (!H.pairs[other.id] || this.rowIndex == null) continue;
        const mid = H.pairs[other.id][this.rowIndex] / H.scale;
        const spr = Math.max(0.3, other.spread * mult);
        const half = (spr * other.pip) / 2;
        this.quotes[other.id] = { mid, bid: mid - half, ask: mid + half, spreadPips: spr };
      }
      const spr = Math.max(0.3, p.spread * mult);
      const mid = this.prices[this.pairId];
      const half = (spr * p.pip) / 2;
      this.quotes[this.pairId] = { mid, bid: mid - half, ask: mid + half, spreadPips: spr };
      this.lastSession = sess;
    }

    series(pairId, tf) {
      if (pairId !== this.pairId) return { bars: [], forming: null };
      if (tf === '1d') {
        return { bars: this.contextBars.concat(this.bars), forming: this.done ? null : this.dayBar };
      }
      // 周/月聚合
      const keyFn = tf === '1w' ? (t) => weekKey(t) : (t) => monthKey(t);
      const src = this.contextBars.concat(this.bars, this.done || !this.dayBar ? [] : [this.dayBar]);
      const out = [];
      let cur = null;
      let curKey = null;
      for (const b of src) {
        const k = keyFn(b.t);
        if (!cur) {
          cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 1 };
          curKey = k;
        } else if (k === curKey) {
          cur.h = Math.max(cur.h, b.h);
          cur.l = Math.min(cur.l, b.l);
          cur.c = b.c;
          cur.v += b.v || 1;
        } else {
          out.push(cur);
          cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 1 };
          curKey = k;
        }
      }
      if (cur) out.push(cur);
      return { bars: out.slice(0, -1), forming: out.length ? out[out.length - 1] : null };
    }

    sessionLabel() {
      return this.lastSession.label;
    }

    upcomingEvents(limit) {
      if (!this._scenario) return [];
      return (this._scenario.news || [])
        .filter((n) => !n._fired)
        .slice(0, limit || 5)
        .map((n) => ({ title: n.title, time: U.parseISO(n.date).getTime(), ccy: this.pair.base, imp: n.imp || 2 }));
    }

    isFinished() {
      return this.done;
    }

    progress() {
      return { i: this.i, total: this.rowIdx.length, date: this.dayDate };
    }

    snapshot() {
      return {
        kind: 'history',
        pairId: this.pairId,
        start: this.start,
        end: this.end,
        i: this.i,
        stepI: this.stepI,
        prevClose: this.prevClose,
        now: this.now.getTime(),
        bars: this.bars.slice(-400),
        dayDate: this.dayDate,
        dayPath: this.dayPath,
        news: this.news.slice(0, 20),
      };
    }
  }

  function weekKey(tMin) {
    const d = new Date(tMin * 60000);
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day);
    return d.toISOString().slice(0, 10);
  }
  function monthKey(tMin) {
    return new Date(tMin * 60000).toISOString().slice(0, 7);
  }

  FX.SimMarket = SimMarket;
  FX.HistoryMarket = HistoryMarket;
})();
