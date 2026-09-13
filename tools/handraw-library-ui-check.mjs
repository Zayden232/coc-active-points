// ============================================================
// 创作工坊 · 风格提示词库 真浏览器 UI 检查(真点击, 不是假渲染)
// 用法: node tools/handraw-library-ui-check.mjs [baseUrl]   默认 http://localhost:5173
//
// 为什么还要这一层(已有 handraw-library-flow.mjs):
//   Node 渲染测试看不到 CSS, 也点不了真按钮; 而且 uni-app H5 有自己的坑
//   (裸 <block> 会被编译成 <template>、<button> 会变成 <uni-button>、scroll-view 会多包两层),
//   这些只有真浏览器能发现。这里真点「风格提示词库」入口 → 切分类 → 继续显示 → 填入提示词,
//   断言列表真的渲染出来、分批渲染生效、填入结果进了 textarea、没有横向溢出。
//
// 依赖: 后端 3000(提供 /api) + HBuilderX/Vite 的 dev server(默认 5173, 带 /api 代理)。
// ============================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const base = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');

let pass = 0;
const fails = [];
const check = (ok, msg) => {
  if (ok) {
    pass += 1;
    console.log('  ✓ ' + msg);
  } else {
    fails.push(msg);
    console.log('  ✗ ' + msg);
  }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-handraw-ui-'));
const stepsFile = path.join(tmp, 'steps.json');
const outFile = path.join(tmp, 'out.json');
const shotFile = path.resolve('.e2e-logs/shot-handraw-library.png');

// uni-app H5 会把 <textarea> 渲染成 <uni-textarea> 里套真的 <textarea>:
// class 在组件根节点上, 值要读里面那个真元素。
const SNAPSHOT = (label) => `(() => {
  const panel = document.querySelector('.library-panel');
  const items = [...document.querySelectorAll('.library-item')];
  const first = items[0];
  const text = (sel) => { const el = document.querySelector(sel); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : ''; };
  const box = (el) => (el ? el.getBoundingClientRect() : { width: 0, bottom: 0, right: 0 });
  const ta = document.querySelector('.prompt textarea') || document.querySelector('textarea');
  return {
    label: ${JSON.stringify(label)},
    entry: text('.style-entry'),
    entryVisible: !!document.querySelector('.style-entry'),
    hasPanel: !!panel,
    panelBottom: Math.round(box(panel).bottom),
    panelRight: Math.round(box(panel).right),
    itemCount: items.length,
    tabCount: document.querySelectorAll('.library-tab').length,
    tabTexts: [...document.querySelectorAll('.library-tab')].map((el) => el.textContent.replace(/\\s+/g, ' ').trim()),
    groupName: text('.library-group-name'),
    firstNumber: first ? first.querySelector('.library-number').textContent.trim() : '',
    firstName: first ? first.querySelector('.library-name').textContent.trim() : '',
    firstTraits: first ? first.querySelector('.library-traits').textContent.trim().slice(0, 18) : '',
    more: text('.library-more'),
    // uni-app H5 的 toast 是 .uni-sample-toast / .uni-simple-toast__text,
    // 不同版本类名不一样, 这里按 class 里带 toast 的元素统一收一遍。
    toast: [...document.querySelectorAll('[class*=toast]')]
      .map((el) => el.textContent.replace(/\\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' | '),
    emptyShown: !!document.querySelector('.library-empty'),
    promptValue: ta ? String(ta.value) : '',
    viewport: window.innerWidth,
    scrollWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
  };
})()`;

const steps = [
  { js: SNAPSHOT('刚进页面(还没点)') },
  { click: '.style-entry', after: 900 },
  { js: SNAPSHOT('点开风格提示词库') },
  // 分类页签: 第 1 个是「全部」, 第 8 个是 G 类(201–261, 61 条)
  { click: '.library-tab:nth-child(8)', after: 900 },
  { js: SNAPSHOT('切到 G 类(201–261, 61 条)') },
  { clickText: '继续显示，还有 31 条', after: 900 },
  { js: SNAPSHOT('点「继续显示」之后') },
  { shot: shotFile },
  { click: '.library-tab:nth-child(1)', after: 900 },
  { js: SNAPSHOT('切回「全部」') },
  // 真点一次「复制画风」: 看页面提示, 并尝试把剪贴板读回来核对内容
  { clickText: '复制画风', pick: 'first', after: 350 },
  { js: SNAPSHOT('点第一条的「复制画风」') },
  {
    js: `(async () => { try { return await navigator.clipboard.readText(); }
      catch (e) { return 'ERR:' + ((e && e.message) || e); } })()`,
  },
  { clickText: '填入提示词', pick: 'first', after: 900 },
  { js: SNAPSHOT('点第一条的「填入提示词」') },
];

fs.writeFileSync(stepsFile, JSON.stringify(steps), 'utf8');

console.log(`[handraw-ui] 目标: ${base}`);
console.log('[handraw-ui] 用 CDP 打开页面并真点击…');

try {
  execSync(
    `node tools/cdp-run.mjs --url="${base}/#/pages/workshop/workshop" --width=430 --height=1400 ` +
      `--wait=7000 --steps="${stepsFile}" --out="${outFile}"`,
    { stdio: 'inherit', maxBuffer: 1 << 26 }
  );
} catch (e) {
  console.log('CDP 运行失败(dev server 与后端起了吗?)');
}

const allResults = JSON.parse(fs.readFileSync(outFile, 'utf8')).results;
const snapshots = allResults
  .filter((r) => r.kind === 'js' && r.value && typeof r.value === 'object' && r.value.label)
  .map((r) => r.value);
// 中间那一步读剪贴板, 返回的是字符串不是快照对象
const clipboard = (allResults.find(
  (r) => r.kind === 'js' && typeof r.value === 'string'
) || {}).value;

console.log('\n== 断言 ==');
check(snapshots.length === 7, `拿到 7 个快照（实际 ${snapshots.length}）`);

const [before, opened, groupG, more, all, copied, filled] = snapshots;

if (before && opened && groupG && more && all && copied && filled) {
  check(before.entryVisible, '「风格提示词库」入口渲染出来了(工坊已连上后端)');
  check(
    /风格提示词库/.test(before.entry) && /261 种手绘风格/.test(before.entry),
    `入口文案:「${before.entry}」`
  );
  check(!before.hasPanel, '没点之前弹层不存在');

  check(opened.hasPanel, '点开后弹层渲染出来了');
  check(opened.itemCount === 30, `首批渲染 30 条（实际 ${opened.itemCount}）`);
  check(opened.tabCount === 8, `分类页签 8 个(全部 + A–G)（实际 ${opened.tabCount}）`);
  check(
    JSON.stringify(opened.tabTexts) ===
      JSON.stringify(['全部 261', 'A 35', 'B 19', 'C 28', 'D 41', 'E 31', 'F 46', 'G 61']),
    `页签文案与计数正确:「${opened.tabTexts.join(' / ')}」`
  );
  check(opened.firstNumber === '001', `第一条是 001（实际 ${opened.firstNumber}）`);
  check(
    opened.firstName === 'Playful Deadpan Doodle',
    `第一条风格名正确（实际 ${opened.firstName}）`
  );
  check(opened.firstTraits.length > 6, `第一条显示了核心特征（${opened.firstTraits}…）`);
  check(/全部风格/.test(opened.groupName), `默认展示全部分类:「${opened.groupName}」`);
  check(/还有 231 条/.test(opened.more), `提示还有 231 条:「${opened.more}」`);

  check(groupG.itemCount === 30, `切到 G 类仍分批发（${groupG.itemCount} 条）`);
  check(groupG.firstNumber === '201', `G 类第一条是 201（实际 ${groupG.firstNumber}）`);
  check(/附件新增/.test(groupG.groupName), `G 类标题正确:「${groupG.groupName}」`);
  check(/还有 31 条/.test(groupG.more), `G 类还有 31 条:「${groupG.more}」`);

  check(more.itemCount === 60, `「继续显示」后 60 条（实际 ${more.itemCount}）`);
  check(/还有 1 条/.test(more.more), `只剩 1 条:「${more.more}」`);

  check(all.firstNumber === '001', `切回「全部」回到第一批（${all.firstNumber}）`);
  check(all.itemCount === 30, `切回「全部」只有 30 条（${all.itemCount}）`);

  // 复制: 真点按钮, 看提示语; 无头浏览器允许读剪贴板时再核对内容
  check(copied.hasPanel, '点「复制画风」后弹层没有关掉(还能接着挑)');
  check(/复制/.test(copied.toast), `复制后有提示:「${copied.toast}」`);
  if (String(clipboard).startsWith('ERR:')) {
    console.log(`  · 剪贴板读不了(headless 权限): ${clipboard}`);
  } else {
    check(
      typeof clipboard === 'string' && clipboard.includes('【手绘风格 001'),
      `剪贴板里就是完整画风文案:「${String(clipboard).slice(0, 30)}…」`
    );
    check(
      String(clipboard).includes('English style hint'),
      '剪贴板文案里有给英文模型的风格名'
    );
  }

  check(!filled.hasPanel, '「填入提示词」后弹层自动关闭');
  check(
    filled.promptValue.includes('Playful Deadpan Doodle'),
    `填入的风格进了提示词框:「${filled.promptValue.slice(0, 40)}…」`
  );
  check(
    filled.promptValue.includes('手绘风格') && filled.promptValue.includes('参考 Gemma Correll'),
    '填入内容带画风说明与参考作者'
  );

  // 布局: 页面不能横向溢出, 弹层不能出屏
  check(
    opened.scrollWidth <= opened.viewport,
    `没有横向溢出（scrollWidth ${opened.scrollWidth} ≤ 视口 ${opened.viewport}）`
  );
  check(
    opened.panelRight <= opened.viewport,
    `弹层右边不出屏（${opened.panelRight} ≤ ${opened.viewport}）`
  );
  check(opened.panelBottom <= 1400, `弹层底部在视口内（${opened.panelBottom} ≤ 1400）`);
} else {
  check(false, '快照不完整, 后面的断言跳过');
}

console.log(`\n结果: ${pass} PASS / ${fails.length} FAIL`);
if (fs.existsSync(shotFile)) console.log(`截图: ${shotFile}`);
fs.rmSync(tmp, { recursive: true, force: true });
if (fails.length) {
  console.log('失败明细:');
  fails.forEach((f) => console.log('   - ' + f));
  process.exit(1);
}
