# 手机端图表不渲染排查

状态：待用户确认（2026-10-31）

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

## 待确认
- OPPO A32 Edge 打开线上 Pages 后图表是否恢复；如仍为纯色，尝试 Edge 设置里关闭"深色模式/强制深色"。
- 若仍异常，需要截图与 Edge 版本号。
