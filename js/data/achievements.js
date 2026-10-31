/* 成就定义：20 条，按交易 / 风险 / 剧情 / 挑战分组
   check(ctx) 由游戏在每次事件与每秒调用：
   - 只写 ctx.flags，不碰账户或行情；
   - 所有字段按缺失处理，异常一律返回 false；
   - 平仓类统计用交易指纹去重，避免同一事件被重复累计。 */
(function () {
  'use strict';
  const FX = (window.FX = window.FX || {});

  // ---------- 容错小工具 ----------
  function obj(v) {
    return v && typeof v === 'object' ? v : {};
  }

  function toNum(v, fallback) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      if (isFinite(n)) return n;
    }
    return fallback;
  }

  function eventType(ctx) {
    const e = obj(ctx.event);
    return typeof e.type === 'string' ? e.type : '';
  }

  // 兼容数字方向与文字方向，缺失时按 0 处理。
  function sideSign(v) {
    if (typeof v === 'string') {
      const s = v.toLowerCase();
      if (/long|buy|多/.test(s)) return 1;
      if (/short|sell|空/.test(s)) return -1;
    }
    const n = toNum(v, 0);
    return n > 0 ? 1 : n < 0 ? -1 : 0;
  }

  function isCloseEvent(ctx) {
    return eventType(ctx) === 'close' && !!ctx.trade && typeof ctx.trade === 'object';
  }

  function getFlags(ctx) {
    if (!ctx || typeof ctx !== 'object') return null;
    if (!ctx.flags || typeof ctx.flags !== 'object') {
      try {
        ctx.flags = {};
      } catch (e) {
        return null;
      }
    }
    return ctx.flags;
  }

  function safeCheck(fn) {
    return function (ctx) {
      try {
        return fn(ctx && typeof ctx === 'object' ? ctx : {}) === true;
      } catch (e) {
        return false;
      }
    };
  }

  // 同一笔平仓只处理一次；把会话标识也放进指纹，降低重开游戏后的碰撞。
  function closeKey(trade, ctx) {
    if (!trade || typeof trade !== 'object') return '';
    if (trade.pairId == null && trade.pnl == null && trade.closedAt == null) return '';
    const game = obj(ctx.game);
    let session = game.sessionId;
    if (session == null) session = game.startTime != null ? game.startTime : game.startedAt;
    if (session instanceof Date) session = session.getTime();
    return [
      session, trade.id, trade.pairId, trade.side, trade.lots, trade.entry,
      trade.exit, trade.pnl, trade.reason, trade.openedAt, trade.closedAt,
    ].map(function (v) {
      return v == null ? '' : String(v);
    }).join('|');
  }

  // 统一维护平仓统计；多个成就的 check 都会调用它，靠指纹保证幂等。
  function prepare(ctx) {
    const fl = getFlags(ctx);
    if (!fl) return;

    const type = eventType(ctx);

    // 强平 / 穿仓 / 负余额兜底之后，本局的“低保证金生还”作废。
    if (type === 'stopout' || type === 'nbp' || type === 'bankrupt') {
      fl.lowMarginSeen = false;
    }

    // 记录曾经跌到 60% 以下的时刻；不要求事件一定是 tick。
    if (type !== 'stopout' && type !== 'nbp' && type !== 'bankrupt') {
      const m = obj(ctx.metrics);
      const level = toNum(m.marginLevel, Infinity);
      const used = toNum(m.used, 0);
      if (level < 60 && used > 0 && fl.lowMarginSurvived !== true) {
        fl.lowMarginSeen = true;
      }
    }

    if (!isCloseEvent(ctx)) return;
    const t = ctx.trade;
    const key = closeKey(t, ctx);
    if (!key || fl._closeSeq === key) return;
    fl._closeSeq = key;

    const pnl = toNum(t.pnl, 0);
    const side = sideSign(t.side);

    fl.tradeCount = toNum(fl.tradeCount, 0) + 1;
    fl.cumPnl = toNum(fl.cumPnl, 0) + pnl;

    // 以止损离场才续上连击；任何其他平仓方式清零。
    if (t.reason === 'sl') fl.slStreak = toNum(fl.slStreak, 0) + 1;
    else fl.slStreak = 0;

    if (pnl > 0) {
      if (side > 0) fl.longWin = true;
      else if (side < 0) fl.shortWin = true;
    }

    // 低保证金之后，只要这次平仓不是强平，就算活着离开悬崖。
    if (fl.lowMarginSeen && t.reason !== 'stopout') {
      fl.lowMarginSurvived = true;
    }
  }

  // ---------- 日期与战役 ----------
  function toMs(v) {
    if (typeof v === 'number' && isFinite(v)) {
      if (v >= 1e11) return v;          // 毫秒
      if (v >= 1e9) return v * 1000;    // 秒
      return v;
    }
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s) return NaN;
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(s + 'T00:00:00Z');
      if (/^\d+$/.test(s)) return toMs(Number(s));
      return Date.parse(s);
    }
    if (v && Object.prototype.toString.call(v) === '[object Date]') {
      return v.getTime();
    }
    return NaN;
  }

  function isoDay(v) {
    const ms = toMs(v);
    if (!isFinite(ms)) return '';
    const d = new Date(ms);
    if (!isFinite(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  function collectEventDates(v, out, depth) {
    if (v == null || depth > 4) return;
    if (Object.prototype.toString.call(v) === '[object Date]') {
      const day = isoDay(v.getTime());
      if (day) out.push(day);
      return;
    }
    if (typeof v === 'string') {
      const m = v.match(/\d{4}-\d{2}-\d{2}/);
      if (m) out.push(m[0]);
      return;
    }
    if (typeof v === 'number') {
      const day = isoDay(v);
      if (day) out.push(day);
      return;
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length && i < 20; i++) collectEventDates(v[i], out, depth + 1);
      return;
    }
    if (typeof v === 'object') {
      ['date', 'day', 'time', 'at', 'ts', 'timestamp', 'start', 'end'].forEach(function (k) {
        collectEventDates(v[k], out, depth + 1);
      });
    }
  }

  function scenarioEventDays(scenario) {
    const out = [];
    const sc = obj(scenario);
    if (sc.eventDays && typeof sc.eventDays === 'object') {
      collectEventDates(Object.keys(sc.eventDays), out, 0);
    }
    collectEventDates(sc.event, out, 0);
    collectEventDates(sc.eventDate, out, 0);
    collectEventDates(sc.eventDay, out, 0);
    return out;
  }

  function sameEventDay(closedAt, scenario) {
    const days = scenarioEventDays(scenario);
    if (!days.length) return false;
    const day = isoDay(closedAt);
    return !!day && days.indexOf(day) !== -1;
  }

  function scenarioText(scenario) {
    const sc = obj(scenario);
    return [sc.id, sc.key, sc.name, sc.title, sc.subtitle, sc.pairId, sc.desc]
      .filter(function (v) { return typeof v === 'string'; })
      .join(' ')
      .toLowerCase();
  }

  function isChf2015(scenario) {
    const sc = obj(scenario);
    const text = scenarioText(sc);
    if (!/(chf|swiss|瑞郎|瑞士)/.test(text)) return false;
    if (/2015/.test(text)) return true;
    if (scenarioEventDays(sc).some(function (d) { return d.indexOf('2015-') === 0; })) return true;
    return typeof sc.start === 'string' && sc.start.indexOf('2015') === 0;
  }

  function battleEntries(ctx) {
    const battles = obj(obj(ctx.profile).battles);
    const out = [];
    Object.keys(battles).forEach(function (k) {
      const v = battles[k];
      let stars = 0;
      if (typeof v === 'number' || typeof v === 'string') stars = toNum(v, 0);
      else if (v && typeof v === 'object') stars = toNum(v.stars, 0);
      out.push({ key: String(k), stars: Math.max(0, stars) });
    });
    return out;
  }

  function eventStars(ctx) {
    const p = obj(obj(ctx.event).payload);
    const r = obj(p.result);
    return Math.max(0, toNum(p.stars, toNum(p.star, toNum(r.stars, 0))));
  }

  function maxStars(ctx) {
    let best = eventStars(ctx);
    battleEntries(ctx).forEach(function (e) {
      if (e.stars > best) best = e.stars;
    });
    return best;
  }

  function totalStars(ctx) {
    let sum = 0;
    battleEntries(ctx).forEach(function (e) { sum += e.stars; });
    // 结算事件到达时 profile 可能还没写入本场；取较大值，避免重复计算。
    return Math.max(sum, eventStars(ctx));
  }

  function profileHasChfClear(ctx) {
    return battleEntries(ctx).some(function (e) {
      return e.stars > 0 && /(chf|swiss|瑞郎|瑞士|snb)/.test(e.key.toLowerCase()) && /2015/.test(e.key);
    });
  }

  function startEquity(ctx) {
    const g = obj(ctx.game);
    const c = obj(ctx.challenge);
    const a = obj(ctx.account);
    const list = [g.startBalance, c.startBalance, a.startBalance, a.initialBalance, g.initialBalance];
    for (let i = 0; i < list.length; i++) {
      const n = toNum(list[i], NaN);
      if (isFinite(n) && n > 0) return n;
    }
    return 10000;
  }

  function challengeScore(ctx) {
    let score = toNum(obj(ctx.challenge).score, NaN);
    const p = obj(obj(ctx.event).payload);
    const r = obj(p.result);
    const fromEvent = toNum(p.score, toNum(r.score, NaN));
    if (isFinite(fromEvent)) score = isFinite(score) ? Math.max(score, fromEvent) : fromEvent;
    return score;
  }

  // ---------- 成就表 ----------
  FX.ACHIEVEMENTS = [
    // ===== 交易类 7 条 =====
    {
      id: 'first-blood',
      name: '第一滴血',
      icon: 'target',
      category: 'trade',
      desc: '完成第一笔平仓。账面上终于有了一个句号。',
      hint: '先开一笔，再平掉它。',
      xp: 50,
      hidden: false,
      check: safeCheck(function (ctx) {
        prepare(ctx);
        return isCloseEvent(ctx) && ctx.trade.reason !== 'settle';
      }),
    },
    {
      id: 'both-sides',
      name: '两副面孔',
      icon: 'chart',
      category: 'trade',
      desc: '做多和做空各盈利一次。市场不在乎你的立场，只在乎你的方向。',
      hint: '分别做多、做空，并各盈利一次。',
      xp: 120,
      hidden: false,
      check: safeCheck(function (ctx) {
        prepare(ctx);
        const f = getFlags(ctx);
        return !!f && f.longWin === true && f.shortWin === true;
      }),
    },
    {
      id: 'stop-loss-ten',
      name: '止损十连',
      icon: 'shield',
      category: 'trade',
      desc: '连续 10 笔通过止损离场。每次都被请出去，但每次都按规则。',
      hint: '连续 10 次以止损平仓；任何一笔非止损平仓都会让计数归零。',
      xp: 200,
      hidden: false,
      check: safeCheck(function (ctx) {
        prepare(ctx);
        const f = getFlags(ctx);
        return !!f && toNum(f.slStreak, 0) >= 10;
      }),
    },
    {
      id: 'five-hundred-win',
      name: '五百俱乐部',
      icon: 'up',
      category: 'trade',
      desc: '单笔平仓盈利达到 $500。赚钱时，人很容易误以为自己有原则。',
      hint: '让一笔平仓盈利达到 $500。',
      xp: 80,
      hidden: false,
      check: safeCheck(function (ctx) {
        prepare(ctx);
        return isCloseEvent(ctx) && toNum(ctx.trade.pnl, 0) >= 500;
      }),
    },
    {
      id: 'five-hundred-loss',
      name: '学费到账',
      icon: 'down',
      category: 'trade',
      desc: '单笔平仓亏损达到 $500。市场收下学费，不开发票。',
      hint: '让一笔平仓亏损达到 $500。',
      xp: 80,
      hidden: false,
      check: safeCheck(function (ctx) {
        prepare(ctx);
        return isCloseEvent(ctx) && toNum(ctx.trade.pnl, 0) <= -500;
      }),
    },
    {
      id: 'thousand-profit',
      name: '四位数',
      icon: 'trophy',
      category: 'trade',
      desc: '累计已实现平仓净盈利达到 $1,000。先别急着算年化。',
      hint: '累计平仓净盈利达到 $1,000。',
      xp: 150,
      hidden: false,
      check: safeCheck(function (ctx) {
        prepare(ctx);
        const f = getFlags(ctx);
        return !!f && toNum(f.cumPnl, 0) >= 1000;
      }),
    },
    {
      id: 'fifty-trades',
      name: '五十次握手',
      icon: 'check',
      category: 'trade',
      desc: '完成 50 笔平仓。你终于开始对点差有肌肉记忆。',
      hint: '累计完成 50 笔平仓。',
      xp: 180,
      hidden: false,
      check: safeCheck(function (ctx) {
        prepare(ctx);
        const f = getFlags(ctx);
        const profile = obj(ctx.profile);
        const count = Math.max(toNum(profile.totalTrades, 0), f ? toNum(f.tradeCount, 0) : 0);
        return count >= 50;
      }),
    },

    // ===== 风险类 5 条 =====
    {
      id: 'first-stopout',
      name: '强制离场',
      icon: 'alert',
      category: 'risk',
      desc: '第一次触发强制平仓。保证金水平没有给解释的机会。',
      hint: '让保证金水平跌破强平线。',
      xp: 100,
      hidden: false,
      check: safeCheck(function (ctx) {
        prepare(ctx);
        return eventType(ctx) === 'stopout';
      }),
    },
    {
      id: 'nbp-save',
      name: '负数之前',
      icon: 'shield',
      category: 'risk',
      desc: '触发负余额保护。账户归零，债务被系统收走。',
      hint: '在开启负余额保护时，把账户打到负数。',
      xp: 120,
      hidden: false,
      check: safeCheck(function (ctx) {
        prepare(ctx);
        return eventType(ctx) === 'nbp';
      }),
    },
    {
      id: 'hard-bankrupt',
      name: '硬着陆',
      icon: 'anchor',
      category: 'risk',
      desc: '余额跌破零，且没有负余额保护。剩下的数字叫债务。',
      hint: '关闭负余额保护，再把余额打到负数。',
      xp: 150,
      hidden: true,
      check: safeCheck(function (ctx) {
        prepare(ctx);
        return eventType(ctx) === 'bankrupt';
      }),
    },
    {
      id: 'cliff-survivor',
      name: '悬崖边',
      icon: 'fire',
      category: 'risk',
      desc: '保证金水平一度低于 60%，最后没有等到强平。心脏还在保修期内。',
      hint: '让保证金水平低于 60%，并在强平前以非强平方式平仓。',
      xp: 200,
      hidden: true,
      check: safeCheck(function (ctx) {
        prepare(ctx);
        const f = getFlags(ctx);
        return !!f && f.lowMarginSurvived === true;
      }),
    },
    {
      id: 'fifth-of-equity',
      name: '五分之一的代价',
      icon: 'info',
      category: 'risk',
      desc: '单笔亏损达到起始权益的 20%。这不是回撤，是一次体检。',
      hint: '让一笔平仓亏损达到起始权益的 20%。',
      xp: 120,
      hidden: false,
      check: safeCheck(function (ctx) {
        prepare(ctx);
        if (!isCloseEvent(ctx)) return false;
        const pnl = toNum(ctx.trade.pnl, 0);
        return pnl < 0 && Math.abs(pnl) >= startEquity(ctx) * 0.2;
      }),
    },

    // ===== 剧情类 5 条 =====
    {
      id: 'first-battle',
      name: '战役初胜',
      icon: 'trophy',
      category: 'story',
      desc: '完成任意一场经典战役。历史不会重演，但会收门票。',
      hint: '在经典战役中完成结算。',
      xp: 120,
      hidden: false,
      check: safeCheck(function (ctx) {
        prepare(ctx);
        if (eventType(ctx) === 'settle' && ctx.scenario && eventStars(ctx) > 0) return true;
        return battleEntries(ctx).some(function (e) { return e.stars > 0; });
      }),
    },
    {
      id: 'three-stars',
      name: '三星收藏',
      icon: 'target',
      category: 'story',
      desc: '在任意战役中获得 3 星。历史老师没有告诉你评分标准。',
      hint: '在任意战役中拿到 3 星。',
      xp: 150,
      hidden: false,
      check: safeCheck(function (ctx) {
        prepare(ctx);
        return maxStars(ctx) >= 3;
      }),
    },
    {
      id: 'chf-2015',
      name: '瑞郎惊魂',
      icon: 'fire',
      category: 'story',
      desc: '通关 2015 年瑞郎脱钩战役。那天的点差比剧情更难忘。',
      hint: '完成「2015 瑞郎脱钩」战役。',
      xp: 300,
      hidden: false,
      check: safeCheck(function (ctx) {
        prepare(ctx);
        if (eventType(ctx) === 'settle' && isChf2015(ctx.scenario) && eventStars(ctx) > 0) return true;
        return profileHasChfClear(ctx);
      }),
    },
    {
      id: 'event-day-profit',
      name: '事件日幸存者',
      icon: 'chart',
      category: 'story',
      desc: '在战役事件日以盈利平仓。别人看新闻，你看的是账单。',
      hint: '在战役事件当天，以盈利平掉一笔仓位。',
      xp: 180,
      hidden: false,
      check: safeCheck(function (ctx) {
        prepare(ctx);
        if (!isCloseEvent(ctx) || toNum(ctx.trade.pnl, 0) <= 0) return false;
        return sameEventDay(ctx.trade.closedAt, ctx.scenario);
      }),
    },
    {
      id: 'ten-stars',
      name: '十星之路',
      icon: 'trophy',
      category: 'story',
      desc: '累计获得 10 颗战役星星。星星不会发光，只会提醒你重开过几次。',
      hint: '在战役中累计获得 10 颗星。',
      xp: 280,
      hidden: false,
      check: safeCheck(function (ctx) {
        prepare(ctx);
        return totalStars(ctx) >= 10;
      }),
    },

    // ===== 挑战类 3 条 =====
    {
      id: 'daily-first',
      name: '每日打卡',
      icon: 'check',
      category: 'challenge',
      desc: '完成一次每日挑战。今天没有暴富，只有结算。',
      hint: '完成一次每日挑战。',
      xp: 100,
      hidden: false,
      check: safeCheck(function (ctx) {
        prepare(ctx);
        return eventType(ctx) === 'settle' && ctx.mode === 'challenge';
      }),
    },
    {
      id: 'daily-eight-hundred',
      name: '八百分',
      icon: 'up',
      category: 'challenge',
      desc: '每日挑战单日得分达到 800（是分数，不是 pip）。分数不能提现，但能截图。',
      hint: '在每日挑战中拿到 800 分。',
      xp: 180,
      hidden: false,
      check: safeCheck(function (ctx) {
        prepare(ctx);
        const score = challengeScore(ctx);
        return isFinite(score) && score >= 800;
      }),
    },
    {
      id: 'daily-streak-three',
      name: '三日不辍',
      icon: 'fire',
      category: 'challenge',
      desc: '连续 3 天参加每日挑战。坚持本身不保证盈利，只保证你还在场。',
      hint: '连续 3 天参加每日挑战。',
      xp: 150,
      hidden: false,
      check: safeCheck(function (ctx) {
        prepare(ctx);
        return toNum(obj(ctx.profile).dailyStreak, 0) >= 3;
      }),
    },
  ];
})();
