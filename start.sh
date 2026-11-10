#!/bin/sh
# 启动 QQ 机器人后端：签名服务 + 协议端 + OneBot 转换 + 控制台
cd "$(dirname "$0")" || exit 1
ROOT=$(pwd)
LOG="$ROOT/logs"
mkdir -p "$LOG"
MARK=/tmp/qbot-start-marker
QR="$ROOT/yogurt/qrcode.png"

pkill -f "sign/server_v1.mjs" 2>/dev/null
pkill -f "yogurt.kexe" 2>/dev/null
pkill -f "main.py" 2>/dev/null
# 协议端的 3000 端口没开 reuse，进程刚死时会残留 TIME_WAIT，等一下再起
sleep 6

touch "$MARK"

VERSION=3.2.34-53644 QUA=V1_LNX_NQ_3.2.34_53644_GW_B nohup node sign/server_v1.mjs > "$LOG/sign.log" 2>&1 &
sleep 2

# 二维码守望：登录过期会重新生成二维码，直接存进相册，手机自己就能扫
(
  i=0
  while [ "$i" -lt 180 ]; do
    if [ -f "$QR" ] && [ "$QR" -nt "$MARK" ]; then
      mkdir -p /sdcard/Pictures
      cp -f "$QR" /sdcard/Pictures/QQ登录码.png
      echo "=========== 需要扫码登录 ==========="
      echo "二维码已存到相册：QQ登录码.png"
      echo "打开相册扫它，扫完点确认"
      echo "===================================="
      break
    fi
    sleep 2
    i=$((i + 2))
  done
) &

# 协议端：起不来就重试几次（多半是 3000 端口还没释放）
n=0
while [ "$n" -lt 4 ]; do
  : > "$LOG/yogurt.log"
  ( cd "$ROOT/yogurt" && nohup ./yogurt.kexe >> "$LOG/yogurt.log" 2>&1 & )
  sleep 7
  if pgrep -f "yogurt.kexe" >/dev/null 2>&1; then
    break
  fi
  n=$((n + 1))
  sleep 8
done

( cd "$ROOT/m2o" && nohup python3 main.py > "$LOG/m2o.log" 2>&1 & )

# 控制台：手机浏览器打开 http://127.0.0.1:8181
if ! pgrep -f "server.mjs" >/dev/null 2>&1; then
  ( cd "$ROOT/console" && nohup node server.mjs > "$LOG/console.log" 2>&1 & )
fi

sleep 4

echo "--- sign ---"
tail -n 2 "$LOG/sign.log" 2>/dev/null
echo "--- yogurt ---"
tail -n 6 "$LOG/yogurt.log" 2>/dev/null
echo "--- m2o ---"
tail -n 4 "$LOG/m2o.log" 2>/dev/null
echo "--- console ---"
tail -n 2 "$LOG/console.log" 2>/dev/null


