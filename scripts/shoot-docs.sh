#!/bin/bash
# 用独立数据目录（纯合成内容）重新生成文档截图，避免把真实截图带进仓库
cd "/d/WDY/截图待办" || exit 1
unset ELECTRON_RUN_AS_NODE

export UD="--user-data-dir=D:/tmp/shots-ud"
export WDY_NO_HOTKEY=1
ELECTRON="./node_modules/electron/dist/electron.exe"
OUT="/d/tmp/shots"
mkdir -p "$OUT"

PY="C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe"

shoot() {
  local name="$1"
  shift
  "$PY" scripts/_reset-shot-prefs.py
  rm -f shot.png shot-toast.png
  env "$@" timeout 45 $ELECTRON . --shot $UD >/dev/null 2>&1
  if [ -f shot.png ]; then
    cp shot.png "$OUT/$name.png"
    echo "✓ $name"
  else
    echo "✗ $name 失败"
  fi
  rm -f shot.png shot-toast.png
}

shoot main WDY_SHOT_HOVER=1
shoot grid WDY_SHOT_GRID=1
shoot done WDY_SHOT_TAB=done
shoot appearance WDY_SHOT_ALPHA=1
shoot settings WDY_SHOT_SETTINGS=1
shoot help WDY_SHOT_HELP=1

# toast 单独处理（额外产出 shot-toast.png）
"$PY" scripts/_reset-shot-prefs.py
rm -f shot.png shot-toast.png
WDY_SHOT_TOAST=1 timeout 45 $ELECTRON . --shot $UD >/dev/null 2>&1
[ -f shot-toast.png ] && cp shot-toast.png "$OUT/toast.png" && echo "✓ toast" || echo "✗ toast 失败"
rm -f shot.png shot-toast.png

echo "--- 完成，输出到 $OUT"
ls -la "$OUT"
