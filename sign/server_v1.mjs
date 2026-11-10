import http from 'node:http';
import { computeSign53644, APP_INFO_V2 } from './sign.js';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const VERSION = process.env.VERSION || APP_INFO_V2.current_version;
const QUA = process.env.QUA || APP_INFO_V2.qua;

const appinfo = {
  Os: APP_INFO_V2.os,
  Kernel: APP_INFO_V2.kernel,
  VendorOs: APP_INFO_V2.vendor_os,
  CurrentVersion: VERSION,
  MiscBitmap: APP_INFO_V2.sdk_info.misc_bit_map,
  PTVersion: APP_INFO_V2.pt_version,
  SsoVersion: APP_INFO_V2.sso_version,
  PackageName: APP_INFO_V2.package_name,
  WtLoginSdk: APP_INFO_V2.sdk_info.sdk_version,
  AppId: APP_INFO_V2.app_id,
  SubAppId: APP_INFO_V2.sub_app_id,
  AppIdQrCode: APP_INFO_V2.sub_app_id,
  AppClientVersion: APP_INFO_V2.app_client_version,
  MainSigMap: APP_INFO_V2.sdk_info.main_sig_map,
  SubSigMap: APP_INFO_V2.sdk_info.sub_sig_map,
  NTLoginType: 1,
  platform: 'Linux',
  version: VERSION,
};

function json(res, obj, code = 200) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': body.length });
  res.end(body);
}

function parseParams(u, bodyObj) {
  const q = u.searchParams;
  const pick = (names) => {
    for (const n of names) {
      if (bodyObj && bodyObj[n] != null && bodyObj[n] !== '') return bodyObj[n];
      if (q.get(n)) return q.get(n);
    }
    return '';
  };
  return {
    cmd: String(pick(['cmd', 'command']) || ''),
    seq: Number(pick(['seq', 'sequence']) || 0),
    src: String(pick(['src', 'body'])),
  };
}

let counter = 0;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const path = u.pathname;
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let bodyObj = null;
    if (chunks.length) {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text) {
        try { bodyObj = JSON.parse(text); } catch { bodyObj = null; }
      }
    }

    if (path === '/api/sign/appinfo' || path === '/appinfo' || path === '/api/sign/sec-sign/appinfo_v2') {
      console.log('[appinfo] requested');
      if (path.endsWith('appinfo_v2')) return json(res, APP_INFO_V2);
      return json(res, appinfo);
    }
    if (path === '/health') return json(res, { status: 'ok' });
    if (path === '/stats') return json(res, { calls: counter });

    if (req.method === 'POST' || req.method === 'GET') {
      const p = parseParams(u, bodyObj);
      if (!p.cmd) return json(res, { error: 'missing cmd' }, 400);
      const srcHex = (p.src || '').trim();
      if (srcHex && !/^[0-9a-fA-F]*$/.test(srcHex)) return json(res, { error: 'bad hex' }, 400);
      const body = srcHex ? Buffer.from(srcHex, 'hex') : Buffer.alloc(0);
      const r = computeSign53644(body, QUA);
      counter++;
      console.log(`[sign] cmd=${p.cmd} seq=${p.seq} len=${body.length} sign=${r.sec_sign.slice(0, 16)}`);
      if (path.includes('sec-sign')) {
        return json(res, {
          code: 0,
          message: null,
          value: { sec_sign: r.sec_sign, sec_token: r.sec_token, sec_extra: r.sec_extra },
        });
      }
      return json(res, {
        platform: 'Linux',
        version: VERSION,
        value: { sign: r.sec_sign, token: r.sec_token, extra: r.sec_extra },
      });
    }
    json(res, { error: 'not found' }, 404);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`sign server on http://${HOST}:${PORT} version=${VERSION} qua=${QUA}`);
});


