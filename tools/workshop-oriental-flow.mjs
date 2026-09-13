// ============================================================
// 创作工坊 · 东方幻境: 「没点整理提示词就不能生成」修复 + 默认服装
// 用法: node tools/workshop-oriental-flow.mjs
//
// 针对的问题:
//   1) 东方幻境模式下, 用户不点「将设定整理成提示词」, 而是直接在「最终提示词」里
//      自己写内容时, 「开始生成」一直是灰的 —— 因为 orientalNeedsApply 只看
//      参数 revision, 不认"用户已经自己写了提示词"。
//   2) 默认服装与配饰换成指定内容(且必须是能直接生成的有效值: 不超 140 字、
//      不含会被 cleanField 抹掉的结构符号、末尾不带句号)。
//
// 做法与 wheel-guest-flow.mjs 相同: 编译 SFC → createRenderer 极简节点操作真渲染
// → 抓住页面实例 → 直接驱动它的方法/computed 做断言。
// oriental-prompt.js 用**真实模块**(它不依赖 uni), 所以默认值与拼句结果都是真跑的。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(path.resolve('app/package.json'));
const sfc = require('@vue/compiler-sfc');

const EXPECTED_OUTFIT =
  '让这位角色所有衣物(包含上半身/下半身和鞋子/肩包/丝袜等其他物品，如果有的话全部改）材质改为透肉白色半透明轻纱，隐隐约约能看到角色身体曲线，鞋子改为全透明反光的';

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
  check(actual === expected, `${name}（期望 ${JSON.stringify(expected)}, 实际 ${JSON.stringify(actual)}）`);
};
const section = (name) => console.log('\n== ' + name + ' ==');

const stub = { toasts: [], modals: [] };

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
    if (o && o.success) o.success({ confirm: true, cancel: false });
  },
  navigateTo() {},
  switchTab() {},
  navigateBack() {},
  setNavigationBarTitle() {},
  downloadFile: (o) => o && o.success && o.success({ statusCode: 200, tempFilePath: '_doc/t.bin' }),
  uploadFile: (o) => o && o.success && o.success({ statusCode: 201, data: '{"ok":true,"data":{}}' }),
  request: (o) => o && o.success && o.success({ statusCode: 200, data: { ok: true, data: {} } }),
};

const API_MOCK = `
export const ROLE = { SUPER: 'super_admin', ADMIN: 'admin', VIEWER: 'viewer', GUEST: 'guest' };
export function canWrite() { return true; }
export function getRole() { return 'admin'; }
export function isLoggedIn() { return true; }
export function isSuperAdmin() { return false; }
export function getUser() { return { role: 'admin' }; }
export function getToken() { return 'stub'; }
export function setToken() {}
export function clearToken() {}
export function setAuth() {}
export function setRole() {}
export function clearRole() {}
export function clearUser() {}
export function clearAuth() {}
export function goLogin() {}
export function toastError(e) { throw e; }
export function downloadFile() { return Promise.resolve(); }
export function get(url, data) { return globalThis.__flow.request('GET', url, data); }
export function post(url, data) { return globalThis.__flow.request('POST', url, data); }
export function put(url, data) { return globalThis.__flow.request('PUT', url, data); }
export function patch(url, data) { return globalThis.__flow.request('PATCH', url, data); }
export function del(url, data) { return globalThis.__flow.request('DELETE', url, data); }
`;

const WORKSHOP_API_MOCK = `
export function newRequestId() { return 'tok_' + Math.random().toString(36).slice(2).padEnd(20, 'z'); }
export function apiGet() { return Promise.resolve({}); }
export function apiPost() { return Promise.resolve({ id: 'job-1' }); }
export function apiDelete() { return Promise.resolve({}); }
export function apiBlob() { return Promise.resolve({ path: '_doc/x.bin', size: 1, persistent: false }); }
export function uploadImage() { return Promise.resolve({ id: 'g-1' }); }
export function downloadBlob() { return Promise.resolve('已保存'); }
`;

const WORKSHOP_DB_MOCK = `
export function makeThumbnail(p) { return Promise.resolve(p); }
export function saveLocalImage() { return Promise.resolve(); }
export function listLocalImages() { return Promise.resolve([]); }
export function getLocalFile() { return Promise.resolve(null); }
export function updateLocalMeta() { return Promise.resolve(); }
export function deleteLocalImage() { return Promise.resolve(); }
`;

const WORKSHOP_PAYLOAD_MOCK = `
export function imageUrl(p) { return Promise.resolve(p && p.path ? p.path : ''); }
export function releaseImageUrl() {}
`;

// 风格提示词库(handraw)不属于本测试范围, 给个能跑的最小桩(其自身有
// handraw-library-flow.mjs 专门覆盖)。缺失的话页面脚本会解析不到模块。
const HANDRAW_MOCK = `
export const HANDRAW_GROUPS = [];
export const HANDRAW_TOTAL = 0;
export const HANDRAW_SOURCE = { repo: '' };
export function countByGroup() { return {}; }
export function filterStyles() { return []; }
export function stylePhrase() { return ''; }
export function styleThumbPath() { return ''; }
export function buildStylePrompt() { return ''; }
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

const tmpDir = path.resolve('app/.dsh-workshop-oriental-flow');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

let inst = null;

try {
  const pageFile = path.resolve('app/src/pages/workshop/workshop.vue');
  const source = fs.readFileSync(pageFile, 'utf8');
  const { descriptor, errors } = sfc.parse(source, { filename: pageFile, pad: 'space' });
  if (errors.length) throw new Error('SFC 解析失败: ' + errors[0].message);

  const readUtil = (p) => fs.readFileSync(path.resolve('app/src/utils', p), 'utf8');
  const wrap = (code) => JSON.stringify(durl(code));

  // oriental-prompt 用**真实源码**(它不依赖 uni), 默认值与拼句都按真代码跑;
  // 复制成 .mjs 是为了避开 app/package.json 没写 type:module 的告警。
  const orientalPath = path.join(tmpDir, 'oriental-prompt.mjs');
  fs.copyFileSync(path.resolve('app/src/utils/oriental-prompt.js'), orientalPath);
  const orientalUrl = pathToFileURL(orientalPath).href;

  const script = descriptor.script.content
    .replace(/'@\/utils\/api'/g, wrap(API_MOCK))
    .replace(/'@\/utils\/h5'/g, wrap(readUtil('h5.js')))
    .replace(/'@\/utils\/workshop-api'/g, wrap(WORKSHOP_API_MOCK))
    .replace(/'@\/utils\/workshop-db'/g, wrap(WORKSHOP_DB_MOCK))
    .replace(/'@\/utils\/workshop-payload'/g, wrap(WORKSHOP_PAYLOAD_MOCK))
    .replace(/'@\/utils\/oriental-prompt'/g, JSON.stringify(orientalUrl))
    .replace(/'@\/utils\/handraw-prompt'/g, wrap(HANDRAW_MOCK));

  for (const leftover of [
    '@/utils/api',
    '@/utils/workshop-api',
    '@/utils/workshop-db',
    '@/utils/workshop-payload',
    '@/utils/oriental-prompt',
    '@/utils/handraw-prompt',
  ]) {
    if (script.includes(leftover)) throw new Error(`${leftover} 的导入没替换成功`);
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

  const nextTick = () => vue.nextTick();
  const prompt = await import(orientalUrl);

  // 一个"能用"的服务端配置, 让 generateDisabled 只反映门禁本身
  inst.config = {
    enabled: true,
    can_create: true,
    role: 'admin',
    model: 'Kwai-Kolors/Kolors',
    image_size: '1024x1024',
    local_namespace: 'ns',
    daily_used: 0,
    daily_limit: 0,
    daily_unlimited: true,
    quota: { total: 0, actor: 0, ip: 0, total_limit: 200, actor_limit: 10, ip_limit: 10 },
  };

  section('1. 默认服装与配饰(纯函数层)');
  {
    const form = prompt.createOrientalForm();
    checkEq('默认值就是指定内容', form.outfit, EXPECTED_OUTFIT);
    check(
      prompt.charCount(form.outfit) <= 140,
      `默认值 ${prompt.charCount(form.outfit)} 字, 未超过输入框/校验上限 140`
    );
    check(
      form.outfit.indexOf('【') === -1 && form.outfit.indexOf('】') === -1,
      '默认值里不含【】(cleanField 会抹掉, 写了会让输入框与实际提示词不一致)'
    );
    check(!form.outfit.endsWith('。'), '默认值末尾没有句号(否则会拼出 "。，")');

    const built = prompt.buildOrientalPrompt(form);
    check(built.prompt.includes(EXPECTED_OUTFIT), '生成的提示词里包含这段服装描述');
    check(built.prompt.indexOf('。，') === -1, '拼句没有出现 "。，" 这类重复标点');
    check(built.prompt.length <= prompt.PROMPT_LIMIT, `整段提示词 ${built.prompt.length} 字, 未超后端上限`);
    check(built.prompt.includes('【角色细节】'), '五段结构仍然完整');
  }

  section('2. 东方幻境: 直接自己写提示词就能生成(本次修复的 bug)');
  {
    await inst.switchCreationMode('oriental');
    await nextTick();

    checkEq('切到东方幻境后, 提示词被清空', inst.prompt, '');
    checkEq('切模式后来源标记为空', inst.promptSource, '');
    check(inst.orientalNeedsApply === true, '此时确实处于"设定尚未应用"(还没整理提示词)');
    check(inst.generateDisabled === true, '此时「开始生成」是灰的(符合原设计)');

    // 用户不点按钮, 直接在最终提示词里写内容
    inst.prompt = '一位成年东方女性，倚坐窗前，白色半透明轻纱长裙，暖光柔焦';
    inst.onPromptEdited();
    await nextTick();

    checkEq('写完后来源标记为 manual', inst.promptSource, 'manual');
    check(
      inst.orientalNeedsApply === false,
      '自己写了提示词就不再算"设定未应用"(修复点)'
    );
    check(
      inst.generateDisabled === false,
      '「开始生成」变为可点(修复点; 修复前这里恒为 true)'
    );
  }

  section('3. 自己写过的提示词不再被设定改动卡住');
  {
    inst.setOrientalOption('action', prompt.ORIENTAL_ACTIONS[3].value);
    await nextTick();
    await nextTick();

    check(
      inst.orientalConfigRevision !== inst.orientalAppliedRevision,
      '改设定确实让 revision 变了(否则下面的断言没意义)'
    );
    check(inst.orientalNeedsApply === false, '手动模式下参数变动不再拦人');
    check(inst.generateDisabled === false, '「开始生成」仍然可点');
    check(inst.prompt.includes('白色半透明轻纱'), '自己写的内容没有被自动覆盖');
  }

  section('4. 点「整理提示词」后, 原设计仍然生效');
  {
    await inst.applyOrientalPrompt();
    await nextTick();

    checkEq('来源标记回到 generated', inst.promptSource, 'generated');
    checkEq(
      '整理后 revision 对齐',
      inst.orientalAppliedRevision,
      inst.orientalConfigRevision
    );
    check(inst.orientalNeedsApply === false, '整理完不再提示"尚未应用"');
    check(inst.prompt.includes(EXPECTED_OUTFIT), '整理出来的提示词用了新的默认服装');
    check(inst.generateDisabled === false, '整理后可以生成');

    // 生成式提示词一旦再改设定, 仍然要求重新整理(原设计)
    inst.setOrientalOption('scene', '雨夜竹林，冷色侧光');
    await nextTick();
    await nextTick();
    check(inst.orientalNeedsApply === true, '生成式提示词 + 改设定 -> 仍要求重新整理');
    check(inst.generateDisabled === true, '此时「开始生成」重新变灰(原设计未被破坏)');
  }

  section('5. 切模式清理干净');
  {
    inst.prompt = '随便写点';
    inst.onPromptEdited();
    await inst.switchCreationMode('general');
    await nextTick();
    checkEq('切回通用创作后来源标记清空', inst.promptSource, '');
    checkEq('提示词也清空', inst.prompt, '');
    check(inst.orientalNeedsApply === false, '通用模式不受东方幻境门禁影响');
  }

  section('6. 模板接线');
  {
    const src = fs.readFileSync(pageFile, 'utf8');
    check(
      /v-model="prompt"[\s\S]{0,220}@input="onPromptEdited"/.test(src),
      '最终提示词的 textarea 上挂了 @input="onPromptEdited"'
    );
    check(src.includes('promptSource: \'\''), 'data 里有 promptSource 初值');
    check(
      !/orientalNeedsApply\(\) \{\s*return \(\s*this\.creationMode === 'oriental' &&\s*this\.orientalConfigRevision !== this\.orientalAppliedRevision\s*\)/.test(
        src
      ),
      'orientalNeedsApply 已经带上 promptSource 判断'
    );
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
