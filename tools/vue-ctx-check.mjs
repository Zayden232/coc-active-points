// 静态核对: 模板里用到的 _ctx.xxx 是否都能在 <script> 里找到(data/computed/methods/导入)
// 用法: node tools/vue-ctx-check.mjs app/src/pages/settings/settings.vue
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const target = process.argv[2];
if (!target) {
  console.error('用法: node tools/vue-ctx-check.mjs <file.vue>');
  process.exit(2);
}
const file = path.resolve(target);
const require = createRequire(path.resolve('app/package.json'));
const sfc = require('@vue/compiler-sfc');

const source = fs.readFileSync(file, 'utf8');
const { descriptor, errors } = sfc.parse(source, { filename: file });
if (errors.length) {
  console.error('parse 失败: ' + errors.map((e) => e.message).join('; '));
  process.exit(1);
}

const compiled = sfc.compileTemplate({
  source: descriptor.template.content,
  filename: file,
  id: 'ctxcheck',
});
if (compiled.errors.length) {
  console.error('template 编译失败: ' + compiled.errors.map((e) => e.message).join('; '));
  process.exit(1);
}

const script = sfc.compileScript(descriptor, { id: 'ctxcheck' }).content;

const used = new Set();
for (const m of compiled.code.matchAll(/_ctx\.([A-Za-z_$][\w$]*)/g)) used.add(m[1]);

const missing = [];
for (const name of [...used].sort()) {
  const re = new RegExp(`(^|[^\\w$.])${name}\\s*[:(,]`, 'm');
  if (!re.test(script)) missing.push(name);
}

console.log(`模板引用标识符 ${used.size} 个: ${[...used].sort().join(', ')}`);
if (missing.length) {
  console.error(`\n以下标识符在 <script> 中找不到定义: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('全部在 <script> 中有定义 ✓');
