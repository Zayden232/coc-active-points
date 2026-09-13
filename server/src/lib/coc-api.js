// Clash of Clans 官方 API 客户端(只读)
//
// 约定:
//   - token 只从服务器 .env 读(COC_API_TOKEN), 与服务器出网 IP 绑定; 绝不下发前端、不写日志。
//   - 官方响应本身带 cache-control: max-age=600, 这里再做 10 分钟进程内缓存 + 节流,
//     避免预览点几次就把额度烧掉(官方对 key 有节流)。
//   - 只做数据获取与字段归一, 不做任何写库动作(写库在 routes/coc.routes.js)。
import { config } from '../config.js';

const CACHE_TTL_MS = 10 * 60 * 1000; // 与官方 max-age 对齐
const THROTTLE_MS = 120; // ~8 req/s, 官方口径约 10/s

const cache = new Map(); // url -> { at, body }

export function cocConfigured() {
  return !!config.cocToken;
}

export function cocApiBase() {
  return config.cocApiBase;
}

/** '#2G9JCRQ9Y' / '2G9JCRQ9Y' -> '#2G9JCRQ9Y' */
export function normalizeTag(tag) {
  const s = String(tag == null ? '' : tag)
    .trim()
    .toUpperCase()
    .replace(/^#+/, '');
  return s ? '#' + s : '';
}

function encodeTag(tag) {
  return encodeURIComponent(normalizeTag(tag));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function clearCocCache() {
  cache.clear();
}

async function request(path) {
  if (!cocConfigured()) {
    const e = new Error('未配置 COC_API_TOKEN');
    e.reason = 'notConfigured';
    throw e;
  }
  const url = `${config.cocApiBase}${path}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { body: hit.body, cached: true };
  }

  await sleep(THROTTLE_MS);
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.cocToken}`, Accept: 'application/json' },
    });
  } catch (err) {
    // fetch 的异常信息里可能带 URL, 但不含 token(header 不会被回显)
    throw new Error(`官方 API 网络错误: ${err.message}`);
  }

  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    const reason = (body && body.reason) || `HTTP ${res.status}`;
    const message = (body && body.message) || '';
    const e = new Error(`官方 API: ${reason}${message ? ' - ' + message : ''}`);
    e.status = res.status;
    e.reason = reason;
    throw e;
  }

  cache.set(url, { at: Date.now(), body });
  return { body, cached: false };
}

export async function cocGetClan(tag) {
  const { body, cached } = await request(`/clans/${encodeTag(tag)}`);
  return { clan: body, cached };
}

export async function cocGetMembers(tag) {
  const { body, cached } = await request(`/clans/${encodeTag(tag)}/members`);
  return { items: (body && body.items) || [], cached };
}

export async function cocGetCurrentWar(tag) {
  const { body, cached } = await request(`/clans/${encodeTag(tag)}/currentwar`);
  return { war: body, cached };
}

export async function cocGetPlayer(tag) {
  const { body, cached } = await request(`/players/${encodeTag(tag)}`);
  return { player: body, cached };
}

/**
 * 官方玩家字段 warPreference: 'in' = 参战(绿牌) / 'out' = 休战(红牌) / 其它 = 未知
 * 返回我们库里的 status(0 绿牌 / 1 红牌), 未知返回 null。
 */
export function warPreferenceToStatus(player) {
  const p = player && player.warPreference;
  if (p === 'in') return 0;
  if (p === 'out') return 1;
  return null;
}

/** 官方玩家资料 -> 精简字段(按标签导入用) */
export function slimPlayer(player) {
  const p = player || {};
  const clan = p.clan || null;
  return {
    tag: normalizeTag(p.tag),
    name: String(p.name || ''),
    town_hall: p.townHallLevel ?? null,
    exp_level: p.expLevel ?? null,
    trophies: p.trophies ?? null,
    role: p.role || '',
    clan_tag: normalizeTag(clan && clan.tag),
    clan_name: (clan && clan.name) || '',
    war_preference: p.warPreference || null,
    donations: p.donations ?? null,
  };
}

// 官方标签字符集(不含 O/I/B 等易混字符); 用户没写 '#' 时用它兜底判断, 避免把随笔文字当成标签
const OFFICIAL_TAG_RE = /^[0289PYLQGRJCUV]{5,12}$/;
const LOOSE_TAG_RE = /^[0-9A-Z]{3,12}$/;

/**
 * 从自由文本里解析玩家标签(按标签导入用)。
 *   '#ABC123' / 'ABC123' / 逗号 / 空格 / 换行 / 顿号 分隔都支持。
 *   写了 '#' 的按宽松规则认(方便测试标签), 没写 '#' 的必须符合官方字符集, 防止把备注文字当标签。
 * 返回 { tags: [ '#XXX', ... ], invalid: [ 原始片段, ... ] }, tags 已去重并截断到 limit。
 */
export function parsePlayerTags(text, limit = 30) {
  const parts = String(text == null ? '' : text)
    .split(/[^#0-9A-Za-z]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const tags = [];
  const invalid = [];
  const seen = new Set();
  let dropped = 0;
  for (const raw of parts) {
    const hasHash = raw.startsWith('#');
    const body = raw.replace(/^#+/, '').toUpperCase();
    const ok = hasHash ? LOOSE_TAG_RE.test(body) : OFFICIAL_TAG_RE.test(body);
    if (!ok) {
      invalid.push(raw.slice(0, 24));
      continue;
    }
    const tag = '#' + body;
    if (seen.has(tag)) continue;
    seen.add(tag);
    if (tags.length < limit) tags.push(tag);
    else dropped += 1;
  }
  return { tags, invalid, truncated: dropped > 0, dropped };
}

/** 只取同步需要的字段, 避免把整个响应塞进接口返回 */
export function slimMember(m) {
  return {
    tag: normalizeTag(m && m.tag),
    name: String((m && m.name) || ''),
    role: (m && m.role) || '',
    townHallLevel: (m && m.townHallLevel) ?? null,
    trophies: (m && m.trophies) ?? null,
    donations: (m && m.donations) ?? null,
    donationsReceived: (m && m.donationsReceived) ?? null,
    clanRank: (m && m.clanRank) ?? null,
  };
}
