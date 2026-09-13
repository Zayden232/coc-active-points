import { Router } from 'express';
import crypto from 'node:crypto';
import { query, getOne, run, transaction } from '../db.js';
import { ok, fail } from '../lib/respond.js';
import { ADMIN_ROLES, isSuperAdmin } from '../lib/auth.js';
import { actorOf, writeSecurityAudit } from '../lib/audit.js';
import {
  businessDate,
  nextRedSince,
  redDaysOf,
  blocksTribeLimit,
  appendNote,
  TRIBE_LIMIT,
} from '../lib/member-status.js';

export const router = Router();

const MAX_BATCH_MEMBERS = 200;

function parseId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// 统一出口: 附加 red_days(仅红牌且已知开始时间时有值)
function decorate(row, today) {
  return { ...row, red_days: redDaysOf(row, today) };
}

async function countInTribe() {
  const r = await getOne('SELECT COUNT(*) AS c FROM members WHERE status != 2 AND deleted_at IS NULL');
  return Number(r.c);
}

// 审计日志(单人或批量的状态/红牌时间变更), 记录真实操作人
async function logStatus(con, { member, newStatus, newRedSince, reason, batchId, actor }) {
  const exec = con && con.execute ? con.execute.bind(con) : null;
  const a = actor || { id: null, username: '', role: '' };
  const sql =
    'INSERT INTO member_status_logs (member_id, old_status, new_status, old_red_since, new_red_since, reason, batch_id, actor_user_id, actor_username, actor_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  const params = [
    member.id,
    member.status === undefined ? null : Number(member.status),
    newStatus === undefined ? null : newStatus,
    member.red_since || null,
    newRedSince || null,
    String(reason || '').slice(0, 255),
    String(batchId || '').slice(0, 64),
    a.id || null,
    String(a.username || '').slice(0, 64),
    String(a.role || '').slice(0, 16),
  ];
  if (exec) await exec(sql, params);
  else await run(sql, params);
}

// ------------------------------------------------------------
// 列表: 默认排除归档成员(include_archived=1 可查全部)
// 排序: 默认按繁荣度降序(识图导入/手工填写), 没有繁荣度的排最后, 再按昵称;
//       这样"展示栏"天然就是繁荣度排行, 不需要前端二次排序。
// ------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const includeArchived = String((req.query && req.query.include_archived) || '') === '1';
    const today = businessDate();
    const order = 'ORDER BY (prosperity IS NULL) ASC, prosperity DESC, status ASC, nickname ASC';
    const rows = await query(
      includeArchived ? `SELECT * FROM members ${order}` : `SELECT * FROM members WHERE deleted_at IS NULL ${order}`
    );
    const decorated = rows.map((r) => decorate(r, today));
    // 访客(只读)不返回内部备注
    if (ADMIN_ROLES.includes(req.auth && req.auth.role)) return ok(res, decorated);
    ok(
      res,
      decorated.map((r) => {
        const { note, ...rest } = r;
        return rest;
      })
    );
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// ---- 批量导入 (管理员) ----
// 支持两种粘贴格式(逗号/中文逗号/制表符均可):
//   旧: 昵称                    昵称,#标签                   昵称,#标签,备注
//   新(识图): 昵称,大本营,牌子[,繁荣度]   例如: 清风霁月,14,绿,63
// 判定规则: 第 2 列是正整数 **且** 第 3 列是绿/红 -> 视为新格式; 否则按旧格式解析。
// 部落战牌子直接映射 members.status(绿=0 / 红=1), 不新增字段。
// 大本营等级只要求正整数(游戏会继续开新本, 不设上限; 列是 TINYINT UNSIGNED 有 255 的物理上限)。
// 大本营等级与繁荣度都只做"下界"校验(正整数 / 非负整数), 不设上限:
// 游戏会继续开新本、繁荣度也会随版本继续涨, 写死上限迟早过时(1-16 与 0-1000000 都已被删)。
// 物理上限交给列类型: town_hall TINYINT UNSIGNED(255) / prosperity INT UNSIGNED(约 42.9 亿)。
const TH_MIN = 1;
const PROSPERITY_MIN = 0;

function normalizeTag(t) {
  const s = String(t == null ? '' : t).trim().toUpperCase();
  if (!s) return '';
  return s.startsWith('#') ? s : '#' + s;
}

// 绿/红牌子: 支持 绿/红/绿牌/红牌/正常/请假/绿牌(0)/红牌(1)/0/1
function parseWarStatus(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return undefined;
  if (['绿', '绿牌', '正常', '0', 'in', 'green'].includes(s)) return 0;
  if (['红', '红牌', '请假', '1', 'out', 'red'].includes(s)) return 1;
  const m = s.match(/[（(]\s*([01])\s*[)）]/);
  if (m) return Number(m[1]);
  return undefined;
}

function parseTownHall(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  const n = Number(s);
  // 只要求正整数: 游戏会继续开新本(17、18…), 不做上限校验
  return Number.isInteger(n) && n >= TH_MIN ? n : NaN;
}

function parseProsperity(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  const n = Number(s);
  // 只要求非负整数: 繁荣度会随版本继续涨, 不做上限校验
  return Number.isInteger(n) && n >= PROSPERITY_MIN ? n : NaN;
}

/** 一行 -> 结构化数据; 返回 { ok:false, error } 表示这行要报错 */
function parseImportLine(parts, lineNo) {
  const nickname = String(parts[0] || '').trim();
  if (!nickname) return { ok: false, error: `第 ${lineNo} 行: 缺少昵称` };
  if (nickname.length > 64) return { ok: false, error: `第 ${lineNo} 行: 昵称超过 64 字` };

  const second = String(parts[1] || '').trim();
  const third = String(parts[2] || '').trim();
  const fourth = String(parts[3] || '').trim();

  const th = parseTownHall(second);
  const status = parseWarStatus(third);

  // 新格式: 第 2 列是大本营等级, 第 3 列是牌子
  if (Number.isInteger(th) && status !== undefined) {
    const prosperity = parseProsperity(fourth);
    if (Number.isNaN(prosperity)) {
      return { ok: false, error: `第 ${lineNo} 行: 繁荣度需是不小于 0 的整数` };
    }
    if (fourth && parseProsperity(fourth) === null) {
      return { ok: false, error: `第 ${lineNo} 行: 繁荣度需是不小于 0 的整数` };
    }
    return {
      ok: true,
      row: { line: lineNo, nickname, tag: '', note: '', town_hall: th, prosperity, status },
    };
  }

  if (second !== '' && Number.isNaN(th)) {
    // 第 2 列写了内容却不是合法大本营等级: 只有第三种是牌子时才当成"等级写错了", 否则按旧格式的标签处理
    if (status !== undefined) {
      return { ok: false, error: `第 ${lineNo} 行: 大本营等级需是不小于 1 的整数` };
    }
  }

  // 旧格式: 昵称,#标签,备注
  const tag = normalizeTag(second);
  if (tag.length > 32) return { ok: false, error: `第 ${lineNo} 行: 标签超过 32 字` };
  return { ok: true, row: { line: lineNo, nickname, tag, note: third.slice(0, 255) } };
}

function parseImportRows(body) {
  const errors = [];
  const rows = [];
  // 也支持直接传数组 [{nickname, tag, note, town_hall, prosperity, status}]
  if (Array.isArray(body.members)) {
    body.members.forEach((m, i) => {
      const nickname = String((m && m.nickname) || '').trim();
      if (!nickname) {
        errors.push(`第 ${i + 1} 项: 缺少昵称`);
        return;
      }
      const th = m && m.town_hall != null && m.town_hall !== '' ? parseTownHall(m.town_hall) : null;
      const prosperity =
        m && m.prosperity != null && m.prosperity !== '' ? parseProsperity(m.prosperity) : null;
      const status = m && m.status !== undefined ? Number(m.status) : undefined;
      if (Number.isNaN(th)) {
        errors.push(`第 ${i + 1} 项: 大本营等级需是不小于 1 的整数`);
        return;
      }
      if (Number.isNaN(prosperity)) {
        errors.push(`第 ${i + 1} 项: 繁荣度需是不小于 0 的整数`);
        return;
      }
      if (status !== undefined && ![0, 1, 2].includes(status)) {
        errors.push(`第 ${i + 1} 项: 牌子只能是 绿(0) / 红(1) / 离开(2)`);
        return;
      }
      rows.push({
        line: i + 1,
        nickname,
        tag: normalizeTag(m.tag),
        note: String(m.note || '').slice(0, 255),
        town_hall: th,
        prosperity,
        status: status === undefined ? undefined : status,
      });
    });
  } else {
    const lines = String(body.text || '').replace(/\r\n?/g, '\n').split('\n');
    lines.forEach((raw, i) => {
      const lineNo = i + 1;
      const t = raw.trim();
      if (!t) return;
      const parts = t.split(/\t|,|，/).map((x) => x.trim());
      const parsed = parseImportLine(parts, lineNo);
      if (!parsed.ok) {
        errors.push(parsed.error);
        return;
      }
      rows.push(parsed.row);
    });
  }
  return { rows, errors };
}

const STATUS_TEXT = { 0: '绿牌', 1: '红牌', 2: '离开' };
const statusText = (s) => STATUS_TEXT[Number(s)] || '—';

/**
 * 与库内数据比对。分类:
 *   add            新成员(带识图数据: 大本营/繁荣度/牌子)
 *   restore        归档(离开)成员恢复
 *   status_change  重名且牌子变了(绿↔红) -> 快速改牌子(顺带带上大本营/繁荣度变化)
 *   profile_change 重名且只有大本营/繁荣度变了
 *   exists         重名且没有任何变化
 *   conflict       同名冲突(需勾选"允许同名")
 *   invalid        粘贴内容内重复
 */
async function classifyRows(rows, { allowSameName = false } = {}) {
  const members = await query('SELECT id, nickname, tag, status, town_hall, prosperity FROM members');
  const byNick = new Map(members.map((m) => [m.nickname, m]));
  const byTag = new Map(members.filter((m) => m.tag).map((m) => [String(m.tag).toUpperCase(), m]));
  const out = { add: [], restore: [], status_change: [], profile_change: [], exists: [], conflict: [], invalid: [] };
  const seenNick = new Set();
  const seenTag = new Set();

  // 大本营/繁荣度是否"有变化": 只在新数据非空时比较(空 = 本次没提供, 不动库里的值)
  const profileDiff = (r, hit) => {
    const thChanged = r.town_hall != null && Number(hit.town_hall ?? -1) !== Number(r.town_hall);
    const prChanged = r.prosperity != null && Number(hit.prosperity ?? -1) !== Number(r.prosperity);
    return { thChanged, prChanged, changed: thChanged || prChanged };
  };

  for (const r of rows) {
    if (seenNick.has(r.nickname) || (r.tag && seenTag.has(r.tag))) {
      out.invalid.push({ ...r, reason: '粘贴内容内重复' });
      continue;
    }
    seenNick.add(r.nickname);
    if (r.tag) seenTag.add(r.tag);

    const tagHit = r.tag ? byTag.get(r.tag) : null;
    if (tagHit) {
      out.exists.push({ ...r, member_id: tagHit.id, reason: `标签已存在(${tagHit.nickname})` });
      continue;
    }

    const hit = byNick.get(r.nickname);
    if (!hit) {
      out.add.push(r);
      continue;
    }

    if (hit.status === 2) {
      out.restore.push({ ...r, member_id: hit.id, reason: '离开成员恢复' });
      continue;
    }

    if (allowSameName) {
      out.add.push({ ...r, reason: '同名按新成员导入' });
      continue;
    }

    const statusChanged = r.status !== undefined && Number(r.status) !== Number(hit.status);
    const diff = profileDiff(r, hit);
    // 这一行有没有带"成员资料"(大本营/繁荣度/牌子):
    //   带了 -> 视为同一个人的资料更新(牌子变化 / 大本营·繁荣度变化 / 完全一致)
    //   没带(只贴了昵称) -> 说不清是不是同一个人, 维持原来的"同名待确认"口径
    const hasProfileData = r.town_hall != null || r.prosperity != null || r.status !== undefined;

    if (statusChanged) {
      out.status_change.push({
        ...r,
        member_id: hit.id,
        from_status: Number(hit.status),
        to_status: Number(r.status),
        from_town_hall: hit.town_hall == null ? null : Number(hit.town_hall),
        from_prosperity: hit.prosperity == null ? null : Number(hit.prosperity),
        reason: `牌子 ${statusText(hit.status)} → ${statusText(r.status)}`,
      });
      continue;
    }

    if (diff.changed) {
      out.profile_change.push({
        ...r,
        member_id: hit.id,
        from_status: Number(hit.status),
        from_town_hall: hit.town_hall == null ? null : Number(hit.town_hall),
        from_prosperity: hit.prosperity == null ? null : Number(hit.prosperity),
        reason: [
          diff.thChanged ? `大本营 ${hit.town_hall ?? '—'} → ${r.town_hall}` : '',
          diff.prChanged ? `繁荣度 ${hit.prosperity ?? '—'} → ${r.prosperity}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      });
      continue;
    }

    if (!hasProfileData) {
      out.conflict.push({ ...r, member_id: hit.id, reason: '同名待确认' });
      continue;
    }

    out.exists.push({ ...r, member_id: hit.id, reason: '与库内一致' });
  }
  return out;
}

async function buildPreview(body) {
  const { rows, errors } = parseImportRows(body || {});
  const cls = await classifyRows(rows, { allowSameName: !!(body && body.allow_same_name) });
  const before = await countInTribe();
  const after = before + cls.add.length + cls.restore.length;
  return {
    parsed: rows.length,
    errors: [...errors, ...cls.invalid.map((r) => `第 ${r.line} 行: ${r.reason}`)],
    add: cls.add,
    restore: cls.restore,
    status_change: cls.status_change,
    profile_change: cls.profile_change,
    exists: cls.exists,
    conflict: cls.conflict,
    counts: {
      add: cls.add.length,
      restore: cls.restore.length,
      status_change: cls.status_change.length,
      profile_change: cls.profile_change.length,
      exists: cls.exists.length,
      conflict: cls.conflict.length,
      invalid: cls.invalid.length,
    },
    // 牌子到底怎么变(绿→红 / 红→绿), 前端直接展示
    status_change_detail: {
      to_red: cls.status_change.filter((r) => Number(r.to_status) === 1).length,
      to_green: cls.status_change.filter((r) => Number(r.to_status) === 0).length,
    },
    in_tribe_before: before,
    in_tribe_after: after,
    // 50 人是游戏上限: 这里只做提醒, 不硬拦(历史数据可能已超)
    warning: after > TRIBE_LIMIT ? `导入后在部落人数将达到 ${after} 人，已超过游戏上限 ${TRIBE_LIMIT} 人` : '',
  };
}

// 预览: 只解析与比对, 不写库
router.post('/batch/preview', async (req, res) => {
  try {
    ok(res, await buildPreview(req.body));
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 执行导入
router.post('/batch', async (req, res) => {
  try {
    const body = req.body || {};
    const preview = await buildPreview(body);
    const today = businessDate();
    // 前端把"已勾选"的东西传进来; 不传时默认全都应用(接口对脚本友好)
    const apply = {
      status_change: !body.apply || body.apply.status_change !== false,
      profile_change: !body.apply || body.apply.profile_change !== false,
    };
    const actor = actorOf(req);
    let added = 0;
    let restored = 0;
    let statusChanged = 0;
    let profileChanged = 0;
    const failed = [];

    for (const r of preview.add) {
      try {
        const status = r.status === undefined ? 0 : Number(r.status);
        const redSince = status === 1 ? today : null;
        await run(
          'INSERT INTO members (nickname, tag, join_date, status, note, red_since, town_hall, prosperity) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)',
          [r.nickname, r.tag || '', status, r.note || '', redSince, r.town_hall ?? null, r.prosperity ?? null]
        );
        added += 1;
      } catch (e) {
        failed.push({ nickname: r.nickname, reason: e.code === 'ER_DUP_ENTRY' ? '昵称已存在' : e.message });
      }
    }

    for (const r of preview.restore) {
      try {
        // 恢复 = 回到绿牌: 结束红牌计时, 同时取消归档(重新导入即视为回到部落)
        const status = r.status === undefined ? 0 : Number(r.status);
        await run(
          'UPDATE members SET status = ?, red_since = ?, deleted_at = NULL, tag = COALESCE(NULLIF(?, \'\'), tag), note = COALESCE(NULLIF(?, \'\'), note), town_hall = COALESCE(?, town_hall), prosperity = COALESCE(?, prosperity) WHERE id = ?',
          [status, status === 1 ? today : null, r.tag || '', r.note || '', r.town_hall ?? null, r.prosperity ?? null, r.member_id]
        );
        await logStatus(null, {
          actor,
          member: { id: r.member_id, status: 2, red_since: null },
          newStatus: status,
          newRedSince: status === 1 ? today : null,
          reason: '批量导入恢复',
          batchId: '',
        });
        restored += 1;
      } catch (e) {
        failed.push({ nickname: r.nickname, reason: e.message });
      }
    }

    if (apply.status_change) {
      for (const r of preview.status_change) {
        try {
          const to = Number(r.to_status);
          const redSince = nextRedSince({ status: r.from_status, red_since: null }, to, today);
          await run('UPDATE members SET status = ?, red_since = ? WHERE id = ?', [
            to,
            redSince,
            r.member_id,
          ]);
          await logStatus(null, {
            actor,
            member: { id: r.member_id, status: r.from_status, red_since: null },
            newStatus: to,
            newRedSince: redSince,
            reason: '批量导入改牌子',
            batchId: '',
          });
          statusChanged += 1;
        } catch (e) {
          failed.push({ nickname: r.nickname, reason: e.message });
        }
      }
    }

    if (apply.profile_change) {
      for (const r of preview.profile_change) {
        try {
          await run('UPDATE members SET town_hall = ?, prosperity = ? WHERE id = ?', [
            r.town_hall ?? null,
            r.prosperity ?? null,
            r.member_id,
          ]);
          profileChanged += 1;
        } catch (e) {
          failed.push({ nickname: r.nickname, reason: e.message });
        }
      }
      // 牌子变化那批如果也带了新的大本营/繁荣度, 一起写入(用户勾选的是一整行)
      for (const r of preview.status_change) {
        if (r.town_hall == null && r.prosperity == null) continue;
        try {
          await run('UPDATE members SET town_hall = COALESCE(?, town_hall), prosperity = COALESCE(?, prosperity) WHERE id = ?', [
            r.town_hall ?? null,
            r.prosperity ?? null,
            r.member_id,
          ]);
          profileChanged += 1;
        } catch (e) {
          failed.push({ nickname: r.nickname, reason: e.message });
        }
      }
    }

    const before = preview.in_tribe_before;
    const after = before + added + restored;
    ok(res, {
      added,
      restored,
      status_changed: statusChanged,
      profile_changed: profileChanged,
      skipped_exists: preview.counts.exists,
      conflict: preview.counts.conflict,
      invalid: preview.counts.invalid,
      failed,
      in_tribe_after: after,
      warning: after > TRIBE_LIMIT ? `导入后在部落人数将达到 ${after} 人，已超过游戏上限 ${TRIBE_LIMIT} 人` : '',
      today,
    });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// ------------------------------------------------------------
// 批量操作: 改状态 / 追加备注 / 归档 (整批成功或整批失败 + 幂等)
//   固定路径必须注册在 /:id 之前
// ------------------------------------------------------------
function canonicalPayload(operation, ids, changes) {
  return JSON.stringify({
    operation,
    member_ids: [...ids].sort((a, b) => a - b),
    changes: Object.keys(changes)
      .sort()
      .reduce((acc, k) => {
        acc[k] = changes[k];
        return acc;
      }, {}),
  });
}

router.post('/batch-action', async (req, res) => {
  const b = req.body || {};
  const token = String(b.client_token || '').trim();
  if (!token || token.length > 64) return fail(res, 400, '缺少或非法的 client_token');

  const operation = String(b.operation || '').trim();
  if (!['update', 'archive'].includes(operation)) {
    return fail(res, 400, 'operation 只能是 update 或 archive');
  }

  const rawIds = Array.isArray(b.member_ids) ? b.member_ids : [];
  const ids = [...new Set(rawIds.map(parseId).filter(Boolean))];
  if (!ids.length) return fail(res, 400, 'member_ids 不能为空');
  if (ids.length > MAX_BATCH_MEMBERS) return fail(res, 400, `单批最多 ${MAX_BATCH_MEMBERS} 人`);

  const changes = {};
  if (operation === 'update') {
    const c = b.changes || {};
    if (c.status !== undefined) {
      const s = Number(c.status);
      if (![0, 1, 2].includes(s)) return fail(res, 400, 'status 只能是 0/1/2');
      changes.status = s;
    }
    if (c.append_note !== undefined) {
      const t = String(c.append_note || '').trim();
      if (!t) return fail(res, 400, '追加备注不能为空');
      if (t.length > 200) return fail(res, 400, '追加备注过长(最多 200 字)');
      changes.append_note = t;
    }
    if (!Object.keys(changes).length) return fail(res, 400, 'changes 里至少要有一项(status / append_note)');
  }

  try {
    const payloadHash = crypto.createHash('sha256').update(canonicalPayload(operation, ids, changes)).digest('hex');

    // 幂等: 同 token 同内容 -> 原结果; 同 token 不同内容 -> 409
    const seen = await getOne('SELECT * FROM member_batch_tokens WHERE client_token = ?', [token]);
    if (seen) {
      if (seen.payload_hash !== payloadHash) return fail(res, 409, '该批次号已用于不同的操作内容');
      return ok(res, { affected: Number(seen.affected), duplicated: true, batch_id: token });
    }

    const today = businessDate();
    const ph = ids.map(() => '?').join(',');
    const rows = await query(`SELECT * FROM members WHERE id IN (${ph})`, ids);
    if (rows.length !== ids.length) return fail(res, 404, '部分成员不存在，本批未执行');

    // 状态转绿牌/红牌时校验在部落人数上限(整批拒绝)
    if (operation === 'update' && changes.status !== undefined && changes.status !== 2) {
      const before = await countInTribe();
      const activating = rows.filter((r) => Number(r.status) === 2).length;
      const after = before + activating;
      if (blocksTribeLimit(before, after)) {
        return fail(res, 409, `在部落人数将达到 ${after} 人，超过上限 ${TRIBE_LIMIT} 人，本批已整批取消`);
      }
    }

    // 追加备注: 先校验长度, 避免整批写一半
    if (operation === 'update' && changes.append_note !== undefined) {
      for (const r of rows) {
        if (appendNote(r.note, changes.append_note) === null) {
          return fail(res, 400, `成员「${r.nickname}」的备注追加后会超过 255 字，请缩短后重试`);
        }
      }
    }

    let affected = 0;
    await transaction(async (con) => {
      for (const r of rows) {
        if (operation === 'archive') {
          await con.execute(
            'UPDATE members SET status = 2, red_since = NULL, deleted_at = COALESCE(deleted_at, NOW()) WHERE id = ?',
            [r.id]
          );
          await logStatus(con, {
      actor: actorOf(req),
            member: r,
            newStatus: 2,
            newRedSince: null,
            reason: '批量归档',
            batchId: token,
          });
        } else {
          const sets = [];
          const params = [];
          let newRedSince = r.red_since || null;
          if (changes.status !== undefined) {
            newRedSince = nextRedSince(r, changes.status, today);
            sets.push('status = ?', 'red_since = ?');
            params.push(changes.status, newRedSince);
            // 转回绿牌/红牌 = 取消归档(归档成员可被重新激活)
            if (changes.status !== 2) sets.push('deleted_at = NULL');
          }
          if (changes.append_note !== undefined) {
            sets.push('note = ?');
            params.push(appendNote(r.note, changes.append_note));
          }
          params.push(r.id);
          await con.execute(`UPDATE members SET ${sets.join(', ')} WHERE id = ?`, params);
          if (changes.status !== undefined) {
            await logStatus(con, {
      actor: actorOf(req),
              member: r,
              newStatus: changes.status,
              newRedSince,
              reason: '批量修改状态',
              batchId: token,
            });
          }
        }
        affected += 1;
      }
      const response = { affected, duplicated: false, batch_id: token };
      await con.execute(
        'INSERT INTO member_batch_tokens (client_token, payload_hash, operation, affected, response) VALUES (?, ?, ?, ?, ?)',
        [token, payloadHash, operation, affected, JSON.stringify(response)]
      );
    });

    ok(res, { affected, duplicated: false, batch_id: token });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// ------------------------------------------------------------
// 新增成员
// ------------------------------------------------------------
router.post('/', async (req, res) => {
  const b = req.body || {};
  const { nickname, tag = '', join_date = null, note = '' } = b;
  if (!nickname || !String(nickname).trim()) return fail(res, 400, '昵称不能为空');
  const status = b.status === undefined ? 0 : Number(b.status);
  if (![0, 1, 2].includes(status)) return fail(res, 400, '状态只能是 0/1/2');
  const townHall = b.town_hall == null || b.town_hall === '' ? null : parseTownHall(b.town_hall);
  if (Number.isNaN(townHall)) return fail(res, 400, '大本营等级需是不小于 1 的整数');
  const prosperity = b.prosperity == null || b.prosperity === '' ? null : parseProsperity(b.prosperity);
  if (Number.isNaN(prosperity)) return fail(res, 400, '繁荣度需是不小于 0 的整数');
  const today = businessDate();
  const redSince = status === 1 ? today : null;
  try {
    const r = await run(
      'INSERT INTO members (nickname, tag, join_date, status, note, red_since, town_hall, prosperity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [String(nickname).trim(), tag, join_date || null, status, note, redSince, townHall, prosperity]
    );
    const row = await getOne('SELECT * FROM members WHERE id = ?', [r.insertId]);
    await logStatus(null, {
      actor: actorOf(req),
      member: { id: r.insertId, status: null, red_since: null },
      newStatus: status,
      newRedSince: redSince,
      reason: '新增成员',
      batchId: '',
    });
    ok(res, decorate(row, today));
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 409, '该昵称已存在');
    fail(res, 500, e.message);
  }
});

// ------------------------------------------------------------
// 红牌开始时间补录(历史成员): 只补时间, 不改状态
// ------------------------------------------------------------
router.put('/:id/red-since', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 400, '无效ID');
  const cur = await getOne('SELECT * FROM members WHERE id = ?', [id]);
  if (!cur) return fail(res, 404, '成员不存在');
  if (Number(cur.status) !== 1) return fail(res, 400, '只有当前为红牌的成员才能补录红牌开始时间');

  const b = req.body || {};
  const ymd = String(b.red_since == null ? '' : b.red_since).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return fail(res, 400, '日期格式应为 YYYY-MM-DD');
  const today = businessDate();
  if (ymd > today) return fail(res, 400, '红牌开始时间不能晚于今天');
  const reason = String(b.reason == null ? '' : b.reason).trim().slice(0, 255) || '管理员补录红牌开始时间';

  try {
    await run('UPDATE members SET red_since = ? WHERE id = ?', [ymd, id]);
    await logStatus(null, {
      actor: actorOf(req),
      member: cur,
      newStatus: Number(cur.status),
      newRedSince: ymd,
      reason,
      batchId: '',
    });
    ok(res, decorate(await getOne('SELECT * FROM members WHERE id = ?', [id]), today));
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// ------------------------------------------------------------
// 更新成员(状态变更由服务端统一处理红牌计时)
// ------------------------------------------------------------
router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 400, '无效ID');
  const cur = await getOne('SELECT * FROM members WHERE id = ?', [id]);
  if (!cur) return fail(res, 404, '成员不存在');
  const b = req.body || {};
  const nickname = b.nickname ?? cur.nickname;
  if (!nickname || !String(nickname).trim()) return fail(res, 400, '昵称不能为空');

  const nextStatus = b.status === undefined ? Number(cur.status) : Number(b.status);
  if (![0, 1, 2].includes(nextStatus)) return fail(res, 400, '状态只能是 0/1/2');

  // 大本营/繁荣度: 传了才改, 传空字符串/ null = 清空
  const nextTownHall =
    b.town_hall === undefined ? cur.town_hall : b.town_hall === null || b.town_hall === '' ? null : parseTownHall(b.town_hall);
  if (Number.isNaN(nextTownHall)) return fail(res, 400, '大本营等级需是不小于 1 的整数');
  const nextProsperity =
    b.prosperity === undefined
      ? cur.prosperity
      : b.prosperity === null || b.prosperity === ''
        ? null
        : parseProsperity(b.prosperity);
  if (Number.isNaN(nextProsperity)) return fail(res, 400, '繁荣度需是不小于 0 的整数');

  const today = businessDate();
  const newRedSince = nextRedSince(cur, nextStatus, today);
  // 转回绿牌/红牌 = 取消归档; 设为离开时保留原归档时间
  const deletedAtValue = nextStatus !== 2 ? null : cur.deleted_at;

  // 离开 -> 在部落 时校验人数上限
  if (Number(cur.status) === 2 && nextStatus !== 2) {
    const before = await countInTribe();
    if (blocksTribeLimit(before, before + 1)) {
      return fail(res, 409, `在部落人数将达到 ${before + 1} 人，超过上限 ${TRIBE_LIMIT} 人，未执行修改`);
    }
  }

  try {
    await transaction(async (con) => {
      await con.execute(
        'UPDATE members SET nickname = ?, tag = ?, join_date = ?, status = ?, red_since = ?, note = ?, deleted_at = ?, town_hall = ?, prosperity = ? WHERE id = ?',
        [
          String(nickname).trim(),
          b.tag ?? cur.tag,
          b.join_date !== undefined ? b.join_date || null : cur.join_date,
          nextStatus,
          newRedSince,
          b.note ?? cur.note,
          deletedAtValue,
          nextTownHall,
          nextProsperity,
          id,
        ]
      );
      if (nextStatus !== Number(cur.status) || newRedSince !== (cur.red_since || null)) {
        await logStatus(con, {
      actor: actorOf(req),
          member: cur,
          newStatus: nextStatus,
          newRedSince,
          reason: '编辑成员资料',
          batchId: '',
        });
      }
    });
    ok(res, decorate(await getOne('SELECT * FROM members WHERE id = ?', [id]), today));
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 409, '该昵称已存在');
    fail(res, 500, e.message);
  }
});

// ------------------------------------------------------------
// 删除: 默认=归档(软删除, 保留历史积分/结算/发奖); ?purge=1 才是物理删除
// ------------------------------------------------------------
router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 400, '无效ID');
  const cur = await getOne('SELECT * FROM members WHERE id = ?', [id]);
  if (!cur) return fail(res, 404, '成员不存在');

  const purge = String((req.query && req.query.purge) || '') === '1';
  // 物理删除不可逆: 只允许超级管理员
  if (purge && !isSuperAdmin(req)) {
    return fail(res, 403, '仅超级管理员可执行物理删除');
  }
  try {
    if (purge) {
      // 物理删除会级联清空该成员的全部历史(score_records / weekly_results / reward_logs /
      // wheel_spins / member_cosmetics 都是 ON DELETE CASCADE), 删完就再也查不到了。
      // 所以: 先统计代价 → 删除 → 写安全审计, 三步放在**同一个事务**里 ——
      // 要么"删掉并留下审计", 要么整件事回滚, 不会出现"删了但没记录"的情况。
      const removed = await transaction(async (con) => {
        const countOf = async (table) => {
          const [rows] = await con.execute(
            `SELECT COUNT(*) AS c FROM ${table} WHERE member_id = ?`,
            [id]
          );
          return Number(rows[0].c) || 0;
        };

        const cost = {
          score_records: await countOf('score_records'),
          weekly_results: await countOf('weekly_results'),
          reward_logs: await countOf('reward_logs'),
          wheel_spins: await countOf('wheel_spins'),
          member_cosmetics: await countOf('member_cosmetics'),
        };

        const [del] = await con.execute('DELETE FROM members WHERE id = ?', [id]);
        if (!del.affectedRows) return null;

        await writeSecurityAudit({
          actor: actorOf(req),
          action: 'purge_member',
          details:
            `永久删除成员「${cur.nickname}」(#${id}, 原状态 ${cur.status}); ` +
            `连带删除 流水${cost.score_records}/结算${cost.weekly_results}/发奖${cost.reward_logs}` +
            `/转盘${cost.wheel_spins}/外观${cost.member_cosmetics}`,
          ip: req.ip || '',
          con,
        });

        return cost;
      });

      if (!removed) return fail(res, 404, '成员不存在');
      return ok(res, { deleted: id, purged: true, removed });
    }

    if (cur.deleted_at) {
      return ok(res, { archived: id, already_archived: true, deleted_at: cur.deleted_at });
    }

    await run('UPDATE members SET status = 2, red_since = NULL, deleted_at = NOW() WHERE id = ?', [id]);
    await logStatus(null, {
      actor: actorOf(req),
      member: cur,
      newStatus: 2,
      newRedSince: null,
      reason: '归档成员',
      batchId: '',
    });
    const row = await getOne('SELECT * FROM members WHERE id = ?', [id]);
    ok(res, { archived: id, already_archived: false, deleted_at: row.deleted_at });
  } catch (e) {
    fail(res, 500, e.message);
  }
});
