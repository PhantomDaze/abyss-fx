# 排行榜负分与首次昵称修复

状态：已完成（2026-11-01，代码与本地验证；线上生效待部署 Worker）

## 问题

线上 `/api/health` 正常，但今日榜 `total=0`、历史冠军为空，生产库没有任何成绩。排查发现成绩在客户端就被静默丢弃：

- 负分/0 分被双重过滤：客户端 `js/ui/ui.js:1353` 要求 `score > 0`；Worker `workers/leaderboard/src/index.js:69` 要求 `score >= 1`。而挑战评分公式 `js/core/game.js:545` 打亏一局基本必为负分。
- 首次没有昵称时，自动提交在 `js/ui/ui.js:1354` 直接 `return`，且不写入待提交队列；玩家不手动点结算页的「全球榜」去设昵称，成绩就只留在本地。
- 手动「全球榜」路径下负分仍会发给 Worker，被拒后 `_submitPendingLb` 把它无限重新入队，界面只显示笼统的「提交失败」。

## 决策（用户确认）

- 允许负分与 0 分上榜，按分数排序（负分排在正分之后）。
- 首次没有昵称时，把成绩存入待提交队列，设置昵称后自动补交。

## 改动

- [x] Worker：`score` 校验放宽为 `[-1000000, 1000000]` 内的整数。
- [x] Worker 测试：更新 `score: 0` 断言，新增负分、越界、小数、负分上榜排序断言。
- [x] `js/core/leaderboard.js`：`submit` 无昵称时入队并返回 `needName`；`flushPending` 用当前昵称补全 payload；仅对可重试错误（离线/超时/5xx）入队，永久 4xx 不入队/从队列移除；提交时夹取 `equity >= 0`、`dd` 到 `0~100`。
- [x] `js/ui/ui.js`：自动提交允许负分；无昵称提示改为「已暂存」；设置昵称后 flush 队列；`_submitPendingLb` 区分可重试/永久错误并显示服务端原因。
- [x] `README.md`：同步行为说明（负分可上榜、未设昵称暂存补交、默认已指向线上 Worker）。
- [x] `index.html`：缓存版本号 bump 到 `20261101b`。
- [x] `tools/test-leaderboard.mjs`：新增客户端单测（负分、无昵称暂存、补交、4xx/5xx 队列策略）。
- [x] `package.json`：`npm test` 改为同时跑客户端与 Worker 单测。

## 验证

```bash
npm test                      # 12 项全部通过
node tools/build-web.mjs      # 构建 dist/web 成功
python3 -m http.server 8099   # 终端 A
node tools/test-ui.mjs        # 终端 B：浏览器冒烟无 errors
```

## 待办 / 搁置

- 线上生效需部署 Worker：`cd workers/leaderboard && npx wrangler deploy`；Web 端需重新 `node tools/build-web.mjs` 并发布 `dist/web`。
