#!/bin/bash
# 一键发版：构建 → 打包 → 编译安装器 → 建 GitHub Release
# 用法：bash scripts/release.sh "更新说明"
set -e
cd "$(dirname "$0")/.."

VER=$(node -p "require('./package.json').version")
NOTES="${1:-截图待办 v$VER}"
echo "=== 发布 v$VER"

export PATH="/c/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-6:$PATH"

echo "--- 1/4 构建"
npm run build

echo "--- 2/4 组装便携版"
node scripts/pack.js

echo "--- 3/4 编译安装包（约 5 分钟）"
bash scripts/build-installer.sh

SETUP="release/截图待办-Setup-$VER.exe"
if [ ! -f "$SETUP" ]; then
  echo "安装包没生成，中止"
  exit 1
fi

echo "--- 4/4 创建 GitHub Release"
# 已存在同名 tag 就先删掉远程的，避免冲突
gh release delete "v$VER" --yes --cleanup-tag 2>/dev/null || true

gh release create "v$VER" "$SETUP" \
  --title "截图待办 v$VER" \
  --notes "$NOTES" \
  --latest

echo "=== 完成"
gh release view "v$VER" --json url --jq '.url'
