#!/usr/bin/env bash
# 构建离线 APK：把静态游戏装进原生 WebView 壳
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SDK=${ANDROID_HOME:-/opt/android-sdk}
BT=${BUILD_TOOLS:-"$SDK/build-tools/36.1.0"}
PLATFORM=${PLATFORM_JAR:-"$SDK/platforms/android-34/android.jar"}
KS="$ROOT/android/debug.keystore"
OUT="$ROOT/dist/abyss-fx-1.0.apk"

[ -x "$BT/aapt2" ] || { echo "找不到 build-tools: $BT" >&2; exit 1; }
[ -f "$PLATFORM" ] || { echo "找不到 android.jar: $PLATFORM" >&2; exit 1; }

cd "$ROOT"
rm -rf android/build android/assets/www
mkdir -p android/assets/www android/build/classes android/build/dex dist

# 只打包运行所需的前端文件
cp index.html android/assets/www/
cp -r css js assets android/assets/www/

echo "[1/6] 编译资源"
"$BT/aapt2" compile --dir android/res -o android/build/res.zip

echo "[2/6] 链接资源与 assets"
"$BT/aapt2" link \
  -o android/build/app-unsigned.apk \
  -I "$PLATFORM" \
  --manifest android/AndroidManifest.xml \
  -R android/build/res.zip --auto-add-overlay \
  -A android/assets \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code 1 --version-name 1.0

echo "[3/6] 编译 Java"
printf '%s\n' "$PLATFORM" > android/build/classpath.txt
CP=$(tr '\n' ':' < android/build/classpath.txt)
javac --release 17 -classpath "$CP" -d android/build/classes \
  $(find android/java -name '*.java')
jar cf android/build/classes.jar -C android/build/classes .

echo "[4/6] 生成 dex"
"$BT/d8" --release --lib "$PLATFORM" --min-api 24 \
  --output android/build/dex android/build/classes.jar

echo "[5/6] 打包"
OUT_DIR=$(mktemp -d)
cp android/build/app-unsigned.apk "$OUT_DIR/app.apk"
(cd android/build/dex && zip -q -j "$OUT_DIR/app.apk" classes.dex)
"$BT/zipalign" -f 4 "$OUT_DIR/app.apk" "$OUT_DIR/app-aligned.apk"
rm "$OUT_DIR/app.apk"

echo "[6/6] 签名"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storepass android -keypass android \
    -alias androiddebugkey -dname "CN=Android Debug,O=Android,C=US" \
    -keyalg RSA -keysize 2048 -validity 10000 >/dev/null
fi
"$BT/apksigner" sign \
  --ks "$KS" --ks-key-alias androiddebugkey \
  --ks-pass pass:android --key-pass pass:android \
  --out "$OUT" "$OUT_DIR/app-aligned.apk"
rm -rf "$OUT_DIR"

echo
echo "APK: $OUT ($(du -h "$OUT" | cut -f1))"
"$BT/aapt" dump badging "$OUT" | head -6
"$BT/apksigner" verify --print-certs "$OUT" | head -3
unzip -l "$OUT" | grep -E 'assets/www/(index.html|js/core/game.js|css/app.css|assets/kurumi.mp3)$'
