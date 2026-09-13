// ============================================================
// 浏览器级页面巡检(真渲染, 不是 Node 里的假渲染)
// 用法: node tools/browser-page-check.mjs [baseUrl]     默认 http://127.0.0.1:5173
//
// 为什么必须有这一层:
//   2026-09-13 踩过一个坑 —— wheel.vue 里给"每日奖励"多套了一层**不带指令的裸 <block>**,
//   H5 编译器于是把它编译成真实的 <template> 元素; <template> 的子节点是**惰性内容**,
//   浏览器根本不渲染。结果是整块"每日奖励"(成员卡 + 转盘)在页面上彻底消失,
//   而 **Node 侧的 SFC 渲染测试完全看不出来**(Node 里 block 就是个普通元素, 子节点照样渲染)。
//   所以这里用 headless Chrome 打开真页面, 检查:
//     1) 渲染出来的 DOM 里不允许出现真实的 <template> 元素(出现 = 有内容被吞掉);
//     2) 每个关键页面至少要有 N 个 uni-view 节点(内容被整块吞掉时数量会骤降);
//     3) 每个页面必须能看见指定的关键文案。
//
// 依赖: 需要 HBuilderX 的 dev server(默认 5173)在跑 —— 它带 /api 代理, 页面能拿到真数据。
//       换 baseUrl 也可以(例如线上), 但阈值是按 dev 匿名访问标定的。
// ============================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const base = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');

// 页面 / uni-view 下限(按实测值的 ~70%) / 必须看得见的文案
const PAGES = [
  {
    hash: '/pages/index/index',
    name: '首页',
    minViews: 90,
    needs: ['部落转盘', '部落创作工坊', '排行榜'],
  },
  {
    hash: '/pages/wheel/wheel',
    name: '部落转盘',
    minViews: 120,
    needs: ['部落幸运屋', '为谁送上好运', '今日好运，即将揭晓', '好运奖励池'],
  },
  {
    hash: '/pages/workshop/workshop',
    name: '创作工坊',
    minViews: 55,
    needs: ['通用创作', '本机图库', '开始生成'],
  },
  {
    hash: '/pages/settings/settings',
    name: '设置',
    minViews: 30,
    needs: ['设置中心', '访问权限'],
  },
  {
    hash: '/pages/members/members',
    name: '成员管理',
    minViews: 400,
    needs: ['在部落', '归档'],
  },
  {
    hash: '/pages/entry/entry',
    name: '录入',
    minViews: 8,
    needs: ['粘贴星数名单', '提交'],
  },
];

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('找不到 Chrome/Edge, 可用 CHROME_PATH 指定');
}

const chrome = findChrome();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-page-check-'));

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

console.log(`[browser-check] 浏览器: ${path.basename(chrome)}`);
console.log(`[browser-check] 目标:   ${base}`);

for (const page of PAGES) {
  const url = `${base}/#${page.hash}`;
  const out = path.join(tmpDir, page.hash.replace(/[^\w]/g, '_') + '.html');

  try {
    // 用 shell 重定向写文件, 不用管道(管道在受限沙箱下会 EPERM); 2>nul 丢掉 Chrome 的扩展告警
    execSync(
      `"${chrome}" --headless=new --disable-gpu --no-first-run --no-default-browser-check ` +
        `--virtual-time-budget=15000 --dump-dom "${url}" > "${out}" 2>${process.platform === 'win32' ? 'nul' : '/dev/null'}`,
      { stdio: ['ignore', 'ignore', 'ignore'] }
    );
  } catch (e) {
    check(false, `${page.name} 打不开 (${url})`);
    continue;
  }

  if (!fs.existsSync(out)) {
    check(false, `${page.name} 没有拿到 DOM`);
    continue;
  }

  const dom = fs.readFileSync(out, 'utf8');
  const views = dom.split('uni-view').length - 1;
  const templates = dom.split('<template').length - 1;
  console.log(`\n== ${page.name} (${page.hash})  uni-view=${views}  template=${templates}`);

  check(templates === 0, `${page.name}: DOM 里没有真实的 <template> 元素(有 = 内容被吞)`);
  check(
    views >= page.minViews,
    `${page.name}: 渲染节点数 ${views} ≥ ${page.minViews}(整块内容消失时会骤降)`
  );
  for (const s of page.needs) {
    check(dom.includes(s), `${page.name}: 能看到「${s}」`);
  }
}

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n结果: ${pass} PASS / ${fails.length} FAIL`);
if (fails.length) {
  console.log('失败明细:');
  fails.forEach((f) => console.log('   - ' + f));
  process.exit(1);
}
