import { Router } from 'express';
import { pool, query } from '../db.js';
import { ok, fail } from '../lib/respond.js';
import { rankingRows } from '../lib/calc.js';
import { weekStart, cycleStartOf, todayYmd, listCycles, CYCLE_TYPES } from '../lib/cycle.js';
import { getSetting } from '../lib/settings.js';

export const router = Router();

// 分项榜列表: 每个启用中的积分规则 = 一个分项榜(榜名即规则名, 无需额外配置)
router.get('/boards', async (req, res) => {
  try {
    const rules = await query(
      'SELECT id, name, unit, score_per_unit, weekly_cap, sort_order FROM score_rules WHERE enabled = 1 ORDER BY sort_order, id'
    );
    ok(res, rules);
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 排行榜
//   type=week|month|season (season 仅保留后端能力, 前端入口已移除)
//   rule_id=积分项 id  -> 分项榜
//   include_left=1     -> 包含已离开成员(默认只统计在部落成员)
router.get('/', async (req, res) => {
  const type = req.query.type || 'week';
  if (!CYCLE_TYPES.includes(type)) return fail(res, 400, '无效周期类型');
  let ruleId = null;
  if (req.query.rule_id != null && req.query.rule_id !== '') {
    ruleId = Number(req.query.rule_id);
    if (!Number.isInteger(ruleId) || ruleId <= 0) return fail(res, 400, '无效积分项');
  }
  const rawIncludeLeft = String(req.query.include_left == null ? '' : req.query.include_left);
  const includeLeft = rawIncludeLeft === '1' || rawIncludeLeft === 'true';
  try {
    const startDay = Number(await getSetting('week_start_day', '1'));
    const ws = weekStart(todayYmd(), startDay);
    const cycle_start = req.query.cycle_start || cycleStartOf(type, ws, startDay);
    const rows = await rankingRows(pool, type, String(cycle_start), { activeOnly: !includeLeft, ruleId });
    ok(res, { type, cycle_start, rule_id: ruleId, include_left: includeLeft, rows });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 可选周期列表 (供结算/历史选择)
router.get('/cycles', async (req, res) => {
  const type = req.query.type || 'week';
  if (!CYCLE_TYPES.includes(type)) return fail(res, 400, '无效周期类型');
  try {
    const startDay = Number(await getSetting('week_start_day', '1'));
    const cycles = listCycles(type, Number(req.query.limit) || 8, todayYmd(), startDay);
    ok(res, { type, cycles });
  } catch (e) {
    fail(res, 500, e.message);
  }
});
