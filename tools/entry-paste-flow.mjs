// ============================================================
// 录入页「粘贴星数名单」页面级流程验证
//
// 用法:  node tools/entry-paste-flow.mjs
//        (调试: $env:FLOW_DEBUG=1)
//
// 为什么需要它:
//   tools/star-paste-check.mjs 只验证解析器(纯函数);
//   server 的 E2E 只验证后端 entries 契约。
//   中间的"页面胶水"——解析结果怎么变成 computed、提交体长什么样、
//   哪种情况被拦、保存成功后状态怎么复位——只有真正跑页面才会暴露。
//
// 做法: 用 @vue/compiler-sfc 编译页面, 用 createRenderer 自带的极简
//   节点操作真渲染(完整响应式, computed 会随数据变化重算), 再抓住页面实例,
//   把 uni.request / uni.showToast 换成记录型桩, 断言它到底发了什么请求。
//   临时文件写在 app/ 下, 这样裸模块名 'vue' 能正常解析; 结束后删除。
//   注意: 不能用 @vue/server-renderer —— SSR 渲染后 computed 不再失效重算。
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
const debug = (label, value) => {
  if (process.env.FLOW_DEBUG) console.log('    [debug]', label, JSON.stringify(value));
};

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

const RULE = { id: 3, name: '联赛胜利星', unit: '每颗星', score_per_unit: 3, weekly_cap: 63 };

// ---- 桩: uni / 后端请求 ----
const stub = {
  calls: [],
  storage: new Map(),
  toasts: [],
  modals: [],
  created: 0,
  // 模拟服务端: 每人 delta = min(数量 × 单价, 周上限) - 本周已有
  preview(body) {
    const list = body.entries || [body];
    const members = [];
    let total = 0;
    for (const e of list) {
      const cap = RULE.weekly_cap == null ? Infinity : RULE.weekly_cap;
      for (const id of e.member_ids) {
        const raw = Number(e.quantity) * RULE.score_per_unit;
        const delta = Math.min(0 + raw, cap);
        total += delta;
        members.push({
          member_id: id,
          rule_id: e.rule_id,
          rule_name: RULE.name,
          before: 0,
          delta,
          capped: raw > cap,
        });
      }
    }
    return { week_start: '2026-09-07', total_delta: total, members, errors: [] };
  },
  request(method, url, data) {
    this.calls.push({ method, url, body: data ? JSON.parse(JSON.stringify(data)) : data });
    if (url === '/records/preview') return Promise.resolve(this.preview(data));
    if (url === '/records') {
      const pv = this.preview(data);
      return Promise.resolve({
        inserted: (data.entries || [data]).reduce((n, e) => n + e.member_ids.length, 0),
        duplicated: 0,
        total_delta: pv.total_delta,
        week_start: '2026-09-07',
        errors: [],
      });
    }
    if (url === '/members') {
      this.created += 1;
      return Promise.resolve({ id: 900 + this.created, nickname: String(data.nickname), tag: '', status: 0 });
    }
    return Promise.resolve({});
  },
};

globalThis.__flow = stub;
// 内置指令(v-model)会读 document.activeElement; runtime-dom 在 import 时还会 createElement('template')
globalThis.document = {
  title: '',
  activeElement: null,
  querySelector: () => null,
  createElement: () => ({ innerHTML: '', content: { firstChild: null }, cloneNode: () => null }),
};
globalThis.uni = {
  getStorageSync: (k) => (stub.storage.has(k) ? stub.storage.get(k) : ''),
  setStorageSync: (k, v) => stub.storage.set(k, v),
  removeStorageSync: (k) => stub.storage.delete(k),
  showToast: (o) => stub.toasts.push((o && o.title) || ''),
  hideKeyboard() {},
  showModal: (o) => {
    stub.modals.push((o && o.content) || '');
    if (o && o.success) o.success({ confirm: true, content: o.placeholderText || '' });
  },
  navigateTo() {},
  switchTab() {},
  pageScrollTo() {},
  createSelectorQuery: () => {
    const q = {
      in: () => q,
      select: () => q,
      selectViewport: () => q,
      boundingClientRect: () => q,
      scrollOffset: () => q,
      exec: (cb) => cb([null, null]),
    };
    return q;
  },
};

const API_MOCK = `
export const ROLE = { SUPER: 'super_admin', ADMIN: 'admin', VIEWER: 'viewer', GUEST: 'guest' };
export function canWrite() { return true; }
export function getToken() { return 'stub-token'; }
export function getUser() { return { role: 'super_admin' }; }
export function isSuperAdmin() { return true; }
export function get(url, data) { return globalThis.__flow.request('GET', url, data); }
export function post(url, data) { return globalThis.__flow.request('POST', url, data); }
export function put(url, data) { return globalThis.__flow.request('PUT', url, data); }
export function patch(url, data) { return globalThis.__flow.request('PATCH', url, data); }
export function del(url, data) { return globalThis.__flow.request('DELETE', url, data); }
export function toastError(e) { throw e; }
export function setAuth() {}
export function downloadFile() { return Promise.resolve(); }
`;

const durl = (code) =>
  'data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64');

// createRenderer 需要的最小节点操作: 用普通对象当 DOM
const nodeOps = {
  // v-model 等内置指令会给元素挂事件, 空实现即可
  createElement: (tag) => ({
    type: 'element',
    tag,
    children: [],
    props: {},
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
  // 静态内容节点: 必须返回 [el, anchor]
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

const tmpDir = path.resolve('app/.dsh-entry-flow');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

let inst = null;
let container = null;

try {
  const pageFile = path.resolve('app/src/pages/entry/entry.vue');
  const source = fs.readFileSync(pageFile, 'utf8');
  const { descriptor, errors } = sfc.parse(source, { filename: pageFile, pad: 'space' });
  if (errors.length) throw new Error('SFC 解析失败: ' + errors[0].message);

  const readUtil = (p) => fs.readFileSync(path.resolve('app/src/utils', p), 'utf8');

  const script = descriptor.script.content
    .replace(/'@\/utils\/api'/g, JSON.stringify(durl(API_MOCK)))
    .replace(/'@\/utils\/star-paste'/g, JSON.stringify(durl(readUtil('star-paste.js'))))
    .replace(/'@\/utils\/navigation'/g, JSON.stringify(durl(readUtil('navigation.js'))))
    .replace(/'@\/utils\/h5'/g, JSON.stringify(durl(readUtil('h5.js'))));

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
  if (typeof render !== 'function') throw new Error('拿不到渲染函数');

  // 裸模块名必须从 app/ 内部解析, 保证和渲染函数用同一份 vue
  fs.writeFileSync(path.join(tmpDir, 'vue.mjs'), "export * from 'vue';\n", 'utf8');
  const vue = await import(pathToFileURL(path.join(tmpDir, 'vue.mjs')).href);

  const roster = JSON.parse(fs.readFileSync(path.resolve('tools/star-paste-roster.json'), 'utf8'));

  const app = vue.createRenderer(nodeOps).createApp({ ...pageOptions, render });
  app.mixin({
    created() {
      if (!inst) inst = this;
    },
  });
  container = { type: 'root', tag: 'root', children: [], props: {}, parent: null };
  app.mount(container);
  if (!inst) throw new Error('没抓到页面实例');

  const tree = () => textsOf(container).join(' ');
  const nextTick = () => vue.nextTick();

  // 页面进入"管理员 + 已加载"状态
  inst.canWrite = true;
  inst.pageActive = true;
  inst.optionsReady = true;
  inst.rules = [{ ...RULE }];
  inst.ruleId = RULE.id;
  inst.weekStart = '2026-09-07';
  inst.members = roster.map((m) => ({
    id: Number(m.id),
    nickname: m.nickname,
    tag: m.tag || '',
    status: Number(m.status),
  }));

  section('页面级: 解析 → 分组 → 提交体');
  {
    inst.pasteText = PASTED;
    inst.runPasteParse();
    check(inst.pasteParsed === true, '解析成功');
    check(inst.pasteGroups.length === 11, `解析出 11 组 (实际 ${inst.pasteGroups.length})`);
    check(inst.pasteStats.people === 28, `统计 28 人 (实际 ${inst.pasteStats.people})`);
    check(inst.pasteStats.unresolved === 0, '没有待处理的名字');
    check(inst.pasteStats.zeroPeople === 2, '0 星 2 人不参与录入');

    inst.applyPaste();
    await nextTick();
    check(inst.pasteMode === true, '应用分组后进入分组数量模式');
    check(inst.quantity === '', '分组模式清空了单人数量输入');
    check(inst.formValid === true, '表单合法(可提交)');

    const entries = inst.pasteEntries;
    check(entries.length === 10, `10 组 entries (实际 ${entries.length})`);
    check(
      JSON.stringify(entries.map((e) => e.quantity)) === JSON.stringify([15, 14, 13, 12, 11, 9, 7, 6, 5, 4]),
      '每组数量 = 星数, 且不含 0 星组'
    );
    check(entries.reduce((n, e) => n + e.member_ids.length, 0) === 28, '合计 28 个成员位');

    const payload = inst.createPayload();
    check(payload.rule_id === RULE.id && Array.isArray(payload.entries), 'createPayload 走上 entries 分支');
    check(!('member_ids' in payload), '分组模式不再发单人 member_ids');

    const body = inst.submitBody({ ...payload, client_token: 'TOK-1' });
    check(
      Object.keys(body).sort().join(',') === 'client_token,entries',
      `提交体字段 = client_token + entries (实际 ${Object.keys(body).join(',')})`
    );
    check(body.client_token === 'TOK-1', '提交体带批次号');
    check(
      body.entries.every((e) => Object.keys(e).sort().join(',') === 'member_ids,note,quantity,rule_id'),
      '每条 entry 字段 = rule_id/quantity/member_ids/note'
    );
    check(body.entries[0].member_ids !== entries[0].member_ids, '提交体不共享同一数组(避免外部改动)');
    check(inst.makeFingerprint(payload) === inst.currentFingerprint, '当前指纹 = 表单指纹(预览不会过期)');

    // 模板真的渲染出了分组模式与摘要
    const t = tree();
    check(t.includes('分组数量录入'), '模板渲染出分组模式卡片');
    check(t.includes('15星 × 7人'), '模板渲染出「15星 × 7人」摘要');
    check(t.includes('共 28 人'), '模板渲染出「共 28 人」');
    check(t.includes('0 星跳过 2 人'), '模板渲染出 0 星跳过人数');
    check(!t.includes('每人数量'), '分组模式下不再出现「每人数量」输入框');
    check(t.includes('确认分组录入 · 28 人'), '主按钮文案为分组录入');
  }

  section('页面级: 提交成功后状态复位');
  {
    stub.calls.length = 0;
    await inst.save();
    await nextTick();

    const previewCall = stub.calls.find((c) => c.url === '/records/preview');
    const saveCall = stub.calls.find((c) => c.url === '/records');
    check(!!previewCall && Array.isArray(previewCall.body.entries), '提交前先带 entries 预览');
    check(!!saveCall, '向 /records 提交了一次');
    check(saveCall.body.entries.length === 10, '提交体含 10 组');
    check(/^b[a-z0-9]+$/.test(String(saveCall.body.client_token)), '批次号由页面生成(b 前缀)');
    check(
      new Set(saveCall.body.entries.map((e) => e.member_ids.length)).size > 1,
      '一次提交里确实存在不同人数的分组(不是退化成一个数量)'
    );
    check(saveCall.body.entries[0].note === '', '未填备注时 note 为空串');

    // 15星7人 + 14星4人 + 13星2人 + 12星4人 + 11星3人 + 9星2人 + 7星1人 + 6星2人 + 5星2人 + 4星1人
    // 每人 星数×3 分(都在周上限 63 内) => 957
    check(inst.lastBatch && inst.lastBatch.inserted === 28, `结果卡: 新增 28 条 (实际 ${inst.lastBatch && inst.lastBatch.inserted})`);
    check(inst.lastBatch.delta === 957, `结果卡: 实际新增 957 分 (实际 ${inst.lastBatch && inst.lastBatch.delta})`);
    check(
      inst.lastBatch.quantityText === '共 28 人 · 10 组不同数量',
      `结果卡文案: ${inst.lastBatch.quantityText}`
    );
    check(inst.pasteMode === false, '提交成功后退出分组模式(防止同一份名单再点一次)');
    check(inst.pasteGroups.length === 0, `提交成功后清空名单 (实际 ${inst.pasteGroups.length} 组)`);
    check(inst.quantity === '' && inst.note === '', '提交成功后清空数量与备注');
    check(stub.toasts.includes('录入成功'), '提示"录入成功"');
    debug('save 后', {
      pasteMode: inst.pasteMode,
      groups: inst.pasteGroups.length,
      formLocked: inst.formLocked,
      toasts: stub.toasts,
    });

    const remembered = stub.storage.get('coc_last_success_members_3');
    check(
      Array.isArray(remembered) && remembered.length === 28,
      `记住本次成功录入的 28 名成员 (实际 ${Array.isArray(remembered) ? remembered.length : '-'})`
    );

    await nextTick();
    check(tree().includes('实际新增 957 分'), '结果卡渲染出实际新增分数');
  }

  section('页面级: 指认 / 新建 / 忽略');
  {
    inst.pasteText = PASTED;
    inst.runPasteParse();
    check(inst.pasteGroups.length === 11, `重新解析 11 组 (实际 ${inst.pasteGroups.length})`);

    // 指认: 把 15 星的「經过」换成另一个人
    inst.openAssign(0, 1);
    check(!!inst.assignTarget && inst.assignTarget.name === '經过', '打开指认弹层并带上这一行的名字');
    check(inst.keyword === '經过', '指认时搜索框预填识图名字(方便看到近似候选)');
    check(inst.membersPanelOpen === true, '选人弹层随之打开');

    const other = inst.eligibleMembers.find((m) => m.nickname === '龙虾');
    check(inst.isSelected(other) === false, '指认模式下"已选中"跟随被指认行');
    inst.toggle(other.id);
    check(inst.pasteRow(0, 1).memberName === '龙虾', '指认后该行变成手动指定的成员');
    check(inst.pasteRow(0, 1).kind === 'manual', '该行标记为「已指认」');
    check(inst.membersPanelOpen === false && inst.assignTarget === null, '指认后自动关闭弹层');

    // 冲突: 把「帅隆隆」那一行指认成已经用过的成员 -> 拒绝
    stub.toasts.length = 0;
    inst.openAssign(0, 0);
    inst.toggle(other.id);
    check(inst.pasteRow(0, 0).memberName === '帅隆隆', '已占用的成员不会被重复指认');
    check(stub.toasts.some((x) => x.includes('只记一次')), '冲突时给出提示');
    inst.closeMemberPanel();

    // 新建成员
    stub.calls.length = 0;
    const before = inst.eligibleMembers.length;
    inst.pasteText = '15星：asver';
    inst.runPasteParse();
    check(inst.pasteStats.unresolved === 1, `未匹配的名字被标成待处理 (实际 ${inst.pasteStats.unresolved})`);
    check(inst.pasteCanApply === false, '有待处理名字时不能应用');
    check(inst.pasteBlockerText.includes('还有 1 个名字没处理'), `底部提示: ${inst.pasteBlockerText}`);

    await inst.createMember(0, 0);
    const createCall = stub.calls.find((c) => c.url === '/members');
    check(!!createCall && createCall.method === 'POST', '调用了新增成员接口');
    check(createCall.body.nickname === 'asver' && createCall.body.status === 0, '按识图名字新建绿牌成员');
    check(inst.eligibleMembers.length === before + 1, '新成员立刻进入可选成员(无需整页刷新)');
    check(inst.pasteRow(0, 0).kind === 'manual' && inst.pasteRow(0, 0).memberId === 901, '新建后自动指认到这一行');
    check(inst.pasteStats.unresolved === 0 && inst.pasteCanApply === true, '处理完后可以应用');

    // 忽略
    inst.toggleIgnore(0, 0);
    check(inst.pasteRow(0, 0).ignored === true, '可以忽略这一行');
    check(inst.pasteEntries.length === 0, `全部忽略后没有可提交的组 (实际 ${inst.pasteEntries.length})`);
    check(inst.pasteCanApply === false, '没有可录入的人时不能应用');
    inst.toggleIgnore(0, 0);
    check(inst.pasteEntries.length === 1 && inst.pasteEntries[0].quantity === 15, '恢复后回到可提交状态');
  }

  section('页面级: 粘贴面板渲染');
  {
    // 上一节"新建成员"往列表里加过 asver, 这里恢复成纯线上名单, 保证未匹配场景真实
    inst.members = roster.map((m) => ({
      id: Number(m.id),
      nickname: m.nickname,
      tag: m.tag || '',
      status: Number(m.status),
    }));

    inst.pasteText = PASTED;
    inst.runPasteParse();
    inst.openPaste();
    await nextTick();

    const t = tree();
    check(inst.pasteOpen === true, '面板已打开');
    check(t.includes('粘贴星数名单'), '面板标题渲染');
    check(t.includes('联赛胜利星') && t.includes('3 分 / 每颗星'), '面板副标题显示当前积分项与单价');
    check(t.includes('15 星') && t.includes('0 星'), '每个星数组都有星数徽章');
    check(t.includes('7 人'), '小组人数渲染');
    check(t.includes('泥头车出击（近似，请核对）'), '近似匹配那一行标出真实成员名与提示');
    check(t.includes('0 星，不录入'), '0 星行标为不录入');
    check(t.includes('应用分组 · 28 人'), '底部按钮显示将应用的人数');

    inst.pasteText = '15星：asver';
    inst.onPasteInput(); // 改文本后旧结果必须作废
    check(inst.pasteParsed === false && inst.pasteGroups.length === 0, '改动文本后旧解析结果立即作废');
    inst.runPasteParse();
    await nextTick();

    const t2 = tree();
    check(t2.includes('名单里没有这个人'), '未匹配行给出可读说明');
    check(t2.includes('指认') && t2.includes('新建') && t2.includes('忽略'), '未匹配行给出 指认/新建/忽略 三个操作');
    check(t2.includes('还有 1 个名字没处理'), '底部提示还差什么');
    check(t2.includes('解析并处理名单后应用'), '未处理完时按钮文案不是"应用"');

    inst.closePaste();
    await nextTick();
    check(inst.pasteOpen === false, '面板可关闭');
  }

  section('页面级: 快速切换 + 弹层层级');
  {
    // 真实名单里「天下」和「天谴」只差一个字 -> 应该出现"快速切换"候选
    inst.members = roster.map((m) => ({
      id: Number(m.id),
      nickname: m.nickname,
      tag: m.tag || '',
      status: Number(m.status),
    }));
    inst.pasteText = PASTED;
    inst.runPasteParse();

    const gi = inst.pasteGroups.findIndex((g) => g.star === 11);
    const ri = inst.pasteGroups[gi].rows.findIndex((r) => r.name === '天下');
    const row = inst.pasteGroups[gi].rows[ri];
    check(gi >= 0 && ri >= 0, '找到 11 星组里的「天下」');
    check(row.memberName === '天下', '「天下」精确命中');
    check(
      row.alts.some((a) => a.nickname === '天谴'),
      `「天下」行给出可切换候选(实际 ${row.alts.map((a) => a.nickname).join('/') || '无'})`
    );

    const tianqian = row.alts.find((a) => a.nickname === '天谴');
    stub.toasts.length = 0;
    inst.quickAssign(gi, ri, tianqian.id);
    check(row.memberName === '天谴' && row.kind === 'manual', '快速切换: 一键切到「天谴」');
    check(stub.toasts.some((x) => x.includes('天谴')), '切换后给出提示');

    const tianxia = inst.members.find((m) => m.nickname === '天下');
    inst.quickAssign(gi, ri, tianxia.id);
    check(row.memberName === '天下' && row.kind === 'manual', '快速切换: 还能切回「天下」');
    check(inst.pasteEntries.some((e) => e.quantity === 11 && e.member_ids.includes(tianxia.id)), '切换结果进入提交计划');

    // 已被别的行占用的成员 -> 拒绝
    const otherRow = inst.pasteGroups.find((g) => g.star === 15).rows[0];
    stub.toasts.length = 0;
    inst.quickAssign(gi, ri, otherRow.memberId);
    check(row.memberName === '天下', '已被别的星数组占用的成员不会被切走');
    check(stub.toasts.some((x) => x.includes('只记一次')), '冲突时提示"同一个人只记一次"');

    // 渲染出来: 面板里应该有"快速切换 / 天谴"字样
    inst.pasteText = PASTED;
    inst.runPasteParse();
    inst.openPaste();
    await nextTick();
    const tree2 = tree();
    check(tree2.includes('快速切换'), '面板渲染出「快速切换」');
    check(tree2.includes('天谴'), '面板渲染出可切换的成员名');
    inst.closePaste();
    await nextTick();
  }

  section('页面级: 弹层层级与底边(踩过的坑, 加断言锁住)');
  {
    // uni-app H5 的层级: tabBar 998 / uni.showModal & uni.showToast 999。
    // 弹层必须 < 999(否则确认框被盖住), 又不跟 tabBar 抢层级(抢不过就会把底部按钮压掉),
    // 而是整体停在 tabBar 之上 —— bottom: var(--window-bottom)。
    const blockOf = (cls) => {
      const m = source.match(new RegExp('\\.' + cls + '\\s*\\{[^}]*\\}', 's'));
      return m ? m[0] : '';
    };
    const zOf = (cls) => {
      const m = blockOf(cls).match(/z-index:\s*(\d+)/);
      return m ? Number(m[1]) : 0;
    };
    const zPicker = zOf('member-picker-layer');
    const zPaste = zOf('paste-layer');
    const pickBlock = blockOf('member-picker-layer');
    const pasteBlock = blockOf('paste-layer');

    check(zPicker > 0 && zPicker < 999, `选人弹层层级 ${zPicker} 必须低于 uni 弹窗 999`);
    check(zPaste > 0 && zPaste < 999, `粘贴面板层级 ${zPaste} 必须低于 uni 弹窗 999`);
    check(zPicker > zPaste, `选人弹层(${zPicker}) 必须高于粘贴面板(${zPaste}), 否则"指认"会被压住`);
    check(
      /bottom:\s*var\(--window-bottom/.test(pickBlock),
      '选人弹层底边让出 tabBar 高度(bottom: var(--window-bottom)), 否则确认按钮被底部导航盖住'
    );
    check(
      /bottom:\s*var\(--window-bottom/.test(pasteBlock),
      '粘贴面板底边同样让出 tabBar 高度'
    );
    check(
      /max-height:\s*min\(900px,\s*100%\)/.test(blockOf('member-picker-sheet')),
      '抽屉高度不超过弹层可视高度(避免顶部被切掉)'
    );
    check(
      !/padding[^;]*safe-area-inset-bottom/.test(blockOf('picker-footer')),
      '底部安全区只让一次(弹层已让出, 页脚不再重复加 env(safe-area-inset-bottom))'
    );
    check(source.includes('v-if="pasteOpen" class="paste-layer"'), '粘贴面板用的是 paste-layer');
    check(source.includes('v-if="membersPanelOpen" class="member-picker-layer"'), '选人弹层用的是 member-picker-layer');
  }

  section('页面级: 普通录入路径未受影响');
  {
    inst.pasteMode = false;
    inst.assignTarget = null;
    inst.selectedIds = [];
    inst.quantity = '5';

    const m1 = inst.eligibleMembers[0];
    const m2 = inst.eligibleMembers[1];
    check(inst.isSelected(m1) === false, '普通模式下"已选中"来自 selectedIds');
    inst.toggle(m1.id);
    inst.toggle(m2.id);
    check(inst.selectedIds.length === 2, '可以多选成员');
    check(inst.isSelected(m1) === true, '选中状态正确');
    inst.toggle(m1.id);
    check(inst.selectedIds.length === 1, '再点一次取消选择');
    inst.toggle(m1.id);

    const payload = inst.createPayload();
    check(
      !payload.entries && Array.isArray(payload.member_ids) && payload.quantity === 5,
      '普通模式仍发 {rule_id, quantity, member_ids}'
    );
    check(inst.formValid === true, '普通模式表单合法');
    const body = inst.submitBody({ ...payload, client_token: 'T2' });
    check(
      'member_ids' in body && body.quantity === 5 && !('entries' in body),
      '普通模式提交体不变'
    );
    check(inst.makeFingerprint(payload).includes('"quantity":5'), '普通模式指纹包含数量');

    inst.selectedIds = [];
    inst.quantity = '';
  }

  section('页面级: 访客/异常状态');
  {
    inst.pasteText = '15星：帅隆隆、晚归';
    inst.runPasteParse();
    check(inst.pasteEntries.length === 1 && inst.pasteEntries[0].member_ids.length === 2, '同一组两人只生成一条 entry');

    inst.canWrite = false;
    check(inst.formValid === false, '访客/无权限时表单不合法');
    check(inst.submitDisabled === true, '访客/无权限时提交按钮禁用');
    inst.canWrite = true;

    inst.pasteText = '这是一段没有任何星数的文字';
    inst.runPasteParse();
    check(inst.pasteParsed === false && !!inst.pasteError, '解析不出分组时给出可读错误');
    check(inst.pasteCanApply === false, '解析失败时不能应用');

    // 成员列表刷新后失效的指认要退回未匹配
    inst.pasteText = '15星：帅隆隆';
    inst.runPasteParse();
    const row = inst.pasteRow(0, 0);
    check(!!row.memberId, '先匹配上');
    inst.members = inst.members.filter((m) => m.id !== row.memberId);
    inst.revalidatePaste();
    check(row.memberId === null && row.kind === 'none', '成员被删/归档后退回「未匹配」');
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
