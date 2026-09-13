/**
 * 「按星数分组」文本解析 + 成员匹配 (纯函数, 不依赖 uni / 浏览器 API)
 *
 * 场景: 录入页「粘贴星数名单」——把豆包/OCR 识图结果整段贴进来, 例如
 *   # 按胜利之星分组整理
 *   15星：帅隆隆、經过、泥头车出鸡
 *   14星：小羊、王运好
 * 解析成  星数 -> 名字列表, 再匹配到真实成员, 供一次分组录入(每组一个数量)。
 *
 * 原则: 宁可报"未匹配/多个候选"让人确认, 也不猜错人。
 *  - 精确匹配(昵称/游戏标签) 之外, 只接受"整份名单里唯一一个只差一个字"的候选;
 *  - 有多个候选一律交给人工指认;
 *  - 0 星组不参与录入(后端要求数量 > 0), 只展示标注。
 */

const FULLWIDTH = /[\uFF01-\uFF5E]/g;
// 名字外面常见的包裹符号: （结核） / (结核) / 【结核】 / 「结核」
const WRAPPERS = /[（）()【】\[\]「」『』]/g;
const HEADING = /^#{1,6}\s/;
// 形如: 15星：xxx / 15 星: xxx / - 15颗: xxx
const STAR_LINE = /^\s*(?:[-*•·]\s*)?(\d{1,3})\s*(?:星|颗|顆)\s*[：:，,、.\-—]?\s*(.*)$/;
// 名字分隔符: 顿号/逗号/分号/竖线 (故意不含 "/" —— 昵称里真的有 "如影随形/瑞")
const NAME_SEP = /[、,，;；|]/;

/** 归一化昵称: 全角转半角 / 去所有空白 / 去包裹符号 / 小写 */
export function normalizeName(raw) {
  return String(raw == null ? '' : raw)
    .replace(FULLWIDTH, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u3000]/g, '')
    .replace(WRAPPERS, '')
    .toLowerCase();
}

/** 归一化游戏标签: 去 # 后大写 (用于按标签兜底匹配) */
export function normalizeTag(raw) {
  return String(raw == null ? '' : raw).trim().replace(/^#/, '').toUpperCase();
}

/** Levenshtein 距离 (名字都很短, 直接算) */
export function editDistance(a, b) {
  const s = String(a == null ? '' : a);
  const t = String(b == null ? '' : b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= t.length; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[t.length];
}

/**
 * 解析文本 -> { groups: [{ star, names }], ignoredLines: [string] }
 * 解析不出的行不会静默丢弃, 会放进 ignoredLines 让人回看。
 */
export function parseStarGroups(text) {
  const groups = [];
  const ignoredLines = [];

  for (const rawLine of String(text == null ? '' : text).split(/\r?\n/)) {
    // 只把全角数字统一成半角(星数偶尔会是全角); 名字保持用户粘贴的原样, 便于人眼核对
    const line = rawLine.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).trim();
    if (!line) continue;
    if (HEADING.test(line)) continue; // markdown 标题(如 "# 按胜利之星分组整理")
    if (!/\d/.test(line)) {
      ignoredLines.push(line); // 与星数无关的说明行
      continue;
    }

    const m = line.match(STAR_LINE);
    if (!m) {
      ignoredLines.push(line);
      continue;
    }

    const rest = m[2].trim();
    const names = (NAME_SEP.test(rest) ? rest.split(NAME_SEP) : rest.split(/[\s\u3000]+/))
      .map((s) => s.trim())
      .filter(Boolean);

    if (!names.length) continue; // 有星数没名字的行, 跳过
    groups.push({ star: Number(m[1]), names });
  }

  return { groups, ignoredLines };
}

/**
 * 名字列表 -> 匹配结果
 * kind: exact(昵称一致) / tag(标签一致) / fuzzy(唯一近似) / ambiguous(多个候选) / none(没匹配上)
 */
export function matchNames(names, members) {
  const list = Array.isArray(members) ? members : [];
  const byNick = new Map();
  const byTag = new Map();

  for (const m of list) {
    const nk = normalizeName(m && m.nickname);
    if (nk) byNick.set(nk, [...(byNick.get(nk) || []), m]);
    const tk = normalizeTag(m && m.tag);
    if (tk) byTag.set(tk, [...(byTag.get(tk) || []), m]);
  }

  const hit = (m) => ({
    memberId: Number(m.id),
    memberName: m.nickname,
    candidates: [],
  });

  // "快速切换"候选: 归一化后"只差一个字以内"(和自动匹配同一个尺度)的其它成员, 最多 3 个, 按距离排序。
  // 口径刻意和自动匹配一致: 能自动匹配的相似度, 才值得出现在"快速切换"里 ——
  // 否则 2 个字的中文昵称之间差 2 个字就"人人相似", 满屏噪音反而误导。
  // 超出这个尺度的, 面板上仍保留「指认」(弹层预填名字, 可搜全部成员)。
  const altList = (key, excludeId = null, max = 3) => {
    if (!key || key.length < 2) return [];
    return list
      .map((m) => ({ m, d: editDistance(normalizeName(m && m.nickname), key) }))
      .filter((x) => {
        const nk = normalizeName(x.m && x.m.nickname);
        return nk.length >= 2 && x.d <= 1 && Number(x.m.id) !== excludeId;
      })
      .sort((a, b) => a.d - b.d || String(a.m.nickname).localeCompare(String(b.m.nickname)))
      .slice(0, max)
      .map((x) => ({ id: Number(x.m.id), nickname: x.m.nickname, distance: x.d }));
  };

  return (Array.isArray(names) ? names : []).map((name) => {
    const key = normalizeName(name);

    const exact = key ? byNick.get(key) || [] : [];
    if (exact.length === 1) {
      const chosen = exact[0];
      return { name, kind: 'exact', ...hit(chosen), alts: altList(key, Number(chosen.id)) };
    }
    if (exact.length > 1) {
      return {
        name,
        kind: 'ambiguous',
        memberId: null,
        memberName: '',
        candidates: exact.map((m) => m.nickname),
        alts: exact.map((m) => ({ id: Number(m.id), nickname: m.nickname, distance: 0 })),
      };
    }

    const tagKey = normalizeTag(name);
    const byTagHit = tagKey ? byTag.get(tagKey) || [] : [];
    if (byTagHit.length === 1) {
      const chosen = byTagHit[0];
      return { name, kind: 'tag', ...hit(chosen), alts: altList(key, Number(chosen.id)) };
    }

    // 近似匹配: 只差一个字, 且整份名单里唯一 —— 否则不猜
    const near =
      key.length >= 2
        ? list.filter((m) => {
            const nk = normalizeName(m && m.nickname);
            return nk.length >= 2 && editDistance(nk, key) <= 1;
          })
        : [];

    if (near.length === 1) {
      const chosen = near[0];
      return { name, kind: 'fuzzy', ...hit(chosen), alts: altList(key, Number(chosen.id)) };
    }
    if (near.length > 1) {
      return {
        name,
        kind: 'ambiguous',
        memberId: null,
        memberName: '',
        candidates: near.map((m) => m.nickname),
        alts: near.map((m) => ({ id: Number(m.id), nickname: m.nickname, distance: 1 })),
      };
    }

    return {
      name,
      kind: 'none',
      memberId: null,
      memberName: '',
      candidates: [],
      alts: altList(key),
    };
  });
}

/**
 * 整段文本 -> 录入计划
 * groups[].rows[]: { name, memberId, memberName, candidates, alts, kind, ignored }
 *   kind: exact / tag / fuzzy / ambiguous / none / manual(人工指认) / duplicate / zero
 *   alts: 归一化后相近的成员(最多 3 个) —— 面板上的「快速切换」就是直接切到这些
 *   kind 里 zero(0 星组, 本来就不录入) / duplicate(同一成员被重复贴到多组, 取先出现的) 不参与录入
 */
export function buildStarPlan(text, members) {
  const { groups, ignoredLines } = parseStarGroups(text);
  const taken = new Set();
  const out = [];

  for (const g of groups) {
    const zero = !(g.star > 0);

    if (zero) {
      out.push({
        star: g.star,
        zero: true,
        rows: g.names.map((name) => ({
          name,
          memberId: null,
          memberName: '',
          candidates: [],
          alts: [],
          kind: 'zero',
          ignored: false,
        })),
      });
      continue;
    }

    const rows = matchNames(g.names, members).map((r) => ({ ...r, ignored: false }));

    for (const r of rows) {
      if (!r.memberId) continue;
      if (taken.has(r.memberId)) {
        r.kind = 'duplicate';
        r.memberId = null;
      } else {
        taken.add(r.memberId);
      }
    }

    out.push({ star: g.star, zero: false, rows });
  }

  return { groups: out, ignoredLines };
}

/** 计划 -> 统计(面板展示与"能不能应用"判断都用它) */
export function summarizePlan(plan) {
  const groups = (plan && plan.groups) || [];
  const s = {
    groupCount: 0,
    people: 0,
    exact: 0,
    fuzzy: 0,
    tag: 0,
    manual: 0,
    unresolved: 0,
    ambiguous: 0,
    duplicate: 0,
    ignored: 0,
    zeroGroups: 0,
    zeroPeople: 0,
  };

  for (const g of groups) {
    if (g.zero) {
      s.zeroGroups += 1;
      s.zeroPeople += g.rows.length;
      continue;
    }

    let counted = 0;
    for (const r of g.rows) {
      if (r.kind === 'duplicate') {
        s.duplicate += 1;
        continue;
      }
      if (r.ignored) {
        s.ignored += 1;
        continue;
      }
      if (!r.memberId) {
        s.unresolved += 1;
        if (r.kind === 'ambiguous') s.ambiguous += 1;
        continue;
      }
      s[r.kind] = (s[r.kind] || 0) + 1;
      counted += 1;
    }

    if (counted) {
      s.groupCount += 1;
      s.people += counted;
    }
  }

  return s;
}

/**
 * 计划 -> 提交用的 entries (每组一个数量)
 * 已忽略 / 未匹配 / 重复 / 0 星 一律不进 entries; 空组不生成。
 */
export function planEntries(plan, ruleId, note = '') {
  const rule = Number(ruleId);
  if (!Number.isSafeInteger(rule) || rule <= 0) return [];

  const out = [];
  for (const g of (plan && plan.groups) || []) {
    if (g.zero || !(g.star > 0)) continue;
    const ids = g.rows
      .filter((r) => !r.ignored && r.memberId)
      .map((r) => Number(r.memberId));
    if (!ids.length) continue;
    out.push({ rule_id: rule, quantity: g.star, member_ids: [...new Set(ids)], note });
  }
  return out;
}
