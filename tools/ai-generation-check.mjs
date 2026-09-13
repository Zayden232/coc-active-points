// 端到端真生图验证: 直接打 /api/ai-workshop(与 App/网页走的是同一套接口)
// 用法: node tools/ai-generation-check.mjs [baseUrl] [--token=xxx]
//   默认 baseUrl = http://127.0.0.1:3000/api
//   默认匿名(不带 token) —— 用来顺带验证"访客也能生图"
//
// 会消耗一次真实生图额度(按张计费)。跑完会打印任务 id 与图片字节数。
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const baseArg = args.find((a) => !a.startsWith('--')) || 'http://127.0.0.1:3000/api';
const tokenArg = (args.find((a) => a.startsWith('--token=')) || '').replace('--token=', '');
const BASE = baseArg.replace(/\/$/, '') + '/ai-workshop';

let pass = 0;
const fails = [];
const check = (cond, msg) => {
  if (cond) {
    pass += 1;
    console.log('  ✓ ' + msg);
  } else {
    fails.push(msg);
    console.log('  ✗ ' + msg);
  }
};

const headers = () => ({
  'Content-Type': 'application/json',
  ...(tokenArg ? { Authorization: 'Bearer ' + tokenArg } : {}),
});

const clientToken = 'verify_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

console.log(`[ai-gen] 目标: ${BASE}`);
console.log(`[ai-gen] 身份: ${tokenArg ? '带 token' : '匿名访客'}`);

const cfgRes = await fetch(`${BASE}/config`, { headers: headers() });
const cfg = await cfgRes.json();
console.log('[ai-gen] config:', JSON.stringify(cfg.data));
check(cfgRes.status === 200 && cfg.ok === true, 'GET /config 200');
check(cfg.data.enabled === true, 'enabled=true (服务器已配置生图 key)');
check(cfg.data.can_create === true, 'can_create=true (当前身份可以生成)');

if (!cfg.data.enabled) {
  console.log('\n[ai-gen] 服务端未配置 key, 直接结束');
  process.exit(1);
}

const created = await (
  await fetch(`${BASE}/jobs`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      client_token: clientToken,
      prompt: '一只抱着金币的小猫，圆滚滚，可爱卡通插画，背景简洁，无文字',
    }),
  })
).json();
console.log('[ai-gen] 提交任务:', JSON.stringify(created));
check(!!created.data && !!created.data.id, 'POST /jobs 返回任务 id');

let job = null;
const deadline = Date.now() + 180000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 2500));
  const r = await fetch(`${BASE}/jobs/${created.data.id}`, { headers: headers() });
  const body = await r.json();
  job = body.data;
  process.stdout.write(`\r[ai-gen] 任务状态: ${job && job.status}            `);
  if (job && !['queued', 'running'].includes(job.status)) break;
}
console.log('');
console.log('[ai-gen] 终态:', JSON.stringify(job));
check(job && job.status === 'succeeded', `任务最终成功 (实际 ${job && job.status} ${job && job.error ? '错误: ' + job.error : ''})`);

if (job && job.status === 'succeeded') {
  const imgRes = await fetch(`${BASE}/jobs/${created.data.id}/image`, { headers: headers() });
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const isWebp = buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP';
  check(imgRes.status === 200, 'GET /jobs/:id/image 200');
  check(isWebp, `取回的是 webp 图片 (${buf.length} 字节)`);

  const out = path.resolve('.e2e-logs/ai-generation-latest.webp');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  console.log(`[ai-gen] 预览图已保存: ${out}`);
  console.log(`[ai-gen] 任务 id: ${created.data.id}  (清理: DELETE 数据库行 + 临时文件)`);
}

console.log(`\n[ai-gen] 通过 ${pass} 项, 失败 ${fails.length} 项`);
if (fails.length) {
  fails.forEach((f) => console.log('   - ' + f));
  process.exitCode = 1;
}
