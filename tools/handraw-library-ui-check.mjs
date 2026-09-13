// ============================================================
// 创作工坊 · 风格提示词库 真浏览器 UI 检查(真点击 + 真键盘输入)
// 用法: node tools/handraw-library-ui-check.mjs [baseUrl]   默认 http://localhost:5173
//
// 为什么还要这一层(已有 handraw-library-flow.mjs):
//   Node 渲染测试看不到 CSS, 也点不了真按钮。这里专门盯三类"只有在真浏览器/真机才暴露"的问题:
//     1) 复制到底有没有可见反馈(uni.showToast 的 z-index 是 999, 比这个弹层低, 会被整个挡住);
//     2) 搜索框能不能真的打进字(v-model 与 @input 同时挂在 input 上时, App 端会互相打架);
//     3) 参考图有没有真的加载出来(缺图/路径不对时只是一个破图)。
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

// uni-app H5 会把 <textarea>/<input> 渲染成组件里再套真的表单元素,
// class 在组件根节点上, 值和 naturalWidth 要读里面那个真元素。
const SNAPSHOT = (label) => `(() => {
  const panel = document.querySelector('.library-panel');
  const items = [...document.querySelectorAll('.library-item')];
  const first = items[0];
  const text = (sel) => { const el = document.querySelector(sel); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : ''; };
  const box = (el) => (el ? el.getBoundingClientRect() : { width: 0, bottom: 0, right: 0 });
  const inner = (sel) => { const el = document.querySelector(sel); return el ? (el.querySelector('input') || el) : null; };
  const thumbs = [...document.querySelectorAll('.library-thumb')];
  const status = document.querySelector('.library-status');
  let statusHit = '';
  let statusVisible = false;
  if (status) {
    const r = status.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    statusVisible = !!hit && (hit === status || status.contains(hit));
    statusHit = hit ? String(hit.className || hit.tagName) : '';
  }
  const copyBtn = [...document.querySelectorAll('.library-action.primary')][0];
  return {
    label: ${JSON.stringify(label)},
    entryVisible: !!document.querySelector('.style-entry'),
    hasPanel: !!panel,
    panelBottom: Math.round(box(panel).bottom),
    panelRight: Math.round(box(panel).right),
    itemCount: items.length,
    inputCount: document.querySelectorAll('.library-input').length,
    searchValue: inner('.library-search') ? String(inner('.library-search').value) : '',
    tabTexts: [...document.querySelectorAll('.library-tab')].map((el) => el.textContent.replace(/\\s+/g, ' ').trim()),
    groupName: text('.library-group-name'),
    firstNumber: first ? first.querySelector('.library-number').textContent.trim() : '',
    firstName: first ? first.querySelector('.library-name').textContent.trim() : '',
    more: text('.library-more'),
    statusText: text('.library-status'),
    statusHit,
    statusVisible,
    copyButtonText: copyBtn ? copyBtn.textContent.replace(/\\s+/g, ' ').trim() : '',
    thumbCount: thumbs.length,
    thumbLoaded: thumbs.filter((el) => el.naturalWidth > 0 || (el.querySelector && el.querySelector('img') && el.querySelector('img').naturalWidth > 0)).length,
    viewerOpen: !!document.querySelector('.style-viewer'),
    promptValue: (() => { const ta = document.querySelector('.prompt textarea') || document.querySelector('textarea'); return ta ? String(ta.value) : ''; })(),
    viewport: window.innerWidth,
    scrollWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
  };
})()`;

// 搜索框内容清掉(测试用: 程序化清空比再来一轮键盘输入稳)
const CLEAR_SEARCH = `(() => {
  const el = document.querySelector('.library-search input');
  if (!el) return 'no-input';
  el.value = '';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'cleared';
})()`;

const steps = [
  { js: SNAPSHOT('刚进页面(还没点)') },
  { click: '.style-entry', after: 1200 },
  { js: SNAPSHOT('点开风格提示词库') },
  // 真键盘输入: 只输编号, 列表应该立刻收敛到那一条
  { insertText: { selector: '.library-search input', text: '041' }, after: 900 },
  { js: SNAPSHOT('搜索框里真打 041') },
  { js: CLEAR_SEARCH, after: 600 },
  { js: SNAPSHOT('清空搜索') },
  // 参考图: 点第一条的缩略图 → 弹大图 → 关掉
  { click: '.library-thumb-box', after: 900 },
  { js: SNAPSHOT('点开参考图') },
  { click: '.style-viewer-close', after: 600 },
  { js: SNAPSHOT('关掉参考图') },
  // 分类 + 分批
  { click: '.library-tab:nth-child(8)', after: 900 },
  { js: SNAPSHOT('切到 G 类(201–261, 61 条)') },
  { clickText: '继续显示，还有 31 条', after: 900 },
  { js: SNAPSHOT('点「继续显示」之后') },
  { click: '.library-tab:nth-child(1)', after: 900 },
  { js: SNAPSHOT('切回「全部」') },
  // 复制: 反馈必须看得见(不是被弹层挡住的 toast), 并核对剪贴板内容
  { clickText: '复制画风', pick: 'first', after: 400 },
  { js: SNAPSHOT('点第一条的「复制画风」') },
  { shot: shotFile },
  {
    js: `(async () => { try { return await navigator.clipboard.readText(); }
      catch (e) { return 'ERR:' + ((e && e.message) || e); } })()`,
  },
  { clickText: '填入提示词', pick: 'first', after: 900 },
  { js: SNAPSHOT('点第一条的「填入提示词」') },
];

fs.writeFileSync(stepsFile, JSON.stringify(steps), 'utf8');

console.log(`[handraw-ui] 目标: ${base}`);
console.log('[handraw-ui] 用 CDP 打开页面并真点击/真输入…');

try {
  execSync(
    `node tools/cdp-run.mjs --url="${base}/#/pages/workshop/workshop" --width=430 --height=1400 ` +
      `--wait=8000 --steps="${stepsFile}" --out="${outFile}"`,
    { stdio: 'inherit', maxBuffer: 1 << 26 }
  );
} catch (e) {
  console.log('CDP 运行失败(dev server 与后端起了吗?)');
}

const allResults = JSON.parse(fs.readFileSync(outFile, 'utf8')).results;
const snapshots = allResults
  .filter((r) => r.kind === 'js' && r.value && typeof r.value === 'object' && r.value.label)
  .map((r) => r.value);
// 中间那一步清空搜索框返回的是字符串, 别把它当成剪贴板内容
const clipboard = (allResults.find(
  (r) => r.kind === 'js' && typeof r.value === 'string' && r.value !== 'cleared'
) || {}).value;
const typed = allResults.find((r) => r.kind === 'insertText');

console.log('\n== 断言 ==');
check(snapshots.length === 11, `拿到 11 个快照（实际 ${snapshots.length}）`);

const [before, opened, searched, cleared, viewer, viewerClosed, groupG, more, all, copied, filled] =
  snapshots;

if (
  before && opened && searched && cleared && viewer && viewerClosed && groupG && more && all &&
  copied && filled
) {
  check(before.entryVisible, '「风格提示词库」入口渲染出来了(工坊已连上后端)');
  check(!before.hasPanel, '没点之前弹层不存在');

  check(opened.hasPanel, '点开后弹层渲染出来了');
  check(opened.itemCount === 30, `首批渲染 30 条（实际 ${opened.itemCount}）`);
  check(opened.inputCount === 1, `只有一个输入框(主题那栏已去掉)（实际 ${opened.inputCount}）`);
  // 分类名改成了"两个代表子风格的关键词", 字母降级成角标
  check(opened.tabTexts.length === 8, `分类页签 8 个(全部 + A–G)（实际 ${opened.tabTexts.length}）`);
  const expectTabs = [
    ['全部', '261'],
    ['极简线描', '35'],
    ['墨线淡彩', '19'],
    ['几何平面', '28'],
    ['日系日常', '41'],
    ['水墨国风', '31'],
    ['网感涂鸦', '46'],
    ['治愈绘本', '61'],
  ];
  expectTabs.forEach(([name, count], i) => {
    const text = opened.tabTexts[i] || '';
    check(
      text.includes(name) && text.includes(count),
      `第 ${i + 1} 个页签是「${name} … ${count}」（实际「${text}」）`
    );
  });
  check(opened.firstNumber === '001', `第一条是 001（实际 ${opened.firstNumber}）`);
  check(
    opened.firstName === 'Playful Deadpan Doodle',
    `第一条风格名正确（实际 ${opened.firstName}）`
  );

  // 参考图: 真的加载出来了(不是破图)
  check(opened.thumbCount === 30, `每条都挂了参考图（${opened.thumbCount} 张）`);
  check(
    opened.thumbLoaded >= 25,
    `参考图真的加载成功（${opened.thumbLoaded}/${opened.thumbCount} 张 naturalWidth>0）`
  );

  // 搜索框: 真键盘输入能打进去, 并且筛出那一条
  check(typed && typed.ok, '搜索框能拿到焦点(真点击)');
  check(cleared.searchValue === '', '清空搜索框生效');
  check(
    searched.searchValue === '041',
    `真键盘输入打进去了（输入框实际值 "${searched.searchValue}"）`
  );
  check(searched.itemCount === 1, `输入 041 后只剩 1 条（实际 ${searched.itemCount}）`);
  check(searched.firstNumber === '041', `命中的是 041（实际 ${searched.firstNumber}）`);

  // 参考图大图
  check(viewer.viewerOpen, '点参考图弹出了大图');
  check(!viewerClosed.viewerOpen, '关掉大图后弹层消失');

  // 分类与分批
  check(groupG.itemCount === 30, `切到 G 类仍分批发（${groupG.itemCount} 条）`);
  check(groupG.firstNumber === '201', `G 类第一条是 201（实际 ${groupG.firstNumber}）`);
  check(/治愈绘本/.test(groupG.groupName), `G 类标题用的是短名:「${groupG.groupName}」`);
  check(/还有 31 条/.test(groupG.more), `G 类还有 31 条:「${groupG.more}」`);
  check(more.itemCount === 60, `「继续显示」后 60 条（实际 ${more.itemCount}）`);
  check(all.itemCount === 30 && all.firstNumber === '001', '切回「全部」回到第一批');

  // 复制: 弹层里的反馈必须看得见且不被挡住
  check(copied.hasPanel, '点「复制画风」后弹层没关掉(还能接着挑)');
  check(
    copied.statusText.includes('已复制到剪贴板') && copied.statusText.includes('001'),
    `弹层里有复制提示:「${copied.statusText}」`
  );
  check(
    /library-status/.test(copied.statusHit) || copied.statusVisible,
    `提示确实在屏幕上可见(最上层是 ${copied.statusHit || '空'}, 未被弹层挡住=${copied.statusVisible})`
  );
  check(
    copied.copyButtonText.includes('已复制'),
    `按钮同时变成「${copied.copyButtonText}」`
  );
  if (String(clipboard).startsWith('ERR:')) {
    console.log(`  · 剪贴板读不了(headless 权限): ${clipboard}`);
  } else {
    check(
      typeof clipboard === 'string' && clipboard.includes('【手绘风格 001'),
      `剪贴板里就是完整画风文案:「${String(clipboard).slice(0, 30)}…」`
    );
    check(String(clipboard).includes('English style hint'), '剪贴板文案里有给英文模型的风格名');
  }

  // 填入
  check(!filled.hasPanel, '「填入提示词」后弹层自动关闭');
  check(
    filled.promptValue.includes('Playful Deadpan Doodle'),
    `填入的风格进了提示词框:「${filled.promptValue.slice(0, 40)}…」`
  );

  // 布局
  check(
    opened.scrollWidth <= opened.viewport,
    `没有横向溢出（scrollWidth ${opened.scrollWidth} ≤ 视口 ${opened.viewport}）`
  );
  check(
    opened.panelRight <= opened.viewport,
    `弹层右边不出屏（${opened.panelRight} ≤ ${opened.viewport}）`
  );
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
