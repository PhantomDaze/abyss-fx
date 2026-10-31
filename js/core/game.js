/* 游戏主控：模式、时钟、账户、存档、挑战、战役、成就 */
(function () {
  'use strict';
  const FX = (window.FX = window.FX || {});
  const U = FX.U;

  const DEFAULT_SETTINGS = {
    theme: 'day',
    updown: 'cn',
    sound: true,
    news: true,
    freq: 'mid',
    nbp: true,
    levWarn: true,
    speed: 1,
  };

  const CHALLENGE_MODS = [
    { id: 'high-vol', name: '高波动日', desc: '波动 ×1.6，点差 ×1.2。回撤扣分 ×1.4。', mod: { volMult: 1.6, spreadMult: 1.2 }, ddCoef: 84, bonus: 0 },
    { id: 'range', name: '窄幅震荡', desc: '波动 ×0.55，点差 ×0.8。每笔盈利额外 +5 分。', mod: { volMult: 0.55, spreadMult: 0.8, winBonus: 5 }, ddCoef: 60, bonus: 0 },
    { id: 'data-week', name: '数据周', desc: '每天 2 条数据，公布后波动放大。事件命中 +30 分/次。', mod: { volMult: 1.1, spreadMult: 1.0, newsRate: 1.4 }, ddCoef: 60, bonus: 0 },
    { id: 'cb-day', name: '央行日', desc: '波动与点差略增。事件命中 +60 分/次。', mod: { volMult: 1.15, spreadMult: 1.1, eventScore: 60 }, ddCoef: 60, bonus: 0 },
    { id: 'dry', name: '流动性干旱', desc: '点差 ×2.5，滑点 ×3。收益系数 ×1.2。', mod: { volMult: 0.9, spreadMult: 2.5, slipMult: 3 }, ddCoef: 60, bonus: 0, retCoef: 1.2 },
    { id: 'trend', name: '单边趋势', desc: '强 drift，逆势持仓风险更高。', mod: { volMult: 1.0, spreadMult: 1.0, drift: 0.0025 }, ddCoef: 60, bonus: 0 },
    { id: 'risk-off', name: '风险厌恶', desc: '无词条加成，回撤扣分更重。', mod: { volMult: 1.1, spreadMult: 1.0 }, ddCoef: 90, bonus: 0 },
    { id: 'reversal', name: '反转日', desc: '每 2 天切换一次趋势方向，追单容易被反打。', mod: { volMult: 1.15, spreadMult: 1.0, reversal: 1 }, ddCoef: 60, bonus: 0 },
  ];

  class Game {
    constructor() {
      this.bus = new FX.Bus();
      this.settings = Object.assign({}, DEFAULT_SETTINGS, U.store.get('settings', {}));
      this.profile = Object.assign(
        { battles: {}, dailyStreak: 0, lastDaily: '', totalTrades: 0, totalLiquidations: 0 },
        U.store.get('profile', {})
      );
      this.achData = U.store.get('achievements', { unlocked: {} });
      if (!this.achData.unlocked) this.achData.unlocked = {};
      this.flags = U.store.get('flags', {}) || {};
      this.mode = 'sim';
      this.selectedPair = 'EURUSD';
      this.tf = '15m';
      this.speed = this.settings.speed || 1;
      // 小数倍速的步进累加器（0.25× 时每 4 轮走 1 步）
      this._speedAcc = 0;
      this.autoPlay = false;
      this.account = null;
      this.market = null;
      this.challenge = null;
      this.scenario = null;
      this.startBalance = 10000;
      this.dayCount = 0;
      this.eventMark = null;
      this.eventScore = 0;
      this.eventHits = 0;
      this.challengeHitSet = new Set();
      this.longAbove150 = 0;
      this.recentHigh = null;
      this.running = true;
      this.newsQueue = [];
      this._lastSwapKey = '';
      this._lastClockHour = -1;
      this._prevDayKey = '';
      this._timer = null;
      this._autoTimer = null;
      this._saveTimer = null;
      this._histBusy = false;
      this._lastEventDay = '';
      this._eventDayStart = null;
      this._achievementCooldown = 0;
    }

    // ---------- 生命周期 ----------
    init() {
      this.applySettings();
      // 尝试恢复上次模式
      const simSave = U.store.get('sim', null);
      const sess = U.store.get('session', null);
      if (sess && sess.mode === 'battle' && sess.battle) {
        this.startBattle(sess.battle.id, sess.battle);
      } else if (sess && sess.mode === 'challenge' && sess.challenge && sess.challenge.dayKey === this.dailyKey()) {
        this._restoreChallenge(sess.challenge);
      } else {
        this._createSim(!!simSave);
      }
      this.bus.emit('mode', this.mode);
      this.bus.emit('tick');
      this._timer = setInterval(() => this._loop(), 100);
      this._saveTimer = setInterval(() => this.save(), 4000);
      window.addEventListener('beforeunload', () => this.save());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.save();
      });
      this._checkAchievements({ type: 'tick' });
    }

    applySettings() {
      const s = this.settings;
      document.documentElement.setAttribute('data-theme', s.theme);
      document.documentElement.setAttribute('data-updown', s.updown);
      if (FX.Audio) FX.Audio.setEnabled(s.sound);
      if (this.account) this.account.nbp = s.nbp;
    }

    setSetting(key, value) {
      this.settings[key] = value;
      U.store.set('settings', this.settings);
      this.applySettings();
      // 切倍速时清掉累加器，避免旧的余数带进新速度
      if (key === 'speed') this._speedAcc = 0;
      if (this.market) {
        if (key === 'news') this.market.newsEnabled = !!value;
        if (key === 'freq') this.market.newsFreq = value;
      }
      this.bus.emit('settings');
    }

    _loop() {
      if (!this.running) return;
      if (this.mode === 'sim' || this.mode === 'challenge') {
        // 速度可以是小数（0.25× / 0.5×）：累加后按整数步执行，余数留到下一轮
        this._speedAcc += this.speed;
        let ran = 0;
        while (this._speedAcc >= 1) {
          this._speedAcc -= 1;
          this._simStep();
          ran++;
          if (this.mode === 'challenge' && this.market && this.market.isFinished()) {
            this.finishChallenge(false);
            break;
          }
        }
        if (ran > 0) this.bus.emit('tick');
      }
    }

    _simStep() {
      if (!this.market) return;
      const res = this.market.step();
      const now = this.market.now;
      // 隔夜利息：每天 21:00 UTC 换日
      const dk = U.dateUTC(now);
      const hour = now.getUTCHours();
      // 周末跳转本身不计息（周五 21:00 已结算，周日开盘不再重复）
      if (hour >= 21 && !res.skippedWeekend && this._lastSwapKey !== dk) {
        this._lastSwapKey = dk;
        const swap = this.account.applySwap(now.getUTCDay(), now.getTime());
        if (swap) {
          this.bus.emit('swap', swap);
          this.toast(swap > 0 ? `隔夜利息 +${U.money(swap)}` : `隔夜利息 ${U.money(swap)}`, swap > 0 ? 'ok' : 'warn');
        }
      }
      if (res.newDay || res.skippedWeekend) {
        this.dayCount++;
        this._prevDayKey = dk;
      }
      this.account.update(this.market.quotes, now.getTime());
      this._maybeCheckAchievements();
    }

    _maybeCheckAchievements() {
      const now = Date.now();
      if (now - (this._achCheckAt || 0) < 900) return;
      this._achCheckAt = now;
      this._checkAchievements({ type: 'tick' });
    }

    // ---------- 模式 ----------
    _createSim(restore) {
      this.autoPlay = false;
      this._stopAuto();
      const saved = restore ? U.store.get('sim', null) : null;
      const startTime = Date.UTC(2026, 10, 2, 6, 0, 0);
      const opts = {
        seed: U.hash('sim-' + (saved ? saved.seed : Date.now())),
        startTime,
        newsEnabled: this.settings.news,
        newsFreq: this.settings.freq,
        backfillTicks: 864,
      };
      this.market = new FX.SimMarket(opts);
      this.mode = 'sim';
      this.scenario = null;
      this.challenge = null;
      this.account = new FX.Account({ balance: 10000, leverage: 100, nbp: this.settings.nbp, maxPositions: 12, maxLots: 10 });
      this._bindMarket();
      this._bindAccount();
      this.startBalance = 10000;
      this.dayCount = 0;
      this.selectedPair = (saved && saved.selectedPair) || 'EURUSD';
      this.tf = (saved && saved.tf) || '15m';
      this._lastSwapKey = '';
      if (saved) {
        if (saved.account) this.account.restore(saved.account);
        if (saved.quotes) {
          if (saved.prices) this.market.scaleTo(saved.prices);
          for (const id in saved.quotes) if (this.market.quotes[id]) this.market.quotes[id] = saved.quotes[id];
          for (const id in saved.prices || {}) this.market.prices[id] = saved.prices[id];
          if (saved.now) {
            this.market.now = new Date(saved.now);
            this.market._ensureCalendar(this.market.now);
          }
          this.market._syncQuotes(true);
        }
        this.dayCount = saved.dayCount || 0;
        if (Array.isArray(saved.calendar)) {
          this.market.calendar = saved.calendar;
          this.market.dayEventsGenerated = U.dateUTC(this.market.now);
        }
        this._lastSwapKey = saved.lastSwapKey || (this.market.now.getUTCHours() >= 21 ? U.dateUTC(this.market.now) : '');
      }
      this.speed = this.settings.speed || 1;
      this._speedAcc = 0;
      this.account.update(this.market.quotes, this.market.now.getTime());
    }

    _bindMarket() {
      const m = this.market;
      m.onNews = (item) => {
        this.bus.emit('news', item);
        if (item.kind === 'event') {
          this._checkAchievements({ type: 'news', payload: item });
        }
      };
      m.onCalendar = () => this.bus.emit('calendar');
      m.onWeekend = () => {
        this.toast('周末休市结束：开盘出现跳空，止损可能被滑穿。', 'warn');
        this.bus.emit('weekend');
      };
      m.onEvent = (ev, delta) => this._onMarketEvent(ev, delta);
    }

    /** 绑定账户事件：音效、提示、成就、强平叙事 */
    _bindAccount() {
      const acc = this.account;
      if (!acc) return;
      acc.events.on('open', (pos) => {
        if (this.scenario && this.scenario.objectives &&
            this.scenario.objectives.eventRule === 'no-long-above-150' &&
            pos.side > 0 && pos.entry > 150) {
          this.longAbove150++;
          this.toast('战役规则：150 上方新开多，将判定违规。', 'warn');
        }
        this.bus.emit('accountEvent', { type: 'open', position: pos });
        this._checkAchievements({ type: 'open', payload: { position: pos, recentHigh: this.recentHigh } });
      });
      acc.events.on('close', ({ position, record, reason }) => {
        this.bus.emit('accountEvent', { type: 'close', position, record, reason });
        this._checkAchievements({ type: 'close', payload: { position, record, reason } });
        if (reason === 'sl') this.toast('止损触发，亏损已锁定。', 'warn');
        if (reason === 'tp') this.toast('止盈触发。', 'ok');
      });
      acc.events.on('stopout', (payload) => {
        this.toast('保证金不足，仓位已被强制平仓。', 'bad');
        if (FX.Audio) FX.Audio.liquidate();
        this.bus.emit('stopout', payload);
        this._checkAchievements({ type: 'stopout', payload });
      });
      acc.events.on('marginCall', (m) => {
        this.toast('保证金水平低于 100%，请减仓或重置账户。', 'warn');
        if (FX.Audio) FX.Audio.alert();
        this.bus.emit('marginCall', m);
        this._checkAchievements({ type: 'marginCall', payload: m });
      });
      acc.events.on('nbp', (p) => {
        this.toast(`负余额保护吸收了 ${U.money(p.absorbed)}。`, 'warn');
        this.bus.emit('nbp', p);
        this._checkAchievements({ type: 'nbp', payload: p });
      });
      acc.events.on('bankrupt', (p) => {
        this.toast('账户穿仓：负债已记录，交易停止。', 'bad');
        this.bus.emit('bankrupt', p);
        this._checkAchievements({ type: 'bankrupt', payload: p });
      });
      acc.events.on('orderFill', (p) => {
        this.toast('挂单触发成交', 'ok');
        this.bus.emit('accountEvent', { type: 'orderFill', ...p });
        this._checkAchievements({ type: 'orderFill', payload: p });
      });
      acc.events.on('orderRejected', (p) => {
        this.toast(`挂单触发失败：${p.error}`, 'bad');
      });
      acc.events.on('orderCancel', (o) => this.bus.emit('accountEvent', { type: 'orderCancel', order: o }));
    }

    _onMarketEvent(ev, delta) {
      if (this.mode !== 'challenge') return;
      for (const pos of this.account.positions) {
        const p = FX.PAIR_MAP[pos.pairId];
        let dir = 0;
        if (p.base === ev.ccy) dir += delta;
        if (p.quote === ev.ccy) dir -= delta;
        if (Math.abs(dir) < 1e-9) continue;
        if (Math.sign(dir) === Math.sign(pos.side)) {
          const key = ev.id || ev.title;
          if (!this.challengeHitSet.has(key)) {
            this.challengeHitSet.add(key);
            this.eventHits++;
            this.toast('事件方向命中 +1', 'ok');
          }
        }
      }
    }

    activateMode(mode, opts) {
      if (mode === this.mode && opts && !opts.force) return;
      this.save();
      if (mode === 'sim') {
        this._createSim(true);
        this.bus.emit('mode', mode);
        this.bus.emit('tick');
        this.toast('已进入模拟行情', 'info');
      }
    }

    // ---------- 历史回放 ----------
    startHistory(cfg) {
      const pairId = cfg.pairId || this.selectedPair;
      const p = FX.PAIR_MAP[pairId];
      const H = FX.HISTORY;
      let start = cfg.start;
      let end = cfg.end;
      if (!start || !end) {
        const dates = H.dates.filter((d) => d <= U.dateISO(new Date()));
        end = dates[dates.length - 1];
        start = dates[Math.max(0, dates.length - 366)];
      }
      this.save();
      this.running = true;
      this.mode = 'history';
      this.scenario = null;
      this.challenge = null;
      this.selectedPair = pairId;
      this.tf = '1d';
      this.autoPlay = false;
      this.market = new FX.HistoryMarket({ pairId, start, end, seed: U.hash(pairId + start + end) });
      this.account = new FX.Account({ balance: 10000, leverage: 100, nbp: this.settings.nbp, maxPositions: 6, maxLots: 5 });
      this._bindMarket();
      this._bindAccount();
      this.startBalance = 10000;
      this.dayCount = 0;
      this._lastSwapKey = '';
      this._lastEventDay = '';
      this.account.update(this.market.quotes, this.market.now.getTime());
      this.bus.emit('mode', this.mode);
      this.bus.emit('tick');
      this.toast(`历史回放：${p.display} ${start} → ${end}`, 'info');
    }

    // ---------- 战役 ----------
    startBattle(id, restore) {
      this.autoPlay = false;
      this._stopAuto();
      const sc = (FX.SCENARIOS || []).find((s) => s.id === id);
      if (!sc) return;
      if (!restore) this.save();
      this.running = true;
      this.mode = 'battle';
      this.scenario = sc;
      this.challenge = null;
      this.selectedPair = sc.pair;
      this.tf = '1d';
      this.autoPlay = false;
      this.market = new FX.HistoryMarket({
        pairId: sc.pair, start: sc.start, end: sc.end,
        seed: U.hash(sc.id), eventDays: sc.eventDays || {},
      });
      this.market.setScenario(sc);
      this.account = new FX.Account({
        balance: 10000, leverage: 20, leverageOptions: [20],
        nbp: this.settings.nbp, maxPositions: 5, maxLots: 5,
      });
      this._bindMarket();
      this._bindAccount();
      this.startBalance = 10000;
      this.dayCount = 0;
      this.eventMark = null;
      this.eventScore = 0;
      this.eventHits = 0;
      this.longAbove150 = 0;
      this._eventDayStart = null;
      this._lastSwapKey = '';
      this._lastEventDay = '';
      if (restore) {
        // 快速回放至上次进度（不触发账户与提示）
        const m = this.market;
        const savedNews = m.onNews;
        m.onNews = null;
        // HistoryMarket 每天 3 个子步；恢复到存档时的子步位置
        const steps = (restore.i || 0) * 3 + (restore.stepI || 0);
        for (let k = 0; k < steps && !m.done; k++) m.step();
        m.onNews = savedNews;
        if (restore.account) this.account.restore(restore.account);
        this.dayCount = restore.dayCount || 0;
        this.eventScore = restore.eventScore || 0;
        this.longAbove150 = restore.longAbove150 || 0;
        this._eventDayStart = restore.eventDayStart || null;
        this.autoPlay = false;
      }
      this.account.update(this.market.quotes, this.market.now.getTime());
      this.bus.emit('mode', this.mode);
      this.bus.emit('tick');
      if (!restore) this.toast(`战役开始：${sc.title}`, 'info');
      this.save();
    }

    // ---------- 每日挑战 ----------
    dailyKey() {
      return U.dateISO(new Date());
    }

    challengeMeta() {
      const key = this.dailyKey();
      let meta = U.store.get('daily-meta', null);
      if (!meta || meta.dayKey !== key) {
        meta = { dayKey: key, attempts: 3, best: null, rows: [] };
      }
      // 每天 3 次，保留当日
      return meta;
    }

    challengeModifier() {
      const key = this.dailyKey();
      const idx = U.hash('mod:' + key) % CHALLENGE_MODS.length;
      return CHALLENGE_MODS[idx];
    }

    startChallenge() {
      this.autoPlay = false;
      this._stopAuto();
      const meta = this.challengeMeta();
      if (meta.attempts <= 0) {
        this.toast('今天的 3 次机会已经用完，明天再来。', 'warn');
        return false;
      }
      const key = this.dailyKey();
      const mod = this.challengeModifier();
      this.save();
      this.running = true;
      this.mode = 'challenge';
      this.scenario = null;
      this.challenge = { dayKey: key, modifier: mod, dayCount: 0, startedAt: Date.now(), attempts: meta.attempts };
      meta.attempts--;
      U.store.set('daily-meta', meta);
      // 连续参加
      const yesterday = U.dateISO(U.addDays(new Date(), -1));
      if (this.profile.lastDaily !== key) {
        this.profile.dailyStreak = this.profile.lastDaily === yesterday ? (this.profile.dailyStreak || 0) + 1 : 1;
        this.profile.lastDaily = key;
        U.store.set('profile', this.profile);
      }
      this.market = new FX.SimMarket({
        seed: U.hash('kurumi:' + key + ':' + mod.id),
        startTime: Date.UTC(2026, 10, 2, 6, 0, 0),
        endAfterDays: 10,
        modifier: mod.mod,
        fixedLeverage: 30,
        newsEnabled: true,
        newsFreq: 'mid',
        backfillTicks: 576,
        pairs: FX.PAIRS.map((p) => p.id),
      });
      this.account = new FX.Account({ balance: 10000, leverage: 30, leverageOptions: [30], nbp: this.settings.nbp, maxPositions: 3, maxLots: 5 });
      // 词条可放大止损/强平滑点
      this.account.slippagePips = 0.08 * (mod.mod.slipMult || 1);
      this._bindMarket();
      this._bindAccount();
      this.selectedPair = 'EURUSD';
      this.tf = '15m';
      this.startBalance = 10000;
      this.dayCount = 0;
      this.challengeHitSet = new Set();
      this.eventHits = 0;
      this._lastSwapKey = '';
      this.account.update(this.market.quotes, this.market.now.getTime());
      this.bus.emit('mode', this.mode);
      this.bus.emit('tick');
      this.toast(`挑战开始：${mod.name}`, 'info');
      this.save();
      return true;
    }

    _restoreChallenge(s) {
      this.autoPlay = false;
      this._stopAuto();
      const mod = CHALLENGE_MODS.find((m) => m.id === s.modId) || CHALLENGE_MODS[0];
      this.mode = 'challenge';
      this.scenario = null;
      this.challenge = { dayKey: s.dayKey, modifier: mod, dayCount: s.dayCount || 0, startedAt: s.startedAt || Date.now() };
      this.market = new FX.SimMarket({
        seed: s.seed,
        startTime: s.startTime || Date.UTC(2026, 10, 2, 6, 0, 0),
        endAfterDays: 10,
        modifier: mod.mod,
        fixedLeverage: 30,
        newsEnabled: true,
        newsFreq: 'mid',
        backfillTicks: 576,
        pairs: FX.PAIRS.map((p) => p.id),
      });
      if (s.prices) {
        this.market.scaleTo(s.prices);
        Object.assign(this.market.prices, s.prices);
      }
      if (s.now) this.market.now = new Date(s.now);
      this.market.dayCount = s.marketDayCount != null ? s.marketDayCount : (s.dayCount || 0);
      this.market._syncQuotes(true);
      if (Array.isArray(s.calendar)) {
        this.market.calendar = s.calendar;
        this.market.dayEventsGenerated = U.dateUTC(this.market.now);
      }
      this.account = new FX.Account({ balance: 10000, leverage: 30, leverageOptions: [30], nbp: this.settings.nbp, maxPositions: 3, maxLots: 5 });
      // 词条可放大止损/强平滑点
      this.account.slippagePips = 0.08 * (mod.mod.slipMult || 1);
      if (s.account) this.account.restore(s.account);
      this._bindMarket();
      this._bindAccount();
      this.selectedPair = 'EURUSD';
      this.tf = '15m';
      this.startBalance = 10000;
      this.dayCount = s.dayCount || 0;
      this.eventHits = s.eventHits || 0;
      this.challengeHitSet = new Set(s.challengeHits || []);
      this._lastSwapKey = s.lastSwapKey || (this.market.now.getUTCHours() >= 21 ? U.dateUTC(this.market.now) : '');
      this.running = true;
      this.account.update(this.market.quotes, this.market.now.getTime());
      this.bus.emit('mode', this.mode);
      this.bus.emit('tick');
    }

    finishChallenge(retire) {
      if (this.mode !== 'challenge' || !this.challenge || this.challenge.finished) return;
      const m = this.account.metrics();
      // 结算所有持仓
      if (this.account.positions.length) this.account.closeAll('settle');
      const equity = this.account.balance;
      const retPct = ((equity - this.startBalance) / this.startBalance) * 100;
      const dd = this.account.stats.maxDrawdown;
      const trades = this.account.stats.trades;
      const mod = this.challenge.modifier;
      const hitPer = mod.eventScore != null ? mod.eventScore : 30;
      const winBonus = (mod.winBonus || 0) * (this.account.stats.wins || 0);
      const retCoef = mod.retCoef || 1;
      let score = 100 * retPct * retCoef - mod.ddCoef * dd + hitPer * this.eventHits - trades;
      // 存活奖励：至少交易过一笔且未爆仓
      if (trades > 0 && !this.account.stats.liquidations) score += 20;
      score += (mod.bonus || 0) + winBonus;
      score = Math.round(score);
      const meta = this.challengeMeta();
      if (meta.best == null || score > meta.best.score) {
        meta.best = { score, equity, dd, trades, hits: this.eventHits, ts: Date.now() };
      }
      meta.rows = (meta.rows || []).concat([{ name: '我', score, equity, dd, trades, hits: this.eventHits, ts: Date.now() }])
        .sort((a, b) => b.score - a.score).slice(0, 10);
      U.store.set('daily-meta', meta);
      this.profile.totalTrades += trades;
      this.profile.totalLiquidations += this.account.stats.liquidations;
      U.store.set('profile', this.profile);
      this._checkAchievements({ type: 'settle', payload: { score, equity, modifier: mod } });
      this.challenge.finished = true;
      this.running = false;
      this.bus.emit('settle', {
        kind: 'challenge',
        score, equity, retPct, dd, trades, hits: this.eventHits,
        modifier: mod, retire: !!retire,
        liquidated: this.account.stats.liquidations > 0,
        best: meta.best,
        rows: meta.rows,
      });
    }

    // ---------- 交易 ----------
    trade(side, params) {
      if (!this.market || !this.account) return;
      if (!this.running) { this.toast('本局已结束，请重置或切换模式。', 'warn'); return; }
      const pairId = this.selectedPair;
      const p = FX.PAIR_MAP[pairId];
      const q = this.market.quotes[pairId];
      if (!q) {
        this.toast('该货币对暂不可交易', 'warn');
        return;
      }
      const lots = U.num(params.lots, 0.1);
      const slPips = U.num(params.slPips, 0);
      const tpPips = U.num(params.tpPips, 0);
      const trail = U.num(params.trailPips, 0);
      const entry = side > 0 ? q.ask : q.bid;
      // 追高检测
      const bars = this.market.series(pairId, this.tf).bars;
      if (bars && bars.length) {
        const recent = bars.slice(-40);
        this.recentHigh = Math.max(...recent.map((b) => b.h));
      }
      let res;
      if (params.orderType === 'limit' || params.orderType === 'stop') {
        let price = U.num(params.triggerPrice, 0);
        const off = 20 * p.pip;
        let corrected = false;
        // 触发价缺失、仍在现价附近，或落在可立即成交的一侧：自动放到合理的一侧
        if (!price || Math.abs(price - q.mid) < p.pip * 0.5) {
          price = params.orderType === 'limit'
            ? (side > 0 ? q.ask - off : q.bid + off)
            : (side > 0 ? q.ask + off : q.bid - off);
          corrected = true;
        } else if (params.orderType === 'limit') {
          if (side > 0 && price >= q.ask) { price = q.ask - off; corrected = true; }
          if (side < 0 && price <= q.bid) { price = q.bid + off; corrected = true; }
        } else {
          if (side > 0 && price <= q.ask) { price = q.ask + off; corrected = true; }
          if (side < 0 && price >= q.bid) { price = q.bid - off; corrected = true; }
        }
        if (corrected) this.toast('挂单价已放到现价一侧：' + U.price(price, p.digits), 'info');
        // 止损/止盈以最终触发价锚定，自动修正后也不会错位
        res = this.account.placeOrder({
          pairId, side, lots, type: params.orderType, price,
          sl: slPips > 0 ? price - side * slPips * p.pip : null,
          tp: tpPips > 0 ? price + side * tpPips * p.pip : null,
          trailPips: trail, expiryDays: 7, now: this.market.now.getTime(),
        });
      } else {
        res = this.account.openMarket({
          pairId, side, lots,
          sl: slPips > 0 ? entry - side * slPips * p.pip : null,
          tp: tpPips > 0 ? entry + side * tpPips * p.pip : null,
          trailPips: trail, now: this.market.now.getTime(),
        });
      }
      if (!res.ok) {
        this.toast(res.error, 'bad');
        if (FX.Audio) FX.Audio.error();
        return;
      }
      if (FX.Audio) FX.Audio.open(side);
      this.toast(params.orderType && params.orderType !== 'market' ? '挂单已提交' : side > 0 ? '买入成交' : '卖出成交', 'ok');
      this._checkAchievements({ type: res.order ? 'orderFill' : 'open', payload: { position: res.position, order: res.order, recentHigh: this.recentHigh } });
      this.save();
      this.bus.emit('tick');
    }

    closePosition(id) {
      const pos = this.account.positions.find((p) => p.id === id);
      if (!pos) return;
      const pnl = this.account.posPnl(pos);
      this.account.close(id, null, 'manual');
      if (FX.Audio) FX.Audio.close(pnl >= 0);
      this.toast(`已平仓 ${FX.PAIR_MAP[pos.pairId].display} ${pnl >= 0 ? '+' : ''}${U.money(pnl)}`, pnl >= 0 ? 'ok' : 'bad');
      this.save();
      this.bus.emit('tick');
    }

    closePositionPartial(id, lots) {
      const pos = this.account.positions.find((p) => p.id === id);
      if (!pos) return;
      const pnl = this.account.posPnl(pos) * (lots / pos.lots);
      this.account.close(id, lots, 'manual');
      if (FX.Audio) FX.Audio.close(pnl >= 0);
      this.toast(`部分平仓 ${U.lots(lots)}，${pnl >= 0 ? '+' : ''}${U.money(pnl)}`, pnl >= 0 ? 'ok' : 'bad');
      this.save();
      this.bus.emit('tick');
    }

    closeAll() {
      if (!this.account.positions.length) {
        this.toast('没有持仓。市场不会因为你观望而扣钱。', 'info');
        return;
      }
      const total = this.account.metrics().floating;
      this.account.closeAll('manual');
      if (FX.Audio) FX.Audio.close(total >= 0);
      this.toast(`已全部平仓，合计 ${total >= 0 ? '+' : ''}${U.money(total)}`, total >= 0 ? 'ok' : 'bad');
      this.save();
      this.bus.emit('tick');
    }

    cancelOrder(id) {
      if (this.account.cancelOrder(id)) {
        this.toast('挂单已取消', 'info');
        this.bus.emit('tick');
      }
    }

    modifyPosition(id, patch) {
      this.account.modify(id, patch);
      this.toast('已修改止损/止盈', 'info');
      this.bus.emit('tick');
      this.save();
    }

    setLeverage(n) {
      if (!this.account) return;
      const opts = this.account.leverageOptions || [30, 100, 200, 500];
      n = opts.includes(n) ? n : opts[0];
      this.account.leverage = n;
      if (n >= 200 && this.settings.levWarn && !this.flags.levWarned) {
        this.flags.levWarned = true;
        U.store.set('flags', this.flags);
        this.toast('1:200 以上杠杆只需很小的反向波动就会爆仓。', 'warn');
      }
      this.bus.emit('tick');
      this.save();
    }

    // ---------- 历史/战役推进 ----------
    nextDay() {
      if (this.mode !== 'history' && this.mode !== 'battle') return;
      if (this._histBusy) return;
      this._histBusy = true;
      let guard = 0;
      const startI = this.market ? this.market.i : 0;
      const run = () => {
        guard++;
        if (!this.market || this.market.done || this.market.i > startI || guard > 8) {
          this._histBusy = false;
          this.bus.emit('tick');
          return;
        }
        this._historyStep();
        setTimeout(run, 70);
      };
      run();
    }

    _historyStep() {
      if (!this.market || this.market.done) return;
      // 新的一天先落盘，事件日快照才能取到开盘前的仓位
      if (!this.market.dayPath) this.market._prepareDay(this.market.i === 0);
      const dayBefore = this.market.dayDate || '';
      // 事件日开始前记录仓位与权益
      if (
        this.mode === 'battle' && this.scenario && dayBefore === this.scenario.event &&
        this.market.stepI === 0 && !this._eventDayStart
      ) {
        const m = this.account.metrics();
        this._eventDayStart = {
          equity: m.equity, used: m.used,
          sides: this.account.positions.map((p) => p.side),
          date: dayBefore,
        };
      }
      const res = this.market.step();
      const now = this.market.now;
      this.account.update(this.market.quotes, now.getTime());
      if (res.dayDone) {
        this.dayCount++;
        const completed = dayBefore || U.dateISO(now);
        // 隔夜利息按日结算（周三三倍）
        const swap = this.account.applySwap(U.parseISO(completed).getDay(), now.getTime());
        if (swap) this.bus.emit('swap', swap);
        if (this.mode === 'battle' && this.scenario && completed === this.scenario.event) {
          this._evalBattleEvent();
        }
        this._checkAchievements({ type: 'day', payload: { date: completed } });
        this._maybeCheckAchievements();
      }
      if (this.market.done) {
        this.autoPlay = false;
        this._stopAuto();
        if (this.mode === 'battle') this._settleBattle();
        else {
          // 与战役/挑战一致：按收盘价平掉全部仓位再结算
          if (this.account.positions.length) this.account.closeAll('settle');
          const bars = this.market.bars || [];
          let bench = 0;
          if (bars.length > 1) bench = (bars[bars.length - 1].c / bars[0].o - 1) * 100;
          this.bus.emit('settle', {
            kind: 'history', equity: this.account.metrics().equity, account: this.account,
            benchmark: bench, startBalance: this.startBalance,
          });
        }
      }
      this.bus.emit('tick');
    }

    _evalBattleEvent() {
      const sc = this.scenario;
      if (!sc) return;
      const start = this._eventDayStart || {
        equity: this.account.metrics().equity, used: this.account.metrics().used,
        sides: this.account.positions.map((p) => p.side),
      };
      const startEq = start.equity;
      const endEq = this.account.metrics().equity;
      const rule = sc.objectives.eventRule;
      let E = 0;
      if (rule === 'short-or-flat') {
        E = start.sides.some((s) => s > 0) ? -1 : 1;
      } else if (rule === 'profit') {
        E = endEq >= startEq ? 1 : -1;
      } else if (rule === 'margin-under-30') {
        const ratio = startEq > 0 ? start.used / startEq : 0;
        E = ratio <= 0.3 || !start.sides.some((s) => s > 0) ? 1 : -1;
      } else if (rule === 'no-long-above-150') {
        E = this.longAbove150 === 0 ? 1 : -1;
      } else {
        E = endEq > startEq ? 1 : 0;
      }
      this.eventScore = E;
      this.toast(
        E > 0 ? '事件日判断正确，评分 +20。' : E < 0 ? '事件日判断失误，评分 −20。' : '事件日结果中性。',
        E > 0 ? 'ok' : E < 0 ? 'bad' : 'info'
      );
      this._eventDayStart = null;
    }

    _settleBattle() {
      const sc = this.scenario;
      if (!sc) return;
      // 平掉所有仓位
      if (this.account.positions.length) this.account.closeAll('settle');
      const m = this.account.metrics();
      const equity = m.equity;
      const ret = (equity - this.startBalance) / this.startBalance;
      const targetRet = (sc.objectives.targetEquity - this.startBalance) / this.startBalance;
      const dd = this.account.stats.maxDrawdown;
      const ddLimit = sc.objectives.maxDrawdownPct;
      const trades = this.account.stats.trades;
      const cap = sc.objectives.maxTrades;
      const liq = this.account.stats.liquidations;
      // 150 规则按“全程”判定，而不是只看事件日
      if (sc.objectives.eventRule === 'no-long-above-150' && this.longAbove150 > 0) this.eventScore = -1;
      const retScore = 45 * U.clamp(ret / targetRet, -0.6, 1.2);
      const ddScore = 25 * U.clamp(1 - dd / ddLimit, -0.5, 1);
      const evScore = 20 * (this.eventScore || 0);
      const discScore = 10 * U.clamp(1 - Math.max(0, trades - cap) / cap, 0, 1);
      let score = Math.round(retScore + ddScore + evScore + discScore - 25 * liq);
      if (trades === 0) {
        // 一场都没打，不参与评分
        score = 0;
        this.eventScore = 0;
      }
      score = Math.max(0, score);
      // 事件日规则与成交上限都属于硬条件
      const eventOk = this.eventScore >= 0;
      const pass = trades > 0 && trades <= cap && equity >= sc.objectives.targetEquity && dd <= ddLimit && liq === 0 && eventOk;
      let stars = 0;
      if (pass) stars = score >= 85 ? 3 : score >= 65 ? 2 : score >= 45 ? 1 : 0;
      const prev = this.profile.battles[sc.id] || { stars: 0, best: 0 };
      if (stars > prev.stars || (stars === prev.stars && score > (prev.best || 0))) {
        this.profile.battles[sc.id] = { stars, best: Math.max(score, prev.best || 0), equity, ts: Date.now() };
        U.store.set('profile', this.profile);
      }
      this.profile.totalTrades += trades;
      this.profile.totalLiquidations += liq;
      U.store.set('profile', this.profile);
      this._checkAchievements({ type: 'settle', payload: { score, stars, equity, scenario: sc } });
      this.running = false;
      this.bus.emit('settle', {
        kind: 'battle',
        scenario: sc, score, stars, pass, equity, ret, dd, trades, cap,
        eventScore: this.eventScore, liquidations: liq,
        previousBest: prev,
      });
    }

    toggleAuto() {
      if (this.mode !== 'history' && this.mode !== 'battle') return;
      this.autoPlay = !this.autoPlay;
      if (this.autoPlay) {
        this.running = true;
        this._stopAuto();
        this._autoTimer = setInterval(() => {
          if (!this.autoPlay || this._histBusy) return;
          if (!this.market || this.market.done) {
            this.autoPlay = false;
            this._stopAuto();
            return;
          }
          this._historyStep();
        }, 320);
      } else {
        this._stopAuto();
      }
      this.bus.emit('tick');
    }

    _stopAuto() {
      if (this._autoTimer) clearInterval(this._autoTimer);
      this._autoTimer = null;
    }

    seekHistory(pct) {
      // 只能向前播放；走正常推进流程，保证事件日快照、隔夜利息与结算都生效
      if (this.mode !== 'history' && this.mode !== 'battle') return;
      const total = this.market.rowIdx ? this.market.rowIdx.length : 0;
      const target = Math.max(1, Math.floor((pct / 100) * total));
      let guard = 0;
      while (!this.market.done && this.market.i < target && guard < 4000) {
        this._historyStep();
        guard++;
      }
      this.account.update(this.market.quotes, this.market.now.getTime());
      this.bus.emit('tick');
    }

    // ---------- 重置 ----------
    resetMode() {
      let ok = true;
      if (this.mode === 'sim') {
        U.store.remove('sim');
        this._createSim(false);
      } else if (this.mode === 'history') {
        this.startHistory({ pairId: this.scenario ? this.scenario.pair : this.selectedPair });
      } else if (this.mode === 'battle') {
        const id = this.scenario && this.scenario.id;
        if (id) this.startBattle(id);
      } else if (this.mode === 'challenge') {
        ok = this.startChallenge();
      }
      this.running = ok;
      this.bus.emit('mode', this.mode);
      this.bus.emit('tick');
    }

    // ---------- 成就 ----------
    _checkAchievements(ctxObj) {
      const list = FX.ACHIEVEMENTS || [];
      if (!list.length) return;
      if (!this.account) return;
      const metrics = this.account.metrics();
      const ctx = {
        event: ctxObj,
        mode: this.mode,
        account: this.account,
        metrics,
        trade: ctxObj.payload && ctxObj.payload.record ? ctxObj.payload.record : null,
        position: ctxObj.payload && ctxObj.payload.position ? ctxObj.payload.position : null,
        scenario: this.scenario,
        challenge: this.challenge ? {
          ...this.challenge,
          dayCount: this.dayCount,
          score: ctxObj.payload && ctxObj.payload.score != null ? ctxObj.payload.score : null,
        } : null,
        game: {
          dayCount: this.dayCount,
          startBalance: this.startBalance,
          elapsedDays: this.dayCount,
          // 成就指纹用的会话标识：同一场战役/挑战刷新后保持不变
          sessionId: [
            this.mode,
            this.scenario ? this.scenario.id : '',
            this.challenge ? (this.challenge.startedAt || '') : '',
            this.market && this.market.startTime ? this.market.startTime : '',
          ].filter(Boolean).join('|'),
        },
        profile: this.profile,
        flags: this.flags,
      };
      for (const def of list) {
        if (this.achData.unlocked[def.id]) continue;
        let ok = false;
        try {
          ok = def.check(ctx);
        } catch (err) {
          ok = false;
        }
        if (ok) this.unlockAchievement(def);
      }
      U.store.set('flags', this.flags);
    }

    unlockAchievement(def) {
      if (this.achData.unlocked[def.id]) return;
      this.achData.unlocked[def.id] = new Date().toISOString().slice(0, 10);
      U.store.set('achievements', this.achData);
      this.toast(`成就解锁：${def.name}`, 'ach');
      if (FX.Audio) FX.Audio.achieve();
      this.bus.emit('achievement', def);
    }

    achCount() {
      return Object.keys(this.achData.unlocked).length;
    }

    // ---------- 提示 ----------
    toast(msg, kind) {
      this.bus.emit('toast', { msg, kind: kind || 'info' });
    }

    // ---------- 存档 ----------
    save() {
      U.store.set('settings', this.settings);
      U.store.set('profile', this.profile);
      U.store.set('achievements', this.achData);
      U.store.set('flags', this.flags);
      if (!this.market || !this.account) return;
      if (this.mode === 'sim') {
        U.store.set('sim', {
          account: this.account.serialize(),
          quotes: this.market.quotes,
          prices: this.market.prices,
          now: this.market.now.getTime(),
          dayCount: this.dayCount,
          selectedPair: this.selectedPair,
          tf: this.tf,
          seed: this.market.seed,
          calendar: this.market.calendar.filter((e) => !e.fired && e.time > this.market.now.getTime()),
          lastSwapKey: this._lastSwapKey,
          v: 1,
        });
        U.store.set('session', { mode: 'sim' });
      } else if (this.mode === 'battle' && this.scenario && this.market && !this.market.done) {
        U.store.set('session', {
          mode: 'battle',
          battle: {
            id: this.scenario.id,
            i: this.market.i || 0,
            stepI: this.market.stepI || 0,
            eventDayStart: this._eventDayStart,
            account: this.account.serialize(),
            dayCount: this.dayCount,
            eventScore: this.eventScore,
            longAbove150: this.longAbove150,
          },
        });
      } else if (this.mode === 'challenge' && this.challenge && this.market && !this.challenge.finished) {
        U.store.set('session', {
          mode: 'challenge',
          challenge: {
            dayKey: this.challenge.dayKey,
            modId: this.challenge.modifier.id,
            seed: this.market.seed,
            startTime: this.market.startTime,
            prices: this.market.prices,
            now: this.market.now.getTime(),
            dayCount: this.dayCount,
            marketDayCount: this.market.dayCount,
            eventHits: this.eventHits,
            challengeHits: Array.from(this.challengeHitSet),
            startedAt: this.challenge.startedAt,
            calendar: this.market.calendar.filter((e) => !e.fired && e.time > this.market.now.getTime()),
            lastSwapKey: this._lastSwapKey,
            account: this.account.serialize(),
          },
        });
      } else {
        U.store.set('session', { mode: this.mode });
      }
    }

    clearAll() {
      for (const k of ['sim', 'session', 'settings', 'profile', 'achievements', 'flags', 'daily-meta']) U.store.remove(k);
      location.reload();
    }

    // ---------- 只读辅助 ----------
    currentSeries() {
      if (!this.market) return { bars: [], forming: null };
      return this.market.series(this.selectedPair, this.tf);
    }

    currentQuote() {
      if (!this.market) return null;
      return this.market.quotes[this.selectedPair] || null;
    }

    isTradable(pairId) {
      if (!this.market) return false;
      if (this.mode === 'history' || this.mode === 'battle') return pairId === this.selectedPair;
      return !!this.market.quotes[pairId];
    }

    timeLabel() {
      if (!this.market) return '—';
      const d = this.market.now;
      const days = ['日', '一', '二', '三', '四', '五', '六'];
      return `${U.dateUTC(d)} 周${days[d.getUTCDay()]} ${U.pad2(d.getUTCHours())}:${U.pad2(d.getUTCMinutes())}`;
    }

    progressPct() {
      if (this.mode === 'challenge') {
        return U.clamp((this.market.dayCount / (this.market.endAfterDays || 10)) * 100, 0, 100);
      }
      if (this.market && this.market.rowIdx) {
        return U.clamp((this.market.i / this.market.rowIdx.length) * 100, 0, 100);
      }
      return 0;
    }
  }

  FX.Game = Game;
  FX.CHALLENGE_MODS = CHALLENGE_MODS;
})();
