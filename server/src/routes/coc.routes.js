// 部落冲突官方 API 同步(仅管理员)
//
// 设计原则(第 1 步: 只读预览 + 显式勾选后才写库):
//   GET  /api/coc/status   -> 配置与最近一次同步概况
//   POST /api/coc/preview  -> 拉官方数据 + 与本地库对比, 返回差异报告(**不写库**)
//   POST /api/coc/apply    -> 只按请求里显式列出的 actions 写库(幂等 + 审计)
//
// 官方数据能给我们什么 / 不能给什么:
//   ✅ 成员名单(谁在部落) -> "在部落 / 已离开" 可自动判定
//   ✅ 每个成员的 warPreference('in'=绿牌 / 'out'=红牌) —— 注意成员名单接口**不含**该字段,
//      必须对每个成员单独请求 /players/{tag}
//   ✅ 当前部落战参战名单与每人出手/星数(供将来自动记分)
//   ❌ 离开时间、内部备注、绿红牌变更历史(只能靠两次快照对比)
import { Router } from 'express';
import { query, getOne, run } from '../db.js';
import { ok, fail } from '../lib/respond.js';
import { requireAdmin } from '../lib/auth.js';
import { actorOf } from '../lib/audit.js';
import { getSetting } from '../lib/settings.js';
import { businessDate, nextRedSince } from '../lib/member-status.js';
import {
  cocConfigured,
  clearCocCache,
  cocGetClan,
  cocGetMembers,
  cocGetPlayer,
  cocGetCurrentWar,
  normalizeTag,
  parsePlayerTags,
  slimPlayer,
  warPreferenceToStatus,
  slimMember,
} from '../lib/coc-api.js';

export const router = Router();

const MAX_MEMBERS_PER_RUN = 60; // 一次最多同步多少人(每人都要一次玩家请求)
const MAX_LOOKUP_TAGS = 30; // 一次最多按标签查多少人
const STATUS_TEXT = { 0: '绿牌', 1: '红牌', 2: '离开' };

// 成员状态审计(与本项目 members.routes.js 同表同字段; 这里为本模块单独写一份, 避免改动已验证的代码)
async function logMemberStatus({ member, newStatus, newRedSince, reason, batchId, actor }) {
  const a = actor || { id: null, username: '', role: '' };
  await run(
    'INSERT INTO member_status_logs (member_id, old_status, new_status, old_red_since, new_red_since, reason, batch_id, actor_user_id, actor_username, actor_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      member.id,
      member.status === undefined || member.status === null ? null : Number(member.status),
      newStatus === undefined ? null : newStatus,
      member.red_since || null,
      newRedSince || null,
      String(reason || '').slice(0, 255),
      String(batchId || '').slice(0, 64),
      a.id || null,
      String(a.username || '').slice(0, 64),
      String(a.role || '').slice(0, 16),
    ]
  );
}

function looksLikeTag(v) {
  return /^#[0-9A-Z]{3,12}$/i.test(String(v || '').trim());
}

async function localMembers() {
  return query(
    'SELECT id, nickname, tag, status, red_since, deleted_at FROM members WHERE deleted_at IS NULL ORDER BY id'
  );
}

/** 本地在库成员索引: 标签优先, 昵称兜底(与导入页/批量导入同一套匹配口径) */
async function localIndex() {
  const rows = await localMembers();
  const byTag = new Map(rows.filter((m) => looksLikeTag(m.tag)).map((m) => [normalizeTag(m.tag), m]));
  const byName = new Map(rows.map((m) => [String(m.nickname || '').trim().toLowerCase(), m]));
  const find = (tag, name) =>
    (tag ? byTag.get(normalizeTag(tag)) : null) || byName.get(String(name || '').trim().toLowerCase()) || null;
  return { rows, byTag, byName, find };
}

function memberBrief(m) {
  if (!m) return null;
  return {
    id: m.id,
    nickname: m.nickname,
    tag: m.tag || '',
    status: Number(m.status),
    status_text: STATUS_TEXT[Number(m.status)] || '?',
  };
}

/**
 * 拉官方数据并与本地库比对。
 * 返回 { clan, members, leaves, counts, war, cached }
 */
async function buildDiff() {
  if (!cocConfigured()) {
    const e = new Error('尚未配置 COC_API_TOKEN（服务器 .env）');
    e.statusCode = 400;
    throw e;
  }
  const clanTag = normalizeTag(await getSetting('coc_clan_tag', ''));
  if (!clanTag) {
    const e = new Error('尚未配置部落标签（设置页填写后保存）');
    e.statusCode = 400;
    throw e;
  }

  const { clan, cached: clanCached } = await cocGetClan(clanTag);
  const { items, cached: membersCached } = await cocGetMembers(clanTag);
  const list = items.slice(0, MAX_MEMBERS_PER_RUN);

  const { rows: local, byTag, byName } = await localIndex();

  const rows = [];
  let cachedAny = clanCached || membersCached;
  for (const raw of list) {
    const api = slimMember(raw);
    let hit = api.tag ? byTag.get(api.tag) : null;
    let matchedBy = hit ? 'tag' : '';
    if (!hit) {
      hit = byName.get(api.name.trim().toLowerCase()) || null;
      matchedBy = hit ? 'nickname' : '';
    }

    let target = null;
    let preference = null;
    try {
      const { player, cached } = await cocGetPlayer(api.tag);
      cachedAny = cachedAny || cached;
      preference = player ? player.warPreference || null : null;
      target = warPreferenceToStatus(player);
    } catch (e) {
      // 单个成员查询失败不影响整份报告
      preference = `error:${e.reason || e.message}`;
    }

    const actions = [];
    if (!hit) {
      actions.push({
        type: 'add',
        nickname: api.name,
        tag: api.tag,
        status: target === null ? 0 : target,
        reason: matchedBy ? '' : '游戏内新成员',
      });
    } else {
      if (api.tag && normalizeTag(hit.tag) !== api.tag) {
        actions.push({ type: 'tag', member_id: hit.id, nickname: hit.nickname, tag: api.tag, reason: '补齐/修正游戏标签' });
      }
      if (target !== null && Number(hit.status) !== target) {
        actions.push({
          type: 'status',
          member_id: hit.id,
          nickname: hit.nickname,
          from: Number(hit.status),
          to: target,
          reason: `游戏内战意 ${preference} -> ${STATUS_TEXT[target]}`,
        });
      }
      if (Number(hit.status) === 2) {
        actions.push({ type: 'rejoin', member_id: hit.id, nickname: hit.nickname, reason: '本地记为离开, 但仍在部落' });
      }
    }

    rows.push({
      api,
      war_preference: preference,
      local_id: hit ? hit.id : null,
      local_nickname: hit ? hit.nickname : '',
      local_tag: hit ? hit.tag : '',
      local_status: hit ? Number(hit.status) : null,
      local_status_text: hit ? STATUS_TEXT[Number(hit.status)] || '?' : '',
      matched_by: matchedBy,
      target_status: target,
      target_status_text: target === null ? '' : STATUS_TEXT[target],
      actions,
    });
  }

  // 本地在部落 -> 官方名单里没有 => 建议记为"离开"
  const apiTags = new Set(list.map((m) => slimMember(m).tag));
  const apiNames = new Set(list.map((m) => slimMember(m).name.trim().toLowerCase()));
  const leaves = local
    .filter((m) => Number(m.status) !== 2)
    .filter((m) => {
      const t = looksLikeTag(m.tag) ? normalizeTag(m.tag) : '';
      if (t && apiTags.has(t)) return false;
      if (apiNames.has(String(m.nickname || '').trim().toLowerCase())) return false;
      return true;
    })
    .map((m) => ({
      type: 'leave',
      member_id: m.id,
      nickname: m.nickname,
      tag: m.tag,
      reason: '官方成员名单中已没有此人',
    }));

  let war = null;
  try {
    const { war: w } = await cocGetCurrentWar(clanTag);
    if (w && w.state && w.state !== 'notInWar') {
      const own = ((w.clan && w.clan.members) || []).map((m) => ({
        tag: normalizeTag(m.tag),
        name: m.name,
        map_position: m.mapPosition,
        attacks: ((m.attacks || []).length),
        stars: (m.attacks || []).reduce((s, a) => s + Number(a.stars || 0), 0),
        three_stars: (m.attacks || []).filter((a) => Number(a.stars) === 3).length,
      }));
      war = { state: w.state, teamSize: w.teamSize, attacksPerMember: w.attacksPerMember, members: own };
    } else {
      war = { state: (w && w.state) || 'notInWar', members: [] };
    }
  } catch (e) {
    war = { state: 'error', error: e.message, members: [] };
  }

  const counts = {
    api_members: list.length,
    matched: rows.filter((r) => r.local_id).length,
    new_members: rows.filter((r) => !r.local_id).length,
    status_changes: rows.reduce((n, r) => n + r.actions.filter((a) => a.type === 'status').length, 0),
    tag_fixes: rows.reduce((n, r) => n + r.actions.filter((a) => a.type === 'tag').length, 0),
    leaves: leaves.length,
    pref_unknown: rows.filter((r) => r.target_status === null).length,
  };

  return {
    clan: {
      tag: normalizeTag(clan && clan.tag),
      name: (clan && clan.name) || '',
      level: (clan && clan.clanLevel) ?? null,
      members: (clan && clan.members) ?? null,
      war_wins: (clan && clan.warWins) ?? null,
      war_win_streak: (clan && clan.warWinStreak) ?? null,
    },
    truncated: items.length > MAX_MEMBERS_PER_RUN,
    members: rows,
    leaves,
    counts,
    war,
    cached: cachedAny,
  };
}

// 配置与最近同步概况
router.get('/status', requireAdmin, async (req, res) => {
  try {
    const clanTag = normalizeTag(await getSetting('coc_clan_tag', ''));
    const inTribe = await getOne('SELECT COUNT(*) AS c FROM members WHERE status != 2 AND deleted_at IS NULL');
    ok(res, {
      configured: cocConfigured(),
      clan_tag: clanTag,
      local_in_tribe: Number(inTribe.c),
      max_members_per_run: MAX_MEMBERS_PER_RUN,
      max_lookup_tags: MAX_LOOKUP_TAGS,
    });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 差异报告(只读; 不写任何数据)
// body { no_cache: true } 可跳过官方响应的 10 分钟缓存(手动"强制刷新"用)
router.post('/preview', requireAdmin, async (req, res) => {
  try {
    if (req.body && req.body.no_cache) clearCocCache();
    ok(res, await buildDiff());
  } catch (e) {
    fail(res, e.statusCode || 500, e.message);
  }
});

/**
 * 按玩家标签导入(只读): body { text: '#AAA111\n#BBB222' } 或 { tags: ['#AAA111'] }
 * 逐个查官方玩家资料, 返回昵称/大本/战意/是否在本部落 + 与本地库的匹配和建议动作。
 * 不写库; 写库仍走 POST /apply(前端把建议动作作为 actions 发过来)。
 */
router.post('/lookup', requireAdmin, async (req, res) => {
  try {
    if (!cocConfigured()) return fail(res, 400, '尚未配置 COC_API_TOKEN（服务器 .env）');
    const body = req.body || {};
    const input = Array.isArray(body.tags) ? body.tags.join('\n') : String(body.text || '');
    const { tags, invalid, truncated } = parsePlayerTags(input, MAX_LOOKUP_TAGS);
    if (!tags.length) {
      return fail(
        res,
        400,
        invalid.length
          ? `没有识别到有效的玩家标签（无法识别：${invalid.slice(0, 5).join('、')}）`
          : '请填写至少一个玩家标签，例如 #ABC123'
      );
    }
    if (body.no_cache) clearCocCache();

    // 本部落官方名单(知道谁"在部落"以及部落内角色); 查不到也不影响逐个查询
    const clanTag = normalizeTag(await getSetting('coc_clan_tag', ''));
    const clanMap = new Map();
    let clanName = '';
    let clanError = '';
    let cachedAny = false;
    if (clanTag) {
      try {
        const { clan, cached } = await cocGetClan(clanTag);
        cachedAny = cachedAny || cached;
        clanName = (clan && clan.name) || '';
        const { items, cached: mc } = await cocGetMembers(clanTag);
        cachedAny = cachedAny || mc;
        for (const m of items) clanMap.set(normalizeTag(m.tag), m);
      } catch (e) {
        clanError = e.reason || e.message;
      }
    }

    const { find, rows: localRows } = await localIndex();
    const items = [];
    for (const tag of tags) {
      try {
        const { player, cached } = await cocGetPlayer(tag);
        cachedAny = cachedAny || cached;
        const api = slimPlayer(player);
        const local = find(tag, api.name);
        const inClanRow = clanMap.get(tag) || null;
        const target = warPreferenceToStatus(player);
        let action = null;
        let note = '';
        if (!local) {
          action = { type: 'add', nickname: api.name, tag, status: target === null ? 0 : target };
          note = inClanRow ? '新成员（已在部落）' : '新成员（不在本部落）';
        } else if (target !== null && Number(local.status) !== target) {
          action = {
            type: 'status',
            member_id: local.id,
            nickname: local.nickname,
            from: Number(local.status),
            to: target,
          };
          note = `本地 ${STATUS_TEXT[Number(local.status)] || '?'} → 游戏内 ${STATUS_TEXT[target]}`;
        } else {
          note = '已是最新状态';
        }
        items.push({
          tag,
          name: api.name,
          town_hall: api.town_hall,
          exp_level: api.exp_level,
          trophies: api.trophies,
          war_preference: api.war_preference,
          target_status: target,
          target_status_text: target === null ? '' : STATUS_TEXT[target],
          in_clan: !!inClanRow,
          clan_role: inClanRow ? inClanRow.role || '' : '',
          clan_name: api.clan_name,
          local: memberBrief(local),
          note,
          action,
          error: '',
        });
      } catch (e) {
        items.push({
          tag,
          name: '',
          local: null,
          action: null,
          note: '',
          error: e.reason ? `官方 API: ${e.reason}` : e.message,
        });
      }
    }

    const okItems = items.filter((i) => !i.error);
    ok(res, {
      configured: true,
      clan_tag: clanTag,
      clan_name: clanName,
      clan_error: clanError,
      max_tags: MAX_LOOKUP_TAGS,
      truncated,
      invalid,
      cached: cachedAny,
      counts: {
        requested: tags.length,
        ok: okItems.length,
        failed: items.length - okItems.length,
        in_clan: okItems.filter((i) => i.in_clan).length,
        new_to_local: okItems.filter((i) => !i.local).length,
        will_add: okItems.filter((i) => i.action && i.action.type === 'add').length,
        will_update: okItems.filter((i) => i.action && i.action.type === 'status').length,
        up_to_date: okItems.filter((i) => !i.action).length,
        local_total: localRows.length,
      },
      items,
    });
  } catch (e) {
    fail(res, e.statusCode || 500, e.message);
  }
});

/**
 * 应用差异: body { actions: [ {type, ...} ], batch_id?, auto_add? }
 *   - 只处理显式列出的 actions; 每条都校验存在性与幂等, 并写审计。
 *   - auto_add=true 时, 服务端自己重新拉一次官方名单, 只把"新增成员"作为动作合并进来
 *     (对应产品决定: 新增成员自动, 状态变更必须人工勾选)。
 */
router.post('/apply', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const explicit = Array.isArray(body.actions) ? body.actions : [];
  const autoAdd = !!body.auto_add;

  let autoActions = [];
  if (autoAdd) {
    if (!cocConfigured()) return fail(res, 400, '尚未配置 COC_API_TOKEN（服务器 .env）');
    clearCocCache(); // 自动新增必须基于最新官方名单, 不吃缓存
    const diff = await buildDiff();
    autoActions = diff.members.flatMap((m) => (m.actions || []).filter((a) => a.type === 'add'));
  }

  // 合并(auto 在前), 按 类型+成员/标签 去重, 避免同一次请求里重复处理
  const seen = new Set();
  const actions = [];
  for (const a of [...autoActions, ...explicit]) {
    const key = `${(a && a.type) || ''}|${(a && (a.member_id ?? a.tag ?? a.nickname)) || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    actions.push(a);
  }

  if (!actions.length) {
    if (autoAdd) return fail(res, 400, '官方名单里没有需要新增的成员');
    return fail(res, 400, '没有要应用的变更');
  }
  if (actions.length > 200) return fail(res, 400, '单次最多应用 200 条');

  const batchId = String(body.batch_id || `coc-${Date.now().toString(36)}`).slice(0, 64);
  const actor = actorOf(req);
  const today = businessDate();
  const applied = [];
  const skipped = [];
  const failed = [];

  for (const a of actions) {
    const type = String(a && a.type || '');
    try {
      if (type === 'add') {
        const nickname = String(a.nickname || '').trim();
        const tag = normalizeTag(a.tag);
        if (!nickname) throw new Error('缺少昵称');
        const dup = await getOne('SELECT id FROM members WHERE nickname = ? OR (tag <> \'\' AND tag = ?)', [nickname, tag]);
        if (dup) {
          skipped.push({ type, nickname, reason: '本地已存在同名或同标签成员' });
          continue;
        }
        const status = [0, 1, 2].includes(Number(a.status)) ? Number(a.status) : 0;
        const r = await run(
          'INSERT INTO members (nickname, tag, join_date, status, red_since, note) VALUES (?, ?, NULL, ?, ?, ?)',
          [nickname, tag, status, status === 1 ? today : null, String(a.note || '游戏内同步').slice(0, 255)]
        );
        await logMemberStatus({
          member: { id: r.insertId, status: null, red_since: null },
          newStatus: status,
          newRedSince: status === 1 ? today : null,
          reason: `游戏内同步: 新增成员`,
          batchId,
          actor,
        });
        applied.push({ type, member_id: r.insertId, nickname, status });
      } else if (type === 'tag') {
        const id = Number(a.member_id);
        const tag = normalizeTag(a.tag);
        if (!id || !tag) throw new Error('缺少 member_id 或 tag');
        const cur = await getOne('SELECT * FROM members WHERE id = ?', [id]);
        if (!cur) throw new Error('成员不存在');
        if (normalizeTag(cur.tag) === tag) {
          skipped.push({ type, member_id: id, reason: '标签已是目标值' });
          continue;
        }
        await run('UPDATE members SET tag = ? WHERE id = ?', [tag, id]);
        await logMemberStatus({
          member: cur,
          newStatus: Number(cur.status),
          newRedSince: cur.red_since || null,
          reason: `游戏内同步: 写入游戏标签 ${tag}`,
          batchId,
          actor,
        });
        applied.push({ type, member_id: id, tag });
      } else if (type === 'status' || type === 'rejoin') {
        const id = Number(a.member_id);
        if (!id) throw new Error('缺少 member_id');
        const cur = await getOne('SELECT * FROM members WHERE id = ?', [id]);
        if (!cur) throw new Error('成员不存在');
        const next = type === 'rejoin' ? 0 : Number(a.to);
        if (![0, 1].includes(next)) throw new Error('状态只能是 0/1');
        if (Number(cur.status) === next && next !== 0) {
          skipped.push({ type, member_id: id, reason: '状态未变化' });
          continue;
        }
        await run(
          'UPDATE members SET status = ?, red_since = ?, deleted_at = NULL WHERE id = ?',
          [next, nextRedSince(cur, next, today), id]
        );
        await logMemberStatus({
          member: cur,
          newStatus: next,
          newRedSince: nextRedSince(cur, next, today),
          reason: `游戏内同步: ${type === 'rejoin' ? '回到部落' : `战意改为 ${STATUS_TEXT[next]}`}`,
          batchId,
          actor,
        });
        applied.push({ type, member_id: id, status: next });
      } else if (type === 'leave') {
        const id = Number(a.member_id);
        if (!id) throw new Error('缺少 member_id');
        const cur = await getOne('SELECT * FROM members WHERE id = ?', [id]);
        if (!cur) throw new Error('成员不存在');
        if (Number(cur.status) === 2) {
          skipped.push({ type, member_id: id, reason: '已经是离开状态' });
          continue;
        }
        await run('UPDATE members SET status = 2, red_since = NULL WHERE id = ?', [id]);
        await logMemberStatus({
          member: cur,
          newStatus: 2,
          newRedSince: null,
          reason: '游戏内同步: 官方成员名单中已无此人',
          batchId,
          actor,
        });
        applied.push({ type, member_id: id, status: 2 });
      } else {
        throw new Error(`不支持的 action: ${type || '(空)'}`);
      }
    } catch (e) {
      failed.push({ type, member_id: a && a.member_id, nickname: a && a.nickname, reason: e.message });
    }
  }

  // 新增成员可能把在部落人数推过游戏上限 50: 这里只提醒(与批量导入一致, 不硬拦)
  let warning = '';
  if (applied.some((a) => a.type === 'add')) {
    const row = await getOne('SELECT COUNT(*) AS c FROM members WHERE status != 2 AND deleted_at IS NULL');
    const total = Number(row.c);
    if (total > 50) warning = `同步后在部落人数为 ${total} 人，已超过游戏上限 50 人`;
  }

  ok(res, {
    batch_id: batchId,
    auto_add: autoAdd,
    auto_add_count: autoActions.length,
    applied_count: applied.length,
    skipped_count: skipped.length,
    failed_count: failed.length,
    applied,
    skipped,
    failed,
    warning,
  });
});

export { logMemberStatus };
