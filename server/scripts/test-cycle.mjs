import { weekStart, cycleStartOf, listCycles, rangeOf } from '../src/lib/cycle.js';

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log('PASS:', msg);
  else {
    failed++;
    console.error('FAIL:', msg);
  }
}

// 周起始 (锚点 2024-01-01 是周一)
assert(weekStart('2024-01-01', 1) === '2024-01-01', '周一 = 锚点本身');
assert(weekStart('2024-01-03', 1) === '2024-01-01', '周三 → 本周周一');
assert(weekStart('2023-12-31', 1) === '2023-12-25', '周日 → 上周周一');

// 月块 (每4周, 与周对齐)
assert(cycleStartOf('month', '2024-01-01', 1) === '2024-01-01', '月块起点 = 锚点');
assert(cycleStartOf('month', '2024-02-05', 1) === '2024-01-29', '第5周归入第2个月块');
assert(cycleStartOf('month', '2024-01-29', 1) === '2024-01-29', '月块边界');

// 赛季块 (每12周)
assert(cycleStartOf('season', '2024-01-01', 1) === '2024-01-01', '赛季起点 = 锚点');
assert(cycleStartOf('season', '2024-03-25', 1) === '2024-03-25', '12周边界');
assert(cycleStartOf('season', '2024-03-24', 1) === '2024-01-01', '边界前一天仍属上赛季');

// 区间
assert(rangeOf('week', '2024-01-01')[1] === '2024-01-08', '周区间止');
assert(rangeOf('month', '2024-01-01')[1] === '2024-01-29', '月区间止');
assert(rangeOf('season', '2024-01-01')[1] === '2024-03-25', '赛季区间止');

// 周期列表 (从新到旧)
const cyc = listCycles('week', 3, '2024-01-03', 1);
assert(cyc[0] === '2024-01-01', 'listCycles[0] = 本周');
assert(cyc[1] === '2023-12-25', 'listCycles[1] = 上周');
assert(cyc[2] === '2023-12-18', 'listCycles[2] = 上上周');

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
