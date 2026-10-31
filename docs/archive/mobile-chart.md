# 手机端图表不渲染排查

状态：已完成，用户在 OPPO A32 / Edge 上确认图表正常（2026-10-31）

## 现象
用户反馈：桌面正常，手机端"无论如何都不能正常渲染图表"。

## 已排查
- 用 Playwright 在 390×844 / DPR 3 / 触摸模式下测试：
  - Chromium 97.0.4691.0（接近用户 WebView 97 内核）：K 线正常，非空像素 3875，0 console 错误；
  - WebKit 2.55（iPhone 视口）：K 线正常，非空像素 3875，0 console 错误；
  - 触摸、页面滚动、横竖屏切换后画布仍正常。
- 线上 GitHub Pages（https://phantomdaze.github.io/abyss-fx/）用上述两个移动内核复测，同样正常，资源无 404。
- 因此页面代码在移动内核上可运行，问题更可能来自用户手机的打开方式或特定厂商浏览器（微信/QQ/UC 内置浏览器、文件管理器预览、桌面模式等）。

## 本次改动
1. 启用 GitHub Pages，提供手机可直接访问的线上地址。
2. 移除画布的 `transform: translateZ(0)` / `backface-visibility: hidden`（此前为 Android 壳加的合成层提升，部分 iOS/厂商内核可能因此不绘制画布）。
3. `Chart.render()` 返回是否成功绘制；失败时在图表区显示诊断文字（画布尺寸、窗口尺寸或初始化错误），便于用户反馈。
4. exe 重新构建并更新 Release 附件。

## 用户补充（2026-10-31）
- 设备：OPPO A32，Edge 浏览器。
- 表现：图表区域是**纯橙黄色**，不是空白。
- 判断：整块纯色更像低端 GPU（Adreno 610）把 canvas 图层渲染成未初始化色块，
  而不是尺寸为 0 或数据为空。

## 追加修复
1. `canvas.getContext('2d', { willReadFrequently: true })`：让 Chromium 使用 CPU 画布，
   规避部分 Adreno/Mali 驱动把 canvas 渲染成纯色块的问题；实测 30 次重绘平均 1.6ms/次。
2. `:root { color-scheme: light }` / `html[data-theme="night"] { color-scheme: dark }`：
   声明页面自己管理主题，避免 Edge/系统"强制深色"对页面和画布做额外处理。
3. 给 index.html 的 CSS/JS 加 `?v=20261031c` 版本号，绕过 GitHub Pages 的缓存，
   保证手机端能拿到新代码。

## 根因（2026-10-31，已定位）
用户新截图（OPPO A32 / Edge）里图表区是**整块纯色 #B08A54**。逐像素采样确认：
- 页面其它区域颜色完全准确（`--bg` #F5F4EE、`--surface` #FBFAF7），说明 CSS 与主题正常；
- 纯色值 #B08A54 恰好等于**浅色主题的 `--chart-order`**，且全仓库只有 `chart.js` 的 `c.order` 用到它。

`FX.Chart._theme()` 原来用“隐藏探针 span + `getComputedStyle(probe).color` 回读”把
`var(--x)` 展开成真实颜色。部分安卓内核（OPPO A32 上的 Edge/WebView 实测）**回读时不刷新样式**，
一轮取色全部拿到上一次设置的值——上一次最后解析的是 `order`（#B08A54），
于是 16 个颜色全变成同一个色，画布被 `bg` 填满后其余线条同色不可见，表现为整块纯色。
桌面 Chromium 会强制刷新样式，所以只有这台手机出问题。

## 修复
1. 删掉探针元素，`_resolveVar()` 改为直接读根元素变量并**递归展开 `var(--x)` 引用链**
   （`--chart-up → var(--chart-red) → #C0503B`），不再依赖任何样式回读副作用。
2. `_theme()` 统一走 `_rootVar()`，字体变量同样改为直接读取。
3. 缓存 `getComputedStyle(document.documentElement)`，主题切换时仍是活对象，无需重取。
4. `index.html` 资源版本号 bump 到 `?v=20261031e`，绕过手机缓存。

验证：360×800 / DPR 2 移动视口下 `_theme()` 16 个颜色互不相同，画布 336 种颜色，
图表正常绘制；`tools/test-ui.mjs` 全流程冒烟通过，0 console 错误。

## 修复后的样式调整（2026-10-31）
图表恢复后用户发现上涨蜡烛是空心（只有 1.2px 描边）、下跌是实心，误以为是新引入的 bug。
实际 `_drawCandlesAndMa()` 自初始版本起就是“上涨空心、下跌实心”的经典画法，
手机端之前整块纯色所以看不到。用户确认改为**红绿都实心**，只靠颜色区分：
- `js/ui/chart.js` 删掉 `strokeRect` 分支，统一 `fillRect`；
- `index.html` 资源版本号 bump 到 `?v=20261031f`。
验证：360×800 / DPR 2 移动视口下红色实心像素数 1651 → 2745，K 线、均线、成交量正常；
`tools/test-ui.mjs` 全流程冒烟通过，0 console 错误。

## 确认结果
- OPPO A32 Edge 打开线上 Pages（`?v=20261031g`）后 K 线、均线与成交量均正常渲染，纯色问题解决。
- 顺带确认了实心蜡烛样式与 0.25× / 0.5× 倍速。
