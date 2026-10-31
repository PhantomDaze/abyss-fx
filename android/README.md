# Android 壳（WebView）

把 `kurumi` 的静态前端装进一个原生 WebView，完全离线运行。

## 结构

```
android/
  AndroidManifest.xml
  java/dev/abyssfx/game/MainActivity.java   单 Activity + 本地资源拦截
  res/                                      主题、名称、矢量图标
  assets/www/                               构建时从项目根目录拷入（不手工编辑）
  debug.keystore                            本地测试签名（构建脚本自动生成）
```

## 构建

```bash
cd /opt/DEV/web-services/kurumi
bash tools/build-apk.sh
# 输出 dist/abyss-fx-1.0.apk
```

依赖：Android SDK（platform 34 + build-tools 36.1.0）、JDK 17+。脚本不依赖 Gradle/AGP。

## 安装

```bash
adb install -r dist/abyss-fx-1.0.apk
```

或把 APK 传到手机手动安装（需要允许“安装未知来源应用”）。

## 说明

- 页面通过 `https://appassets.androidplatform.net/assets/...` 虚拟源加载，由 `shouldInterceptRequest` 直接读 APK 内 assets；localStorage 因此有稳定的 https 源，存档可跨启动保留。
- 分享卡下载会调用 `AbyssNative.savePng`，Android 10+ 写入 `Pictures/AbyssFX`，旧版本写入应用外部目录。
- 当前使用 debug keystore 签名；正式分发请生成自己的 release keystore 并替换 `tools/build-apk.sh` 中的签名参数。
- 没有网络行情；APK 不请求任何外部域名（Manifest 中的 INTERNET 权限仅用于 WebView 的 https 虚拟源）。
