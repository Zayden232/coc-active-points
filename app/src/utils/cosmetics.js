// 限时外观(转盘奖励)的展示辅助
// 数据来自 GET /api/wheel/cosmetics: [{member_id, kind, value, label, expires_at}]
export function cosmeticMap(list) {
  const map = {};
  for (const c of list || []) {
    const e = map[c.member_id] || (map[c.member_id] = {});
    e[c.kind] = c;
  }
  return map;
}

/** 头像框 CSS 类(与各页面 scoped 样式对应) */
export function frameClass(entry) {
  return entry && entry.frame ? `cos-frame-${entry.frame.value}` : '';
}

/** 昵称颜色内联样式 */
export function nicknameColorStyle(entry) {
  const v = entry && entry.nickname_color ? entry.nickname_color.value : '';
  if (v === 'gold') return 'color:#b8860b;font-weight:700;';
  if (v === 'purple') return 'color:#7c3aed;font-weight:700;';
  return '';
}

/** 限时称号文案 */
export function temporaryTitle(entry) {
  return entry && entry.title ? entry.title.label : '';
}
