# 每日挑战排行榜 Worker

Cloudflare Workers + D1 的极简排行榜后端。前端在 `js/core/leaderboard.js`，**不配置地址时全球榜自动关闭，单机玩法完全不受影响**。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/daily/:dayKey/scores?limit=50&playerId=...` | 今日榜；`playerId` 可选，用于返回自己的名次 |
| `POST` | `/api/daily/:dayKey/scores` | 提交成绩；同一 `playerId` 每天只保留最高分 |
| `GET` | `/api/daily/champions?limit=30` | 近 N 天每日冠军 |
| `GET` | `/api/health` | 健康检查 |

`dayKey` 使用**北京时间（UTC+8）**日期，服务端只接受「今天」或「昨天」，允许跨零点后结算。

提交体：

```json
{
  "playerId": "随机本地 ID",
  "name": "昵称",
  "score": 1351,
  "equity": 11800,
  "dd": 9.1,
  "trades": 14,
  "hits": 2,
  "modId": "high-vol",
  "version": 1
}
```

## 部署

需要 Node.js 与 Cloudflare 账号（免费额度足够）。

```bash
cd workers/leaderboard

# 1. 创建 D1 数据库，记下输出的 database_id
npx wrangler d1 create abyss-fx-leaderboard

# 2. 把 database_id 填进 wrangler.toml

# 3. 建表
npx wrangler d1 execute abyss-fx-leaderboard --file schema.sql --remote

# 4. 部署
npx wrangler deploy
```

部署后把输出的地址（如 `https://abyss-fx-leaderboard.<account>.workers.dev`）填到 `js/core/leaderboard.js` 的 `DEFAULT_API` 常量。也可以不改代码，在浏览器控制台执行：

```js
FX.Leaderboard.configure('https://abyss-fx-leaderboard.<account>.workers.dev')
```

（该地址会写入 localStorage，仅对当前浏览器生效。）

## 本地开发

```bash
cd workers/leaderboard
npx wrangler dev
# 默认 http://127.0.0.1:8787
```

前端测试时用 `window.FX_LEADERBOARD_API = 'http://127.0.0.1:8787'` 覆盖地址。

## 测试

```bash
cd workers/leaderboard
npm test        # node --test test/worker.test.mjs
```

测试使用内存假 D1，覆盖字段校验、最高分保留、排序、名次与冠军聚合，不需要真实 Cloudflare 环境。

## 说明与边界

- **基础校验，不防伪造**：分数由客户端上报，只校验日期、字段与数值范围。这是休闲榜；不要把它当作可信竞技排名。
- **CORS**：允许任意来源（无凭证、公开数据）。如需限制，可把 `Access-Control-Allow-Origin` 改为 GitHub Pages 域名。
- **数据清理**（可选）：表按「玩家 × 天数」增长，可定期删除 90 天前的数据：

  ```bash
  npx wrangler d1 execute abyss-fx-leaderboard --remote \
    --command "DELETE FROM scores WHERE day_key < date('now','-90 day')"
  ```

- **隐私**：昵称与成绩会公开显示在榜单上；前端在首次提交前会提示。
