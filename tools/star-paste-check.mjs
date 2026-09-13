// ============================================================
// 录入页「粘贴星数名单」解析器验证 (纯逻辑, 不需要数据库/浏览器)
//
// 用法:  node tools/star-paste-check.mjs
//
// 为什么要用 data: URL 导入:
//   app/package.json 没有 "type": "module", 所以 app/**/*.js 在 Node 眼里是 CJS,
//   直接 import 会因为 ESM 语法报错。这里把源码读出来按 ESM 加载,
//   验证的就是"真正打进 H5 包里的那份源码", 不做任何改动/复制。
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = (rel) => fileURLToPath(new URL(rel, import.meta.url));

const source = readFileSync(url('../app/src/utils/star-paste.js'), 'utf8');
const mod = await import(
  'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64')
);
const { normalizeName, normalizeTag, editDistance, parseStarGroups, matchNames, buildStarPlan, summarizePlan, planEntries } = mod;

const roster = JSON.parse(readFileSync(url('./star-paste-roster.json'), 'utf8'));

let pass = 0;
const fails = [];
function check(cond, msg) {
  if (cond) {
    pass += 1;
    return;
  }
  fails.push(msg);
  console.log('  ✗ ' + msg);
}
function section(name) {
  console.log('\n== ' + name + ' ==');
}

// 用户实际给的那份豆包识图结果, 原样保存 (含 markdown 标题、全角冒号、括号包裹的名字)
const PASTED = `# 按胜利之星分组整理
15星：帅隆隆、經过、泥头车出鸡、晚归、渴望、湾张、李烁尘
14星：小羊、王运好、白白白白白、如影随形/瑞
13星：骑着狼放着羊、清风霁月
12星：残影、（结核）、半云仙、村长不在家
11星：玫瑰、相遇、天下
9星：林一、YEAH
7星：陈E逊
6星：T0、堕落
5星：神圣部落、为何一切变得如此
4星：骑刘翔兜风
0星：Lazy、asver`;

section('解析: 分组 / 星数 / 名字');
{
  const { groups, ignoredLines } = parseStarGroups(PASTED);
  check(groups.length === 11, `解析出 11 组 (实际 ${groups.length})`);
  check(
    JSON.stringify(groups.map((g) => g.star)) === JSON.stringify([15, 14, 13, 12, 11, 9, 7, 6, 5, 4, 0]),
    '星数顺序 [15,14,13,12,11,9,7,6,5,4,0]'
  );
  check(groups.reduce((n, g) => n + g.names.length, 0) === 30, '名字总数 30');
  check(groups[0].names.length === 7 && groups[0].names[0] === '帅隆隆', '15星组 7 人且首个是「帅隆隆」');
  check(groups[1].names.includes('如影随形/瑞'), '含 "/" 的昵称不会被切开');
  check(groups[3].names.includes('（结核）'), '括号包裹的名字原样保留');
  check(ignoredLines.length === 0, 'markdown 标题行不进 ignoredLines');
}

section('匹配: 精确 / 近似 / 未匹配 / 0星');
{
  const plan = buildStarPlan(PASTED, roster);
  const s = summarizePlan(plan);

  // 30 个名字里 0 星组占 2 个(Lazy 精确命中但 0 星不录入 / asver 名单里没有),
  // 真正要录入的是 28 人: 25 个精确 + 3 个近似(經过 / 泥头车出鸡 / T0)
  check(s.people === 28, `可录入 28 人 (实际 ${s.people})`);
  check(s.groupCount === 10, `10 个非 0 星组 (实际 ${s.groupCount})`);
  check(s.exact === 25, `精确匹配 25 人 (实际 ${s.exact})`);
  check(s.fuzzy === 3, `近似匹配 3 人 (实际 ${s.fuzzy})`);
  check(s.unresolved === 0, `没有需要人工处理的名字 (实际 ${s.unresolved})`);
  check(s.duplicate === 0, '没有重复成员');
  check(s.zeroGroups === 1 && s.zeroPeople === 2, '0 星 1 组 2 人, 单独统计');

  const row = (star, name) =>
    plan.groups.find((g) => g.star === star).rows.find((r) => r.name === name);

  check(row(15, '帅隆隆').kind === 'exact' && row(15, '帅隆隆').memberName === '帅隆隆', '「帅隆隆」精确命中');
  check(row(15, '經过').kind === 'fuzzy' && row(15, '經过').memberName === '经过', '「經过」繁体 -> 近似命中「经过」');
  check(
    row(15, '泥头车出鸡').kind === 'fuzzy' && row(15, '泥头车出鸡').memberName === '泥头车出击',
    '「泥头车出鸡」识图错字 -> 近似命中「泥头车出击」'
  );
  check(row(6, 'T0').kind === 'fuzzy' && row(6, 'T0').memberName === 'T O', '「T0」-> 近似命中「T O」');
  check(row(12, '（结核）').kind === 'exact' && row(12, '（结核）').memberName === '结核', '「（结核）」去括号后精确命中');
  check(row(0, 'asver').kind === 'zero', '0 星的 asver 标为 zero(不参与录入、不算未匹配)');
  check(roster.some((m) => m.nickname === '泥头车出击'), '近似匹配指向的成员确实在名单里');
}

section('提交计划: 每组一个数量, 一次成批');
{
  const plan = buildStarPlan(PASTED, roster);
  const entries = planEntries(plan, 3, '识图导入');

  check(entries.length === 10, `生成 10 组 entries (实际 ${entries.length})`);
  check(
    JSON.stringify(entries.map((e) => e.quantity)) === JSON.stringify([15, 14, 13, 12, 11, 9, 7, 6, 5, 4]),
    '每组数量 = 对应星数, 且不含 0 星组'
  );
  check(entries.every((e) => e.rule_id === 3 && e.note === '识图导入'), '所有组带同一个 rule_id 与备注');
  check(entries.reduce((n, e) => n + e.member_ids.length, 0) === 28, '合计 28 个成员位');
  check(entries.every((e) => e.member_ids.every((id) => Number.isSafeInteger(id) && id > 0)), '成员 id 都是有效正整数');
  const allIds = entries.flatMap((e) => e.member_ids);
  check(new Set(allIds).size === allIds.length, '同一成员不会出现在两组里(不会重复记分)');
  check(entries[0].member_ids.length === 7, '15 星组 7 人');
  check(planEntries(plan, 0).length === 0 && planEntries(plan, null).length === 0, 'rule_id 非法 -> 不生成 entries');
}

section('边界: 重复成员 / 多候选 / 忽略 / 容错');
{
  const small = [
    { id: 1, nickname: '李雷', tag: '' },
    { id: 2, nickname: '李蕾', tag: '' },
    { id: 3, nickname: '张三', tag: '' },
    { id: 4, nickname: '王五', tag: '#2G9' },
  ];

  const ambiguous = matchNames(['李累'], small)[0];
  check(ambiguous.kind === 'ambiguous' && ambiguous.candidates.length === 2, '差一个字有两个候选 -> ambiguous(不猜)');
  check(matchNames(['李累'], small)[0].memberId === null, 'ambiguous 不带 memberId');

  const one = matchNames(['李累'], [{ id: 9, nickname: '李雷', tag: '' }])[0];
  check(one.kind === 'fuzzy' && one.memberId === 9, '唯一候选才自动近似匹配');

  const byTag = matchNames(['2G9'], small)[0];
  check(byTag.kind === 'tag' && byTag.memberId === 4, '按游戏标签也能认出成员');

  const dup = buildStarPlan('15星：张三\n14星：张三、王五', small);
  check(dup.groups[1].rows[0].kind === 'duplicate', '同一成员重复出现 -> 第二次标 duplicate');
  check(dup.groups[0].rows[0].memberId === 3, '重复时保留先出现的那组');
  check(summarizePlan(dup).people === 2, '重复成员只计一次 (张三 + 王五)');

  const plan2 = buildStarPlan('15星：张三、王五', small);
  plan2.groups[0].rows[1].ignored = true;
  check(summarizePlan(plan2).people === 1 && summarizePlan(plan2).ignored === 1, '忽略的行不进提交计划');
  check(planEntries(plan2, 5)[0].member_ids.length === 1, '忽略后该组只剩 1 人');

  const mixed = parseStarGroups('说明行：以下按星数分组\n15星：张三 王五\n\n１５颗: 李雷');
  check(mixed.ignoredLines.length === 1 && mixed.ignoredLines[0].startsWith('说明行'), '无星数但有数字的说明行进 ignoredLines');
  check(mixed.groups[0].names.length === 2, '没写顿号时按空格切分名字');
  check(mixed.groups[1].star === 15 && mixed.groups[1].names[0] === '李雷', '全角数字「１５颗」也能解析');

  const wrap = buildStarPlan('15星： 张三、张三、', small);
  check(wrap.groups[0].rows.length === 2, '空名字(连续顿号/结尾顿号)被丢掉');

  check(normalizeName(' T 0 ') === 't0' && normalizeName('Ｔ０') === 't0', 'normalizeName 去空白 + 全角转半角');
  check(normalizeTag('#2g9') === '2G9', 'normalizeTag 去 # 并大写');
  check(editDistance('经过', '經过') === 1 && editDistance('abc', 'abc') === 0, 'editDistance 基本正确');
}

section('快速切换候选 (alts)');
{
  const small = [
    { id: 1, nickname: '李雷', tag: '' },
    { id: 2, nickname: '李蕾', tag: '' },
    { id: 3, nickname: '李雷雷', tag: '' },
    { id: 4, nickname: '王五', tag: '' },
  ];

  const amb = matchNames(['李累'], small)[0];
  check(amb.kind === 'ambiguous', '两个同距离候选 -> ambiguous');
  check(amb.alts.length === 2 && amb.alts.every((a) => a.id === 1 || a.id === 2), 'ambiguous 行把候选直接放进 alts(可一键切换)');
  check(amb.alts.every((a) => a.nickname && a.distance === 1), 'alts 带昵称与距离');

  // 精确命中的行: 如果名单里还有"差一个字"的另一个人, 也要给出切换项
  const exact = matchNames(['王五'], [{ id: 4, nickname: '王五', tag: '' }, { id: 5, nickname: '王伍', tag: '' }])[0];
  check(exact.kind === 'exact' && exact.memberId === 4, '精确命中优先');
  check(exact.alts.length === 1 && exact.alts[0].id === 5, '精确行也给出"差一个字"的成员供快速切换');
  check(exact.alts.every((a) => a.id !== exact.memberId), 'alts 不含已选中的那个');

  const fuzzy = matchNames(['李雷'], [{ id: 1, nickname: '李雷', tag: '' }, { id: 3, nickname: '李蕾', tag: '' }])[0];
  check(fuzzy.kind === 'exact' && fuzzy.alts.length === 1, '容易混的两个名字互为切换项');

  const none = matchNames(['王伍陆'], small)[0];
  check(none.kind === 'none', '差 2 个字不自动匹配(尺度与自动匹配一致)');
  check(none.alts.length === 0, '差 2 个字也给切换项的话, 2 字昵称会人人相似 -> 不给');

  const far = matchNames(['完全不同'], small)[0];
  check(far.alts.length === 0, '差得远就不给候选, 避免误导');

  const realish = matchNames(['天下'], [{ id: 7, nickname: '天下', tag: '' }, { id: 8, nickname: '天谴', tag: '' }])[0];
  check(realish.alts.some((a) => a.nickname === '天谴'), '实测场景: 「天下」可一键切到「天谴」');

  const plan = buildStarPlan('15星：李累、王五、李雷', small);
  const rows = plan.groups[0].rows;
  check(rows.every((r) => Array.isArray(r.alts)), '计划里每行都有 alts 字段');
  check(buildStarPlan('0星：李累', small).groups[0].rows[0].alts.length === 0, '0 星行不需要候选');
  check(matchNames(['经'], small)[0].alts.length === 0, '单字名字不给候选(太容易乱匹配)');
}

console.log(`\n结果: ${pass} PASS / ${fails.length} FAIL`);
if (fails.length) {
  console.log('失败项:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
