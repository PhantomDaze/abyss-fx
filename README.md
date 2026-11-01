# 深渊汇率 / ABYSS FX

一款纯静态、可离线运行的外汇保证金模拟交易游戏。参考 B 站小玩具《FX 简单!》的玩法，但把“真实交易的成本结构”和“历史危机的情景压力”做成了核心：

- **点差、手续费、隔夜利息（周三三倍）**：开仓即亏一个点差。
- **手数 / 保证金 / 保证金水平**：1 手 = 100,000 基础货币；保证金开仓时固定；保证金水平低于 100% 追保、低于 50% 账户级强平。
- **挂单与止损**：市价 / 限价 / 止损挂单，SL / TP / 追踪止损、部分平仓、一键全平。
- **合成行情**：货币因子模型，9 个货币对（6 直盘 + 3 交叉盘），时段波动/点差曲线，财经日历与新闻冲击，周末缺口。
- **真实历史回放**：内置欧洲央行 1999–2026 日度参考汇率，7 场经典战役（2008 雷曼、2011 瑞郎设限、2015 瑞郎脱钩、2016 脱欧、2020 疫情、2022 日元干预、2024 套息拆仓）。
- **每日挑战**：日期种子、每日词条、3 次机会、铜/银/金目标线、本地榜单；可选全球榜。
- **成就 / 统计 / 分享卡 / 教程 / Claude 风格暖纸主题（浅色 + 深色）/ 红涨绿跌切换 / 窄屏适配**。
- **久留美彩蛋**：图表右上角的久留美头像，点击弹出浮动卡片并播放《FX 战士久留美》台词「老实赚钱，很枯燥吧」。语音随项目打包，图片走图床。

> 模拟交易游戏，不构成投资建议。历史数据为 ECB 日度参考价，盘中高低点为估算，不代表真实可成交价格。

在线试玩：<https://phantomdaze.github.io/abyss-fx/>

## 运行

直接双击 `index.html` 即可（无构建；久留美彩蛋图片从图床加载，其余无外部依赖；启动时不发起网络请求，全球排行榜为可选功能）。

也可以：

```bash
git clone https://github.com/PhantomDaze/abyss-fx.git
cd abyss-fx
python3 -m http.server 8080
# 打开 http://localhost:8080
```

## Web 部署（Cloudflare Pages / GitHub Pages）

源码和实际发布的文件是分开的。发布前运行：

```bash
npm run build:web
```

会生成 `dist/web/`，只包含运行时需要的文件：

```
dist/web/index.html          页面骨架（已改为引用 bundle）
dist/web/css/app.bundle.css  合并后的样式
dist/web/js/app.bundle.js    合并后的脚本
dist/web/_headers            Cloudflare Pages 缓存头
dist/web/.nojekyll           GitHub Pages 兼容文件
```

首屏只有 **3 个请求**（HTML + 1 个 CSS + 1 个 JS），源文件仍保留在根目录的 `index.html`、`css/`、`js/`，`dist/` 已被 `.gitignore` 忽略。

### Cloudflare Pages（推荐）

仓库已和 Cloudflare Pages 绑定，在 Pages 项目设置里填：

| 设置项 | 值 |
|---|---|
| 构建命令（Build command） | `npm run build:web` |
| 输出目录（Build output directory） | `dist/web` |
| 根目录（Root directory） | `/`（默认） |

之后推送到 `main` 即自动构建发布。`_headers` 会让带 `?v=` 的静态资源强缓存，HTML 每次校验更新。

### GitHub Pages

仓库包含 `.github/workflows/deploy-pages.yml`，推送 `main` 后自动构建 `dist/web` 并发布。首次使用需要在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**（如果仍是 “Deploy from a branch”，请切换；否则仍会发布未合并的源码根目录）。

本地预览构建产物：

```bash
npm run build:web
python3 -m http.server 8099 --directory dist/web
# 打开 http://127.0.0.1:8099/
```

> 开发时仍可直接打开根目录的 `index.html`；它引用的是未合并的源码文件，便于调试。

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

## 每日挑战全球排行榜（可选）

默认指向已部署的线上 Worker（`js/core/leaderboard.js` 的 `DEFAULT_API`）。网络失败、未配置或离线时自动降级为本地榜，不影响单机玩法。

- 后端在 `workers/leaderboard/`（Cloudflare Workers + D1），部署步骤见该目录的 `README.md`。
- 部署后把 Worker 地址填进 `js/core/leaderboard.js` 的 `DEFAULT_API`，或运行时执行 `FX.Leaderboard.configure('https://...')`。
- 启用后：每日挑战结算页可把成绩提交到全球榜，查看今日前 50 与近 30 天每日冠军。
- 网络失败、超时、服务器不可达、未配置时，自动降级为本地榜，不弹错误、不影响单机玩法；启动时不发起任何请求。
- 首次提交前需要设置昵称；未设置昵称时成绩先暂存在本地，设置后自动补交。昵称与成绩会提交到排行榜服务器，不提交也能正常玩。
- 负分与 0 分也算有效成绩，按分数从高到低排序（负分排在正分之后）。
- 每日挑战按**北京时间（UTC+8）**切日，全球玩家在同一盘行情里竞争；每天 00:00（北京时间）重置次数与榜单。
- 排行榜请求超时 10 秒，网络失败/超时/5xx 会自动重试一次；有缓存时先显示缓存，再后台刷新。
- 如果一直提示不可用：先直接打开 `https://fxdb.coishi.top/api/health`；再在控制台执行 `FX.Leaderboard.apiBase` 检查地址。若 localStorage 里留有旧地址，执行 `FX.Leaderboard.reset()` 后刷新页面。

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
js/core/saveio.js          存档导出/导入（JSON 备份、校验、覆盖恢复）
js/core/leaderboard.js     可选全球排行榜客户端（默认关闭，失败不影响单机）
js/data/history.js         ECB 历史数据（生成文件）
js/data/scenarios.js       7 场经典战役剧本
js/data/achievements.js    20 条成就
js/ui/chart.js             Canvas K 线图
js/ui/ui.js                渲染、弹窗、教程、交互
js/ui/audio.js             WebAudio 合成音效
js/ui/share.js             Canvas 分享卡
js/main.js                 启动
assets/kurumi.mp3          久留美彩蛋语音（图片走图床，不随项目打包）
desktop/main.go            Windows 桌面壳（Go + WebView2）
tools/build-exe.sh         Windows 单文件 exe 构建脚本
tools/build-web.mjs        Web 发布构建：合并 CSS/JS 到 dist/web
.github/workflows/deploy-pages.yml  GitHub Pages 自动构建发布
workers/leaderboard/       Cloudflare Worker + D1 全球排行榜后端（可选）
```

## 玩法要点

- 右侧下单票设置手数、杠杆、止损/止盈（以 pip 计）、追踪止损；市价/限价/止损挂单。
- 杠杆越高，保证金越少，但距强平越近。默认杠杆 1:100；战役与挑战有额外限制。
- 模拟行情默认 1× ≈ 28.8 秒/游戏日，图表右上角可切换 0.25× / 0.5× / 1× / 2× / 4×。
- 历史回放/战役：点击“下一交易日”或“自动播放”；日 K 由 ECB 收盘价 + 合成日内路径构成，事件日会触发盘中极值。
- 每日挑战每天 3 次；同一天共用种子与词条，取最高分。日切按北京时间（UTC+8）。
- 配置全球排行榜后，可在结算页提交成绩并查看今日榜与历史冠军；未配置时只显示本地榜。
- 设置 → 存档备份：可把全部进度导出为 `.json`（复制文本或保存文件），也可导入备份覆盖当前存档；导入前会二次确认。

## 已知边界

- 历史数据是日度收盘价，盘中高低点为估算；事件日跳空按“估算极值”结算，不是逐笔报价。
- 战役/挑战的进度会随存档自动续存；结算后不再恢复。挑战进行中刷新页面会回到同一场（同种子、同词条）。
- 历史回放的进度不持久化，刷新后会回到模拟行情；战役/挑战会恢复。
- 行情内部统一按 UTC 日界运行；界面时间显示为 UTC，不是本地时区。
- 没有真实网络行情；所有模拟行情都在本地生成。
- 久留美头像与卡片图片来自图床，首次显示需联网；图床不可用时回退为文字卡片，语音与玩法不受影响。图床链接带日期目录，长期部署建议换成稳定地址。
- 全球排行榜是可选功能；未配置或网络不可用时，游戏完全离线，所有玩法不受影响。
- 排行榜分数由客户端上报，只做基础校验，不保证防伪造；适合休闲比较，不作为可信竞技排名。
- 每日挑战日切从本地日期改为北京时间后，更新当天可能重置一次挑战次数与进行中的进度。
- 这是游戏，不构成投资建议，也不模拟真实经纪商的成交延迟、重新报价与部分成交。
