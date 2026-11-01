# 久留美彩蛋（Kurumi Easter Egg）

状态：完成
日期：2026-11-01

## 目标

把《FX 战士久留美》的台词「老实赚钱，很枯燥吧」做进 ABYSS FX：图表角落常驻久留美头像，点击弹出浮动卡片并播放语音。不参与交易逻辑，不影响离线玩法。

## 素材

| 素材 | 来源 | 处理 |
|---|---|---|
| 语音 `kurumi.mp3`（2.95s，44.1kHz 立体声，60KB） | `/home/antom/Downloads/kurumi/kurumi.mp3` | 复制到 `assets/kurumi.mp3`，随项目打包 |
| 图片（1280×720 PNG，769KB） | `https://bee-reg-ab.imagency.cn/mr/202610/31/6ae5f830c22e8.png` | **不下载、不打包**，运行时直接引用图床 URL |

图床已确认：CORS `*`、不校验 Referer，可直接 `<img>` 引用。

## 交互设计

- **入口**：图表区右上角常驻圆形头像（约 38px），带粉色描边和悬停微动效。
- **触发**：点击头像 → 右下角弹出浮动卡片（图片 + 台词 + 「再听一次」按钮），同时播放语音。
- **关闭**：右上角 ×；语音播完后约 5 秒自动淡出；再次点击头像会重播并重置计时。
- **音效开关**：复用设置里的「音效」开关；关闭时不播放，正在播放则停止。
- **图片失败**：头像回退为粉底「久」字；卡片回退为纯文字台词。语音是本地文件，不受影响。
- **启动零请求**：头像/卡片图片用 `data-src` 延迟到首次用户手势（pointerdown/keydown）后再加载，保持项目“启动不发起网络请求”的现状。

## 技术改动

1. `assets/kurumi.mp3`：新增语音文件。
2. `index.html`：图表容器内新增头像按钮；页面底部新增浮动卡片（图片 URL 写在 `data-src`）。
3. `js/ui/audio.js`：新增 `playVoice(src)` / `stopVoice()`，用 `HTMLAudioElement`（兼容直接双击 `index.html` 的 file:// 场景，避免 WebAudio fetch 的 CORS 限制），受 `enabled` 控制。
4. `js/ui/ui.js`：绑定头像/卡片、首次手势加载图片、图片 onload/onerror、自动收起计时。
5. `css/extra.css`：头像、卡片、图片失败回退、窄屏适配；图表模式角标左移让位。
6. 打包：
   - `tools/build-web.mjs`：`_headers` 增加 `/assets/*` 长缓存（assets 复制逻辑已存在）。
   - `tools/build-exe.sh` + `desktop/main.go`：`go:embed` 和拷贝加入 `assets`。
   - `tools/build-apk.sh`：拷贝 `assets` 到 `assets/www/`。
7. 文档：README 功能点、目录、已知边界；本计划完成后移入 `docs/archive/`。

## 验收

- `node tools/build-web.mjs` 成功，`dist/web/assets/kurumi.mp3` 存在。
- 本地起服务后：头像可见；点击弹出卡片并播放语音；× 可关闭；音效关闭时不播放。
- 图片正常加载时显示剧照；断网/图床失败时显示文字回退，控制台无未捕获异常。
- `node tools/test-ui.mjs` 冒烟测试通过（下单、平仓、模式切换不受影响）。
- 移动端窄屏卡片不溢出。

## 验证结果（2026-11-01）

- `node tools/build-web.mjs`：成功，`dist/web/assets/kurumi.mp3` 存在，`_headers` 含 `/assets/*` 缓存规则。
- Playwright 浏览器验证：
  - 首次用户手势前图床请求数 0；手势后加载 1 次。
  - 点击头像：浮卡可见、图片 1280×720 加载成功、`assets/kurumi.mp3` 被播放。
  - 5.5 秒后自动收起；关闭按钮可用。
  - 关闭音效后点击头像：浮卡仍显示，但不播放语音。
  - 拦截图床：浮卡回退为文字卡片（「久留美 / 老实赚钱，很枯燥吧」），语音仍可播放。
  - 桌面与 390px 窄屏截图均正常，无控制台错误。
- `node tools/test-ui.mjs`：全量冒烟测试通过，`errors []`（下单、平仓、战役、挑战、排行榜、分享卡均不受影响）。
- `bash tools/build-exe.sh`：成功生成 8.4MB exe（`go:embed` 已包含 assets）。
- `bash tools/build-apk.sh`：成功生成 APK，`unzip -l` 确认包含 `assets/www/assets/kurumi.mp3`。

## 风险 / 边界

- 图床链接可能过期或失效；已做文字回退。链接带日期目录（202610/31），建议后续换成稳定地址。
- 图片来自动画截图，公开部署时注意版权与图床热链政策；本项目仅作个人/娱乐用途。
- 远程图片使“完全离线”不再覆盖头像图片，但语音与全部玩法仍离线可用；README 已注明。
