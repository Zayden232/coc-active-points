// 成员状态 / 红牌计时 / 归档 的统一业务规则
// 单人修改、批量修改、批量导入恢复都复用这里, 保证口径一致。
import { todayYmd } from './cycle.js';

// 游戏内部落上限 (软限制: 见 canActivate 的说明)
export const TRIBE_LIMIT = 50;

// 业务日期(服务端本地时区, 与周期计算一致)
export function businessDate() {
  return todayYmd();
}

/**
 * 红牌开始日期:
 *  - 目标状态不是红牌 -> NULL (结束本次计时)
 *  - 已经是红牌 -> 保持原有 red_since(不重置计时; 历史未知值保持未知)
 *  - 其他情况 -> 以业务日期开始新一轮计时
 * 开始日期由服务端决定, 不接受前端提交的 red_since。
 */
export function nextRedSince(member, nextStatus, businessDateYmd) {
  if (Number(nextStatus) !== 1) return null;
  if (Number(member && member.status) === 1) return (member && member.red_since) || null;
  return businessDateYmd;
}

/** 已挂红牌天数(仅红牌且已知开始时间时有值, 当天=0) */
export function redDaysOf(member, todayYmd) {
  if (Number(member && member.status) !== 1) return null;
  const since = member && member.red_since;
  if (!since) return null;
  const from = ymdToUtc(since);
  const to = ymdToUtc(todayYmd);
  if (from === null || to === null) return null;
  const days = Math.round((to - from) / 86400000);
  return days >= 0 ? days : null;
}

function ymdToUtc(ymd) {
  const s = String(ymd instanceof Date ? dateToYmd(ymd) : ymd).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function dateToYmd(d) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

/** 超期(第 16 天开始) */
export function isRedOverdue(member, todayYmd) {
  const days = redDaysOf(member, todayYmd);
  return days !== null && days > 15;
}

/**
 * 状态变更是否会让人数突破 50:
 * 只在"本次操作确实让在部落人数增加, 且增加后超过 50"时拒绝。
 * 已经超限的历史部落不会被锁死(与批量导入的软提醒口径一致)。
 */
export function blocksTribeLimit(before, after) {
  return after > TRIBE_LIMIT && after > before;
}

/** 把备注追加到原有备注后面(不覆盖), 超长返回 null */
export function appendNote(oldNote, addition, maxLength = 255) {
  const add = String(addition == null ? '' : addition).trim();
  if (!add) return null;
  const old = String(oldNote == null ? '' : oldNote).trim();
  const merged = old ? `${old} | ${add}` : add;
  if (merged.length > maxLength) return null;
  return merged;
}
