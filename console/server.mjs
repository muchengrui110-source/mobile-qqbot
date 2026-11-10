import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = '/root/qbot';
const LOGS = path.join(ROOT, 'logs');
const PERSONAS = '/root/.dsh/qq-bridge/personas.json';
const MNEMON_DIR = '/root/.mnemon';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.QBOT_PORT || 8181);
const HOST = process.env.QBOT_HOST || '127.0.0.1';

function readHexPorts() {
  const ports = new Set();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 4) continue;
      const local = cols[1];
      const state = cols[3];
      if (state !== '0A') continue;
      const portHex = local.split(':')[1];
      if (portHex) ports.add(parseInt(portHex, 16));
    }
  }
  return ports;
}

function procList() {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync('/proc'); } catch { return out; }
  for (const d of dirs) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
      if (cmd) out.push({ pid: Number(d), cmd });
    } catch { /* ignore */ }
  }
  return out;
}

function tail(file, n = 40) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    return lines.slice(Math.max(0, lines.length - n)).join('\n');
  } catch {
    return '(读不到 ' + file + ')';
  }
}

function status() {
  const ports = readHexPorts();
  const procs = procList();
  const has = (kw) => procs.some((p) => p.cmd.includes(kw));
  const yogurtLog = tail(path.join(LOGS, 'yogurt.log'), 60);
  const m2oLog = tail(path.join(LOGS, 'm2o.log'), 60);
  const online = /已上线/.test(yogurtLog);
  const waitingQr = /WAITING_FOR_SCAN|二维码状态/.test(yogurtLog) && !online;
  const bridgeConnected = /Connected to Onebot/i.test(m2oLog);
  return {
    sign: ports.has(8080) || has('server_v1.mjs'),
    yogurt: ports.has(3000) || has('yogurt.kexe'),
    m2o: has('main.py'),
    bridge: bridgeConnected,
    online,
    waitingQr,
    ports: [...ports].sort((a, b) => a - b),
    procs: procs.filter((p) => /sign\/server_v1|yogurt.kexe|main.py|dsh web/.test(p.cmd)).map((p) => p.cmd.slice(0, 120)),
  };
}

function run(cmd) {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', cmd], { stdio: 'ignore', detached: true });
    child.unref();
    resolve(true);
  });
}

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function personaSummary() {
  const data = readJsonFile(PERSONAS);
  if (!data) return { ok: false, error: '读不到 ' + PERSONAS };
  const chats = Object.entries(data.chats || {}).map(([key, value]) => ({
    key,
    active: value.active || '',
    modes: Object.keys(value.modes || {}),
  }));
  return {
    ok: true,
    file: PERSONAS,
    default: data.default || {},
    chats,
    characters: Object.keys(data.characters || {}),
  };
}

function personaDetail(chatKey) {
  const data = readJsonFile(PERSONAS);
  if (!data) return { ok: false, error: '读不到 ' + PERSONAS };
  if (!chatKey) return { ok: true, default: data.default || {} };
  const chat = (data.chats || {})[chatKey];
  if (!chat) return { ok: false, error: '没有这个会话：' + chatKey };
  return { ok: true, chatKey, active: chat.active || '', modes: chat.modes || {} };
}

function savePersona(body) {
  const data = readJsonFile(PERSONAS);
  if (!data) return { ok: false, error: '读不到 ' + PERSONAS };
  const { chatKey, mode, prompt, active } = body || {};
  if (!chatKey || !mode) return { ok: false, error: '缺 chatKey 或 mode' };
  data.chats = data.chats || {};
  data.chats[chatKey] = data.chats[chatKey] || { modes: {} };
  data.chats[chatKey].modes = data.chats[chatKey].modes || {};
  const old = data.chats[chatKey].modes[mode] || { title: mode };
  data.chats[chatKey].modes[mode] = { ...old, title: old.title || mode, prompt: String(prompt ?? '') };
  if (active) data.chats[chatKey].active = active;
  try {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    fs.copyFileSync(PERSONAS, PERSONAS + '.bak-console-' + stamp);
  } catch { /* ignore */ }
  fs.writeFileSync(PERSONAS, JSON.stringify(data, null, 2), 'utf8');
  return { ok: true };
}

function walk(dir, out, limit = 60) {
  if (out.length >= limit) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (out.length >= limit) break;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, limit);
    else {
      try {
        const st = fs.statSync(full);
        out.push({ path: full, size: st.size, mtime: st.mtime.toISOString() });
      } catch { /* ignore */ }
    }
  }
  return out;
}

function sendJson(res, obj, code = 200) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    try {
      const html = fs.readFileSync(path.join(HERE, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': html.length });
      return res.end(html);
    } catch (e) {
      res.writeHead(500); return res.end('index.html missing');
    }
  }

  if (req.method === 'GET' && p === '/api/status') return sendJson(res, status());

  if (req.method === 'GET' && p === '/api/logs') {
    const name = url.searchParams.get('name') || 'yogurt';
    const allow = { sign: 'sign.log', yogurt: 'yogurt.log', m2o: 'm2o.log' };
    if (!allow[name]) return sendJson(res, { ok: false, error: 'bad name' }, 400);
    return sendJson(res, { ok: true, name, text: tail(path.join(LOGS, allow[name]), 80) });
  }

  if (req.method === 'GET' && p === '/api/persona') {
    const chatKey = url.searchParams.get('chat');
    if (chatKey) return sendJson(res, personaDetail(chatKey));
    return sendJson(res, personaSummary());
  }

  if (req.method === 'GET' && p === '/api/memory') {
    const files = walk(MNEMON_DIR, []);
    const pick = url.searchParams.get('file');
    if (pick) {
      if (!pick.startsWith(MNEMON_DIR)) return sendJson(res, { ok: false, error: 'bad path' }, 400);
      try {
        const text = fs.readFileSync(pick, 'utf8').slice(0, 200000);
        return sendJson(res, { ok: true, file: pick, text });
      } catch (e) {
        return sendJson(res, { ok: false, error: String(e.message) });
      }
    }
    const qqWorkspaces = walk('/root/.dsh/qq-workspaces', [], 40);
    return sendJson(res, { ok: true, files, qqWorkspaces });
  }

  if (req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { /* ignore */ }
      if (p === '/api/action') {
        const doIt = body.do;
        if (doIt === 'start') { run('sh /root/qbot/start.sh >/dev/null 2>&1'); return sendJson(res, { ok: true }); }
        if (doIt === 'stop') {
          run('pkill -f "sign/server_v1.mjs"; pkill -f yogurt.kexe; pkill -f "m2o/main.py"');
          return sendJson(res, { ok: true });
        }
        if (doIt === 'restart') {
          run('pkill -f "sign/server_v1.mjs"; pkill -f yogurt.kexe; pkill -f "m2o/main.py"; sleep 1; sh /root/qbot/start.sh >/dev/null 2>&1');
          return sendJson(res, { ok: true });
        }
        return sendJson(res, { ok: false, error: 'unknown action' }, 400);
      }
      if (p === '/api/persona') return sendJson(res, savePersona(body));
      return sendJson(res, { ok: false, error: 'not found' }, 404);
    });
    return;
  }

  sendJson(res, { ok: false, error: 'not found' }, 404);
});

server.listen(PORT, HOST, () => {
  console.log(`qbot console http://${HOST}:${PORT}`);
});


