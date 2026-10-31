# 《深渊汇率 / ABYSS FX》单次会话可执行规格（P0）

> 项目代号：kurumi。本文是四份设计文档合并后的唯一施工依据。工程师不需要再阅读原始文档。
>
> 一句话：一个纯静态、离线可开、以真实 ECB 日度数据为骨、以因子模型合成行情为肉的零售外汇保证金生存模拟。玩家在点差、隔夜利息、跳空、强平与事件冲击中做仓位决策，而不是在无摩擦的随机 K 线上点按钮。

**产品名**：深渊汇率 / ABYSS FX  
**品牌句**：在深渊里，学会呼吸。  
**免责声明（全局固定）**：模拟交易，不构成投资建议。历史数据与盘中路径均为教学演示，不代表真实可成交价格。

---

## 目录

1. 交付边界与硬约束
2. 文件架构、加载顺序与全局契约
3. 核心参数总表
4. 核心算法伪代码
5. 模式规格
6. 经典战役（6 场）
7. 每日挑战
8. UI / 交互 / 视觉规范
9. 成就与统计
10. 存档、容错与迁移
11. 实现里程碑与验收标准
12. 数字自洽核对表
13. 明确砍掉 / 降级项
14. 易错点与风险清单

---

## 1. 交付边界与硬约束

### 1.1 运行形态

- 纯静态：`index.html` + CSS + 普通 `<script>`，无构建、无打包、无 ES module、默认无运行时网络请求。
- 每日挑战全球排行榜是可选增强：未配置 `js/core/leaderboard.js` 的 `DEFAULT_API` 时完全离线；配置后只在用户结算/看榜时请求，失败自动降级，不影响单机。
- 可直接 `file://` 打开，也可 `python3 -m http.server` 运行。
- 不加载任何 CDN、外部字体、外部图片、外部音频。字体使用系统字体栈；图标使用内联 SVG；favicon 使用内联 SVG data URI。
- 所有行情、图表、分享卡均由 Canvas / DOM 在本地生成。
- 存档使用 `localStorage`；读取失败必须降级，不得白屏。
- 界面与文案简体中文；代码注释中文。

### 1.2 P0 必须交付

| 能力 | P0 范围 |
|---|---|
| 模拟行情 | 9 个货币对；因子模型；时段点差/波动；新闻日历与冲击；周末缺口 |
| 订单票 | 手数、杠杆、点差、手续费、保证金、SL/TP、限价/止损挂单、部分平仓、一键全平 |
| 保证金 | 账户级保证金水平、100% 追保提示、50% 强平、NBP 负余额保护 |
| 图表 | Canvas K 线；多周期；MA7/25/99；开仓/SL/TP/强平/挂单线；十字光标与 OHLC 提示 |
| 历史回放 | 内置 ECB 数据；30/90/180/365 交易日预设；买入持有基准；alpha/回撤报告 |
| 经典战役 | 6 场：2008 雷曼、2015 瑞郎脱钩、2016 脱欧、2020 疫情、2022 日元干预、2024 套息拆仓 |
| 每日挑战 | 日期种子 + 词条 + 3 次机会 + 评分 + 本地榜；可选全球榜（默认关闭） |
| 成就/统计 | 18 条成就；胜率/盈亏比/盈利因子/期望/最大回撤/连赢连亏/持仓时长/成本比/纪律分/体检 |
| 存档 | 分模式隔离；自动保存；版本号；损坏回退 |
| 教程/主题/适配 | 5 页教程；追保一次教学；日/夜双主题；红涨绿跌/绿涨红跌切换；320px 无横向滚动 |
| 免责声明 | 首启弹窗 + 页脚常驻 + 分享文案固定 |

### 1.3 非目标（本次不做，写入 P1/P2）

见第 13 节。最重要的三条：

1. **不做生涯/贷款/等级/XP/角色剧情**。P0 的叙事由 6 场战役承担。
2. **不做事件日盘中手动交易**。战役/回放采用“日频决策 + 当日路径自动结算”，事件日路径只用于结算与动画。这是单次会话最大的范围收敛。
3. **不做真实网络数据**。只用内置 `js/data/history.js`；不请求 Frankfurter/ECB API。

---

## 2. 文件架构、加载顺序与全局契约

### 2.1 目录与文件职责

```
/kurumi
├─ index.html                  仅 DOM 骨架与脚本顺序；无内联业务逻辑
├─ styles/
│  ├─ tokens.css               CSS 变量：颜色、字体、间距、圆角、动效、断点变量
│  ├─ layout.css               顶栏/账户条/三栏/响应式/移动底栏
│  └─ components.css           订单票/持仓卡/表格/弹窗/图表外壳/成就册/Toast
├─ js/
│  ├─ data/
│  │  ├─ history.js            （已有，禁止修改）window.FX.HISTORY
│  │  ├─ meta.js               货币对、利率、时段、点差、事件模板、成就、词条
│  │  └─ battles.js            6 场战役配置（窗口/剧情/新闻/目标/评分/事件锚点）
│  ├─ core/
│  │  ├─ util.js               （已有）FX.U：DOM/格式化/哈希/PRNG/高斯/存档/事件总线
│  │  ├─ state.js              存档键、默认值、读写、版本迁移、模式账户隔离
│  │  ├─ progress.js           成就解锁、统计聚合、权益轨迹、体检评级
│  │  ├─ clock.js              游戏时钟、UTC 时段、周末休市、21:00 换日
│  │  └─ engine.js             唯一 tick 管线：报价→挂单→SL/TP→保证金→swap→强平
│  ├─ market/
│  │  ├─ market.js             因子模型、9 对报价、新闻冲击、周末缺口、锚点
│  │  └─ series.js             历史访问、合成日内 OHLC、K 线聚合
│  ├─ trade/
│  │  └─ trade.js              账户/持仓/订单对象、pip/名义/保证金/盈亏/swap 数学
│  ├─ modes/
│  │  ├─ sim.js                模拟沙盒生命周期
│  │  ├─ replay.js             历史回放生命周期与基准
│  │  ├─ battle.js             战役生命周期、评分、星级
│  │  └─ challenge.js          每日挑战生命周期、评分、本地榜
│  ├─ ui/
│  │  ├─ chart.js              Canvas 绘制、坐标、十字光标、线层
│  │  ├─ panels.js             账户条、市场列表、持仓/挂单/成交、新闻条
│  │  ├─ ticket.js             订单票、校验、预览、MAX
│  │  └─ modals.js             教程/设置/成就/统计/新闻中心/确认/Toast/分享
│  └─ app.js                   初始化、模式路由、主循环、事件绑定、自动保存
└─ docs/SPEC.md                本文
```

**职责边界**：

- `market.js` 只负责“价格怎么来”，不碰账户。
- `trade.js` 只负责“钱怎么算”，不碰 DOM、不碰时钟。
- `engine.js` 只负责“按什么顺序调用”，不实现价格模型与账户数学。
- `modes/*` 只负责模式规则、数据源、评分与生命周期；不直接画 DOM，通过 `FX.Bus` 发事件。
- `ui/*` 只负责呈现与输入；调用 `FX.Modes.current()` 的动作接口。
- `state.js` 只负责持久化与模式账户快照；成就/统计在 `progress.js`。

### 2.2 脚本加载顺序（`index.html` 底部，全部 `defer`）

```html
<script defer src="js/data/history.js"></script>
<script defer src="js/core/util.js"></script>
<script defer src="js/data/meta.js"></script>
<script defer src="js/data/battles.js"></script>
<script defer src="js/core/state.js"></script>
<script defer src="js/core/progress.js"></script>
<script defer src="js/core/clock.js"></script>
<script defer src="js/market/market.js"></script>
<script defer src="js/market/series.js"></script>
<script defer src="js/trade/trade.js"></script>
<script defer src="js/core/engine.js"></script>
<script defer src="js/modes/sim.js"></script>
<script defer src="js/modes/replay.js"></script>
<script defer src="js/modes/battle.js"></script>
<script defer src="js/modes/challenge.js"></script>
<script defer src="js/ui/chart.js"></script>
<script defer src="js/ui/panels.js"></script>
<script defer src="js/ui/ticket.js"></script>
<script defer src="js/ui/modals.js"></script>
<script defer src="js/app.js"></script>
```

- 所有文件用 IIFE 包裹，挂到唯一的全局 `window.FX`，不创建其他全局变量。
- 除 `app.js` 外，任何文件不得在加载时操作 DOM；只定义对象。
- 不使用 `import/export`；不使用 `type="module"`。

### 2.3 全局命名空间契约

```js
window.FX = {
  U,                 // 工具（已有）
  HISTORY,           // 原始数据（已有）
  Meta: { PAIRS, RATES, SESSIONS, EVENTS, ACHIEVEMENTS, MODIFIERS, CONST },
  Battles: { LIST, byId },
  State: { load, save, saveAll, mode, setMode, account, resetMode, keys },
  Progress: { unlock, check, stats, recordClose, recordEquity, health },
  Clock: { now, advance, session, isOpen, isRollover, isWeekendOpen },
  Market: { init, step, quotes, applyNews, weekendGap, anchor },
  Series: { close, indexOf, range, synthDay, aggregate, dailyBars },
  Trade: { newAccount, open, close, partialClose, closeAll, mark, swapFor, pipValue, notional, margin },
  Engine: { step, advanceDay, checkOrders, checkStops, checkMargin },
  Modes: { sim, replay, battle, challenge, current, switchTo },
  UI: { Chart, Panels, Ticket, Modals },
  App: { init }
};
```

事件总线事件名（统一小写冒号）：

`market:tick` `market:day` `quote:update` `account:change` `trade:open` `trade:close`
`trade:partial` `order:placed` `order:filled` `order:cancelled` `risk:margin-call`
`risk:stop-out` `risk:nbp` `news:flash` `news:calendar` `achievement:unlock`
`mode:change` `challenge:settle` `battle:end` `save:done` `toast`

### 2.4 模式与账户隔离

- 四个 P0 模式各一份独立账户：`sim`、`replay`、`battle`、`challenge`。
- 切换模式时先 `State.save()` 当前模式，再恢复目标模式；`sim` 的市场暂停，不后台推进（避免离线收益与性能问题）。
- 成就、统计、设置、每日榜是全局的；账户、持仓、订单、游标是模式内的。
- 任何模式重置只清空该模式账户与进度，不清成就/统计/榜。

---

## 3. 核心参数总表

### 3.1 常量

| 参数 | 值 | 说明 |
|---|---:|---|
| 标准手 | 100,000 基础货币 | `CONTRACT` |
| 手数范围 | 0.01–10.00，步长 0.01 | 内部用整数微手 `lotsMic = round(lots*100)` |
| 初始资金 | $10,000 | 四个模式各自一份 |
| 杠杆选项 | 30 / 100 / 200 / 500 | 模拟默认 100；战役/挑战强制 30；回放上限 100 |
| 保证金 | 开仓时固定 = 名义 USD / 杠杆 | 不随价格重估 |
| 追保线 | 保证金水平 100% | 只提示，不自动平仓 |
| 强平线 | 保证金水平 50% | 账户级，按浮亏/保证金从大到小逐仓平 |
| 强平循环缓冲 | 55% | 平到 ≥55% 停止，避免反复触发 |
| 负余额保护 | 默认开启 | 强平后余额 <0 归零并记录吸收额 |
| 佣金 | max($0.10, $3.50 × 手数) / 单边 | ECN 模拟账户；开、平各收一次 |
| 点差下限 | 0.3 pip | 防止负点差 |
| swap 加点 | 0.50%/年 | 多空都减，保证多空之和为负 |
| swap 结算 | 每日 21:00 UTC | 周三 ×3；周五 ×1；周六日不单独计 |
| 周末休市 | 周五 21:00 – 周日 22:00 UTC | 周日开盘前 30 分钟点差 ×2.5 |
| 游戏 tick | 5 游戏分钟 | 所有模式统一；挑战固定 200ms/tick |
| 模拟默认速度 | 1× = 200ms/tick | 1 游戏日 = 288 tick = 57.6 秒；可 0.5×/1×/2×/4× |
| 挑战 | 10 个交易日，固定 200ms/tick | 约 9.6 分钟 |
| 战役/回放 | 日频推进；自动播放 1.2 秒/日 | 事件日 80ms/tick 播放（约 23 秒），不可手动盘中交易 |
| 价格小数位 | JPY 对 3 位，其余 5 位 | 数据内部 5 位；显示按 digits |
| pip | JPY 对 0.01，其余 0.0001 | |
| 金额小数 | 2 位 | `round2` |
| 权益轨迹 | 每 tick 更新峰值/谷值；存档最多 600 点 | 统计最大回撤 |

### 3.2 9 个货币对

初始价取内置数据最后一行 `2026-10-29` 的 ECB 收盘（整数 ÷ 1e5）。模拟从 `2026-10-30 00:00 UTC` 开始，锚点即下表价格。

| 代码 | 显示 | 角色 | 初始价 | 小数位 | 1 pip | 基准点差 pip | 日波动目标 | 周末缺口 σ(pip) | 派生 |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| EURUSD | EUR/USD | 直盘 | 1.11300 | 5 | 0.0001 | 0.6 | 0.55% | 8 | 否 |
| GBPUSD | GBP/USD | 直盘 | 1.33169 | 5 | 0.0001 | 0.9 | 0.70% | 12 | 否 |
| USDJPY | USD/JPY | 直盘 | 158.05930 | 3 | 0.01 | 0.7 | 0.65% | 10 | 否 |
| USDCHF | USD/CHF | 直盘 | 0.82857 | 5 | 0.0001 | 1.0 | 0.55% | 10 | 否 |
| AUDUSD | AUD/USD | 直盘 | 0.70256 | 5 | 0.0001 | 0.9 | 0.65% | 12 | 否 |
| USDCAD | USD/CAD | 直盘 | 1.39955 | 5 | 0.0001 | 1.2 | 0.55% | 10 | 否 |
| EURCHF | EUR/CHF | 交叉 | 0.92220 | 5 | 0.0001 | 1.3 | ≈0.59% | 6 | 是 |
| EURJPY | EUR/JPY | 交叉 | 175.92000 | 3 | 0.01 | 1.3 | ≈0.85% | 15 | 是 |
| GBPJPY | GBP/JPY | 交叉 | 210.48601 | 3 | 0.01 | 2.0 | ≈0.99% | 25 | 是 |

> JPY 对显示与成交按 3 位小数，数据内部保留 5 位；日收盘校验用 5 位原值，界面四舍五入到 3 位（差异 <0.001）。其余对 5 位。

**派生规则（保证三角一致）**：

```
EURCHF = EURUSD × USDCHF      // (EUR/USD) × (USD/CHF) = EUR/CHF
EURJPY = EURUSD × USDJPY      // (EUR/USD) × (USD/JPY) = EUR/JPY
GBPJPY = GBPUSD × USDJPY      // (GBP/USD) × (USD/JPY) = GBP/JPY
```

> 必须是乘法。写成除法会把 EURCHF 变成 `EUR·CHF/USD²`，三角关系与初始价都不成立。

只模拟 6 个直盘；交叉盘每 tick 由直盘重算。任何 UI、成交、保证金、盈亏都必须使用重算后的交叉盘报价，禁止单独随机交叉盘。

**1 标准手点值（按初始价）**：

| 对 | 每 pip USD | 对 | 每 pip USD |
|---|---:|---|---:|
| EURUSD | $10.00 | USDCHF | $12.069 |
| GBPUSD | $10.00 | EURCHF | $12.069 |
| AUDUSD | $10.00 | USDCAD | $7.145 |
| USDJPY | $6.327 | EURJPY | $6.327 |
| GBPJPY | $6.327 | | |

公式：`pipValueUSD = lots × 100000 × pipSize × ccyToUSD(quote)`。

**隔夜利息（1 标准手、初始价、每夜；正=收入，负=支出）**：

| 对 | 多单 | 空单 | 对 | 多单 | 空单 |
|---|---:|---:|---|---:|---:|
| EURUSD | −$5.34 | +$2.29 | USDCHF | +$8.22 | −$10.96 |
| GBPUSD | −$1.82 | −$1.82 | EURCHF | +$5.34 | −$8.39 |
| USDJPY | +$8.22 | −$10.96 | USDCAD | +$2.05 | −$4.79 |
| AUDUSD | −$1.73 | −$0.19 | EURJPY | +$5.34 | −$8.39 |
| GBPJPY | +$10.95 | −$14.59 | | | |

公式见 4.6。周三乘以 3；手数等比缩放；名义按结算时 mid 重算。

### 3.3 利率表（固定，P0 不随事件改）

| 货币 | USD | EUR | GBP | JPY | CHF | AUD | CAD |
|---|---:|---:|---:|---:|---:|---:|---:|
| 年利率 | 4.00% | 2.75% | 4.00% | 0.50% | 0.50% | 3.60% | 2.75% |

> 战役/挑战不修改利率。P1 可做“利率决议改利率”，P0 不做，避免与历史收盘冲突。

### 3.4 时段（UTC）

波动乘数已归一化，按小时加权平均为 1.00；点差乘数直接乘基准点差。

| UTC | 时段 | 点差乘数 | 波动乘数 |
|---|---|---:|---:|
| 00–02 | 悉尼/东京前 | 1.60 | 0.63 |
| 02–07 | 东京 | 1.30 | 0.74 |
| 07–08 | 伦敦前 | 1.10 | 0.97 |
| 08–12 | 伦敦 | 1.00 | 1.31 |
| 12–16 | 伦敦/纽约重叠 | 0.85 | 1.54 |
| 16–20 | 纽约 | 1.15 | 1.08 |
| 20–21 | 纽约尾盘 | 1.50 | 0.68 |
| 21–22 | 结算/换日 | 3.00 | 0.51 |
| 22–24 | 悉尼 | 1.80 | 0.57 |

最终点差：

```
spread = max(0.3, baseSpread × sessionSpread × newsSpreadMult × weekendOpenMult)
```

`weekendOpenMult`：周日 22:00 开盘后 30 分钟内 2.5，其余 1.0。

> 周五 21:00 UTC 的换日 tick 仍对持仓结算 1× swap，随后休市；该 tick 不处理新单/挂单。周三 21:00 结算 3×。周六、周日不单独计息。

### 3.5 事件模板（模拟/挑战）

| 事件 | sigmaHist | sigmaEvent（对数） | 方向 |
|---|---:|---:|---|
| CPI | 0.20pp | 0.0025 | 高于预期 → 该货币走强 |
| 非农 NFP | 50k | 0.0020 | 高于预期 → 走强 |
| 利率决议 | 0.25pp（85% 为 0） | 0.0040 | 加息 → 走强 |
| GDP | 0.20pp | 0.0015 | 高于预期 → 走强 |
| PMI | 1.0 | 0.0012 | 高于预期 → 走强 |
| 零售销售 | 0.20pp | 0.0015 | 高于预期 → 走强 |
| 失业率 | 0.15pp | 0.0020 | 高于预期 → 走弱（inverse） |
| 地缘/风险 | — | 0.0030 | 风险偏好下降 |

每日 2–6 个事件；重要度 3/2/1 权重 15%/30%/55%；时段从 `01:30, 07:00, 09:30, 12:30, 14:00, 18:00 UTC` 中取。`forecast = previous + N(0, 0.8×sigmaHist)`，`actual = forecast + N(0, sigmaHist)`；8% 概率肥尾 ×2.5。

### 3.6 杠杆、保证金与强平数字（必须按此理解）

账户 $10,000，EUR/USD 1.1130，1 标准手每 pip $10。**强平是账户级的**：权益跌到已用保证金的 50% 才强平，不是“亏掉 50% 保证金”。下表 MAX 行按“模拟模式、无 40% 单笔上限”计算；战役/挑战另有 40%/70% 上限，MAX 会更小。

| 场景 | 名义 USD | 已用保证金 | 强平时权益 | 可承受亏损 | 约合点数 |
|---|---:|---:|---:|---:|---:|
| 0.10 手 @100× | $11,133 | $111.33 | $55.67 | $9,944 | 9,944 pip（仓位很小） |
| 1 手 @30× | $111,330 | $3,711 | $1,855.50 | $8,144.50 | 814 pip |
| MAX 2.56 手 @30× | $285,005 | $9,500 | $4,750 | $5,250 | 205 pip |
| MAX 8.53 手 @100× | $949,645 | $9,496.45 | $4,748.22 | $5,251.78 | 61.6 pip |
| MAX 10 手 @500×（手数上限） | $1,113,300 | $2,226.60 | $1,113.30 | $8,886.70 | 89 pip |

> **不要写成“强平时可亏 = 50% 保证金”**。这是原参考技术文档里的错误示例。正确口径：`强平时权益 = 0.5 × used`，可亏 = 初始权益 − 强平时权益（假设无其他仓位）。MAX 按钮按 95% 可用保证金计算，所以上表 MAX 行不是 100% 满仓。

战役/挑战的 40% 单笔保证金上限意味着：30× 下名义约 12× 权益；**账户权益反向 6.67% 即触发强平**。2015 瑞郎 12%+ 的跳空必然穿仓，这是设计意图。

### 3.7 每日挑战参数

| 参数 | 值 |
|---|---|
| 初始资金 | $10,000 |
| 交易日 | 10 个交易日（跳过周末） |
| tick | 5 游戏分钟；固定 200ms/tick；约 9.6 分钟 |
| 每日 tick | 288 |
| 杠杆上限 | 30× |
| 同时持仓 | 最多 3 笔 |
| 单笔保证金 | ≤ 当前权益 40% |
| 总保证金 | ≤ 当前权益 70% |
| 点差 | 基准 × 1.5（再乘时段/新闻） |
| 佣金 | 正常收取 |
| 贷款 | 无（P0 无贷款系统） |
| 机会 | 每日 3 次；同日共用种子与词条；取最高分 |
| 结算 | 随时“结束挑战”；按当前权益结算 |
| 目标线 | 铜 400 / 银 800 / 金 1200 |
| 榜 | 本地 3 档案；今日前 10；30 天每日冠军 |

### 3.8 战役通用参数

| 参数 | 值 |
|---|---|
| 初始资金 | $10,000 |
| 杠杆 | 固定 30× |
| 单笔保证金 | ≤ 当前权益 40% |
| 总保证金 | ≤ 当前权益 70% |
| 贷款 | 无 |
| 强平 | 50%；跳空可穿仓；NBP 开启 |
| 佣金 | 正常收取 |
| 决策 | 日频；在每日收盘后下单；下一交易日路径结算 |
| 重试 | 无限；保留最佳星级/分数 |
| 星级 | ≥85 三星；65–84 二星；45–64 一星；<45 或未通关失败 |
| 通关 | 期末权益 ≥ 目标；不爆仓；最大回撤 ≤ 红线；事件分 E ≥ 0；至少 1 笔平仓 |

---

## 4. 核心算法伪代码

### 4.1 游戏时钟与主循环

所有行情逻辑使用 UTC 游戏时间，禁止用 `Date.now()` 直接驱动价格。

```js
// clock.js
FX.Clock.now = () => state.gameTime;              // UTC 毫秒
FX.Clock.advance = (minutes) => {
  state.gameTime += minutes * 60000;
  state.tickIndex += 1;
};
FX.Clock.session = (t) => {
  const h = new Date(t).getUTCHours();
  return SESSIONS.find(s => h >= s.from && h < s.to);
};
FX.Clock.isOpen = (t) => {
  const d = new Date(t);
  const wd = d.getUTCDay();                        // 0 日 … 6 六
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  if (wd === 5 && h >= 21) return false;           // 周五 21:00 后
  if (wd === 6) return false;                      // 周六
  if (wd === 0 && h < 22) return false;            // 周日前
  return true;
};
```

主循环（`app.js`）：

```js
let acc = 0, last = performance.now();
function loop(now) {
  const dt = Math.min(250, now - last); last = now;
  const mode = FX.Modes.current();
  if (mode && mode.running && !document.hidden) {
    acc += dt;
    const stepMs = mode.tickMs;                    // 模拟 200/400/100/50；挑战 200
    while (acc >= stepMs) { mode.tick(); acc -= stepMs; }
  }
  requestAnimationFrame(loop);
}
```

- 模拟模式：`tick()` 前进 5 游戏分钟。
- 挑战：`tick()` 前进 5 游戏分钟；固定 200ms，不允许调速。
- 战役/回放：`tick()` 不由 RAF 驱动；由“下一交易日”按钮或自动播放定时器调用 `advanceDay()`。
- 页面隐藏时暂停；恢复后不补帧。

**每 tick 顺序（顺序即正确性，不得调换）**：

1. 若休市：只推进时间，不处理订单、不结算。例外：周五 21:00 UTC 的换日 tick 仍结算 1× swap，然后休市。
2. 推进 5 游戏分钟（`Clock.advance`）。
3. `Market.step`：因子模型 → 生成 mid → 处理本 tick 到期新闻（**先改价**）→ 若周日 22:00 开盘则先应用周末缺口。
4. 生成 bid/ask（点差 = 基准 × 时段 × 新闻 × 周末开盘）。
5. 处理挂单触发（按 4.7 的成交规则）。
6. 更新追踪止损（P1；P0 无）。
7. 检查 SL/TP：同一 bar 内 SL 优先；跳空按开盘/锚点价。
8. `mark`：重算浮动盈亏、权益、已用、可用、保证金水平。
9. 21:00 UTC 换日：对仍持仓的仓位结算 swap（周三 ×3）。
10. `checkMargin`：100% 追保提示；50% 强平循环；NBP。
11. 写入 5m K 线、发事件、更新 UI、按需存档。

> 事件必须先改价，再触发挂单/SL/TP/强平；否则新闻后的第一根 K 会让玩家在旧价格成交。

### 4.2 因子模型（6 个直盘，3 因子 + 个体）

每个 5 分钟 tick：

```js
// 因子：F=风险偏好，D=美元强弱，E=欧洲货币相对美元联动
const F = gauss(rng), D = gauss(rng), E = gauss(rng);
const session = FX.Clock.session(FX.Clock.now());

// 每个直盘的加载向量 [wF, wD, wE, wI]，初始化时归一化
const LOAD = {
  EURUSD: [0.45, -0.75,  0.80, 0.70],
  GBPUSD: [0.55, -0.75,  0.15, 0.80],
  AUDUSD: [0.80, -0.35,  0.00, 0.80],
  USDJPY: [0.35,  0.85,  0.00, 0.70],
  USDCHF: [0.30,  0.85, -1.10, 0.65],
  USDCAD: [-0.45, 0.65,  0.00, 0.75]
};

// 波动状态：对数 OU，半天回归
state.logVol += -0.005 * state.logVol + 0.022 * gauss(rng);
const volState = clamp(Math.exp(state.logVol), 0.45, 2.2);

for (const pair of USD_LEGS) {
  const [wF, wD, wE, wI] = normalized[LOAD[pair]];
  const eps = gauss(rng);
  // 目标日波动换算到每 5 分钟：日波动 / sqrt(288)
  const sigmaTick = DAILY_VOL[pair] / Math.sqrt(288);
  let r = sigmaTick * (wF*F + wD*D + wE*E + wI*eps)
        * session.vol * volState;

  // 无新闻的偶发跳变：每 tick 0.5%，约 1.4 次/日
  if (rng() < 0.005) r += gauss(rng) * 0.0015;

  // 弱均值回归，半衰期约 480 天
  r += 0.000005 * (Math.log(ANCHOR[pair]) - Math.log(price[pair]));

  price[pair] *= Math.exp(r);
  price[pair] = roundPrice(price[pair], digits[pair]);
}

// 由直盘重算交叉盘（乘法）
price.EURCHF = price.EURUSD * price.USDCHF;
price.EURJPY = price.EURUSD * price.USDJPY;
price.GBPJPY = price.GBPUSD * price.USDJPY;
```

**归一化**：`n = hypot(wF,wD,wE,wI)`，四个权重都除以 `n`。这样 6 个直盘的日波动严格等于目标（忽略时段归一化误差）。交叉盘由直盘相乘，波动是派生结果，不单独校准：

```
vol(EURCHF) = sqrt(σE² + σC² + 2ρEC·σE·σC) ≈ 0.59%/日
vol(EURJPY) = sqrt(σE² + σJ² + 2ρEJ·σE·σJ) ≈ 0.85%/日
vol(GBPJPY) = sqrt(σG² + σJ² + 2ρGJ·σG·σJ) ≈ 0.99%/日
```

**相关性（由加载向量算出，供验收）**：

| | EURUSD | GBPUSD | AUDUSD | USDJPY | USDCHF | USDCAD |
|---|---:|---:|---:|---:|---:|---:|
| EURUSD | 1.00 | 0.88 | 0.73 | 0.01 | −0.43 | −0.11 |
| GBPUSD | 0.88 | 1.00 | 0.92 | 0.08 | −0.06 | −0.10 |
| AUDUSD | 0.73 | 0.92 | 1.00 | 0.40 | 0.25 | 0.01 |
| USDJPY | 0.01 | 0.08 | 0.40 | 1.00 | 0.71 | 0.73 |
| USDCHF | −0.43 | −0.06 | 0.25 | 0.71 | 1.00 | 0.53 |
| USDCAD | −0.11 | −0.10 | 0.01 | 0.73 | 0.53 | 1.00 |

相关性只用于验收“方向合理”，不要求逐位精确。GBPUSD/AUDUSD 在风险偏好冲击下高度同向是符合直觉的；EURUSD/USDCHF 负相关来自“美元强弱”与“欧洲货币联动”两个因子的竞争。

**为什么是 6 直盘**：交叉盘派生保证任何时刻 `EURCHF = EURUSD × USDCHF`、`EURJPY = EURUSD × USDJPY`、`GBPJPY = GBPUSD × USDJPY`，玩家无法做三角套利；同时 EUR/GBP 未列入需求，不做。

### 4.3 报价层

```js
function quotesFor(pair, mid, spreadPips) {
  const half = spreadPips * pipSize(pair) / 2;
  const digits = digitsOf(pair);
  return {
    mid: roundPrice(mid, digits),
    bid: roundPrice(mid - half, digits),
    ask: roundPrice(mid + half, digits),
    spreadPips
  };
}
```

- 买按 ask，卖按 bid。
- 多头浮盈按 bid 估，空头浮盈按 ask 估（平仓可得价）。
- 开仓瞬间必有一个点差的浮亏，这是正确的，必须保留。

### 4.4 新闻冲击

```js
function applyNews(ev) {
  const z = clamp((ev.actual - ev.forecast) / ev.sigmaHist, -4, 4);
  const dir = ev.inverse ? -1 : 1;
  const delta = dir * z * ev.sigmaEvent;       // 对数强度
  for (const leg of USD_LEGS) {
    const [b, q] = leg.split('/');
    if (b === ev.ccy) price[leg] *= Math.exp(delta);
    if (q === ev.ccy) price[leg] *= Math.exp(-delta);
  }
  updateCrosses();
  activeShock = { until: now + 10*60000, importance: ev.importance, start: now };
}
```

点差扩张：

```
A = imp===3 ? 8 : imp===2 ? 4 : 1;       // 最大扩张量
pre = t < t0 ? Math.max(0, 2 - (t0-t)/60000) / 2 : 1;
newsSpreadMult = 1 + A * Math.exp(-Math.abs(t-t0)/240000) * pre;
```

事件前 2 分钟开始扩张，事件后指数衰减（时间常数 4 分钟）；最大乘数 9（重要度 3）。相关货币对承受完整冲击；其他对波动/点差只承受 30% 外溢（实现为全局 `1 + 0.3*(mult-1)`）。

### 4.5 周末缺口

周五 21:00 UTC 冻结报价；周日 22:00 开盘前：

```js
function weekendGap() {
  for (const leg of USD_LEGS) {
    const t4 = studentT(rng, 4) / Math.SQRT2;   // 单位方差肥尾
    const gapPips = GAP_SIGMA[leg] * t4;
    price[leg] *= Math.exp(gapPips * pipSize(leg) / price[leg]);
  }
  updateCrosses();
  // 开盘第一 tick 立即检查 SL/TP、挂单、强平；SL 按开盘价成交
}
```

周日开盘 30 分钟内 `weekendOpenMult = 2.5`。

> `studentT(rng, 4)` 可用 `gauss(rng) / sqrt(chi2(rng,4)/4)` 实现；若嫌麻烦，用 `1.25 × gauss(rng)` 近似肥尾，但验收时缺口分布应明显比正态更尖峰。

### 4.6 pip / 名义 / 保证金 / 盈亏 / swap

```js
const CONTRACT = 100000;

function ccyToUSD(c, p) {
  if (c === 'USD') return 1;
  if (c === 'EUR') return p['EUR/USD'];
  if (c === 'GBP') return p['GBP/USD'];
  if (c === 'AUD') return p['AUD/USD'];
  if (c === 'JPY') return 1 / p['USD/JPY'];
  if (c === 'CHF') return 1 / p['USD/CHF'];
  if (c === 'CAD') return 1 / p['USD/CAD'];
}

function notionalUSD(pair, lots, p) {
  return lots * CONTRACT * ccyToUSD(pair.split('/')[0], p);
}

function pipValueUSD(pair, lots, p) {
  return lots * CONTRACT * pipSize(pair) * ccyToUSD(pair.split('/')[1], p);
}

function marginUSD(pair, lots, entryPrice, leverage) {
  return notionalUSD(pair, lots, { ...p, [pair]: entryPrice }) / leverage;
}

// 平仓现金流法，禁止“点数 × 固定点值”
function pnlUSD(pos, exitPrice, p) {
  const [base, quote] = pos.pair.split('/');
  const units = pos.lots * CONTRACT;
  const pnlQuote = pos.side * units * (exitPrice - pos.entry);
  return pnlQuote * ccyToUSD(quote, p);
}

function commission(lots) {
  return round2(Math.max(0.10, 3.50 * lots));
}

function swapUSD(pos, p, dayOfWeek) {
  const [base, quote] = pos.pair.split('/');
  const N = notionalUSD(pos.pair, pos.lots, p);
  const diff = pos.side === 1
    ? RATES[base] - RATES[quote]
    : RATES[quote] - RATES[base];
  const nights = dayOfWeek === 3 ? 3 : 1;      // 周三三倍
  return N * (diff - 0.005) / 365 * nights;
}
```

**账户口径**：

```
balance = 已实现现金（含佣金、已结算 swap）
floating = Σ pnlUSD(pos, 平仓可得价)
equity = balance + floating
used = Σ pos.marginUSD             // 开仓固定
free = equity - used
marginLevel = used > 0 ? equity / used * 100 : Infinity
```

- 开仓：`balance -= commission`；锁定 margin（不扣 balance）。
- 平仓：`balance += pnl - commission`；释放 margin。
- 部分平仓：按比例释放 margin，已实现 pnl 按平掉手数计算，佣金按平掉手数收；swap 已在换日计入 balance，不再按仓位结算。
- 所有资金 `round2`；手数用整数微手；比较加 `1e-9` 容差。

### 4.7 订单体系与触发顺序

**订单类型**：

| 类型 | 触发 | 成交价 |
|---|---|---|
| 市价买 | 立即 | ask + 不利滑点 |
| 市价卖 | 立即 | bid − 不利滑点 |
| Buy Limit | ask ≤ 限价 | min(限价, ask)，可改善 |
| Sell Limit | bid ≥ 限价 | max(限价, bid) |
| Buy Stop | ask ≥ 触发价 | ask + 不利滑点 |
| Sell Stop | bid ≤ 触发价 | bid − 不利滑点 |
| 多 SL | bid ≤ SL | min(SL, bid) − 滑点；跳空按开盘 |
| 多 TP | bid ≥ TP | max(TP, bid)（不滑点，可改善） |
| 空 SL | ask ≥ SL | max(SL, ask) + 滑点；跳空按开盘 |
| 空 TP | ask ≤ TP | min(TP, ask) |

- SL/TP 天然 OCO：一个成交即取消另一个。
- 同一根 5 分钟 K 线内 SL 与 TP 都触及时，**按 SL 先成交**（保守）。
- 跳空穿过 SL：按跳空后第一个可成交价成交，不按 SL 价。
- 挂单触发时 free 不足：取消挂单并提示“保证金不足，挂单已取消”。
- 挂单不预占保证金。
- 挂单有效期：GTC 最多 7 个游戏日；当日有效在 21:00 UTC 失效。P0 只做 GTC 7 日 + 手动撤单。
- 部分平仓：步长 0.01，剩余不得 <0.01；保证金按比例释放；佣金按平掉手数收。
- 一键全平：先弹确认，列出仓位数、合计浮盈、预计平仓后余额；按 bid/ask 逐个平。
- 最小 SL/TP 距离：`max(2 pip, spread×2)`。
- 方向校验：多头 `SL < entry < TP`；空头 `TP < entry < SL`；否则拒绝并提示。
- 市价单滑点：

```js
function adverseSlippagePips(importance = 0, ageMin = Infinity) {
  if (ageMin < 10) {
    const sigma = [0, 2, 5, 10][importance] * Math.exp(-ageMin / 5);
    return Math.abs(gauss(rng)) * sigma;       // 半正态，只不利
  }
  return Math.max(0, gauss(rng) * 0.2);        // 平时 0–0.3 pip
}
```

强平单额外加 0.5 pip 不利滑点。

**开仓校验**：

```
lots >= 0.01 && lots <= maxLots && lotsMic 为整数
required = marginUSD(...) + commission(lots)
required <= free + 1e-9
战役/挑战：单笔 margin <= 0.40*equity；总 used+margin <= 0.70*equity
挑战：positions.length < 3
```

**MAX 手数**：

```js
function maxLots(account, pair, leverage, p) {
  const free = account.equity - account.used;
  const perLot = CONTRACT * ccyToUSD(base, p);
  let m = free * 0.95 * leverage / perLot;
  if (mode === 'battle' || mode === 'challenge') {
    m = Math.min(m, 0.40 * account.equity * leverage / perLot);
    m = Math.min(m, (0.70 * account.equity - account.used) * leverage / perLot);
  }
  return Math.max(0, Math.min(10, Math.floor(m / 0.01) * 0.01));
}
```

### 4.8 强平与负余额保护

```js
function checkMargin(account, p) {
  const level = account.used > 0 ? account.equity / account.used : Infinity;

  if (level < 1.00 && !account.marginCallShown) {
    account.marginCallShown = true;
    emit('risk:margin-call', { level });        // 只提示，不冻结行情
  }
  if (level > 1.50) account.marginCallShown = false;

  while (account.used > 0 && account.equity / account.used < 0.50) {
    const worst = account.positions
      .slice()
      .sort((a, b) => (a.uPnL / a.marginUSD) - (b.uPnL / b.marginUSD))[0];
    closeAtMarket(worst, adverseSlippagePips() + 0.5, 'liq');
    mark(account, p);
    if (account.equity / account.used >= 0.55) break;
  }

  if (account.balance < 0) {
    account.nbpAbsorbed += -account.balance;
    account.balance = 0;
    emit('risk:nbp', { absorbed: account.nbpAbsorbed });
  }
}
```

- 不冻结行情；玩家可以在追保期间减仓/平仓。
- 强平后若余额为负，NBP 归零并记录；战役中仍判定“爆仓”，成就记录。
- 不做贷款、不做催收、不做破产线（P1）。

### 4.9 K 线聚合

```js
function aggregate(bars, tfMinutes) {
  const out = [];
  let cur = null;
  for (const b of bars) {
    const key = Math.floor(b.t / (tfMinutes * 60000));
    if (!cur || cur.key !== key) {
      cur = { key, t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 };
      out.push(cur);
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v || 0;
    }
  }
  return out;
}
```

- 模拟/挑战基础 5 分钟，聚合 15m/1h/4h/1d/1w。
- 回放/战役日线来自数据；1w 按 ISO 周（周一为键），1M 按 `YYYY-MM`。
- 聚合必须满足 `low ≤ min(o,c) ≤ max(o,c) ≤ high`。
- 切换周期不改变游戏时间；只改变显示窗口。

### 4.10 合成日内 OHLC（多锚点布朗桥）

历史数据只有日收盘。回放/战役的每日路径按以下规则生成，**收盘严格等于 ECB 数据（按该对显示精度四舍五入；JPY 对为 3 位）**：

```js
// N=288 根 5 分钟；返回 [{t,o,h,l,c}]
function synthDay(pair, date, prevClose, close, seed, anchors = []) {
  const N = 288;
  const rnd = FX.U.rng(FX.U.hash(pair + '|' + date + '|' + seed));
  const pts = [{ i: 0, p: prevClose }];
  for (const a of anchors) {
    const i = minuteIndex(a.time);
    pts.push({ i, p: a.from });     // 跳空前最后一根收盘
    pts.push({ i, p: a.to });       // 跳空后第一根开盘
  }
  pts.push({ i: N, p: close });

  const bars = [];
  for (let s = 0; s < pts.length - 1; s++) {
    const A = pts[s], B = pts[s + 1];
    const n = B.i - A.i;
    if (n <= 0) continue;           // 零长度段 = 瞬时跳空
    const W = new Float64Array(n + 1);
    for (let k = 1; k <= n; k++) W[k] = W[k - 1] + gauss(rnd);
    for (let k = 0; k <= n; k++) W[k] -= W[n] * k / n;   // 端点归零
    const move = Math.abs(Math.log(B.p / A.p));
    const sigma = clamp(
      Math.max(DAILY_VOL[pair] * 0.6, move * 1.1),
      DAILY_VOL[pair] * 0.6,
      DAILY_VOL[pair] * 3.0
    ) * Math.sqrt(n / N);

    for (let k = 0; k < n; k++) {
      const x0 = k / n, x1 = (k + 1) / n;
      const base0 = Math.log(A.p) + (Math.log(B.p) - Math.log(A.p)) * x0;
      const base1 = Math.log(A.p) + (Math.log(B.p) - Math.log(A.p)) * x1;
      const o = (k === 0) ? A.p : Math.exp(base0 + sigma * W[k]);
      const c = Math.exp(base1 + sigma * W[k + 1]);
      const wick = Math.abs(gauss(rnd)) * sigma * o * 0.35;
      bars.push({
        t: dayStart + (A.i + k) * 300000,
        o, c,
        h: Math.max(o, c) + wick,
        l: Math.min(o, c) - Math.abs(gauss(rnd)) * sigma * o * 0.35
      });
    }
  }
  // 所有价格 roundPrice；确保 low<=min(o,c)<=max(o,c)<=high
  return bars;
}
```

**事件锚点**（`jump`）的语义：在 `i` 处，前一根收盘为 `from`，锚点后的第一根开盘为 `to`，形成跳空。为简化配置，`anchors` 里直接写 `{time, from, to}`，实现时把 `from` 作为上一段的终点、`to` 作为下一段的起点：

```
2015-01-15 EURCHF 09:30 UTC: from 1.20100, to 0.88000
2016-06-24 GBPUSD 00:00 UTC: from 1.48691, to 1.32000
2022-09-22 USDJPY 08:00 UTC: from 145.900, to 140.300
2024-08-05 USDJPY 01:00 UTC: from 148.900, to 142.200
```

> 这 4 个 `to` 是公开报道的盘中极端区间的重建值，**不是 ECB 收盘**。UI 必须标注“事件日盘中路径为估算；收盘为 ECB 参考价”。其余日期无锚点，路径从昨收到今收。

**历史日线**：

- 收盘 = 数据。
- 开盘 = 前一交易日收盘（无锚点时）；有 00:00 锚点时 = 锚点 `to`。
- 高/低 = 当日 5m 路径的极值（推进过的日子）；未推进的历史日可用种子化影线估算：`wick = 0.035%–0.13%`，高/低各加一次，并标注“估算”。
- 日线图绝不使用“下一根 open = 上一根 close”来抹掉事件跳空；事件锚点必须保留缺口。

### 4.11 战役评分

```js
function battleScore(b) {
  const ret = (b.finalEquity / 10000 - 1) * 100;   // %
  let ratio;
  if (b.targetReturn === 0) {
    ratio = ret >= 0 ? 1 : Math.max(-0.6, 1 + ret / 10);
  } else {
    ratio = clamp(ret / b.targetReturn, -0.6, 1.2);
  }
  const returnScore = 45 * ratio;
  const ddScore = 25 * clamp(1 - b.maxDD / b.ddLimit, -0.5, 1);
  const eventScore = 20 * b.E;                     // E ∈ {-1,0,+1}
  const discScore = b.trades === 0 ? 0
    : 10 * clamp(1 - Math.max(0, b.trades - b.tradeCap) / b.tradeCap, 0, 1);
  let score = returnScore + ddScore + eventScore + discScore + (b.extra || 0);
  if (b.blown) score -= 25;
  score = clamp(score, 0, 100);

  const passed = b.trades >= 1
    && b.finalEquity >= b.targetEquity
    && !b.blown
    && b.maxDD <= b.ddLimit
    && b.E >= 0;
  const stars = !passed || score < 45 ? 0
    : score >= 85 ? 3 : score >= 65 ? 2 : 1;
  return { score, stars, passed, parts: { returnScore, ddScore, eventScore, discScore } };
}
```

- `maxDD` 用权益轨迹的峰值到谷值，单位 %。
- `trades` = 已平仓笔数；未平仓不计。
- `extra` 为战役个性化加减分，范围 [−10, +10]。
- 战役可覆盖星级上限（如 2015 生存者最高 2 星）；覆盖规则写在 `battles.js` 的 `starCap`。
- 失败不消耗次数，保留最佳。

### 4.12 挑战评分

```js
function challengeScore(r, mod) {
  if (r.blown) return { score: 0, eligible: false };
  if (r.trades === 0) return { score: 0, eligible: false };
  const score = Math.round(
    mod.retCoef * r.returnPct
    - mod.ddCoef * r.maxDDPct
    + mod.hitPoints * r.hits
    + 20 * (r.blown ? 0 : 1)
    - r.trades
    + Math.min(mod.perWin * r.winTrades, 50)
    + (mod.bonus || 0)
  );
  return { score, eligible: score > 0 };
}
```

- 收益率 = `(finalEquity/10000 - 1) * 100`。
- 回撤 = 本次挑战权益轨迹峰值到谷值 %。
- `hits` = 重要度 3 事件中，事件发生时持有受影响货币对且方向与冲击同向、并持有至少 1 根 5m K 的笔数。
- 爆仓：0 分，不上榜。
- 0 交易：0 分，不上榜。
- 分数显示为整数；榜只收 `eligible`。

**示例**：收益 +18%，回撤 9%，命中 2 次，未爆仓，14 笔，词条奖励 25（按基础系数）：

```
1800 − 540 + 60 + 20 − 14 + 25 = 1351
```

P0 四个词条的 `bonus` 均为 0；示例中的 25 仅用于校验公式（等价于一个 25 分的词条奖励）。

### 4.13 新闻/事件命中判定

- 事件对货币 `ccy` 的冲击方向：`delta > 0` 表示该货币走强。
- 受影响货币对：6 个直盘中 base 或 quote 等于 `ccy` 的对；交叉盘由直盘派生，不单独判定。
- 对每个受影响对计算**该对的方向**：`pairDelta = (base===ccy ? +delta : 0) + (quote===ccy ? −delta : 0)`。
- 玩家在事件 tick 持有受影响对：
  - 若 `pairDelta > 0` 且持仓为多，或 `pairDelta < 0` 且持仓为空 → 命中。
  - 反之不命中。
- 至少持有到事件后第 1 根 5m K 收盘；期间被 SL/TP 平掉则不算命中（避免“挂单碰运气”）。

---

## 5. 模式规格

### 5.1 模拟沙盒 `sim`

- 初始：$10,000；9 对；杠杆 30/100/200/500，默认 100；无贷款。
- 起点：2026-10-30 00:00 UTC；价格锚点见 3.2。
- 首次进入：用同一因子模型 + 固定种子生成 3 个游戏日（864 根 5m）预热 K 线，再整体平移对数价格，使最后一根收盘 = 锚点；只保留最近 500 根存档。这样首屏立即有图，刷新后不重新生成。
- 市场：因子模型 + 时段 + 新闻 + 周末缺口；24/5 运行。休市时 tick 只推进时间、不处理订单；UI 提供“快进到开盘”。
- 速度：0.5×/1×/2×/4×，默认 1×（200ms/tick）。暂停/继续。
- 图表：5m/15m/1h/4h/1d/1w；默认 15m。
- 新闻：每日 2–6 条；设置可关闭（关闭后无新闻冲击，但点差/波动仍按模型）。
- 存档：自动 + 操作后立即；恢复价格、K 线、持仓、订单、时间、种子。
- 重置：确认弹窗；重置账户与市场，保留成就/统计。
- 模拟统计与挑战/战役分开；成就全局可解锁。

### 5.2 历史回放 `replay`

- 初始：$10,000；9 对；杠杆 30/100（默认 30）；单笔 margin ≤40%，总 ≤70%。
- 区间：以 2026-10-29 为终点，最近 30/90/180/365 个交易日；P1 再做自定义起止。
- 数据：`FX.History` 的 ECB 收盘；日线收盘真实，开盘=前收（事件锚点除外），高低/盘中路径为估算。
- 推进：手动“下一交易日”；自动播放 1.2 秒/日；可暂停。
- 决策：在每日收盘后下单；下一交易日路径结算。允许市价（按当前收盘报价立即成交）与挂单（下一日触发）。
- 图表：1d/1w/1M；MA7/25/99；开仓/SL/TP/强平线。图表可显示区间起点前 30 个交易日作为只读背景，账户与统计从区间首日算。
- 结算：期末报告——策略收益、买入持有基准、alpha、最大回撤、交易次数、成本、胜率；`alpha>0` 且 `maxDD≤20%` 显示“跑赢”徽章；同一区间保留最佳 alpha。
- 成就“历史学家”：5 个不同 `pair|start|end` 且 alpha>0。
- 不做星级、不做排名。

### 5.3 经典战役 `battle`

- 通用参数见 3.8；所有战役共享同一套引擎与评分。
- 进入：选择战役 → 显示剧情/目标/规则 → 开始（$10,000）。图表显示窗口前 30 个交易日作为只读背景，账户从窗口首日起算。
- 游标位于窗口第一个交易日之前；价格为该日开盘（前收）。第一次“下一交易日”播放第一天。
- 每日流程：
  1. 显示已到期且 `reveal:'before'` 的新闻；`reveal:'after'` 的结果类新闻在当日结算后显示（防剧透）。
  2. 玩家可在当前收盘价挂单/开平仓/设 SL/TP。
  3. 点击“下一交易日”或自动播放。自动播放/事件日动画期间订单票禁用，暂停后可下单。
  4. 引擎用 `synthDay` 生成当日 288 根 5m 路径（含事件锚点），逐 tick 结算挂单、SL/TP、保证金、swap。
  5. 事件日以 80ms/tick 播放动画（约 23 秒），可“跳过动画”；玩家不能盘中手动交易。
  6. 更新日 K、权益、新闻、成就。
- 结束：到达窗口最后一日收盘 → 结算 → 星级/分数/事件分/最佳保存。
- 重试：确认后重置账户与游标；保留最佳星级与成就。
- 中途离开：保存账户、游标、订单；下次恢复。
- 不锁定战役：P0 全部 6 场可直接进入；P1 再做星数解锁。

### 5.4 每日挑战 `challenge`

- 入口显示：今日词条、剩余次数、最佳分数、目标线。
- 开始：消耗 1 次；账户重置 $10,000；用种子生成 10 个交易日的行情。
- 种子：

```
dayKey = 本地日期 YYYY-MM-DD
modifierId = FNV1a(dayKey) % 4
seed = FNV1a('kurumi:' + dayKey + ':' + modifierId)
rng = mulberry32(seed)
```

- 市场：与模拟相同的因子模型/时段/新闻/周末规则，但所有随机数来自 `rng`，禁止 `Math.random`。
- 规则：30×；最多 3 笔；单笔 ≤40%、总 ≤70%；点差 ×1.5；无贷款。
- 速度：固定 200ms/tick；可暂停；不可调速。
- 结束：随时“结束挑战”→ 按当前权益结算；或 10 日结束自动结算。
- 3 次机会同日共用种子与词条；取最高分；日期变化重置次数并清空进行中的挑战。
- 本地榜：3 个档案（昵称），今日前 10，30 天每日冠军；记录 attempts、startedAt、elapsed；<3 分钟标记“速通”但保留成绩。
- 分享：文本摘要复制到剪贴板（日期、词条、分数、收益、回撤、一句点评）；图片分享卡 P1。

---

## 6. 经典战役（6 场）

所有窗口均在 `1999-01-04 → 2026-10-29` 内。表中“事件日收盘”为 ECB 数据；“事件日路径”为公开报道区间重建的估算，UI 必须标注。

### 6.0 通用剧情写法

每场战役包含：

- `story`：3–4 段第二人称剧情（进入时逐段显示，可跳过）。
- `news`：日期 + 标题 + 一句解读；到达日期时弹出快讯，**不改价**（除事件锚点）。
- **防剧透规则**：事件结果类新闻必须在当日路径结算完成后显示；“提前预警/传闻”类新闻可在当日开始前显示。每场战役的新闻配置带 `reveal: 'before'|'after'`；事件日结果默认 `after`。
- `goal`：权益目标、回撤红线、成交上限、事件条件。
- `eventPath`：事件日盘中锚点（可为空）。
- `special`：个性化加减分。
- 表中“起始价”是窗口首日收盘；进入战役时的初始报价是**窗口前一交易日收盘**，第一次“下一交易日”播放首日。这样玩家在首日开盘前就能决策，且不提前看到首日收盘。

### 6.1 战役 01 · 2008 雷曼海啸

| 项 | 值 |
|---|---|
| id | `lehman-2008` |
| 货币对 | USD/JPY |
| 窗口 | 2008-08-01 → 2008-11-28 |
| 事件日 | 2008-09-15 |
| 起始价 / 期末价 | 107.513 → 95.435 |
| 事件日前收 / 收盘 | 107.287 → 105.908（−1.29%） |
| 目标权益 | $12,000（+20%） |
| 回撤红线 | 20% |
| 成交上限 | 12 |
| 事件路径 | 无锚点；9/15 起持续下跌，10/24 见 93.204，10/27 低 92.897 |

**剧情**：你在东京自营交易室做 junior。夏天美元/日元在 108 附近，套息交易像工资一样稳定。9 月 15 日雷曼破产，导师说“日元是避险货币”，老板说“跌下来就是买点”。十月底 USD/JPY 砸到 92.9 又快速反弹，你必须在接飞刀和追空之间选一个。

**新闻节点**：

- 09-07 房利美/房地美被接管：风险厌恶升温，USD/JPY 承压。
- 09-15 雷曼破产：全球去杠杆，日元走强。
- 09-29 美国救市方案被众议院否决：避险买日元。
- 10-08 全球央行联合降息：短线反弹，趋势未改。
- 10-24 新兴市场抛售：USD/JPY 触及 93 附近。
- 11-21 花旗获救助、风险企稳：日元回吐部分涨幅。

**事件分 E**：+1 若 9/15 收盘时 USD/JPY 净敞口为空或零，且事件日盈亏 ≥0；−1 若净敞口为多且事件日亏损 ≥3% 权益；否则 0。  
**extra**：无。  
**失败叙事**：9/15 前重仓做多 → “导师沉默”；重试提示“避险货币也会先被流动性踩踏”。

### 6.2 战役 02 · 2015 瑞郎脱钩（核心教学关）

| 项 | 值 |
|---|---|
| id | `franc-2015` |
| 货币对 | EUR/CHF |
| 窗口 | 2014-12-01 → 2015-02-27 |
| 事件日 | 2015-01-15 |
| 起始价 / 期末价 | 1.20280 → 1.06360 |
| 事件日前收 / 收盘 | 1.20100 → 1.02800（−14.4%） |
| 事件路径 | 09:30 UTC：1.20100 → 0.88000（估算）；随后回补至 1.02800 |
| 目标 | 生存者：期末权益 ≥$9,000、不爆仓、事件日亏损 <5%；猎手：期末权益 ≥$12,500、不爆仓、事件日方向正确 |
| 回撤红线 | 35% |
| 成交上限 | 8 |

**剧情**：三年来 1.20 是瑞士央行的“铁底”，全市场做空瑞郎、做多 EUR/CHF，赚那一点点利差。你的经纪人也劝你“稳赚”。2014 年 12 月央行实施负利率并重申下限，你开始用“下限不会破”的假设加仓。2015 年 1 月 15 日，央行取消下限，EUR/CHF 从 1.201 直接跳到 0.88 附近，流动性瞬间消失，止损单以最差价格成交。你唯一能决定的是事件前的仓位有多大。

**新闻节点**：

- 12-18 瑞士央行实施负利率并重申 1.20 下限。
- 01-12 市场再次测试 1.20，价格贴住 1.201。
- 01-15 取消下限、降息至 −0.75%：EUR/CHF 暴跌。
- 01-16 流动性真空：点差扩大到 80–120 点，部分报价失效（叙事标注）。
- 01-29 瑞郎回落，EUR/CHF 反弹至 1.03–1.05。

**评分**：`targetReturn = 0%`（生存者）/ 25%（猎手，按最终结果自动选较高轨道）；`targetEquity` 对应 $9,000 / $12,500；`ddLimit=35`；`tradeCap=8`。  
**轨道判定**：先判定猎手（期末权益 ≥$12,500 且事件日方向正确），否则按生存者（期末权益 ≥$9,000 且事件日亏损 <5%）；两者都不满足则失败。计分时两条轨道都算一遍，取较高分；猎手轨道必须满足事件方向正确。**生存者轨道最高 2 星；3 星必须满足猎手条件**（避免 0.01 手走过场拿满星）。  
**事件分 E**：+1 若事件日权益亏损 <5%（生存者）或事件日方向正确且盈利（猎手）；−1 若爆仓或事件日亏损 ≥10%；否则 0。  
**extra**：猎手 +10（事件日盈利 >0）；生存者 0。  
**失败叙事**：爆仓触发“负余额账单”，显示 NBP 吸收额；重试提示“跳空面前，止损不是保险”。

> 这是全作最重要的一关。0.5 手 EUR/CHF 多单从 1.201 到 0.88，按报价币 CHF 折算约亏 $1.8 万，账户直接负余额。必须让玩家在事件前主动降仓或反向。

### 6.3 战役 03 · 2016 英国脱欧

| 项 | 值 |
|---|---|
| id | `brexit-2016` |
| 货币对 | GBP/USD |
| 窗口 | 2016-05-16 → 2016-07-29 |
| 事件日 | 2016-06-24 |
| 起始价 / 期末价 | 1.43706 → 1.31671 |
| 事件日前收 / 收盘 | 1.48691 → 1.37040（−7.83%） |
| 事件路径 | 00:00 UTC：1.48691 → 1.32000（估算）；随后回补至 1.37040 |
| 目标权益 | $11,500（+15%） |
| 回撤红线 | 18% |
| 成交上限 | 10 |

**剧情**：公投前两周民调拉锯，英镑在 1.44–1.47 震荡，市场普遍相信“留欧”。6 月 16 日留欧派议员考克斯遇袭，拉票暂停，英镑反而反弹。6 月 24 日凌晨脱欧阵营获胜，英镑从 1.4869 跌到 1.37，两个交易日后到 1.3187。流动性最差时点差 300 点。

**新闻节点**：

- 06-14 英国央行警示公投风险。
- 06-16 考克斯遇袭、拉票暂停：英镑反弹。
- 06-23 投票日：窄幅震荡，波动率上升。
- 06-24 脱欧结果：英镑暴跌。
- 06-27 评级下调、政治真空：继续下跌。
- 07-12 特蕾莎·梅接任：跌势暂缓。

**事件分 E**：+1 若 6/23 收盘时 GBP/USD 净敞口为空，或总保证金 ≤30% 权益；−1 若为多且总保证金 >30% 权益且事件日亏损 ≥3%；否则 0。  
**extra**：事件夜总保证金 ≤30% 且盈利 +10；事件夜满仓做多且爆仓 −10（与 E 独立，最低总分 0）。  
**失败叙事**：“凌晨三点强平”；重试提示“公投交易的不是结果，是赔率”。

### 6.4 战役 04 · 2020 疫情美元荒

| 项 | 值 |
|---|---|
| id | `covid-2020` |
| 货币对 | AUD/USD |
| 窗口 | 2020-02-20 → 2020-04-30 |
| 事件日 | 2020-03-23 |
| 起始价 / 期末价 | 0.66221 → 0.65526 |
| 事件日前收 / 收盘 | 0.58746 → 0.58017（−1.24%）；3/19 低 0.57961 |
| 事件路径 | 无锚点；3/19 见底，3/23 美联储无限量 QE 后反转 |
| 目标权益 | $12,000（+20%） |
| 回撤红线 | 22% |
| 成交上限 | 14 |

**剧情**：疫情从中国扩散到欧洲，风险货币下跌。澳元从 0.66 跌到 0.60，你觉得“已经跌很多了”。3 月 9 日油价崩盘，3 月 12 日全球股市熔断，澳元跌到 0.5796，所有资产都在被抛售。3 月 23 日美联储宣布无限量 QE，澳元当天见底，随后两个月反弹到 0.65。追空的人在最低点被反转打爆。

**新闻节点**：

- 02-24 意大利北部封锁。
- 03-09 油价单日暴跌 30%。
- 03-12 WHO 宣布大流行、美股熔断。
- 03-15 美联储紧急降息至零并启动 QE。
- 03-19 美元荒、澳元跌至 0.5796。
- 03-23 美联储无限量 QE：趋势反转。
- 04-09 疫情曲线见顶。

**事件分 E**：+1 若在 3/23 后 3 个交易日内建立多头并持有 ≥1 日，或 3/19 前已空仓并在 3/23 后做多；−1 若在 3/19 后新开空并亏损；否则 0。  
**extra**：反转捕捉 +10；3/19 后追空至 3/23 以下 −10。  
**失败叙事**：“卖在底部”；重试提示“危机交易的第一规则是活到政策转向”。

### 6.5 战役 05 · 2022 日元干预

| 项 | 值 |
|---|---|
| id | `yen-2022` |
| 货币对 | USD/JPY |
| 窗口 | 2022-09-01 → 2022-11-18 |
| 事件日 | 2022-09-22 |
| 起始价 / 期末价 | 139.284 → 139.996 |
| 事件日前收 / 收盘 | 144.014 → 140.813（−2.22%） |
| 事件路径 | 08:00 UTC：145.900 → 140.300（估算）；收盘 140.813；10/21 高点 151.686 |
| 目标权益 | $11,200（+12%） |
| 回撤红线 | 15% |
| 成交上限 | 12 |

**剧情**：美联储连续 75 个基点加息，日本央行死守收益率曲线控制。美元/日元从 139 涨到 145.9，利差交易拥挤。9 月 22 日，日本央行维持宽松，财务省直接入场买入日元，USD/JPY 从 145.9 瞬间跌到 140.3，止损单被扫穿。10 月 21 日突破 151.9 后再次被干预。你必须在“口头干预—实际干预—美国 CPI”三条线之间判断哪一次是真的。

**新闻节点**：

- 09-07 日本官员对单边波动表达担忧。
- 09-13 美国 CPI 超预期。
- 09-22 日本央行维持 YCC，财务省买入日元。
- 10-21 突破 151.9 后再次干预。
- 11-10 美国 CPI 降温。

**事件分 E**：+1 若 9/22 收盘时净敞口为空或零，且事件日盈亏 ≥0；−1 若在 9/1 之后新开多头且入场价 >150；否则 0。  
**extra**：每笔 150 上方新多 −5（最多 −10）；干预日方向正确 +10。  
**失败叙事**：“财务省的电话”；重试提示“干预不改变趋势，但会改变你的账户余额”。

### 6.6 战役 06 · 2024 套息拆仓

| 项 | 值 |
|---|---|
| id | `carry-2024` |
| 货币对 | USD/JPY |
| 窗口 | 2024-07-01 → 2024-08-30 |
| 事件日 | 2024-08-05 |
| 起始价 / 期末价 | 161.145 → 145.386 |
| 事件日前收 / 收盘 | 148.934 → 142.240（−4.49%） |
| 事件路径 | 01:00 UTC：148.900 → 142.200（估算）；盘中低 141.7；收盘 142.240 |
| 目标权益 | $11,500（+15%） |
| 回撤红线 | 18% |
| 成交上限 | 12 |

**剧情**：上半年套息交易拥挤到极致，USD/JPY 冲到 161.9，所有人都在借日元、买美元。7 月 31 日日本央行加息到 0.25%，8 月 2 日美国非农疲弱，两个原本独立的信号在同一个周末变成“全球拆仓”。8 月 5 日，日经暴跌 12.4%，USD/JPY 从 148.9 砸到 142.2，盘中低点 141.7。杠杆基金被追加保证金，流动性瞬间消失。

**新闻节点**：

- 07-11 美国 CPI 降温。
- 07-31 日本央行加息至 0.25%。
- 08-02 美国非农远低于预期。
- 08-05 全球股市暴跌、套息拆仓。
- 08-07 日本央行副行长释放鸽派信号。
- 08-23 鲍威尔杰克逊霍尔转向。

**事件分 E**：+1 若 8/2 收盘时总保证金 ≤35% 权益，或 USD/JPY 净敞口为空；−1 若为多且总保证金 >35% 权益且事件日亏损 ≥3%；否则 0。  
**extra**：事件前降杠杆 +10；8/5 后追空且未在 2 日内平仓 −10。  
**失败叙事**：“追加保证金通知”；重试提示“套息交易的利润是租金，风险是地震”。

### 6.7 战役新闻与数据边界

- 战役新闻只做叙事/日期触发，不额外改价；价格只由 ECB 收盘 + 事件锚点 + 合成路径决定。
- 事件锚点的 `to` 值必须在 UI 标注“盘中估算”；收盘值必须与数据一致。
- 不在战役里使用 1992 黑色星期三等无欧元数据的事件；P0 明确不做。
- P1 预留：2011 瑞郎设限（EURCHF）、2022 英国迷你预算（GBPUSD）。

---

## 7. 每日挑战

### 7.1 词条（P0 4 个）

`modifierId = FNV1a(dayKey) % 4`。

| id | 名称 | 市场修正 | 评分修正 |
|---|---|---|---|
| `high-vol` | 高波动日 | 波动 ×1.6；点差 ×1.2 | `ddCoef=80`（更惩罚回撤）；其余基础 |
| `range` | 窄幅震荡 | 波动 ×0.55；点差 ×0.8 | 每笔盈利 +5（上限 50）；命中 15 分/次 |
| `data-week` | 数据周 | 每天 2 条重要度 3 事件；事件后 3 根 K 波动 ×2 | 命中 30 分/次 |
| `liquidity-drought` | 流动性干旱 | 点差 ×2.5；滑点 ×3 | `retCoef=120`（收益系数 1.2） |

基础评分系数：`retCoef=100, ddCoef=60, hitPoints=30, perWin=0`。

### 7.2 挑战流程

1. 进入模式 → 显示今日词条、剩余次数、最佳分、目标线。
2. 点击“开始挑战” → 消耗 1 次 → 生成种子 → 重置 $10,000 → 进入第 1 个交易日。
3. 每个交易日 288 tick；市场 24h；事件按种子生成；玩家可开平仓、设 SL/TP。
4. 玩家可随时“结束挑战”→ 确认 → 按当前权益结算；或 10 日结束自动结算。
5. 结算：评分卡（收益、回撤、命中、笔数、爆仓、词条）、目标线铜/银/金、今日榜名次、文本分享。
6. 3 次机会取最高；日期变化重置次数并清空进行中的挑战。

### 7.3 本地排行榜

存档键 `kurumi-fx:daily:v1`：

```json
{
  "v": 1,
  "profiles": ["你", "朋友A", "朋友B"],
  "days": {
    "2026-10-30": {
      "modifier": "high-vol",
      "rows": [
        { "name": "你", "score": 1351, "equity": 11800, "dd": 9,
          "trades": 14, "hits": 2, "attempts": 2, "elapsed": 620, "ts": 0 }
      ]
    }
  },
  "champions": [
    { "day": "2026-10-30", "name": "你", "score": 1351 }
  ]
}
```

- 今日榜按分数降序，前 10；同分先到先得。
- 历史榜保留最近 30 天每日冠军。
- 本地档案不做云同步；可选的全球榜只提交单条成绩（见 7.4）。
- 反作弊：本地游戏不做强校验；记录 attempts/elapsed；单局 <3 分钟标记“速通”但不取消成绩。

### 7.4 全球排行榜（可选，默认关闭）

- 后端：Cloudflare Workers + D1，代码在 `workers/leaderboard/`；前端在 `js/core/leaderboard.js`。
- 未配置 `DEFAULT_API` 时不发起任何网络请求，单机行为完全不变。
- 配置后：结算页可提交成绩；今日榜前 50；近 30 天每日冠军。
- 身份：本地随机 `playerId` + 玩家输入昵称（1–16 字）；同一 `playerId` 每天只保留最高分。
- 日切：每日挑战按北京时间（UTC+8）00:00 切日，全球玩家同一盘行情；服务端只接受北京时间今天/昨天的提交。
- 接口：`GET/POST /api/daily/:dayKey/scores`、`GET /api/daily/champions`；基础校验，不做服务端重放。
- 失败策略：4 秒超时；离线/未配置/服务端错误时显示本地榜与缓存，提交失败进入本地待提交队列，不影响玩法。
- 隐私：首次提交前提示昵称与成绩会公开；不提交也能正常玩。

---

## 8. UI / 交互 / 视觉规范

### 8.1 设计命题

“旧账本 × 深海交易终端”。

- 白天：暖米纸、墨色、氧化黄铜，像一本记录杠杆的旧账本。
- 夜间：深海蓝黑、磷光绿松石、铜线，像一台安静的旧式行情终端。
- 图表在任何主题下保持深色“仪表盘”，只让数据颜色变化。
- 圆角 12–16px；细线、账本角标、票券打孔线、衬线标题；不用 emoji 功能图标，统一 1.5px 内联 SVG。

**文案气质**：克制、略带黑色幽默、不鼓励赌博。

- 空持仓：`还没有仓位。市场不会因为你观望而扣钱。`
- 高杠杆：`杠杆放大的是结果，不是判断力。`
- 爆仓：`保证金已经用完。市场没有义务等你。`
- 盈利平仓：`这次是你赢了，不是方法赢了。`
- 禁用：`可用保证金不足，还差 $12.40。可降低手数或先平仓。`

### 8.2 颜色 Token（必须全部从变量取）

**白天 `html[data-theme="day"]` / 默认**：

```
--bg #F1EBDD; --surface #FBF8F0; --surface-raised #FFFDF8; --surface-sunken #E9E1D1;
--ink #19262B; --ink-2 #31454A; --text-muted #687572; --text-faint #92988E;
--border #D6CDBB; --border-strong #B7AC97; --border-soft #E8E0D1;
--brand #14383C; --brand-2 #2B5D5C; --brass #9C6827; --brass-strong #7A4B15;
--action #14383C; --action-hover #1E4D50; --action-contrast #F7F1E3;
--accent #8E5C1E; --link #7A4B15; --focus #C99653;
--red-500 #B83A2D; --red-600 #932A20; --green-500 #177760; --green-600 #0F5C49;
--bid #2E6680; --ask #8A5A1A; --spread #8A7354;
--risk-safe #2C6A61; --risk-watch #8A5A12; --risk-danger #B13A2D; --risk-liq #6E1A14;
--info #2E6680; --warn #8A5A12; --danger #A62C21; --success #2F6B53;
--chart-bg #0F1B20; --chart-grid rgba(235,228,211,.07); --chart-axis #91A59F;
--chart-text #DDE6E1; --chart-red #FF7468; --chart-green #43C9AA;
--chart-ma-1 #E6C177; --chart-ma-2 #83A9D6; --chart-ma-3 #B692C4;
--chart-crosshair #C8D4CF; --chart-current #D7A65A; --chart-entry #D7A65A;
--chart-sl #FF7A6E; --chart-tp #6FC7E2; --chart-liq #FF4D42; --chart-order #C9B47C;
--overlay rgba(10,20,23,.56);
```

**夜间 `html[data-theme="night"]`**：

```
--bg #0A1114; --surface #101B1F; --surface-raised #152429; --surface-sunken #070F12;
--ink #EDE5D4; --ink-2 #C9C2B4; --text-muted #8B9996; --text-faint #5D6D6B;
--border #27393D; --border-strong #3B5155; --border-soft #1B2C30;
--brand #D8A65C; --brand-2 #E9C27F; --brass #D8A65C; --brass-strong #F0C47C;
--action #D8A65C; --action-hover #E9BA70; --action-contrast #17140D;
--accent #D8A65C; --link #F0C47C; --focus #E9BA70;
--red-500 #FF776A; --red-600 #FF9C92; --green-500 #46D3B2; --green-600 #79E6CC;
--bid #7FB6CE; --ask #E0B168; --spread #B8A27F;
--risk-safe #6FC9B8; --risk-watch #E4B660; --risk-danger #FF8B7D; --risk-liq #FF5B50;
--info #8BC8E3; --warn #E4B660; --danger #FF8B7D; --success #6FD3B5;
--chart-bg #070E11; --chart-grid rgba(235,229,212,.055); --chart-axis #7F928F;
--chart-text #DCE5E0; --chart-red #FF8276; --chart-green #4BD9B7;
--chart-ma-1 #F2CD86; --chart-ma-2 #8CB9E8; --chart-ma-3 #C79ED6;
--chart-crosshair #AABBB6; --chart-current #E1B772; --chart-entry #E1B772;
--chart-sl #FF8B7D; --chart-tp #84D3EA; --chart-liq #FF5B50; --chart-order #D8C08C;
--overlay rgba(2,7,9,.74);
```

**涨跌配色**：

- 默认中式：红涨绿跌。`--mkt-up: --red-500; --mkt-down: --green-500`；图表 `--chart-up: --chart-red; --chart-down: --chart-green`。
- 国际：绿涨红跌。`html[data-updown="global"]` 交换 `--mkt-up/--mkt-down` 与 `--chart-up/--chart-down`。
- 所有盈亏数字、K 线、涨跌幅、做多/做空按钮统一跟随；风险色、点差色不跟随。
- 颜色之外必须有冗余：`▲/▼`、显式 `+/−`、`多/空`、K 线空心/实心、图标形状、纹理。

**字体**（全部系统栈，零外链）：

```
--font-ui: system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC",
  "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC",
  "Microsoft YaHei", sans-serif;
--font-display: "Songti SC", STSong, "Noto Serif CJK SC",
  "Source Han Serif SC", "SimSun", serif;
--font-mono: "SF Mono", "Cascadia Code", "Roboto Mono", "JetBrains Mono",
  "IBM Plex Mono", "Noto Sans Mono", ui-monospace, monospace;
```

- 正文 14px/1.6；数字/价格/金额/时间用 mono + `tabular-nums`；中文标题用宋体；最小正文 11px。
- 金额 `$12,345.67`；盈亏 `+$120.40` / `−$86.20`（U+2212）；百分比 2 位；pips 1 位。
- 价格容器 `min-width: 8.6ch`，避免 5 位/3 位切换抖动。

### 8.3 布局

```
--topbar-h: 52px; --account-h: 84px;
--rail-left: 240px; --rail-right: 340px;
--gap: 16px; --content-max: 1680px;
```

桌面：

```
.workspace {
  display: grid;
  grid-template-columns: 240px minmax(0,1fr) 340px;
  gap: 16px; max-width: 1680px; margin: 0 auto; padding: 16px 20px 48px;
}
```

- 顶栏 52px 吸顶；账户条 84px；左栏市场列表；中栏图表 + 交易台；右栏订单票 + 免责声明。
- 主面板圆角 14px；内部小卡 10px；按钮 8px；胶囊 999px。
- 账户条顺序：`账户总权益（最大）→ 余额 → 浮动盈亏 → 已用/可用保证金 → 保证金水平 → 今日 swap`。
- 保证金水平用 40×4px 迷你条 + 文字 `安全 / 注意 / 追保 / 强平`；右侧显示“距强平 X 点（估算）”。
- 模式徽章：`模拟行情 / 历史回放 / 经典战役 / 每日挑战`，文字必须保留。

响应式：

| 断点 | 布局 |
|---|---|
| ≥1440 | 240 / 1fr / 340；账户 6 项全显 |
| 1200–1439 | 220 / 1fr / 312；隐藏迷你走势线 |
| 1080–1199 | 左栏变顶部横向货币对条；中+右两列；账户 4 项 + 更多 |
| 860–1079 | 单列：图表 → 交易台 → 订单票；取消 sticky |
| 720–859 | 订单票底部抽屉（收起 72px，展开 68dvh）；底部导航 4 项 |
| <720 | 顶栏 48；账户 2×3；图表 280；货币对横滚；弹窗近全屏 |
| <390 | 图表 240；账户仅保留权益 + 可用 + 浮盈；隐藏次要标签 |

- 320px 宽不得出现横向滚动；所有触摸目标 ≥44×44px。
- 移动端底部留 `env(safe-area-inset-bottom)`。

### 8.4 组件规格

**顶栏**：品牌中文字标（宋体 26px 700）+ 英文副标 `ABYSS FX`（mono 9px 字距 .28em）+ 模式胶囊 + 帮助/成就/设置/教程/免责声明。

**市场列表**：每行 50px；左侧 `EUR/USD`（mono 13）+ `欧元/美元`（11px 次文字）；右侧价格（mono 12）+ 涨跌幅；选中态 `--surface-sunken` + 左侧 3px `--brass` 竖条；下方点差 `点差 0.8`，扩大时 `! 点差扩大` + `--risk-watch`。7 对首屏可见；9 对可滚动。

**图表外壳**：标题行 64px：`EUR/USD` mono 26 + 中文名；右侧 bid/ask/点差。周期分段 28px 高：`5m 15m 1h 4h 1d 1w`（回放 `1d 1w 1M`）。图表高 `clamp(320px, 40vh, 460px)`；下方新闻条 36px；图例/时间 24px。

**交易台**：tab 高 36px：`持仓 2 / 挂单 1 / 成交`；行高 64px；最大高 240px 内滚动。持仓行字段：`对 · 方向 · 手数 · 开仓价 · 当前可得价 · 浮盈 · 已用保证金 · 距强平 · SL/TP · swap`。盈利/亏损只改 PNL 与左侧 3px 方向条，不整块染色；接近强平加 `--risk-danger-soft` + 虚线；强平加斜纹 + `已强平`。

**订单票**：右栏 sticky；宽 340；内边距 16；顶部 10×10 账本角标。字段：

- 货币对行 40px；当前价 mono 28；点差胶囊。
- 做多/做空双按钮高 52px；文字 `做多 买入` / `做空 卖出`。
- 手数输入 44px，等宽 18；快捷 `0.01 / 0.1 / 1 / MAX`。
- 杠杆分段/滑杆：`30× / 100× / 200× / 500×`；战役/挑战仅 30×；滑杆颜色 `safe→watch→danger`。
- 挂单类型：市价 / Buy Limit / Sell Limit / Buy Stop / Sell Stop；价格输入。
- SL/TP：pip 与价格切换；显示最小距离。
- 预览三行：名义仓位 / 开仓手续费 / 点差成本；再加一行“开仓后保证金水平 / 距强平”。
- 风险提示 11px；杠杆 >100× 出现 `--warn-soft` 横条。
- 禁用态 `opacity:.45`，旁边直接写原因，不能只靠 Toast。
- 成交后按钮短暂变 `--brass` 800ms。

**保证金条**：高度 6px；轨道 `--gauge-track`；填充按保证金水平：

- ≥300% `--risk-safe`
- 150–300% `--risk-watch`
- 100–150% `--risk-danger`
- <100% `--risk-liq`
- <50% 斜纹 + `强平`

轨道刻度标 `50% / 100% / 200% / 300%`。文字同时显示 `保证金水平 250% · 注意` 与 `距强平 38 点（估算）`。**不使用“保证金占用率 42%”作为主指标**，避免与保证金水平互逆造成误读。

**新闻条**：36px，`--surface-sunken`，左侧标签 `数据/央行/风险/突发`，中间滚动文字；hover/focus 暂停；`prefers-reduced-motion` 改静态省略。快讯浮卡 336px 宽，右 3px 类型色条，8 秒关闭，最多排队 3 条。

**弹窗**：标准 480px；成就册 680px；分享 560px；最大 92dvh；内边距 24；圆角 16；遮罩 6px blur。底部按钮取消在左、主操作在右；破坏性操作主按钮 `--danger`，取消默认聚焦；点遮罩只能关非破坏性。移动端底部抽屉化，顶部 4×36 拖拽条，按钮吸底。

**成就册**：3 列网格，卡片最小 152×112px；未解锁 `--surface-sunken` 底 + 虚线边框 + 40% 线稿图标 + 提示；已解锁 `--surface` 底 + 1px `--brass` 边 + 左上角铜色火漆章 + 解锁日期；顶部 6px 进度条 + `已解锁 7 / 18`；分类 tab：全部 / 交易 / 风险 / 剧情 / 挑战。解锁动效 640ms，不用全屏礼花。

**Toast**：2400ms；进入 180ms、停留 2s、退出 180ms。操作结果必须落到页面可见区域，Toast 只是补充。

### 8.5 图表

- Canvas 2D；DPR 上限 2；`ResizeObserver` 重绘；不在 CSS 缩放 canvas。
- 每屏 54–70 根，按宽度自适应；`max(30, min(70, floor(plotW/9)))`。
- 层级：背景 → 网格 → K 线 → 均线 → 挂单 → 开仓 → SL/TP → 强平 → 当前价 → 十字光标 → 提示。
- 坐标：左 16、右 64、上 24、下 18；网格 5 横 6 竖；不画成交量（P0 砍掉）。
- K 线：上涨空心，1.2px 描边；下跌实心；影线 1–1.2px；实体宽 `max(3px, slot*0.58)`，最大 9px；十字星实体至少 2px；不用渐变/圆角/发光。
- 均线：MA7 `--chart-ma-1` 铜金；MA25 `--chart-ma-2` 蓝灰；MA99 `--chart-ma-3` 灰紫；1.4px；左上角短标签 + 当前值；颜色不随涨跌切换。
- 开仓线：1px 点线 `--chart-entry`，右旗 `ENTRY 1.11300`。
- SL：1px 虚线 `--chart-sl`，右旗 `SL`；TP：`--chart-tp`，右旗 `TP`。
- 挂单：8px 空心三角 + 35% 透明虚线，右旗 `LIMIT 1.08000` / `STOP ...`。
- 强平：5/3 交替虚线 `--chart-liq` + 下方 6–8% 透明红区 + 右旗 `LIQ`；必须比 SL 更粗/更有结构。
- 当前价：1px 短虚线 `--chart-current`，右侧铜色价格标签，不用红绿整条线。
- 十字光标：1px 点线；右轴价格标签、底轴时间标签；左上角 `开 1.0842 高 1.0871 低 1.0838 收 1.0864`；触屏长按拖动；松开保留 2 秒。
- 时间轴 5 个标签；模拟显示 `HH:MM`，回放显示 `YYYY-MM-DD`。
- 空态：线稿纸灯水母 + `还没有行情。`；加载：低透明斜纹 + `正在读取历史行情…`；回放：顶部日期进度条，当前蜡烛右侧留 2 根空位。
- 可访问性：`canvas role="img"` + 动态 `aria-label`（如“欧元美元 5 分钟图，最近 54 根 K 线，最新价 1.08742，上涨 0.32%”）；提供可展开的最近 20 根 OHLC 文本表（P0 可只做 aria-label，文本表 P1）。

### 8.6 动效与音效

- 页面进入 360–420ms，顶栏 0 / 账户 40 / 左栏 80 / 中栏 120 / 右栏 160ms；`opacity + translateY(8px)`；只执行一次。
- 价格跳动 180ms 背景闪 `--mkt-up-soft/--mkt-down-soft`，不改变布局宽度。
- 下单按下 90ms `scale(.99)`；成交后订单票边框亮一次。
- 持仓卡进入 220ms；平仓反向 180ms。
- 弹窗 180ms 进入 / 120ms 退出。
- 爆仓 360ms 屏幕边缘红色渐晕 1 次 + 强平线脉冲 2 次，240ms 后弹窗；不做全屏抖动。
- 成就解锁 640ms 铜色扫光 + 火漆章 `scale(.9→1.04→1)`，无彩带。
- `prefers-reduced-motion: reduce` 下所有动画 0.01ms，跑马灯停，倒计时不动画。
- **音效 P1 不做**。P0 不加载音频、不创建 AudioContext。若 P1 补，使用 WebAudio 合成，默认音量 30%，页面隐藏 suspend。

### 8.7 交互、键盘、无障碍

- 全局：`Esc` 关闭最上层；`?` 快捷键说明；`F` 聚焦图表；图表聚焦时 `1–5` 切周期；订单票聚焦时 `L` 做多 / `S` 做空；输入框聚焦时屏蔽单字母。
- 所有可交互元素 `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }`，禁止 `outline:none`。
- 弹窗焦点陷阱；打开保存触发元素，关闭归还焦点。
- 成交/撤单/贷款用 `role="status" aria-live="polite"`；仅强平用 `assertive`；行情不逐 tick 播报，每 5 秒摘要。
- 危险操作：
  - 平单仓：行内 loading 300ms + Toast，不全屏弹窗。
  - 一键全平：弹窗列出仓位数、合计浮盈、平仓后预计余额；主按钮“确认全部平仓”。
  - 重置模式：输入中文“重置”后才能启用主按钮（P0 可简化为“确认重置”+ 二次确认；P1 做输入）。
  - 结束挑战：显示最终权益、排名提交说明；主按钮“结算并结束”。
  - 强平风险：不自动操作；提供“去减仓 / 去平仓 / 暂不处理”，不倒计时。
  - 首次 >100×：行内警告 + 首次勾选“我已了解强平风险”，持久化。
- 首次追保：弹 3 步教学（什么是保证金水平、50% 强平、如何减仓），只弹一次；之后只显示顶部风险条和“去减仓/去平仓”按钮。
- 错误文案必须给原因与下一步，不能只写“操作失败”。

---

## 9. 成就与统计

### 9.1 成就（18 条，P0）

存档 `kurumi-fx:achv:v1`：`{v:1, unlocked:{id:timestamp}}`。成就全局，不区分模式；战役专属条件见条件列。解锁时 Toast + 成就册，不打断交易。

| # | id | 名称 | 条件 | 分类 |
|---|---|---|---|---|
| 1 | `first-blood` | 第一滴血 | 完成首笔平仓（任意模式） | 交易 |
| 2 | `both-sides` | 双向人生 | 多、空各有一笔盈利平仓 | 交易 |
| 3 | `stop-believer` | 止损信徒 | 连续 10 笔平仓均在开仓时设置过 SL | 交易 |
| 4 | `buy-top` | 追高艺术家 | 做多入场价 ≥ 近 40 根当前周期 K 最高价 ×0.999（负面成就） | 交易 |
| 5 | `rooftop` | 天台排队 | 首次触发强平 | 风险 |
| 6 | `negative` | 负资产 | 首次出现负余额（NBP 吸收 >0） | 风险 |
| 7 | `cb-friend` | 央行之友 | 任意战役事件日 E=+1 | 剧情 |
| 8 | `chf-survivor` | 瑞郎幸存者 | 2015 战役以“生存者”轨道通关 | 剧情 |
| 9 | `black-swan` | 黑天鹅猎手 | 2015 战役事件日前持有 EURCHF 空头且事件日盈利 | 剧情 |
| 10 | `brexit-night` | 脱欧夜未眠 | 2016 战役事件夜持有仓位且事件日盈利 | 剧情 |
| 11 | `sell-bottom` | 卖在底部 | 2020 战役 3/19 后新开空并亏损（负面） | 剧情 |
| 12 | `no-chase` | 不追多 | 2022 战役全程未在 150 上方开多并通关 | 剧情 |
| 13 | `delever` | 降杠杆大师 | 2024 战役 8/5 前总保证金 ≤35% 并通关 | 剧情 |
| 14 | `historian` | 历史学家 | 5 个不同回放区间 alpha>0 | 挑战 |
| 15 | `daily-streak` | 每日全勤 | 连续 7 个本地日完成每日挑战且分数 >0 | 挑战 |
| 16 | `three-star` | 三星收藏家 | 6 场战役全部 3 星 | 挑战 |
| 17 | `spread-tax` | 点差税 | 累计佣金 + 负 swap ≥$500 | 交易 |
| 18 | `calm` | 冷静的人 | 单局 ≥10 笔平仓、最大回撤 ≤5%、净盈利 >0 | 风险 |

**实现注意**：

- “连续 10 笔设止损”：按平仓顺序，检查每笔开仓时 `sl != null`；中间任何一笔无 SL 重置计数。
- “追高艺术家”：只对做多；对比当前显示周期最近 40 根（含当前）的高点；回放按 40 个交易日。
- “负资产”：NBP 吸收额 >0 即解锁；硬核模式 P1 不做。
- “卖在底部”：2020 战役中，开仓时间在 2020-03-19 之后、方向为空、平仓亏损。
- “不追多”：2022 战役中，任何多头开仓价 >150 即失败；通关时解锁。
- “瑞郎幸存者”：只要 2015 结算时满足生存者条件（期末 ≥$9,000、事件日亏损 <5%）即解锁，不要求最终按生存者轨道计分。
- “降杠杆大师”：2024-08-02 收盘时 `used/equity <= 0.35`，且最终通关。
- “历史学家”：`pair|start|end` 去重；完成结算且 alpha>0 计数。
- “冷静的人”：单局（sim/replay/battle/challenge 任一）内统计，重置。

### 9.2 统计

每模式独立 + 全局汇总。成交记录字段：

```
{ id, mode, pair, side, lots, entry, exit, pnl, commission, swap,
  openedAt, closedAt, sl, tp, reason: 'manual'|'sl'|'tp'|'liq', entrySlSet, riskPct }
```

指标：

| 指标 | 公式 |
|---|---|
| 胜率 | 盈利平仓笔数 / 总平仓笔数 |
| 平均盈利/亏损 | 盈利总额/盈利笔数；亏损总额/亏损笔数 |
| 盈亏比 | 平均盈利 / 平均亏损 |
| 盈利因子 | 总盈利 / 总亏损 |
| 期望值 | 胜率×平均盈利 − 败率×平均亏损 |
| 最大回撤 | 权益轨迹峰值到谷值的最大百分比 |
| 最长连赢/连亏 | 按平仓顺序 |
| 平均持仓时长 | 游戏小时/日 |
| 成本比 | (佣金 + 负 swap) / 毛利润 |
| 事件交易胜率 | 新闻发布前后 1 个交易日内开仓的胜率 |
| 纪律分 | 设止损占比×0.5 + 单笔风险≤2%权益占比×0.5 |
| 账户体检 | S/A/B/C/D |

体检阈值：

- S：胜率 ≥55%、盈利因子 ≥2.0、最大回撤 ≤10%、纪律分 ≥80
- A：盈利因子 ≥1.5、最大回撤 ≤20%、纪律分 ≥60
- B：盈利因子 ≥1.1、最大回撤 ≤35%
- C：盈利因子 ≥0.8
- D：其余

面板首屏只显示 6 个核心数字：净收益、胜率、盈亏比、最大回撤、交易笔数、体检；其余折叠。权益曲线用 Canvas 迷你图 320×160；账户条 mini sparkline 120×36（P0 可只做统计弹窗图）。

---

## 10. 存档、容错与迁移

### 10.1 存档键（统一前缀 `kurumi-fx:`，使用 `FX.U.store`）

| 键 | 内容 |
|---|---|
| `settings:v1` | 主题、涨跌配色、新闻频率、教程已看、免责声明已看 |
| `profile:v1` | 昵称、创建时间 |
| `sim:v1` | 时间、种子、锚点、价格、K 线、账户、订单、新闻、峰值 |
| `replay:v1` | 对、区间、游标、账户、订单、最佳 alpha |
| `battle:v1` | 当前战役、账户、游标、订单、最佳星级/分数 |
| `challenge:v1` | 日期、词条、种子、剩余次数、进行中状态、最佳分 |
| `daily:v1` | 本地榜（3 档案、今天、30 天冠军） |
| `achv:v1` | 已解锁成就与时间 |
| `stats:v1` | 各模式统计与全局统计 |
| `intro:v1` | 首启流程标记（可选，合并进 settings） |

### 10.2 读写规则

- 所有 `get` 包 try/catch；失败返回默认值，并 Toast“存档损坏，已使用默认设置”。
- 每个存档有 `v:1`；未知版本：丢弃该模式存档，保留成就/设置，提示一次。
- `normalizeAccount()` 必须补齐缺失字段，禁止 `undefined/NaN` 进入计算。载入后必须由 `positions` 重算 `used/equity`，不信任存档里的派生值；每个持仓的 `marginUSD` 用开仓时记录固定。

```js
function normalizeAccount(a) {
  return {
    balance: num(a.balance, 10000),
    positions: Array.isArray(a.positions) ? a.positions.filter(validPos).map(normPos) : [],
    orders: Array.isArray(a.orders) ? a.orders.filter(validOrder) : [],
    history: Array.isArray(a.history) ? a.history.slice(0, 25) : [],
    leverage: clamp(num(a.leverage, 100), 30, 500),
    used: 0,                         // 载入后由 positions 重算，不读存档
    marginCallShown: !!a.marginCallShown,
    nbpAbsorbed: num(a.nbpAbsorbed, 0),
    equityPeak: num(a.equityPeak, 10000),
    equityTrail: Array.isArray(a.equityTrail) ? a.equityTrail.slice(-600) : []
  };
}
```

每个持仓必须含 `{pair, side, lots, entry, marginUSD, sl, tp, openedAt, slSet}`；缺字段的持仓直接丢弃并记一条 Toast，禁止半残持仓进入引擎。

### 10.3 自动保存

- 每次开仓/平仓/改单/设 SL/TP：立即保存（300ms 防抖）。
- 模拟：每 6 tick（30 游戏分钟）保存一次。
- 页面 `visibilitychange` 隐藏、`pagehide`、`beforeunload`：同步保存。
- 挑战/战役：每次推进日/结算后保存；进行中的状态必须可恢复。
- 存档体积控制：模拟 K 线最多 500 根；权益轨迹最多 600 点；历史最多 25 条；超出截断。

### 10.4 时间与日期

- 行情/时钟/换日一律 UTC；`U.dateISO`/`U.parseISO` 用于本地日期显示与挑战日期键。
- 挑战 `dayKey` 用本地日期；市场种子与 `dayKey`/词条绑定，不用 UTC 日期，避免跨时区当天不一致。
- 历史数据日期为字符串，按 `U.parseISO` 转本地日期仅用于显示；索引用字符串数组 `indexOf`。

### 10.5 导出 / 导入

- 导出格式：`{ magic:'abyss-fx-save', v:1, app:'abyss-fx', exportedAt, data:{ <去掉前缀的键>: <值> } }`。
- 导出前先执行一次 `save()`，确保包含内存中的最新状态；导入校验 magic/版本/已知字段类型后，二次确认再覆盖全部前缀键并刷新。
- 导入写入失败时回滚到导入前状态；`beforeunload` 自动保存通过 `_skipSave` 短路，避免覆盖刚导入的存档。
- 浏览器用 `<a download>` / `<input type=file>`；Windows 壳走 `_saveText` 绑定；Android 壳走 `AbyssNative.saveText` 与 `pickText`。

---

## 11. 实现里程碑与验收标准

> 每个里程碑结束必须能独立打开页面进行验收；未通过不得进入下一项。预计总工作量 1 个长会话；若时间不足，按 P0 列表砍 P1，不得砍验收项。

### M1 骨架 / 设计系统（S）

交付：`index.html`、`tokens.css`、`layout.css`、`components.css`、`util.js` 接入、主题切换。

验收：

- `file://` 打开无报错；无任何外部请求。
- 1440px 三栏 240/1fr/340；1080px 两列；720px 单列；320px 无横向滚动。
- 日/夜主题切换全部颜色变化；红涨绿跌/绿涨红跌切换只交换行情色。
- 字体为系统栈；图标为内联 SVG；无 emoji 功能图标。

### M2 市场 / 报价 / 图表（M）

交付：`meta.js`、`clock.js`、`market.js`、`series.js`、`chart.js`。

验收：

- 9 对报价连续更新；6 直盘由因子模型生成；3 交叉盘与直盘三角一致（误差 <0.01%）。
- 连续 1000 tick：EURUSD 与 GBPUSD 同向比例 >55%；EURUSD 与 USDCHF 同向比例 <45%（方向合理即可）。
- 点差随时段变化：21:00 UTC 明显扩大；周末休市；周日开盘缺口。
- 5m→15m/1h/4h/1d 聚合 OHLC 不变量全部成立。
- 图表显示 54–70 根；MA/十字光标/OHLC 提示可用；DPR 清晰。

### M3 交易引擎（L）

交付：`trade.js`、`engine.js`、`ticket.js`、`panels.js` 的持仓/挂单/成交。

验收（精确）：

- 0.10 手 EURUSD @1.11330、100×：名义 $11,133.00；保证金 $111.33；佣金 $0.35；开仓浮动 −$0.60（点差）。
- 1 手 EURUSD 多单每夜 swap −$5.34；周三 −$16.02；空单 +$2.29。
- 1 手 USDJPY @158.059、0.7 pip 点差：pip 值 $6.327；名义 $100,000；100× 保证金 $1,000。
- 追加保证金在 <100% 提示一次；<50% 强平；强平后余额 <0 由 NBP 归零并记录。
- SL 与 TP 同 bar 触发按 SL；跳空按开盘价；限价单只接受限价或更好。
- 部分平仓、一键全平、挂单 7 日过期、撤单正确。
- 所有资金无 NaN；余额/权益/已用/可用/保证金水平在 UI 同步。

### M4 模拟模式（M）

交付：`sim.js`、新闻日历/快讯、模拟存档。

验收：

- 默认从 2026-10-30 开始；9 对可交易；速度 0.5/1/2/4×；暂停恢复。
- 每日 2–6 条新闻；事件后点差扩大、价格跳变；新闻中心显示最近 40 条。
- 刷新页面恢复价格、K 线、持仓、订单、时间；不重复计息。
- 重置需确认；成就/统计保留。

### M5 回放 + 战役（L）

交付：`replay.js`、`battle.js`、`battles.js`、评分/星级/事件路径。

验收：

- 6 场战役窗口全部能在数据中定位；首末日存在；事件日收盘与本文一致。
- 2015-01-15 EURCHF 路径在 09:30 从 1.201 跳至 0.88，日收盘 1.028；0.5 手多单产生约 −$1.8 万 NBP；UI 标注“盘中估算”。
- 2016-06-24 GBPUSD 00:00 从 1.4869 跳至 1.32，日收盘 1.3704。
- 2022-09-22 USDJPY 08:00 从 145.9 跳至 140.3，日收盘 140.813。
- 2024-08-05 USDJPY 01:00 从 148.9 跳至 142.2，日收盘 142.240。
- 日频决策无前视：玩家只能看到已完成的日线；市价按当前收盘报价，挂单下一日触发。
- 评分公式示例：2016 收益 15%、回撤 10%、E=+1、8 笔/上限 10 → 86.11 分、3 星。
- 通关/星级/最佳保存；重试重置；中途离开可恢复。

### M6 每日挑战（M）

交付：`challenge.js`、词条、种子、本地榜。

验收：

- 同一天同一词条，两次开始的前 10 tick 价格完全一致；刷新后一致。
- 3 次机会正确扣减；日期变化重置；进行中状态恢复。
- 评分示例 1351 分；铜/银/金目标线正确；爆仓/0 交易不上榜。
- 3 个本地档案、今日前 10、30 天冠军、速通标记。
- 挑战中杠杆仅 30×；最多 3 笔；单笔/总保证金上限生效。

### M7 成就 / 统计 / 教程 / 设置（M）

交付：`progress.js`、`modals.js`、`state.js` 完整。

验收：

- 18 条成就均可通过对应操作触发；成就册显示未解锁提示/解锁日期。
- 统计 10 项在平仓后更新；最大回撤/连赢连亏/体检正确。
- 5 页教程可跳过、可重看；首次追保弹 3 步教学；免责声明首启必现。
- 设置：主题、涨跌色、新闻频率、清除存档；刷新保留。
- 清档二次确认；清档后成就/统计按定义处理（P0：清全部，提示明确）。

### M8 硬化 / 验收（M）

- 断网/`file://` 打开：Network 面板零外部请求。
- localStorage 写入损坏 JSON：不白屏，默认值 + 提示。
- 320px、200% 缩放、键盘 Tab/Esc/焦点陷阱、`prefers-reduced-motion` 通过。
- 所有危险操作有后果说明与动词按钮。
- 无 console error；无未捕获 Promise；无 NaN 显示。
- 用 Playwright（已安装的 `playwright-core`）做冒烟：打开页面 → 开仓 → 平仓 → 推进一日 → 刷新恢复。

---

## 12. 数字自洽核对表

施工时逐项打勾；任何一项不一致必须改代码或改本表，不能两套口径。

| # | 检查 | 期望 |
|---|---|---|
| 1 | 初始资金四模式 | 均为 $10,000 |
| 2 | 标准手 | 100,000 |
| 3 | 手数 | 0.01–10，步长 0.01 |
| 4 | 杠杆 | 模拟 30/100/200/500；战役/挑战 30；回放 ≤100 |
| 5 | 保证金 | 名义/杠杆，开仓固定 |
| 6 | 追保 | 保证金水平 100%，只提示 |
| 7 | 强平 | 50%，账户级，缓冲 55% |
| 8 | NBP | 默认开，余额负→0 并记录 |
| 9 | 佣金 | max($0.10, $3.50×手数)/边 |
| 10 | 点差 | 基准表 + 时段 + 新闻 + 周末；下限 0.3 |
| 11 | pip 值 | 按报价币换算，JPY 对 0.01 |
| 12 | 盈亏 | 报价币现金流换算 USD，不用固定点值 |
| 13 | swap | 利率差 −0.5%，周三×3，21:00 UTC |
| 14 | 利率 | USD 4.00 / EUR 2.75 / GBP 4.00 / JPY 0.50 / CHF 0.50 / AUD 3.60 / CAD 2.75 |
| 15 | EURUSD 0.10 手 100× | margin 111.33；commission 0.35；浮动 −0.60 |
| 16 | EURUSD 1 手多 swap | −5.34/夜；周三 −16.02 |
| 17 | MAX 30× | 2.56 手；margin 9,500；强平约 205 pip |
| 18 | MAX 100× | 8.53 手；margin 9,496.45；强平约 62 pip |
| 19 | 挑战 | 10 日、288 tick/日、200ms、30×、3 仓、40%/70% |
| 20 | 挑战评分示例 | 1351 |
| 21 | 战役评分示例 | 2016：86.11 分 / 3 星 |
| 22 | 战役窗口 | 6 个全部在 1999-01-04–2026-10-29 |
| 23 | 事件日收盘 | 2008 105.908；2015 1.02800；2016 1.37040；2020 0.58017；2022 140.81344；2024 142.23965 |
| 24 | 事件锚点 | 2015 0.88；2016 1.32；2022 140.3；2024 142.2（均标注估算） |
| 25 | 成就 | 18 条，全部可触发 |
| 26 | 统计 | 10 项 + 体检 S/A/B/C/D |
| 27 | 存档 | 分模式、v1、损坏回退 |
| 28 | 外部请求 | 0 |
| 29 | 窄屏 | 320px 无横向滚动 |
| 30 | 主题 | 日/夜 + 红涨绿跌/绿涨红跌 |

---

## 13. 明确砍掉 / 降级项

### 13.1 从四份文档中砍掉（P1/P2）

| 项 | 处理 | 原因 |
|---|---|---|
| 生涯模式、工资/房租/月结单、破产/还债/转世 | P2 砍 | P0 范围爆炸；叙事由战役承担 |
| 贷款/周转小金库、信用分、催收 | P1 砍 | 与 NBP/强平模型叠加会产生规则冲突；P0 无贷款 |
| 等级/XP/执照/解锁 | P2 砍 | 不影响核心交易闭环；成就替代长期目标 |
| 角色消息（经纪人/家人/对手 K）、订单流三表、情绪指标 | P1 | 叙事增强，非核心 |
| 事件日盘中手动交易（1.5s/根） | P1 | 单次会话最大风险点；日频决策已能教“仓位决定生死” |
| 1 分钟 K 线、成交量、缩放平移、画线、价格提醒 | P1 | 5m 基础足够；Canvas 复杂度可控 |
| 移动止损、追踪止损、OCO 高级单、冰山单 | P1 | SL/TP/挂单已覆盖 P0 |
| 自定义回放起止日期 | P1 | 30/90/180/365 预设足够 |
| 图片分享卡（1080×1440）、二维码 | P1 | 文本分享足够；Canvas 分享卡是锦上添花 |
| 音效/音乐、本地音频导入 | P1 | 硬约束不要求；避免额外复杂度 |
| 云存档、B 站 SDK、关注作者、AI 工具 | P2 | 脱离平台也要能跑；本地榜已满足 |
| 全球排行榜 | 已实现（可选） | 默认关闭；配置 Workers + D1 后启用，失败不影响单机；见 7.4 |
| 2011 瑞郎设限、2022 英国迷你预算 | P1 战役 | P0 6 场已覆盖需求；数据已具备 |
| 战役星数解锁 | P1 | P0 全部开放，方便验收 |
| 多币种账户、真实网络行情、机构滑点/订单簿/延迟 | P2 | 与“纯静态、离线”冲突 |
| 每日 8 词条中的 4 个（央行日/单边趋势/风险厌恶/反转日） | P1 | P0 4 个词条足够展示机制 |
| 24 条成就 | P0 18 条 | 去掉依赖贷款/生涯/B 站的成就 |

### 13.2 降级而非删除

| 原设计 | P0 降级 |
|---|---|
| 1 分钟 tick | 5 分钟 tick；所有逻辑按 5m 结算 |
| 战役事件日交互式盘中交易 | 事件日自动播放 + 日频决策 |
| 每日挑战 30 分钟 K × 48 根 | 5m tick × 288 根/日；图表可显示 30m，但引擎 5m |
| 历史 intraday 真实高低 | 合成布朗桥；UI 标注“盘中估算” |
| 回放任意区间 | 4 个预设区间 |
| 图表成交量 | 删除 |
| 分享卡图片 | 文本摘要 |
| 设置音效 | 删除 |

---

## 14. 易错点与风险清单

1. **强平口径**：必须用账户级 `equity/used`，不是“单仓 80% 浮亏”。不要把 50% 保证金当成可亏金额；见 3.6。
2. **空头估值**：空头浮盈按 ask 估，多头按 bid 估；否则点差成本消失。
3. **保证金固定**：开仓时按 entry 固定，不随价格重估；重估会导致保证金水平错误。
4. **交叉盘换算**：盈亏按报价币现金流 × `ccyToUSD(quote)`；JPY 交叉盘（EURJPY/GBPJPY）的报价币是 JPY，不是 USD。
5. **SL/TP 同 bar**：SL 优先；跳空按开盘/锚点价，不按 SL 价。
6. **周三三倍 swap**：只对 21:00 UTC 换日瞬间仍持仓的仓位；周五 1 倍；周六日不单独计。
7. **前视偏差**：战役/回放只能看到已完成的日线；不能用当日收盘后再按该收盘价成交。市价单在“当前收盘”成交，挂单下一日触发。
8. **三角一致**：交叉盘必须由直盘每 tick 重算；禁止独立随机。
9. **种子确定性**：挑战/战役路径、新闻、日内桥必须用 `FX.U.rng`/`hash`；禁止 `Math.random()`。
10. **日期时区**：行情用 UTC；挑战 `dayKey` 用本地日期；历史显示用 `U.parseISO` 避免 UTC 偏移。
11. **浮点**：资金 `round2`；价格按 digits；手数微手整数；比较加 `1e-9`。
12. **存档 NaN**：所有读档字段必须 `normalize`；缺失字段给默认值；旧版本丢弃而非硬迁移。
13. **Canvas 模糊**：按 DPR 重设分辨率；不要用 CSS 拉伸 canvas；`ResizeObserver` 重绘。
14. **移动端横向滚动**：宽表格/订单票必须内部滚动；页面 body `overflow-x:hidden` 仅作为最后保险，不能依赖它掩盖布局错误。
15. **颜色唯一编码**：涨跌/风险必须有符号/文字/纹理冗余；色盲用户可辨。
16. **挑战爆仓**：0 分，不上榜；0 交易 0 分；不要给“参与奖”上榜。
17. **战役事件锚点**：锚点 `to` 与日收盘必须能同时成立；路径生成后要校验最后一根收盘 = 数据收盘，否则修正最后一段。
18. **性能**：模拟 9 对 × 5m 很轻；挑战 2,880 tick 也很轻；不要每 tick 重建 DOM/整张表；图表用 RAF 合并。
19. **存档体积**：K 线 500 根、权益 600 点、历史 25 条封顶；否则 localStorage 可能超限。
20. **免责声明**：首启、页脚、分享文案三处都要有；不能只在设置里。

---

## 附：P0 完工定义（DoD）

- 打开 `index.html` 或 `python3 -m http.server`，无需构建即可玩。
- 四模式可切换；模拟可开平仓；回放可推进；6 场战役可进入并结算；每日挑战可开始/结算/上榜。
- 订单票所有字段可用；保证金/强平/swap/佣金/点差均按本文数值。
- 图表多周期、均线、持仓线、SL/TP、强平线、十字光标可用。
- 成就 18 条、统计 10 项、存档、教程、双主题、窄屏、免责声明全部可用。
- 第 12 节 30 项自洽检查全部通过；第 11 节 M1–M8 验收全部通过。
- 无外部请求、无 console error、无 NaN、无白屏。

**施工顺序建议**：M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8。任何时刻如果进度落后，优先保证 M2/M3/M5（行情、交易、战役）与第 12 节数字；UI 动效、分享、成就动效可以最后补。
