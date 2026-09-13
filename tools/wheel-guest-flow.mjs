// ============================================================
// 部落转盘页 · 「访客也能领每日奖励」页面级流程验证
// 用法: node tools/wheel-guest-flow.mjs
//
// 针对的问题: 每日奖励原先被前端 canWrite 门禁挡住(非管理员只看到
// 「好运，由管理员派送」只读卡片), 后端又被「/api 非 GET 需管理员」拦成 403。
// 后端那条已在 server/scripts/e2e-cases.mjs 里验证; 这里验证**页面本身**:
//   1) 只读卡片与 canWrite 门禁已删除;
//   2) 任何身份(含未登录访客)进页面都会去查今日抽奖资格;
//   3) 资格可抽时按钮就真的能点, 并发出 POST /wheel/spin;
//   4) 已离开成员 / 今日已抽仍然抽不了(放开不等于乱放开);
//   5) 服务端说"今天已抽过"时, 页面展示历史结果而不是再播一次假动画。
//
// 做法与 members-archive-flow.mjs 相同: 编译 SFC → createRenderer 极简节点操作真渲染
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

const MEMBERS = [
  { id: 1, nickname: '小羊', status: 0 },
  { id: 2, nickname: '晚归', status: 1 },
  { id: 4, nickname: '已离开的人', status: 2 },
];

const stub = {
  calls: [],
  toasts: [],
  // 今日抽奖资格(用 /wheel/status 的返回)
  status: {
    draw_date: '2026-09-13',
    member: MEMBERS[0],
    can_draw: true,
    spin: null,
    cosmetics: [],
    probability: 0.45,
    pool: [{ key: 'frame_flame', kind: 'frame', value: 'flame', label: '烈焰框' }],
  },
  spinResult: {
    already: false,
    draw_date: '2026-09-13',
    win: true,
    reward: { key: 'frame_flame', kind: 'frame', value: 'flame', label: '烈焰框' },
    expires_at: '2026-09-14 10:00:00',
    cosmetics: [],
  },
  request(method, url, data) {
    // uni.request 的 GET 参数在 data 里(拼进 query), POST 参数就是 body
    this.calls.push({ method, url, body: data ? JSON.parse(JSON.stringify(data)) : data });
    if (method === 'GET' && url === '/members') return Promise.resolve(MEMBERS);
    if (method === 'GET' && String(url).indexOf('/wheel/status') === 0) {
      return Promise.resolve(this.status);
    }
    if (method === 'POST' && url === '/wheel/spin') return Promise.resolve(this.spinResult);
    return Promise.resolve({});
  },
  last(method) {
    for (let i = this.calls.length - 1; i >= 0; i -= 1) {
      if (this.calls[i].method === method) return this.calls[i];
    }
    return null;
  },
  count(method, url) {
    return this.calls.filter((c) => c.method === method && (!url || c.url === url)).length;
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
    if (o && o.success) o.success({ confirm: true, cancel: false });
  },
  navigateTo() {},
  switchTab() {},
  navigateBack() {},
  setNavigationBarTitle() {},
};

// 注意: 这里故意**不导出 canWrite / canWriteNow** —— 页面若还在 import 它, 测试会直接报错,
// 这正是"门禁是否真的删干净"的硬证据。
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
export function get(url, data) { return globalThis.__flow.request('GET', url, data); }
export function post(url, data) { return globalThis.__flow.request('POST', url, data); }
export function put(url, data) { return globalThis.__flow.request('PUT', url, data); }
export function patch(url, data) { return globalThis.__flow.request('PATCH', url, data); }
export function del(url, data) { return globalThis.__flow.request('DELETE', url, data); }
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

const tmpDir = path.resolve('app/.dsh-wheel-guest-flow');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

let inst = null;

try {
  const pageFile = path.resolve('app/src/pages/wheel/wheel.vue');
  const source = fs.readFileSync(pageFile, 'utf8');
  const { descriptor, errors } = sfc.parse(source, { filename: pageFile, pad: 'space' });
  if (errors.length) throw new Error('SFC 解析失败: ' + errors[0].message);

  const apiMockUrl = JSON.stringify(durl(API_MOCK));
  const h5Url = JSON.stringify(
    durl(fs.readFileSync(path.resolve('app/src/utils/h5.js'), 'utf8'))
  );

  if (!/'@\/utils\/api'/.test(descriptor.script.content)) {
    throw new Error('页面的 @/utils/api 导入没找到, 测试桩可能没生效');
  }
  if (/'@\/utils\/api'[\s\S]{0,80}canWrite/.test(descriptor.script.content)) {
    throw new Error('页面仍在导入 canWrite(只读门禁没删干净)');
  }

  const script = descriptor.script.content
    .replace(/'@\/utils\/api'/g, apiMockUrl)
    .replace(/'@\/utils\/h5'/g, h5Url);

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

  // DUMP_TREE=1 时把渲染出来的文字全打出来, 便于人眼核对"页面上到底有什么"
  if (process.env.DUMP_TREE) {
    console.log('--- 渲染树文字 ---');
    console.log(tree());
    console.log('--- 渲染树节点(前 80 个) ---');
    const flat = [];
    const walk = (n, depth) => {
      if (!n) return;
      flat.push(`${'  '.repeat(depth)}${n.type === 'element' ? '<' + n.tag + ' class=' + JSON.stringify(n.props && n.props.class) + '>' : JSON.stringify(n.text)}`);
      for (const c of n.children || []) walk(c, depth + 1);
    };
    walk(container, 0);
    console.log(flat.slice(0, 80).join('\n'));
  }

  section('1. 只读门禁已经删干净');
  check(inst.canWrite === undefined, '页面实例上不再有 canWrite 字段');
  check(!tree().includes('好运，由管理员派送'), '模板里不再有"好运，由管理员派送"只读卡片');
  check(tree().includes('每日一次'), '徽章改成「每日一次」（不再是「管理员代抽」）');
  check(tree().includes('点击切换成员'), '选择成员提示不再写"代抽"');
  check(!tree().includes('管理员代抽'), '模板里彻底没有「管理员代抽」');

  section('2. 未登录访客进页面就会查今日资格');
  {
    stub.calls.length = 0;
    // onShow/loadMembers 是 uni 页面生命周期, 直接调页面方法做同样的事
    inst.active = true;
    await inst.loadMembers();
    await nextTick();

    check(stub.count('GET', '/members') === 1, '拉取了成员列表');
    const statusCall = stub.calls.filter((c) => c.url.indexOf('/wheel/status') === 0).pop();
    check(!!statusCall, '访客也会去查今日抽奖资格（旧代码非管理员直接跳过）');
    check(
      !!statusCall && statusCall.body && statusCall.body.member_id === 1,
      `状态查询带上当前选中的成员 (实际 ${JSON.stringify(statusCall && statusCall.body)})`
    );
    check(inst.status !== null, '拿到了今日抽奖状态');
    check(inst.canSpin === true, '访客身份下 canSpin 为 true（旧代码这里是 false）');
  }

  section('3. 访客点抽奖: 真的发出 POST /wheel/spin');
  {
    stub.calls.length = 0;
    stub.status = { ...stub.status, can_draw: true, spin: null };
    stub.spinResult = {
      already: false,
      draw_date: '2026-09-13',
      win: true,
      reward: { key: 'frame_flame', kind: 'frame', value: 'flame', label: '烈焰框' },
      expires_at: '2026-09-14 10:00:00',
      cosmetics: [],
    };
    await inst.loadStatus();
    await nextTick();
    check(inst.canSpin === true, '资格可抽时按钮可用');

    await inst.doSpin();
    // 页面把 spinning=false 放在 3.3s 动画结束的回调里, 测试不等真实动画:
    // 清掉计时器并手动收尾, 模拟"动画放完了"。
    if (inst._spinTimer) clearTimeout(inst._spinTimer);
    inst._spinTimer = null;
    inst.spinning = false;
    inst.result = {
      already: false,
      win: true,
      reward: { key: 'frame_flame', kind: 'frame', value: 'flame', label: '烈焰框' },
    };
    await nextTick();

    const spinCall = stub.last('POST');
    check(!!spinCall && spinCall.url === '/wheel/spin', '抽奖请求打到了 /wheel/spin');
    check(
      !!spinCall && spinCall.body && spinCall.body.member_id === 1,
      `带上当前选中成员的 id (实际 ${JSON.stringify(spinCall && spinCall.body)})`
    );
  }

  section('4. 该拦住的仍然拦住');
  {
    stub.status = { ...stub.status, can_draw: false, spin: { reward_key: 'none', reward_label: '谢谢参与' } };
    await inst.loadStatus();
    await nextTick();
    check(inst.canSpin === false, '今日已抽过 -> 按钮不可用');
    check(inst.spinButtonText.includes('明天再来'), `按钮文案提示明天再来 (实际 ${inst.spinButtonText})`);

    // 切到"已离开"的成员
    inst.memberIndex = MEMBERS.findIndex((m) => m.status === 2);
    stub.status = { ...stub.status, can_draw: true, spin: null };
    await inst.loadStatus();
    await nextTick();
    check(inst.canSpin === false, '已离开部落的成员仍然不能抽');
    check(inst.spinButtonText.includes('已离开'), `按钮文案说明不可抽 (实际 ${inst.spinButtonText})`);
  }

  section('5. 幂等: 服务端说"今天已抽过"时不播假动画');
  {
    // 换回在册成员(第 4 节把选中项切成了"已离开"), 然后模拟:
    // 页面本地状态还是"可抽", 但服务端说今天已经抽过了(例如另一端刚抽完)
    inst.memberIndex = 0;
    stub.status = { ...stub.status, can_draw: true, spin: null };
    await inst.loadStatus();
    check(inst.canSpin === true, '在册成员 + 本地可抽 -> 按钮可用');
    stub.calls.length = 0;
    stub.spinResult = {
      already: true,
      draw_date: '2026-09-13',
      spin: { reward_key: 'frame_flame', reward_label: '烈焰框' },
      cosmetics: [],
    };
    const rotationBefore = inst.rotation;

    await inst.doSpin();
    await nextTick();

    check(stub.count('POST', '/wheel/spin') === 1, '重复请求仍然打到服务端(由服务端判定)');
    check(inst.rotation === rotationBefore, '没有播放抽奖动画(直接展示历史结果)');
    check(inst.spinning === false, '按钮已解锁');
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
