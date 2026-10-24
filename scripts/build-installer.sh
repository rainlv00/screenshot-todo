#!/bin/bash
# 编译 Windows 安装包（NSIS）
# 依赖：makensis（默认用 D:\WDY\nsis\Bin\makensis.exe，可用 MAKENSIS 环境变量覆盖）
set -e
cd "$(dirname "$0")/.."

MAKENSIS="${MAKENSIS:-/d/WDY/nsis/Bin/makensis.exe}"
if [ ! -f "$MAKENSIS" ]; then
  echo "找不到 makensis: $MAKENSIS"
  echo "从镜像下载：curl -L -o nsis.7z https://registry.npmmirror.com/-/binary/electron-builder-binaries/nsis-3.0.4.1/nsis-3.0.4.1.7z"
  exit 1
fi

VER=$(node -p "require('./package.json').version")
echo "版本: $VER"

if [ ! -f "release/截图待办-win32-x64/截图待办.exe" ]; then
  echo "缺少 release/截图待办-win32-x64，先跑 node scripts/pack.js"
  exit 1
fi

cd scripts
MSYS_NO_PATHCONV=1 "$MAKENSIS" -INPUTCHARSET UTF8 \
  "/DVERSION=$VER" \
  "/DSRCDIR=..\\release\\截图待办-win32-x64" \
  "/DOUTDIR=..\\release" \
  installer.nsi

cd ..
ls -la "release/ScreenshotTodo-Setup-$VER.exe" | awk '{printf "安装包: %.1f MB\n", $5/1048576}'
