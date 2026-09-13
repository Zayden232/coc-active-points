// 快速校验 .vue 单文件组件能否被 @vue/compiler-sfc 解析并编译
// 用法: node tools/sfc-check.mjs app/src/pages/settings/settings.vue
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const target = process.argv[2];
if (!target) {
  console.error('用法: node tools/sfc-check.mjs <file.vue>');
  process.exit(2);
}
const file = path.resolve(target);
const require = createRequire(path.resolve('app/package.json'));
const sfc = require('@vue/compiler-sfc');

const source = fs.readFileSync(file, 'utf8');
const { descriptor, errors } = sfc.parse(source, { filename: file });
if (errors.length) {
  console.error('parse 失败:');
  for (const e of errors) console.error('  ' + (e.message || e));
  process.exit(1);
}

const id = 'sfccheck';
const out = [];
out.push(`template: ${descriptor.template ? 'yes' : 'no'}`);
out.push(`script: ${descriptor.script ? 'yes' : 'no'} (setup: ${descriptor.scriptSetup ? 'yes' : 'no'})`);
out.push(`styles: ${descriptor.styles.length} (scoped: ${descriptor.styles.map((s) => s.scoped).join(',')})`);

const compiled = sfc.compileTemplate({
  source: descriptor.template.content,
  filename: file,
  id,
});
if (compiled.errors.length) {
  console.error('template 编译失败:');
  for (const e of compiled.errors) console.error('  ' + (e.message || e));
  process.exit(1);
}

const script = sfc.compileScript(descriptor, { id });
out.push(`script 编译: ok (${script.content.length} 字节)`);
out.push(`template 渲染函数: ok (${compiled.code.length} 字节)`);
for (const s of descriptor.styles) {
  const r = sfc.compileStyle({ source: s.content, filename: file, id, scoped: s.scoped });
  if (r.errors.length) {
    console.error('style 编译失败:');
    for (const e of r.errors) console.error('  ' + e);
    process.exit(1);
  }
}
out.push(`style 编译: ok`);
console.log(out.join('\n'));
