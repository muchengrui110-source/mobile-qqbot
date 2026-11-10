/**
 * 心情 / 复盘 / 关系 —— QQ 桥接里的「认知层」。
 *
 * 规则照抄 dsh-identity（大肥鱼身份系统）里的那三块，不自创：
 *   · 心情：七情（喜/怒/哀/惧/爱/恶/欲）+ 六欲（饭/安全/归属/尊重/好奇/亲近）+ 复合情绪。
 *           纯本地关键词打分，0 调用；12 小时没信号就往基线衰减，负面（怒/哀/惧/恶）24 小时才衰一半；
 *           道歉让负面乘 0.7，不是清零。心情只改「怎么说」和「想说什么」，不改事实与边界。
 *   · 关系：每个聊天一份人物卡，记谁说过话、说了多少句、多久没来（7 天半衰）。
 *           群聊把「在场的人」带进提示词；私聊不注入，只进复盘。
 *   · 复盘：每天一份短复盘（3–5 行），只吃本地统计（事件数、接话比、心情收尾、谁说得最多），
 *           不调模型；存档可查，不注入提示词（防自我强化）。
 *
 * 与它的两处不同，写在这里免得以后自己忘：
 *   1. 它那边心情是**全局一份**（一只鱼对所有人一个心情）。这里按聊天分开存，
 *      免得主人和对方两个人的心情串味。
 *   2. 它的事件流/承诺/精力/好奇没搬，复盘只用桥接能拿到的东西（条数、接话比、心情、在场的人）。
 *
 * 数据目录：<sessions.json 同目录>/psyche/（默认 D:\napcat\qq-bridge\psyche）
 *   mood/<聊天键>.json · relations/<聊天键>.json · daily/<聊天键>/<日期>.json · reflections/<聊天键>/<日期>.json
 * 纯文本 JSON，随时能打开看；所有写入都是小文件直接覆盖（崩了最多丢一条）。
 */
import {
  mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';

const BASE = 0.3;
const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const HALF_H = 12;          // 普通情绪 12 小时衰一半
const NEG_HALF_H = 24;      // 负面情绪 24 小时才衰一半（被伤着不会半天就翻篇）
const RECENT_CAP = 200;     // 关系里只留最近 200 条「谁在几点说过话」
const MOOD_BLOCK_MAX = 140;
const STANCE_BLOCK_MAX = 160;

const SEVEN = ['joy', 'anger', 'sorrow', 'fear', 'love', 'disgust', 'desire'];
const NEEDS = ['belly', 'safety', 'belonging', 'respect', 'curiosity', 'intimacy'];
const NEG = new Set(['anger', 'sorrow', 'fear', 'disgust']);

/** 关键词 → 情绪增量（照它的表，只按这边的说话习惯补了两条） */
const SIG = [
  [/(哈+|哈哈|笑死|好耶|棒|厉害|可爱|喜欢|谢谢)/, { joy: 0.12, love: 0.06, respect: 0.05 }],
  [/(滚|傻|笨|蠢|烦|闭嘴|讨厌|恶心)/, { anger: 0.16, disgust: 0.08, respect: -0.05 }],
  [/(难过|委屈|想哭|唉|难受|伤心)/, { sorrow: 0.14, belonging: -0.05 }],
  [/(怕|吓|危险|慌|紧张)/, { fear: 0.12, safety: -0.1 }],
  [/(爱你|抱抱|贴贴|亲亲|想你)/, { love: 0.16, intimacy: 0.12, belonging: 0.08 }],
  [/(恶心|吐了|膈应|太脏)/, { disgust: 0.14 }],
  [/(饿|白饭|饭|吃|宵夜|夜宵)/, { desire: 0.1, belly: 0.12 }],
  [/(为什么|怎么|是什么|求问|好奇|真的吗|居然)/, { curiosity: 0.1 }],
  [/(夸|牛|强|专业|靠谱|记得你)/, { respect: 0.12, joy: 0.06 }],
  [/(一起|群里|你们|大家|回来|在吗)/, { belonging: 0.06 }],
  [/(滚出去|别理你|孤立|退群)/, { anger: 0.14, belonging: -0.12 }],
  // 这边日常最常出现的两句，不吃信号等于心情永远不动
  [/(晚安|早上好|睡吧|早点睡)/, { belonging: 0.05, love: 0.04, safety: 0.04 }],
  [/(累了|困了|好累|撑不住|加班)/, { sorrow: 0.06, belonging: 0.04 }],
];

const TONE = {
  别扭: '嘴上别承认，先嘴硬一句再照办；句子短、有点酸。',
  得意: '语气轻快，可以小得瑟一句，别过头。',
  忐忑: '话少一点、试探着说，别急着下结论。',
  委屈: '短句、低音量，不撒娇、不诉苦。',
  抗拒: '不接梗、不卖萌；被惹到就顶回去，可以毒一点、冷一点，不用忍着；不许脏话、不许人身攻击。',
};

const clamp = (n) => Math.min(1, Math.max(0, Number(n) || 0));
const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** Windows 文件名不能带 : / \ 等；聊天键 private:123 存成 private_123 */
function safeKey(chatKey) {
  const s = String(chatKey ?? '').trim();
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120) || 'unknown';
}

function dayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    if (!statSync(path).isFile()) return fallback;
    const j = JSON.parse(readFileSync(path, 'utf8'));
    return j && typeof j === 'object' ? j : fallback;
  } catch { return fallback; }
}

function writeJson(path, obj) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
    return true;
  } catch { return false; }
}

// ────────────────────────────── 心情 ──────────────────────────────

function freshMood() {
  return {
    version: 1,
    seven: Object.fromEntries(SEVEN.map((k) => [k, BASE])),
    needs: Object.fromEntries(NEEDS.map((k) => [k, BASE])),
    at: new Date().toISOString(),
    lastBy: '',
    lastKind: '',
    events: 0,
  };
}

function loadMood(path) {
  const j = readJson(path, null);
  if (!j || !j.seven || !j.needs) return freshMood();
  return {
    version: 1,
    seven: Object.fromEntries(SEVEN.map((k) => [k, clamp(j.seven[k] ?? BASE)])),
    needs: Object.fromEntries(NEEDS.map((k) => [k, clamp(j.needs[k] ?? BASE)])),
    at: typeof j.at === 'string' ? j.at : new Date().toISOString(),
    lastBy: String(j.lastBy ?? ''),
    lastKind: String(j.lastKind ?? ''),
    events: Number(j.events ?? 0) || 0,
  };
}

/** 衰减：距上次信号越久越靠近基线；负面半衰期另算 */
function decayOf(state, now = Date.now()) {
  const s = { ...state, seven: { ...state.seven }, needs: { ...state.needs } };
  const hours = Math.max(0, (now - (Date.parse(state.at) || now)) / HOUR_MS);
  if (!hours) return s;
  for (const key of SEVEN) {
    const half = NEG.has(key) ? NEG_HALF_H : HALF_H;
    const k = Math.pow(0.5, hours / half);
    s.seven[key] = clamp(BASE + (s.seven[key] - BASE) * k);
  }
  for (const key of NEEDS) {
    const k = Math.pow(0.5, hours / HALF_H);
    s.needs[key] = clamp(BASE + (s.needs[key] - BASE) * k);
  }
  s.at = new Date(now).toISOString();
  return s;
}

/** 吃一句话的信号。role=owner 时信号放大 1.2，并多长一点归属/亲近 */
function noteText(state, text, { role = 'member', kind = 'text', now = Date.now() } = {}) {
  const s = decayOf(state, now);
  const t = String(text ?? '');
  if (!t.trim()) return s;
  const mult = role === 'owner' ? 1.2 : 1;
  for (const [re, delta] of SIG) {
    if (!re.test(t)) continue;
    for (const [k, v] of Object.entries(delta)) {
      const target = k in s.seven ? s.seven : (k in s.needs ? s.needs : null);
      if (!target) continue;
      target[k] = clamp((target[k] ?? BASE) + v * mult);
    }
  }
  if (role === 'owner') {
    s.needs.belonging = clamp(s.needs.belonging + 0.02);
    s.needs.intimacy = clamp(s.needs.intimacy + 0.02);
  }
  // 道歉/认错：火往下掉三成——不是清零，人不是不讲理，是气头上不讲理
  if (/对不起|抱歉|不好意思|是我错了|我的锅|怪我/.test(t)) {
    for (const k of ['anger', 'sorrow', 'disgust', 'fear']) {
      s.seven[k] = clamp(BASE + (s.seven[k] - BASE) * 0.7);
    }
  }
  s.lastBy = String(role);
  s.lastKind = String(kind);
  s.events += 1;
  s.at = new Date(now).toISOString();
  return s;
}

function blendsOf(state) {
  const e = state.seven;
  const n = state.needs;
  const out = [];
  if (e.love > 0.5 && e.anger > 0.3) out.push({ id: 'awkward', label: '别扭' });
  if (e.joy > 0.6 && n.respect > 0.5) out.push({ id: 'smug', label: '得意' });
  if (e.fear > 0.4 && n.curiosity > 0.5) out.push({ id: 'uneasy', label: '忐忑' });
  if (e.sorrow > 0.5 && n.belonging < 0.4) out.push({ id: 'wronged', label: '委屈' });
  if (e.disgust > 0.5 || e.anger > 0.65) out.push({ id: 'resist', label: '抗拒' });
  return out.slice(0, 2);
}

/** 语气块：只说怎么说话，不碰事实与边界（没有复合情绪就返回空） */
function toneBlock(state, chars = MOOD_BLOCK_MAX) {
  const b = blendsOf(state);
  if (!b.length) return '';
  const lines = ['# 这会儿的心情（只影响怎么说，不改事实与边界）'];
  for (const x of b) lines.push(`${x.label}：${TONE[x.label] ?? ''}`);
  let text = lines.join('\n');
  if (text.length > chars) text = `${text.slice(0, chars - 1)}…`;
  return text;
}

function stanceLines(state) {
  const labels = blendsOf(state).map((x) => x.label);
  const n = state.needs || {};
  const out = [];
  if (labels.includes('抗拒')) out.push('不想搭腔：被问就短答，不主动扩展、不接梗');
  if (labels.includes('委屈')) out.push('不想诉苦：别人关心就淡淡带过，别说漂亮话');
  if (labels.includes('别扭')) out.push('嘴上先逞强一句，再照办；别把关心说得太直');
  if (labels.includes('得意')) out.push('愿意多说两句，可以小得瑟，但别贬低别人');
  if (labels.includes('忐忑')) out.push('话留半句，先试探；拿不准就直说拿不准');
  if ((n.belly || 0) > 0.6) out.push('这会儿会惦记吃的，顺口提一句白饭/宵夜');
  if ((n.belonging || 0) < 0.25) out.push('有点想被搭话，但不会主动求关注');
  return out.slice(0, 3);
}

function stanceBlock(state, chars = STANCE_BLOCK_MAX) {
  const lines = stanceLines(state);
  if (!lines.length) return '';
  let text = ['# 此刻的状态（影响你想说什么；事实与边界不变）', ...lines.map((x) => `- ${x}`)].join('\n');
  if (text.length > chars) text = `${text.slice(0, chars - 1)}…`;
  return text;
}

/** 情绪效价 -1~+1：给复盘和以后做召回用 */
function valence(state) {
  const s = state.seven || {};
  const over = (k, w = 1) => Math.max(0, Number(s[k] || 0) - BASE) * w;
  const pos = over('joy') + over('love') + over('desire', 0.4);
  const neg = over('anger') + over('sorrow') + over('fear') + over('disgust');
  return Math.max(-1, Math.min(1, (pos - neg) / 2));
}

/** 情绪强度 0~1：七情里离基线最远的那个 */
function intensity(state) {
  const s = state.seven || {};
  const peak = Math.max(0, ...SEVEN.map((k) => Number(s[k] || 0)));
  return Math.max(0, Math.min(1, (peak - BASE) / (1 - BASE)));
}

function topEmotionOf(state) {
  const entries = Object.entries(state.seven || {});
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return { key: entries[0][0], value: entries[0][1] };
}

// ────────────────────────────── 关系 ──────────────────────────────

function freshRelations() {
  return { people: {}, recent: [], updatedAt: 0 };
}

function loadRelations(path) {
  const j = readJson(path, null);
  if (!j || typeof j !== 'object' || Array.isArray(j)) return freshRelations();
  const people = (j.people && typeof j.people === 'object' && !Array.isArray(j.people)) ? j.people : {};
  const recent = Array.isArray(j.recent)
    ? j.recent.filter((r) => r && r.uid !== undefined && r.uid !== null).slice(-RECENT_CAP)
    : [];
  return { people, recent, updatedAt: Number(j.updatedAt) || 0 };
}

function freshnessOf(lastAt, now) {
  const t = Date.parse(lastAt ?? '') || 0;
  if (!t) return 0;
  return Math.pow(0.5, Math.max(0, now - t) / DAY_MS / 7);
}

function scoreOf(p, now) {
  return (Number(p?.count) || 0) * 0.7 + freshnessOf(p?.lastAt, now) * 0.3;
}

function relationsOf(db, now, n) {
  const rows = Object.entries(db.people)
    .filter(([, p]) => p && typeof p === 'object')
    .map(([uid, p]) => {
      const t = Date.parse(p.lastAt ?? '') || 0;
      return {
        uid,
        name: String(p.name ?? ''),
        count: Math.max(0, Math.floor(Number(p.count) || 0)),
        lastAt: p.lastAt ?? '',
        role: p.role ?? '',
        kinds: { ...(p.kinds ?? {}) },
        daysAgo: t ? Math.max(0, (now - t) / DAY_MS) : null,
        score: Number(scoreOf(p, now).toFixed(4)),
      };
    })
    .sort((a, b) => b.score - a.score || b.count - a.count);
  const limit = Number(n);
  return Number.isFinite(limit) && limit > 0 ? rows.slice(0, limit) : rows;
}

function roleTag(role) {
  if (role === 'owner') return '（主人）';
  if (role === 'admin') return '（管理员）';
  return '';
}

function whenPhrase(lastAt, count, now) {
  const t = Date.parse(lastAt ?? '') || 0;
  if (!t) return `说过 ${count} 句`;
  const d = new Date(t);
  const n = new Date(now);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  if (sameDay) return `今天说过 ${count} 句`;
  if (now - t < 2 * DAY_MS) return `昨天说过 ${count} 句`;
  return `${Math.max(1, Math.floor((now - t) / DAY_MS))} 天前活跃`;
}

/** 「在场的人」卡片：按最近活跃排，群聊才注入 */
function presenceCard(db, now, n = 5) {
  const rows = Object.values(db.people)
    .filter((p) => p && typeof p === 'object' && (Date.parse(p.lastAt ?? '') || 0) > 0)
    .sort((a, b) => (Date.parse(b.lastAt ?? '') || 0) - (Date.parse(a.lastAt ?? '') || 0))
    .slice(0, Math.max(1, Number(n) || 5));
  if (!rows.length) return '';
  const lines = rows.map((p) => {
    const uid = String(p.uid ?? '');
    const name = String(p.name ?? '').trim() || `成员${uid.slice(-4)}`;
    return `· ${name}${roleTag(p.role)}：${whenPhrase(p.lastAt, Math.max(0, Math.floor(Number(p.count) || 0)), now)}`;
  });
  return `# 在场的人（按最近活跃）\n${lines.join('\n')}`;
}

// ────────────────────────── 每日计数 / 复盘 ──────────────────────────

function freshDaily(chatKey, date) {
  return { chatKey, date, inbound: 0, bot: 0, chars: 0, firstAt: 0, lastAt: 0 };
}

function loadDaily(path, chatKey, date) {
  const j = readJson(path, null);
  if (!j || typeof j !== 'object') return freshDaily(chatKey, date);
  return {
    chatKey: String(j.chatKey || chatKey),
    date: String(j.date || date),
    inbound: Math.max(0, Math.floor(Number(j.inbound) || 0)),
    bot: Math.max(0, Math.floor(Number(j.bot) || 0)),
    chars: Math.max(0, Math.floor(Number(j.chars) || 0)),
    firstAt: Number(j.firstAt) || 0,
    lastAt: Number(j.lastAt) || 0,
  };
}

// ────────────────────────────── 门面 ──────────────────────────────

/**
 * @param {{ dir: string, log?: Function }} options
 */
export function createPsyche({ dir, log } = {}) {
  if (!dir) throw new Error('createPsyche: 需要 dir');
  const root = String(dir);
  const say = (level, ...args) => {
    try { if (typeof log?.[level] === 'function') log[level](...args); } catch { /* 日志失败不影响 */ }
  };

  const moodPath = (chatKey) => join(root, 'mood', `${safeKey(chatKey)}.json`);
  const relPath = (chatKey) => join(root, 'relations', `${safeKey(chatKey)}.json`);
  const dailyPath = (chatKey, date) => join(root, 'daily', safeKey(chatKey), `${date}.json`);
  const reflectionPath = (chatKey, date) => join(root, 'reflections', safeKey(chatKey), `${date}.json`);

  function moodOf(chatKey, now = Date.now()) {
    return decayOf(loadMood(moodPath(chatKey)), now);
  }

  function saveMood(chatKey, state) {
    if (!writeJson(moodPath(chatKey), state)) say('warn', '心情写入失败：%s', safeKey(chatKey));
    return state;
  }

  /** 收到一句话：心情吃信号 + 关系记一笔 + 当天计数。命令、纯表情符号不进心情。 */
  function noteIncoming(chatKey, text, opts = {}) {
    const { uid = '', name = '', role = 'member', senderRole = '', isCommand = false, now = Date.now() } = opts;
    const t = String(text ?? '').trim();
    let mood = null;
    if (t && !isCommand) {
      mood = saveMood(chatKey, noteText(loadMood(moodPath(chatKey)), t, { role, now }));
    }
    if (uid && String(uid).trim()) {
      const u = String(uid);
      const db = loadRelations(relPath(chatKey));
      const p = (db.people[u] && typeof db.people[u] === 'object') ? db.people[u] : { uid: u, name: '', count: 0, lastAt: '', kinds: {} };
      p.uid = u;
      p.count = Math.max(0, Math.floor(Number(p.count) || 0)) + 1;
      p.lastAt = new Date(now).toISOString();
      if (name) p.name = String(name).trim().slice(0, 32);
      p.kinds = (p.kinds && typeof p.kinds === 'object') ? p.kinds : {};
      p.kinds.text = Math.max(0, Math.floor(Number(p.kinds.text) || 0)) + 1;
      if (senderRole === 'owner' || senderRole === 'admin' || senderRole === 'member') p.role = senderRole;
      db.people[u] = p;
      db.recent.push({ uid: u, at: now });
      if (db.recent.length > RECENT_CAP) db.recent = db.recent.slice(-RECENT_CAP);
      db.updatedAt = now;
      if (!writeJson(relPath(chatKey), db)) say('warn', '关系写入失败：%s', safeKey(chatKey));
    }
    const date = dayStr(new Date(now));
    const daily = loadDaily(dailyPath(chatKey, date), chatKey, date);
    if (t && !isCommand) {
      daily.inbound += 1;
      daily.chars += t.length;
      daily.firstAt = daily.firstAt || now;
      daily.lastAt = now;
    }
    writeJson(dailyPath(chatKey, date), daily);
    return { mood, changed: Boolean(mood) };
  }

  /** 自己的回复：只记当天计数，不反哺心情（心情只吃对方说的话） */
  function noteReply(chatKey, text, { now = Date.now() } = {}) {
    const t = String(text ?? '').trim();
    if (!t) return;
    const date = dayStr(new Date(now));
    const daily = loadDaily(dailyPath(chatKey, date), chatKey, date);
    daily.bot += 1;
    daily.chars += t.length;
    daily.lastAt = now;
    writeJson(dailyPath(chatKey, date), daily);
  }

  /** 提示词附加块：语气 + 状态（心情），群聊再加在场的人 */
  function promptExtras(chatKey, { mood = true, relations = true, now = Date.now() } = {}) {
    const parts = [];
    if (mood) {
      const s = moodOf(chatKey, now);
      const t = toneBlock(s);
      const st = stanceBlock(s);
      if (t) parts.push(t);
      if (st) parts.push(st);
    }
    if (relations && String(chatKey).startsWith('group:')) {
      const card = presenceCard(loadRelations(relPath(chatKey)), now, 5);
      if (card) parts.push(card);
    }
    return parts.join('\n\n');
  }

  /** 状态指纹：只在「复合情绪或内容倾向」变了才重注入，平时不动 */
  function signature(chatKey, now = Date.now()) {
    const s = moodOf(chatKey, now);
    const labels = blendsOf(s).map((x) => x.label);
    const stance = stanceLines(s);
    if (!labels.length && !stance.length) return '';
    return [...labels, ...stance].join('|');
  }

  /** 当天复盘（本地，0 token）：3–5 行，只存档不注入 */
  function reflect(chatKey, date = dayStr(), { now = Date.now() } = {}) {
    const daily = loadDaily(dailyPath(chatKey, date), chatKey, date);
    const mood = moodOf(chatKey, now);
    const db = loadRelations(relPath(chatKey));
    const top = relationsOf(db, now, 1)[0] ?? null;
    const lines = [];
    const ratio = daily.inbound ? (daily.bot / daily.inbound) : 0;

    if (!daily.inbound && !daily.bot) {
      lines.push('今天没聊上。');
    } else {
      lines.push(`对方说了 ${daily.inbound} 句，我回了 ${daily.bot} 句；接话比 ${daily.inbound ? ratio.toFixed(2) : '—'}。`);
    }
    const topMood = topEmotionOf(mood);
    if (topMood && topMood.value > BASE + 0.08) {
      const names = { joy: '高兴', anger: '上火', sorrow: '低落', fear: '发怵', love: '亲昵', disgust: '嫌', desire: '嘴馋' };
      lines.push(`收尾时心里偏${names[topMood.key] ?? topMood.key}（${round2(topMood.value)}）。`);
    } else {
      lines.push('收尾时心情平稳。');
    }
    if (daily.inbound >= 10 && daily.bot < Math.max(1, Math.floor(daily.inbound * 0.05))) {
      lines.push('话不少，我回得太少，明天有人问就接一句。');
    } else if (daily.inbound) {
      lines.push('节奏正常，别为了刷存在感硬接。');
    }
    if (top && top.name) lines.push(`今天说话最多的是${top.name}（${top.count} 句）。`);
    if (daily.lastAt) {
      const last = new Date(daily.lastAt);
      lines.push(`最后一条到 ${String(last.getHours()).padStart(2, '0')}:${String(last.getMinutes()).padStart(2, '0')}。`);
    }
    const rec = {
      chatKey: String(chatKey),
      date,
      at: new Date(now).toISOString(),
      source: 'local',
      lines: lines.slice(0, 5),
      metrics: {
        inbound: daily.inbound,
        bot: daily.bot,
        ratio: Number(ratio.toFixed(2)),
        topPerson: top?.name ?? '',
        topMood: topMood?.key ?? '',
        valence: round2(valence(mood)),
        intensity: round2(intensity(mood)),
      },
    };
    writeJson(reflectionPath(chatKey, date), rec);
    return rec;
  }

  /** 到点就补复盘：扫 daily/ 下今天有活动的聊天，没生成过就生成 */
  function maybeReflect({ enabled = true, hour = 22, now = Date.now() } = {}) {
    const ran = [];
    if (!enabled) return ran;
    const d = new Date(now);
    if (d.getHours() < Number(hour)) return ran;
    const date = dayStr(d);
    const dailyRoot = join(root, 'daily');
    let dirs = [];
    try { dirs = readdirSync(dailyRoot, { withFileTypes: true }).filter((x) => x.isDirectory()); } catch { return ran; }
    for (const ent of dirs) {
      const file = join(dailyRoot, ent.name, `${date}.json`);
      if (!existsSync(file)) continue;
      const daily = readJson(file, null);
      if (!daily || (!daily.inbound && !daily.bot)) continue;
      const chatKey = String(daily.chatKey || '');
      if (!chatKey) continue;
      if (existsSync(reflectionPath(chatKey, date))) continue;
      try {
        ran.push(reflect(chatKey, date, { now }));
      } catch (error) {
        say('warn', '复盘失败（%s）：%s', ent.name, error?.message ?? error);
      }
    }
    if (ran.length) say('info', '复盘已生成：%s', ran.map((r) => `${r.chatKey}（${r.lines.length} 行）`).join('、'));
    return ran;
  }

  /** 最近 n 天复盘（页面/以后做周报用） */
  function listReflections(chatKey, n = 7, { now = Date.now() } = {}) {
    const out = [];
    const count = Math.max(1, Math.min(30, Number(n) || 7));
    for (let i = 0; i < count; i += 1) {
      const d = dayStr(new Date(now - i * DAY_MS));
      const rec = readJson(reflectionPath(chatKey, d), null);
      if (rec) out.push(rec);
    }
    return out;
  }

  function summary() {
    const out = { dir: root, chats: 0, moodChats: 0, people: 0, reflectionsToday: 0, today: dayStr(), moodTop: [], recentReflections: [] };
    try {
      const mdir = join(root, 'mood');
      for (const f of readdirSync(mdir)) {
        if (!f.endsWith('.json')) continue;
        out.moodChats += 1;
        const s = readJson(join(mdir, f), null);
        if (!s) continue;
        const b = blendsOf({ seven: s.seven ?? {}, needs: s.needs ?? {} }).map((x) => x.label);
        if (b.length) out.moodTop.push({ chat: f.replace(/\.json$/, ''), blends: b });
      }
    } catch { /* 没有目录就是空 */ }
    try {
      const rdir = join(root, 'relations');
      for (const f of readdirSync(rdir)) {
        if (!f.endsWith('.json')) continue;
        const db = readJson(join(rdir, f), null);
        if (db?.people) out.people += Object.keys(db.people).length;
      }
    } catch { /* 空 */ }
    try {
      const refRoot = join(root, 'reflections');
      for (const chat of readdirSync(refRoot)) {
        const dir2 = join(refRoot, chat);
        let files = [];
        try { files = readdirSync(dir2); } catch { continue; }
        out.reflectionsToday += files.filter((f) => f === `${out.today}.json`).length;
      }
    } catch { /* 空 */ }
    return out;
  }

  return {
    dir: root,
    noteIncoming,
    noteReply,
    moodOf,
    promptExtras,
    signature,
    reflect,
    maybeReflect,
    listReflections,
    summary,
    _internal: { safeKey, dayStr, decayOf, blendsOf, toneBlock, stanceBlock, valence, intensity },
  };
}

export default createPsyche;
