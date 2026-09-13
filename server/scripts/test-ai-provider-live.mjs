// 用真实硅基流动账号验证「生成 → 下载 → 规范化」整条链路。
//
// 为什么要单独测: 这是整个工坊最容易随供应商变化而失效的一段, 而且
// AI_IMAGE_DOWNLOAD_HOSTS 这种值只有真实响应才能确定。
//
// 这个脚本会**消耗一次真实生图额度**(按张计费), 但整条链路都走
// modules/ai-workshop.js 里导出的真实函数, 不复制、不模拟任何模块逻辑。
//
// 运行:
//   SILICONFLOW_API_KEY=sk-xxx node scripts/test-ai-provider-live.mjs
// 可选环境变量:
//   AI_IMAGE_SIZE  默认 1024x1024;   AI_IMAGE_MODEL 默认 Kwai-Kolors/Kolors
//   LIVE_ALLOW_HOSTS  逗号分隔; 不填则用上一次运行的推断值 + s3.siliconflow.cn

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.SILICONFLOW_API_KEY || '';
const MODEL = process.env.AI_IMAGE_MODEL || 'Kwai-Kolors/Kolors';
const IMAGE_SIZE = process.env.AI_IMAGE_SIZE || '1024x1024';

// 默认放行硅基流动的对象存储域名; 可用 LIVE_ALLOW_HOSTS 覆盖
const HOSTS = (process.env.LIVE_ALLOW_HOSTS || 's3.siliconflow.cn')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function main() {
  if (!API_KEY) {
    throw new Error('缺少 SILICONFLOW_API_KEY (例如: SILICONFLOW_API_KEY=sk-xxx node scripts/test-ai-provider-live.mjs)');
  }

  const sharp = (await import('sharp')).default;
  const { generateWithProvider } = await import('../src/modules/ai-workshop.js');

  // 记录真实请求, 用于核对发出去的参数
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const response = await realFetch(url, options);
    calls.push({ url: String(url), options, status: response.status });
    return response;
  };

  const logs = [];
  const logger = {
    error: (...a) => logs.push(a.join(' ')),
    log: (...a) => logs.push(a.join(' ')),
    warn: (...a) => logs.push(a.join(' ')),
  };

  console.log(`[live] 模型=${MODEL} 尺寸=${IMAGE_SIZE} 白名单=${HOSTS.join(',')}`);
  console.log('[live] 正在真实调用供应商(会计费) ...');

  const started = Date.now();
  const webp = await generateWithProvider(
    {
      model: MODEL,
      prompt:
        '【角色动作】一位成年东方女性，倚坐窗前，右手轻托下颌，左手自然放在膝上，目光低垂，神情宁静。' +
        '【镜头】中景半身人像，平视角度，主体居中。【画质】中式仙侠古风写实人像，细节清晰，电影感柔光，' +
        '真实自然的材质表现，不添加文字、水印、边框、字幕或界面元素。' +
        '【背景渲染】黄昏庭院的窗边，暖色柔光，远景轻微虚化。' +
        '【角色细节】柔和的东方面部轮廓，深色眼眸，黑色长发，月白色交领长裙，玉簪束发，肤色白皙自然。',
      image_size: IMAGE_SIZE,
    },
    {
      apiKey: API_KEY,
      imageSize: IMAGE_SIZE,
      downloadHosts: new Set(HOSTS),
      sharp,
      logger,
    }
  );

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[live] 完成, 用时 ${elapsed}s, 产出 ${webp.length} 字节`);

  // ---- 断言 ----
  console.log('\n【1】请求参数');
  const generateCall = calls.find((c) => c.url.includes('api.siliconflow.cn/v1/images/generations'));
  check('确实调用了生成接口', Boolean(generateCall));
  check('生成接口返回 200', generateCall?.status === 200, `实际 ${generateCall?.status}`);

  const sent = JSON.parse(generateCall.options.body);
  check('发送 model', sent.model === MODEL, sent.model);
  check('发送 image_size', sent.image_size === IMAGE_SIZE, sent.image_size);
  check('发送 num_inference_steps', sent.num_inference_steps === 20);
  check('发送 guidance_scale(Kolors)', sent.guidance_scale === 7.5);
  check('发送 negative_prompt', typeof sent.negative_prompt === 'string' && sent.negative_prompt.length > 0);
  check('不发送 denoising_strength(无图生图)', !('denoising_strength' in sent));
  check(
    '请求无水印 X-Enable-Watermark: 0',
    generateCall.options.headers['X-Enable-Watermark'] === '0'
  );

  console.log('\n【2】图片下载与白名单');
  const downloadCall = calls.find((c) => c !== generateCall);
  const imageHost = downloadCall ? new URL(downloadCall.url).hostname.toLowerCase() : '';
  console.log(`  · 真实图片域名: ${imageHost || '(未下载)'}`);
  check('从白名单域名下载图片', HOSTS.includes(imageHost), imageHost);
  check('下载返回 200', downloadCall?.status === 200, `实际 ${downloadCall?.status}`);
  check('下载时 redirect=error(不跟随跳转)', downloadCall?.options?.redirect === 'error');

  console.log('\n【3】图片规范化结果');
  check('产出 webp(RIFF/WEBP 魔数)', webp.toString('ascii', 0, 4) === 'RIFF' && webp.toString('ascii', 8, 12) === 'WEBP');
  const meta = await sharp(webp).metadata();
  check('sharp 可解析产出', meta.format === 'webp');
  check('尺寸不超过 2048', meta.width <= 2048 && meta.height <= 2048, `${meta.width}x${meta.height}`);
  console.log(`  · 规范化结果: ${meta.width}x${meta.height} webp ${webp.length} 字节`);

  const [wantW, wantH] = IMAGE_SIZE.split('x').map(Number);
  check(
    `比例与请求一致 (${IMAGE_SIZE})`,
    Math.abs(meta.width / meta.height - wantW / wantH) < 0.02,
    `${meta.width}x${meta.height}`
  );

  // ---- 结论 ----
  console.log('\n[live] 结论');
  console.log(`  建议写入服务器 .env:  AI_IMAGE_DOWNLOAD_HOSTS=${imageHost || HOSTS.join(',')}`);
  if (logs.length) console.log('  模块日志: ' + logs.join(' | '));

  const out = path.join(os.tmpdir(), 'ai-live-preview.webp');
  fs.writeFileSync(out, webp);
  console.log(`  预览图已保存: ${out}`);

  console.log(`\n[live] 通过 ${passed} 项, 失败 ${failures.length} 项`);
  if (failures.length) {
    failures.forEach((f) => console.log('   - ' + f));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('[live] 运行失败:', e.message);
  process.exitCode = 1;
});
