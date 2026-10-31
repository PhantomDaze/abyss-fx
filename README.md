# 深渊汇率 / ABYSS FX

一款纯静态、可离线运行的外汇保证金模拟交易游戏。参考 B 站小玩具《FX 简单!》的玩法，但把“真实交易的成本结构”和“历史危机的情景压力”做成了核心：

- **点差、手续费、隔夜利息（周三三倍）**：开仓即亏一个点差。
- **手数 / 保证金 / 保证金水平**：1 手 = 100,000 基础货币；保证金开仓时固定；保证金水平低于 100% 追保、低于 50% 账户级强平。
- **挂单与止损**：市价 / 限价 / 止损挂单，SL / TP / 追踪止损、部分平仓、一键全平。
- **合成行情**：货币因子模型，9 个货币对（6 直盘 + 3 交叉盘），时段波动/点差曲线，财经日历与新闻冲击，周末缺口。
- **真实历史回放**：内置欧洲央行 1999–2026 日度参考汇率，7 场经典战役（2008 雷曼、2011 瑞郎设限、2015 瑞郎脱钩、2016 脱欧、2020 疫情、2022 日元干预、2024 套息拆仓）。
- **每日挑战**：日期种子、每日词条、3 次机会、铜/银/金目标线、本地榜单。
- **成就 / 统计 / 分享卡 / 教程 / Claude 风格暖纸主题（浅色 + 深色）/ 红涨绿跌切换 / 窄屏适配**。

> 模拟交易游戏，不构成投资建议。历史数据为 ECB 日度参考价，盘中高低点为估算，不代表真实可成交价格。

在线试玩：<https://phantomdaze.github.io/abyss-fx/>

## 运行

直接双击 `index.html` 即可（无构建、无外部依赖、无网络请求）。

也可以：

```bash
git clone https://github.com/PhantomDaze/abyss-fx.git
cd abyss-fx
python3 -m http.server 8080
# 打开 http://localhost:8080
```

## Windows 单文件 exe

项目自带一个 Go + WebView2 桌面壳，可打包成单个 exe（前端资源全部内嵌）：

```bash
bash tools/build-exe.sh
# 输出 dist/abyss-fx.exe（约 8 MB）
```

也可以直接从 [GitHub Releases](https://github.com/PhantomDaze/abyss-fx/releases/latest) 下载。

双击即可运行，无需安装、无需联网。需要 Microsoft Edge WebView2 Runtime（Windows 11 自带；Windows 10 通常已随 Edge 安装，缺失时程序会提示下载地址）。首次运行会在 `%LOCALAPPDATA%\AbyssFX` 保存 WebView2 配置与存档；分享卡保存到 `图片\AbyssFX`。exe 未签名，首次打开可能触发 SmartScreen 提示。

## Android APK

项目自带一个原生 WebView 壳，可离线打包：

```bash
bash tools/build-apk.sh
# 输出 dist/abyss-fx-1.0.apk
adb install -r dist/abyss-fx-1.0.apk
```

需要 Android SDK（platform 34 + build-tools 36.1.0）与 JDK 17+；不需要 Gradle。详情见 `android/README.md`。

## 数据

- `js/data/history.js` 由 `tools/build-history.mjs` 从 [Frankfurter](https://frankfurter.dev/)（欧洲央行参考汇率）生成，覆盖 1999-01-04 → 2026-10-29，9 个货币对，整数 ×1e5。
- 重新生成：

```bash
curl -s "https://api.frankfurter.dev/v1/1999-01-01..2026-10-30?base=EUR&symbols=USD,GBP,JPY,CHF,AUD,CAD" -o tools/ecb-raw.json
node tools/build-history.mjs
```

## 目录

```
index.html                 页面骨架与脚本顺序
css/tokens.css             设计变量（日/夜主题、涨跌配色）
css/app.css                布局、组件、动效、响应式
js/core/util.js            工具与事件总线
js/core/pairs.js           货币对、pip/名义/保证金/隔夜利息换算
js/core/market.js          合成市场（因子模型）与历史回放市场
js/core/account.js         手数、点差、佣金、保证金、挂单、强平
js/core/game.js            模式、时钟、挑战/战役、成就、存档
js/data/history.js         ECB 历史数据（生成文件）
js/data/scenarios.js       7 场经典战役剧本
js/data/achievements.js    20 条成就
js/ui/chart.js             Canvas K 线图
js/ui/ui.js                渲染、弹窗、教程、交互
js/ui/audio.js             WebAudio 合成音效
js/ui/share.js             Canvas 分享卡
js/main.js                 启动
desktop/main.go            Windows 桌面壳（Go + WebView2）
tools/build-exe.sh         Windows 单文件 exe 构建脚本
```

## 玩法要点

- 右侧下单票设置手数、杠杆、止损/止盈（以 pip 计）、追踪止损；市价/限价/止损挂单。
- 杠杆越高，保证金越少，但距强平越近。默认杠杆 1:100；战役与挑战有额外限制。
- 模拟行情默认 1× ≈ 28.8 秒/游戏日，图表右上角可切换 0.25× / 0.5× / 1× / 2× / 4×。
- 历史回放/战役：点击“下一交易日”或“自动播放”；日 K 由 ECB 收盘价 + 合成日内路径构成，事件日会触发盘中极值。
- 每日挑战每天 3 次；同一天共用种子与词条，取最高分。

## 已知边界

- 历史数据是日度收盘价，盘中高低点为估算；事件日跳空按“估算极值”结算，不是逐笔报价。
- 战役/挑战的进度会随存档自动续存；结算后不再恢复。挑战进行中刷新页面会回到同一场（同种子、同词条）。
- 历史回放的进度不持久化，刷新后会回到模拟行情；战役/挑战会恢复。
- 行情内部统一按 UTC 日界运行；界面时间显示为 UTC，不是本地时区。
- 没有真实网络行情；所有模拟行情都在本地生成。
- 这是游戏，不构成投资建议，也不模拟真实经纪商的成交延迟、重新报价与部分成交。
