/* 界面层：渲染、事件绑定、弹窗、教程 */
(function () {
  'use strict';
  const FX = (window.FX = window.FX || {});
  const U = FX.U;
  const $ = (id) => document.getElementById(id);

  const TUTORIAL = [
    {
      icon: 'up', title: '做多：赌价格涨',
      body: '外汇交易的不是“股票”，而是一对货币的相对价格。<strong>EUR/USD = 1.1130</strong> 的意思是 1 欧元值 1.1130 美元。<br><br>你点“做多”，就是买入欧元、卖出美元。价格涨到 1.1140，你赚；跌到 1.1120，你亏。<br><br>每 1 个标准手（100,000 欧元）波动 1 点（0.0001），大约盈亏 $10。',
    },
    {
      icon: 'down', title: '做空：下跌也能赚钱',
      body: '做空不需要先拥有欧元。你向经纪商“借”欧元卖出，等价格跌了再买回来还给它，差价就是利润。<br><br>空单的盈亏方向与多单相反。外汇是双向市场，涨跌都有人赚钱，也都有人亏钱。',
    },
    {
      icon: 'info', title: '点差与手续费：开仓就亏一点',
      body: '你看到的买价（Bid）永远低于卖价（Ask），中间的差就是<strong>点差</strong>。买入按 Ask 成交，卖出按 Bid 成交，所以刚开仓就会有一个点差的浮亏。<br><br>本游戏每标准手另收 <strong>$3.50 双边佣金</strong>。点差在亚洲时段和新闻发布时会扩大。<br><br>这些成本不是 bug，是真实交易的一部分。',
    },
    {
      icon: 'shield', title: '保证金与杠杆：押金与放大器',
      body: '你不需要付 100,000 美元才能交易 1 手。经纪商只要求一笔<strong>保证金</strong>，例如 1:100 杠杆下，1 手 EUR/USD 只需约 $1,113。<br><br>杠杆放大仓位，也放大盈亏。<strong>它不改变方向，只缩短你的反应时间。</strong>同样的行情，杠杆越高，越容易在波动中先出局。',
    },
    {
      icon: 'alert', title: '保证金水平与强平',
      body: '保证金水平 = 权益 ÷ 已用保证金。低于 <strong>100%</strong> 会提示追保；低于 <strong>50%</strong> 会被强制平仓。<br><br>跳空可能让止损以远离触发价的价格成交，甚至穿仓。默认开启负余额保护，把亏损截断在 0。<br><br>强平不是 bug，是数学。',
    },
    {
      icon: 'target', title: '先想亏多少，再想赚多少',
      body: '下单前先设止损：你愿意为这笔交易亏多少钱？<br><br>带止损、单笔风险不超过权益 2%、不在新闻公布前满仓——这些纪律不会让你每次都赢，但会让你活得更久。<br><br>下单票（桌面在右侧，手机上在下方）可以设置止损、止盈与追踪止损。现在，去开你的第一笔交易吧。',
    },
  ];

  class UI {
    constructor(game) {
      this.game = game;
      this.chart = null;
      this.deskTab = 'positions';
      this.orderType = 'market';
      this.tickerTimer = null;
      this.newsQueue = [];
      this.newsShowing = false;
      this.toastTimer = null;
      this._renderPending = false;
      this._prevPrices = {};
      this._modalStack = [];
      this.tutIndex = 0;
    }

    init() {
      try {
        this.chart = new FX.Chart($('chart'));
      } catch (err) {
        // 极旧内核拿不到 2D 上下文时，用空壳保证其余界面可用
        console.error('chart init failed', err);
        this.chart = {
          w: 0,
          h: 0,
          errorMessage: '当前设备无法初始化图表：' + (err && err.message ? err.message : err),
          render() { return false; },
          resize() {},
          destroy() {},
        };
      }
      this.bind();
      this.applySettingsUI();
      this.render();
      this.tickClock();
      setInterval(() => this.tickClock(), 1000);
      this.game.bus.on('tick', () => this.scheduleRender());
      this.game.bus.on('mode', () => {
        this.orderType = 'market';
        U.$$('#orderTypeSeg button').forEach((x) => x.classList.toggle('active', x.dataset.type === 'market'));
        $('triggerInput').value = '';
        // 清掉上一模式残留的快讯浮卡
        this.newsQueue = [];
        this.newsShowing = false;
        clearTimeout(this._nfTimer);
        $('newsFloat').classList.add('hidden');
        $('toast').innerHTML = '';
        this.render();
        this.syncModeUI();
      });
      this.game.bus.on('news', (item) => this.onNews(item));
      this.game.bus.on('toast', ({ msg, kind }) => this.toast(msg, kind));
      this.game.bus.on('settle', (data) => this.showSettle(data));
      this.game.bus.on('achievement', () => this.renderAchProgress());
      this.game.bus.on('settings', () => this.applySettingsUI());
      this.game.bus.on('swap', (amount) => {
        if (FX.Audio) FX.Audio.swap(amount > 0);
      });
      this.game.bus.on('accountEvent', () => this.scheduleRender());
      this.game.bus.on('stopout', () => this.scheduleRender());
      // 首次欢迎
      setTimeout(() => {
        if (!this.game.flags.seenWelcome) {
          this.game.flags.seenWelcome = true;
          U.store.set('flags', this.game.flags);
          this.showWelcome();
        }
      }, 400);
    }

    // ---------- 基础 ----------
    scheduleRender() {
      if (this._renderPending) return;
      this._renderPending = true;
      requestAnimationFrame(() => {
        this._renderPending = false;
        this.render();
      });
    }

    syncModeUI() {
      const g = this.game;
      U.$$('#modeTabs .mode-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === g.mode));
      const names = { sim: '模拟行情', history: '历史回放', battle: '经典战役', challenge: '每日挑战' };
      let badge = names[g.mode] || '模拟行情';
      if (g.mode === 'battle' && g.scenario) {
        badge += ' · ' + g.scenario.title;
        if (g.market && g.market.done) badge += ' · 已结束';
      }
      if (g.mode === 'challenge' && g.challenge && g.challenge.modifier) {
        badge += ' · ' + g.challenge.modifier.name;
        if (g.challenge.finished) badge += ' · 已结束';
        else if (g.market) badge += ` · 剩余 ${Math.max(0, 10 - (g.market.dayCount || 0))} 日`;
      }
      $('modeBadge').textContent = badge;
      const isHistory = g.mode === 'history' || g.mode === 'battle';
      $('playbackControls').classList.toggle('hidden', !isHistory);
      $('chartBadge').textContent = badge;
      this.buildTfButtons();
      this.buildLeverageOptions();
      this.syncSpeedUI();
    }

    buildTfButtons() {
      const g = this.game;
      const isHist = g.mode === 'history' || g.mode === 'battle';
      const tfs = isHist ? FX.HIST_TFS : FX.SIM_TFS;
      if (!tfs.find((t) => t.id === g.tf)) g.tf = tfs[0].id;
      const key = (isHist ? 'H' : 'S') + g.tf;
      if (this._tfKey === key) return;
      this._tfKey = key;
      const seg = $('tfSeg');
      seg.innerHTML = tfs.map((t) => `<button data-tf="${t.id}" class="${t.id === g.tf ? 'active' : ''}" type="button">${t.label}</button>`).join('');
      U.$$('#tfSeg button').forEach((b) => {
        b.addEventListener('click', () => {
          g.tf = b.dataset.tf;
          this.buildTfButtons();
          this.scheduleRender();
        });
      });
    }

    syncSpeedUI() {
      const g = this.game;
      const show = g.mode === 'sim' || g.mode === 'challenge';
      $('speedSeg').classList.toggle('hidden', !show);
      U.$$('#speedSeg button').forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === (g.speed || 1)));
    }

    buildLeverageOptions() {
      const g = this.game;
      if (!g.account) return;
      const opts = g.account.leverageOptions || [30, 100, 200, 500];
      const key = opts.join(',') + ':' + g.account.leverage;
      if (this._levKey === key) return;
      this._levKey = key;
      const sel = $('leverageSelect');
      sel.innerHTML = opts.map((n) => `<option value="${n}"${n === g.account.leverage ? ' selected' : ''}>1:${n}${n === 30 ? ' · 稳健' : n === 100 ? ' · 标准' : n === 200 ? ' · 激进' : n >= 500 ? ' · 深渊' : ''}</option>`).join('');
      sel.disabled = opts.length <= 1;
    }

    mapTfLabel() {
      const g = this.game;
      const tfs = (g.mode === 'history' || g.mode === 'battle') ? FX.HIST_TFS : FX.SIM_TFS;
      const t = tfs.find((x) => x.id === g.tf);
      return t ? t.label : g.tf;
    }

    // ---------- 主渲染 ----------
    render() {
      const g = this.game;
      if (!g || !g.account || !g.market) return;
      this.syncModeUI();
      const m = g.account.metrics();
      const q = g.currentQuote();
      const p = FX.PAIR_MAP[g.selectedPair];

      // 账户条
      this.setText('equityValue', U.money(m.equity));
      const delta = m.equity - g.startBalance;
      this.setText('equityDelta', U.moneySigned(delta), this.signClass(delta));
      this.setText('balanceValue', U.money(m.balance));
      this.setText('floatingValue', U.moneySigned(m.floating), this.signClass(m.floating));
      this.setText('usedValue', U.money(m.used));
      this.setText('freeValue', U.money(m.free));
      const level = m.marginLevel;
      this.setText('levelValue', isFinite(level) ? level.toFixed(0) + '%' : '—');
      const stateMap = { safe: '安全', ok: '正常', watch: '注意', danger: '追保', liq: '强平' };
      const zeroed = m.equity <= 0.005 && !g.account.positions.length;
      const tag = $('marginStateTag');
      tag.textContent = zeroed ? '归零' : stateMap[m.marginState] || '安全';
      tag.className = 'state-tag is-' + (zeroed ? 'danger' : m.marginState);
      const gauge = $('marginGauge');
      gauge.className = 'margin-gauge is-' + (zeroed ? 'danger' : m.marginState);
      const gaugePct = !isFinite(level) ? 100 : U.clamp((level / 300) * 100, 0, 100);
      gauge.querySelector('i').style.width = gaugePct + '%';

      // 图表标题
      this.setText('pairTitle', p ? p.display : '—');
      this.setText('pairName', p ? p.name : '');
      this.setText('orderPair', p ? p.display : '—');
      if (q) {
        const prev = this._prevPrices[g.selectedPair];
        this.setText('currentPrice', U.price(q.mid, p.digits));
        const flash = prev != null && q.mid !== prev ? (q.mid > prev ? 'up' : 'down') : null;
        const priceEl = $('currentPrice');
        priceEl.classList.remove('flash-up', 'flash-down');
        if (flash) {
          void priceEl.offsetWidth;
          priceEl.classList.add('flash-' + flash);
        }
        this._prevPrices[g.selectedPair] = q.mid;
        const bars = g.currentSeries();
        const base = bars.bars.length ? bars.bars[bars.bars.length - 1].c : q.mid;
        const chg = base ? ((q.mid - base) / base) * 100 : 0;
        this.setText('priceChange', U.pct(chg), this.signClass(chg));
        this.setText('bidValue', U.price(q.bid, p.digits));
        this.setText('askValue', U.price(q.ask, p.digits));
        this.setText('spreadValue', q.spreadPips.toFixed(1) + ' 点');
      }
      const sess = g.market.sessionLabel ? g.market.sessionLabel() : '—';
      this.setText('sessChip', sess);
      this.setText('sessionText', sess);
      let note = this.sessionNote(sess);
      if (g.mode === 'battle' && g.scenario) {
        const o = g.scenario.objectives;
        note = `战役目标：期末权益 ≥ ${U.money(o.targetEquity, 0)} · 最大回撤 ≤ ${o.maxDrawdownPct}% · 成交上限 ${o.maxTrades} 笔`;
      } else if (g.mode === 'challenge' && g.challenge && g.challenge.modifier) {
        note = `今日词条：${g.challenge.modifier.name} —— ${g.challenge.modifier.desc}`;
      } else if (g.mode === 'history' && g.market) {
        note = `历史回放：${g.market.pair.display} · ${g.market.start} → ${g.market.end} · 按日推进，收盘成交`;
      }
      this.setText('sessionNote', note);

      // 时钟
      this.tickClock();

      // 模式徽章与风险
      this.renderRisk(m, q);
      this.renderPairList();
      this.renderDesk();
      this.renderTicketPreview();
      this.renderPlayback();
      this.renderChart();
      this.renderNewsTicker();
      this.renderCalendarCount();
    }

    signClass(v) {
      if (!isFinite(v) || Math.abs(v) < 1e-9) return '';
      return v > 0 ? 'up' : 'down';
    }

    setText(id, text, cls) {
      const el = $(id);
      if (!el) return;
      if (el.textContent !== text) el.textContent = text;
      if (cls !== undefined) {
        el.classList.remove('up', 'down');
        if (cls) el.classList.add(cls);
      }
    }

    sessionNote(sess) {
      const map = {
        悉尼: '亚洲早盘，流动性低，点差偏宽。',
        东京: '亚洲时段，波动温和；关注日本数据。',
        伦敦前: '欧洲开盘前，波动开始放大。',
        伦敦: '伦敦时段，主要货币对流动性最好。',
        '伦敦/纽约重叠': '流动性高峰，波动最大，也最容易追单。',
        纽约: '纽约时段，美国数据主导行情。',
        纽约尾盘: '流动性下降，注意点差扩大。',
        '结算/换日': '换日结算：点差显著扩大，隔夜利息在此结算。',
      };
      return map[sess] || '市场运行中。';
    }

    renderRisk(m, q) {
      const g = this.game;
      const dist = g.account.liquidationDistance();
      $('riskDist').textContent = dist == null ? '—' : (dist > 0 ? dist.toFixed(1) + ' 点' : '已穿透');
      $('riskDist').className = 'num ' + (dist != null && dist < 50 ? 'down' : '');
      $('riskRatio').textContent = m.used > 0 ? ((m.used / Math.max(1, m.equity)) * 100).toFixed(0) + '%' : '—';
      let swap = 0;
      for (const pos of g.account.positions) {
        swap += FX.swapPerNightUSD(pos.pairId, pos.lots, g.account.quotes, 0, 0, pos.side);
      }
      $('riskSwap').textContent = g.account.positions.length ? U.moneySigned(swap) + '/夜' : '—';
      $('riskSwap').className = 'num ' + (swap > 0 ? 'up' : swap < 0 ? 'down' : '');
      $('riskFee').textContent = U.money(g.account.stats.commission);
      $('riskDebt').textContent = g.account.debt > 0 ? U.money(g.account.debt) : '—';
      $('riskDebt').className = 'num ' + (g.account.debt > 0 ? 'down' : '');
      const n = g.account.positions.length;
      const hint = $('riskHint');
      if (!n) hint.textContent = '暂无持仓';
      else if (dist != null && dist < 80) hint.textContent = `距强平约 ${dist.toFixed(0)} 点`;
      else hint.textContent = `${n} 笔持仓 · 保证金水平 ${isFinite(m.marginLevel) ? m.marginLevel.toFixed(0) + '%' : '—'}`;
    }

    renderPairList() {
      const g = this.game;
      const filter = ($('pairSearch').value || '').trim().toUpperCase();
      const groups = { main: '主要货币对', cross: '交叉盘' };
      const shown = [];
      let html = '';
      for (const gid of ['main', 'cross']) {
        const list = FX.PAIRS.filter((p) => p.group === gid && (!filter || p.display.includes(filter) || p.name.includes(filter)));
        if (!list.length) continue;
        html += `<div class="pair-group-label">${groups[gid]}</div>`;
        for (const p of list) {
          const q = g.market.quotes[p.id];
          const tradable = g.isTradable(p.id);
          shown.push({ p, tradable, hasQuote: !!q });
          if (!q) {
            html += `<button class="pair-row disabled" type="button" aria-disabled="true"><span class="pair-id">${p.display}</span><span class="pair-cn">${p.name}</span><span class="pair-price num">—</span></button>`;
            continue;
          }
          const series = g.market.series(p.id, '1d');
          const base = series.bars.length ? series.bars[series.bars.length - 1].c : q.mid;
          const chg = base ? ((q.mid - base) / base) * 100 : 0;
          const selected = p.id === g.selectedPair;
          const disTitle = tradable ? '' : ` title="本模式只能交易 ${FX.PAIR_MAP[g.selectedPair].display}"`;
          html += `<button class="pair-row${selected ? ' selected' : ''}${tradable ? '' : ' disabled'}" data-pair="${p.id}" type="button"${disTitle} aria-disabled="${tradable ? 'false' : 'true'}">
            <span class="pair-id">${p.display}</span>
            <span class="pair-cn">${p.name}</span>
            <span class="pair-price num">${U.price(q.mid, p.digits)}</span>
            <span class="pair-chg num ${this.signClass(chg)}">${U.pct(chg)}</span>
            <span class="pair-spread">点差 ${q.spreadPips.toFixed(1)}</span>
          </button>`;
        }
      }
      const el = $('pairList');
      const key = filter + '|' + g.selectedPair + '|' + shown.map((x) => x.p.id + (x.tradable ? '1' : '0') + (x.hasQuote ? '1' : '0')).join(',');
      if (this._pairKey !== key) {
        // 结构变化（搜索/选中/模式）时才重建 DOM，避免行情 tick 把正在点击的按钮换掉
        this._pairKey = key;
        el.innerHTML = html || '<div class="empty-state"><strong>没有匹配的货币对。</strong><span>试试 EUR、USD，或清空搜索。</span></div>';
      } else {
        // 只更新价格文本，节点保持稳定，触摸点击不会丢
        for (const x of shown) {
          const row = el.querySelector(`.pair-row[data-pair="${x.p.id}"]`);
          if (!row) continue;
          const q = g.market.quotes[x.p.id];
          if (!q) continue;
          const series = g.market.series(x.p.id, '1d');
          const base = series.bars.length ? series.bars[series.bars.length - 1].c : q.mid;
          const chg = base ? ((q.mid - base) / base) * 100 : 0;
          const priceEl = row.querySelector('.pair-price');
          if (priceEl) priceEl.textContent = U.price(q.mid, x.p.digits);
          const chgEl = row.querySelector('.pair-chg');
          if (chgEl) {
            chgEl.textContent = U.pct(chg);
            chgEl.className = 'pair-chg num ' + this.signClass(chg);
          }
          const spEl = row.querySelector('.pair-spread');
          if (spEl) spEl.textContent = '点差 ' + q.spreadPips.toFixed(1);
          row.classList.toggle('selected', x.p.id === g.selectedPair);
        }
      }
      const spread = g.currentQuote();
      const notice = $('spreadNotice');
      if (spread) {
        if (spread.spreadPips > FX.PAIR_MAP[g.selectedPair].spread * 2) {
          notice.textContent = '⚠ 点差扩大';
          notice.className = 'spread-note warn';
        } else {
          notice.textContent = '点差正常';
          notice.className = 'spread-note';
        }
      }
    }

    renderChart() {
      const g = this.game;
      const p = FX.PAIR_MAP[g.selectedPair];
      const q = g.currentQuote();
      const s = g.currentSeries();
      const positions = g.account.positions.filter((x) => x.pairId === g.selectedPair).map((x) => ({
        side: x.side, entry: x.entry, sl: x.sl, tp: x.tp, lots: x.lots, liq: null,
      }));
      const orders = g.account.orders.filter((o) => o.pairId === g.selectedPair && o.status === 'working').map((o) => ({
        side: o.side, price: o.price, type: o.type,
      }));
      const dist = g.account.liquidationDistance();
      let liqPrice = null;
      if (dist != null && q && positions.length) {
        let net = 0;
        for (const x of g.account.positions) {
          if (x.pairId !== g.selectedPair) continue;
          net += x.side * x.lots;
        }
        if (Math.abs(net) > 1e-9) liqPrice = q.mid - Math.sign(net) * dist * p.pip;
        if (liqPrice != null && (liqPrice <= 0 || Math.abs(liqPrice - q.mid) > q.mid * 0.5)) liqPrice = null;
      }
      let events = [];
      if (g.market.calendar && g.market.calendar.length) {
        const firstT = s.bars.length ? s.bars[0].t : 0;
        const lastT = s.forming ? s.forming.t : s.bars.length ? s.bars[s.bars.length - 1].t : Infinity;
        events = g.market.calendar
          .map((e) => {
            let ms = e.time;
            if (!ms && e.date) ms = U.parseISO(e.date).getTime();
            return ms ? { t: Math.floor(ms / 60000), imp: e.imp || 2, title: e.title } : null;
          })
          // 只画已经发生、且落在当前可见时间范围内的标记
          .filter((e) => e && e.t >= firstT && e.t <= lastT)
          .slice(-12);
      }
      const model = {
        bars: s.bars,
        forming: s.forming,
        digits: p.digits,
        pip: p.pip,
        pairLabel: p.display,
        tfLabel: this.mapTfLabel(),
        modeLabel: $('modeBadge').textContent,
        bid: q ? q.bid : null,
        ask: q ? q.ask : null,
        spreadPips: q ? q.spreadPips : null,
        overlays: { positions, orders, liqPrice, liqDistancePips: dist },
        events,
        sessionLabel: g.market.sessionLabel ? g.market.sessionLabel() : '',
        emptyText: '正在读取行情…',
      };
      let chartOk = true;
      let chartMsg = '';
      try {
        chartOk = this.chart.render(model) !== false;
      } catch (err) {
        // 图表绘制失败时不让整个界面跟着挂掉
        chartOk = false;
        console.error('chart render failed', err);
        chartMsg = '当前设备无法绘制图表：' + (err && err.message ? err.message : err);
      }
      if (!chartOk) {
        const el = $('chartEmpty');
        el.textContent = chartMsg || this.chart.errorMessage ||
          ('图表尺寸异常：画布 ' + (this.chart.w || 0) + '×' + (this.chart.h || 0) +
           '，窗口 ' + window.innerWidth + '×' + window.innerHeight);
        el.classList.remove('hidden');
      } else {
        $('chartEmpty').classList.toggle('hidden', !!(s.bars.length || s.forming));
      }
      const count = s.bars.length + (s.forming ? 1 : 0);
      $('chartFootRight').textContent = `${p.display} · ${this.mapTfLabel()} · ${count} 根`;
      $('chartLegend').textContent = g.mode === 'history' || g.mode === 'battle' ? 'ECB 日度参考价 · 盘中为估算' : '合成行情 · 仅供游戏';
    }

    renderPlayback() {
      const g = this.game;
      const isHist = g.mode === 'history' || g.mode === 'battle';
      $('playbackControls').classList.toggle('hidden', !isHist);
      if (!isHist) return;
      const pct = g.progressPct();
      $('dayProgress').value = String(Math.round(pct));
      const prog = g.market.progress ? g.market.progress() : null;
      $('playbackDate').textContent = prog ? `${prog.date || '—'}  ·  ${Math.min(prog.i + 1, prog.total)} / ${prog.total}` : '—';
      const autoBtn = $('autoBtn');
      autoBtn.innerHTML = `<svg class="ico"><use href="#${g.autoPlay ? 'i-pause' : 'i-play'}"/></svg>`;
      autoBtn.classList.toggle('active', g.autoPlay);
      $('nextDayBtn').disabled = !isHist || g._histBusy || (g.market && g.market.done);
    }

    renderNewsTicker() {
      const g = this.game;
      const news = (g.market.news || [])[0];
      const track = $('tickerTrack');
      if (!news) {
        track.textContent = g.mode === 'history' || g.mode === 'battle' ? '历史事件会在到达当日时推送。' : '等待市场消息…';
        $('tickerTag').textContent = '快讯';
        $('tickerTag').className = 'ticker-tag info';
        return;
      }
      track.textContent = news.title;
      const tag = $('tickerTag');
      tag.textContent = news.tag || '快讯';
      tag.className = 'ticker-tag ' + (FX.newsTagClass(news.tag) || 'info');
    }

    renderCalendarCount() {
      const g = this.game;
      const evs = g.market.upcomingEvents ? g.market.upcomingEvents(20) : [];
      $('eventCount').textContent = String(evs.length);
      $('eventCount').style.display = evs.length ? '' : 'none';
    }

    renderDesk() {
      const g = this.game;
      const acc = g.account;
      $('posCount').textContent = String(acc.positions.length);
      $('ordCount').textContent = String(acc.orders.filter((o) => o.status === 'working').length);
      $('hisCount').textContent = String(acc.history.length);
      $('closeAllBtn').disabled = !acc.positions.length;
      const working = acc.orders.filter((o) => o.status === 'working');
      // 结构指纹：只有持仓/挂单/成交变化时才重建 DOM，行情 tick 只更新数字
      const deskKey = acc.positions.map((x) => `${x.id}:${x.lots}:${x.sl}:${x.tp}`).join('|')
        + '#' + working.map((o) => o.id).join(',')
        + '#' + acc.history.slice(0, 40).map((h) => h.id).join(',');
      const rebuildDesk = deskKey !== this._deskKey;
      this._deskKey = deskKey;

      // 持仓
      let html = '';
      if (!acc.positions.length) {
        html = this.empty('还没有持仓。', '选择货币对，打开下单票开出第一笔交易。');
      } else {
        for (const pos of acc.positions) {
          const p = FX.PAIR_MAP[pos.pairId];
          const q = g.market.quotes[pos.pairId];
          const pnl = acc.posPnl(pos);
          const exit = pos.side > 0 ? q.bid : q.ask;
          const m = acc.metrics();
          const ratio = pos.margin > 0 ? -pnl / pos.margin : 0;
          const danger = ratio > 0.6;
          const liq = ratio > 0.9;
          html += `<div class="position-card ${pos.side > 0 ? 'long' : 'short'}${danger ? ' danger' : ''}${liq ? ' liq' : ''}" data-pos="${pos.id}">
            <div class="pos-main">
              <div class="pos-left">
                <span class="pos-pair">${p.display}</span>
                <span class="pos-side ${pos.side > 0 ? 'up' : 'down'}">${pos.side > 0 ? '多' : '空'}</span>
                <span class="pos-lots">${pos.lots.toFixed(2)} 手</span>
                <span class="pos-tag">${pos.tag === 'limit' ? '限价' : pos.tag === 'stop' ? '止损单' : '市价'}</span>
              </div>
              <strong class="pos-pnl num ${pnl > 0.005 ? 'up' : pnl < -0.005 ? 'down' : ''}">${U.moneySigned(pnl)}</strong>
            </div>
            <div class="pos-sub">
              <span>开仓 <b class="num">${U.price(pos.entry, p.digits)}</b> → <b class="num pos-exit">${U.price(exit, p.digits)}</b></span>
              <span>保证金 <b class="num">${U.money(pos.margin)}</b></span>
            </div>
            <div class="pos-meta">
              <span>SL <b class="num">${pos.sl != null ? U.price(pos.sl, p.digits) : '—'}</b></span>
              <span>TP <b class="num">${pos.tp != null ? U.price(pos.tp, p.digits) : '—'}</b></span>
              <span class="pos-risk-text">${danger ? '距强平危险' : '隔夜利息按日结算'}</span>
            </div>
            <div class="pos-actions">
              <button class="pos-btn" data-act="modify" type="button">改止损</button>
              <button class="pos-btn" data-act="half" type="button"${pos.lots <= 0.01 ? ' disabled title="手数过小，无法部分平仓"' : ''}>平 50%</button>
              <button class="pos-btn primary" data-act="close" type="button">平仓</button>
            </div>
          </div>`;
        }
      }
      if (rebuildDesk) $('positionsList').innerHTML = html;
      else {
        for (const pos of acc.positions) {
          const card = $('positionsList').querySelector(`[data-pos="${pos.id}"]`);
          if (!card) continue;
          const q = g.market.quotes[pos.pairId];
          const pnl = acc.posPnl(pos);
          const exitEl = card.querySelector('.pos-exit');
          if (exitEl && q) exitEl.textContent = U.price(pos.side > 0 ? q.bid : q.ask, FX.PAIR_MAP[pos.pairId].digits);
          const pnlEl = card.querySelector('.pos-pnl');
          if (pnlEl) {
            pnlEl.textContent = U.moneySigned(pnl);
            pnlEl.className = 'pos-pnl num ' + (pnl > 0.005 ? 'up' : pnl < -0.005 ? 'down' : '');
          }
          const ratio = pos.margin > 0 ? -pnl / pos.margin : 0;
          const danger = ratio > 0.6;
          const liq = ratio > 0.9;
          card.classList.toggle('danger', danger);
          card.classList.toggle('liq', liq);
          const riskEl = card.querySelector('.pos-risk-text');
          if (riskEl) riskEl.textContent = danger ? '距强平危险' : '隔夜利息按日结算';
        }
      }

      // 挂单
      let ohtml = '';
      if (!working.length) ohtml = this.empty('没有挂单。', '限价/止损单会在价格触及时成交。');
      else {
        for (const o of working) {
          const p = FX.PAIR_MAP[o.pairId];
          ohtml += `<div class="order-card" data-order="${o.id}">
            <div class="pos-main">
              <div class="pos-left">
                <span class="pos-pair">${p.display}</span>
                <span class="pos-side ${o.side > 0 ? 'up' : 'down'}">${o.side > 0 ? '买入' : '卖出'}${o.type === 'limit' ? '限价' : '止损'}</span>
                <span class="pos-lots">${o.lots.toFixed(2)} 手</span>
              </div>
              <strong class="num">@ ${U.price(o.price, p.digits)}</strong>
            </div>
            <div class="pos-sub"><span>止损 ${o.sl ? U.price(o.sl, p.digits) : '—'} · 止盈 ${o.tp ? U.price(o.tp, p.digits) : '—'}</span></div>
            <div class="pos-actions"><button class="pos-btn" data-act="cancel" type="button">撤单</button></div>
          </div>`;
        }
      }
      if (rebuildDesk) $('ordersList').innerHTML = ohtml;

      // 历史
      let hhtml = '';
      if (!acc.history.length) hhtml = this.empty('还没有成交记录。', '平仓后这里会出现每一笔结果。');
      else {
        for (const h of acc.history.slice(0, 40)) {
          const p = FX.PAIR_MAP[h.pairId];
          const d = h.closedAt ? new Date(h.closedAt) : null;
          const dateStr = d ? `${U.pad2(d.getMonth() + 1)}-${U.pad2(d.getDate())} ${U.pad2(d.getHours())}:${U.pad2(d.getMinutes())}` : '—';
          hhtml += `<div class="history-row ${h.pnl >= 0 ? 'win' : 'loss'}">
            <div class="pos-main">
              <div class="pos-left">
                <span class="pos-pair">${p.display}</span>
                <span class="pos-side ${h.side > 0 ? 'up' : 'down'}">${h.side > 0 ? '多' : '空'}</span>
                <span class="pos-lots">${h.lots.toFixed(2)} 手</span>
                <span class="reason-tag">${this.reasonText(h.reason)}</span>
              </div>
              <strong class="pos-pnl num ${h.pnl > 0.005 ? 'up' : h.pnl < -0.005 ? 'down' : ''}">${U.moneySigned(h.pnl)}</strong>
            </div>
            <div class="pos-sub"><span class="num">${U.price(h.entry, p.digits)} → ${U.price(h.exit, p.digits)}</span><span>${dateStr}</span></div>
          </div>`;
        }
      }
      if (rebuildDesk) $('historyList').innerHTML = hhtml;
    }

    reasonText(r) {
      return { manual: '手动', sl: '止损', tp: '止盈', stopout: '强平', settle: '结算', closeAll: '全平' }[r] || r || '—';
    }

    empty(title, sub) {
      return `<div class="empty-state"><strong>${title}</strong><span>${sub}</span></div>`;
    }

    // ---------- 下单票 ----------
    renderTicketPreview() {
      const g = this.game;
      const acc = g.account;
      const p = FX.PAIR_MAP[g.selectedPair];
      const q = g.currentQuote();
      const eq = acc.metrics().equity;
      const broke = !isFinite(eq) || eq <= 0.01;
      const tradable = g.isTradable(g.selectedPair) && q && !acc.halted && !broke;
      $('longBtn').disabled = !tradable;
      $('shortBtn').disabled = !tradable;
      const typeLabel = { market: '做多', limit: '挂多单', stop: '突破买入' };
      const typeLabelS = { market: '做空', limit: '挂空单', stop: '突破卖出' };
      $('longBtn').querySelector('span').innerHTML = `${typeLabel[this.orderType]} <em>买入</em>`;
      $('shortBtn').querySelector('span').innerHTML = `${typeLabelS[this.orderType]} <em>卖出</em>`;
      $('triggerRow').classList.toggle('hidden', this.orderType === 'market');
      if (!q) return;
      const lots = U.clamp(U.num($('lotsInput').value, 0.01), 0.01, acc.maxLots);
      const lev = acc.leverage;
      const pv = acc.preview({ pairId: g.selectedPair, side: 1, lots, leverage: lev });
      const pvS = acc.preview({ pairId: g.selectedPair, side: -1, lots, leverage: lev });
      $('pvNotional').textContent = U.money(FX.notionalUSD(g.selectedPair, lots, g.market.quotes), 0);
      $('pvMargin').textContent = U.money(pv.margin);
      $('pvFee').textContent = U.money(pv.commission);
      $('pvPip').textContent = U.money(pv.pipVal);
      const okLiq = (x) => x.liqPrice != null && x.liqPips > 0 && x.liqPrice > q.mid * 0.5 && x.liqPrice < q.mid * 1.5;
      $('pvLiq').textContent = okLiq(pv) && okLiq(pvS)
        ? `多 ${U.price(pv.liqPrice, p.digits)} / 空 ${U.price(pvS.liqPrice, p.digits)}`
        : '—';
      const slPips = U.num($('slInput').value, 0);
      $('pvSlLoss').textContent = slPips > 0 ? '-' + U.money(slPips * pv.pipVal) : '—';
      $('pvSpread').textContent = U.money(pv.spreadCost);
      $('pvLiqDist').textContent = pv.liqPips != null && pv.liqPips > 0 && pvS.liqPips > 0
        ? `多 ${Math.round(pv.liqPips)} / 空 ${Math.round(pvS.liqPips)} 点`
        : '—';
      const note = $('orderNote');
      if (acc.halted) note.textContent = '账户已穿仓，交易停止。重置或切换模式后可继续。';
      else if (broke) note.textContent = '账户权益已归零，无法继续开仓。可以重置当前模式，或换一个模式。';
      else if (acc.leverage >= 200) note.textContent = '高杠杆下，一次正常波动就可能触发追保或强平。杠杆不改变方向，只缩短反应时间。';
      else note.textContent = '买入按卖价成交，卖出按买价成交；开仓即承担一个点差的浮亏。1 手 = 100,000 基础货币。';
      // 触发价默认
      if (this.orderType !== 'market' && !U.num($('triggerInput').value, 0)) {
        $('triggerInput').value = p ? q.mid.toFixed(p.digits) : '';
      }
    }

    collectOrder(side) {
      const g = this.game;
      return {
        lots: U.num($('lotsInput').value, 0.01),
        orderType: this.orderType,
        triggerPrice: U.num($('triggerInput').value, 0),
        slPips: U.num($('slInput').value, 0),
        tpPips: U.num($('tpInput').value, 0),
        trailPips: U.num($('trailInput').value, 0),
        side,
      };
    }

    // ---------- 事件绑定 ----------
    bind() {
      const g = this.game;
      // 模式切换
      U.$$('#modeTabs .mode-tab').forEach((b) => {
        b.onclick = () => {
          const mode = b.dataset.mode;
          if (mode === 'sim') {
            if (g.mode === 'sim') return;
            g.running = true;
            g.activateMode('sim');
          } else if (mode === 'history') {
            this.openHistoryModal();
          } else if (mode === 'battle') {
            this.openBattleModal();
          } else if (mode === 'challenge') {
            this.openChallengeModal();
          }
        };
      });
      // 顶栏
      $('tutorialBtn').onclick = () => this.openTutorial(0);
      $('statsBtn').onclick = () => this.openStats();
      $('achBtn').onclick = () => this.openAch();
      $('shareBtn').onclick = () => this.openShare();
      $('settingsBtn').onclick = () => this.openSettings();
      $('resetBtn').onclick = () => this.confirmReset();
      // 搜索
      $('pairSearch').oninput = () => this.renderPairList();
      // 货币对点击：事件委托，列表节点刷新也不会丢点击
      $('pairList').addEventListener('click', (e) => {
        const row = e.target.closest('.pair-row[data-pair]');
        if (!row) return;
        if (!g.isTradable(row.dataset.pair)) {
          this.toast(`本模式只能交易 ${FX.PAIR_MAP[g.selectedPair].display}。`, 'info');
          return;
        }
        g.selectedPair = row.dataset.pair;
        $('triggerInput').value = '';
        if (FX.Audio) FX.Audio.click();
        this.scheduleRender();
      });
      // 持仓 / 挂单按钮：事件委托，列表局部更新也不会丢点击
      $('positionsList').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        const card = btn && btn.closest('[data-pos]');
        if (!btn || !card) return;
        const id = card.dataset.pos;
        const act = btn.dataset.act;
        if (act === 'close') this.game.closePosition(id);
        else if (act === 'half') {
          const pos = this.game.account.positions.find((x) => x.id === id);
          if (!pos) return;
          if (pos.lots <= 0.01) { this.toast('手数已经是 0.01，无法再部分平仓。', 'warn'); return; }
          this.game.closePositionPartial(id, Math.max(0.01, Math.round((pos.lots / 2) * 100) / 100));
        } else if (act === 'modify') this.openModifyModal(id);
      });
      $('ordersList').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act="cancel"]');
        const card = btn && btn.closest('[data-order]');
        if (btn && card) this.game.cancelOrder(card.dataset.order);
      });
      // 时间周期
      // 回放
      $('nextDayBtn').onclick = () => {
        if (FX.Audio) FX.Audio.click();
        g.nextDay();
      };
      $('autoBtn').onclick = () => {
        if (FX.Audio) FX.Audio.click();
        g.toggleAuto();
        this.renderPlayback();
      };
      $('dayProgress').onchange = (e) => {
        if (g.account.positions.length) {
          this.toast('有持仓时不能跳转回放进度，请先平仓。', 'warn');
          this.renderPlayback();
          return;
        }
        const want = U.num(e.target.value, 0);
        if (want < g.progressPct() - 0.5) {
          this.toast('回放只能向前，不能倒带。', 'warn');
          this.renderPlayback();
          return;
        }
        g.seekHistory(want);
        this.scheduleRender();
      };
      $('fitBtn').onclick = () => this.scheduleRender();
      U.$$('#speedSeg button').forEach((b) => {
        b.onclick = () => {
          const n = Number(b.dataset.speed) || 1;
          g.speed = n;
          g.setSetting('speed', n);
          this.syncSpeedUI();
        };
      });
      // 新闻/日历
      $('newsBtn').onclick = () => this.openNewsCenter();
      $('calendarBtn').onclick = () => this.openCalendar();
      $('newsFloatClose').onclick = () => this.hideNewsFloat();
      // 交易台
      U.$$('#deskTabs .desk-tab').forEach((t) => {
        t.onclick = () => {
          this.deskTab = t.dataset.tab;
          U.$$('#deskTabs .desk-tab').forEach((x) => x.classList.toggle('active', x === t));
          U.$$('.desk-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === this.deskTab));
        };
      });
      $('closeAllBtn').onclick = () => this.confirmCloseAll();
      // 订单类型
      U.$$('#orderTypeSeg button').forEach((b) => {
        b.onclick = () => {
          this.orderType = b.dataset.type;
          U.$$('#orderTypeSeg button').forEach((x) => x.classList.toggle('active', x === b));
          this.renderTicketPreview();
        };
      });
      $('lotsInput').oninput = () => this.renderTicketPreview();
      U.$$('.quick-lots button').forEach((b) => {
        b.onclick = () => {
          if (b.dataset.lots === 'max') {
            const lots = FX.maxLots(g.selectedPair, g.account.metrics().free, g.market.quotes, g.account.leverage, g.account.maxLots);
            $('lotsInput').value = Math.max(0.01, Math.floor(lots * 100) / 100).toFixed(2);
          } else $('lotsInput').value = b.dataset.lots;
          this.renderTicketPreview();
        };
      });
      ['slInput', 'tpInput', 'trailInput', 'triggerInput'].forEach((id) => {
        $(id).oninput = () => this.renderTicketPreview();
      });
      $('riskSizeBtn').onclick = () => {
        const sl = U.num($('slInput').value, 0);
        if (sl <= 0) {
          this.toast('先在止损里填一个点数（例如 30），才能按 2% 风险算手数。', 'warn');
          return;
        }
        const perLot = FX.pipValueUSD(g.selectedPair, 1, g.market.quotes);
        const eq = g.account.metrics().equity;
        const lots = Math.floor(((eq * 0.02) / (sl * perLot)) * 100) / 100;
        const safe = U.clamp(lots, 0.01, g.account.maxLots);
        $('lotsInput').value = safe.toFixed(2);
        this.toast(`按 2% 权益风险，止损 ${sl} 点，约 ${safe.toFixed(2)} 手。`, 'info');
        this.renderTicketPreview();
      };
      $('triggerUseBidAsk').onclick = () => {
        const q = g.currentQuote();
        const p = FX.PAIR_MAP[g.selectedPair];
        if (q) $('triggerInput').value = q.mid.toFixed(p.digits);
      };
      $('leverageSelect').onchange = (e) => {
        g.setLeverage(U.num(e.target.value, 100));
        this.renderTicketPreview();
      };
      $('longBtn').onclick = () => {
        if (FX.Audio) FX.Audio.click();
        g.trade(1, this.collectOrder(1));
      };
      $('shortBtn').onclick = () => {
        if (FX.Audio) FX.Audio.click();
        g.trade(-1, this.collectOrder(-1));
      };
      // 弹窗通用关闭
      $('modalClose').onclick = () => this.closeModal();
      $('modal').addEventListener('click', (e) => {
        if (e.target === $('modal')) this.closeModal();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.closeTopModal();
        else if (e.key === 'Tab') this._trapTab(e);
      });
      // 各弹窗关闭
      const closePairs = [
        ['tutClose', 'tutorialModal'], ['achClose', 'achModal'], ['statsClose', 'statsModal'],
        ['statsOk', 'statsModal'], ['setClose', 'settingsModal'], ['setOk', 'settingsModal'],
        ['battleClose', 'battleModal'], ['storyClose', 'storyModal'], ['storyCancel', 'storyModal'],
        ['chClose', 'challengeModal'], ['shareClose', 'shareModal'], ['shareClose2', 'shareModal'],
        ['calClose', 'calModal'], ['calOk', 'calModal'], ['newsClose', 'newsModal'], ['newsOk', 'newsModal'],
      ];
      closePairs.forEach(([btn, modal]) => {
        if ($(btn)) $(btn).onclick = () => this.closeModalById(modal);
      });
      // 教程
      $('tutBack').onclick = () => this.openTutorial(this.tutIndex - 1);
      $('tutNext').onclick = () => {
        if (this.tutIndex >= TUTORIAL.length - 1) this.closeModalById('tutorialModal');
        else this.openTutorial(this.tutIndex + 1);
      };
      // 设置
      U.$$('#themeSeg button').forEach((b) => {
        b.onclick = () => {
          g.setSetting('theme', b.dataset.theme);
          this.applySettingsUI();
          this.scheduleRender();
        };
      });
      U.$$('#updownSeg button').forEach((b) => {
        b.onclick = () => {
          g.setSetting('updown', b.dataset.updown);
          this.applySettingsUI();
          this.scheduleRender();
        };
      });
      U.$$('#freqSeg button').forEach((b) => {
        b.onclick = () => {
          g.setSetting('freq', b.dataset.freq);
          this.applySettingsUI();
        };
      });
      $('soundToggle').onchange = (e) => g.setSetting('sound', e.target.checked);
      $('newsToggle').onchange = (e) => g.setSetting('news', e.target.checked);
      $('nbpToggle').onchange = (e) => {
        g.setSetting('nbp', !e.target.checked);
        if (g.account) g.account.nbp = !e.target.checked;
      };
      $('levWarnToggle').onchange = (e) => g.setSetting('levWarn', e.target.checked);
      $('setClear').onclick = () => {
        this.openModal({
          title: '清除全部存档', icon: 'alert',
          body: '<p>将删除账户、成就、战役星级与每日挑战记录，且<strong>不可撤销</strong>。</p>',
          actions: [
            { label: '取消', cls: 'outline-button', close: true },
            { label: '确认清除', cls: 'danger-button', close: true, onClick: () => g.clearAll() },
          ],
        });
      };
      // 存档导出 / 导入
      $('setExport').onclick = () => this.openExportSave();
      $('setImport').onclick = () => this.openImportSave();
      // 每日挑战
      $('chStart').onclick = () => {
        if (g.mode === 'challenge' && g.challenge && !g.challenge.finished) {
          this.closeModalById('challengeModal');
          return;
        }
        if (g.startChallenge()) this.closeModalById('challengeModal');
      };
      $('chRetire').onclick = () => {
        if (g.mode === 'challenge' && g.challenge && !g.challenge.finished) {
          this.closeModalById('challengeModal');
          g.finishChallenge(true);
        } else this.toast('先开始一局每日挑战。', 'info');
      };
    }

    applySettingsUI() {
      const s = this.game.settings;
      U.$$('#themeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.theme === s.theme));
      U.$$('#updownSeg button').forEach((b) => b.classList.toggle('active', b.dataset.updown === s.updown));
      U.$$('#freqSeg button').forEach((b) => b.classList.toggle('active', b.dataset.freq === s.freq));
      $('soundToggle').checked = !!s.sound;
      $('newsToggle').checked = !!s.news;
      $('nbpToggle').checked = !s.nbp;
      $('levWarnToggle').checked = !!s.levWarn;
    }

    tickClock() {
      const g = this.game;
      if (!g.market) return;
      $('clockText').textContent = g.timeLabel();
      // 挑战倒计时
      if (g.mode === 'challenge' && g.market) {
        const left = Math.max(0, 10 - (g.market.dayCount || 0));
        $('clockText').textContent = g.timeLabel() + ` · 剩余 ${left} 个交易日`;
      }
    }

    // ---------- 弹窗基础 ----------
    openModal({ title, body, icon, actions, wide, id }) {
      const modal = $('modal');
      const dialog = modal.querySelector('.modal');
      if (dialog) dialog.classList.toggle('wide', !!wide);
      $('modalTitle').textContent = title || '';
      $('modalBody').innerHTML = body || '';
      $('modalIcon').innerHTML = `<svg class="ico"><use href="#i-${icon || 'info'}"/></svg>`;
      const wrap = $('modalActions');
      wrap.innerHTML = '';
      const list = actions && actions.length ? actions : [{ label: '知道了', cls: 'primary-button', close: true }];
      for (const a of list) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = a.cls || 'outline-button';
        btn.textContent = a.label;
        btn.onclick = () => {
          const res = a.onClick ? a.onClick() : undefined;
          if (a.close && res !== false) this.closeModal();
        };
        wrap.appendChild(btn);
      }
      modal.classList.remove('hidden');
      this._modalStack.push('modal');
      this._trapModal = modal;
      this._lastFocus = document.activeElement;
      setTimeout(() => this._focusFirst(modal), 0);
      return modal;
    }

    _restoreFocus() {
      this._trapModal = null;
      if (this._lastFocus && document.contains(this._lastFocus)) {
        try { this._lastFocus.focus(); } catch (e) {}
      }
    }

    closeModal() {
      $('modal').classList.add('hidden');
      this._modalStack = this._modalStack.filter((x) => x !== 'modal');
      this._restoreFocus();
    }

    closeModalById(id) {
      const el = $(id);
      if (!el) return;
      const wasOpen = !el.classList.contains('hidden');
      el.classList.add('hidden');
      if (wasOpen && this._trapModal && (this._trapModal === el || this._trapModal.parentElement === el)) this._restoreFocus();
    }

    closeTopModal() {
      const ids = ['modal', 'tutorialModal', 'achModal', 'statsModal', 'settingsModal', 'battleModal', 'storyModal', 'challengeModal', 'settleModal', 'shareModal', 'calModal', 'newsModal'];
      for (const id of ids) {
        const el = $(id);
        if (el && !el.classList.contains('hidden')) {
          el.classList.add('hidden');
          if (this._trapModal && (this._trapModal === el || this._trapModal.parentElement === el)) this._restoreFocus();
          return;
        }
      }
    }

    showModalById(id) {
      const el = $(id);
      if (!el) return;
      const wasOpen = !el.classList.contains('hidden');
      el.classList.remove('hidden');
      if (!wasOpen) {
        this._trapModal = el.querySelector('.modal') || el;
        this._lastFocus = document.activeElement;
        setTimeout(() => this._focusFirst(this._trapModal), 0);
      }
    }

    _focusFirst(root) {
      if (!root) return;
      const f = root.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
      if (f) { try { f.focus(); } catch (e) {} }
    }

    _trapTab(e) {
      const root = this._trapModal;
      if (!root || root.classList.contains('hidden') || root.offsetParent === null) return;
      const items = U.$$('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])', root)
        .filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    toast(msg, kind) {
      const wrap = $('toast');
      const el = document.createElement('div');
      el.className = 'toast-item ' + (kind || 'info');
      el.textContent = msg;
      // 最多保留 4 条，避免刷屏
      while (wrap.children.length >= 4) wrap.removeChild(wrap.firstChild);
      wrap.appendChild(el);
      setTimeout(() => {
        el.classList.add('out');
        setTimeout(() => el.remove(), 220);
      }, 2600);
    }

    // ---------- 新闻 ----------
    onNews(item) {
      if (FX.Audio) FX.Audio.news();
      this.newsQueue.push(item);
      if (!this.newsShowing) this.showNextNews();
      this.renderNewsTicker();
    }

    showNextNews() {
      const item = this.newsQueue.shift();
      if (!item) {
        this.newsShowing = false;
        return;
      }
      this.newsShowing = true;
      const box = $('newsFloat');
      $('nfTag').textContent = item.tag || '快讯';
      $('nfTag').className = 'nf-tag ' + (FX.newsTagClass(item.tag) || 'info');
      $('nfTitle').textContent = item.title || '';
      $('nfBody').textContent = item.body || '';
      $('nfDate').textContent = item.time ? new Date(item.time).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '';
      box.classList.remove('hidden');
      clearTimeout(this._nfTimer);
      this._nfTimer = setTimeout(() => this.hideNewsFloat(), 8000);
    }

    hideNewsFloat() {
      $('newsFloat').classList.add('hidden');
      this.newsShowing = false;
      clearTimeout(this._nfTimer);
      setTimeout(() => this.showNextNews(), 350);
    }

    openNewsCenter() {
      const news = (this.game.market.news || []).slice(0, 50);
      const body = news.length
        ? news.map((n) => `<div class="news-item"><div class="news-meta"><span class="news-tag ${FX.newsTagClass(n.tag)}">${n.tag || '快讯'}</span><span class="news-time">${n.time ? new Date(n.time).toISOString().slice(5, 16).replace('T', ' ') : ''}</span></div><strong class="news-title">${n.title}</strong><p class="news-body">${n.body || ''}</p></div>`).join('')
        : '<div class="empty-state"><strong>还没有快讯。</strong><span>模拟行情会定期生成新闻与数据。</span></div>';
      this.openModal({ title: '新闻中心', icon: 'info', body: `<div class="news-center-list">${body}</div>`, actions: [{ label: '关闭', cls: 'primary-button', close: true }] });
    }

    openCalendar() {
      const g = this.game;
      if (g.mode === 'history' || g.mode === 'battle') {
        const news = ((g.scenario && g.scenario.news) || []).slice(0, 30);
        const body = news.length
          ? news.map((n) => `<div class="cal-item"><span class="cal-time num">${n.date}</span><span class="cal-ccy">${n.tag || '事件'}</span><div class="cal-main"><strong class="cal-title">${n.title}</strong><span class="cal-values">${n.body || ''}</span></div><span class="cal-imp">${'★'.repeat(n.imp || 2)}</span></div>`).join('')
          : '<div class="empty-state"><strong>这场回放没有剧本事件。</strong><span>免费历史回放不带新闻；经典战役才有。</span></div>';
        this.openModal({ title: g.scenario ? '战役事件表' : '回放事件表', icon: 'calendar', body: `<div class="cal-list">${body}</div>`, actions: [{ label: '关闭', cls: 'primary-button', close: true }] });
        return;
      }
      const evs = g.market.calendar ? g.market.calendar.slice(0, 20) : [];
      const now = g.market.now.getTime();
      const body = evs.length
        ? evs.map((e) => {
            const t = new Date(e.time);
            const time = `${U.pad2(t.getUTCMonth() + 1)}-${U.pad2(t.getUTCDate())} ${U.pad2(t.getUTCHours())}:${U.pad2(t.getUTCMinutes())}`;
            const done = e.fired || e.time <= now;
            const imp = '★'.repeat(e.imp);
            return `<div class="cal-item${done ? ' done' : ''}">
              <span class="cal-time num">${time}</span>
              <span class="cal-ccy">${e.ccy}</span>
              <div class="cal-main"><strong class="cal-title">${e.title}</strong><span class="cal-values">预期 ${e.forecast}${e.unit}${done ? ` · <b class="cal-actual">实际 ${e.actual}${e.unit}</b>` : ''}</span></div>
              <span class="cal-imp" title="重要度">${imp}</span>
            </div>`;
          }).join('')
        : '<div class="empty-state"><strong>暂无日历事件。</strong><span>历史回放模式不生成模拟数据日历。</span></div>';
      this.openModal({ title: '财经日历', icon: 'calendar', body: `<p class="modal-sub">公布时价格会瞬间跳变，点差扩大，止损可能被滑点穿透。</p><div class="cal-list">${body}</div>`, actions: [{ label: '关闭', cls: 'primary-button', close: true }] });
    }

    // ---------- 历史回放设置 ----------
    openHistoryModal() {
      const g = this.game;
      const H = FX.HISTORY;
      const dates = H.dates.filter((d) => d <= U.dateISO(new Date()));
      const end = dates[dates.length - 1];
      const start = dates[Math.max(0, dates.length - 366)];
      const pairOptions = FX.PAIRS.map((p) => `<option value="${p.id}"${p.id === g.selectedPair ? ' selected' : ''}>${p.display} · ${p.name}</option>`).join('');
      this.openModal({
        title: '历史回放', icon: 'chart',
        body: `<p class="modal-sub">用欧洲央行 1999–2026 的日度参考汇率重演真实行情。只能交易所选货币对。</p>
          <div class="form-grid">
            <label class="form-field"><span>货币对</span><select id="histPair">${pairOptions}</select></label>
            <label class="form-field"><span>起始日期</span><input id="histStart" type="date" value="${start}" min="1999-01-04" max="${end}"></label>
            <label class="form-field"><span>结束日期</span><input id="histEnd" type="date" value="${end}" min="1999-01-04" max="${end}"></label>
          </div>
          <div class="quick-range" id="histQuick">
            <button type="button" data-days="90">90 天</button>
            <button type="button" data-days="180">180 天</button>
            <button type="button" data-days="365">365 天</button>
            <button type="button" data-days="730">2 年</button>
            <button type="button" data-days="0">全部</button>
          </div>`,
        actions: [
          { label: '取消', cls: 'outline-button', close: true },
          {
            label: '开始回放', cls: 'primary-button',
            onClick: () => {
              const pairId = $('histPair').value;
              let s = $('histStart').value;
              let e = $('histEnd').value;
              if (!s || !e || s > e) {
                this.toast('日期区间无效。', 'bad');
                return false;
              }
              this.closeModal();
              g.running = true;
              g.startHistory({ pairId, start: s, end: e });
              this.scheduleRender();
            },
          },
        ],
      });
      U.$$('#histQuick button').forEach((b) => {
        b.onclick = () => {
          const days = Number(b.dataset.days);
          const e = dates[dates.length - 1];
          if (!days) {
            $('histStart').value = dates[0];
            $('histEnd').value = e;
            return;
          }
          const idx = Math.max(0, dates.length - days);
          $('histStart').value = dates[idx];
          $('histEnd').value = e;
        };
      });
    }

    // ---------- 战役 ----------
    battleStars() {
      const b = this.game.profile.battles || {};
      return Object.values(b).reduce((s, x) => s + (x.stars || 0), 0);
    }

    openBattleModal() {
      const g = this.game;
      const stars = this.battleStars();
      const cards = (FX.SCENARIOS || []).map((sc, i) => {
        const rec = g.profile.battles[sc.id] || { stars: 0, best: 0 };
        const needStars = i < 3 ? 0 : i < 6 ? 4 : 10;
        const locked = stars < needStars;
        const starHtml = [0, 1, 2].map((n) => `<span class="star${n < rec.stars ? ' on' : ''}">★</span>`).join('');
        const pair = FX.PAIR_MAP[sc.pair];
        return `<button class="battle-card${locked ? ' locked' : ''}${rec.stars ? ' cleared' : ''}" data-battle="${sc.id}" ${locked ? 'disabled' : ''}>
          <div class="battle-head"><span class="battle-title">${sc.title}</span><span class="battle-pair">${pair.display}</span></div>
          <span class="battle-meta">${sc.start.slice(0, 7)} → ${sc.end.slice(0, 7)} · 事件 ${sc.event.slice(5)}</span>
          <p class="battle-goal">${sc.summary || ''}</p>
          <div class="battle-foot"><span class="battle-stars">${starHtml}</span><span class="battle-diff">${'◆'.repeat(sc.difficulty || 1)}</span></div>
          ${locked ? `<span class="battle-lock">需要 ${needStars} 颗星</span>` : ''}
        </button>`;
      }).join('');
      $('battleSub').textContent = `用真实历史日度汇率重演危机。已获得 ${stars} 颗星；前 3 场默认开放。每场战役有独立目标与星级。`;
      $('battleGrid').innerHTML = cards;
      U.$$('#battleGrid [data-battle]').forEach((b) => {
        b.onclick = () => {
          if (b.disabled) return;
          this.openStory(b.dataset.battle);
        };
      });
      this.showModalById('battleModal');
    }

    openStory(id) {
      const sc = (FX.SCENARIOS || []).find((s) => s.id === id);
      if (!sc) return;
      const p = FX.PAIR_MAP[sc.pair];
      this.closeModalById('battleModal');
      $('storyKicker').textContent = '历史时刻';
      $('storyTitle').textContent = sc.title;
      $('storyMeta').innerHTML = `<span>${sc.subtitle || ''}</span><span>${p.display}</span><span>${sc.start} → ${sc.end}</span><span>事件 ${sc.event}</span>`;
      $('storyBody').innerHTML = (sc.story || []).map((s) => `<p>${s}</p>`).join('');
      const obj = sc.objectives;
      $('storyGoal').innerHTML = `<strong>通关条件</strong><span>期末权益 ≥ ${U.money(obj.targetEquity, 0)} · 最大回撤 ≤ ${obj.maxDrawdownPct}% · 成交 ≤ ${obj.maxTrades} 笔 · 不爆仓${obj.eventRule !== 'none' ? ' · 事件日规则' : ''}</span>`;
      $('storyStart').onclick = () => {
        this.closeModalById('storyModal');
        this.game.running = true;
        this.game.startBattle(sc.id);
        this.scheduleRender();
      };
      this.showModalById('storyModal');
    }

    // ---------- 每日挑战 ----------
    openChallengeModal() {
      const g = this.game;
      const meta = g.challengeMeta();
      const mod = g.challengeModifier();
      $('chDate').textContent = meta.dayKey;
      $('chModifier').textContent = mod.name;
      $('chModifierDesc').textContent = mod.desc;
      $('chAttempts').textContent = String(meta.attempts);
      $('chBest').textContent = meta.best ? String(meta.best.score) : '—';
      const rows = (meta.rows || []).slice(0, 5);
      $('chBoard').innerHTML = rows.length
        ? `<div class="ldr-head"><span>今日榜</span><span>得分</span></div>` + rows.map((r, i) => `<div class="ldr-row${r.name === '我' ? ' me' : ''}"><span class="ldr-rank">${i + 1}</span><span class="ldr-name">${r.name}</span><span class="ldr-score num">${r.score}</span></div>`).join('')
        : '<div class="empty-state"><strong>今天还没有成绩。</strong><span>完成一局后，成绩会记录在这里。</span></div>';
      const inRun = g.mode === 'challenge' && !!g.challenge && !g.challenge.finished;
      $('chStart').disabled = !inRun && meta.attempts <= 0;
      $('chStart').textContent = inRun ? '继续当前挑战' : meta.attempts > 0 ? `开始挑战（剩 ${meta.attempts} 次）` : '今日次数已用完';
      $('chRetire').disabled = !inRun;
      this.showModalById('challengeModal');
    }

    // ---------- 结算 ----------
    showSettle(data) {
      const g = this.game;
      this.game.running = false;
      const stars = $('settleStars');
      const body = $('settleBody');
      const actions = $('settleActions');
      actions.innerHTML = '';
      let title = '结算';
      let icon = 'trophy';
      let bodyHtml = '';
      if (data.kind === 'battle') {
        title = data.scenario.title + ' · 结算';
        icon = data.stars >= 2 ? 'trophy' : data.pass ? 'check' : 'alert';
        stars.innerHTML = [0, 1, 2].map((n) => `<span class="star${n < data.stars ? ' on' : ''}">★</span>`).join('');
        bodyHtml = `<div class="settle-line"><span>期末权益</span><strong class="num">${U.money(data.equity)}</strong></div>
          <div class="settle-line"><span>收益率</span><strong class="num ${data.ret > 0.00005 ? 'up' : data.ret < -0.00005 ? 'down' : ''}">${U.pct(data.ret * 100)}</strong></div>
          <div class="settle-line"><span>最大回撤</span><strong class="num">${data.dd.toFixed(1)}% / 红线 ${data.scenario.objectives.maxDrawdownPct}%</strong></div>
          <div class="settle-line"><span>成交笔数</span><strong class="num">${data.trades} / 上限 ${data.cap}</strong></div>
          <div class="settle-line"><span>事件日</span><strong class="num">${data.eventScore > 0 ? '判断正确 +20' : data.eventScore < 0 ? '判断失误 −20' : '中性'}</strong></div>
          <div class="settle-line"><span>评分</span><strong class="num">${data.score} / 100</strong></div>
          ${data.liquidations ? `<p class="settle-warn">爆仓 ${data.liquidations} 次，评分已被扣分。</p>` : ''}
          <p class="modal-sub">${data.pass ? '通关。' : '未达通关线：' + [
            data.trades === 0 ? '没有成交' : null,
            data.trades > data.cap ? `成交 ${data.trades} 笔，超过上限 ${data.cap}` : null,
            data.eventScore < 0 ? '事件日规则违规' : null,
            data.dd > data.scenario.objectives.maxDrawdownPct ? `回撤超过 ${data.scenario.objectives.maxDrawdownPct}%` : null,
            data.equity < data.scenario.objectives.targetEquity ? `权益未到 ${U.money(data.scenario.objectives.targetEquity, 0)}` : null,
            data.liquidations ? '发生过爆仓' : null,
          ].filter(Boolean).join('；') + '。'} ${data.stars >= 2 ? '史实注释已解锁。' : ''}</p>`;
        if (data.scenario.historyNote) bodyHtml += `<p class="history-note">${data.scenario.historyNote}</p>`;
        const prev = data.previousBest || {};
        if (prev.stars) bodyHtml += `<p class="modal-sub">此前最佳：${prev.stars} 星 · ${prev.best || 0} 分</p>`;
        actions.innerHTML = `<button class="outline-button" id="settleRetry" type="button">再来一次</button><button class="outline-button" id="settlePick" type="button">选择其他战役</button><button class="primary-button" id="settleClose" type="button">关闭</button>`;
        setTimeout(() => {
          $('settleRetry').onclick = () => { this.closeModalById('settleModal'); g.running = true; g.startBattle(data.scenario.id); this.scheduleRender(); };
          $('settlePick').onclick = () => { this.closeModalById('settleModal'); this.openBattleModal(); };
          $('settleClose').onclick = () => this.closeModalById('settleModal');
        }, 0);
      } else if (data.kind === 'challenge') {
        title = '每日挑战 · 结算';
        icon = data.score >= 800 ? 'trophy' : 'target';
        stars.innerHTML = '';
        bodyHtml = `<div class="settle-line"><span>词条</span><strong>${data.modifier.name}</strong></div>
          <div class="settle-line"><span>期末权益</span><strong class="num">${U.money(data.equity)}</strong></div>
          <div class="settle-line"><span>收益率</span><strong class="num ${data.retPct > 0.005 ? 'up' : data.retPct < -0.005 ? 'down' : ''}">${U.pct(data.retPct)}</strong></div>
          <div class="settle-line"><span>最大回撤</span><strong class="num">${data.dd.toFixed(1)}%</strong></div>
          <div class="settle-line"><span>事件命中</span><strong class="num">${data.hits} 次</strong></div>
          <div class="settle-line"><span>成交笔数</span><strong class="num">${data.trades}</strong></div>
          <div class="settle-line big"><span>评分</span><strong class="num">${data.score}</strong></div>
          <p class="modal-sub">铜 400 / 银 800 / 金 1200。今日最佳：${data.best ? data.best.score : '—'}。</p>`;
        actions.innerHTML = `<button class="outline-button" id="settleBoard" type="button">查看榜单</button><button class="primary-button" id="settleClose" type="button">关闭</button>`;
        setTimeout(() => {
          $('settleBoard').onclick = () => { this.closeModalById('settleModal'); this.openChallengeModal(); };
          $('settleClose').onclick = () => this.closeModalById('settleModal');
        }, 0);
      } else {
        title = '历史回放 · 结算';
        icon = 'chart';
        stars.innerHTML = '';
        const pnl = data.equity - g.startBalance;
        const bench = data.benchmark || 0;
        const alpha = (pnl / g.startBalance) * 100 - bench;
        bodyHtml = `<div class="settle-line"><span>期末权益</span><strong class="num">${U.money(data.equity)}</strong></div>
          <div class="settle-line"><span>盈亏</span><strong class="num ${pnl > 0.005 ? 'up' : pnl < -0.005 ? 'down' : ''}">${U.moneySigned(pnl)}</strong></div>
          <div class="settle-line"><span>买入持有基准</span><strong class="num">${U.pct(bench)}</strong></div>
          <div class="settle-line"><span>超额收益 Alpha</span><strong class="num ${alpha > 0.00005 ? 'up' : alpha < -0.00005 ? 'down' : ''}">${U.pct(alpha)}</strong></div>
          <p class="modal-sub">回放结束。可以重新选择区间，用不同做法重跑同一段历史。</p>`;
        actions.innerHTML = `<button class="outline-button" id="settlePick" type="button">重新选择区间</button><button class="primary-button" id="settleClose" type="button">关闭</button>`;
        setTimeout(() => {
          $('settlePick').onclick = () => { this.closeModalById('settleModal'); this.openHistoryModal(); };
          $('settleClose').onclick = () => this.closeModalById('settleModal');
        }, 0);
      }
      $('settleTitle').textContent = title;
      $('settleIcon').innerHTML = `<svg class="ico"><use href="#i-${icon}"/></svg>`;
      body.innerHTML = bodyHtml;
      this.showModalById('settleModal');
    }

    // ---------- 统计 ----------
    openStats() {
      const g = this.game;
      const st = g.account.stats;
      const m = g.account.metrics();
      const closed = st.trades;
      const pnl = m.equity - g.startBalance;
      $('stPnl').textContent = U.moneySigned(pnl);
      $('stPnl').className = 'num ' + (pnl > 0.005 ? 'up' : pnl < -0.005 ? 'down' : '');
      $('stWinRate').textContent = closed ? ((st.wins / closed) * 100).toFixed(1) + '%' : '—';
      const pf = st.grossLoss > 0 ? (st.grossProfit / st.grossLoss).toFixed(2) : st.grossProfit > 0 ? '∞' : '—';
      $('stRR').textContent = closed ? pf : '—';
      $('stDD').textContent = st.maxDrawdown.toFixed(1) + '%';
      const cells = [
        ['交易笔数', closed],
        ['盈利 / 亏损', `${st.wins} / ${st.losses}`],
        ['平均每笔', closed ? U.money(pnl / closed) : '—'],
        ['手续费', U.money(st.commission)],
        ['隔夜利息', U.money(st.swap)],
        ['爆仓次数', st.liquidations],
        ['最长连赢', st.maxStreakWin],
        ['最长连亏', st.maxStreakLoss],
        ['最佳单笔', U.money(st.bestTrade)],
        ['最差单笔', U.money(st.worstTrade)],
        ['账户体检', this.healthGrade(st, m)],
        ['当前杠杆', '1:' + g.account.leverage],
      ];
      $('statsGrid').innerHTML = cells.map((c) => `<div class="stat-cell"><span>${c[0]}</span><strong class="num">${c[1]}</strong></div>`).join('');
      this.drawEquityChart();
      this.showModalById('statsModal');
    }

    healthGrade(st, m) {
      if (!st.trades) return '—';
      let score = 0;
      score += st.wins / Math.max(1, st.trades) > 0.5 ? 1 : 0;
      score += st.maxDrawdown < 20 ? 1 : 0;
      score += m.marginLevel > 200 || !isFinite(m.marginLevel) ? 1 : 0;
      score += st.grossProfit > st.grossLoss ? 1 : 0;
      return ['D', 'C', 'B', 'A', 'S'][Math.min(4, score)];
    }

    drawEquityChart() {
      const c = $('equityChart');
      const ctx = c.getContext('2d');
      const W = c.width;
      const H = c.height;
      ctx.clearRect(0, 0, W, H);
      const trail = this.game.account.equityTrail.slice(-200);
      const css = getComputedStyle(document.documentElement);
      const line = css.getPropertyValue('--chart-equity').trim() || '#d8a65c';
      const grid = css.getPropertyValue('--chart-grid').trim() || 'rgba(200,200,200,.1)';
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = 10 + (i / 4) * (H - 34);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      if (trail.length < 2) {
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillStyle = css.getPropertyValue('--text-muted').trim() || '#888';
        ctx.textAlign = 'center';
        ctx.fillText('还没有足够的交易记录。', W / 2, H / 2);
        ctx.textAlign = 'left';
        return;
      }
      const min = Math.min(...trail);
      const max = Math.max(...trail);
      const range = Math.max(1, max - min);
      ctx.beginPath();
      trail.forEach((v, i) => {
        const x = (i / (trail.length - 1)) * W;
        const y = 10 + (H - 34) - ((v - min) / range) * (H - 34);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = line;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillStyle = css.getPropertyValue('--text-muted').trim() || '#888';
      ctx.fillText(U.money(max, 0), 4, 12);
      ctx.fillText(U.money(min, 0), 4, H - 4);
    }

    // ---------- 成就 ----------
    openAch() {
      this.renderAchGrid();
      this.renderAchProgress();
      this.showModalById('achModal');
    }

    renderAchProgress() {
      const total = (FX.ACHIEVEMENTS || []).length;
      const n = this.game.achCount();
      const el = $('achProgress');
      if (el) el.textContent = `已解锁 ${n} / ${total}`;
    }

    renderAchGrid() {
      const g = this.game;
      const grid = $('achGrid');
      grid.innerHTML = (FX.ACHIEVEMENTS || []).map((a) => {
        const date = g.achData.unlocked[a.id];
        const unlocked = !!date;
        return `<div class="ach-item ${unlocked ? 'unlocked' : 'locked'}">
          <div class="ach-icon"><svg class="ico"><use href="#i-${a.icon || 'trophy'}"/></svg></div>
          <div class="ach-body"><strong class="ach-name">${a.name}</strong>
          <span class="ach-desc">${unlocked ? a.desc : (a.hint || a.desc)}</span>
          <span class="ach-foot">${unlocked ? '解锁于 ' + date : '未解锁'} · ${a.xp || 0} XP</span></div>
        </div>`;
      }).join('');
    }

    // ---------- 设置/重置 ----------
    openSettings() {
      this.applySettingsUI();
      this.showModalById('settingsModal');
    }

    // ---------- 存档导出 / 导入 ----------
    openExportSave() {
      const g = this.game;
      let text;
      try {
        // 先落盘，确保导出的是当前内存里的最新状态
        g.save();
        text = FX.SaveIO.build();
      } catch (err) {
        this.toast('导出失败：' + (err && err.message ? err.message : err), 'warn');
        return;
      }
      this._saveExportText = text;
      const s = FX.SaveIO.summary(FX.SaveIO.parse(text));
      const bits = [];
      if (s.exportedAt) bits.push('导出时间 ' + this._saveTimeLabel(s.exportedAt));
      if (s.balance != null) bits.push('余额 ' + U.money(s.balance));
      if (s.positions) bits.push('持仓 ' + s.positions + ' 笔');
      if (s.achievements) bits.push('成就 ' + s.achievements + ' 个');
      this.openModal({
        title: '导出存档',
        icon: 'download',
        wide: true,
        body: `<p>存档包含账户、持仓、订单、成交记录、战役与挑战进度、成就和设置。</p>
          <p class="modal-sub">${bits.join(' · ')}</p>
          <textarea class="save-io-text" id="saveExportText" readonly spellcheck="false" aria-label="存档文本"></textarea>`,
        actions: [
          { label: '复制文本', cls: 'outline-button', onClick: () => this.copySaveText() },
          { label: '保存文件', cls: 'primary-button', onClick: () => this.downloadSaveText() },
          { label: '关闭', cls: 'outline-button', close: true },
        ],
      });
      const ta = $('saveExportText');
      if (ta) ta.value = text;
    }

    copySaveText() {
      const text = this._saveExportText;
      if (!text) return;
      FX.SaveIO.copy(text)
        .then(() => this.toast('存档文本已复制', 'ok'))
        .catch((err) => this.toast('复制失败：' + (err && err.message ? err.message : err), 'warn'));
    }

    downloadSaveText() {
      const text = this._saveExportText;
      if (!text) return;
      try {
        const how = FX.SaveIO.download(text, FX.SaveIO.filename());
        if (how !== 'native') this.toast('存档已开始下载', 'ok');
      } catch (err) {
        this.toast('保存失败：' + (err && err.message ? err.message : err), 'warn');
      }
    }

    openImportSave(prefill) {
      this.openModal({
        title: '导入存档',
        icon: 'download',
        wide: true,
        body: `<p>选择之前导出的 <code>.json</code> 存档文件，或直接把存档文本粘贴到下面。</p>
          <button class="outline-button small save-io-pick" id="savePickBtn" type="button">选择存档文件</button>
          <textarea class="save-io-text" id="saveImportText" spellcheck="false" placeholder="在此粘贴存档文本…" aria-label="存档文本"></textarea>
          <p class="save-io-error hidden" id="saveImportError"></p>`,
        actions: [
          { label: '取消', cls: 'outline-button', close: true },
          { label: '导入', cls: 'primary-button', onClick: () => this.confirmImportSave() },
        ],
      });
      const ta = $('saveImportText');
      if (ta && prefill) ta.value = prefill;
      const pick = $('savePickBtn');
      if (pick) pick.onclick = () => this.pickSaveFile();
      const input = $('saveFileInput');
      if (input) {
        input.value = '';
        input.onchange = () => {
          const file = input.files && input.files[0];
          if (file) this._loadSaveFile(file);
        };
      }
    }

    pickSaveFile() {
      if (FX.SaveIO.pickNative()) return;
      const input = $('saveFileInput');
      if (input) input.click();
    }

    _loadSaveFile(file) {
      FX.SaveIO.readFile(file)
        .then((text) => this.onImportFileText(text))
        .catch((err) => this._showImportError(err && err.message ? err.message : String(err)));
    }

    /** Android 原生文件选择器读取完成后回调 */
    onImportFileText(text) {
      const ta = $('saveImportText');
      if (!ta) return;
      ta.value = text == null ? '' : String(text);
      this._showImportError('');
      ta.focus();
    }

    _showImportError(msg) {
      const el = $('saveImportError');
      if (!el) return;
      el.textContent = msg || '';
      el.classList.toggle('hidden', !msg);
    }

    confirmImportSave() {
      const ta = $('saveImportText');
      const text = ta ? ta.value : '';
      let obj;
      try {
        obj = FX.SaveIO.parse(text);
      } catch (err) {
        this._showImportError(err && err.message ? err.message : String(err));
        return;
      }
      const s = FX.SaveIO.summary(obj);
      const bits = [];
      if (s.exportedAt) bits.push('导出时间 ' + this._saveTimeLabel(s.exportedAt));
      if (s.mode && s.mode !== '—') bits.push('模式 ' + s.mode);
      if (s.balance != null) bits.push('余额 ' + U.money(s.balance));
      if (s.positions) bits.push('持仓 ' + s.positions + ' 笔');
      if (s.orders) bits.push('挂单 ' + s.orders + ' 笔');
      if (s.achievements) bits.push('成就 ' + s.achievements + ' 个');
      this._pendingSaveText = text;
      this.openModal({
        title: '确认导入',
        icon: 'alert',
        body: `<p>将用备份<strong>覆盖当前全部存档</strong>，包括账户、持仓、战役/挑战进度、成就与设置。</p>
          <p class="modal-sub">${bits.join(' · ')}</p>
          <p class="modal-sub">此操作不可撤销，导入后页面会自动刷新。</p>`,
        actions: [
          {
            label: '取消', cls: 'outline-button', close: false,
            onClick: () => this.openImportSave(this._pendingSaveText),
          },
          {
            label: '覆盖并导入', cls: 'danger-button', close: false,
            onClick: () => {
              try {
                this.game.importData(obj);
              } catch (err) {
                this.toast('导入失败：' + (err && err.message ? err.message : err), 'warn');
              }
            },
          },
        ],
      });
    }

    _saveTimeLabel(iso) {
      try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        const p = U.pad2;
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
      } catch (_) {
        return iso;
      }
    }

    confirmReset() {
      const names = { sim: '模拟行情', history: '历史回放', battle: '经典战役', challenge: '每日挑战' };
      this.openModal({
        title: '重新开始当前模式', icon: 'reset',
        body: `<p>将重置<strong>${names[this.game.mode]}</strong>的账户、持仓与成交记录。成就与战役星级会保留。</p>${this.game.mode === 'challenge' ? '<p class="modal-sub">重新开始会消耗 1 次每日挑战机会，并换一组新行情。</p>' : ''}<p class="modal-sub">此操作不可撤销。</p>`,
        actions: [
          { label: '取消', cls: 'outline-button', close: true },
          { label: '确认重置', cls: 'danger-button', close: true, onClick: () => { this.game.running = true; this.game.resetMode(); } },
        ],
      });
    }

    confirmCloseAll() {
      const g = this.game;
      if (!g.account.positions.length) return;
      const m = g.account.metrics();
      this.openModal({
        title: '全部平仓', icon: 'alert',
        body: `<p>将按当前价格平掉 <strong>${g.account.positions.length}</strong> 笔持仓，合计浮动盈亏 <strong class="num ${m.floating > 0.005 ? 'up' : m.floating < -0.005 ? 'down' : ''}">${U.moneySigned(m.floating)}</strong>。</p><p class="modal-sub">平仓后不可撤销。</p>`,
        actions: [
          { label: '保留仓位', cls: 'outline-button', close: true },
          { label: '确认全部平仓', cls: 'primary-button', close: true, onClick: () => g.closeAll() },
        ],
      });
    }

    openModifyModal(id) {
      const g = this.game;
      const pos = g.account.positions.find((p) => p.id === id);
      if (!pos) return;
      const p = FX.PAIR_MAP[pos.pairId];
      this.openModal({
        title: '修改止损 / 止盈', icon: 'target',
        body: `<p class="modal-sub">${p.display} · ${pos.side > 0 ? '多' : '空'} ${pos.lots.toFixed(2)} 手 · 开仓 ${U.price(pos.entry, p.digits)}</p>
          <div class="form-grid two">
            <label class="form-field"><span>止损价</span><input id="modSl" type="number" step="${p.pip}" value="${pos.sl != null ? pos.sl.toFixed(p.digits) : ''}" placeholder="留空 = 取消"></label>
            <label class="form-field"><span>止盈价</span><input id="modTp" type="number" step="${p.pip}" value="${pos.tp != null ? pos.tp.toFixed(p.digits) : ''}" placeholder="留空 = 取消"></label>
          </div>`,
        actions: [
          { label: '取消', cls: 'outline-button', close: true },
          {
            label: '保存', cls: 'primary-button', close: true,
            onClick: () => {
              const sl = U.num($('modSl').value, 0) || null;
              const tp = U.num($('modTp').value, 0) || null;
              if (sl && pos.side > 0 && sl >= g.market.quotes[pos.pairId].bid) { this.toast('多单止损需低于当前买价。', 'bad'); return false; }
              if (sl && pos.side < 0 && sl <= g.market.quotes[pos.pairId].ask) { this.toast('空单止损需高于当前卖价。', 'bad'); return false; }
              g.modifyPosition(pos.id, { sl, tp });
            },
          },
        ],
      });
    }

    // ---------- 分享 ----------
    openShare() {
      const canvas = $('shareCanvas');
      FX.Share.render(canvas, this.game);
      this.showModalById('shareModal');
      $('shareDownload').onclick = () => FX.Share.download(canvas, `abyss-fx-${U.dateISO(new Date())}.png`);
    }

    // ---------- 教程/欢迎 ----------
    openTutorial(i) {
      this.tutIndex = U.clamp(i, 0, TUTORIAL.length - 1);
      const t = TUTORIAL[this.tutIndex];
      $('tutStep').textContent = `${this.tutIndex + 1} / ${TUTORIAL.length}`;
      $('tutIcon').innerHTML = `<svg class="ico"><use href="#i-${t.icon}"/></svg>`;
      $('tutTitle').textContent = t.title;
      $('tutBody').innerHTML = `<p>${t.body}</p>`;
      $('tutDemo').innerHTML = this.tutDemo(this.tutIndex);
      $('tutBack').disabled = this.tutIndex === 0;
      $('tutNext').textContent = this.tutIndex === TUTORIAL.length - 1 ? '开始交易' : '下一步';
      this.showModalById('tutorialModal');
    }

    tutDemo(i) {
      const g = this.game;
      const q = g.currentQuote();
      const p = FX.PAIR_MAP[g.selectedPair];
      if (!q) return '';
      if (i === 2) {
        return `<div class="tut-demo-row"><span>买价 ${U.price(q.bid, p.digits)}</span><span>卖价 ${U.price(q.ask, p.digits)}</span><span>点差 ${q.spreadPips.toFixed(1)} 点</span></div>`;
      }
      if (i === 3) {
        const lots = 1;
        const margin = FX.marginUSD(g.selectedPair, lots, g.market.quotes, 100);
        return `<div class="tut-demo-row"><span>1 手名义 ${U.money(FX.notionalUSD(g.selectedPair, lots, g.market.quotes), 0)}</span><span>1:100 保证金 ${U.money(margin)}</span><span>每点 $${FX.pipValueUSD(g.selectedPair, lots, g.market.quotes).toFixed(2)}</span></div>`;
      }
      if (i === 4) {
        return `<div class="tut-demo-row"><span>强平线 50%</span><span>追保线 100%</span><span>默认负余额保护 开</span></div>`;
      }
      return '';
    }

    showWelcome() {
      this.openModal({
        title: '第一次来到交易室？', icon: 'anchor',
        body: `<p>这里没有“稳赚”的方法，只有点差、杠杆和保证金水平。</p><p>用三分钟认识做多、做空、保证金与强平，再决定你的第一笔交易。</p><p class="modal-sub">模拟交易 · 仅供娱乐 · 不构成投资建议</p>`,
        actions: [
          { label: '直接开始', cls: 'outline-button', close: true },
          { label: '开始教程', cls: 'primary-button', close: true, onClick: () => this.openTutorial(0) },
        ],
      });
    }
  }

  FX.UI = UI;
})();
