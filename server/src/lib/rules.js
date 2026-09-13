// 积分规则的对外形态: DB 里 quick_values 存成逗号分隔字符串,
// API 统一返回数组(前端 Array.isArray 判断), 顺便做正数/去重/最多 4 个的清洗。
export function parseQuickValues(raw) {
  const list = Array.isArray(raw) ? raw : String(raw == null ? '' : raw).split(/[,，\s]+/);
  return [...new Set(
    list
      .map((x) => Number(String(x).trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
  )].slice(0, 4);
}

export function stringifyQuickValues(raw) {
  return parseQuickValues(raw).join(',');
}

/** 规则行 -> API 形态(quick_values 变数组) */
export function withQuickValues(row) {
  if (!row) return row;
  return { ...row, quick_values: parseQuickValues(row.quick_values) };
}

export function withQuickValuesList(rows) {
  return Array.isArray(rows) ? rows.map(withQuickValues) : rows;
}
