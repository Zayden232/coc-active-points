import { Router } from 'express';
import { query, getOne, run, pool } from '../db.js';
import { ok, fail } from '../lib/respond.js';
import { requireAdmin } from '../lib/auth.js';
import { getAllSettings, getSetting } from '../lib/settings.js';
import { withQuickValuesList } from '../lib/rules.js';
import { weekStart, cycleStartOf, todayYmd, prevCycleStart } from '../lib/cycle.js';
import { rankingRows } from '../lib/calc.js';

export const router = Router();

const EDITABLE_KEYS = [
  'week_start_day',
  'reward_week_amount',
  'reward_week_rank',
  'reward_month_amount',
  'reward_month_rank',
  'reward_season_amount',
  'reward_season_rank',
  'coc_clan_tag', // 部落标签(官方 API 同步用), 例如 #2G9JCRQ9Y
];

// 配置属于管理信息, 不对访客开放 (访客页面不依赖它)
router.get('/settings', requireAdmin, async (req, res) => {
  try {
    ok(res, await getAllSettings());
  } catch (e) {
    fail(res, 500, e.message);
  }
});

router.put('/settings', async (req, res) => {
  const body = req.body || {};
  for (const k of Object.keys(body)) {
    if (!EDITABLE_KEYS.includes(k)) return fail(res, 400, `不允许修改 ${k}`);
  }
  try {
    for (const k of EDITABLE_KEYS) {
      if (body[k] != null) {
        await run('INSERT INTO settings (skey, svalue) VALUES (?, ?) ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)', [k, String(body[k])]);
      }
    }
    ok(res, await getAllSettings());
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 预算 (一个12周赛季: 周奖×12 + 月奖×3 + 赛季奖×1) —— 仅管理员
router.get('/budget', requireAdmin, async (req, res) => {
  try {
    const s = await getAllSettings();
    const wAmt = Number(s.reward_week_amount || 0);
    const mAmt = Number(s.reward_month_amount || 0);
    const sAmt = Number(s.reward_season_amount || 0);
    const lines = [
      { name: '周奖(每周)', amount: wAmt, times: 12, subtotal: wAmt * 12 },
      { name: '月奖(每4周)', amount: mAmt, times: 3, subtotal: mAmt * 3 },
      { name: '赛季奖(每12周)', amount: sAmt, times: 1, subtotal: sAmt * 1 },
    ];
    const total = lines.reduce((a, l) => a + l.subtotal, 0);
    const paid = await getOne('SELECT COALESCE(SUM(amount), 0) AS s FROM reward_logs WHERE paid = 1');
    ok(res, { lines, total, paid: Number(paid.s) });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 录入/表单所需的选项 (启用规则 + 活跃成员 + 当前周期)
// 注意: members 必须带上 tag —— 录入页选人弹层用它做按标签搜索;
// 另外带上 town_hall / prosperity: 弹层次行现在展示「大本营 X · 繁荣 Y」。
router.get('/options', async (req, res) => {
  try {
    const startDay = Number(await getSetting('week_start_day', '1'));
    const ws = weekStart(todayYmd(), startDay);
    const members = await query(
      'SELECT id, nickname, tag, status, town_hall, prosperity FROM members WHERE deleted_at IS NULL ORDER BY nickname ASC'
    );
    const rules = withQuickValuesList(await query('SELECT * FROM score_rules WHERE enabled = 1 ORDER BY sort_order, id'));
    ok(res, {
      members: members.filter((m) => m.status !== 2),
      rules,
      now: {
        today: todayYmd(),
        week_start: ws,
        month_start: cycleStartOf('month', ws, startDay),
        season_start: cycleStartOf('season', ws, startDay),
      },
    });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 仪表盘
router.get('/dashboard', async (req, res) => {
  try {
    const startDay = Number(await getSetting('week_start_day', '1'));
    const today = todayYmd();
    const ws = weekStart(today, startDay);
    const prevWs = prevCycleStart('week', ws);
    const todayEntries = await getOne('SELECT COUNT(*) AS c FROM score_records WHERE created_at >= CURDATE()');
    const weekEntries = await getOne('SELECT COUNT(*) AS c FROM score_records WHERE week_start = ?', [ws]);
    const weekMembers = await getOne('SELECT COUNT(DISTINCT member_id) AS c FROM score_records WHERE week_start = ?', [ws]);
    const memberCount = await getOne('SELECT COUNT(*) AS c FROM members WHERE status != 2 AND deleted_at IS NULL');
    const prevSettled = await getOne('SELECT COUNT(*) AS c FROM weekly_results WHERE cycle_type = ? AND cycle_start = ?', ['week', prevWs]);
    const pending = await getOne('SELECT COUNT(*) AS c FROM reward_logs WHERE paid = 0');
    const top3 = (await rankingRows(pool, 'week', ws, { activeOnly: true })).slice(0, 3);
    ok(res, {
      now: {
        today,
        week_start: ws,
        month_start: cycleStartOf('month', ws, startDay),
        season_start: cycleStartOf('season', ws, startDay),
      },
      today_entries: Number(todayEntries.c),
      week_entries: Number(weekEntries.c),
      week_members: Number(weekMembers.c),
      member_count: Number(memberCount.c),
      prev_week_settled: Number(prevSettled.c) > 0,
      pending_rewards: Number(pending.c),
      top3,
    });
  } catch (e) {
    fail(res, 500, e.message);
  }
});
