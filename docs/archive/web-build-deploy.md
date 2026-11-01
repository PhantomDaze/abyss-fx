# Web 构建与部署分离

状态：代码已完成（2026-11-01）；Cloudflare Pages 构建配置待用户在控制台确认

## 目标

源码（`index.html`、`css/`、`js/`）与实际发布文件分离，部署时自动合并 CSS/JS，降低首屏请求数。

## 改动

- [x] `tools/build-web.mjs`：读取 `index.html` 中的 CSS/JS 引用，按顺序合并为 `dist/web/css/app.bundle.css` 与 `dist/web/js/app.bundle.js`，生成带内容哈希的 `dist/web/index.html`、`_headers`、`.nojekyll`。
- [x] `package.json`：新增 `npm run build:web`。
- [x] `.github/workflows/deploy-pages.yml`：GitHub Pages 自动构建并发布 `dist/web`。
- [x] `README.md`：Cloudflare Pages / GitHub Pages 构建命令与输出目录说明。
- [x] 移除手动上传脚本（Cloudflare Pages 已与仓库绑定，推送自动构建）。

## 部署配置

- Cloudflare Pages：Build command `npm run build:web`，Output directory `dist/web`。
- GitHub Pages：Settings → Pages → Source 选择 **GitHub Actions**。

## 验证

```bash
npm run build:web
python3 -m http.server 8099 --directory dist/web
BASE=http://127.0.0.1:8099/ node tools/test-ui.mjs
```

结果：首屏 3 个请求；完整 UI 冒烟测试 0 控制台错误。

## 待办

- 切换 GitHub Pages 的 Source 为 GitHub Actions（当前仍为 legacy main 根目录）。
- 在 Cloudflare Pages 项目设置中把构建命令/输出目录改成上面的值。
