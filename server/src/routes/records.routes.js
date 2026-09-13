import { Router } from 'express';
import { query, getOne, run, pool, transaction } from '../db.js';
import { ok, fail } from '../lib/respond.js';
import { weekStart, todayYmd, rangeOf } from '../lib/cycle.js';
import { getSetting } from '../lib/settings.js';
import { previewWeeklyDelta } from '../lib/calc.js';

export const router = Router();

function parseId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// 幂等令牌: 同一批录入共用一个 token; 客户端双击/弱网重试不会重复记账
function sanitizeToken(v) {
  const s = String(v == null ? '' : v).trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

// 支持两种入参: {rule_id, member_ids, quantity, note} 或 {entries:[{...}]}
function normalizeEntries(body) {
  const list = Array.isArray(body.entries) ? body.entries : body.rule_id != null ? [body] : [];
  return list
    .map((e) => ({
      rule_id: Number(e.rule_id),
      quantity: Number(e.quantity),
      member_ids: Array.isArray(e.member_ids)
        ? e.member_ids.map(Number)
        : e.member_id != null
          ? [Number(e.member_id)]
          : [],
      note: e.note || '',
    }))
    .filter((e) => Number.isInteger(e.rule_id) && e.member_ids.length > 0);
}

async function loadRulesAndMembers(db = pool) {
  const [rules] = await db.execute('SELECT id, name, score_per_unit, weekly_cap, enabled FROM score_rules');
  const [members] = await db.execute('SELECT id, nickname, status, deleted_at FROM members');
  return {
    ruleMap: new Map(rules.map((r) => [r.id, r])),
    memberMap: new Map(members.map((m) => [m.id, m])),
  };
}

const round2 = (n) => Math.round(n * 100) / 100;
const cappedValue = (sum, cap) => (cap == null ? sum : Math.min(sum, cap));

// 校验一条录入: 规则存在且启用 / 数量为正 / 成员存在且未离开
// 返回 { rule, members, score, errors } —— 离开或无效的成员只报错并跳过, 不影响同批其它人
function validateEntry(e, ruleMap, memberMap) {
  const errors = [];
  const rule = ruleMap.get(e.rule_id);
  if (!rule) return { errors: [`积分项 #${e.rule_id} 不存在`], members: [], rule: null, score: 0 };
  if (!rule.enabled) return { errors: [`积分项「${rule.name}」已停用`], members: [], rule: null, score: 0 };
  if (!Number.isFinite(e.quantity) || e.quantity <= 0) {
    return { errors: [`积分项「${rule.name}」数量必须大于 0`], members: [], rule: null, score: 0 };
  }
  const members = [];
  for (const id of e.member_ids) {
    const m = memberMap.get(id);
    if (!m) {
      errors.push(`成员 #${id} 不存在`);
      continue;
    }
    if (m.deleted_at) {
      errors.push(`成员「${m.nickname}」已归档, 不能录入`);
      continue;
    }
    if (m.status === 2) {
      errors.push(`成员「${m.nickname}」已离开部落, 不能录入`);
      continue;
    }
    members.push(m);
  }
  if (!members.length && !errors.length) errors.push(`积分项「${rule.name}」未选择有效成员`);
  return { rule, members, score: round2(e.quantity * Number(rule.score_per_unit)), errors };
}

// 若干 (规则, 成员) 在当前周"封顶后"的积分: key = `${rule_id}:${member_id}`
async function weeklyCappedMap(con, ws, rows) {
  const map = new Map();
  const keys = [...new Set(rows.map((r) => `${r.rule_id}:${r.member_id}`))];
  if (!keys.length) return map;
  const capOf = new Map();
  for (const r of rows) capOf.set(`${r.rule_id}:${r.member_id}`, r.cap);
  const placeholders = keys.map(() => '(?, ?)').join(', ');
  const params = [];
  for (const k of keys) {
    const [rid, mid] = k.split(':').map(Number);
    params.push(rid, mid);
  }
  const [recs] = await con.execute(
    `SELECT rule_id, member_id, COALESCE(SUM(score), 0) AS s
     FROM score_records
     WHERE week_start = ? AND (rule_id, member_id) IN (${placeholders})
     GROUP BY rule_id, member_id`,
    [ws, ...params]
  );
  const sums = new Map(recs.map((r) => [`${r.rule_id}:${r.member_id}`, Number(r.s)]));
  for (const k of keys) map.set(k, cappedValue(sums.get(k) || 0, capOf.get(k)));
  return map;
}

// 当前周起始(按设置的每周起始日)
async function currentWeekStart() {
  const startDay = Number(await getSetting('week_start_day', '1'));
  return weekStart(todayYmd(), startDay);
}

// ---- 录入预览 (不写库) ----
// 返回每人"本次实际新增积分"(按周上限截断后的增量)以及合计
router.post('/preview', async (req, res) => {
  const entries = normalizeEntries(req.body || {});
  if (!entries.length) return fail(res, 400, '缺少有效的录入数据 (rule_id + member_ids)');
  try {
    const ws = await currentWeekStart();
    const { ruleMap, memberMap } = await loadRulesAndMembers();
    const errors = [];
    const members = [];
    let totalDelta = 0;
    for (const e of entries) {
      const v = validateEntry(e, ruleMap, memberMap);
      errors.push(...v.errors);
      if (!v.rule || !v.members.length) continue;
      const p = await previewWeeklyDelta(pool, {
        rule: v.rule,
        weekStart: ws,
        memberIds: v.members.map((m) => m.id),
        quantity: e.quantity,
      });
      totalDelta = round2(totalDelta + p.total_delta);
      for (const m of p.members) {
        members.push({ ...m, rule_id: v.rule.id, rule_name: v.rule.name });
      }
    }
    ok(res, { week_start: ws, total_delta: totalDelta, members, errors });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 批量录入 (核心高频接口)
// - 整批写入在一个事务内完成(任一步失败即整批回滚)
// - client_token 幂等: 同批次重复提交不会重复记账; 同一批次号换了内容 -> 409
// - total_delta 由服务端按"提交前后(封顶后)周积分差值"计算, 不信任客户端预览
router.post('/', async (req, res) => {
  const entries = normalizeEntries(req.body || {});
  if (!entries.length) return fail(res, 400, '缺少有效的录入数据 (rule_id + member_ids)');
  const clientToken = sanitizeToken(req.body && req.body.client_token);
  try {
    const ws = await currentWeekStart();
    const { ruleMap, memberMap } = await loadRulesAndMembers();

    const errors = [];
    const rows = [];
    for (const e of entries) {
      const v = validateEntry(e, ruleMap, memberMap);
      errors.push(...v.errors);
      if (!v.rule) continue;
      const cap = v.rule.weekly_cap == null ? null : Number(v.rule.weekly_cap);
      for (const m of v.members) {
        rows.push({
          rule_id: v.rule.id,
          cap,
          member_id: m.id,
          quantity: e.quantity,
          score: v.score,
          note: e.note,
        });
      }
    }
    if (!rows.length) {
      return ok(res, { inserted: 0, duplicated: 0, total_delta: 0, week_start: ws, client_token: clientToken, errors });
    }

    const keys = [...new Set(rows.map((r) => `${r.rule_id}:${r.member_id}`))];

    const out = await transaction(async (con) => {
      // 1) 幂等内容校验: 同一批次号不得用于不同内容(否则"撤销本批"会误删)
      if (clientToken) {
        const [exist] = await con.execute(
          'SELECT DISTINCT rule_id, member_id FROM score_records WHERE client_token = ? AND week_start = ?',
          [clientToken, ws]
        );
        if (exist.length) {
          const seen = new Set(exist.map((r) => `${r.rule_id}:${r.member_id}`));
          if (keys.some((k) => !seen.has(k))) {
            const err = new Error('该批次号已用于其它内容的录入, 请勿复用批次号');
            err.httpStatus = 409;
            throw err;
          }
        }
      }

      // 2) 写入前: 逐 (规则, 成员) 的封顶后周积分
      const before = await weeklyCappedMap(con, ws, rows);

      // 3) 写入(INSERT IGNORE + 唯一键 = 幂等)
      let inserted = 0;
      let duplicated = 0;
      for (const r of rows) {
        const [ret] = await con.execute(
          'INSERT IGNORE INTO score_records (member_id, rule_id, quantity, score, week_start, note, client_token) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [r.member_id, r.rule_id, r.quantity, r.score, ws, r.note, clientToken]
        );
        if (ret.affectedRows === 1) inserted += 1;
        else duplicated += 1;
      }

      // 4) 写入后: 真实新增 = Σ(封顶后 - 封顶前)
      const after = await weeklyCappedMap(con, ws, rows);
      let totalDelta = 0;
      for (const k of keys) totalDelta += (after.get(k) || 0) - (before.get(k) || 0);

      return { inserted, duplicated, total_delta: round2(totalDelta) };
    });

    ok(res, { ...out, week_start: ws, client_token: clientToken, errors });
  } catch (e) {
    if (e.httpStatus) return fail(res, e.httpStatus, e.message);
    fail(res, 500, e.message);
  }
});

// 撤销整批录入 (按 client_token)
// 说明: 积分在查询时实时聚合, 删除记录后各周期(含周上限)自动回到正确值, 无需额外重算
router.post('/batches/:token/revoke', async (req, res) => {
  const token = sanitizeToken(req.params.token);
  if (!token) return fail(res, 400, '无效批次号');
  try {
    const weeks = await query('SELECT DISTINCT week_start FROM score_records WHERE client_token = ?', [token]);
    if (!weeks.length) return fail(res, 404, '未找到该批次的录入记录');
    for (const w of weeks) {
      const settled = await getOne('SELECT COUNT(*) AS c FROM weekly_results WHERE cycle_type = ? AND cycle_start = ?', ['week', w.week_start]);
      if (settled && Number(settled.c) > 0) {
        return fail(res, 409, `该批次所属周 ${w.week_start} 已结算, 请先撤销结算再撤销录入`);
      }
    }
    const del = await run('DELETE FROM score_records WHERE client_token = ?', [token]);
    ok(res, { revoked: del.affectedRows, client_token: token });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 流水查询
router.get('/', async (req, res) => {
  let where = '1=1';
  const params = [];
  if (req.query.type && req.query.cycle_start) {
    const [a, b] = rangeOf(String(req.query.type), String(req.query.cycle_start));
    where += ' AND r.week_start >= ? AND r.week_start < ?';
    params.push(a, b);
  } else if (req.query.week_start) {
    where += ' AND r.week_start = ?';
    params.push(String(req.query.week_start));
  }
  if (req.query.member_id) {
    where += ' AND r.member_id = ?';
    params.push(Number(req.query.member_id));
  }
  if (req.query.rule_id) {
    where += ' AND r.rule_id = ?';
    params.push(Number(req.query.rule_id));
  }
  if (req.query.client_token) {
    where += ' AND r.client_token = ?';
    params.push(String(req.query.client_token));
  }
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;
  try {
    const totalRow = await getOne(`SELECT COUNT(*) AS c FROM score_records r WHERE ${where}`, params);
    const rows = await query(
      `SELECT r.id, r.member_id, m.nickname, r.rule_id, ru.name AS rule_name, r.quantity, r.score, r.week_start, r.note, r.client_token, r.created_at
       FROM score_records r
       JOIN members m ON m.id = r.member_id
       JOIN score_rules ru ON ru.id = r.rule_id
       WHERE ${where}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    ok(res, { rows, total: Number(totalRow.c) });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 修改单条流水
router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 400, '无效ID');
  const rec = await getOne('SELECT * FROM score_records WHERE id = ?', [id]);
  if (!rec) return fail(res, 404, '记录不存在');
  const rule = await getOne('SELECT score_per_unit FROM score_rules WHERE id = ?', [rec.rule_id]);
  const qty = req.body && req.body.quantity != null ? Number(req.body.quantity) : Number(rec.quantity);
  const score = Math.round(qty * Number(rule.score_per_unit) * 100) / 100;
  const r = await run('UPDATE score_records SET quantity = ?, score = ?, note = ? WHERE id = ?', [
    qty,
    score,
    (req.body && req.body.note) ?? rec.note,
    id,
  ]);
  if (!r.affectedRows) return fail(res, 404, '记录不存在');
  ok(res, await getOne('SELECT * FROM score_records WHERE id = ?', [id]));
});

// 删除单条流水
router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 400, '无效ID');
  const r = await run('DELETE FROM score_records WHERE id = ?', [id]);
  if (!r.affectedRows) return fail(res, 404, '记录不存在');
  ok(res, { deleted: id });
});
