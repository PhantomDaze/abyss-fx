/* 图表层：Canvas 2D K 线图（无第三方依赖）
 * 用法：new FX.Chart(canvas).render(model)
 * 只负责绘制，不创建行情循环；每次 render 只画一帧。
 */
(function () {
  'use strict';

  const FX = (window.FX = window.FX || {});

  const DEFAULT_FONT_MONO =
    '"SF Mono", "Cascadia Code", "Roboto Mono", "JetBrains Mono", "IBM Plex Mono", "Noto Sans Mono", ui-monospace, monospace';
  const DEFAULT_FONT_UI =
    'system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif';

  const PAD = { left: 16, right: 64, top: 24, bottom: 18 };
  const MIN_BARS = 54;
  const MAX_BARS = 70;
  const RIGHT_GAP = 2.5; // 右侧留 2–3 根空位

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  class Chart {
    constructor(canvas) {
      if (!canvas || typeof canvas.getContext !== 'function') {
        throw new Error('FX.Chart 需要一个 canvas 元素');
      }
      this.canvas = canvas;
      // willReadFrequently 让 Chromium 使用 CPU 画布，规避部分低端 GPU
      // （如 Adreno 610）把 canvas 渲染成纯色块的问题
      this.ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!this.ctx) throw new Error('FX.Chart 无法获取 2D 绘图上下文');
      if (!canvas.getAttribute('role')) canvas.setAttribute('role', 'img');
      this.wrap = canvas.parentElement;
      this.model = null;
      this._prevCursor = canvas.style.cursor;

      this.w = 0;
      this.h = 0;
      this.dpr = 1;
      this.hover = null;
      this._hoverTimer = 0;
      this._raf = 0;
      this._dead = false;
      this._ro = null;

      // 根元素的实时样式：用来读取 CSS 变量并展开 var() 引用
      this._rootStyle = null;

      this._resolveVar = this._resolveVar.bind(this);
      this._syncSize = this._syncSize.bind(this);
      this._draw = this._draw.bind(this);
      this._onPointerMove = this._onPointerMove.bind(this);
      this._onPointerDown = this._onPointerDown.bind(this);
      this._onPointerUp = this._onPointerUp.bind(this);
      this._onPointerLeave = this._onPointerLeave.bind(this);
      this._onWindowResize = this._onWindowResize.bind(this);

      this._bindEvents();

      if (typeof ResizeObserver !== 'undefined') {
        this._ro = new ResizeObserver(this._onWindowResize);
        this._ro.observe(canvas);
        if (this.wrap) this._ro.observe(this.wrap);
      }
      window.addEventListener('resize', this._onWindowResize, { passive: true });
      // 页面完全加载后再量一次，规避 WebView 首帧布局未就绪
      window.addEventListener('load', this._onWindowResize, { passive: true });

      // 初始尺寸同步，但绘制留到 render；若已有 CSS 高度则先铺底色
      this._syncSize();
      this._draw();
      // 旧版 Android WebView 可能不支持 clamp()，容器首次测量为 0，稍后重试
      this._retryTimer = setTimeout(() => {
        if (this._dead) return;
        this._onWindowResize();
      }, 300);
    }

    /* ---------- 公开接口 ---------- */

    render(model) {
      if (this._dead) return false;
      this.model = model && typeof model === 'object' ? model : {};
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = 0;
      }
      // 容器隐藏时只记录 model，不画；重新可见后由 ResizeObserver 触发重绘
      if (!this._syncSize()) {
        this._scheduleSizeRetry();
        return false;
      }
      this._draw();
      return true;
    }

    resize() {
      if (this._dead) return;
      if (!this._syncSize()) return;
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = 0;
      }
      this._draw();
    }

    destroy() {
      if (this._dead) return;
      this._dead = true;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
      if (this._hoverTimer) clearTimeout(this._hoverTimer);
      this._hoverTimer = 0;
      if (this._retryTimer) clearTimeout(this._retryTimer);
      this._retryTimer = 0;
      if (this._ro) this._ro.disconnect();
      this._ro = null;
      window.removeEventListener('resize', this._onWindowResize);
      window.removeEventListener('load', this._onWindowResize);
      this._unbindEvents();
      this._rootStyle = null;
      this.canvas.style.cursor = this._prevCursor || '';
      this.model = null;
      this.hover = null;
    }

    /* ---------- 尺寸与高分屏 ---------- */

    _syncSize() {
      let rect = this.canvas.getBoundingClientRect();
      let w = Math.round(rect.width);
      let h = Math.round(rect.height);
      // 容器塌陷兜底：老 WebView 不支持 clamp() 时图表高度会变成 0
      if (w && !h && this.wrap && this.wrap.offsetParent !== null) {
        this.wrap.style.height = window.innerWidth <= 899 ? '260px' : '360px';
        rect = this.canvas.getBoundingClientRect();
        w = Math.round(rect.width);
        h = Math.round(rect.height);
      }
      if (!w || !h) return false; // display:none / 折叠容器

      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const bw = Math.max(1, Math.round(w * dpr));
      const bh = Math.max(1, Math.round(h * dpr));
      if (this.canvas.width !== bw) this.canvas.width = bw;
      if (this.canvas.height !== bh) this.canvas.height = bh;

      this.w = w;
      this.h = h;
      this.dpr = dpr;
      return true;
    }

    _onWindowResize() {
      if (this._dead) return;
      // ResizeObserver 可能在布局前触发；先同步，再在下一帧绘制
      if (!this._syncSize()) return;
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = 0;
      }
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        if (this._dead) return;
        if (!this._syncSize()) return;
        this._draw();
      });
    }

    // 尺寸还没稳定时（老 WebView 首帧、旋转屏幕）稍后重试
    _scheduleSizeRetry() {
      if (this._dead || this._retryTimer) return;
      this._retryTimer = setTimeout(() => {
        this._retryTimer = 0;
        if (this._dead) return;
        if (this.model) this.render(this.model);
        else this._onWindowResize();
      }, 250);
    }

    _scheduleDraw() {
      if (this._dead || this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        if (!this._dead) this._draw();
      });
    }

    /* ---------- 指针 / 触摸 ---------- */

    _bindEvents() {
      this.canvas.style.cursor = 'crosshair';
      if (typeof window.PointerEvent === 'function') {
        this.canvas.addEventListener('pointermove', this._onPointerMove, { passive: true });
        this.canvas.addEventListener('pointerdown', this._onPointerDown, { passive: true });
        this.canvas.addEventListener('pointerup', this._onPointerUp, { passive: true });
        this.canvas.addEventListener('pointercancel', this._onPointerUp, { passive: true });
        this.canvas.addEventListener('pointerleave', this._onPointerLeave, { passive: true });
        this._pointerEvents = true;
      } else {
        this.canvas.addEventListener('mousemove', this._onPointerMove, { passive: true });
        this.canvas.addEventListener('mouseleave', this._onPointerLeave, { passive: true });
        this.canvas.addEventListener('touchstart', this._onPointerDown, { passive: true });
        this.canvas.addEventListener('touchmove', this._onPointerMove, { passive: true });
        this.canvas.addEventListener('touchend', this._onPointerUp, { passive: true });
        this.canvas.addEventListener('touchcancel', this._onPointerUp, { passive: true });
        this._pointerEvents = false;
      }
    }

    _unbindEvents() {
      if (this._pointerEvents) {
        this.canvas.removeEventListener('pointermove', this._onPointerMove);
        this.canvas.removeEventListener('pointerdown', this._onPointerDown);
        this.canvas.removeEventListener('pointerup', this._onPointerUp);
        this.canvas.removeEventListener('pointercancel', this._onPointerUp);
        this.canvas.removeEventListener('pointerleave', this._onPointerLeave);
      } else {
        this.canvas.removeEventListener('mousemove', this._onPointerMove);
        this.canvas.removeEventListener('mouseleave', this._onPointerLeave);
        this.canvas.removeEventListener('touchstart', this._onPointerDown);
        this.canvas.removeEventListener('touchmove', this._onPointerMove);
        this.canvas.removeEventListener('touchend', this._onPointerUp);
        this.canvas.removeEventListener('touchcancel', this._onPointerUp);
      }
    }

    _localPoint(e) {
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height || !this.w || !this.h) return null;
      const source = e.touches && e.touches.length ? e.touches[0] : e;
      if (!source || !isNum(source.clientX) || !isNum(source.clientY)) return null;
      const x = (source.clientX - rect.left) * (this.w / rect.width);
      const y = (source.clientY - rect.top) * (this.h / rect.height);
      const right = this.w - PAD.right;
      const bottom = this.h - PAD.bottom;
      if (x < PAD.left || x > right || y < PAD.top || y > bottom) return null;
      return { x, y };
    }

    _onPointerMove(e) {
      if (this._hoverTimer) {
        clearTimeout(this._hoverTimer);
        this._hoverTimer = 0;
      }
      const p = this._localPoint(e);
      this.hover = p;
      this._scheduleDraw();
    }

    _onPointerDown(e) {
      if (this._hoverTimer) {
        clearTimeout(this._hoverTimer);
        this._hoverTimer = 0;
      }
      const p = this._localPoint(e);
      if (p) {
        this.hover = p;
        this._scheduleDraw();
      }
    }

    _onPointerUp(e) {
      const p = this._localPoint(e);
      if (p) {
        this.hover = p;
        this._scheduleDraw();
      }
      const touch = (e && e.pointerType === 'touch') || (e && e.type && e.type.indexOf('touch') === 0);
      if (touch) {
        if (this._hoverTimer) clearTimeout(this._hoverTimer);
        // 触屏松开后保留 2 秒，便于读数
        this._hoverTimer = setTimeout(() => {
          this._hoverTimer = 0;
          this.hover = null;
          this._scheduleDraw();
        }, 2000);
      }
    }

    _onPointerLeave(e) {
      if (e && (e.pointerType === 'touch' || (e.type && e.type.indexOf('touch') === 0))) {
        if (this._hoverTimer) clearTimeout(this._hoverTimer);
        this._hoverTimer = setTimeout(() => {
          this._hoverTimer = 0;
          this.hover = null;
          this._scheduleDraw();
        }, 2000);
        return;
      }
      this.hover = null;
      this._scheduleDraw();
    }

    /* ---------- 主题配色 ---------- */

    // 读取根元素上的 CSS 变量（自定义属性的计算值里 var() 已被替换）
    _rootVar(name) {
      if (!this._rootStyle) this._rootStyle = getComputedStyle(document.documentElement);
      const v = this._rootStyle.getPropertyValue(name);
      return v ? v.trim() : '';
    }

    // 展开 var(--x) 引用链，得到 canvas 能直接用的颜色字符串。
    // 注意：不要用“隐藏探针元素 + getComputedStyle 回读颜色”的写法——
    // 部分安卓内核（OPPO A32 上的 Edge/WebView 实测）不会在回读时刷新样式，
    // 一轮取色全部拿到上一次设置的值（--chart-order），整块画布会变成纯色。
    _resolveVar(raw) {
      let v = String(raw == null ? '' : raw).trim();
      for (let guard = 0; guard < 8; guard++) {
        const m = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(v);
        if (!m) break;
        const next = this._rootVar(m[1]);
        if (next) {
          v = next;
          continue;
        }
        const fb = (m[2] || '').trim();
        if (!fb) break;
        v = fb;
      }
      return v;
    }

    _theme() {
      const pick = (names, fallback) => {
        for (let i = 0; i < names.length; i++) {
          const raw = this._rootVar(names[i]);
          if (raw) {
            const c = this._resolveVar(raw);
            if (c) return c;
          }
        }
        return fallback;
      };

      let mono = this._rootVar('--font-mono');
      if (!mono || mono.indexOf('var(') >= 0) mono = DEFAULT_FONT_MONO;
      let ui = this._rootVar('--font-ui');
      if (!ui || ui.indexOf('var(') >= 0) ui = DEFAULT_FONT_UI;

      return {
        bg: pick(['--chart-bg'], '#0F1B20'),
        grid: pick(['--chart-grid'], 'rgba(235,228,211,.07)'),
        axis: pick(['--chart-axis'], '#91A59F'),
        text: pick(['--chart-text'], '#DDE6E1'),
        up: pick(['--chart-up', '--mkt-up', '--chart-red'], '#FF7468'),
        down: pick(['--chart-down', '--mkt-down', '--chart-green'], '#43C9AA'),
        ma1: pick(['--chart-ma-1'], '#E6C177'),
        ma2: pick(['--chart-ma-2'], '#83A9D6'),
        ma3: pick(['--chart-ma-3'], '#B692C4'),
        cross: pick(['--chart-crosshair'], '#C8D4CF'),
        current: pick(['--chart-current'], '#D7A65A'),
        entry: pick(['--chart-entry'], '#D7A65A'),
        sl: pick(['--chart-sl'], '#FF7A6E'),
        tp: pick(['--chart-tp'], '#6FC7E2'),
        liq: pick(['--chart-liq'], '#FF4D42'),
        order: pick(['--chart-order'], '#C9B47C'),
        mono: mono.replace(/\s+/g, ' '),
        ui: ui.replace(/\s+/g, ' '),
      };
    }

    _monoFont(size, weight) {
      this.ctx.font = (weight ? weight + ' ' : '') + size + 'px ' + this._themeFontMono;
    }

    _uiFont(size, weight) {
      this.ctx.font = (weight ? weight + ' ' : '') + size + 'px ' + this._themeFontUi;
    }

    /* ---------- 数据与格式化 ---------- */

    _normalize(model) {
      const rawBars = Array.isArray(model.bars) ? model.bars : [];
      const all = [];
      for (let i = 0; i < rawBars.length; i++) {
        const b = rawBars[i];
        if (!b) continue;
        if (!isNum(b.t) || !isNum(b.o) || !isNum(b.h) || !isNum(b.l) || !isNum(b.c)) continue;
        all.push({
          t: b.t,
          o: b.o,
          h: Math.max(b.h, b.o, b.c),
          l: Math.min(b.l, b.o, b.c),
          c: b.c,
          v: isNum(b.v) ? b.v : 0,
        });
      }
      const f = model.forming;
      if (f && isNum(f.t) && isNum(f.o) && isNum(f.h) && isNum(f.l) && isNum(f.c)) {
        all.push({
          t: f.t,
          o: f.o,
          h: Math.max(f.h, f.o, f.c),
          l: Math.min(f.l, f.o, f.c),
          c: f.c,
          v: isNum(f.v) ? f.v : 0,
          forming: true,
        });
      }

      let digits = Number.isInteger(model.digits) ? model.digits : null;
      if (digits == null) {
        const pip = isNum(model.pip) && model.pip > 0 ? model.pip : 0.0001;
        digits = Math.max(0, Math.min(8, Math.round(-Math.log10(pip))));
      }
      digits = clamp(digits, 0, 8);

      return { all, digits, model };
    }

    _inferInterval(all, model) {
      const diffs = [];
      for (let i = 1; i < all.length && diffs.length < 20; i++) {
        const d = all[i].t - all[i - 1].t;
        if (d > 0) diffs.push(d);
      }
      if (diffs.length) {
        diffs.sort((a, b) => a - b);
        return diffs[Math.floor(diffs.length / 2)];
      }
      const label = String(model.tfLabel || '').toLowerCase();
      if (label.indexOf('月') >= 0 || label.indexOf('1m') >= 0) return 43200;
      if (label.indexOf('周') >= 0 || label.indexOf('1w') >= 0) return 10080;
      if (label.indexOf('日') >= 0 || label.indexOf('1d') >= 0) return 1440;
      if (label.indexOf('4h') >= 0 || label.indexOf('4小时') >= 0) return 240;
      if (label.indexOf('1h') >= 0 || label.indexOf('1小时') >= 0) return 60;
      return 15;
    }

    _fmtTime(t, interval) {
      const d = new Date(t * 60000);
      if (!isFinite(d.getTime())) return '—';
      if (interval < 1440) {
        // 日内显示 HH:MM（UTC，与 Date.UTC 生成的 t 对齐）
        return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
      }
      // 历史数据的时间戳按本地零点生成，模拟行情按 UTC 零点生成。
      // 日期标签对本地零点做一次兼容，避免历史回放日期整体偏一天。
      const useLocal =
        d.getHours() === 0 &&
        d.getMinutes() === 0 &&
        !(d.getUTCHours() === 0 && d.getUTCMinutes() === 0);
      const y = useLocal ? d.getFullYear() : d.getUTCFullYear();
      const mo = (useLocal ? d.getMonth() : d.getUTCMonth()) + 1;
      const da = useLocal ? d.getDate() : d.getUTCDate();
      if (interval >= 25 * 1440) return y + '-' + pad2(mo);
      return y + '-' + pad2(mo) + '-' + pad2(da);
    }

    _fmtPrice(v, digits) {
      return isFinite(v) ? Number(v).toFixed(digits) : '—';
    }

    _fmtVolume(v) {
      if (!isFinite(v)) return '—';
      if (v >= 100000000) return (v / 100000000).toFixed(1) + '亿';
      if (v >= 10000) return (v / 10000).toFixed(1) + '万';
      if (v >= 1000) return (v / 1000).toFixed(1) + '千';
      return String(Math.round(v));
    }

    _sma(values, period) {
      const out = new Array(values.length);
      let sum = 0;
      for (let i = 0; i < values.length; i++) {
        sum += values[i];
        if (i >= period) sum -= values[i - period];
        out[i] = i >= period - 1 ? sum / period : null;
      }
      return out;
    }

    _nearestIndex(all, t) {
      if (!all.length) return -1;
      let lo = 0;
      let hi = all.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (all[mid].t < t) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0 && Math.abs(all[lo - 1].t - t) <= Math.abs(all[lo].t - t)) return lo - 1;
      return lo;
    }

    _fitFont(text, maxW, base, min, mono) {
      let size = base;
      const set = (s) => {
        this.ctx.font = s + 'px ' + (mono ? this._themeFontMono : this._themeFontUi);
      };
      set(size);
      while (size > min && this.ctx.measureText(text).width > maxW) {
        size -= 0.5;
        set(size);
      }
      return size;
    }

    /* ---------- 主绘制 ---------- */

    _draw() {
      if (this._dead || !this.ctx || !this.w || !this.h) return;
      const ctx = this.ctx;
      const colors = this._theme();
      this._themeFontMono = colors.mono;
      this._themeFontUi = colors.ui;

      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.lineJoin = 'miter';
      ctx.lineCap = 'butt';
      ctx.textBaseline = 'middle';

      const model = this.model || {};
      const norm = this._normalize(model);
      const all = norm.all;
      const digits = norm.digits;

      if (!all.length) {
        this._drawEmpty(model, colors);
        this._setAria(model, null, null, null, 0, digits);
        return;
      }

      const w = this.w;
      const h = this.h;
      const plotX = PAD.left;
      const plotR = Math.max(plotX + 24, w - PAD.right);
      const plotW = Math.max(24, plotR - plotX);
      const plotT = PAD.top;
      const plotB = Math.max(plotT + 24, h - PAD.bottom);
      const innerH = plotB - plotT;

      // 成交量占底部约 20%，但在常见图表高度下封顶 48px
      let volH = innerH > 130 ? Math.min(48, Math.max(24, Math.round(innerH * 0.2))) : 0;
      let priceTop = plotT;
      let priceBottom = plotB - (volH ? volH + 8 : 0);
      if (priceBottom - priceTop < 48) {
        volH = 0;
        priceBottom = plotB;
      }
      const volTop = volH ? priceBottom + 8 : plotB;

      const interval = this._inferInterval(all, model);

      let count = Math.floor(plotW / 8.5);
      count = clamp(count || MIN_BARS, MIN_BARS, MAX_BARS);
      const shown = Math.min(count, all.length);
      const start = all.length - shown;
      const end = all.length - 1;
      const slot = plotW / (shown + RIGHT_GAP);
      const xAt = (idx) => plotX + (idx - start + 0.5) * slot;

      // 当前价：优先买卖价中值，否则用最后一根收盘
      let current = null;
      if (isNum(model.bid) && isNum(model.ask)) current = (model.bid + model.ask) / 2;
      else if (isNum(model.bid)) current = model.bid;
      else if (isNum(model.ask)) current = model.ask;
      if (!isNum(current)) current = all[end].c;

      // 价格范围只由可见 K 线决定；越界的持仓线在边缘画箭头
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = start; i <= end; i++) {
        const b = all[i];
        if (b.l < lo) lo = b.l;
        if (b.h > hi) hi = b.h;
      }
      if (isNum(current)) {
        if (current < lo) lo = current;
        if (current > hi) hi = current;
      }
      if (!isFinite(lo) || !isFinite(hi)) {
        this._drawEmpty(model, colors);
        this._setAria(model, null, null, null, 0, digits);
        return;
      }
      let range = hi - lo;
      if (!(range > 0)) range = Math.max(Math.abs(hi) * 0.0005, (isNum(model.pip) ? model.pip : 0.0001) * 20);
      const padRange = range * 0.08;
      lo -= padRange;
      hi += padRange;
      const priceH = priceBottom - priceTop;
      const mapY = (p) => priceTop + ((hi - p) / (hi - lo)) * priceH;

      const g = {
        w, h, plotX, plotR, plotW, plotT, plotB, priceTop, priceBottom, priceH,
        volH, volTop, slot, start, shown, end, all, digits, lo, hi, mapY, xAt,
        interval, current, colors,
      };

      this._drawGrid(g);
      this._drawEvents(g, model.events);
      this._drawVolume(g);
      this._drawCandlesAndMa(g);

      const overlay = this._drawOverlays(g, model.overlays);
      this._drawCurrent(g, overlay.currentRect);
      this._drawCrosshair(g, overlay);
      this._drawTopMeta(g, model);

      this._setAria(model, all[end], end > start ? all[end - 1] : null, current, shown, digits);
    }

    _drawEmpty(model, colors) {
      this._themeFontUi = colors.ui;
      const ctx = this.ctx;
      const text = model.emptyText || '还没有行情。';
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, this.w, this.h);
      this._uiFont(12);
      ctx.fillStyle = colors.axis;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, this.w / 2, this.h / 2);
    }

    _drawGrid(g) {
      const ctx = this.ctx;
      const c = g.colors;
      ctx.save();
      ctx.strokeStyle = c.grid;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);

      // 5 条横向网格（含上下边界）
      for (let i = 0; i < 5; i++) {
        const y = Math.round(g.priceTop + (g.priceH * i) / 4) + 0.5;
        ctx.beginPath();
        ctx.moveTo(g.plotX, y);
        ctx.lineTo(g.plotR, y);
        ctx.stroke();
      }
      // 6 条纵向网格（含左右边界）
      for (let i = 0; i < 6; i++) {
        const x = Math.round(g.plotX + (g.plotW * i) / 5) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, g.plotT);
        ctx.lineTo(x, g.volH ? g.plotB : g.priceBottom);
        ctx.stroke();
      }
      // 成交量区域顶线
      if (g.volH) {
        const y = Math.round(g.volTop) + 0.5;
        ctx.beginPath();
        ctx.moveTo(g.plotX, y);
        ctx.lineTo(g.plotR, y);
        ctx.stroke();
      }
      // 时间轴分隔线
      const by = Math.round(g.plotB) + 0.5;
      ctx.beginPath();
      ctx.moveTo(g.plotX, by);
      ctx.lineTo(g.plotR, by);
      ctx.stroke();
      ctx.restore();

      // 右侧价格轴刻度：10px 等宽
      this._monoFont(10);
      ctx.fillStyle = c.axis;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < 5; i++) {
        const p = g.hi - ((g.hi - g.lo) * i) / 4;
        const y = clamp(g.priceTop + (g.priceH * i) / 4, g.priceTop + 6, g.priceBottom - 6);
        ctx.fillText(this._fmtPrice(p, g.digits), g.plotR + 6, y);
      }

      // 底部时间轴：常规 5 个标签，窄屏按文字宽度自动减少，避免重叠
      this._monoFont(9);
      const sample = this._fmtTime(g.all[g.start].t, g.interval);
      const sampleW = ctx.measureText(sample).width;
      const labelCount = clamp(Math.min(g.shown, Math.floor(g.plotW / (sampleW + 22))), 1, 5);
      ctx.fillStyle = c.axis;
      ctx.textBaseline = 'middle';
      for (let i = 1; i <= labelCount; i++) {
        const x = g.plotX + (g.plotW * i) / labelCount;
        const j = clamp(Math.round((x - g.plotX) / g.slot - 0.5), 0, g.shown - 1);
        const bar = g.all[g.start + j];
        const label = this._fmtTime(bar.t, g.interval);
        const right = i === labelCount;
        ctx.textAlign = right ? 'right' : 'center';
        ctx.fillText(label, right ? g.plotR - 2 : x, g.plotB + 10);
      }
    }

    _drawEvents(g, events) {
      if (!Array.isArray(events) || !events.length) return;
      const ctx = this.ctx;
      const c = g.colors;
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (!e || !isNum(e.t)) continue;
        const idx = this._nearestIndex(g.all, e.t);
        if (idx < g.start || idx > g.end) continue;
        const x = g.xAt(idx);
        if (x < g.plotX || x > g.plotR) continue;
        const imp = Number(e.imp) || 1;
        const color = imp >= 3 ? c.liq : imp >= 2 ? c.order : c.axis;
        const xx = Math.round(x) + 0.5;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = imp >= 3 ? 1.2 : 1;
        ctx.globalAlpha = imp >= 3 ? 0.4 : 0.28;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(xx, g.plotT);
        ctx.lineTo(xx, g.volH ? g.plotB : g.priceBottom);
        ctx.stroke();
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(xx, g.plotT + 5, imp >= 3 ? 2.3 : 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    _drawVolume(g) {
      if (!g.volH) return;
      const ctx = this.ctx;
      const c = g.colors;

      let maxV = 0;
      for (let i = g.start; i <= g.end; i++) {
        const v = g.all[i].v || 0;
        if (v > maxV) maxV = v;
      }
      const bottom = g.plotB;
      const inner = Math.max(1, bottom - g.volTop - 1);
      const bw = Math.min(9, Math.max(2, g.slot * 0.58));

      if (maxV > 0) {
        ctx.save();
        ctx.globalAlpha = 0.38;
        for (let i = g.start; i <= g.end; i++) {
          const b = g.all[i];
          if (!(b.v > 0)) continue;
          const x = g.xAt(i);
          const bh = Math.max(1, (b.v / maxV) * inner);
          ctx.fillStyle = b.c >= b.o ? c.up : c.down;
          ctx.fillRect(x - bw / 2, bottom - bh, bw, bh);
        }
        ctx.restore();
      }

      // 成交量小标题
      this._monoFont(8);
      const label = '成交量';
      const tw = ctx.measureText(label).width;
      ctx.save();
      ctx.globalAlpha = 0.82;
      ctx.fillStyle = c.bg;
      ctx.fillRect(g.plotX + 2, g.volTop + 2, tw + 6, 12);
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.axis;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, g.plotX + 5, g.volTop + 8);
      ctx.restore();
    }

    _drawCandlesAndMa(g) {
      const ctx = this.ctx;
      const c = g.colors;
      const bw = Math.min(9, Math.max(3, g.slot * 0.6));

      ctx.save();
      ctx.beginPath();
      ctx.rect(g.plotX, g.priceTop, g.plotW, g.priceH);
      ctx.clip();

      // K 线
      for (let i = g.start; i <= g.end; i++) {
        const b = g.all[i];
        const x = g.xAt(i);
        const yH = g.mapY(b.h);
        const yL = g.mapY(b.l);
        const up = b.c >= b.o;
        const color = up ? c.up : c.down;
        const yO = g.mapY(b.o);
        const yC = g.mapY(b.c);
        let bodyTop = Math.min(yO, yC);
        let bodyH = Math.abs(yO - yC);
        if (bodyH < 2) {
          bodyTop -= (2 - bodyH) / 2;
          bodyH = 2;
        }
        const left = x - bw / 2;

        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x, yH);
        ctx.lineTo(x, yL);
        ctx.stroke();

        if (up) {
          // 上涨：空心
          ctx.strokeRect(left, bodyTop, bw, bodyH);
        } else {
          // 下跌：实心
          ctx.fillRect(left, bodyTop, bw, bodyH);
        }
      }

      // 均线 MA7 / MA25 / MA99
      const closes = new Array(g.all.length);
      for (let i = 0; i < g.all.length; i++) closes[i] = g.all[i].c;
      const mas = [
        { period: 7, color: c.ma1, label: 'MA7' },
        { period: 25, color: c.ma2, label: 'MA25' },
        { period: 99, color: c.ma3, label: 'MA99' },
      ];
      const maData = [];
      for (let m = 0; m < mas.length; m++) {
        const vals = this._sma(closes, mas[m].period);
        let last = null;
        for (let i = vals.length - 1; i >= 0; i--) {
          if (vals[i] != null) {
            last = vals[i];
            break;
          }
        }
        maData.push({ period: mas[m].period, color: mas[m].color, label: mas[m].label, vals, last });

        ctx.strokeStyle = mas[m].color;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([]);
        ctx.beginPath();
        let began = false;
        for (let i = g.start; i <= g.end; i++) {
          const v = vals[i];
          if (v == null) continue;
          const x = g.xAt(i);
          const y = g.mapY(v);
          if (!began) {
            ctx.moveTo(x, y);
            began = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        if (began) ctx.stroke();
      }
      ctx.restore();

      // 左上角均线图例（取最新一根对应的 MA 值）；窄屏自动缩小字号
      const legendTexts = maData.map(
        (item) => item.label + ' ' + (item.last == null ? '—' : this._fmtPrice(item.last, g.digits))
      );
      let legendSize = 10;
      let legendW = 0;
      for (;;) {
        this._monoFont(legendSize);
        legendW = 0;
        for (let i = 0; i < legendTexts.length; i++) {
          legendW += ctx.measureText(legendTexts[i]).width + 11;
        }
        legendW -= 11;
        if (legendSize <= 8 || legendW <= g.plotW - 8) break;
        legendSize -= 0.5;
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      let lx = g.plotX + 1;
      for (let i = 0; i < maData.length; i++) {
        const txt = legendTexts[i];
        const tw = ctx.measureText(txt).width;
        if (lx + tw > g.plotR - 2) break;
        ctx.fillStyle = maData[i].color;
        ctx.globalAlpha = 0.92;
        ctx.fillText(txt, lx, 13);
        ctx.globalAlpha = 1;
        lx += tw + 11;
      }
      g.maLegendRight = lx - 11;
    }

    _drawOverlays(g, overlays) {
      const ctx = this.ctx;
      const c = g.colors;
      const ov = overlays && typeof overlays === 'object' ? overlays : {};
      const positions = Array.isArray(ov.positions) ? ov.positions : [];
      const orders = Array.isArray(ov.orders) ? ov.orders : [];

      // 统一去重：同类型同价格只画一次
      const seen = Object.create(null);
      const groups = {
        orders: [],
        entries: [],
        stops: [],
        liqs: [],
      };
      const add = (group, price, text, color) => {
        if (!isNum(price) || price <= 0) return;
        const key = group + '|' + text + '|' + price.toFixed(g.digits + 2);
        if (seen[key]) return;
        seen[key] = 1;
        const visible = price >= g.lo && price <= g.hi;
        const y = visible ? g.mapY(price) : price > g.hi ? g.priceTop + 7 : g.priceBottom - 7;
        groups[group].push({ price, text, color, visible, y });
      };

      for (let i = 0; i < positions.length; i++) {
        const p = positions[i] || {};
        add('entries', p.entry, 'ENTRY', c.entry);
        add('stops', p.sl, 'SL', c.sl);
        add('stops', p.tp, 'TP', c.tp);
        if (isNum(p.liq)) add('liqs', p.liq, 'LIQ', c.liq);
      }
      if (isNum(ov.liqPrice)) add('liqs', ov.liqPrice, 'LIQ', c.liq);
      for (let i = 0; i < orders.length; i++) {
        const o = orders[i] || {};
        const label = String(o.type || 'limit').toLowerCase() === 'stop' ? 'STOP' : 'LIMIT';
        add('orders', o.price, label, c.order);
      }

      // 强平线下方 6% 透明红区（在 K 线和线之间，带一点压迫感）
      for (let i = 0; i < groups.liqs.length; i++) {
        const item = groups.liqs[i];
        if (!item.visible) continue;
        const y = g.mapY(item.price);
        const zone = Math.min(g.priceH * 0.06, g.priceBottom - y);
        if (zone > 0) {
          ctx.save();
          ctx.globalAlpha = 0.11;
          ctx.fillStyle = c.liq;
          ctx.fillRect(g.plotX, y, g.plotW, zone);
          ctx.restore();
        }
      }

      // 挂单：35% 透明虚线 + 小三角
      for (let i = 0; i < groups.orders.length; i++) {
        const item = groups.orders[i];
        if (!item.visible) continue;
        this._priceLine(g, item, [3, 4], 0.35, 1);
        const y = Math.round(item.y) + 0.5;
        ctx.save();
        ctx.strokeStyle = c.order;
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(g.plotR - 4, y);
        ctx.lineTo(g.plotR - 10, y - 4);
        ctx.lineTo(g.plotR - 10, y + 4);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }

      // 开仓线：点线
      for (let i = 0; i < groups.entries.length; i++) {
        const item = groups.entries[i];
        if (!item.visible) continue;
        this._priceLine(g, item, [1, 3], 0.88, 1);
      }

      // 止损 / 止盈：虚线
      for (let i = 0; i < groups.stops.length; i++) {
        const item = groups.stops[i];
        if (!item.visible) continue;
        this._priceLine(g, item, [4, 3], 0.9, 1);
      }

      // 强平：5/3 交替虚线，比 SL 更有结构
      for (let i = 0; i < groups.liqs.length; i++) {
        const item = groups.liqs[i];
        if (!item.visible) continue;
        this._priceLine(g, item, [5, 3], 0.98, 1.6);
      }

      // 越界价格：在边缘画小箭头
      const allItems = groups.orders.concat(groups.entries, groups.stops, groups.liqs);
      for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i];
        if (item.visible) continue;
        const above = item.price > g.hi;
        const x = g.plotR - 7;
        const y = above ? g.priceTop + 9 : g.priceBottom - 9;
        ctx.save();
        ctx.fillStyle = item.color;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        if (above) {
          ctx.moveTo(x, y - 4);
          ctx.lineTo(x - 4, y + 3);
          ctx.lineTo(x + 4, y + 3);
        } else {
          ctx.moveTo(x, y + 4);
          ctx.lineTo(x - 4, y - 3);
          ctx.lineTo(x + 4, y - 3);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // 当前价标签的占位矩形（先算出来，其他旗标避开它）
      const curY = clamp(g.mapY(g.current), g.priceTop, g.priceBottom);
      const currentRect = {
        x: g.plotR + 2,
        y: clamp(curY - 8, g.plotT, g.plotB - 16),
        w: Math.max(20, g.w - g.plotR - 4),
        h: 16,
      };

      const placed = [currentRect];
      const flagItems = allItems
        .filter((it) => it && it.text)
        .sort((a, b) => a.y - b.y);

      // 标签太多时改用单行胶囊，优先保证不重叠
      const twoLine = flagItems.length * 26 <= g.plotB - g.plotT;
      const tagH = twoLine ? 24 : 15;
      ctx.save();
      for (let i = 0; i < flagItems.length; i++) {
        const item = flagItems[i];
        const maxW = Math.max(16, g.w - g.plotR - 4);
        const y = this._placeTag(item.y - tagH / 2, tagH, placed, g.plotT, g.plotB - tagH);
        if (y == null) continue; // 轴内没有空位时宁可不画标签，也不叠字
        const rect = { x: g.plotR + 2, y, w: maxW, h: tagH };
        placed.push(rect);

        ctx.fillStyle = c.bg;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.fillStyle = item.color;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(rect.x, rect.y, 2, rect.h);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = item.color;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1;
        ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
        ctx.globalAlpha = 1;

        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = item.color;
        if (twoLine) {
          this._fitFont(item.text, maxW - 9, 9, 7, true);
          ctx.fillText(item.text, rect.x + 5, rect.y + 8);
          this._fitFont(this._fmtPrice(item.price, g.digits), maxW - 9, 9, 7, true);
          ctx.globalAlpha = 0.9;
          ctx.fillText(this._fmtPrice(item.price, g.digits), rect.x + 5, rect.y + 17);
        } else {
          const one = item.text + ' ' + this._fmtPrice(item.price, g.digits);
          this._fitFont(one, maxW - 9, 8.5, 6.5, true);
          ctx.fillText(one, rect.x + 5, rect.y + tagH / 2 + 0.5);
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      return { currentRect, placed, groups };
    }

    _priceLine(g, item, dash, alpha, width) {
      if (!item.visible) return;
      const ctx = this.ctx;
      const y = Math.round(item.y) + 0.5;
      ctx.save();
      ctx.strokeStyle = item.color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(g.plotX, y);
      ctx.lineTo(g.plotR, y);
      ctx.stroke();
      ctx.restore();
    }

    _placeTag(preferred, h, placed, top, bottom) {
      const lo = top;
      const hi = bottom - h;
      if (hi <= lo) return lo;
      let best = null;
      let bestDist = Infinity;
      // 在右侧轴内寻找离目标位置最近、且不与现有标签重叠的纵向位置
      for (let y = lo; y <= hi; y += 1) {
        let hit = false;
        for (let i = 0; i < placed.length; i++) {
          const r = placed[i];
          if (y < r.y + r.h + 2 && y + h + 2 > r.y) {
            hit = true;
            break;
          }
        }
        if (hit) continue;
        const dist = Math.abs(y - preferred);
        if (dist < bestDist) {
          best = y;
          bestDist = dist;
          if (dist === 0) break;
        }
      }
      return best;
    }

    _drawCurrent(g, currentRect) {
      const ctx = this.ctx;
      const c = g.colors;
      const y = Math.round(clamp(g.mapY(g.current), g.priceTop, g.priceBottom)) + 0.5;

      ctx.save();
      ctx.strokeStyle = c.current;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.95;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(g.plotX, y);
      ctx.lineTo(g.plotR, y);
      ctx.stroke();
      ctx.restore();

      // 右侧当前价标签；只占右侧轴，不跨入绘图区
      const r = currentRect;
      ctx.save();
      ctx.fillStyle = c.current;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      const currentText = this._fmtPrice(g.current, g.digits);
      this._fitFont(currentText, r.w - 6, 10, 8, true);
      ctx.fillStyle = c.bg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(currentText, r.x + r.w / 2, r.y + r.h / 2 + 0.5);
      ctx.restore();
      g.currentTagRect = r;
    }

    _drawCrosshair(g, overlay) {
      if (!this.hover) return;
      const ctx = this.ctx;
      const c = g.colors;
      const hx = clamp(this.hover.x, g.plotX, g.plotR);
      const hy = this.hover.y;
      const inPrice = hy >= g.priceTop && hy <= g.priceBottom;

      // 最近 K 线（用于 OHLC 与时间标签）
      const j = clamp(Math.round((hx - g.plotX) / g.slot - 0.5), 0, g.shown - 1);
      const bar = g.all[g.start + j];
      if (!bar) return;

      ctx.save();
      ctx.strokeStyle = c.cross;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1;
      ctx.setLineDash([1, 3]);
      // 竖线贯穿主图与成交量
      ctx.beginPath();
      ctx.moveTo(Math.round(hx) + 0.5, g.plotT);
      ctx.lineTo(Math.round(hx) + 0.5, g.volH ? g.plotB : g.priceBottom);
      ctx.stroke();
      // 横线只在价格区
      if (inPrice) {
        ctx.beginPath();
        ctx.moveTo(g.plotX, Math.round(hy) + 0.5);
        ctx.lineTo(g.plotR, Math.round(hy) + 0.5);
        ctx.stroke();
      }
      ctx.restore();

      const currentRect = overlay.currentRect;
      const placed = overlay.placed ? overlay.placed.slice() : currentRect ? [currentRect] : [];

      // 右侧十字价格标签
      if (inPrice) {
        const price = g.hi - ((hy - g.priceTop) / g.priceH) * (g.hi - g.lo);
        const h = 15;
        const w = Math.max(20, g.w - g.plotR - 4);
        let x = g.plotR + 2;
        let ty = this._placeTag(hy - h / 2, h, placed, g.plotT, g.plotB - h);
        if (ty == null) {
          // 右轴被旗标占满时，把十字价格标签放进绘图区右缘，绝不动当前价标签
          x = Math.max(g.plotX + 2, g.plotR - w - 3);
          ty = clamp(hy - h / 2, g.priceTop, g.priceBottom - h);
        }
        const rect = { x, y: ty, w, h };
        placed.push(rect);
        ctx.save();
        ctx.fillStyle = c.bg;
        ctx.fillRect(x, ty, w, h);
        ctx.strokeStyle = c.cross;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, ty + 0.5, w - 1, h - 1);
        this._monoFont(9, '600');
        ctx.fillStyle = c.cross;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this._fmtPrice(price, g.digits), x + w / 2, ty + h / 2 + 0.5);
        ctx.restore();
      }

      // 底部时间标签
      const timeText = this._fmtTime(bar.t, g.interval);
      this._monoFont(9, '600');
      const tw = ctx.measureText(timeText).width + 10;
      const tw2 = Math.min(tw, g.plotW);
      let tx = clamp(hx - tw2 / 2, g.plotX, g.plotR - tw2);
      const ty = g.plotB + 2;
      ctx.save();
      ctx.fillStyle = c.cross;
      ctx.fillRect(tx, ty, tw2, 14);
      ctx.fillStyle = c.bg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(timeText, tx + tw2 / 2, ty + 7.5);
      ctx.restore();

      // 左上角 OHLC 信息条
      let text =
        '开 ' + this._fmtPrice(bar.o, g.digits) +
        '  高 ' + this._fmtPrice(bar.h, g.digits) +
        '  低 ' + this._fmtPrice(bar.l, g.digits) +
        '  收 ' + this._fmtPrice(bar.c, g.digits);
      let size = 9;
      this._monoFont(size);
      let maxW = Math.max(30, g.plotW - 10);
      while (size > 7 && ctx.measureText(text).width + 12 > maxW) {
        size -= 0.5;
        this._monoFont(size);
      }
      const infoW = Math.min(maxW, ctx.measureText(text).width + 12);
      const infoH = 19;
      const ix = g.plotX + 4;
      const iy = g.priceTop + 5;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = c.bg;
      ctx.fillRect(ix, iy, infoW, infoH);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c.grid;
      ctx.lineWidth = 1;
      ctx.strokeRect(ix + 0.5, iy + 0.5, infoW - 1, infoH - 1);
      ctx.fillStyle = c.cross;
      ctx.fillRect(ix, iy, 2, infoH);
      ctx.fillStyle = c.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, ix + 7, iy + infoH / 2 + 0.5);
      ctx.restore();
    }

    _drawTopMeta(g, model) {
      const ctx = this.ctx;
      const c = g.colors;
      const fullParts = [
        model.pairLabel,
        model.tfLabel,
        model.modeLabel,
        model.sessionLabel,
      ].filter(Boolean);
      if (isNum(model.spreadPips)) fullParts.push('点差 ' + Number(model.spreadPips).toFixed(1));
      const full = fullParts.join(' · ');
      if (!full) return;

      this._monoFont(9);
      const legendRight = isNum(g.maLegendRight) ? g.maLegendRight : g.plotX;
      const avail = g.plotR - legendRight - 14;
      if (avail < 40) return;
      const shortParts = [model.tfLabel, model.modeLabel].filter(Boolean);
      const short = shortParts.join(' · ');
      let text = full;
      if (ctx.measureText(text).width > avail) text = short;
      if (!text || ctx.measureText(text).width > avail) return;

      ctx.fillStyle = c.axis;
      ctx.globalAlpha = 0.85;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, g.plotR - 2, 13);
      ctx.globalAlpha = 1;
    }

    _setAria(model, lastBar, prevBar, current, shown, digits) {
      let label;
      if (!lastBar) {
        label = (model.pairLabel ? model.pairLabel + ' ' : '') + (model.emptyText || '还没有行情。');
      } else {
        const base = prevBar && prevBar.c ? prevBar.c : lastBar.o;
        const pct = base ? ((current - base) / base) * 100 : 0;
        const dir = pct >= 0 ? '上涨' : '下跌';
        label =
          (model.pairLabel || '汇率') + ' ' + (model.tfLabel || '') + '图，最近 ' + shown +
          ' 根 K 线，最新价 ' + this._fmtPrice(current, digits) +
          '，' + dir + ' ' + Math.abs(pct).toFixed(2) + '%';
      }
      this.canvas.setAttribute('aria-label', label);
    }
  }

  FX.Chart = Chart;
})();
