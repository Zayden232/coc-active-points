// ============================================================
// 部落转盘 · 随机抽人「自选成员(按本周分数分组)」流程验证
// 用法: node tools/wheel-fun-pick-flow.mjs
//
// 新功能: 除了原来"按状态分组"(在部落/绿牌/红牌), 还能自己勾选成员, 只从勾选的人里抽一个。
//         因为每周奖励只有 1 份、经常多人同分, 自选面板**按本周排行榜分数分组**:
//         同分的人在一组, 点分数那一行可以整组选中。
//
// 验证的是页面能水: 分组是否正确(分数降序/同分合并/名次区间)、整组选中与取消、
// 勾选/清空/全选、"参与名单"稳定有序、空名单时按钮确实不可点、按分组模式不受影响、
// 抽取结果只能落在参与名单里、抽取过程中改动会被拦住、拿不到分数时的退化路径。
// 做法与 wheel-guest-flow.mjs 相同: 编译 SFC → createRenderer 极简节点操作真渲染
// → 抓住页面实例 → 直接驱动方法/computed; 按钮的 disabled 直接读渲染出来的节点属性。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(path.resolve('app/package.json'));
const sfc = require('@vue/compiler-sfc');

let pass = 0;
const fails = [];
const check = (cond, msg) => {
  if (cond) pass += 1;
  else {
    fails.push(msg);
    console.log('  ✗ ' + msg);
  }
};
const checkEq = (name, actual, expected) => {
  check(
    actual === expected,
    `${name}（期望 ${JSON.stringify(expected)}, 实际 ${JSON.stringify(actual)}）`
  );
};
const section = (name) => console.log('\n== ' + name + ' ==');

// 成员名单(/api/members): 含一位"已离开"
const MEMBERS = [
  { id: 11, nickname: '小羊', status: 0 },
  { id: 12, nickname: '晚归', status: 1 },
  { id: 13, nickname: '阿离', status: 2 },
  { id: 14, nickname: '青禾', status: 0 },
  { id: 15, nickname: '石头', status: 0 },
  { id: 16, nickname: '阿满', status: 1 },
];

// 本周排行榜(/api/ranking?type=week): 36 分 3 人并列第 1, 然后 30/24/24/0
// 已离开的阿离不在榜上(接口默认 active_only)
const RANK_ROWS = [
  { member_id: 11, nickname: '小羊', total: 36, rank: 1 },
  { member_id: 14, nickname: '青禾', total: 36, rank: 2 },
  { member_id: 16, nickname: '阿满', total: 36, rank: 3 },
  { member_id: 12, nickname: '晚归', total: 30, rank: 4 },
  { member_id: 15, nickname: '石头', total: 24, rank: 5 },
  { member_id: 99, nickname: '零分同学', total: 0, rank: 6 },
];

const stub = { toasts: [] };

globalThis.__flow = stub;
globalThis.document = {
  title: '',
  activeElement: null,
  querySelector: () => null,
  createElement: () => ({ innerHTML: '', content: { firstChild: null }, cloneNode: () => null }),
};
globalThis.uni = {
  getStorageSync: () => '',
  setStorageSync() {},
  removeStorageSync() {},
  showToast: (o) => stub.toasts.push((o && o.title) || ''),
  hideKeyboard() {},
  showModal: (o) => o && o.success && o.success({ confirm: true, cancel: false }),
  navigateTo() {},
  switchTab() {},
  navigateBack() {},
  setNavigationBarTitle() {},
};

const API_MOCK = `
export const ROLE = { SUPER: 'super_admin', ADMIN: 'admin', VIEWER: 'viewer', GUEST: 'guest' };
export function getRole() { return 'guest'; }
export function isLoggedIn() { return false; }
export function isSuperAdmin() { return false; }
export function getUser() { return null; }
export function getToken() { return ''; }
export function setToken() {}
export function clearToken() {}
export function setRole() {}
export function clearRole() {}
export function clearAuth() {}
export function setUser() {}
export function setAuth() {}
export function goLogin() {}
export function toastError(e) { throw e; }
export function downloadFile() { return Promise.resolve(); }
export function get(url) {
  if (url === '/members') return Promise.resolve(globalThis.__flow.members);
  if (url === '/ranking?type=week') {
    if (globalThis.__flow.rankFails) return Promise.reject(new Error('排行榜接口 500'));
    return Promise.resolve({ rows: globalThis.__flow.rankRows });
  }
  if (String(url).indexOf('/wheel/status') === 0) return Promise.resolve({ can_draw: true, pool: [] });
  return Promise.resolve({});
}
export function post() { return Promise.resolve({}); }
export function put() { return Promise.resolve({}); }
export function patch() { return Promise.resolve({}); }
export function del() { return Promise.resolve({}); }
`;

const durl = (code) => 'data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64');

const nodeOps = {
  createElement: (tag) => ({
    type: 'element',
    tag,
    children: [],
    props: {},
    style: {},
    parent: null,
    addEventListener() {},
    removeEventListener() {},
  }),
  createText: (text) => ({ type: 'text', text, parent: null }),
  createComment: (text) => ({ type: 'comment', text, parent: null }),
  setText(node, text) {
    node.text = text;
  },
  setElementText(el, text) {
    el.children = [{ type: 'text', text, parent: el }];
  },
  insert(child, parent, anchor) {
    child.parent = parent;
    const i = anchor ? parent.children.indexOf(anchor) : -1;
    if (i >= 0) parent.children.splice(i, 0, child);
    else parent.children.push(child);
  },
  remove(child) {
    const p = child.parent;
    if (!p) return;
    const i = p.children.indexOf(child);
    if (i >= 0) p.children.splice(i, 1);
  },
  parentNode: (node) => node.parent || null,
  nextSibling(node) {
    const p = node.parent;
    if (!p) return null;
    return p.children[p.children.indexOf(node) + 1] || null;
  },
  querySelector: () => null,
  setScopeId: () => {},
  cloneNode: (n) => n,
  insertStaticContent(content, parent, anchor) {
    const el = { type: 'text', text: content, parent: null };
    nodeOps.insert(el, parent, anchor);
    return [el, el];
  },
  patchProp(el, key, prev, next) {
    el.props[key] = next;
  },
};

function textsOf(node, out = []) {
  if (!node) return out;
  if (node.type === 'text') out.push(String(node.text));
  for (const c of node.children || []) textsOf(c, out);
  return out;
}

function elementsOf(node, out = []) {
  if (!node) return out;
  if (node.type === 'element') out.push(node);
  for (const c of node.children || []) elementsOf(c, out);
  return out;
}

const tmpDir = path.resolve('app/.dsh-wheel-fun-pick-flow');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

let inst = null;

try {
  const pageFile = path.resolve('app/src/pages/wheel/wheel.vue');
  const source = fs.readFileSync(pageFile, 'utf8');
  const { descriptor, errors } = sfc.parse(source, { filename: pageFile, pad: 'space' });
  if (errors.length) throw new Error('SFC 解析失败: ' + errors[0].message);

  const script = descriptor.script.content
    .replace(/'@\/utils\/api'/g, JSON.stringify(durl(API_MOCK)))
    .replace(
      /'@\/utils\/h5'/g,
      JSON.stringify(durl(fs.readFileSync(path.resolve('app/src/utils/h5.js'), 'utf8')))
    );

  const compPath = path.join(tmpDir, 'page.mjs');
  fs.writeFileSync(compPath, script, 'utf8');
  const pageOptions = (await import(pathToFileURL(compPath).href)).default;

  const compiled = sfc.compileTemplate({
    source: descriptor.template.content,
    filename: pageFile,
    id: 'flow',
    compilerOptions: { isCustomElement: () => true, hoistStatic: false },
  });
  if (compiled.errors.length) throw new Error('模板编译失败: ' + compiled.errors[0]);
  const renderPath = path.join(tmpDir, 'render.mjs');
  fs.writeFileSync(renderPath, compiled.code, 'utf8');
  const renderMod = await import(pathToFileURL(renderPath).href);
  const render = renderMod.render || renderMod.default;

  fs.writeFileSync(path.join(tmpDir, 'vue.mjs'), "export * from 'vue';\n", 'utf8');
  const vue = await import(pathToFileURL(path.join(tmpDir, 'vue.mjs')).href);

  const app = vue.createRenderer(nodeOps).createApp({ ...pageOptions, render });
  app.mixin({
    created() {
      if (!inst) inst = this;
    },
  });
  const container = { type: 'root', tag: 'root', children: [], props: {}, parent: null };
  app.mount(container);
  if (!inst) throw new Error('没抓到页面实例');

  const nextTick = () => vue.nextTick();
  const tree = () => textsOf(container).join(' ');
  const realRandom = Math.random;

  // 找出"抽取按钮"渲染出来的节点, 直接读它的 disabled
  const drawButtonDisabled = () => {
    const btn = elementsOf(container).find(
      (n) => n.tag === 'button' && /随机抽取|再抽一次|正在寻找/.test(textsOf(n).join(''))
    );
    return btn ? btn.props.disabled === true : null;
  };

  // 让动画真的跑完(每轮约 2 秒)
  const waitRun = async (timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    while (inst.running && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 60));
    }
    await nextTick();
  };

  // 进入"随机抽人"标签 + 载入成员
  stub.members = MEMBERS;
  stub.rankRows = RANK_ROWS;
  inst.mode = 'fun';
  await inst.loadMembers();
  await nextTick();

  section('1. 默认仍是"按分组", 老行为不变');
  {
    checkEq('默认来源 = scope', inst.pickMode, 'scope');
    checkEq('默认分组 = 在部落(-2)', inst.scope, -2);
    checkEq('默认勾选为空', inst.pickedIds.length, 0);
    checkEq(
      '在部落分组的参与名单 = 所有非离开成员',
      inst.funMembers.map((m) => m.nickname).join(','),
      '小羊,晚归,青禾,石头,阿满'
    );
    check(inst.pickedIds.length === 0, '勾选为空也不影响分组模式');

    inst.switchScope(1);
    await nextTick();
    checkEq(
      '切到红牌分组参与名单正确',
      inst.funMembers.map((m) => m.nickname).join(','),
      '晚归,阿满'
    );
    inst.switchScope(-2);
    await nextTick();
  }

  section('2. 自选成员: 按本周分数分组');
  {
    await inst.switchPickMode('custom');
    await nextTick();
    checkEq('来源切到 custom', inst.pickMode, 'custom');
    check(inst.scoresLoaded === true, '顺手把本周排行榜拉回来了');
    checkEq('分数行数 = 榜上人数', inst.scoreRows.length, RANK_ROWS.length);
    checkEq('分数行结构归一成 { id, nickname, score }', Object.keys(inst.scoreRows[0]).sort().join(','), 'id,nickname,score');

    const groups = inst.pickGroups;
    checkEq('分组数(36/30/24/0 共 4 组)', groups.length, 4);
    checkEq(
      '分数从高到低, 同分合并成一组',
      groups.map((g) => `${g.score}分:${g.ids.join('/')}`).join(' | '),
      '36分:11/14/16 | 30分:12 | 24分:15 | 0分:99'
    );
    checkEq('第一组的名次区间是 1–3', `${groups[0].from}-${groups[0].to}`, '1-3');
    checkEq('第二组名次从 4 开始', `${groups[1].from}-${groups[1].to}`, '4-4');
    checkEq('最后一组名次到 6', `${groups[3].from}-${groups[3].to}`, '6-6');
    checkEq('面板参与总人数 = 榜上人数(已离开的人不在榜上)', inst.pickTotal, 6);
    check(
      tree().includes('36 分'),
      `渲染出了分数分组标题（实际含"36 分": ${tree().includes('36 分')}）`
    );
    check(tree().includes('并列'), '同分的那一组标了「并列」');
    check(tree().includes('整组选中'), '每组有「整组选中」入口');
    check(tree().includes('已选 0 / 6 人'), '面板显示"已选 0 / 6 人"');
  }

  section('3. 整组选中(本周奖励的核心用法: 从并列的人里抽一个)');
  {
    const top = inst.pickGroups[0]; // 36 分那 3 个人
    checkEq('第一组就是 36 分并列的 3 人', top.ids.join(','), '11,14,16');
    checkEq('一开始没选中', inst.isGroupPicked(top), false);

    inst.toggleGroup(top);
    await nextTick();
    checkEq('点一下整组选中', inst.pickedCount, 3);
    checkEq('组状态变为已选中', inst.isGroupPicked(top), true);
    check(tree().includes('取消本组'), '按钮文案变成「取消本组」');
    checkEq('参与名单 = 并列的 3 人', inst.funMembers.map((m) => m.nickname).join(','), '小羊,青禾,阿满');
    checkEq('空名单提示消失, 按钮可点', drawButtonDisabled(), false);

    inst.toggleGroup(top);
    await nextTick();
    checkEq('再点一下取消整组', inst.pickedCount, 0);
    checkEq('按钮回到不可点', drawButtonDisabled(), true);

    // 并列那组 + 第二组: 跨组混合
    inst.toggleGroup(top);
    inst.toggleGroup(inst.pickGroups[1]);
    await nextTick();
    checkEq('两组一起选中', inst.pickedCount, 4);
    checkEq(
      '参与名单按榜单顺序(不是点击顺序)',
      inst.funMembers.map((m) => m.nickname).join(','),
      '小羊,青禾,阿满,晚归'
    );
  }

  section('4. 单个勾选 / 全选 / 清空');
  {
    inst.clearPicks();
    await nextTick();

    inst.togglePick(14); // 青禾
    await nextTick();
    checkEq('勾一个 -> 参与名单 1 人', inst.funMembers.map((m) => m.nickname).join(','), '青禾');
    checkEq('勾一个后按钮可点', drawButtonDisabled(), false);
    check(tree().includes('已选 1 / 6 人'), '面板计数跟着变');

    inst.togglePick(16);
    inst.togglePick(11);
    await nextTick();
    checkEq(
      '参与名单按榜单顺序, 不受勾选先后影响',
      inst.funMembers.map((m) => m.nickname).join(','),
      '小羊,青禾,阿满'
    );
    checkEq('勾选人数', inst.pickedCount, 3);
    checkEq('这时第一组显示为已全选', inst.isGroupPicked(inst.pickGroups[0]), true);

    inst.togglePick(14); // 取消青禾 -> 组不再算全选
    await nextTick();
    checkEq('再点一下取消勾选', inst.funMembers.map((m) => m.nickname).join(','), '小羊,阿满');
    checkEq('组状态回到未全选', inst.isGroupPicked(inst.pickGroups[0]), false);

    inst.pickAll();
    await nextTick();
    checkEq('全选 = 榜上所有人', inst.pickedCount, RANK_ROWS.length);
    check(tree().includes('已选 6 / 6 人'), '全选后计数正确');

    inst.clearPicks();
    await nextTick();
    checkEq('清空后为 0', inst.pickedCount, 0);
    checkEq('清空后按钮重新不可点', drawButtonDisabled(), true);
  }

  section('5. 抽取只从勾选的人里出');
  {
    // 只勾"36 分并列那组"里的两个人: 若抽取逻辑没看名单, 极可能抽到排在最前的小羊
    inst.togglePick(14); // 青禾
    inst.togglePick(16); // 阿满
    await nextTick();
    checkEq('参与名单 = 青禾,阿满', inst.funMembers.map((m) => m.nickname).join(','), '青禾,阿满');

    // Math.random 固定为 0 -> 必然取候选列表第 0 个(与小羊的下标无关)
    Math.random = () => 0;
    await inst.runFun();
    await waitRun();
    checkEq('抽中勾选名单里的第一位', inst.funResult, '青禾');
    checkEq('抽中的人 id 也对应', inst.funResultId, 14);
    check(inst.running === false, '抽取结束后动画状态复位');

    // 固定为最大值 -> 取候选列表最后一个
    Math.random = () => 0.999999;
    await inst.runFun();
    await waitRun();
    checkEq('固定随机数取到名单最后一位', inst.funResult, '阿满');
    checkEq('抽中的人 id 也对应', inst.funResultId, 16);

    Math.random = realRandom;
    check(
      inst.funResultId === 14 || inst.funResultId === 16,
      '结果始终落在勾选名单内'
    );
  }

  section('6. 抽取过程中不允许改名单');
  {
    inst.togglePick(11); // 小羊, 现在 3 人
    await nextTick();
    const before = inst.pickedIds.slice().sort().join(',');

    Math.random = () => 0;
    const running = inst.runFun();
    await nextTick();
    check(inst.running === true, '点击后进入抽取中');

    inst.togglePick(12); // 抽取中点击应被忽略
    inst.toggleGroup(inst.pickGroups[1]);
    inst.clearPicks();
    inst.switchPickMode('scope');
    inst.switchScope(0);
    checkEq(
      '抽取中勾选/整组/清空/切模式/切分组都被拦住',
      inst.pickedIds.slice().sort().join(','),
      before
    );
    checkEq('抽取中模式也没被切走', inst.pickMode, 'custom');

    await running;
    await waitRun();
    Math.random = realRandom;
    checkEq('抽取结束后恢复正常', inst.running, false);
  }

  section('7. 换名单会清掉上一次结果');
  {
    inst.funResult = '小羊';
    inst.funResultId = 11;
    inst.funDisplay = '小羊';
    inst.togglePick(11); // 改动名单
    await nextTick();
    checkEq('改动勾选后结果被清空', inst.funResult, '');
    checkEq('结果 id 也清空', inst.funResultId, null);

    inst.funResult = '阿满';
    await inst.switchPickMode('scope');
    await nextTick();
    checkEq('切回分组模式后结果被清空', inst.funResult, '');
    checkEq('分组模式下参与名单回到分组口径', inst.funMembers.length, 5);
    checkEq('分组模式忽略勾选', inst.pickedIds.length > 0, true);
  }

  section('8. 拿不到分数时的退化路径');
  {
    // 换一份"排行榜接口报错"的实例状态: 直接重置再拉一次
    inst.pickMode = 'scope';
    inst.pickedIds = [];
    inst.scoresLoaded = false;
    stub.rankFails = true;
    await inst.switchPickMode('custom');
    await nextTick();

    check(!!inst.scoreError, `分数加载失败时有错误提示（实际 ${JSON.stringify(inst.scoreError)}）`);
    checkEq('退化成不分组的一份名单', inst.pickGroups.length, 1);
    checkEq('退化名单用 members(含已离开)', inst.pickTotal, MEMBERS.length);
    checkEq('退化时 score 为 null', inst.pickGroups[0].score, null);
    check(
      tree().includes('未分组') && tree().includes('分数加载失败'),
      '页面如实说明"未分组/加载失败", 而不是假装有分数'
    );
    check(
      tree().includes('刷新'),
      '提供了「刷新」入口(失败后可以重试)'
    );

    inst.togglePick(13);
    await nextTick();
    checkEq('退化状态下照样能选人并抽取', inst.funMembers.map((m) => m.nickname).join(','), '阿离');

    // 刷新成功后恢复按分数分组
    stub.rankFails = false;
    await inst.loadScores();
    await nextTick();
    checkEq('刷新后错误清空', inst.scoreError, '');
    checkEq('刷新后回到 4 组', inst.pickGroups.length, 4);
    checkEq(
      '刷新后原勾选(id13 已不在榜上)不再计入',
      inst.pickedCount,
      0
    );
  }

  section('9. 模板接线与静态规则');
  {
    const src = fs.readFileSync(pageFile, 'utf8');
    check(/@click="switchPickMode\('custom'\)"/.test(src), '有「自选成员」入口并绑定 switchPickMode');
    check(src.includes('已选 {{ pickedCount }} / {{ pickTotal }} 人'), '面板显示已选人数');
    check(/@click="togglePick\(m\.id\)"/.test(src), '成员卡片绑定了 togglePick(id)');
    check(/@click="toggleGroup\(g\)"/.test(src), '分数那一行绑定了整组选中');
    check(/@click="pickAll"/.test(src) && /@click="clearPicks"/.test(src), '有全选/清空按钮');
    check(/@click="loadScores"/.test(src), '有刷新分数的入口');
    check(src.includes('/ranking?type=week'), '分数来自本周排行榜接口');
    check(!/<block>/.test(src.replace(/<!--[\s\S]*?-->/g, '')), '没有裸 <block>(H5 会渲染成 <template> 吞内容)');
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\n结果: ${pass} PASS / ${fails.length} FAIL`);
if (fails.length) {
  console.log('失败明细:');
  fails.forEach((f) => console.log('   - ' + f));
  process.exit(1);
}
