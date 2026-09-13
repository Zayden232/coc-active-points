import { rangeOf } from './cycle.js';

function round2(n) {
  return Math.round(n * 100) / 100;
}

// 计算某周期内每个成员的"封顶后"总分与分项明细
// 封顶规则: 先按 (成员 × 规则 × 周) 聚合, 每周每项截断到 weekly_cap, 再跨周累加
// opts.ruleId: 只统计指定积分项(用于分项榜)
// db 可为 pool 或事务连接 (均有 execute)
export async function computeTotals(db, type, cycleStart, { ruleId = null } = {}) {
  const [rangeStart, rangeEnd] = rangeOf(type, cycleStart);
  const [rules] = await db.execute('SELECT id, weekly_cap FROM score_rules');
  const caps = new Map(rules.map((r) => [r.id, r.weekly_cap == null ? null : Number(r.weekly_cap)]));
  const params = [rangeStart, rangeEnd];
  let sql = `SELECT member_id, rule_id, week_start, SUM(score) AS s
     FROM score_records
     WHERE week_start >= ? AND week_start < ?`;
  if (ruleId != null) {
    sql += ' AND rule_id = ?';
    params.push(ruleId);
  }
  sql += ' GROUP BY member_id, rule_id, week_start';
  const [recs] = await db.execute(sql, params);
  const totals = new Map(); // member_id -> { total, breakdown: {rule_id: score} }
  for (const r of recs) {
    const cap = caps.get(r.rule_id);
    let s = Number(r.s);
    if (cap != null && s > cap) s = cap;
    let t = totals.get(r.member_id);
    if (!t) {
      t = { total: 0, breakdown: {} };
      totals.set(r.member_id, t);
    }
    t.total += s;
    t.breakdown[r.rule_id] = (t.breakdown[r.rule_id] || 0) + s;
  }
  return totals;
}

// 排行榜: 带 rank 的成员数组, 按总分降序
// activeOnly=true 时排除"离开"(status=2); ruleId 指定时按该积分项排名(分项榜)
export async function rankingRows(db, type, cycleStart, { activeOnly = false, ruleId = null } = {}) {
  const totals = await computeTotals(db, type, cycleStart, { ruleId });
  const [members] = await db.execute(
    'SELECT id, nickname, tag, status, join_date, town_hall, prosperity FROM members WHERE deleted_at IS NULL ORDER BY nickname ASC'
  );
  const rows = members
    .filter((m) => !activeOnly || m.status !== 2)
    .map((m) => {
      const t = totals.get(m.id);
      const total = t ? (ruleId != null ? Number(t.breakdown[ruleId] || 0) : t.total) : 0;
      return {
        member_id: m.id,
        nickname: m.nickname,
        tag: m.tag,
        town_hall: m.town_hall == null ? null : Number(m.town_hall),
        prosperity: m.prosperity == null ? null : Number(m.prosperity),
        status: m.status,
        join_date: m.join_date,
        total: round2(total),
        breakdown: t ? t.breakdown : {},
      };
    })
    .sort((a, b) => b.total - a.total || a.nickname.localeCompare(b.nickname, 'zh-Hans-CN') || a.member_id - b.member_id);
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

// 预览: 某规则在本周内, 指定成员录入 quantity 后"实际新增"的积分(考虑周上限截断)
// 返回逐人 before/after/delta 与合计, 不写库
export async function previewWeeklyDelta(db, { rule, weekStart: ws, memberIds, quantity }) {
  const addRaw = round2(Number(quantity) * Number(rule.score_per_unit));
  const cap = rule.weekly_cap == null ? null : Number(rule.weekly_cap);
  const placeholders = memberIds.map(() => '?').join(',');
  const [rows] = await db.execute(
    `SELECT member_id, SUM(score) AS s FROM score_records
     WHERE rule_id = ? AND week_start = ? AND member_id IN (${placeholders})
     GROUP BY member_id`,
    [rule.id, ws, ...memberIds]
  );
  const cur = new Map(rows.map((r) => [Number(r.member_id), Number(r.s)]));
  let totalDelta = 0;
  const members = memberIds.map((mid) => {
    const have = cur.get(Number(mid)) || 0;
    const before = cap == null ? have : Math.min(have, cap);
    const raw = have + addRaw;
    const after = cap == null ? raw : Math.min(raw, cap);
    const delta = round2(after - before);
    totalDelta = round2(totalDelta + delta);
    return {
      member_id: Number(mid),
      before: round2(before),
      after: round2(after),
      delta,
      // 本次数量已超过周上限(积分被截断, 但数量仍会被记录)
      capped: cap != null && raw > cap,
    };
  });
  return { add_raw: addRaw, cap, total_delta: totalDelta, members };
}
