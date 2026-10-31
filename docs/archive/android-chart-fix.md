# Android 图表不显示排查与修复

状态：已放弃（2026-10-31，用户决定不再维护安卓版）

## 现象
用户在 Android APK 中反馈"股票图看不了"：K 线图区域不可见/空白，浏览器版正常。

## 已排查
- 图表仅用标准 Canvas 2D API，无 `roundRect` 等新接口；`ResizeObserver` 有特性检测。
- JS 中唯一的新语法 `??`（`js/core/market.js` 回填 tick 参数）已替换为兼容写法。
- CSS 中 `.chart-wrap` 唯一使用 `clamp()` 的地方是高度；旧 WebView 不支持时高度塌陷为 0，
  而 `_syncSize()` 在 0 尺寸时直接返回，图表永远不会绘制。

## 修复
1. `css/app.css`：`.chart-wrap` 增加 `height: 380px` 作为 `clamp()` 之前的纯 px 回退（移动端媒体查询本来就有 280px）。
2. `js/ui/chart.js`：
   - `_syncSize()` 检测"宽有值但高为 0 且容器可见"时，写入 260px/360px 内联高度并重新测量；
   - 构造后 300ms 重试一次，`window.load` 再量一次；
   - `render()` 测量失败时调度 250ms 重试；
   - `destroy()` 清理新增定时器与 load 监听。
3. `js/ui/ui.js`：图表构造与 `render()` 包 try/catch；失败时在 `#chartEmpty` 显示原因，其余界面不受影响。

## 验证
- `node --check` 全部通过；`tools/test-ui.mjs` 冒烟通过（桌面 canvas 752×382，非空像素 180000；0 console 错误）。
- Playwright 390×844 移动视口：canvas 338×278 正常绘制；人为把容器高度置 0 后，回退逻辑恢复为 260px 并继续绘制。
- APK 重新构建：`dist/abyss-fx-1.0.apk`，sha256 `8f3155d5727d083f30cc2ad152f71d097799325cf4cd54edd7777ae0a1207a14`。

## 补充排查（用户反馈 WebView 97.0.4692.98）
- WebView 97 支持 `clamp()`、`??`、`ResizeObserver`，此前的兼容性假设不成立。
- 在本机 Android 12 模拟器（WebView 91.0.4472.114）安装 APK 实测：
  - SwiftShader 与 NVIDIA 宿主 GPU 两种渲染模式下，浅色/深色主题、模拟行情/历史回放的 K 线均正常显示；
  - 交易统计、分享卡等其它画布路径正常。
- 因此图表代码在 Android WebView 上可运行，问题更可能来自特定厂商 WebView 的合成层/GPU 差异。
- 追加修复：给 `#chart` 加 `transform: translateZ(0)` + `backface-visibility: hidden`，把画布提升为独立合成层，规避圆角裁切下画布不绘制的问题。
- 新 APK：sha256 `870844ac2806440f664407cbc1d04e78bc93658d9de1a82f29e3403982ba35c0`。

## 待确认
- 用户真机是否恢复显示。
- 需要用户提供截图/具体表现：图表卡片是空白、显示“还没有行情”、还是整块不在屏幕上。
- 可先让用户尝试“设置 → 清除全部存档”后重启，排除旧存档恢复异常。
