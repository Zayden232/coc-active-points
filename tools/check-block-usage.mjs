// 静态护栏: 模板里不允许出现"不带指令的裸 <block>"
// 用法: node tools/check-block-usage.mjs
//
// 原因(2026-09-13 实际踩到):
//   wheel.vue 里给"每日奖励"多套了一层不带指令的 <block>, H5 编译器把它编译成真实的
//   <template> 元素, 而 <template> 的子节点是惰性内容 → 整块内容在浏览器里完全不渲染。
//   其它页面里的 <block v-if>/<block v-else>/<block v-for> 都会被编译成 Fragment, 没问题。
//
// 所以规则很简单: 这个项目里 <block> 必须带 v-if / v-else / v-else-if / v-for。
// 想单纯分组就让子元素按原层级排, 不要再套一层。
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('app/src');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.vue')) out.push(p);
  }
  return out;
}

const DIRECTIVE = /\s(v-if|v-else|v-else-if|v-for)\b/;
const OPEN_BLOCK = /<block(\s[^>]*)?>/g;

let bad = 0;
let total = 0;

for (const file of walk(root)) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  // 注释里也可能出现 "<block>"(例如本项目的坑位说明), 先按等长掩码掉注释, 行号才不会串
  const masked = src
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n');

  masked.forEach((line, idx) => {
    OPEN_BLOCK.lastIndex = 0;
    let m;
    while ((m = OPEN_BLOCK.exec(line))) {
      total += 1;
      const attrs = m[1] || '';
      if (!DIRECTIVE.test(' ' + attrs.trim())) {
        bad += 1;
        console.log(
          `✗ ${path.relative(process.cwd(), file)}:${idx + 1} 裸 <block>（无指令）` +
            ` → H5 会渲染成 <template>, 其子节点不显示`
        );
        console.log(`     ${(lines[idx] || '').trim()}`);
      }
    }
  });
}

console.log(`\n扫描 <block> ${total} 处, 违规 ${bad} 处`);
if (bad) {
  console.log('结果: FAIL（把裸 <block> 去掉, 或改成带 v-if 的 <block>）');
  process.exit(1);
}
console.log('结果: PASS');
