// 引擎启动后把 QQ 机器人后端拉起来（签名服务 + 协议端 + 转换器 + 控制台）。
// 只做一次，失败不影响引擎本身。

import { spawn } from 'node:child_process';
import fs from 'node:fs';

const START_SCRIPT = '/root/qbot/start.sh';
const DELAY_MS = 4000;

export default function qbotLauncher(ctx) {
  if (!fs.existsSync(START_SCRIPT)) {
    console.log('[qbot-launcher] 找不到启动脚本：' + START_SCRIPT);
    return;
  }

  const timer = setTimeout(() => {
    try {
      const child = spawn('sh', [START_SCRIPT], { detached: true, stdio: 'ignore' });
      child.unref();
      console.log('[qbot-launcher] 已拉起 QQ 机器人后端');
    } catch (error) {
      console.log('[qbot-launcher] 启动失败：' + String(error && error.message));
    }
  }, DELAY_MS);

  timer.unref?.();
}

qbotLauncher.inject = [];
