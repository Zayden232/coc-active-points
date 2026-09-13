// ============================================================
// 成员管理页 · 「归档」筛选 页面级流程验证
//
// 用法: node tools/members-archive-flow.mjs
//
// 针对的问题: 归档(软删除)的成员在软件里找不到 —— 页面只请求 /api/members
// (后端默认不返回归档成员), 前端还额外 filter 掉 deleted_at, 于是"离开"筛选永远是空的。
//
// 验证的是"页面胶水": 请求有没有带 include_archived、归档成员是否留在了列表里、
// 各筛选的分流对不对、卡片有没有渲染出"已归档"、以及恢复/归档按钮的行为与提示文案。
// 后端写库由 server 的真实 MySQL E2E 覆盖。
//
// 做法与 import-page-flow.mjs 相同: 编译 SFC → createRenderer 极简节点操作真渲染
// → 抓住页面实例 → 用记录型请求桩断言它发了什么。
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
const section = (name) => console.log('\n== ' + name + ' ==');

// ---- 桩: 后端 /api/members 的返回(含归档成员) ----
const MEMBERS = [
  // 在册: 绿牌
  { id: 1, nickname: '小羊', tag: '', status: 0, town_hall: 18, prosperity: 148, red_since: null, red_days: null, note: '', deleted_at: null },
  // 在册: 红牌超期
  { id: 2, nickname: '晚归', tag: '', status: 1, town_hall: 17, prosperity: 142, red_since: '2026-08-01', red_days: 43, note: '', deleted_at: null },
  // 在册: 红牌未超期
  { id: 3, nickname: '经过', tag: '', status: 1, town_hall: 16, prosperity: 115, red_since: '2026-09-10', red_days: 3, note: '', deleted_at: null },
  // 离开但没归档(旧数据/批量设为离开)
  { id: 4, nickname: '离开了没归档', tag: '', status: 2, town_hall: 15, prosperity: 90, red_since: null, red_days: null, note: '', deleted_at: null },
  // 已归档 x2
  { id: 5, nickname: '已归档甲', tag: '', status: 2, town_hall: 14, prosperity: 73, red_since: null, red_days: null, note: '', deleted_at: '2026-09-01 10:20:30' },
  { id: 6, nickname: '已归档乙', tag: '', status: 2, town_hall: 12, prosperity: null, red_since: null, red_days: null, note: '老成员', deleted_at: '2026-08-15 09:00:00' },
];

const stub = {
  calls: [],
  toasts: [],
  modals: [],
  actionResult: { affected: 2, duplicated: false, batch_id: 'stub' },
  // 该成员的积分流水条数(用于永久删除确认框里的"代价")
  recordTotal: 17,
  superAdmin: true,
  // showModal 的应答序列: 依次出队, 用完则默认 confirm=true
  modalAnswers: [],
  request(method, url, data) {
    this.calls.push({ method, url, body: data ? JSON.parse(JSON.stringify(data)) : data });
    // 注意顺序: /members/batch-action 也以 /members 开头, 必须先判
    if (url === '/members/batch-action') return Promise.resolve(this.actionResult);
    if (String(url).startsWith('/records')) {
      return Promise.resolve({ rows: [], total: this.recordTotal });
    }
    if (String(url).startsWith('/members')) return Promise.resolve(MEMBERS);
    return Promise.resolve({});
  },
};

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
  showModal: (o) => {
    stub.modals.push({ title: o && o.title, content: o && o.content });
    const answer = stub.modalAnswers.length ? stub.modalAnswers.shift() : true;
    if (o && o.success) o.success({ confirm: answer, cancel: !answer });
  },
  navigateTo() {},
  switchTab() {},
  navigateBack() {},
  setNavigationBarTitle() {},
};

const API_MOCK = `
export const ROLE = { SUPER: 'super_admin', ADMIN: 'admin', VIEWER: 'viewer', GUEST: 'guest' };
export function canWrite() { return true; }
export function getRole() { return 'super_admin'; }
export function isLoggedIn() { return true; }
export function isSuperAdmin() { return globalThis.__flow.superAdmin !== false; }
export function getUser() { return { role: 'super_admin', username: 'stub' }; }
export function getToken() { return 'stub'; }
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
export function get(url, data) { return globalThis.__flow.request('GET', url, data); }
export function post(url, data) { return globalThis.__flow.request('POST', url, data); }
export function put(url, data) { return globalThis.__flow.request('PUT', url, data); }
export function patch(url, data) { return globalThis.__flow.request('PATCH', url, data); }
export function del(url, data) { return globalThis.__flow.request('DELETE', url, data); }
`;

// MemberWarStatus 组件用桩替代(它的渲染不在本页职责内)
const COMPONENT_MOCK = `
export default { name: 'MemberWarStatus', props: ['status', 'redDays', 'compact', 'iconOnly'], render() { return null; } };
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
const namesOf = (list) => list.map((m) => m.nickname).join(',');

const tmpDir = path.resolve('app/.dsh-members-archive-flow');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

let inst = null;

try {
  const pageFile = path.resolve('app/src/pages/members/members.vue');
  const source = fs.readFileSync(pageFile, 'utf8');
  const { descriptor, errors } = sfc.parse(source, { filename: pageFile, pad: 'space' });
  if (errors.length) throw new Error('SFC 解析失败: ' + errors[0].message);

  const readUtil = (p) => fs.readFileSync(path.resolve('app/src/utils', p), 'utf8');
  const apiMockUrl = JSON.stringify(durl(API_MOCK));

  const script = descriptor.script.content
    .replace(/'@\/utils\/api'/g, apiMockUrl)
    .replace(/'@\/utils\/navigation'/g, JSON.stringify(durl(readUtil('navigation.js'))))
    .replace(/'@\/utils\/h5'/g, JSON.stringify(durl(readUtil('h5.js'))))
    .replace(/'@\/components\/MemberWarStatus\.vue'/g, JSON.stringify(durl(COMPONENT_MOCK)));

  if (script.includes("@/components/MemberWarStatus.vue")) {
    throw new Error('MemberWarStatus 组件桩没替换成功');
  }

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

  const tree = () => textsOf(container).join(' ');
  const nextTick = () => vue.nextTick();

  section('修复点 1: 请求必须带 include_archived=1');
  {
    stub.calls.length = 0;
    // onShow 是 uni 的页面生命周期(不属于 Vue options, 拿不到实例上的方法),
    // 这里直接做它做的事: 置 active / canWrite 后 load
    inst.active = true;
    inst.canWrite = true;
    await inst.load();
    await nextTick();
    const call = stub.calls.find((c) => c.method === 'GET');
    check(!!call, '页面加载时请求了成员列表');
    check(
      call && call.url === '/members?include_archived=1',
      `请求带上了 include_archived=1 (实际 ${call && call.url})`
    );
  }

  section('修复点 2: 归档成员留在列表里, 不再被丢弃');
  {
    check(inst.members.length === 6, `6 名成员全部进列表(含 2 名已归档), 实际 ${inst.members.length}`);
    check(inst.archivedCount === 2, `archivedCount = 2 (实际 ${inst.archivedCount})`);
    check(
      inst.members.filter((m) => m.archived).map((m) => m.nickname).join(',') === '已归档甲,已归档乙',
      '归档标记按 deleted_at 判定正确'
    );
    check(inst.activeCount === 3, `在部落 = 3 (绿1+红2, 排除离开与归档), 实际 ${inst.activeCount}`);
    check(inst.greenCount === 1 && inst.redCount === 2, '绿牌 1 / 红牌 2 不受归档成员影响');
    check(inst.overdueCount === 1, `超过15天 = 1 (归档成员不参与), 实际 ${inst.overdueCount}`);
  }

  section('筛选分流: 归档 / 在部落 (「全部」已删除)');
  {
    check(
      inst.filters.some((f) => f.value === 'archived' && f.label === '归档'),
      '筛选里有「归档」'
    );
    check(!inst.filters.some((f) => f.value === 'left'), '原来的「离开」筛选已移除');
    check(!inst.filters.some((f) => f.value === 'all'), '「全部」筛选已删除');
    check(
      inst.filters.map((f) => f.label).join('/') === '在部落/绿牌/红牌/超过15天/归档',
      `筛选顺序与文案正确 (实际 ${inst.filters.map((f) => f.label).join('/')})`
    );

    inst.filter = 'archived';
    await nextTick();
    check(
      namesOf(inst.filteredMembers) === '离开了没归档,已归档甲,已归档乙',
      `「归档」= 所有不在部落的人(含"设为离开但没归档"的) (实际 ${namesOf(inst.filteredMembers)})`
    );

    inst.filter = 'active';
    await nextTick();
    check(
      namesOf(inst.filteredMembers) === '小羊,晚归,经过',
      `「在部落」排除离开与归档 (实际 ${namesOf(inst.filteredMembers)})`
    );

    inst.filter = 'green';
    await nextTick();
    check(namesOf(inst.filteredMembers) === '小羊', '「绿牌」不受影响');

    inst.filter = 'red';
    await nextTick();
    check(namesOf(inst.filteredMembers) === '晚归,经过', '「红牌」不受影响');

    inst.filter = 'overdue';
    await nextTick();
    check(namesOf(inst.filteredMembers) === '晚归', '「超过15天」不受影响');

    // 五个筛选加起来必须覆盖全部成员, 不能有人"哪都看不到"
    {
      const seen = new Set();
      for (const f of inst.filters) {
        inst.filter = f.value;
        await nextTick();
        for (const m of inst.filteredMembers) seen.add(m.id);
      }
      const missing = inst.members.filter((m) => !seen.has(m.id)).map((m) => m.nickname);
      check(missing.length === 0, `删掉「全部」后仍覆盖所有成员 (漏掉: ${missing.join(',') || '无'})`);
    }

    // 搜索: 归档成员也能被搜到
    inst.filter = 'archived';
    inst.keyword = '已归档乙';
    await nextTick();
    check(namesOf(inst.filteredMembers) === '已归档乙', '归档成员可被关键词搜到');
    inst.keyword = '';
    inst.filter = 'active';
    await nextTick();
  }

  section('工具栏: 管理员能看到 新增/批量导入/批量管理, 访客看不到');
  {
    inst.canWrite = true;
    await nextTick();
    const t = tree();
    check(t.includes('＋ 新增'), '管理员可见「新增」');
    check(t.includes('批量导入'), '管理员可见「批量导入」');
    check(t.includes('批量管理'), '管理员可见「批量管理」');
    check(!t.includes('只读模式'), '管理员不显示只读提示');

    inst.canWrite = false;
    await nextTick();
    const t2 = tree();
    check(!t2.includes('＋ 新增'), '访客看不到「新增」(按钮是管理员专属, 属预期)');
    check(!t2.includes('批量导入'), '访客看不到「批量导入」');
    check(!t2.includes('批量管理'), '访客看不到「批量管理」');
    check(t2.includes('只读模式'), '访客看到「只读模式」说明');
    check(t2.includes('管理员登录'), '访客看到「管理员登录」入口');

    inst.canWrite = true;
    await nextTick();
  }

  section('渲染: 归档标签 / 归档日期 / 顶部提示条');
  {
    inst.filter = 'archived';
    await nextTick();
    const t = tree();
    check(t.includes('已归档'), '卡片渲染出「已归档」标签');
    check(t.includes('归档于 2026-09-01'), `渲染出归档日期 (已归档甲 2026-09-01)`);
    check(t.includes('历史积分与奖励记录仍保留'), '渲染出"历史记录仍保留"说明');
    check(t.includes('大本营 14 · 繁荣 73'), '归档成员仍显示大本营/繁荣度');
    // 「归档」视图也收留"设为离开但没归档"的人(否则删掉「全部」后哪都看不到),
    // 但它没有真归档, 所以不该带「已归档」标签
    check(t.includes('离开了没归档'), '归档视图也显示"设为离开但没归档"的人');
    const orphan = inst.members.find((m) => m.nickname === '离开了没归档');
    check(orphan && orphan.archived === false, '这类人不会被误标成"已归档"(显示的是「离开」)');
    check(inst.archivedCount === 2, `「已归档」计数只算真归档 (实际 ${inst.archivedCount})`);
    check(inst.archivedViewCount === 3, `归档视图共 3 人 (实际 ${inst.archivedViewCount})`);

    inst.filter = 'active';
    await nextTick();
    const t2 = tree();
    check(t2.includes('已归档'), '顶部「有 N 名成员已归档」提示条在在部落视图下可见');
    check(inst.archivedCount === 2, '提示条数字取 archivedCount');
  }

  section('归档成员不可重复归档 + 提示');
  {
    inst.batchMode = true;
    inst.filter = 'archived';
    inst.selectedIds = ['5'];
    await nextTick();
    check(inst.selectedAllArchived === true, '选中已归档成员 -> selectedAllArchived = true');

    stub.calls.length = 0;
    stub.toasts.length = 0;
    await inst.archiveSelected();
    check(
      !stub.calls.some((c) => c.method === 'POST'),
      '不再发起多余的归档请求'
    );
    check(
      stub.toasts.some((x) => x.includes('都已归档')),
      `给出"都已归档"提示 (实际 ${JSON.stringify(stub.toasts)})`
    );

    // 混合选择时仍可归档(在册的人需要被归档)
    inst.selectedIds = ['1', '5'];
    await nextTick();
    check(inst.selectedAllArchived === false, '在册 + 归档混合选择 -> 仍可执行归档');
  }

  section('恢复: 对归档成员「设为绿牌/红牌」即取消归档');
  {
    inst.selectedIds = ['5', '6'];
    inst.filter = 'archived';
    await nextTick();
    check(inst.selectedArchivedCount === 2, '选中 2 名已归档成员');

    stub.modals.length = 0;
    stub.calls.length = 0;
    await inst.setBatchStatus(0);
    await nextTick();

    const modal = stub.modals[0];
    check(!!modal, '恢复了确认弹窗');
    check(
      modal && modal.content.includes('2 名已归档成员会被同时恢复'),
      `确认文案提示"会被恢复" (实际: ${modal && modal.content})`
    );

    const post = stub.calls.find((c) => c.method === 'POST');
    check(!!post && post.url === '/members/batch-action', '请求发到 /members/batch-action');
    check(
      post && post.body.operation === 'update' && post.body.changes && post.body.changes.status === 0,
      `提交体是 operation=update / changes.status=0 (实际 ${post && JSON.stringify(post.body)})`
    );
    check(post && post.body.member_ids.join(',') === '5,6', '只提交选中的两名归档成员');
    check(post && typeof post.body.client_token === 'string' && post.body.client_token.length > 0, '带幂等批次号');
    check(inst.pending === null, '批次成功后 pending 被清空(不会卡住后续操作)');
    check(inst.selectedIds.length === 0, '批次成功后清空多选');

    // 设为"离开"时不提示恢复
    stub.modals.length = 0;
    inst.selectedIds = ['5'];
    await nextTick();
    await inst.setBatchStatus(2);
    await nextTick();
    check(
      stub.modals[0] && !stub.modals[0].content.includes('会被同时恢复'),
      '设为"离开"时不出现恢复提示'
    );
  }

  section('单个恢复: 归档卡片上直接点「恢复」');
  {
    inst.canWrite = true;
    inst.batchMode = false;
    inst.filter = 'archived';
    inst.selectedIds = [];
    await nextTick();
    check(tree().includes('恢复'), '归档卡片上有「恢复」按钮');

    stub.modals.length = 0;
    stub.calls.length = 0;
    const target = inst.filteredMembers.find((m) => m.archived);
    await inst.restoreOne(target);
    await nextTick();

    const post = stub.calls.find((c) => c.method === 'POST');
    check(!!post, '点「恢复」发起了请求');
    check(
      post && post.body.member_ids.join(',') === '5',
      `只提交这一名成员 (实际 ${post && post.body.member_ids.join(',')})`
    );
    check(
      post && post.body.operation === 'update' && post.body.changes.status === 0,
      '提交体为 operation=update / status=0(取消归档)'
    );
    check(
      stub.modals[0] && stub.modals[0].title === '恢复成员' && stub.modals[0].content.includes('已归档甲'),
      `确认弹窗带上成员昵称 (实际 ${stub.modals[0] && stub.modals[0].content})`
    );

    // 在册成员的卡片不应该出现"恢复"
    inst.filter = 'active';
    await nextTick();
    check(!tree().includes('恢复'), '在册成员卡片上没有「恢复」按钮');

    // 访客看不到
    inst.canWrite = false;
    inst.filter = 'archived';
    await nextTick();
    check(!tree().includes('恢复'), '访客看不到「恢复」按钮');
    inst.canWrite = true;
    inst.filter = 'active';
    await nextTick();
  }

  section('永久删除: 超管专属 + 双重确认 + 只发 purge=1');
  {
    inst.canWrite = true;
    inst.batchMode = false;
    inst.filter = 'archived';
    inst.selectedIds = [];
    await nextTick();
    const target = inst.members.find((m) => m.archived);

    // 1) 管理员(非超管)看不到删除按钮
    // 注意: 页面里本来就有"移除成员不应删除历史积分…"这段文案, 所以只能匹配按钮本身的文案
    inst.superAdmin = false;
    stub.superAdmin = false;
    await nextTick();
    check(!tree().includes('永久删除'), '非超管看不到「永久删除」按钮');

    // 2) 超管可见
    inst.superAdmin = true;
    stub.superAdmin = true;
    await nextTick();
    check(tree().includes('永久删除'), '超管可见「永久删除」按钮');

    // 3) 确认框里要写出真实代价(流水条数)
    stub.modals.length = 0;
    stub.calls.length = 0;
    stub.modalAnswers = [true, true];
    stub.recordTotal = 17;
    await inst.purgeOne(target);
    await nextTick();

    check(
      stub.calls.some((c) => String(c.url).startsWith('/records?member_id=')),
      `删除前先查了流水条数 (calls: ${stub.calls.map((c) => c.url).join(' | ')})`
    );
    check(stub.modals.length === 2, `弹了两次确认 (实际 ${stub.modals.length} 次)`);
    check(
      stub.modals[0] && stub.modals[0].content.includes('17 条积分流水'),
      `第一次确认写明会删掉多少条流水 (实际 ${stub.modals[0] && stub.modals[0].content})`
    );
    check(
      stub.modals[0] && stub.modals[0].content.includes('结算快照') && stub.modals[0].content.includes('成员外观'),
      '第一次确认列全了会连带删除的数据'
    );
    check(
      stub.modals[1] && stub.modals[1].content.includes('不可撤销'),
      '第二次确认强调不可撤销'
    );

    const purgeCall = stub.calls.find(
      (c) => c.method === 'DELETE' && String(c.url).includes('purge=1')
    );
    check(!!purgeCall, '发出了物理删除请求');
    check(
      purgeCall && purgeCall.url === '/members/5?purge=1',
      `请求路径是 /members/<id>?purge=1 (实际 ${purgeCall && purgeCall.url})`
    );

    // 4) 第一次确认就取消 -> 绝不能发出删除请求
    stub.modals.length = 0;
    stub.calls.length = 0;
    stub.modalAnswers = [false];
    await inst.purgeOne(target);
    await nextTick();
    check(
      !stub.calls.some((c) => c.method === 'DELETE'),
      '第一次确认取消后不发删除请求'
    );

    // 5) 第二次确认取消 -> 同样不能删
    stub.modals.length = 0;
    stub.calls.length = 0;
    stub.modalAnswers = [true, false];
    await inst.purgeOne(target);
    await nextTick();
    check(
      !stub.calls.some((c) => c.method === 'DELETE'),
      '第二次确认取消后不发删除请求'
    );
    check(stub.modals.length === 2, '两次确认都弹了');

    // 6) 非超管即使绕过界面调用, 也不发请求
    inst.superAdmin = false;
    stub.superAdmin = false;
    stub.calls.length = 0;
    stub.toasts.length = 0;
    stub.modalAnswers = [true, true];
    await inst.purgeOne(target);
    await nextTick();
    check(!stub.calls.some((c) => c.method === 'DELETE'), '非超管调用不发删除请求(前端也拦)');
    check(
      stub.toasts.some((x) => x.includes('仅超级管理员')),
      `给出权限提示 (实际 ${JSON.stringify(stub.toasts)})`
    );

    // 7) 在册成员不能被物理删除
    stub.calls.length = 0;
    inst.superAdmin = true;
    stub.superAdmin = true;
    const active = inst.members.find((m) => !m.archived && m.status !== 2);
    await inst.purgeOne(active);
    await nextTick();
    check(
      !stub.calls.some((c) => c.method === 'DELETE'),
      '未归档的成员不会被物理删除(必须先归档)'
    );

    stub.modalAnswers = [];
    inst.filter = 'active';
    await nextTick();
  }

  section('恢复按钮(批量): 只对选中的归档成员生效');
  {
    inst.canWrite = true;
    inst.batchMode = true;
    inst.filter = 'archived';
    inst.selectedIds = [];
    await nextTick();
    check(!tree().includes('恢复为绿牌（'), '没选中归档成员时不显示恢复按钮');
    check(tree().includes('勾选后点「恢复为绿牌」'), '归档视图给出恢复操作指引');

    // 混合选择: 只恢复归档的那一个, 不动在册的红牌成员
    inst.filter = 'active';
    await nextTick();
    inst.selectedIds = ['2', '5'];
    await nextTick();
    check(inst.selectedArchivedCount === 1, '混合选择里有 1 名已归档');
    check(tree().includes('恢复为绿牌（1 人）'), '按钮只统计已归档人数');

    stub.modals.length = 0;
    stub.calls.length = 0;
    await inst.restoreSelected();
    await nextTick();

    const post = stub.calls.find((c) => c.method === 'POST');
    check(!!post, '发起了恢复请求');
    check(
      post && post.body.member_ids.join(',') === '5',
      `只提交已归档的 1 人, 不含同批在册的红牌成员 (实际 ${post && post.body.member_ids.join(',')})`
    );
    check(
      post && post.body.changes && post.body.changes.status === 0,
      '恢复 = 设为绿牌(服务端会同时清空 deleted_at)'
    );
    check(
      stub.modals[0] && stub.modals[0].title === '恢复已归档成员',
      `确认弹窗标题正确 (实际 ${stub.modals[0] && stub.modals[0].title})`
    );

    // 选中里没有归档成员时给出提示, 不发请求
    inst.selectedIds = ['2'];
    await nextTick();
    stub.calls.length = 0;
    stub.toasts.length = 0;
    inst.restoreSelected();
    await nextTick();
    check(!stub.calls.some((c) => c.method === 'POST'), '没有归档成员时不发请求');
    check(
      stub.toasts.some((x) => x.includes('没有已归档')),
      `给出可读提示 (实际 ${JSON.stringify(stub.toasts)})`
    );
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\n结果: ${pass} PASS / ${fails.length} FAIL`);
if (fails.length) {
  console.log('失败项:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
