// 校验打包产物里的 API 基址注入是否正确(不依赖 PowerShell 的中文处理)
// 用法: node tools/check-api-base.mjs <dist目录> <期望基址>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const expect = process.argv[3];

function walk(d) {
  const out = [];
  for (const e of readdirSync(d)) {
    const p = path.join(d, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(dir);
let leftover = 0;
const hits = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  if (src.includes('__API_BASE__')) leftover += 1;
  // 找 /ai-workshop 拼接点: 基址就在它前面
  const re = /([`'"])([^`'"]{0,80}?)\1\s*\+\s*([`'"])\/ai-workshop/g;
  let m;
  while ((m = re.exec(src))) hits.push(`${path.basename(f)}: BASE = ${m[2]} + /ai-workshop`);
  const re2 = /BASE\s*=\s*([`'"])([^`'"]*)\1/g;
  while ((m = re2.exec(src))) hits.push(`${path.basename(f)}: BASE = ${m[2]}`);
}

console.log(`扫描 ${files.length} 个 js 文件`);
console.log(`__API_BASE__ 字面量残留: ${leftover} 处  ${leftover === 0 ? 'OK' : 'FAIL'}`);
console.log('基址拼接点:');
for (const h of [...new Set(hits)]) console.log('  ' + h);

const wantLiteral = JSON.stringify(expect);
const found = files.filter((f) => readFileSync(f, 'utf8').includes(wantLiteral));
console.log(`包含字面量 ${wantLiteral} 的文件: ${found.length} 个 ${found.length > 0 ? 'OK' : 'FAIL'}`);
for (const f of found) console.log('  ' + path.basename(f));

const okAll = leftover === 0 && found.length > 0;
console.log(okAll ? '\n结果: PASS' : '\n结果: FAIL');
process.exit(okAll ? 0 : 1);
