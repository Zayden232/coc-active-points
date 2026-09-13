// ============================================================
// 批量导入页(识图格式) 页面级流程验证
//
// 用法: node tools/import-page-flow.mjs
//
// 验证的是"页面胶水": 预览回来后勾选状态的默认值、哪些情况允许继续/导入、
// doImport 到底发了什么(apply 开关)、以及新增的牌子变化/资料变化卡片能不能渲染出来。
// 后端解析与写库由 server 的真实 MySQL E2E 覆盖。
//
// 做法与 entry-paste-flow.mjs 相同: 编译 SFC → createRenderer 极简节点操作真渲染
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

// ---- 桩: 服务端返回的预览/导入结果 ----
const stub = {
  calls: [],
  toasts: [],
  preview: null,
  importResult: null,
  request(method, url, data) {
    this.calls.push({ method, url, body: data ? JSON.parse(JSON.stringify(data)) : data });
    if (url === '/members/batch/preview') return Promise.resolve(this.preview);
    if (url === '/members/batch') return Promise.resolve(this.importResult);
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
    if (o && o.success) o.success({ confirm: true });
  },
  navigateTo() {},
  switchTab() {},
  navigateBack() {},
  setNavigationBarTitle() {},
};

const API_MOCK = `
export const ROLE = { SUPER: 'super_admin', ADMIN: 'admin', VIEWER: 'viewer', GUEST: 'guest' };
export const ROLE_TEXT = { super_admin: '超级管理员', admin: '管理员', viewer: '访客', guest: '未登录' };
export function canWrite() { return true; }
export function getRole() { return 'super_admin'; }
export function isLoggedIn() { return true; }
export function isSuperAdmin() { return true; }
export function getUser() { return { role: 'super_admin', username: 'stub' }; }
export function roleText() { return '超级管理员'; }
export function accountLabel() { return 'stub'; }
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

const durl = (code) => 'data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64');

const nodeOps = {
  createElement: (tag) => ({
    type: 'element',
    tag,
    children: [],
    props: {},
    style: {}, // v-show 会读写 el.style.display
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

const tmpDir = path.resolve('app/.dsh-import-flow');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

let inst = null;
let container = null;

try {
  const pageFile = path.resolve('app/src/pages/member-import/member-import.vue');
  const source = fs.readFileSync(pageFile, 'utf8');
  const { descriptor, errors } = sfc.parse(source, { filename: pageFile, pad: 'space' });
  if (errors.length) throw new Error('SFC 解析失败: ' + errors[0].message);

  const readUtil = (p) => fs.readFileSync(path.resolve('app/src/utils', p), 'utf8');
  const apiMockUrl = JSON.stringify(durl(API_MOCK));
  // permissions.js 内部还有相对导入 './api', data: URL 里没法解析相对路径 -> 一并替换
  const permissionsSrc = readUtil('permissions.js').replace(/from '\.\/api'/g, `from ${apiMockUrl}`);

  const script = descriptor.script.content
    .replace(/'@\/utils\/api'/g, apiMockUrl)
    .replace(/'@\/utils\/navigation'/g, JSON.stringify(durl(readUtil('navigation.js'))))
    .replace(/'@\/utils\/permissions'/g, JSON.stringify(durl(permissionsSrc)))
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

  fs.writeFileSync(path.join(tmpDir, 'vue.mjs'), "export * from 'vue';\n", 'utf8');
  const vue = await import(pathToFileURL(path.join(tmpDir, 'vue.mjs')).href);

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

  section('页面级: 识图格式预览与勾选');
  {
    stub.preview = {
      parsed: 4,
      errors: [],
      add: [
        { line: 1, nickname: '新人甲', tag: '', note: '', town_hall: 14, prosperity: 63, status: 0 },
        { line: 2, nickname: '新人乙', tag: '', note: '', town_hall: 15, prosperity: 62, status: 1 },
      ],
      restore: [],
      status_change: [
        {
          line: 3,
          nickname: '老成员甲',
          member_id: 11,
          from_status: 0,
          to_status: 1,
          town_hall: 16,
          prosperity: 70,
          reason: '牌子 绿牌 → 红牌',
        },
        {
          line: 4,
          nickname: '老成员乙',
          member_id: 12,
          from_status: 1,
          to_status: 0,
          town_hall: 13,
          prosperity: 55,
          reason: '牌子 红牌 → 绿牌',
        },
      ],
      profile_change: [
        {
          line: 5,
          nickname: '老成员丙',
          member_id: 13,
          from_status: 0,
          town_hall: 15,
          prosperity: 60,
          reason: '繁荣度 62 → 60',
        },
      ],
      exists: [{ line: 6, nickname: '没变化的人', member_id: 14, reason: '与库内一致' }],
      conflict: [],
      counts: {
        add: 2,
        restore: 0,
        status_change: 2,
        profile_change: 1,
        exists: 1,
        conflict: 0,
        invalid: 0,
      },
      status_change_detail: { to_red: 1, to_green: 1 },
      in_tribe_before: 46,
      in_tribe_after: 48,
      warning: '',
    };

    inst.text = '新人甲,14,绿,63\n老成员甲,16,红,70';
    await inst.doPreview();
    await nextTick();

    check(inst.step === 2, '预览成功后进入第 2 步');
    check(inst.preview.counts.status_change === 2, '拿到牌子变化 2 人');
    check(inst.applyStatusChange === true && inst.applyProfileChange === true, '两类更新默认都勾选');
    check(inst.canProceedToConfirm === true, '只有更新(没有新增)时也能继续');
    check(inst.effectiveChanges === 5, `有效变更 = 新增2 + 牌子2 + 资料1 = 5 (实际 ${inst.effectiveChanges})`);

    const t = tree();
    check(t.includes('牌子变化'), '预览渲染出「牌子变化」');
    check(t.includes('绿 → 红 1 人'), '渲染出牌子变化明细 绿→红 1 人');
    check(t.includes('老成员甲'), '渲染出要改牌子的成员');
    check(t.includes('大本营 14 · 繁荣 63 · 绿牌'), '新成员卡片显示识图数据(大本营/繁荣度/牌子)');
  }

  section('页面级: 取消勾选 -> 不写库');
  {
    inst.applyStatusChange = false;
    await nextTick();
    check(inst.effectiveChanges === 3, `取消牌子变化后有效变更 = 2 + 1 = 3 (实际 ${inst.effectiveChanges})`);
    check(inst.canImportFinal === true, '仍有资料变化可导入');

    inst.applyProfileChange = false;
    await nextTick();
    check(inst.effectiveChanges === 2, '两类更新都取消后只剩新增');
    check(inst.canImportFinal === true, '还有新增 -> 仍可导入');
  }

  section('页面级: 提交体带 apply 开关');
  {
    stub.importResult = {
      added: 2,
      restored: 0,
      status_changed: 0,
      profile_changed: 0,
      skipped_exists: 1,
      conflict: 0,
      invalid: 0,
      failed: [],
      in_tribe_after: 48,
      warning: '',
      today: '2026-09-13',
    };
    stub.calls.length = 0;
    stub.toasts.length = 0;
    await inst.doImport();
    const call = stub.calls.find((c) => c.url === '/members/batch');
    check(!!call, '调用了导入接口');
    check(
      call.body.apply && call.body.apply.status_change === false && call.body.apply.profile_change === false,
      `提交体带上勾选状态 (${JSON.stringify(call.body.apply)})`
    );
    check(call.body.allow_same_name === false, '同名选项一并提交');
    check(stub.toasts.some((x) => x.includes('新增 2')), `提示导出结果 (${stub.toasts[0]})`);

    // 全勾选时同样如实上报(导入成功会重置页面, 所以重新预览一次)
    inst.text = '新人甲,14,绿,63';
    await inst.doPreview();
    inst.applyStatusChange = true;
    inst.applyProfileChange = true;
    stub.calls.length = 0;
    await inst.doImport();
    const call2 = stub.calls.find((c) => c.url === '/members/batch');
    check(!!call2, '重新预览后可以再次导入');
    check(
      call2 && call2.body.apply.status_change === true && call2.body.apply.profile_change === true,
      '全勾选时 apply 两个开关都是 true'
    );
  }

  section('页面级: 没有变更时不允许导入');
  {
    stub.preview = {
      parsed: 1,
      errors: [],
      add: [],
      restore: [],
      status_change: [],
      profile_change: [],
      exists: [{ line: 1, nickname: '都是老成员', member_id: 9, reason: '与库内一致' }],
      conflict: [],
      counts: { add: 0, restore: 0, status_change: 0, profile_change: 0, exists: 1, conflict: 0, invalid: 0 },
      status_change_detail: { to_red: 0, to_green: 0 },
      in_tribe_before: 46,
      in_tribe_after: 46,
      warning: '',
    };
    inst.text = '都是老成员,14,绿,63';
    await inst.doPreview();
    await nextTick();
    check(inst.previewTotalChanges === 0, '没有可写库的内容');
    check(inst.canProceedToConfirm === false && inst.canImportFinal === false, '全部一致时不能继续导入');
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
