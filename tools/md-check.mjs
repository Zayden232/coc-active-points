// Markdown 结构检查: 代码围栏配对 + 标题清单 + 基础体积 + README 里的图片引用是否真的存在
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const files = ['README.md', 'deploy/DEPLOY.md'];
let fail = 0;

for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const top = text.match(/^```/gm) || [];
  const indented = text.match(/^[ \t]+```/gm) || [];
  const heads = text.match(/^#{1,3} /gm) || [];
  const lines = text.split('\n').length;
  const ok = (n) => (n % 2 === 0 ? 'OK' : '不配对!');
  if (top.length % 2 !== 0 || indented.length % 2 !== 0) fail += 1;
  console.log(
    `${f.padEnd(18)} 行=${String(lines).padEnd(5)} 顶层围栏=${top.length}(${ok(top.length)})  ` +
      `缩进围栏=${indented.length}(${ok(indented.length)})  标题=${heads.length}  字符=${text.length}`
  );
}

// 图片引用: <img src="..."> 与 ![](路径)
const readme = readFileSync('README.md', 'utf8');
const refs = [
  ...[...readme.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]),
  ...[...readme.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]),
].filter((src) => !/^https?:/i.test(src));

console.log(`\nREADME 引用的本地图片: ${refs.length} 张`);
let total = 0;
for (const src of [...new Set(refs)]) {
  const p = path.resolve(src);
  if (!existsSync(p)) {
    console.log(`  ✗ 缺失 ${src}`);
    fail += 1;
    continue;
  }
  const kb = statSync(p).size / 1024;
  total += kb;
  console.log(`  ✓ ${src}  ${kb.toFixed(0)} KB`);
}
if (total > 0) console.log(`  合计 ${(total / 1024).toFixed(1)} MB`);

console.log(fail ? `\n结果: ${fail} 项异常` : '\n结果: 全部正常');
process.exit(fail ? 1 : 0);
