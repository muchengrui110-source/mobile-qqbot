# 手机 QQ 机器人（安卓 · 不依赖电脑）

在安卓手机本地跑一套 QQ 协议端 + 签名 + OneBot 转换 + DSH 桥接，手机上自己收发消息，
不需要电脑，也不需要 QQ 客户端（不是 NapCat 那套）。

## 组成

| 目录 | 作用 |
| --- | --- |
| `sign/` | 纯 JS 签名服务（3.2.34-53644） |
| `yogurt/` | 协议端（Yogurt，arm64 可执行） |
| `m2o/` | Milky → OneBot v11 转换器（Python） |
| `console/` | 手机浏览器控制台（状态 / 启停 / 人设 / 记忆 / 日志） |
| `plugins/` | DSH 插件：QQ 桥接、身份与人设、开机自启 |
| `start.sh` | 一键启动全部组件，登录过期时把二维码存进相册 |
| `showqr.sh` | 单独把当前二维码存进相册 |

## 要求

- 安卓手机，arm64，能装 DSH Go（io.github.ccch1mneyyy.dsh_app），本地引擎能跑（DSH 0.2.2-rc.1）
- DSH 的 Ubuntu 环境里要有 `node`、`python3`、`pnpm`（DSH Go 自带 node 和 pnpm）
- 首次装 Python 依赖要能访问 pip 镜像
- 一个能扫二维码登录的 QQ 号（建议小号）
- 手机约 100MB 空间；DSH Go 要加进电池白名单，别被杀后台

## 安装

1. 手机装 DSH Go，选「本机运行」，确认引擎能启动。
2. 把本目录整个推到手机，例如 `/sdcard/Download/mobile-qqbot`。
3. 打开 DSH Go → 全部功能 → 终端，执行：

```sh
cd /sdcard/Download/mobile-qqbot
sh install.sh 你的QQ号
```

4. 装完重开一次 DSH 应用（插件要重启引擎才加载）。
5. 启动：

```sh
sh /root/qbot/start.sh
```

6. 第一次登录：协议端会生成二维码，`start.sh` 会自动把它存进相册「QQ登录码.png」。
   打开 QQ 的「扫一扫」→ 右下角相册 → 选这张图 → 手机上点确认。

## 控制台

手机浏览器打开 `http://127.0.0.1:8181`：

- 状态：签名 / 协议端 / 转换器 / 桥接 / QQ 在线，五项一目了然
- 启停：启动、重启、停止一键完成
- 人设：直接改每个会话当前生效的人设，保存后下一条消息生效
- 记忆：看记忆库文件内容
- 日志：三个组件的实时输出

## 常用

- 登录过期：相册里会有新的「QQ登录码.png」，扫它就行；也可以 `sh /root/qbot/showqr.sh` 手动存一次
- 表情包：往相册「表情包」文件夹里放 png/jpg/gif，机器人可以直接引用发送
- 换设备：整个目录搬过去重装一遍，重新扫一次码（设备指纹变了，登录态一般不通用）

## 常见问题

- **卡在「无法启动服务器，3000 端口被占用」**：协议端端口没开 reuse，重启前要等几秒。
  `start.sh` 已内置重试；如果还不行，杀掉进程后等 10 秒再启动。
- **消息不回**：先看控制台状态，桥接没连上就是 m2o 没连到 3002；再看日志页。
- **App 一清后台就断**：机器人跑在 App 的 Linux 里，清后台等于关机。加电池白名单，别划掉。
- **QQ 被顶 / 风控**：协议端登录可能触发风控，用小号、别频繁重启登录。

## 第三方组件

- 协议端 Yogurt（GPL-3.0）https://github.com/SaltifyDev/yogurt-releases
- 签名算法实现 https://github.com/gotohitori0221/NTQQ-SignerServer （pure-53644 分支）
- Milky → OneBot 转换器 milky2onebot（MIT）https://github.com/molanp/milky2onebot
- QQ 桥接 / 身份与人设插件为本项目自带

仅供学习研究，请遵守当地法律法规和平台服务条款。
