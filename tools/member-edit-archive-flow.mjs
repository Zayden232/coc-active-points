// ============================================================
// 成员编辑页 · 归档成员可查看/可恢复 页面级流程验证
//
// 用法: node tools/member-edit-archive-flow.mjs
//
// 背景: 成员页新增「归档」筛选后, 归档成员变得可点击。如果编辑页还按老口径
// (GET /members 不带 include_archived, 并且见到 deleted_at 就报"成员不存在或已被归档"),
// 点进去就是个死链接。这里验证编辑页确实能加载归档成员并给出恢复提示。
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
  { id: 1, nickname: '小羊', tag: '', status: 0, town_hall: 18, prosperity: 148, red_since: null, red_days: null, note: '', join_date: '2025-01-01', deleted_at: null },
  { id: 5, nickname: '已归档甲', tag: '', status: 2, town_hall: 14, prosperity: 73, red_since: null, red_days: null, note: '老成员', join_date: '2024-05-01', deleted_at: '2026-09-01 10:20:30' },
];

const stub = {
  calls: [],
  toasts: [],
  modals: [],
  recordTotal: 17,
  superAdmin: true,
  modalAnswers: [],
  request(method, url, data) {
    this.calls.push({ method, url, body: data ? JSON.parse(JSON.stringify(data)) : data });
    if (url === '/members/batch-action') return Promise.resolve({ affected: 1, duplicated: false });
    if (String(url).startsWith('/records')) return Promise.resolve({ rows: [], total: this.recordTotal });
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

const PERMISSIONS_MOCK = `
export function ensureAdminPage() { return true; }
export function canWrite() { return true; }
`;

const COMPONENT_MOCK = `
export default { name: 'MemberWarStatus', props: ['status', 'redDays', 'compact', 'iconOnly'], render() { return null; } };
`;

const durl = (code) => 'data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64');

const nodeOps = {
  createElement: (tag) => ({ type: 'element', tag, children: [], props: {}, style: {}, parent: null, addEventListener() {}, removeEventListener() {} }),
  createText: (text) => ({ type: 'text', text, parent: null }),
  createComment: (text) => ({ type: 'comment', text, parent: null }),
  setText(node, text) { node.text = text; },
  setElementText(el, text) { el.children = [{ type: 'text', text, parent: el }]; },
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
  patchProp(el, key, prev, next) { el.props[key] = next; },
};

function textsOf(node, out = []) {
  if (!node) return out;
  if (node.type === 'text') out.push(String(node.text));
  for (const c of node.children || []) textsOf(c, out);
  return out;
}

async function mountPage(vue, pageOptions, render, tmpDir) {
  let inst = null;
  const app = vue.createRenderer(nodeOps).createApp({ ...pageOptions, render });
  app.mixin({ created() { if (!inst) inst = this; } });
  const container = { type: 'root', tag: 'root', children: [], props: {}, parent: null };
  app.mount(container);
  if (!inst) throw new Error('没抓到页面实例');
  return { inst, tree: () => textsOf(container).join(' '), nextTick: () => vue.nextTick() };
}

const tmpDir = path.resolve('app/.dsh-member-edit-archive-flow');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

try {
  const pageFile = path.resolve('app/src/pages/member-edit/member-edit.vue');
  const source = fs.readFileSync(pageFile, 'utf8');
  const { descriptor, errors } = sfc.parse(source, { filename: pageFile, pad: 'space' });
  if (errors.length) throw new Error('SFC 解析失败: ' + errors[0].message);

  const readUtil = (p) => fs.readFileSync(path.resolve('app/src/utils', p), 'utf8');
  const apiMockUrl = JSON.stringify(durl(API_MOCK));

  const script = descriptor.script.content
    .replace(/'@\/utils\/api'/g, apiMockUrl)
    .replace(/'@\/utils\/permissions'/g, JSON.stringify(durl(PERMISSIONS_MOCK)))
    .replace(/'@\/utils\/h5'/g, JSON.stringify(durl(readUtil('h5.js'))))
    .replace(/'@\/components\/MemberWarStatus\.vue'/g, JSON.stringify(durl(COMPONENT_MOCK)));

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

  section('归档成员可以打开编辑页(不再是死链接)');
  {
    const { inst, tree, nextTick } = await mountPage(vue, pageOptions, render, tmpDir);
    inst.active = true;
    inst.authorized = true;
    inst.id = '5';
    stub.calls.length = 0;

    await inst.loadMember();
    await nextTick();

    const call = stub.calls.find((c) => c.method === 'GET');
    check(
      call && call.url === '/members?include_archived=1',
      `编辑页请求带上了 include_archived=1 (实际 ${call && call.url})`
    );
    check(inst.ready === true, '归档成员加载成功(ready=true)');
    check(inst.loadError === '', `没有报错 (实际 "${inst.loadError}")`);
    check(inst.archived === true, '标记为已归档');
    check(inst.archivedAt === '2026-09-01', `取到归档日期 (实际 "${inst.archivedAt}")`);
    check(inst.form.nickname === '已归档甲', '资料正常回填');
    check(inst.form.status === 2, '状态回填为离开');

    const t = tree();
    check(t.includes('该成员已归档'), '页面渲染出「该成员已归档」提示');
    check(t.includes('归档于 2026-09-01'), '提示里带归档日期');
    check(t.includes('改成「绿牌 · 参战」'), '提示里说明恢复方法');
    check(t.includes('保存成员资料'), '表单仍然渲染(没有把整个表单顶掉)');
    check(!t.includes('移除并归档此成员'), '已归档成员不再显示"移除并归档"按钮');
  }

  section('在册成员不受影响');
  {
    const { inst, tree, nextTick } = await mountPage(vue, pageOptions, render, tmpDir);
    inst.active = true;
    inst.authorized = true;
    inst.id = '1';

    await inst.loadMember();
    await nextTick();

    check(inst.ready === true && inst.loadError === '', '在册成员正常加载');
    check(inst.archived === false, '不标记为已归档');
    const t = tree();
    check(!t.includes('该成员已归档'), '不显示归档提示');
    check(t.includes('移除并归档此成员'), '在册成员仍显示"移除并归档"按钮');
  }

  section('永久删除: 超管专属 + 双重确认 + 只发 purge=1');
  {
    const { inst, tree, nextTick } = await mountPage(vue, pageOptions, render, tmpDir);
    inst.active = true;
    inst.authorized = true;
    inst.id = '5';
    await inst.loadMember();
    await nextTick();

    // 超管可见
    inst.superAdmin = true;
    stub.superAdmin = true;
    await nextTick();
    check(tree().includes('永久删除此成员'), '超管在归档成员页看到「永久删除此成员」');
    check(tree().includes('不可恢复'), '永久删除区明确标注不可恢复');

    // 非超管不可见
    inst.superAdmin = false;
    stub.superAdmin = false;
    await nextTick();
    check(!tree().includes('永久删除此成员'), '非超管看不到永久删除按钮');

    // 非超管即使调用也不发请求
    stub.calls.length = 0;
    stub.toasts.length = 0;
    await inst.purge();
    await nextTick();
    check(!stub.calls.some((c) => c.method === 'DELETE'), '非超管调用不发删除请求');
    check(
      stub.toasts.some((x) => x.includes('仅超级管理员')),
      `给出权限提示 (实际 ${JSON.stringify(stub.toasts)})`
    );

    // 超管: 双重确认 + 确认框写出代价
    inst.superAdmin = true;
    stub.superAdmin = true;
    stub.modals.length = 0;
    stub.calls.length = 0;
    stub.modalAnswers = [true, true];
    stub.recordTotal = 17;
    await inst.purge();
    await nextTick();

    check(
      stub.calls.some((c) => String(c.url).startsWith('/records?member_id=')),
      '删除前先查了流水条数'
    );
    check(stub.modals.length === 2, `两次确认 (实际 ${stub.modals.length})`);
    check(
      stub.modals[0].content.includes('17 条积分流水') && stub.modals[0].content.includes('已归档甲'),
      `第一次确认带昵称与代价 (实际 ${stub.modals[0].content})`
    );
    check(stub.modals[1].content.includes('不可撤销'), '第二次确认强调不可撤销');

    const purgeCall = stub.calls.find((c) => c.method === 'DELETE');
    check(
      purgeCall && purgeCall.url === '/members/5?purge=1',
      `请求路径 /members/5?purge=1 (实际 ${purgeCall && purgeCall.url})`
    );

    // 第一次确认取消 -> 不删
    stub.modals.length = 0;
    stub.calls.length = 0;
    stub.modalAnswers = [false];
    await inst.purge();
    await nextTick();
    check(!stub.calls.some((c) => c.method === 'DELETE'), '第一次取消后不删');
    check(stub.modals.length === 1, '取消后不再弹第二次');
  }

  section('不存在的成员仍然报错');
  {
    const { inst, nextTick } = await mountPage(vue, pageOptions, render, tmpDir);
    inst.active = true;
    inst.authorized = true;
    inst.id = '9999';
    await inst.loadMember();
    await nextTick();
    check(inst.ready === false, '不存在的成员不会进入 ready');
    check(
      inst.loadError.includes('成员不存在'),
      `给出"成员不存在" (实际 "${inst.loadError}")`
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
