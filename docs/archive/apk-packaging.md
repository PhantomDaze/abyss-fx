# 任务计划：把 ABYSS FX 打包成 APK

日期：2026-10-31

## 目标

把 `kurumi` 这个纯静态网页游戏包装成可离线安装的 Android APK，保留 localStorage 存档、Canvas 图表与 WebAudio 音效，不依赖服务器与网络。

## 方案

- 原生 Android `WebView` 壳（单 Activity），不引入 Capacitor/Cordova/AndroidX 依赖。
- 通过自定义 `shouldInterceptRequest` 把 `https://appassets.androidplatform.net/assets/...` 映射到 APK 内的 `assets/www/`，避免 `file://` 下的 localStorage/同源限制，同时无需 INTERNET 之外的任何权限。
- 使用系统 `android.jar` + `aapt2` + `d8` + `apksigner` 手工构建，不依赖 AGP 在线下载。
- 应用信息：包名 `dev.abyssfx.game`，名称「深渊汇率」，minSdk 24 / targetSdk 34，版本 1.0。

## 步骤

- [x] 创建 `android/` 工程（Manifest、Activity、主题、矢量图标、构建脚本）
- [x] 拷贝 `index.html` / `css/` / `js/` 到 `assets/www/`
- [x] 用 build-tools 34.0.0 编译资源、Java、dex，打包并签名
- [x] 静态校验：`aapt dump badging`、`apksigner verify`、APK 内 assets 清单
- [x] 用打包后的同一份 assets 在 Chromium 做冒烟（9 个货币对、下单成功、0 控制台错误）
- [ ] 真机/模拟器安装冒烟（当前环境无设备；需用户侧安装验证）

## 备注

- 使用 debug keystore 签名，仅供安装测试；上架/分发请换成自己的 release keystore。
- 若以后增加网络行情，需要放开 INTERNET 权限并在 Manifest 中配置域名。
