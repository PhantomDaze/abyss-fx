# 持仓列表显示更多

状态：已完成（2026-10-31）

## 需求
持仓列表高度固定 272px，单张卡片约 106px，同屏只能看到 2 张多，用户希望看到更多。

## 改动
1. `.positions-list` 的 `max-height` 从 `272px` 改为 `70vh`（小屏 62vh），列表仍保留内部滚动，极端数量下不会无限拉长。
2. 宽屏下持仓/挂单改为双列网格：
   ```css
   #positionsList,
   #ordersList {
     display: grid;
     grid-template-columns: repeat(auto-fill, minmax(min(315px, 100%), 1fr));
     align-content: start;
   }
   ```
   - 中栏宽度 ≥ 646px 时自动两列，窄屏/手机保持单列；
   - 空状态 `.empty-state` 用 `grid-column: 1 / -1` 跨满整行；
   - 成交记录列表不受影响，仍是单列紧凑行。
3. 卡片本身尺寸不变，1080p 下 6 张持仓一屏全部可见。

## 验证
- Playwright 1440×900 / 1366×768 / 1272×786 / 1080×720 / 900×700：中栏双列，6 张持仓全部可见；
- 390×844 / 360×640：单列，无横向溢出；
- 空状态占满整行；
- `tools/test-ui.mjs` 冒烟通过，0 console 错误。
- exe 重新构建：`dist/abyss-fx.exe`，sha256 `2f661174c4967df4a4410abd2027f304580f907f5149a30d5bf80cfc4cee5d7c`；
  在 Wine + WebView2 95 下实测双列显示正常。
