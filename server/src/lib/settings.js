import { query, getOne, run } from '../db.js';

// 首次启动写入的默认配置 (key -> 默认值, 均为字符串)
export const DEFAULT_SETTINGS = {
  week_start_day: '1',        // 0=周日 ... 6=周六
  reward_week_amount: '6',    // 周奖金额(元)
  reward_week_rank: '1',      // 周奖名次
  reward_month_amount: '12',  // 月奖(每4周)金额
  reward_month_rank: '1',
  reward_season_amount: '12', // 赛季奖金额
  reward_season_rank: '1',
  coc_clan_tag: '', // 部落冲突官方 API 同步用的部落标签(留空=未启用同步)
};

// 占位默认积分规则 —— 分值/上限是"模板默认值", 部署后请在"设置-积分规则"里改成你的真实体系
// quick_values = 录入页快捷按钮, **必须与该规则 quantity 的单位一致**(系统不做换算)
export const DEFAULT_RULES = [
  { name: '捐兵',        unit: '每100兵力', score_per_unit: '1.00', weekly_cap: '20.00', quick_values: '100,500,1000', enabled: 1, sort_order: 1 },
  { name: '部落战三星',  unit: '每次',      score_per_unit: '3.00', weekly_cap: '15.00', quick_values: '1,2,3', enabled: 1, sort_order: 2 },
  { name: '联赛胜利星',  unit: '每颗星',    score_per_unit: '1.00', weekly_cap: '20.00', quick_values: '1,2,5', enabled: 1, sort_order: 3 },
  { name: '突袭(都城)',  unit: '每次进攻',  score_per_unit: '1.00', weekly_cap: '10.00', quick_values: '1,2,3', enabled: 1, sort_order: 4 },
  { name: '竞赛',        unit: '每1000点数', score_per_unit: '5.00', weekly_cap: '20.00', quick_values: '1000,2000,5000', enabled: 1, sort_order: 5 },
];

export async function getAllSettings() {
  const rows = await query('SELECT skey, svalue FROM settings');
  const obj = {};
  for (const r of rows) obj[r.skey] = r.svalue;
  return obj;
}

export async function getSetting(key, fallback) {
  const row = await getOne('SELECT svalue FROM settings WHERE skey = ?', [key]);
  return row ? row.svalue : fallback;
}

// 幂等: settings 空则写入默认配置, score_rules 空则写入默认规则
export async function ensureSeeded() {
  const s = await getOne('SELECT COUNT(*) AS c FROM settings');
  if (!s || s.c === 0) {
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      await run('INSERT INTO settings (skey, svalue) VALUES (?, ?)', [k, v]);
    }
  }
  const r = await getOne('SELECT COUNT(*) AS c FROM score_rules');
  if (!r || r.c === 0) {
    for (const rule of DEFAULT_RULES) {
      await run(
        'INSERT INTO score_rules (name, unit, score_per_unit, weekly_cap, quick_values, enabled, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [rule.name, rule.unit, rule.score_per_unit, rule.weekly_cap, rule.quick_values || '', rule.enabled, rule.sort_order]
      );
    }
  }
}
