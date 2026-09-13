// 校验运行中的 vite dev server 能否正常编译改动过的页面(避免"改坏了但没人发现")
// 用法: node tools/dev-server-page-check.mjs <devServerBase> <pagePath...>
const base = process.argv[2] || 'http://127.0.0.1:5173';
const pages = process.argv.slice(3);

const mustHave = [
  ['恢复为绿牌', '恢复按钮'],
  ['只读模式', '只读提示'],
  ['include_archived=1', '归档请求参数'],
];

let fail = 0;
for (const p of pages) {
  const url = `${base}${p}`;
  let text = '';
  let status = 0;
  try {
    const r = await fetch(url);
    status = r.status;
    text = await r.text();
  } catch (e) {
    console.log(`✗ ${p} 请求失败: ${e.message}`);
    fail += 1;
    continue;
  }
  const hasError = /Internal server error|Transform failed|SyntaxError|Pre-transform error|\[plugin:/.test(text);
  const gone = text.includes("label: '全部'") || text.includes('label:"全部"');
  console.log(`=== ${p}  status=${status}  ${text.length} bytes`);
  console.log(`   编译错误: ${hasError ? '有 ✗' : '无 ✓'}`);
  if (hasError) {
    console.log(text.slice(0, 500));
    fail += 1;
  }
  if (p.includes('members.vue')) {
    for (const [needle, label] of mustHave) {
      const ok = text.includes(needle);
      console.log(`   ${label}: ${ok ? '在 ✓' : '缺失 ✗'}`);
      if (!ok) fail += 1;
    }
    console.log(`   「全部」筛选已删除: ${gone ? '否 ✗' : '是 ✓'}`);
    if (gone) fail += 1;
  }
}

console.log(fail ? `\n结果: ${fail} 项异常` : '\n结果: 全部正常');
process.exit(fail ? 1 : 0);
