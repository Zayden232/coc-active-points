// ============================================================
// 部落转盘 · 随机抽人「自选成员」真浏览器 UI 检查(真点击, 不是假渲染)
// 用法: node tools/wheel-fun-ui-check.mjs [baseUrl]    默认 http://127.0.0.1:5173
//
// 为什么还要这一层(已有 wheel-fun-pick-flow.mjs):
//   Node 里的渲染测试看不到 CSS, 也点不了真按钮。这里用 CDP 真点「随机抽人」→「自选成员」
//   → 点分数那一行整组选中, 断言面板文案/按钮可用状态/没有横向溢出。
//
// 依赖: HBuilderX 的 dev server(默认 5173, 带 /api 代理)。
// ============================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const base = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fun-ui-'));
const stepsFile = path.join(tmp, 'steps.json');
const outFile = path.join(tmp, 'out.json');
const shotFile = path.resolve('.e2e-logs/shot-fun-ui.png');

// 一次跑完的步骤: 切标签 → 量一次 → 整组选中 → 量一次 → 清空 → 量一次
const SNAPSHOT = (label) => `(() => {
  const panel = document.querySelector('.pick-panel');
  const groups = [...document.querySelectorAll('.score-group')];
  // 注意: uni-app H5 的 <button> 渲染成 <uni-button>, 而且禁用态是 disabled 属性
  // (element.disabled 是 false), 所以这里必须读属性。
  const btn = [...document.querySelectorAll('uni-button,button')]
    .find((b) => /随机抽取|再抽一次|正在寻找/.test(b.textContent));
  const box = (el) => (el ? el.getBoundingClientRect() : { width: 0, right: 0 });
  return {
    label: ${JSON.stringify(label)},
    hasPanel: !!panel,
    groupCount: groups.length,
    firstHead: groups[0] ? groups[0].querySelector('.score-head').textContent.replace(/\\s+/g, ' ').trim() : '',
    firstPickText: groups[0] ? groups[0].querySelector('.score-pick').textContent.trim() : '',
    firstCount: groups[0] ? groups[0].querySelectorAll('.pick-item').length : 0,
    firstOn: groups[0] ? groups[0].querySelectorAll('.pick-item.on').length : 0,
    selectedText: (document.querySelector('.pick-count') || {}).textContent
      ? document.querySelector('.pick-count').textContent.replace(/\\s+/g, ' ').trim() : '',
    drawDisabled: btn ? btn.getAttribute('disabled') === 'true' || btn.getAttribute('disabled') === '' : null,
    drawText: btn ? btn.textContent.replace(/\\s+/g, ' ').trim() : '',
    caption: (document.querySelector('.fun-caption') || {}).textContent || '',
    viewport: window.innerWidth,
    scrollWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
    panelRight: Math.round(box(panel).right),
  };
})()`;

const steps = [
  { clickText: '随机抽人', after: 900 },
  { clickText: '自选成员', after: 1800 },
  { js: SNAPSHOT('初始(0 选中)') },
  // 点第一组(并列第一那组)的「整组选中」: pick:'first' 取最上面那一组
  { clickText: '整组选中', pick: 'first', after: 900 },
  { js: SNAPSHOT('整组选中第一组之后') },
  { shot: shotFile },
  { clickText: '清空', after: 900 },
  { js: SNAPSHOT('清空之后') },
];

fs.writeFileSync(stepsFile, JSON.stringify(steps), 'utf8');

console.log(`[fun-ui] 目标: ${base}`);
console.log('[fun-ui] 用 CDP 打开页面并真点击…');

try {
  execSync(
    `node tools/cdp-run.mjs --url="${base}/#/pages/wheel/wheel" --width=430 --height=1400 ` +
      `--wait=6000 --steps="${stepsFile}" --out="${outFile}"`,
    { stdio: 'inherit', maxBuffer: 1 << 26 }
  );
} catch (e) {
  console.log('CDP 运行失败(dev server 起了吗?)');
}

const snapshots = JSON.parse(fs.readFileSync(outFile, 'utf8'))
  .results.filter((r) => r.kind === 'js' && r.value)
  .map((r) => r.value);

console.log('\n== 断言 ==');
check(snapshots.length === 3, `拿到 3 个快照（实际 ${snapshots.length}）`);

const [before, after, cleared] = snapshots;

if (before && after && cleared) {
  check(before.hasPanel, '「自选成员」面板渲染出来了');
  check(before.groupCount >= 3, `按分数分组（${before.groupCount} 组）`);
  check(/分/.test(before.firstHead) && /名/.test(before.firstHead), `第一组标题含分数与名次：「${before.firstHead}」`);
  check(/并列/.test(before.firstHead), '第一组标了「并列」');
  check(before.firstCount >= 2, `第一组有 ${before.firstCount} 位成员`);
  check(before.selectedText.includes('已选 0 /'), `初始未选中：「${before.selectedText}」`);
  check(before.drawDisabled === true, '未选人时「开始随机抽取」不可点');
  check(before.caption.includes('还没选人'), `未选人时提示去选人：「${before.caption.trim()}」`);

  check(after.firstOn === after.firstCount, `整组选中：第一组 ${after.firstOn}/${after.firstCount} 人选中`);
  check(after.firstPickText.includes('取消'), `按钮变成「${after.firstPickText}」`);
  check(/已选 [1-9]/.test(after.selectedText), `计数更新：「${after.selectedText}」`);
  check(after.drawDisabled === false, '选人后「开始随机抽取」可点');
  check(!after.caption.includes('还没选人'), `点名台文案换成「${after.caption.trim()}」`);

  check(cleared.selectedText.includes('已选 0 /'), `清空后归零：「${cleared.selectedText}」`);
  check(cleared.drawDisabled === true, '清空后按钮重新不可点');

  // 布局: 页面不能出现横向滚动(视口内排得下)
  check(
    before.scrollWidth <= before.viewport,
    `没有横向溢出（scrollWidth ${before.scrollWidth} ≤ 视口 ${before.viewport}）`
  );
  check(
    after.panelRight <= after.viewport,
    `面板右边不出屏（${after.panelRight} ≤ ${after.viewport}）`
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
