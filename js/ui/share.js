/* 分享卡：Canvas 1080×1440 战绩图 */
(function () {
  'use strict';
  const FX = (window.FX = window.FX || {});
  const U = FX.U;

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function fmt(v, d) {
    return U.money(v, d == null ? 2 : d);
  }

  const Share = {
    render(canvas, game) {
      const ctx = canvas.getContext('2d');
      const W = 1080;
      const H = 1440;
      canvas.width = W;
      canvas.height = H;
      const night = document.documentElement.getAttribute('data-theme') !== 'day';
      const P = night
        ? { bg0: '#1f1e1d', bg1: '#262624', card: '#2b2a27', ink: '#f5f3ec', sub: '#b0aa9e', line: '#3b3833', brass: '#e08a6e', red: '#e27964', green: '#86b49e', chart: '#e08a6e' }
        : { bg0: '#f5f4ee', bg1: '#ece8df', card: '#fbfaf7', ink: '#262624', sub: '#6b6860', line: '#e3ded3', brass: '#c96442', red: '#c0503b', green: '#4f7d66', chart: '#c15f3c' };
      // 背景
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, P.bg0);
      g.addColorStop(1, P.bg1);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // 网格纹理
      ctx.strokeStyle = night ? 'rgba(245,243,236,.045)' : 'rgba(38,38,36,.05)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 48) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      for (let y = 0; y < H; y += 48) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      const pad = 72;
      // 品牌
      ctx.fillStyle = P.brass;
      ctx.fillRect(pad, 74, 70, 4);
      ctx.font = '600 44px "Songti SC", "Noto Serif CJK SC", serif';
      ctx.fillStyle = P.ink;
      ctx.fillText('深渊汇率', pad, 140);
      ctx.font = '500 15px ui-monospace, monospace';
      ctx.fillStyle = P.sub;
      ctx.fillText('A B Y S S   F X', pad, 174);

      // 模式与日期
      ctx.textAlign = 'right';
      const modeNames = { sim: '模拟行情', history: '历史回放', battle: '经典战役', challenge: '每日挑战' };
      ctx.font = '500 22px system-ui, sans-serif';
      ctx.fillStyle = P.sub;
      ctx.fillText(modeNames[game.mode] || '模拟行情', W - pad, 128);
      ctx.font = '500 18px ui-monospace, monospace';
      ctx.fillText(U.dateISO(new Date()), W - pad, 160);
      ctx.textAlign = 'left';

      // 权益大数字
      const m = game.account.metrics();
      const pnl = m.equity - game.startBalance;
      ctx.font = '500 20px system-ui, sans-serif';
      ctx.fillStyle = P.sub;
      ctx.fillText('本期权益', pad, 250);
      ctx.font = '600 92px ui-monospace, monospace';
      ctx.fillStyle = P.ink;
      ctx.fillText(fmt(m.equity), pad, 350);
      ctx.font = '600 40px ui-monospace, monospace';
      ctx.fillStyle = pnl >= 0 ? P.green : P.red;
      ctx.fillText((pnl >= 0 ? '+' : '') + fmt(pnl), pad, 412);
      ctx.font = '500 18px system-ui, sans-serif';
      ctx.fillStyle = P.sub;
      ctx.fillText(`已实现 ${fmt(m.balance - game.startBalance)} · 浮动 ${fmt(m.floating)}`, pad, 452);
      ctx.fillText(`初始资金 ${fmt(game.startBalance, 0)}`, pad + 430, 452);

      // 权益曲线卡片
      const cardX = pad;
      const cardY = 470;
      const cardW = W - pad * 2;
      const cardH = 430;
      ctx.fillStyle = P.card;
      rr(ctx, cardX, cardY, cardW, cardH, 22);
      ctx.fill();
      ctx.strokeStyle = P.line;
      ctx.stroke();

      ctx.font = '600 18px system-ui, sans-serif';
      ctx.fillStyle = P.sub;
      ctx.fillText('权益曲线', cardX + 32, cardY + 46);

      const trail = game.account.equityTrail.slice(-240);
      const cx0 = cardX + 32;
      const cy0 = cardY + 84;
      const cw = cardW - 64;
      const ch = cardH - 128;
      if (trail.length > 1) {
        const min = Math.min(...trail);
        const max = Math.max(...trail);
        const range = Math.max(1, max - min);
        ctx.beginPath();
        trail.forEach((v, i) => {
          const x = cx0 + (i / (trail.length - 1)) * cw;
          const y = cy0 + ch - ((v - min) / range) * ch;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = P.chart;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.stroke();
        // 填充
        ctx.lineTo(cx0 + cw, cy0 + ch);
        ctx.lineTo(cx0, cy0 + ch);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, cy0, 0, cy0 + ch);
        grad.addColorStop(0, night ? 'rgba(224,138,110,.24)' : 'rgba(193,95,60,.16)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fill();
        // 起点终点
        ctx.font = '500 16px ui-monospace, monospace';
        ctx.fillStyle = P.sub;
        ctx.textAlign = 'left';
        ctx.fillText(fmt(trail[0]), cx0, cy0 + ch + 30);
        ctx.textAlign = 'right';
        ctx.fillText(fmt(trail[trail.length - 1]), cx0 + cw, cy0 + ch + 30);
        ctx.textAlign = 'left';
      } else {
        ctx.font = '500 20px system-ui, sans-serif';
        ctx.fillStyle = P.sub;
        ctx.fillText('还没有足够的交易记录。', cx0, cy0 + ch / 2);
      }

      // 统计三列
      const st = game.account.stats;
      const closed = st.trades;
      const winRate = closed ? Math.round((st.wins / closed) * 1000) / 10 : 0;
      const pf = st.grossLoss > 0 ? st.grossProfit / st.grossLoss : st.grossProfit > 0 ? Infinity : 0;
      const stats = [
        ['胜率', closed ? `${winRate}%` : '—'],
        ['交易笔数', String(closed)],
        ['盈利因子', closed ? (isFinite(pf) ? pf.toFixed(2) : '∞') : '—'],
        ['最大回撤', `${st.maxDrawdown.toFixed(1)}%`],
      ];
      const sy = 950;
      stats.forEach((s, i) => {
        const x = pad + i * ((W - pad * 2) / 4);
        ctx.font = '500 18px system-ui, sans-serif';
        ctx.fillStyle = P.sub;
        ctx.fillText(s[0], x, sy);
        ctx.font = '600 34px ui-monospace, monospace';
        ctx.fillStyle = P.ink;
        ctx.fillText(s[1], x, sy + 46);
      });

      // 分隔线
      ctx.strokeStyle = P.line;
      ctx.beginPath();
      ctx.moveTo(pad, 1060);
      ctx.lineTo(W - pad, 1060);
      ctx.stroke();

      // 成就
      const achCount = game.achCount();
      const achTotal = (FX.ACHIEVEMENTS || []).length;
      ctx.font = '500 20px system-ui, sans-serif';
      ctx.fillStyle = P.sub;
      ctx.fillText('成就', pad, 1110);
      ctx.font = '600 30px ui-monospace, monospace';
      ctx.fillStyle = P.ink;
      ctx.fillText(`${achCount} / ${achTotal}`, pad, 1152);

      // 战役星级
      if (game.mode === 'battle' && game.scenario) {
        ctx.font = '500 20px system-ui, sans-serif';
        ctx.fillStyle = P.sub;
        ctx.fillText('战役', pad, 1210);
        ctx.font = '600 28px system-ui, sans-serif';
        ctx.fillStyle = P.ink;
        ctx.fillText(game.scenario.title, pad, 1250);
      }

      // 一句话
      const quotes = [
        '杠杆放大的是结果，不是判断力。',
        '先想亏多少，再想赚多少。',
        '市场不会因为你观望而扣钱。',
        '在深渊里，学会呼吸。',
        '这次是你赢了，不是方法赢了。',
      ];
      const quote = quotes[U.hash(U.dateISO(new Date()) + game.mode) % quotes.length];
      ctx.font = '400 22px "Songti SC", "Noto Serif CJK SC", serif';
      ctx.fillStyle = P.sub;
      ctx.textAlign = 'center';
      ctx.fillText(quote, W / 2, 1320);

      // 页脚
      ctx.font = '500 16px system-ui, sans-serif';
      ctx.fillStyle = P.sub;
      ctx.fillText('模拟交易 · 仅供娱乐 · 不构成投资建议', W / 2, 1368);

      // 游戏网址
      ctx.font = '600 20px ui-monospace, monospace';
      ctx.fillStyle = P.brass;
      ctx.fillText('https://fx.coishi.top', W / 2, 1404);
      ctx.textAlign = 'left';

      return canvas;
    },

    download(canvas, filename) {
      try {
        const name = filename || `abyss-fx-${U.dateISO(new Date())}.png`;
        const url = canvas.toDataURL('image/png');
        // Android 壳：直接写入相册，WebView 对 <a download> 支持不可靠
        if (window.AbyssNative && typeof window.AbyssNative.savePng === 'function') {
          window.AbyssNative.savePng(url, name);
          return;
        }
        const a = document.createElement('a');
        a.download = name;
        a.href = url;
        a.click();
      } catch (err) {
        console.error(err);
      }
    },
  };

  FX.Share = Share;
})();
