#!/usr/bin/env bash
# 构建 Windows 单文件 exe：Go + WebView2 壳，静态站点内嵌在可执行文件里
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/dist/abyss-fx.exe"
STAGE="$ROOT/build/exe"

command -v x86_64-w64-mingw32-windres >/dev/null || { echo "缺少 mingw-w64 windres" >&2; exit 1; }
command -v rsvg-convert >/dev/null || { echo "缺少 rsvg-convert" >&2; exit 1; }
command -v magick >/dev/null || { echo "缺少 ImageMagick" >&2; exit 1; }

echo "[1/4] 准备构建目录"
rm -rf "$STAGE"
mkdir -p "$STAGE" "$ROOT/dist"
cp "$ROOT/desktop/main.go" "$ROOT/desktop/go.mod" "$ROOT/desktop/go.sum" "$STAGE/"
cp "$ROOT/index.html" "$STAGE/"
cp -r "$ROOT/css" "$ROOT/js" "$ROOT/assets" "$STAGE/"

echo "[2/4] 生成图标与版本资源"
rsvg-convert -w 256 -h 256 "$ROOT/desktop/icon.svg" -o "$STAGE/icon-256.png"
magick "$STAGE/icon-256.png" -define icon:auto-resize=256,128,64,48,32,16 "$STAGE/app.ico"
cp "$ROOT/desktop/app.rc" "$STAGE/"
(cd "$STAGE" && x86_64-w64-mingw32-windres app.rc -O coff -o rsrc_windows_amd64.syso)

echo "[3/4] 编译 Windows exe"
(cd "$STAGE" && CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
  go build -trimpath -ldflags "-H windowsgui -s -w" -o "$OUT" .)

echo "[4/4] 完成"
ls -lh "$OUT"
sha256sum "$OUT"
