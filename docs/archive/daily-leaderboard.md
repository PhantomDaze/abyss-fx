# 每日挑战全球排行榜（可选联机）

状态：已完成（2026-10-31）

## 目标

在保持单机完全可玩的前提下，为每日挑战增加可选的全球排行榜：

- 今日全球榜（前 50）与近 30 天每日冠军。
- 昵称 + 本地随机 playerId；同一玩家每天只保留最高分。
- 网络完全可选：启动不请求；结算/看榜时才尝试；失败静默降级为本地榜。
- 后端：Cloudflare Workers + D1；基础校验，不做服务端重放。

## 关键改动

- [x] `js/core/util.js`：新增 `U.dateKeyCST`（北京时间日期键）与 `U.esc`（HTML 转义）。
- [x] `js/core/game.js`：`dailyKey()` 与连续挑战「昨天」改为 UTC+8。
- [x] `js/core/leaderboard.js`：网络客户端（身份、submit/top/champions、超时、降级、待提交队列、缓存）。
- [x] `js/ui/ui.js`：结算/挑战弹窗增加全球榜入口；排行榜弹窗、昵称、加载/离线状态。
- [x] `css/extra.css`：排行榜样式。
- [x] `index.html`：脚本标签与缓存版本号。
- [x] `workers/leaderboard/`：Worker、D1 schema、部署说明、单元测试。
- [x] `tools/test-ui.mjs`：模拟网络成功/失败，验证降级。
- [x] `README.md` / `docs/SPEC.md`：部署与行为说明。

## 验证

```bash
python3 -m http.server 8099   # 终端 A
node tools/test-ui.mjs        # 终端 B
node --test workers/leaderboard/test/worker.test.mjs
```

## 待办 / 搁置

- 服务端重放校验（防伪造分数）——本轮不做，README 明示。
- 周/月汇总榜、好友榜、敏感词过滤——后续按需。
- 部署 Worker 后需把 `js/core/leaderboard.js` 的 `DEFAULT_API` 填成实际地址。
