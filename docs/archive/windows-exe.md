# Windows 单文件 exe 打包

状态：已完成（2026-10-31）

## 方案
- Go + `github.com/jchv/go-webview2` 桌面壳，`//go:embed` 内嵌 `index.html`、`css/`、`js/`。
- 启动时在 `127.0.0.1` 起一个只监听本机的静态服务（固定端口 47821，占用时顺延到 47840），
  WebView2 打开 `http://127.0.0.1:<port>/index.html`。
- WebView2 数据目录固定为 `%LOCALAPPDATA%\AbyssFX\WebView2`，保证 localStorage 存档跨次运行保留。
- 绑定 `AbyssNative.savePng`，分享卡直接写入 `图片\AbyssFX` 并复用游戏内 toast 提示。
- 窗口按屏幕尺寸的 90% 初始化（上限 1280×820，下限 960×640），最小 960×640。
- 图标与版本资源由 `desktop/icon.svg` → ICO → windres 生成 `rsrc_windows_amd64.syso`。
- 构建脚本 `tools/build-exe.sh` 在 `build/exe` 里暂存资源后交叉编译，产物 `dist/abyss-fx.exe`。

## 验证
- `file`：PE32+ GUI x86-64；`wrestool` 确认图标组与版本资源存在。
- 在 Wine + WebView2 95.0.1020.53 下实测：
  - 页面正常加载（标题、9 个货币对、K 线绘制、无 console 错误）；
  - 点击做多成功开仓（持仓 1，toast“买入成交”）；
  - `AbyssNative.savePng` 成功写出 PNG，并显示“分享卡已保存”提示。
- 最终产物：`dist/abyss-fx.exe`，约 8.3 MB，sha256 `80c37c9f0b23ce67e078054f77ba1f98cd1d1234a3ef9fe059bcc2a12b7113bd`。

## 说明
- 依赖 Microsoft Edge WebView2 Runtime（Win11 自带，Win10 多数已安装）；缺失时弹窗给出下载地址。
- exe 未签名，首次运行可能触发 SmartScreen。
- 若 47821–47840 全部被占用则无法启动，会弹窗提示。
