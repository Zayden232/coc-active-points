import { Router } from 'express';
import { query, transaction, pool } from '../db.js';
import { ok, fail } from '../lib/respond.js';
import { requireAdmin, requireSuperAdmin } from '../lib/auth.js';
import { rankingRows } from '../lib/calc.js';
import { rangeOf, weekStart, cycleStartOf, todayYmd, CYCLE_TYPES } from '../lib/cycle.js';
import { getSetting } from '../lib/settings.js';

export const router = Router();

function csvEsc(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function sendCsv(res, filename, text) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + text); // BOM 让 Excel 正确识别 UTF-8
}

// 导出: kind=ranking 排行榜 / kind=records 流水明细
// 注意: 虽然是 GET, 但属于数据外带, 仅管理员可用
router.get('/export', requireAdmin, async (req, res) => {
  const type = req.query.type || 'week';
  const kind = req.query.kind || 'ranking';
  if (!CYCLE_TYPES.includes(type)) return fail(res, 400, '无效周期类型');
  try {
    const startDay = Number(await getSetting('week_start_day', '1'));
    const ws = weekStart(todayYmd(), startDay);
    const cycle_start = req.query.cycle_start || cycleStartOf(type, ws, startDay);
    if (kind === 'records') {
      const [a, b] = rangeOf(type, cycle_start);
      const rows = await query(
        `SELECT m.nickname, ru.name AS rule, r.quantity, r.score, r.week_start, r.note, r.created_at
         FROM score_records r
         JOIN members m ON m.id = r.member_id
         JOIN score_rules ru ON ru.id = r.rule_id
         WHERE r.week_start >= ? AND r.week_start < ?
         ORDER BY r.week_start, m.nickname`,
        [a, b]
      );
      const lines = [['成员', '积分项', '数量', '积分', '所属周', '备注', '录入时间'].join(',')];
      for (const r of rows) {
        lines.push([csvEsc(r.nickname), csvEsc(r.rule), r.quantity, r.score, r.week_start, csvEsc(r.note), r.created_at].join(','));
      }
      return sendCsv(res, `records-${type}-${cycle_start}.csv`, lines.join('\n'));
    }
    const rows = await rankingRows(pool, type, cycle_start, { activeOnly: false });
    const lines = [['排名', '成员', '标签', '积分'].join(',')];
    for (const r of rows) lines.push([r.rank, csvEsc(r.nickname), csvEsc(r.tag), r.total].join(','));
    return sendCsv(res, `ranking-${type}-${cycle_start}.csv`, lines.join('\n'));
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 全量业务备份 (JSON) —— 含全部业务数据, 仅管理员
// 明确使用业务表白名单: 账号(users)、安全审计、认证相关数据**不在**网页备份里,
// 避免把密码哈希/Token 版本导出; 账号灾备走服务器级 mysqldump。
const BACKUP_TABLES = ['settings', 'members', 'score_rules', 'score_records', 'weekly_results', 'reward_logs'];

router.get('/backup', requireAdmin, async (req, res) => {
  try {
    const tables = {};
    for (const t of BACKUP_TABLES) {
      tables[t] = await query(`SELECT * FROM ${t}`);
    }
    ok(res, {
      scope: 'business',
      tables_included: BACKUP_TABLES,
      accounts_included: false,
      note: '账号/安全审计不在网页备份范围内（避免导出密码哈希）；完整灾备请使用服务器 mysqldump。',
      exported_at: new Date().toISOString(),
      tables,
    });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 恢复备份 (覆盖式) —— 不可逆, 仅超级管理员
// 只允许写业务表白名单; 绝不触碰 users / security_audit_logs 等认证数据。
router.post('/restore', requireSuperAdmin, async (req, res) => {
  const tables = req.body && req.body.tables;
  if (!tables || typeof tables !== 'object') return fail(res, 400, '缺少 tables 数据');
  const order = BACKUP_TABLES;
  try {
    await transaction(async (con) => {
      for (const t of order) {
        const rows = tables[t];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        await con.execute(`DELETE FROM ${t}`);
        for (const row of rows) {
          const cols = Object.keys(row).filter((c) => !c.startsWith('__'));
          if (!cols.length) continue;
          const placeholders = cols.map(() => '?').join(',');
          const colList = cols.map((c) => '`' + c + '`').join(',');
          const vals = cols.map((c) => row[c]);
          await con.execute(`INSERT INTO ${t} (${colList}) VALUES (${placeholders})`, vals);
        }
      }
    });
    ok(res, { restored: true });
  } catch (e) {
    fail(res, 500, e.message);
  }
});
