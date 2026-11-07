/* 交易账户：手数、点差、手续费、保证金、隔夜利息、挂单、强平 */
(function () {
  'use strict';
  const FX = (window.FX = window.FX || {});
  const U = FX.U;

  const ROUND_TURN_COMMISSION = 3.5; // 每标准手双边佣金（USD）
  const STOP_OUT = 0.5;              // 保证金水平 50% 强平
  const MARGIN_CALL = 1.0;           // 100% 追保提示

  class Account {
    constructor(opts = {}) {
      this.balance = opts.balance != null ? opts.balance : 10000;
      this.leverage = opts.leverage || 100;
      this.leverageOptions = opts.leverageOptions || [30, 100, 200, 500];
      this.maxPositions = opts.maxPositions || 12;
      this.maxLots = opts.maxLots || 10;
      this.positions = [];
      this.orders = [];
      this.history = [];
      this.debt = 0;
      this.nbp = opts.nbp !== false;       // 负余额保护
      this.halted = false;                  // 穿仓后禁止开仓
      this.tradingFrozen = false;
      this.quotes = null;
      this.now = 0;
      this.seq = 1;
      this.events = new FX.Bus();
      this.stats = {
        trades: 0, wins: 0, losses: 0, grossProfit: 0, grossLoss: 0,
        commission: 0, swap: 0, liquidations: 0, maxDrawdown: 0,
        peakEquity: this.balance, bestTrade: 0, worstTrade: 0,
        streakWin: 0, streakLoss: 0, maxStreakWin: 0, maxStreakLoss: 0,
      };
      this.equityTrail = [this.balance];
      this._warned = false;
      this._liqNotifiedAt = 0;
      this.slippagePips = 0.08;
      this.marginState = 'safe';
      this.version = 1;
    }

    // ---------- 基础换算 ----------
    _p(pairId) {
      return FX.PAIR_MAP[pairId];
    }
    pipValue(pairId, lots) {
      return FX.pipValueUSD(pairId, lots, this.quotes);
    }
    commission(lots) {
      return Math.round(lots * ROUND_TURN_COMMISSION * 100) / 100;
    }
    posPnl(pos, quotes) {
      const q = quotes || this.quotes;
      const qt = q[pos.pairId];
      if (!qt) return 0;
      const exit = pos.side > 0 ? qt.bid : qt.ask;
      const p = this._p(pos.pairId);
      const units = pos.lots * 100000;
      const quotePnl = pos.side * units * (exit - pos.entry);
      return quotePnl * FX.ccyToUSD(p.quote, q);
    }

    posValuePrice(pos) {
      const q = this.quotes[pos.pairId];
      return pos.side > 0 ? q.bid : q.ask;
    }

    metrics(quotes) {
      const q = quotes || this.quotes;
      if (!q) {
        return {
          balance: this.balance, floating: 0, equity: this.balance, used: 0,
          free: this.balance, marginLevel: Infinity, marginState: 'safe', debt: this.debt,
        };
      }
      let floating = 0;
      let used = 0;
      for (const p of this.positions) {
        floating += this.posPnl(p, q);
        used += p.margin;
      }
      const equity = this.balance + floating;
      const free = equity - used;
      const level = used > 0 ? (equity / used) * 100 : Infinity;
      let state = 'safe';
      if (level < STOP_OUT * 100) state = 'liq';
      else if (level < 100) state = 'danger';
      else if (level < 150) state = 'watch';
      else if (level < 300) state = 'ok';
      return { balance: this.balance, floating, equity, used, free, marginLevel: level, marginState: state, debt: this.debt };
    }

    /**
     * 账户强平信息：假设只有指定货币对在动，其余报价保持不变，求权益
     * 跌到强平线（保证金水平 50%）时的价格。多笔持仓（含反向锁仓）会
     * 按净敞口一并计算；不同货币对的持仓则保持当前价。
     * 返回 { price, distancePips, direction }；没有该对净敞口或价格不可能触及时返回 null。
     */
    liquidationInfo(pairId) {
      if (!pairId || !this.quotes || !this.positions.length) return null;
      const q = this.quotes[pairId];
      const p = this._p(pairId);
      if (!q || !p) return null;
      let netLots = 0;
      for (const pos of this.positions) {
        if (pos.pairId === pairId) netLots += pos.side * pos.lots;
      }
      if (Math.abs(netLots) < 1e-9) return null;
      const m = this.metrics();
      if (!isFinite(m.equity) || !(m.used > 0) || !isFinite(m.marginLevel)) return null;
      const target = STOP_OUT * m.used;
      const halfSpread = q.spreadPips * p.pip / 2;
      const balance = this.balance;
      const equityAt = (x) => {
        // 只改当前货币对的中间价，买卖价按当前点差对称展开
        const qs = Object.assign({}, this.quotes, {
          [pairId]: { ...q, mid: x, bid: x - halfSpread, ask: x + halfSpread },
        });
        let floating = 0;
        for (const pos of this.positions) floating += this.posPnl(pos, qs);
        return balance + floating;
      };
      const f = (x) => equityAt(x) - target;
      const current = q.mid;
      if (f(current) <= 0) return { price: current, distancePips: 0, direction: 0 };
      let lo;
      let hi;
      if (netLots > 0) {
        // 多单：价格下跌触发强平。以当前价为上界向下对半扩张，直到跨过 50%
        hi = current;
        lo = current;
        let guard = 0;
        while (f(lo) > 0 && guard++ < 80) lo *= 0.5;
        if (!(f(lo) <= 0)) return null; // 跌到近零也爆不了仓，或报价换算已溢出
      } else {
        // 空单：价格上涨触发强平。以当前价为下界向上扩张，直到跨过 50%
        lo = current;
        hi = current * 2;
        let guard = 0;
        while (f(hi) > 0 && guard++ < 80) hi *= 2;
        if (!(f(hi) <= 0)) return null;
      }
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        const fm = f(mid);
        if (!isFinite(fm)) break;
        if (netLots > 0) {
          if (fm > 0) hi = mid; else lo = mid;
        } else {
          if (fm > 0) lo = mid; else hi = mid;
        }
      }
      const price = (lo + hi) / 2;
      if (!(price > 0) || !isFinite(price)) return null;
      return {
        price,
        distancePips: Math.abs(price - current) / p.pip,
        direction: price < current ? -1 : price > current ? 1 : 0,
      };
    }

    /** 指定货币对的强平价格；未传 pairId 时取当前最接近强平的持仓货币对 */
    liquidationPrice(pairId) {
      if (pairId) {
        const info = this.liquidationInfo(pairId);
        return info ? info.price : null;
      }
      let best = null;
      const seen = new Set();
      for (const pos of this.positions) {
        if (seen.has(pos.pairId)) continue;
        seen.add(pos.pairId);
        const info = this.liquidationInfo(pos.pairId);
        if (info && (!best || info.distancePips < best.distancePips)) best = info;
      }
      return best ? best.price : null;
    }

    /** 账户整体距强平的点数（取各持仓货币对中最近的一条估算线） */
    liquidationDistance(pairId) {
      if (pairId) {
        const info = this.liquidationInfo(pairId);
        return info ? info.distancePips : null;
      }
      let best = null;
      const seen = new Set();
      for (const pos of this.positions) {
        if (seen.has(pos.pairId)) continue;
        seen.add(pos.pairId);
        const info = this.liquidationInfo(pos.pairId);
        if (info && (best == null || info.distancePips < best)) best = info.distancePips;
      }
      return best;
    }

    /** 预览订单：保证金、手续费、点值、强平距离、止损/止盈换算 */
    preview({ pairId, side, lots, slPermille, tpPermille, anchor, leverage }) {
      const q = this.quotes[pairId];
      const p = this._p(pairId);
      const lev = leverage || this.leverage;
      const entry = side > 0 ? q.ask : q.bid;
      const base = anchor > 0 ? anchor : entry;
      const margin = FX.marginUSD(pairId, lots, this.quotes, lev);
      const commission = this.commission(lots);
      const pipVal = this.pipValue(pairId, lots);
      const m = this.metrics();
      // 若只开这一笔，强平价格近似
      const afterEquity = m.equity - commission;
      const afterUsed = m.used + margin;
      const buffer = afterEquity - STOP_OUT * afterUsed;
      const dist = pipVal > 0 ? buffer / pipVal : null;
      const liqPrice = dist != null ? entry - side * dist * p.pip : null;
      const slPips = slPermille > 0 ? (base * slPermille / 1000) / p.pip : 0;
      const tpPips = tpPermille > 0 ? (base * tpPermille / 1000) / p.pip : 0;
      return {
        entry, base, margin, commission, pipVal, liqPrice, liqPips: dist,
        slPips, tpPips,
        slLoss: slPips > 0 ? slPips * pipVal : null,
        tpProfit: tpPips > 0 ? tpPips * pipVal : null,
        minPips: Math.max(2, q.spreadPips * 2),
        minPermille: FX.permille.minStop(base, p, q),
        spreadPips: q.spreadPips,
        spreadCost: q.spreadPips * pipVal,
      };
    }

    // ---------- 开仓 ----------
    openMarket({ pairId, side, lots, sl, tp, slPermille, tpPermille, trailPips, trailPermille, tag, now }) {
      if (this.tradingFrozen) return { ok: false, error: '账户已暂停交易' };
      if (this.halted) return { ok: false, error: '账户已穿仓，请重置后继续' };
      const p = this._p(pairId);
      if (!p) return { ok: false, error: '未知货币对' };
      const q = this.quotes[pairId];
      if (!q) return { ok: false, error: '该货币对暂不可交易' };
      lots = Math.round(U.clamp(lots, 0.01, this.maxLots) * 100) / 100;
      if (!(lots >= 0.01)) return { ok: false, error: '手数至少 0.01' };
      if (this.positions.length >= this.maxPositions) return { ok: false, error: '持仓数量已达上限' };
      const entry = side > 0 ? q.ask : q.bid;
      // 千分比优先：以实际成交价为基准，保证挂单成交滑点后仍是同一比例
      if (slPermille > 0) sl = FX.permille.stopPrice(entry, side, slPermille);
      if (tpPermille > 0) tp = FX.permille.targetPrice(entry, side, tpPermille);
      if (trailPermille > 0) trailPips = (entry * trailPermille / 1000) / p.pip;
      trailPips = Math.max(0, U.num(trailPips, 0));
      if (sl != null && (!Number.isFinite(sl) || sl <= 0)) return { ok: false, error: '止损价无效' };
      if (tp != null && (!Number.isFinite(tp) || tp <= 0)) return { ok: false, error: '止盈价无效' };
      if (sl != null && (side > 0 ? sl >= entry : sl <= entry)) {
        return { ok: false, error: side > 0 ? '多单止损需低于开仓价' : '空单止损需高于开仓价' };
      }
      if (tp != null && (side > 0 ? tp <= entry : tp >= entry)) {
        return { ok: false, error: side > 0 ? '多单止盈需高于开仓价' : '空单止盈需低于开仓价' };
      }
      const minDist = Math.max(2, q.spreadPips * 2) * p.pip;
      if (sl != null && Math.abs(entry - sl) < minDist) {
        const minPm = (minDist / entry * 1000).toFixed(2);
        return { ok: false, error: `止损离开仓价太近：至少 ${Math.max(2, q.spreadPips * 2).toFixed(1)} 点（约 ${minPm}‰）` };
      }
      if (tp != null && Math.abs(entry - tp) < minDist) {
        const minPm = (minDist / entry * 1000).toFixed(2);
        return { ok: false, error: `止盈离开仓价太近：至少 ${Math.max(2, q.spreadPips * 2).toFixed(1)} 点（约 ${minPm}‰）` };
      }
      const margin = FX.marginUSD(pairId, lots, this.quotes, this.leverage);
      const commission = this.commission(lots);
      const m = this.metrics();
      if (margin + commission > m.free + 1e-6) {
        const need = margin + commission - m.free;
        return { ok: false, error: `可用保证金不足，还差 ${U.money(need)}` };
      }
      this.balance = round2(this.balance - commission);
      this.stats.commission = round2(this.stats.commission + commission);
      const pos = {
        id: 'p' + this.seq++,
        pairId, side, lots: round2(lots), entry,
        margin: round2(margin), leverage: this.leverage,
        sl: sl || null, tp: tp || null, trailPips: trailPips || 0,
        openedAt: now || this.now || 0,
        swapAccrued: 0, tag: tag || 'market',
        commission, mfe: 0, mae: 0,
      };
      this.positions.push(pos);
      this.events.emit('open', pos);
      // 开仓后立刻检查一次保证金
      this.checkMargin();
      return { ok: true, position: pos };
    }

    // ---------- 挂单 ----------
    placeOrder({ pairId, side, lots, type, price, sl, tp, slPermille, tpPermille, trailPips, trailPermille, expiryDays, now }) {
      if (this.tradingFrozen || this.halted) return { ok: false, error: '账户暂不可交易' };
      const q = this.quotes[pairId];
      if (!q) return { ok: false, error: '该货币对暂不可交易' };
      const p = this._p(pairId);
      lots = Math.round(U.clamp(lots, 0.01, this.maxLots) * 100) / 100;
      if (!(lots >= 0.01)) return { ok: false, error: '手数至少 0.01' };
      if (slPermille > 0) sl = FX.permille.stopPrice(price, side, slPermille);
      if (tpPermille > 0) tp = FX.permille.targetPrice(price, side, tpPermille);
      if (trailPermille > 0) trailPips = (price * trailPermille / 1000) / p.pip;
      trailPips = Math.max(0, U.num(trailPips, 0));
      if (sl != null && (!Number.isFinite(sl) || sl <= 0)) return { ok: false, error: '止损价无效' };
      if (tp != null && (!Number.isFinite(tp) || tp <= 0)) return { ok: false, error: '止盈价无效' };
      if (sl != null && (side > 0 ? sl >= price : sl <= price)) {
        return { ok: false, error: side > 0 ? '多单止损需低于触发价' : '空单止损需高于触发价' };
      }
      if (tp != null && (side > 0 ? tp <= price : tp >= price)) {
        return { ok: false, error: side > 0 ? '多单止盈需高于触发价' : '空单止盈需低于触发价' };
      }
      const minDist = Math.max(2, q.spreadPips * 2) * p.pip;
      if (sl != null && Math.abs(price - sl) < minDist) {
        const minPm = (minDist / price * 1000).toFixed(2);
        return { ok: false, error: `止损离触发价太近：至少 ${Math.max(2, q.spreadPips * 2).toFixed(1)} 点（约 ${minPm}‰）` };
      }
      if (tp != null && Math.abs(price - tp) < minDist) {
        const minPm = (minDist / price * 1000).toFixed(2);
        return { ok: false, error: `止盈离触发价太近：至少 ${Math.max(2, q.spreadPips * 2).toFixed(1)} 点（约 ${minPm}‰）` };
      }
      if (type === 'limit') {
        if (side > 0 && price >= q.ask) return { ok: false, error: '买入限价需低于当前卖价' };
        if (side < 0 && price <= q.bid) return { ok: false, error: '卖出限价需高于当前买价' };
      } else if (type === 'stop') {
        if (side > 0 && price <= q.ask) return { ok: false, error: '买入止损需高于当前卖价' };
        if (side < 0 && price >= q.bid) return { ok: false, error: '卖出止损需低于当前买价' };
      }
      const o = {
        id: 'o' + this.seq++,
        pairId, side, lots: round2(lots), type: type || 'limit',
        price, sl: sl || null, tp: tp || null, trailPips: trailPips || 0,
        slPermille: slPermille > 0 ? slPermille : 0,
        tpPermille: tpPermille > 0 ? tpPermille : 0,
        trailPermille: trailPermille > 0 ? trailPermille : 0,
        placedAt: now || this.now || 0,
        expiresAt: expiryDays ? (now || this.now || 0) + expiryDays * 86400000 : 0,
        status: 'working',
      };
      this.orders.push(o);
      this.events.emit('order', o);
      return { ok: true, order: o };
    }

    cancelOrder(id) {
      const idx = this.orders.findIndex((o) => o.id === id && o.status === 'working');
      if (idx < 0) return false;
      const [o] = this.orders.splice(idx, 1);
      o.status = 'cancelled';
      this.events.emit('orderCancel', o);
      return true;
    }

    // ---------- 平仓 ----------
    close(id, lots, reason) {
      const pos = this.positions.find((p) => p.id === id);
      if (!pos) return false;
      const q = this.quotes[pos.pairId];
      if (!q) return false;
      const price = this.posValuePrice(pos);
      this._closePos(pos, price, reason || 'manual', lots);
      return true;
    }

    closeAll(reason) {
      let total = 0;
      for (const pos of this.positions.slice()) {
        const pnl = this.posPnl(pos);
        total += pnl;
        this._closePos(pos, this.posValuePrice(pos), reason || 'closeAll');
      }
      return total;
    }

    _closePos(pos, rawPrice, reason, lots) {
      const q = this.quotes[pos.pairId];
      const p = this._p(pos.pairId);
      const closeLots = lots == null ? pos.lots : Math.min(pos.lots, Math.max(0.01, Math.round(lots * 100) / 100));
      const ratio = closeLots / pos.lots;
      // 强平/止损的额外滑点
      let price = rawPrice;
      if (reason === 'sl' || reason === 'stopout' || reason === 'liquidation') {
        const slip = this.slippagePips * (reason === 'stopout' ? 2.5 : 1.4);
        price = rawPrice - pos.side * slip * p.pip;
      }
      const units = closeLots * 100000;
      const quotePnl = pos.side * units * (price - pos.entry);
      const pnl = quotePnl * FX.ccyToUSD(p.quote, this.quotes);
      const releasedMargin = pos.margin * ratio;
      const swapPart = pos.swapAccrued * ratio;
      // 隔夜利息已在结算时直接计入余额，这里只做记录，不重复加
      this.balance = round2(this.balance + pnl);
      // 记录
      const rec = {
        id: 'h' + this.seq++,
        pairId: pos.pairId, side: pos.side, lots: closeLots,
        entry: pos.entry, exit: price, pnl: round2(pnl),
        commission: round2(pos.commission * ratio),
        swap: round2(swapPart),
        reason: reason || 'manual',
        openedAt: pos.openedAt, closedAt: this.now,
        tag: pos.tag,
      };
      this.history.unshift(rec);
      if (this.history.length > 200) this.history.pop();
      // 部分平仓只记录、不单独计一笔；整笔结束后再用累计盈亏统计
      pos.lots = round2(pos.lots - closeLots);
      pos.margin = round2(pos.margin - releasedMargin);
      pos.swapAccrued = round2(pos.swapAccrued - swapPart);
      pos.realized = round2((pos.realized || 0) + pnl);
      if (pos.lots < 0.01) {
        const totalPnl = pos.realized;
        const st = this.stats;
        st.trades++;
        if (totalPnl > 0) {
          st.wins++;
          st.grossProfit += totalPnl;
          st.streakWin++;
          st.streakLoss = 0;
          st.maxStreakWin = Math.max(st.maxStreakWin, st.streakWin);
        } else {
          st.losses++;
          st.grossLoss += -totalPnl;
          st.streakLoss++;
          st.streakWin = 0;
          st.maxStreakLoss = Math.max(st.maxStreakLoss, st.streakLoss);
        }
        st.bestTrade = Math.max(st.bestTrade, totalPnl);
        st.worstTrade = Math.min(st.worstTrade, totalPnl);
        this.positions = this.positions.filter((x) => x !== pos);
      }
      this.events.emit('close', { position: pos, record: rec, reason });
      this._trackEquity();
      return rec;
    }

    // ---------- 每 tick 处理 ----------
    update(quotes, now) {
      this.quotes = quotes;
      this.now = now || this.now;
      if (!quotes) return;
      this._updateExtremes();
      this._processOrders();
      this._checkStops();
      this._updateTrailing();
      this.checkMargin();
      this._trackEquity();
    }

    _updateExtremes() {
      for (const pos of this.positions) {
        const pnl = this.posPnl(pos);
        if (pnl > pos.mfe) pos.mfe = pnl;
        if (pnl < pos.mae) pos.mae = pnl;
      }
    }

    _processOrders() {
      for (const o of this.orders.slice()) {
        if (o.status !== 'working') continue;
        const q = this.quotes[o.pairId];
        if (!q) continue;
        if (o.expiresAt && (this.now || 0) > o.expiresAt) {
          o.status = 'expired';
          this.orders = this.orders.filter((x) => x !== o);
          this.events.emit('orderCancel', o);
          continue;
        }
        let hit = false;
        if (o.type === 'limit') {
          if (o.side > 0 && q.ask <= o.price) hit = true;
          if (o.side < 0 && q.bid >= o.price) hit = true;
        } else if (o.type === 'stop') {
          if (o.side > 0 && q.ask >= o.price) hit = true;
          if (o.side < 0 && q.bid <= o.price) hit = true;
        }
        if (!hit) continue;
        // 同一张挂单被拒后冷却 1 分钟，避免每拍重复提示
        if (o.lastRejectAt && (this.now || 0) - o.lastRejectAt < 60000) continue;
        const res = this.openMarket({
          pairId: o.pairId, side: o.side, lots: o.lots,
          sl: o.sl, tp: o.tp,
          slPermille: o.slPermille, tpPermille: o.tpPermille,
          trailPips: o.trailPips, trailPermille: o.trailPermille,
          tag: o.type,
        });
        if (!res.ok) {
          o.lastRejectAt = this.now || 0;
          this.events.emit('orderRejected', { order: o, error: res.error });
        } else {
          o.status = 'filled';
          this.orders = this.orders.filter((x) => x !== o);
          this.events.emit('orderFill', { order: o, position: res.position });
        }
      }
    }

    _checkStops() {
      for (const pos of this.positions.slice()) {
        const q = this.quotes[pos.pairId];
        if (!q) continue;
        const p = this._p(pos.pairId);
        const bid = q.bid;
        const ask = q.ask;
        // 止损优先
        if (pos.sl) {
          const hitSL = pos.side > 0 ? bid <= pos.sl : ask >= pos.sl;
          if (hitSL) {
            const raw = pos.side > 0 ? Math.min(bid, pos.sl) : Math.max(ask, pos.sl);
            this._closePos(pos, raw, 'sl');
            continue;
          }
        }
        if (pos.tp) {
          const hitTP = pos.side > 0 ? bid >= pos.tp : ask <= pos.tp;
          if (hitTP) {
            const raw = pos.side > 0 ? Math.max(bid, pos.tp) : Math.min(ask, pos.tp);
            this._closePos(pos, raw, 'tp');
            continue;
          }
        }
      }
    }

    _updateTrailing() {
      for (const pos of this.positions) {
        if (!pos.trailPips) continue;
        const q = this.quotes[pos.pairId];
        const p = this._p(pos.pairId);
        if (pos.side > 0) {
          const cand = q.bid - pos.trailPips * p.pip;
          if (pos.sl == null || cand > pos.sl) pos.sl = cand;
        } else {
          const cand = q.ask + pos.trailPips * p.pip;
          if (pos.sl == null || cand < pos.sl) pos.sl = cand;
        }
      }
    }

    /** 追保与强平 */
    checkMargin() {
      if (!this.quotes) return;
      let m = this.metrics();
      const level = m.marginLevel;
      if (level < MARGIN_CALL * 100 && !this._warned && this.positions.length) {
        this._warned = true;
        this.events.emit('marginCall', m);
      } else if (level > 115) {
        this._warned = false;
      }
      this.marginState = m.marginState;
      // 强平循环
      let guard = 0;
      while (this.positions.length && m.used > 0 && m.equity / m.used < STOP_OUT && guard < 40) {
        guard++;
        let worst = null;
        let worstRatio = -Infinity;
        for (const pos of this.positions) {
          const pnl = this.posPnl(pos);
          const ratio = pos.margin > 0 ? -pnl / pos.margin : 0;
          if (ratio > worstRatio) {
            worstRatio = ratio;
            worst = pos;
          }
        }
        if (!worst) break;
        this.stats.liquidations++;
        this._closePos(worst, this.posValuePrice(worst), 'stopout');
        this.events.emit('stopout', { position: worst, metrics: this.metrics() });
        m = this.metrics();
        if (m.equity / (m.used || 1) > STOP_OUT + 0.07) break;
      }
      // 负余额处理
      if (this.balance < 0) {
        const neg = this.balance;
        if (this.nbp) {
          this.balance = 0;
          this.events.emit('nbp', { absorbed: -neg });
        } else {
          this.debt += -neg;
          this.balance = 0;
          this.halted = true;
          this.events.emit('bankrupt', { debt: this.debt });
        }
      }
    }

    _trackEquity() {
      if (!this.quotes) return;
      const m = this.metrics();
      const peak = Math.max(this.stats.peakEquity, m.equity);
      this.stats.peakEquity = peak;
      const dd = peak > 0 ? (m.equity - peak) / peak : 0;
      if (-dd * 100 > this.stats.maxDrawdown) this.stats.maxDrawdown = -dd * 100;
      const last = this.equityTrail[this.equityTrail.length - 1];
      if (last == null || Math.abs(m.equity - last) > 0.01) {
        this.equityTrail.push(round2(m.equity));
        if (this.equityTrail.length > 600) this.equityTrail.shift();
      }
    }

    // ---------- 隔夜利息 ----------
    applySwap(weekday, now) {
      if (!this.quotes || !this.positions.length) return 0;
      let total = 0;
      for (const pos of this.positions.slice()) {
        const amount = FX.swapPerNightUSD(pos.pairId, pos.lots, this.quotes, weekday, 0, pos.side);
        pos.swapAccrued = round2(pos.swapAccrued + amount);
        total += amount;
      }
      total = round2(total);
      if (total !== 0) {
        this.balance = round2(this.balance + total);
        this.stats.swap = round2(this.stats.swap + total);
        this.events.emit('swap', { amount: total, weekday });
      }
      this.lastSwapAt = now || this.now;
      return total;
    }

    // ---------- 修改 ----------
    modify(id, patch) {
      const pos = this.positions.find((p) => p.id === id);
      if (!pos) return false;
      if (patch.sl !== undefined) pos.sl = patch.sl;
      if (patch.tp !== undefined) pos.tp = patch.tp;
      if (patch.trailPips !== undefined) pos.trailPips = Math.max(0, U.num(patch.trailPips, 0));
      this.events.emit('modify', pos);
      return true;
    }

    reset(balance) {
      this.balance = balance != null ? balance : 10000;
      this.positions = [];
      this.orders = [];
      this.history = [];
      this.debt = 0;
      this.halted = false;
      this.tradingFrozen = false;
      this._warned = false;
      this.equityTrail = [this.balance];
      this.stats = {
        trades: 0, wins: 0, losses: 0, grossProfit: 0, grossLoss: 0,
        commission: 0, swap: 0, liquidations: 0, maxDrawdown: 0,
        peakEquity: this.balance, bestTrade: 0, worstTrade: 0,
        streakWin: 0, streakLoss: 0, maxStreakWin: 0, maxStreakLoss: 0,
      };
      this.events.emit('reset');
    }

    serialize() {
      return {
        v: this.version,
        balance: this.balance,
        leverage: this.leverage,
        positions: this.positions.map((p) => ({ ...p })),
        orders: this.orders.map((o) => ({ ...o })),
        history: this.history.slice(0, 50),
        debt: this.debt,
        halted: this.halted,
        stats: { ...this.stats },
        equityTrail: this.equityTrail.slice(-200),
        seq: this.seq,
        nbp: this.nbp,
      };
    }

    restore(data) {
      if (!data || data.v !== 1) return false;
      this.balance = U.num(data.balance, 10000);
      this.leverage = U.num(data.leverage, 100);
      // 导入的备份可能被手改：丢弃字段残缺的持仓/挂单，避免 NaN 进入引擎
      this.positions = Array.isArray(data.positions)
        ? data.positions.filter((p) => p && FX.PAIR_MAP[p.pairId] && (p.side === 1 || p.side === -1)
          && Number.isFinite(p.lots) && p.lots >= 0.01 && Number.isFinite(p.entry) && Number.isFinite(p.margin))
        : [];
      this.orders = Array.isArray(data.orders)
        ? data.orders.filter((o) => o && FX.PAIR_MAP[o.pairId] && Number.isFinite(o.price) && Number.isFinite(o.lots))
        : [];
      this.history = Array.isArray(data.history) ? data.history : [];
      this.debt = U.num(data.debt, 0);
      this.halted = !!data.halted;
      this.seq = U.num(data.seq, 1);
      if (data.stats) Object.assign(this.stats, data.stats);
      if (Array.isArray(data.equityTrail) && data.equityTrail.length) this.equityTrail = data.equityTrail;
      this.nbp = data.nbp !== false;
      return true;
    }
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  FX.Account = Account;
  FX.COMMISSION = ROUND_TURN_COMMISSION;
  FX.STOP_OUT = STOP_OUT;
})();
