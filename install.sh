#!/bin/sh
set -e

UIN="$1"
if [ -z "$UIN" ]; then
  echo "用法: sh install.sh <QQ号>"
  exit 1
fi

SRC=$(cd "$(dirname "$0")" && pwd)
DEST=/root/qbot

echo "== 安装到 $DEST =="
mkdir -p "$DEST" /root/dsh-plugins /root/.dsh/qq-bridge /sdcard/Pictures/表情包
cp -r "$SRC/sign" "$SRC/yogurt" "$SRC/m2o" "$SRC/console" "$DEST/"
cp -f "$SRC/start.sh" "$SRC/showqr.sh" "$DEST/"
chmod +x "$DEST/yogurt/yogurt.kexe" "$DEST/start.sh" "$DEST/showqr.sh"

echo "== 写入 QQ 号 =="
python3 - "$UIN" "$DEST/yogurt/config.json" <<'PY'
import io, json, sys
uin = int(sys.argv[1])
path = sys.argv[2]
with io.open(path, encoding='utf-8') as f:
    cfg = json.load(f)
cfg['protocol']['uin'] = uin
with io.open(path, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(cfg, f, ensure_ascii=False, indent=4)
print('uin =', uin)
PY

echo "== 安装插件 =="
for p in dsh-qq-bridge dsh-persona dsh-qbot-launcher dsh-mnemon; do
  rm -rf "/root/dsh-plugins/$p"
  cp -r "$SRC/plugins/$p" "/root/dsh-plugins/$p"
done

echo "== 人设文件 =="
python3 "$SRC/tools/patch_m2o.py" "$DEST/m2o/src/gateway.py"
python3 "$SRC/tools/init_persona.py" "$UIN"

echo "== 改 profile =="
python3 "$SRC/tools/init_profile.py"

echo "== Python 依赖 =="
pip3 install -q -i https://mirrors.aliyun.com/pypi/simple/ fastapi uvicorn websockets msgspec ujson httpx

echo "== pnpm 依赖 =="
PROFILE=$(python3 "$SRC/tools/find_profile.py")
cd "$PROFILE" && pnpm install

echo
echo "装完了。重开一次 DSH 应用让插件加载，然后执行："
echo "  sh /root/qbot/start.sh"
echo "第一次登录的二维码会自动存到相册「QQ登录码.png」。"
