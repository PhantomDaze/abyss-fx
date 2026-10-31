/* 货币对、货币与报价换算 —— 数据依据 ECB 最新参考价，参数参考零售外汇常见水平 */
(function () {
  'use strict';
  const FX = (window.FX = window.FX || {});

  // 各货币名义年利率（用于隔夜利息，游戏内固定）
  FX.CURRENCIES = {
    USD: { name: '美元', rate: 4.0 },
    EUR: { name: '欧元', rate: 2.75 },
    GBP: { name: '英镑', rate: 4.0 },
    JPY: { name: '日元', rate: 0.5 },
    CHF: { name: '瑞郎', rate: 0.5 },
    AUD: { name: '澳元', rate: 3.6 },
    CAD: { name: '加元', rate: 2.75 },
  };

  // 点差为“基准点差（pip）”，日内会按时段与新闻扩大
  // vol 为日均波动率（对数收益率的日标准差）
  FX.PAIRS = [
    { id: 'EURUSD', display: 'EUR/USD', name: '欧元 / 美元', base: 'EUR', quote: 'USD', group: 'main', digits: 5, pip: 0.0001, spread: 0.8, vol: 0.0055, price: 1.11300 },
    { id: 'GBPUSD', display: 'GBP/USD', name: '英镑 / 美元', base: 'GBP', quote: 'USD', group: 'main', digits: 5, pip: 0.0001, spread: 1.0, vol: 0.0065, price: 1.33169 },
    { id: 'USDJPY', display: 'USD/JPY', name: '美元 / 日元', base: 'USD', quote: 'JPY', group: 'main', digits: 3, pip: 0.01, spread: 0.9, vol: 0.0060, price: 158.059 },
    { id: 'USDCHF', display: 'USD/CHF', name: '美元 / 瑞郎', base: 'USD', quote: 'CHF', group: 'main', digits: 5, pip: 0.0001, spread: 1.1, vol: 0.0055, price: 0.82857 },
    { id: 'AUDUSD', display: 'AUD/USD', name: '澳元 / 美元', base: 'AUD', quote: 'USD', group: 'main', digits: 5, pip: 0.0001, spread: 1.0, vol: 0.0068, price: 0.70256 },
    { id: 'USDCAD', display: 'USD/CAD', name: '美元 / 加元', base: 'USD', quote: 'CAD', group: 'main', digits: 5, pip: 0.0001, spread: 1.2, vol: 0.0050, price: 1.39955 },
    { id: 'EURCHF', display: 'EUR/CHF', name: '欧元 / 瑞郎', base: 'EUR', quote: 'CHF', group: 'cross', digits: 5, pip: 0.0001, spread: 1.4, vol: 0.0042, price: 0.92220 },
    { id: 'EURJPY', display: 'EUR/JPY', name: '欧元 / 日元', base: 'EUR', quote: 'JPY', group: 'cross', digits: 3, pip: 0.01, spread: 1.4, vol: 0.0065, price: 175.920 },
    { id: 'GBPJPY', display: 'GBP/JPY', name: '英镑 / 日元', base: 'GBP', quote: 'JPY', group: 'cross', digits: 3, pip: 0.01, spread: 2.2, vol: 0.0078, price: 210.486 },
  ];

  FX.PAIR_MAP = {};
  for (const p of FX.PAIRS) FX.PAIR_MAP[p.id] = p;

  FX.pair = (id) => FX.PAIR_MAP[id];

  /** 1 单位某货币值多少 USD（以当前中间价估算） */
  FX.ccyToUSD = function (ccy, quotes) {
    switch (ccy) {
      case 'USD': return 1;
      case 'EUR': return quotes.EURUSD.mid;
      case 'GBP': return quotes.GBPUSD.mid;
      case 'AUD': return quotes.AUDUSD.mid;
      case 'JPY': return 1 / quotes.USDJPY.mid;
      case 'CHF': return 1 / quotes.USDCHF.mid;
      case 'CAD': return 1 / quotes.USDCAD.mid;
    }
    return 1;
  };

  /** 名义仓位（USD） */
  FX.notionalUSD = function (pairId, lots, quotes) {
    const p = FX.PAIR_MAP[pairId];
    return lots * 100000 * FX.ccyToUSD(p.base, quotes);
  };

  /** 每手每 pip 的美元价值 */
  FX.pipValueUSD = function (pairId, lots, quotes) {
    const p = FX.PAIR_MAP[pairId];
    return lots * 100000 * p.pip * FX.ccyToUSD(p.quote, quotes);
  };

  /** 保证金（开仓时固定） */
  FX.marginUSD = function (pairId, lots, quotes, leverage) {
    return FX.notionalUSD(pairId, lots, quotes) / leverage;
  };

  /** 每夜隔夜利息（USD），周三按三倍计；正数=收取，负数=支付 */
  FX.swapPerNightUSD = function (pairId, lots, quotes, weekday, nights, side) {
    const p = FX.PAIR_MAP[pairId];
    const notional = FX.notionalUSD(pairId, lots, quotes);
    // 做多赚基础货币利率、付报价货币利率；做空相反
    const diff = FX.CURRENCIES[p.base].rate - FX.CURRENCIES[p.quote].rate;
    const dir = side === 'short' || side === -1 ? -1 : 1;
    // 经纪商加点：无论多空都扣，保证多空之和为负
    const markup = 0.5;
    const n = nights || (weekday === 3 ? 3 : 1); // 周三三倍（T+2 跨周末）
    return (notional * (diff * dir - markup)) / 365 / 100 * n;
  };

  /** 按杠杆与可用资金估算最大手数 */
  FX.maxLots = function (pairId, freeUSD, quotes, leverage, maxLots) {
    const p = FX.PAIR_MAP[pairId];
    const perLot = 100000 * FX.ccyToUSD(p.base, quotes) / leverage;
    const raw = Math.floor((freeUSD * 0.95) / perLot / 0.01) * 0.01;
    return Math.max(0, Math.min(maxLots || 10, raw));
  };
})();
