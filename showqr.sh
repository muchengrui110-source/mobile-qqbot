#!/bin/sh
# 把当前的登录二维码存进相册，手机自己扫
QR=/root/qbot/yogurt/qrcode.png
if [ ! -f "$QR" ]; then
  echo "还没有二维码文件：$QR"
  echo "说明现在已登录，或者协议端没跑起来"
  exit 1
fi
mkdir -p /sdcard/Pictures
cp -f "$QR" /sdcard/Pictures/QQ登录码.png
echo "已保存到相册：QQ登录码.png"
ls -l /sdcard/Pictures/QQ登录码.png
