// 周期计算: 周(7天) / 月(每4周一块) / 赛季(每12周一块)
// 所有周期起始统一取"周一", 且月/赛季块与周严格对齐
// 锚点 2024-01-01 是周一, 用于稳定地切分 4 周块和 12 周块

const DAY = 86400000;

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function dateToYmd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function ymdToDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayYmd() {
  return dateToYmd(new Date());
}

export function addDays(ymd, days) {
  const d = ymdToDate(ymd);
  d.setDate(d.getDate() + days);
  return dateToYmd(d);
}

// startDay: 0=周日 ... 6=周六, 默认 1=周一
export function weekStart(ymd, startDay = 1) {
  const d = ymdToDate(ymd);
  const diff = (d.getDay() - startDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  return dateToYmd(d);
}

export function daysBetween(a, b) {
  return Math.round((ymdToDate(b) - ymdToDate(a)) / DAY);
}

export const ANCHOR = '2024-01-01'; // Monday

export function weeksSinceAnchor(ws, startDay = 1) {
  const anchor = weekStart(ANCHOR, startDay);
  return Math.floor(daysBetween(anchor, ws) / 7);
}

// 求 ws(某周周一) 所属的 week/month/season 周期起始
export function cycleStartOf(type, ws, startDay = 1) {
  const anchor = weekStart(ANCHOR, startDay);
  const w = weeksSinceAnchor(ws, startDay);
  if (type === 'week') return ws;
  if (type === 'month') return addDays(anchor, Math.floor(w / 4) * 4 * 7);
  if (type === 'season') return addDays(anchor, Math.floor(w / 12) * 12 * 7);
  throw new Error(`unknown cycle type: ${type}`);
}

const DAYS_BY_TYPE = { week: 7, month: 28, season: 84 };

// 周期区间 [起, 止) 的 YYYY-MM-DD
export function rangeOf(type, cycleStart) {
  return [cycleStart, addDays(cycleStart, DAYS_BY_TYPE[type])];
}

export function prevCycleStart(type, cycleStart) {
  return addDays(cycleStart, -DAYS_BY_TYPE[type]);
}

// 列出最近的 n 个周期起始 (含当前), 从新到旧
export function listCycles(type, n, refYmd = todayYmd(), startDay = 1) {
  const ws = weekStart(refYmd, startDay);
  const start = cycleStartOf(type, ws, startDay);
  const out = [];
  let cur = start;
  for (let i = 0; i < n; i++) {
    out.push(cur);
    cur = prevCycleStart(type, cur);
  }
  return out;
}

export const CYCLE_TYPES = ['week', 'month', 'season'];
