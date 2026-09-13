// 空数据渲染检查: 用页面真实的 data() 初值("未加载"状态)渲染模板, 抓出
// "在 null 上取属性"这类**只在浏览器里才会暴露**的渲染期错误
// (典型: 用 v-show="xxx" 包住引用 xxx.field 的区块 —— v-show 不阻止渲染)。
//
// 用法: node tools/page-null-render.mjs app/src/pages/*/*.vue
// 原理:
//   1) 用 @vue/compiler-sfc 编译模板(所有标签当自定义元素, 不需要组件注册);
//   2) 从 <script> 里提取初始化为 null 的 data 字段名, 这些字段在渲染时返回 null;
//   3) 其它标识符返回一个"什么都能取、返回自己"的宽松代理, 避免与本次检查无关的报错;
//   4) 调用渲染函数: 抛错 => 该页面在"数据未就绪"时会报错。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(path.resolve('app/package.json'));
const sfc = require('@vue/compiler-sfc');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('用法: node tools/page-null-render.mjs <file.vue> [...]');
  process.exit(2);
}

const permissive = new Proxy(function () {}, {
  get(target, key) {
    if (typeof key === 'symbol') {
      // 让字符串/数字隐式转换能拿到原始值, 否则会抛 "Cannot convert object to primitive value"
      if (key === Symbol.toPrimitive) return () => '';
      return undefined;
    }
    if (key === 'toJSON' || key === 'then') return undefined; // 别被当成 Promise / 循环序列化
    if (key === 'toString' || key === 'valueOf') return () => '';
    return permissive;
  },
  apply() {
    return permissive;
  },
  ownKeys() {
    return [];
  },
  getOwnPropertyDescriptor() {
    return { configurable: true, enumerable: true, value: permissive };
  },
});

function nullInitKeys(scriptContent) {
  const keys = new Set();
  const re = /(?:^|[\s{,])([A-Za-z_$][\w$]*)\s*:\s*null\b/g;
  let m;
  while ((m = re.exec(scriptContent))) keys.add(m[1]);
  return keys;
}

async function check(file) {
  const abs = path.resolve(file);
  const source = fs.readFileSync(abs, 'utf8');
  const { descriptor, errors } = sfc.parse(source, { filename: abs });
  if (errors.length) return { file, status: 'parse-error', detail: errors[0].message };
  if (!descriptor.template) return { file, status: 'skip', detail: '无模板' };

  const nullKeys = nullInitKeys(descriptor.script ? descriptor.script.content : '');

  const compiled = sfc.compileTemplate({
    source: descriptor.template.content,
    filename: abs,
    id: 'nullcheck',
    compilerOptions: { isCustomElement: () => true },
  });
  if (compiled.errors.length) {
    return { file, status: 'compile-error', detail: String(compiled.errors[0].message || compiled.errors[0]) };
  }

  const tmp = path.join(os.tmpdir(), `dsh-nullcheck-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
  // 编译产物里 Vue 的导入改成本地 app 依赖, 保证能 import
  const vueUrl = pathToFileURL(path.resolve('app/node_modules/vue/dist/vue.runtime.esm-bundler.js')).href;
  const code = compiled.code.replace(/from ["']vue["']/g, `from ${JSON.stringify(vueUrl)}`);
  fs.writeFileSync(tmp, code, 'utf8');

  const nullProxy = new Proxy({}, {
    get(target, key) {
      if (typeof key === 'symbol') return undefined;
      if (nullKeys.has(key)) return null;
      return permissive;
    },
    has: () => true,
  });

  try {
    const mod = await import(pathToFileURL(tmp).href);
    const render = mod.render || mod.default;
    if (typeof render !== 'function') return { file, status: 'skip', detail: '拿不到渲染函数' };
    // Vue 3 渲染函数签名: (ctx, cache, props, setupState, data, options)
    render(nullProxy, []);
    return { file, status: 'ok', detail: `null 初值字段 ${nullKeys.size} 个` };
  } catch (e) {
    return { file, status: 'render-error', detail: e.message };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

let bad = 0;
for (const f of files) {
  const r = await check(f);
  const label = path.relative(process.cwd(), r.file);
  if (r.status === 'render-error') bad += 1;
  const icon = r.status === 'ok' ? '✓' : r.status === 'render-error' ? '✗' : '·';
  console.log(`${icon} ${label}  [${r.status}] ${r.detail}`);
}
console.log(bad ? `\n${bad} 个页面在"数据未就绪"时会抛渲染异常` : '\n所有页面在"数据未就绪"时都能安全渲染');
process.exit(bad ? 1 : 0);
