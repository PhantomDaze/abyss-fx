# 存档导出 / 导入

状态：已完成（2026-10-31）

## 需求
用户反馈目前只能自动存到 localStorage，无法导出备份或在其他设备恢复。

## 方案
1. 新增 `js/core/saveio.js`：把 `localStorage` 中所有 `kurumi-fx:` 前缀键打包成
   `{magic:'abyss-fx-save', v:1, exportedAt, data:{...}}` JSON；提供解析、校验、覆盖写入、
   下载、读取文件、复制文本等能力。
2. 设置弹窗增加「存档备份」行：导出 / 导入按钮。
   - 导出：先 `game.save()` 落盘，再弹窗展示 JSON，可复制或保存文件。
   - 导入：支持选择 `.json` 文件或粘贴文本；校验通过后二次确认，覆盖全部存档并刷新。
3. `game.js`：
   - `save()` 增加 `_skipSave` 短路，避免导入后 `beforeunload` 又把旧状态写回。
   - 新增 `importData(obj)`：停掉时钟/自动保存后写入并 `location.reload()`。
   - 顺带修复 `clearAll()` 同样会被 `beforeunload` 自动保存写回的旧问题。
4. 三端文件能力：
   - 浏览器：`<a download>` + `<input type=file>`。
   - Windows 壳：新增 Go 绑定 `saveText`，写入 `下载/AbyssFX`；导入用 WebView2 原生文件选择。
   - Android 壳：新增 `AbyssNative.saveText`（MediaStore Downloads）与 `pickText`
     （ACTION_OPEN_DOCUMENT 读取后回调页面），避免 WebView `<input type=file>` 不可靠。
5. `index.html` 引入新脚本并统一 bump 资源版本号；`css/app.css` 增加文本框/按钮样式。
6. 文档：README、android/README、SPEC 10.5 补充说明。

## 验证
- `tools/test-ui.mjs` 增加 SaveIO 往返与非法存档校验；全流程 0 console 错误。
- 专项 Playwright：导出弹窗内容正确、非法文本报错、文件选择填充、二次确认、覆盖导入后主题恢复、
  取消确认保留已粘贴文本、390px 设置行无溢出。
- `javac --release 17` 编译 Android 源码通过；`bash tools/build-apk.sh` 成功，APK 内含 saveio.js。
- Windows 壳 `GOOS=windows go build` 通过。

## 已知边界
- 导入只接受本游戏 v1 备份；旧版本存档不做硬迁移。
- 历史回放进度本身不持久化，导出/导入行为与现有自动存档一致。
