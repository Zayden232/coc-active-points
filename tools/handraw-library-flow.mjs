// ============================================================
// 创作工坊 · 风格提示词库(handraw-style 261 种手绘风格)
// 用法: node tools/handraw-library-flow.mjs
//
// 覆盖:
//   1) 数据完整性: 261 条、7 类、区间连续、编号不重不漏
//   2) 纯函数: 分类/关键词过滤、编号查找、填入短语、复制文案(含无特征兜底)
//   3) 页面接线: 弹层开关、分类切换(再点一次回全部)、分批渲染、
//      「填入提示词」是追加而不是覆盖、复制走剪贴板、模板上的绑定都在
//
// 做法与 workshop-oriental-flow.mjs 相同: 编译 SFC → createRenderer 极简节点操作真渲染
// → 抓住页面实例直接驱动方法/computed。handraw-prompt.js / handraw-styles.js 用
// **真实模块**(它们不依赖 uni), 所以过滤与文案都是真跑的。
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

const stub = { toasts: [], modals: [], clipboard: [], clipboardRead: '', clipboardReadFail: false };

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
  setClipboardData: (o) => {
    stub.clipboard.push(o && o.data);
    if (o && o.success) o.success();
  },
  // 读剪贴板: 由 stub.clipboardRead / stub.clipboardReadFail 控制
  getClipboardData: (o) => {
    if (stub.clipboardReadFail) {
      if (o && o.fail) o.fail({ errMsg: 'getClipboardData:fail' });
      return;
    }
    if (o && o.success) o.success({ data: stub.clipboardRead });
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

const tmpDir = path.resolve('app/.dsh-handraw-library-flow');
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

  // 风格库用**真实源码**: 数据在 handraw-styles.js + handraw-prompts.js, 逻辑在 handraw-prompt.js。
  // 复制成 .mjs 是为了避开 app/package.json 没写 type:module 的告警。
  fs.copyFileSync(
    path.resolve('app/src/utils/handraw-styles.js'),
    path.join(tmpDir, 'handraw-styles.mjs')
  );
  fs.copyFileSync(
    path.resolve('app/src/utils/handraw-prompts.js'),
    path.join(tmpDir, 'handraw-prompts.mjs')
  );
  fs.writeFileSync(
    path.join(tmpDir, 'handraw-prompt.mjs'),
    readUtil('handraw-prompt.js')
      .replace("'./handraw-styles.js'", "'./handraw-styles.mjs'")
      .replace("'./handraw-prompts.js'", "'./handraw-prompts.mjs'"),
    'utf8'
  );
  const handrawUrl = pathToFileURL(path.join(tmpDir, 'handraw-prompt.mjs')).href;

  const script = descriptor.script.content
    .replace(/'@\/utils\/api'/g, wrap(API_MOCK))
    .replace(/'@\/utils\/h5'/g, wrap(readUtil('h5.js')))
    .replace(/'@\/utils\/workshop-api'/g, wrap(WORKSHOP_API_MOCK))
    .replace(/'@\/utils\/workshop-db'/g, wrap(WORKSHOP_DB_MOCK))
    .replace(/'@\/utils\/workshop-payload'/g, wrap(WORKSHOP_PAYLOAD_MOCK))
    .replace(/'@\/utils\/oriental-prompt'/g, wrap(readUtil('oriental-prompt.js')))
    .replace(/'@\/utils\/handraw-prompt'/g, JSON.stringify(handrawUrl));

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
  const handraw = await import(handrawUrl);

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
  };

  section('1. 数据完整性(261 条 / 7 类)');
  {
    checkEq('HANDRAW_TOTAL', handraw.HANDRAW_TOTAL, 261);
    checkEq('HANDRAW_STYLES 条数', handraw.HANDRAW_STYLES.length, 261);
    checkEq('分类数', handraw.HANDRAW_GROUPS.length, 7);

    const expect = [
      ['A', '001', '035', 35],
      ['B', '036', '054', 19],
      ['C', '055', '082', 28],
      ['D', '083', '123', 41],
      ['E', '124', '154', 31],
      ['F', '155', '200', 46],
      ['G', '201', '261', 61],
    ];
    for (const [id, from, to, count] of expect) {
      const group = handraw.groupById(id);
      check(!!group, `分类 ${id} 存在`);
      if (!group) continue;
      checkEq(`${id} 起始编号`, group.from, from);
      checkEq(`${id} 结束编号`, group.to, to);
      checkEq(`${id} 条数`, group.count, count);
      checkEq(`${id} 实时统计`, handraw.countByGroup()[id], count);
      check(
        typeof group.short === 'string' && group.short.includes('·') && group.short.length <= 14,
        `${id} 有页面用的短名(两个关键词):${group.short}`
      );
      checkEq(`${id} groupLabel`, handraw.groupLabel(id), `${id} · ${group.short}（${from}–${to}）`);
      checkEq(`${id} groupShort`, handraw.groupShort(id), group.short);
    }
    checkEq(
      '分类短名没有重复',
      new Set(handraw.HANDRAW_GROUPS.map((g) => g.short)).size,
      7
    );

    const numbers = handraw.HANDRAW_STYLES.map((s) => s.number);
    checkEq('编号无重复', new Set(numbers).size, 261);
    let contiguous = true;
    for (let i = 1; i <= 261; i += 1) {
      if (!numbers.includes(String(i).padStart(3, '0'))) contiguous = false;
    }
    check(contiguous, '编号 001–261 连续不缺号');
    check(
      handraw.HANDRAW_STYLES.every((s) => s.reference && s.name && s.group),
      '每条都有作者、风格名与分类'
    );
    check(
      handraw.HANDRAW_STYLES.filter((s) => !s.traits).length === 16,
      '上游 201–216 共 16 条没有核心特征(其余 245 条都有)'
    );
    check(
      handraw.HANDRAW_SOURCE.repo.includes('handraw-style'),
      '数据里留了上游仓库地址(署名)'
    );
  }

  section('1b. 备好提示词(261 条规则拼装)');
  {
    const slot = handraw.HANDRAW_PROMPT_SLOT;
    const prompts = handraw.HANDRAW_PROMPTS;
    checkEq('提示词条数', handraw.HANDRAW_PROMPT_COUNT, 261);
    checkEq('提示词键数', Object.keys(prompts).length, 261);
    checkEq('占位符', slot, '[这里写主体]');

    const keys = Object.keys(prompts);
    let allNumbers = true;
    for (let i = 1; i <= 261; i += 1) {
      if (!keys.includes(String(i).padStart(3, '0'))) allNumbers = false;
    }
    check(allNumbers, '001–261 每条都有备好提示词');

    const texts = Object.values(prompts);
    check(
      texts.every((t) => t.startsWith(slot)),
      '每条都以 [这里写主体] 占位开头(用户先改这一句)'
    );
    const lengths = texts.map((t) => t.length);
    check(
      Math.max(...lengths) <= 500,
      `最长 ${Math.max(...lengths)} 字(远低于描述框 1000 字上限)`
    );
    check(Math.min(...lengths) >= 90, `最短 ${Math.min(...lengths)} 字(不是空架子)`);
    checkEq('没有重复的提示词', new Set(texts).size, 261);
    check(
      handraw.HANDRAW_STYLES.every((s) => prompts[s.number].includes(s.name)),
      '每条提示词都带上了自己的风格名'
    );
    check(
      handraw.HANDRAW_STYLES.every((s) => prompts[s.number].includes(s.reference)),
      '每条提示词都带上了参考作者'
    );
    check(
      handraw.HANDRAW_STYLES.every(
        (s) => !s.traits || prompts[s.number].includes(s.traits.replace(/[。.；;,，、]+$/, ''))
      ),
      '有核心特征的条目把特征整段写进去了'
    );
    check(
      prompts['001'].includes('画面中不出现任何文字'),
      '结尾统一带"不出现文字"这类要求'
    );
    check(
      prompts['201'].includes(handraw.HANDRAW_TRAITS_FALLBACK),
      '没有核心特征的 201 用兜底句(与 handraw-prompt.js 的兜底句一致)'
    );
    check(!texts.some((t) => t.includes('undefined')), '没有 undefined 混进文案');

    const s001 = handraw.findStyle('001');
    checkEq('styleFillText 用备好的那条', handraw.styleFillText(s001), prompts['001']);
    checkEq('hasStylePrompt("001")', handraw.hasStylePrompt('001'), true);
    check(
      handraw.styleFillText({ number: '999', name: 'X', reference: 'Y', traits: 'Z' }).includes(
        '手绘风格「X」'
      ),
      '没有备好提示词时退回短句(不会填入空内容)'
    );
    checkEq('hasStylePrompt("999")', handraw.hasStylePrompt('999'), false);
  }

  section('2. 纯函数: 过滤 / 查找 / 文案');
  {
    checkEq('按分类 G', handraw.filterStyles({ group: 'G' }).length, 61);
    checkEq('按分类 c(小写也要认)', handraw.filterStyles({ group: 'c' }).length, 28);
    checkEq('分类 + limit', handraw.filterStyles({ group: 'A', limit: 10 }).length, 10);

    const n41 = handraw.filterStyles({ keyword: '041' });
    checkEq('关键词 041 命中 1 条', n41.length, 1);
    checkEq('命中的就是 041', n41[0] && n41[0].number, '041');
    check(handraw.filterStyles({ keyword: '41' }).length >= 1, '只写 41 也能命中');
    check(
      handraw.filterStyles({ keyword: 'gemma correll' }).some((s) => s.number === '001'),
      '关键词按作者名(不区分大小写)命中 001'
    );
    check(handraw.filterStyles({ keyword: '水彩' }).length > 0, '关键词能搜中文特征(水彩)');
    check(handraw.filterStyles({ keyword: '国际社论' }).length === 35, '关键词能搜分类全名');
    check(handraw.filterStyles({ keyword: '水墨国风' }).length === 31, '关键词能搜分类短名');
    check(handraw.filterStyles({ keyword: '治愈绘本' }).length === 61, '短名(两个关键词)也能搜');
    checkEq('搜不到就是空', handraw.filterStyles({ keyword: 'zzzz-不存在' }).length, 0);

    checkEq('findStyle("001") 的名字', handraw.findStyle('001').name, 'Playful Deadpan Doodle');
    checkEq('findStyle(41) 数字也能查', handraw.findStyle(41).number, '041');
    checkEq('findStyle 查不到返回 null', handraw.findStyle('999'), null);

    const s41 = handraw.findStyle('041');
    const phrase = handraw.stylePhrase(s41);
    check(phrase.includes(`手绘风格「${s41.name}」`), '填入短语带风格名');
    check(phrase.includes(`参考 ${s41.reference}`), '填入短语带参考作者');
    check(phrase.includes(s41.traits.slice(0, 12)), '填入短语带核心特征');

    const copy = handraw.buildStylePrompt(s41);
    check(copy.includes(`【手绘风格 041 · ${s41.name}】`), '复制文案带编号与风格名');
    check(copy.includes(`参考作者：${s41.reference}`), '复制文案带参考作者');
    check(copy.includes('核心视觉特征：'), '复制文案带核心特征');
    check(copy.includes('主题：'), '复制文案留了主题那一行');
    check(copy.includes('English style hint'), '复制文案带英文风格名(给英文模型)');
    check(
      handraw.buildStylePrompt(s41).includes(handraw.HANDRAW_THEME_PLACEHOLDER),
      '主题留占位提示(弹层里不再单独问主题)'
    );
    check(!handraw.buildStylePrompt(s41).includes('undefined'), '复制文案里不出现 undefined');

    // 参考图路径: 页面用它拼 <image src>
    checkEq('styleThumbPath("041")', handraw.styleThumbPath('041'), '/static/style-thumbs/041.webp');
    checkEq('styleThumbPath(1) 也能补零', handraw.styleThumbPath(1), '/static/style-thumbs/001.webp');
    checkEq('styleThumbPath("12") 补成 012', handraw.styleThumbPath('12'), '/static/style-thumbs/012.webp');
    checkEq('styleThumbPath 非法输入返回空', handraw.styleThumbPath('abc'), '');
    checkEq('styleThumbPath 空值返回空', handraw.styleThumbPath(null), '');

    const s201 = handraw.findStyle('201');
    checkEq('201 确实没有核心特征', s201.traits, '');
    check(
      handraw.buildStylePrompt(s201).includes(handraw.HANDRAW_TRAITS_FALLBACK),
      '无特征的条目用兜底句, 不是空白'
    );
    check(handraw.buildStylePrompt(s201).includes('阿梗'), '201 仍然带参考作者');
  }

  section('3. 页面接线: 打开 / 过滤 / 分批');
  {
    checkEq('初始不显示弹层', inst.styleLibraryOpen, false);
    checkEq('data 里的总数', inst.styleTotal, 261);

    inst.openStyleLibrary();
    await nextTick();
    checkEq('点开后弹层显示', inst.styleLibraryOpen, true);
    checkEq('默认「全部」命中 261 条', inst.styleMatches.length, 261);
    checkEq('首批只渲染 30 条', inst.styleVisible.length, 30);
    checkEq('还有 231 条待展开', inst.styleMore, 231);

    inst.showMoreStyles();
    await nextTick();
    checkEq('点「继续显示」后渲染 60 条', inst.styleVisible.length, 60);
    checkEq('剩余 201 条', inst.styleMore, 201);

    // 分类按钮上的计数来自数据本身
    checkEq('分类页签数量', inst.styleGroupTabs.length, 7);
    checkEq('G 类页签计数', inst.styleGroupTabs.find((g) => g.id === 'G').count, 61);

    inst.pickStyleGroup('D');
    await nextTick();
    checkEq('切到 D 类命中 41 条', inst.styleMatches.length, 41);
    check(
      inst.styleMatches.every((s) => s.group === 'D'),
      'D 类里只有 D 类的条目'
    );
    checkEq('切分类后回到第一批(30)', inst.styleLimit, 30);
    check(inst.styleGroupName.startsWith('D · 日系日常'), `分类名展示短名:「${inst.styleGroupName}」`);

    inst.pickStyleGroup('D');
    await nextTick();
    checkEq('再点同一分类回到全部', inst.styleGroup, '');
    checkEq('回到全部后 261 条', inst.styleMatches.length, 261);

    inst.pickStyleGroup('G');
    inst.styleKeyword = '216';
    await nextTick();
    await nextTick();
    checkEq('分类 + 关键词一起生效', inst.styleMatches.length, 1);
    checkEq('命中的是 216', inst.styleMatches[0].number, '216');
    checkEq('搜索后回到第一批(搜索词由 watch 重置分页)', inst.styleLimit, 30);
    checkEq('搜索后可以看到全部结果', inst.styleVisible.length, 1);

    // 搜索词清空后分页也回到 30
    inst.showMoreStyles();
    await nextTick();
    checkEq('先展开到 60', inst.styleLimit, 60);
    inst.styleKeyword = '04';
    await nextTick();
    checkEq('换关键词后回到第一批(30)', inst.styleLimit, 30);

    inst.pickStyleGroup('G');
    inst.styleKeyword = '';
    await nextTick();

    inst.styleKeyword = 'zzzz';
    await nextTick();
    checkEq('搜不到时列表为空', inst.styleMatches.length, 0);
    checkEq('空结果不显示「继续显示」', inst.styleMore, 0);
    inst.styleKeyword = '';
    await nextTick();
  }

  section('4. 填入提示词(填备好的完整提示词; 已有内容要先确认替换)');
  {
    inst.prompt = '';
    inst.promptSource = '';
    inst.styleLibraryOpen = true;
    inst.clearStyleState();
    const style = handraw.findStyle('001');

    await inst.useStylePrompt(style);
    await nextTick();
    checkEq('空描述框: 直接填入备好的提示词', inst.prompt, handraw.HANDRAW_PROMPTS['001']);
    check(inst.prompt.startsWith('[这里写主体]'), '填入的内容开头就是主体占位');
    check(inst.prompt.includes('Playful Deadpan Doodle'), '带风格名');
    checkEq('填入后标记为 manual(东方幻境不会再拦)', inst.promptSource, 'manual');
    checkEq('填入后自动关掉弹层', inst.styleLibraryOpen, false);
    check(
      stub.toasts.some((t) => t.includes('001')),
      '填入后有提示(带编号)'
    );
    const filled = inst.prompt;

    // 描述框里已有内容: 第一次点只提醒, 点击不变更内容
    inst.prompt = '一只守护部落的小龙，穿金色铠甲';
    inst.styleLibraryOpen = true;
    await inst.useStylePrompt(handraw.findStyle('041'));
    await nextTick();
    checkEq('已有内容时第一次点不覆盖', inst.prompt, '一只守护部落的小龙，穿金色铠甲');
    checkEq('记下"待确认替换的是哪一条"', inst.stylePendingReplace, '041');
    checkEq('提醒的语气是 warn', inst.styleNoticeKind, 'warn');
    check(
      inst.styleNotice.includes('确认替换') && inst.styleNotice.includes('041'),
      `提醒里说清了再点一次会替换:「${inst.styleNotice}」`
    );

    // 再点一次(同一条)才真的替换
    await inst.useStylePrompt(handraw.findStyle('041'));
    await nextTick();
    checkEq('再点一次才替换成备好提示词', inst.prompt, handraw.HANDRAW_PROMPTS['041']);
    check(
      !inst.prompt.includes('穿金色铠甲'),
      '替换是整体替换(旧的主体描述不再残留)'
    );
    checkEq('替换后清掉待确认状态', inst.stylePendingReplace, '');
    checkEq('替换后弹层也关掉', inst.styleLibraryOpen, false);

    // 待确认时改点另一条: 提醒跟着换到新的那条
    inst.prompt = '随便写点东西';
    inst.styleLibraryOpen = true;
    await inst.useStylePrompt(handraw.findStyle('010'));
    await nextTick();
    await inst.useStylePrompt(handraw.findStyle('012'));
    await nextTick();
    checkEq('改点另一条时待确认跟着换', inst.stylePendingReplace, '012');
    check(
      inst.styleNotice.includes('012'),
      `提醒里的编号也跟着换:「${inst.styleNotice}」`
    );

    // 关弹层/换分类/换关键词都会把待确认清掉
    inst.closeStyleLibrary();
    checkEq('关弹层清掉待确认', inst.stylePendingReplace, '');
    checkEq('关弹层清掉提醒', inst.styleNotice, '');

    // 内容已经是同一条提示词时不算替换, 不再啰嗦
    inst.prompt = handraw.HANDRAW_PROMPTS['001'];
    inst.styleLibraryOpen = true;
    await inst.useStylePrompt(handraw.findStyle('001'));
    await nextTick();
    checkEq('重复填同一条不会弹提醒', inst.stylePendingReplace, '');
    checkEq('也不改变内容', inst.prompt, handraw.HANDRAW_PROMPTS['001']);

    // 超长保护: textarea maxlength=1000
    inst.prompt = '龙'.repeat(995);
    inst.stylePendingReplace = '001';
    await inst.useStylePrompt(handraw.findStyle('001'));
    await nextTick();
    check(inst.prompt.length <= 1000, `填入后不超过 1000 字(实际 ${inst.prompt.length})`);

    // 生成中不允许改提示词
    inst.prompt = '';
    inst.busy = true;
    inst.styleLibraryOpen = false;
    inst.openStyleLibrary();
    checkEq('生成中打不开弹层', inst.styleLibraryOpen, false);
    inst.busy = false;

    check(filled.length > 100, '填入的是完整提示词(不是原来那句短描述)');
  }

  section('5. 复制画风到其它 AI（弹层里必须看得见反馈）');
  {
    stub.clipboard.length = 0;
    stub.toasts.length = 0;
    const style = handraw.findStyle('010');

    inst.copyStylePrompt(style);
    checkEq('复制走的是剪贴板接口', stub.clipboard.length, 1);
    const text = stub.clipboard[0] || '';
    check(text.includes('【手绘风格 010 · Geometric Literary Deadpan】'), '复制的文案带编号与风格名');
    check(text.includes('参考作者：Tom Gauld'), '复制的文案带参考作者');
    check(text.includes('核心视觉特征：'), '复制的文案带核心特征');
    check(text.includes(handraw.HANDRAW_THEME_PLACEHOLDER), '主题那行是占位提示');
    checkEq('记下"刚复制的是哪一条"(按钮要变「已复制 ✓」)', inst.styleCopied, '010');
    check(
      inst.styleNotice.includes('已复制到剪贴板') && inst.styleNotice.includes('010'),
      `弹层里有可见的复制提示:「${inst.styleNotice}」`
    );
    checkEq('复制提示是 ok 语气', inst.styleNoticeKind, 'ok');
    inst.clearStyleNotice();
    checkEq('提示可以清掉', inst.styleNotice, '');
    checkEq('清掉提示后按钮状态也复位', inst.styleCopied, '');

    // 换一条复制: 反馈跟着换过去
    inst.copyStylePrompt(handraw.findStyle('011'));
    checkEq('反馈换成新的编号', inst.styleCopied, '011');
    check(!inst.styleNotice.includes('010'), '上一条的提示不残留');

    // 没有剪贴板能力时也要给出可操作提示, 而不是静默失败
    const keep = globalThis.uni.setClipboardData;
    delete globalThis.uni.setClipboardData;
    inst.clearStyleNotice();
    inst.copyStylePrompt(style);
    check(inst.styleNotice.includes('长按'), '剪贴板不可用时提示手动复制');
    checkEq('这条是 warn 语气', inst.styleNoticeKind, 'warn');
    globalThis.uni.setClipboardData = keep;
    inst.clearStyleState();

    // 复制的是 skill 原生文案, 与「填入」的备好提示词是两码事
    check(
      text !== handraw.HANDRAW_PROMPTS['010'] && text.startsWith('【手绘风格 010'),
      '复制内容仍然是 skill 原生文案(不是备好的那条提示词)'
    );
  }

  section('6. 参考图（缩略图 + 点开大图）');
  {
    checkEq('缩略图路径', inst.styleThumb('001'), '/static/style-thumbs/001.webp');
    checkEq('缺图编号不会拼出路径', inst.styleThumb('nope'), '');

    const item = handraw.findStyle('001');
    checkEq('初始没有大图预览', inst.stylePreview, null);
    inst.previewStyle(item);
    check(inst.stylePreview && inst.stylePreview.url.endsWith('/001.webp'), '点缩略图打开大图');
    checkEq('大图标题用编号', inst.stylePreview.number, '001');
    inst.closeStylePreview();
    checkEq('关掉大图', inst.stylePreview, null);

    // 图不存在时(没跑生成脚本)不弹大图
    inst.onStyleThumbError('001');
    checkEq('加载失败被记下', inst.styleThumbBroken['001'], true);
    inst.previewStyle(item);
    checkEq('加载失败的条目不再弹大图', inst.stylePreview, null);
    inst.styleThumbBroken = {};
  }

  section('7. 点 ✎ 用剪贴板内容替换描述');
  {
    const nextTick2 = () => nextTick();
    const tick = async () => {
      await nextTick2();
      await nextTick2();
    };

    // 正常: 整体替换(包括把 \r\n 规整成 \n)
    stub.toasts.length = 0;
    stub.clipboardReadFail = false;
    stub.clipboardRead = '一只在雪地里点鞭炮的小男孩，红色棉袄\r\n卡通插画';
    inst.prompt = '这是要被替换掉的旧描述';
    inst.promptSource = 'generated';
    await inst.pastePromptFromClipboard();
    await tick();
    checkEq(
      '描述被整体替换',
      inst.prompt,
      '一只在雪地里点鞭炮的小男孩，红色棉袄\n卡通插画'
    );
    check(!inst.prompt.includes('旧描述'), '旧内容没有残留');
    checkEq('粘贴后标记为 manual', inst.promptSource, 'manual');
    check(
      stub.toasts.some((t) => t.includes('替换原描述')),
      `有「已粘贴」提示:「${stub.toasts[stub.toasts.length - 1]}」`
    );

    // 剪贴板里有换行/前后空格: 去掉首尾空白, 中间换行保留
    stub.clipboardRead = '\n\n  雪夜灯笼  \n';
    await inst.pastePromptFromClipboard();
    await tick();
    checkEq('首尾空白被去掉', inst.prompt, '雪夜灯笼');

    // 超长: 按 textarea 上限截断
    stub.toasts.length = 0;
    stub.clipboardRead = '龙'.repeat(1200);
    await inst.pastePromptFromClipboard();
    await tick();
    checkEq('超长内容截断到 1000 字', inst.prompt.length, 1000);
    check(
      stub.toasts.some((t) => t.includes('截断')),
      `提示里说明了截断:「${stub.toasts[stub.toasts.length - 1]}」`
    );

    // 剪贴板为空: 别把原来的描述清掉
    stub.toasts.length = 0;
    inst.prompt = '保留我';
    stub.clipboardRead = '   ';
    await inst.pastePromptFromClipboard();
    await tick();
    checkEq('剪贴板为空时不动原文', inst.prompt, '保留我');
    check(
      stub.toasts.some((t) => t.includes('没有文字')),
      `给了「剪贴板里没有文字」的提示:「${stub.toasts[stub.toasts.length - 1]}」`
    );

    // 读不到剪贴板(没有接口 / 没权限): 提示手动粘贴
    stub.toasts.length = 0;
    stub.clipboardReadFail = true;
    const keepUni = globalThis.uni;
    await inst.pastePromptFromClipboard();
    await tick();
    check(
      stub.toasts.some((t) => t.includes('长按')),
      `读不到剪贴板时提示手动粘贴:「${stub.toasts[stub.toasts.length - 1]}」`
    );
    stub.clipboardReadFail = false;
    check(!!keepUni, 'uni 桩仍在');

    // 生成中/提交中不许改描述
    inst.busy = true;
    inst.prompt = '别动我';
    stub.clipboardRead = '新内容';
    await inst.pastePromptFromClipboard();
    await tick();
    checkEq('生成中不响应粘贴', inst.prompt, '别动我');
    inst.busy = false;
  }

  section('8. 模板接线(改动都在页面上, 不依赖后端)');
  {
    const src = fs.readFileSync(pageFile, 'utf8');
    check(/@click="openStyleLibrary"/.test(src), '提示词卡片里有「风格提示词库」入口');
    check(/v-if="styleLibraryOpen"/.test(src), '弹层用 v-if 控制');
    check(/v-for="item in styleVisible"/.test(src), '列表按 styleVisible 分批渲染');
    check(/@click="pickStyleGroup\(group\.id\)"/.test(src), '分类页签可点');
    check(/group\.short/.test(src), '分类页签显示短名(两个代表子风格的关键词)');
    check(/library-tab-id/.test(src), '分类字母做成小角标');
    check(/@click="useStylePrompt\(item\)"/.test(src), '每条的「填入提示词」按钮');
    check(/@click="copyStylePrompt\(item\)"/.test(src), '每条的「复制画风」按钮');
    check(/v-model="styleKeyword"/.test(src), '搜索框绑定 styleKeyword');
    check(src.includes('style-entry-hint'), '入口下面有用法说明');
    check(/yang0\/handraw-style/.test(src), '弹层底部标了数据来源(第三方数据要署名)');
    check(!/^\s*<block>\s*$/m.test(src), '没有裸 <block>(会被编译成 <template>, 子节点不渲染)');

    // 这次修的两个问题
    check(!src.includes('styleTheme'), '主题输入框已去掉(只留一个搜索框)');
    check(
      !/@input="resetStyleList"/.test(src),
      'input 上不再挂 @input(与 v-model 同时挂在 App 端会导致打不进字)'
    );
    check(
      /styleKeyword\(\)\s*\{\s*this\.styleLimit = 30;\s*\}/.test(src),
      '改用 watch(styleKeyword) 重置分页'
    );
    check(/v-if="styleNotice"/.test(src), '复制/替换反馈在弹层里可见');
    check(/:class="\{ copied: styleCopied === item\.number \}"/.test(src), '复制的按钮会变成「已复制」');
    check(/:src="styleThumb\(item\.number\)"/.test(src), '列表里挂了参考图');
    check(/@click="previewStyle\(item\)"/.test(src), '点参考图可放大');
    check(/v-if="stylePreview"/.test(src), '大图弹层层级独立');
    check(
      !/uni\.showToast\(\{[^}]*已复制/.test(src),
      '复制反馈不依赖 showToast(它的层级比弹层低, 会被挡住)'
    );

    // ✎ 粘贴
    check(/@click="pastePromptFromClipboard"/.test(src), '✎ 挂了「粘贴剪贴板」');
    check(/class="prompt-symbol"/.test(src) && /<button[\s\S]{0,120}prompt-symbol/.test(src), '✎ 是可点的 button(不是纯文字)');
    check(!/<text class="prompt-symbol">/.test(src), '旧的纯文字 ✎ 已换掉');
    check(/getClipboardData/.test(src), '读剪贴板走 uni.getClipboardData');
    check(/clipboard\.readText/.test(src), 'H5 上退到 navigator.clipboard');
    check(/点右上角 ✎ 用剪贴板内容替换描述/.test(src), '描述框下面有用法提示');

    // 备好提示词 + 每条的标记
    check(/styleFillText/.test(src), '「填入提示词」用的是备好的完整提示词');
    check(!/stylePhrase/.test(src), '页面不再直接用短句版(短句只作兜底)');
    check(/library-tag/.test(src) && /item\.traits \? '已备好' : '简版'/.test(src), '每条带「已备好/简版」小标记');
    check(/确认替换/.test(src) && /stylePendingReplace/.test(src), '已有内容时第二次点击才替换');
    check(/v-if="styleNotice"/.test(src) && /styleNoticeKind === 'warn'/.test(src), '提醒与成功反馈用两种语气显示');
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
