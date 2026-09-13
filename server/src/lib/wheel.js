// 幸运转盘: 奖励池与抽取逻辑(纯函数, 便于注入随机源做测试)
// 中奖概率固定 45%, 由服务端判定; 前端转盘动画不参与结果计算。

export const WIN_PROBABILITY = 0.45;

// 奖励池(weight 为相对权重, 只在"已中奖"后用于选择具体奖励)
export const REWARD_POOL = [
  { key: 'frame_flame', kind: 'frame', value: 'flame', label: '烈焰头像框', weight: 20 },
  { key: 'frame_star', kind: 'frame', value: 'star', label: '星光头像框', weight: 18 },
  { key: 'frame_jade', kind: 'frame', value: 'jade', label: '翡翠头像框', weight: 18 },
  { key: 'color_gold', kind: 'nickname_color', value: 'gold', label: '金色昵称', weight: 16 },
  { key: 'color_purple', kind: 'nickname_color', value: 'purple', label: '紫色昵称', weight: 14 },
  { key: 'title_lucky', kind: 'title', value: 'lucky', label: '今日幸运星', weight: 14 },
];

/** 权重抽取(忽略中奖率, 用于已判定中奖后选具体奖励) */
export function pickWeighted(rand = Math.random, { excludeKeys = [] } = {}) {
  const pool = REWARD_POOL.filter((r) => !excludeKeys.includes(r.key));
  const list = pool.length ? pool : REWARD_POOL;
  const total = list.reduce((a, r) => a + r.weight, 0);
  let x = rand() * total;
  for (const r of list) {
    x -= r.weight;
    if (x < 0) return r;
  }
  return list[list.length - 1];
}

/** 一次抽奖: 未中奖返回 null; 中奖返回奖励项 */
export function drawReward(rand = Math.random, opts = {}) {
  if (rand() >= WIN_PROBABILITY) return null;
  return pickWeighted(rand, opts);
}

/** 业务日期(服务器本地时区, 与备份/cron 一致) */
export function businessDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
