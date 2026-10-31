# 风险席遮挡交易按钮修复

状态：已完成（2026-10-31）

## 现象
桌面/笔记本宽度下，页面滚动后「风险席」面板浮在下单票上方，盖住做多/做空按钮，导致无法点击。

## 原因
- 右栏 `.right-column` 是普通 flex 列，下单票 `.order-ticket` 单独设置了 `position: sticky` + `max-height` + `overflow-y: auto`；
- 风险席是它后面的兄弟节点，`position: relative` 且 DOM 顺序在后，滚动时会上移并盖在吸顶的下单票之上（后出现的定位元素绘制在上层）；
- 另外 `@media (max-width: 1199px)` 里残留了一条 `.order-ticket { top: ... }`，在取消 sticky 后变成 relative 偏移，把下单票整体下移 148px，和风险席在布局上直接重叠。

## 修复
1. 右栏整体改为吸顶滚动容器：
   - `.right-column { position: sticky; top: calc(topbar+account+gap); align-self: start; max-height: calc(100dvh - ...); overflow-y: auto; overscroll-behavior: contain; }`
   - `.order-ticket` 取消 sticky / max-height / overflow，交给右栏滚动。
2. 删除 `max-width: 1199px` 中残留的 `.order-ticket { top: ... }`。
3. `max-width: 1079px` 的单列布局中重置右栏 `max-height: none; overflow: visible`，保持手机端原有行为。

## 验证
- Playwright 覆盖 1440×960 / 1440×720 / 1366×768 / 1280×800 / 1200×700 / 1100×700 / 1080×720 / 1000×700 / 820×1180 / 430×932 / 390×844 / 360×640：
  - 下单票与风险席间距恢复为 12/16px，无负间距；
  - 滚动后做多按钮 `elementFromPoint` 命中 BUTTON，不再命中风险席；
  - 风险席可完整滚到可视区域。
- `tools/test-ui.mjs` 全流程冒烟通过，0 console 错误。
