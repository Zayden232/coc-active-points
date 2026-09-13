// 模块装配冒烟测试: 导入整个应用树, 验证所有路由/命名导出正确, 无需数据库
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { DEFAULT_SETTINGS, DEFAULT_RULES } from '../src/lib/settings.js';
import { CYCLE_TYPES } from '../src/lib/cycle.js';

// 注意: createApp() 现在是 async —— AI 工坊初始化要读磁盘目录,
// 未配置 AI_IDENTITY_SECRET 时会跳过挂载并打印告警, 不影响其它路由。
const app = await createApp();
console.log('PASS: createApp() 无异常, 路由装配成功');
app.locals.closeAiWorkshop?.();

// 校验默认奖励模板
const s = DEFAULT_SETTINGS;
const total =
  Number(s.reward_week_amount) * 12 + Number(s.reward_month_amount) * 3 + Number(s.reward_season_amount) * 1;
console.log('默认赛季预算:', total, '元 (应为 120)');
if (total !== 120) {
  console.error('FAIL: 默认预算不等于 120');
  process.exitCode = 1;
} else {
  console.log('PASS: 默认奖励模板 周6/月12/赛季12 → 120元');
}

console.log('默认积分规则', DEFAULT_RULES.length, '条:', DEFAULT_RULES.map((r) => r.name).join('、'));
console.log('周期类型:', CYCLE_TYPES.join(','));

await pool.end();
console.log(process.exitCode ? '\nSOME FAILED' : '\nIMPORT SMOKE OK');
