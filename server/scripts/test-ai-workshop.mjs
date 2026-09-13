// AI 创作工坊: 端到端集成测试
//
// 覆盖: 配置/配额 -> 生成任务(幂等) -> worker 出图 -> 图片规范化 -> 上传图库
//       -> 图库读取 -> 删除释放 -> 额度/域名/长度等拒绝分支。
//
// 做法:
//   - 临时起一个独立 MySQL(自己的 datadir + 端口, 跑完删掉), 不影响其它实例;
//   - 在进程内直接 createApp(), 用真实 HTTP 打接口;
//   - 只 mock 全局 fetch(供应商), 其余全是真实代码路径(含 sharp 图片处理)。
//
// 运行: npm run test:ai     (可用 E2E_MYSQL_PORT / E2E_API_PORT 覆盖端口)

import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'mysql2/promise';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(HERE, '..');
const WORKSPACE = path.resolve(SERVER_DIR, '..');

const MYSQL_PORT = Number(process.env.E2E_MYSQL_PORT || 33308);
const API_PORT = Number(process.env.E2E_API_PORT || 3210);
const DB_NAME = 'coc_points';
const DB_PASSWORD = 'e2e_only_password';
const IDENTITY_SECRET = 'e2e_identity_secret_'.padEnd(48, 'x');
const MOCK_HOST = 'mock-image.example.com';

const LOG_DIR = path.join(WORKSPACE, '.e2e-logs');
const STORAGE_DIR = path.join(WORKSPACE, '.e2e-logs', 'ai-storage');

// ---------- 断言 ----------
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

function checkEqual(name, actual, expected) {
  check(name, actual === expected, `期望 ${JSON.stringify(expected)}, 实际 ${JSON.stringify(actual)}`);
}

function log(msg) {
  console.log(`[ai-e2e] ${msg}`);
}

// ---------- MySQL 助手 ----------
function findMysqld() {
  const candidates = [
    process.env.E2E_MYSQLD,
    process.env.MYSQL_HOME ? path.join(process.env.MYSQL_HOME, 'bin', 'mysqld.exe') : null,
    'D:\\ruanjiandaquan\\MySql\\mysql-8.0.23-winx64\\bin\\mysqld.exe',
    'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe',
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('找不到 mysqld.exe, 请用 E2E_MYSQLD 指定路径');
}

function logFile(name) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  return path.join(LOG_DIR, name);
}

function spawnTo(file, args, outName) {
  const out = fs.openSync(logFile(outName), 'a');
  const child = spawn(file, args, { stdio: ['ignore', out, out], windowsHide: true });
  return child;
}

function waitTcp(port, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tryOnce = () => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) return resolve(false);
        setTimeout(tryOnce, 400);
      });
    };
    tryOnce();
  });
}

/**
 * mysqld 收到信号后仍会持有 datadir 一段时间(Windows 上尤其明显),
 * 处理不当会让下一次运行报 EBUSY。
 * Windows 上 child.kill() 只满足 libuv, mysqld.exe 会继续活着并占住端口,
 * 所以这里用 kill-tree 真杀进程树, 再等端口释放。
 */
async function stopMysqld(child, timeoutMs = 20000) {
  if (!child || child.exitCode !== null || child.signalCode) return;

  const exited = new Promise((resolve) => child.once('exit', resolve));
  const { killTree, waitPortFree } = await import('./kill-tree.mjs');

  if (!killTree(child)) child.kill();

  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise((resolve) => setTimeout(() => resolve(true), timeoutMs)),
  ]);

  if (timedOut) child.kill('SIGKILL');

  // 端口真正空出来才算结束, 否则下一次运行会连到"上一个实例"
  await waitPortFree(MYSQL_PORT, '127.0.0.1', 20000).catch(() => {});
}

/** 删除目录, 遇 EBUSY 重试 */
async function removeDirWithRetry(dir, attempts = 10) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return true;
    } catch (e) {
      if (i === attempts - 1) return false;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

async function waitFor(fn, { timeoutMs = 60000, intervalMs = 500, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`等待超时: ${label}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ---------- 供应商 mock ----------
// 按请求里的 image_size 生成对应比例的"供应商出图"(等比缩小, 省时间),
// 让 sharp 走完整的规范化路径 —— 这样"选了竖图真的拿到竖图"是被真实验证的。
let mockMode = 'b64';
let fetchCalls = [];
let lastRequestedSize = '1024x1024';
const realFetch = globalThis.fetch;

/** 按 image_size 造一张同比例的小图 */
async function makeMockImage(imageSize) {
  const [w, h] = String(imageSize).split('x').map(Number);
  const scale = 512 / Math.max(w, h);
  const width = Math.max(16, Math.round(w * scale));
  const height = Math.max(16, Math.round(h * scale));

  return sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } },
  })
    .png()
    .toBuffer();
}

function installFetchMock() {
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);

    // 只接管供应商相关请求; 测试自己对本地 API 的请求必须走真实 fetch,
    // 否则会把测试自己的调用也 mock 掉。
    if (target.startsWith('http://127.0.0.1:') || target.startsWith('http://localhost:')) {
      return realFetch(url, options);
    }

    fetchCalls.push({ url: target, options });

    if (mockMode === 'error500') {
      return new Response('upstream boom', { status: 500 });
    }
    if (mockMode === 'badHost') {
      return Response.json({ images: [{ url: 'https://evil.example.net/x.png' }] });
    }
    if (mockMode === 'empty') {
      return Response.json({ images: [] });
    }

    // 图片下载请求: 用最近一次生成请求里的尺寸造图
    if (target.startsWith('https://' + MOCK_HOST)) {
      const png = await makeMockImage(lastRequestedSize);
      return new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } });
    }

    // 生成请求
    try {
      lastRequestedSize = JSON.parse(options.body).image_size || '1024x1024';
    } catch {
      lastRequestedSize = '1024x1024';
    }

    return Response.json({
      images: [{ url: `https://${MOCK_HOST}/generated/${fetchCalls.length}.png` }],
    });
  };
}

// ---------- 主流程 ----------
async function main() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.rmSync(STORAGE_DIR, { recursive: true, force: true });

  const mysqld = findMysqld();
  let datadir = path.join(WORKSPACE, '.e2e-mysql-ai');
  // 上一次运行的实例可能还占着目录: 清不掉就换一个带后缀的目录
  if (!(await removeDirWithRetry(datadir))) {
    datadir = `${datadir}-${process.pid}-${Date.now() % 100000}`;
  }
  fs.mkdirSync(datadir, { recursive: true });

  log(`mysqld: ${mysqld}`);
  log('初始化临时数据目录 ...');
  const initCode = await new Promise((resolve) => {
    const child = spawnTo(mysqld, ['--no-defaults', '--initialize-insecure', `--datadir=${datadir}`], 'ai-mysqld-init.log');
    child.on('exit', resolve);
  });
  if (initCode !== 0) throw new Error('mysqld --initialize-insecure 失败, 见 .e2e-logs/ai-mysqld-init.log');

  for (const f of ['undo_001', 'undo_002', 'undo_1_trunc.log', 'undo_2_trunc.log']) {
    fs.rmSync(path.join(datadir, f), { force: true });
  }

  log(`启动 mysqld 127.0.0.1:${MYSQL_PORT} ...`);
  const mysqldChild = spawnTo(
    mysqld,
    [
      '--no-defaults',
      `--datadir=${datadir}`,
      `--port=${MYSQL_PORT}`,
      '--bind-address=127.0.0.1',
      '--skip-log-bin',
      '--log-error=' + logFile('ai-mysqld.err'),
    ],
    'ai-mysqld.out.log'
  );

  let app = null;
  let workshop = null;
  let server = null;

  try {
    if (!(await waitTcp(MYSQL_PORT))) throw new Error('mysqld 未就绪, 见 .e2e-logs/ai-mysqld.err');
    log('mysqld 就绪');

    // 建库 + 账号 + 结构
    const root = await createConnection({ host: '127.0.0.1', port: MYSQL_PORT, user: 'root', password: '' });
    await root.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
    await root.query(`CREATE DATABASE \`${DB_NAME}\` DEFAULT CHARSET utf8mb4`);
    for (const host of ['127.0.0.1', 'localhost']) {
      await root.query(`CREATE USER IF NOT EXISTS 'coc_app'@'${host}' IDENTIFIED BY '${DB_PASSWORD}'`);
      await root.query(`GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO 'coc_app'@'${host}'`);
    }
    await root.query('FLUSH PRIVILEGES');

    const connOpts = { host: '127.0.0.1', port: MYSQL_PORT, user: 'root', password: '', multipleStatements: true };
    const boot = await createConnection({ ...connOpts, database: DB_NAME });
    const schema = fs.readFileSync(path.join(SERVER_DIR, 'schema.sql'), 'utf8');
    await boot.query(schema);
    for (const file of fs.readdirSync(path.join(SERVER_DIR, 'migrations')).sort()) {
      await boot.query(fs.readFileSync(path.join(SERVER_DIR, 'migrations', file), 'utf8'));
    }
    await boot.end();
    await root.end();
    log('数据库结构与 004 迁移已应用');

    // 环境变量必须在 import 模块之前设好
    Object.assign(process.env, {
      PORT: String(API_PORT),
      DB_HOST: '127.0.0.1',
      DB_PORT: String(MYSQL_PORT),
      DB_USER: 'coc_app',
      DB_PASSWORD,
      DB_NAME,
      DB_POOL: '8',
      JWT_SECRET: 'e2e_jwt_secret',
      ADMIN_PASSWORD: 'e2e_admin_pw',
      VIEWER_PASSWORD: 'e2e_viewer_pw',
      SILICONFLOW_API_KEY: 'e2e_fake_key',
      AI_IMAGE_MODEL: 'Kwai-Kolors/Kolors',
      AI_IMAGE_SIZE: '1024x1024',
      AI_IMAGE_DOWNLOAD_HOSTS: MOCK_HOST,
      AI_STORAGE_DIR: STORAGE_DIR,
      AI_IDENTITY_SECRET: IDENTITY_SECRET,
      // 管理员不限次数(0); 非管理员 3 次便于测试打满; 全站 100 便于测兜底
      AI_DAILY_LIMIT: '0',
      AI_VIEWER_DAILY_LIMIT: '3',
      AI_VIEWER_UPLOAD_DAILY_LIMIT: '2',
      AI_GLOBAL_DAILY_LIMIT: '100',
      AI_TEMP_MAX_IMAGES: '10',
      DB_TEXT_PROTOCOL: '1', // 与 server/scripts/e2e-run.mjs 一致, 规避沙箱下的协议干扰
    });

    installFetchMock();

    const { createApp } = await import('../src/app.js');
    const { signToken } = await import('../src/lib/auth.js');
    const { pool } = await import('../src/db.js');
    const { businessDate } = await import('../src/lib/wheel.js');

    app = await createApp();
    workshop = app.locals;
    server = app.listen(API_PORT, '127.0.0.1');
    await waitTcp(API_PORT, 15000);

    // 账号体系改造后, 管理员 Token 必须对应 users 表里的真实账号
    // (resolveAuth 每次请求都会回查存在/启用/token_version), 所以这里建一个测试管理员。
    const { signUserToken, signViewerToken, hashPassword } = await import('../src/lib/auth.js');
    await pool.execute("DELETE FROM users WHERE username = 'e2e_ai_admin'");
    const [inserted] = await pool.execute(
      `INSERT INTO users (username, display_name, password_hash, role, enabled, token_version, must_change_password)
       VALUES ('e2e_ai_admin', 'E2E AI', ?, 'admin', 1, 1, 0)`,
      [hashPassword('e2e_ai_pw')]
    );
    const adminToken = signUserToken({ id: inserted.insertId, role: 'admin', token_version: 1 });
    const viewerToken = signViewerToken();
    const base = `http://127.0.0.1:${API_PORT}/api/ai-workshop`;

    async function call(pathname, { method = 'GET', token = adminToken, role, body, raw, ip } = {}) {
      // role='guest' 显式表示"未登录访客"(不带 Authorization)
      const useToken =
        role === 'viewer'
          ? viewerToken
          : role === 'admin'
            ? adminToken
            : role === 'guest'
              ? ''
              : token;
      const headers = {};
      if (useToken) headers.Authorization = 'Bearer ' + useToken;
      if (body && !raw) headers['Content-Type'] = 'application/json';
      // trust proxy = 1: 带上 X-Forwarded-For 就能模拟"另一个来源 IP"的访客
      if (ip) headers['X-Forwarded-For'] = ip;

      const response = await fetch(base + pathname, {
        method,
        headers,
        body: raw ? body : body ? JSON.stringify(body) : undefined,
      });

      const type = response.headers.get('content-type') || '';
      const label = `${method} ${pathname}`;

      if (type.includes('application/json')) {
        const json = await response.json();
        const out = { status: response.status, json, data: json.data, error: json.error };

        // 有 ok:false 或拿不到 data 时留痕, 便于定位(只影响未预期的响应)
        if (json.ok !== true) {
          console.log(`      [debug] ${label} -> ${response.status} ${JSON.stringify(json).slice(0, 300)}`);
        } else if (out.data === undefined) {
          console.log(`      [debug] ${label} -> ${response.status} 无 data 字段`);
        }
        return out;
      }

      console.log(`      [debug] ${label} -> ${response.status} (${type || 'binary'})`);
      return { status: response.status, blob: Buffer.from(await response.arrayBuffer()), type };
    }

    const token = () => 'tok_' + Math.random().toString(36).slice(2).padEnd(20, 'z');

    // 复现模块的身份键算法, 便于在测试里按身份统计任务
    const { createHmac: createHmacLocal } = await import('node:crypto');
    const hmacOf = (v) => createHmacLocal('sha256', IDENTITY_SECRET).update(v).digest('hex');

    /** 等当前所有任务都离开排队/运行态(模块限制"同身份同时只能有一个任务", 测试里串行提交) */
    async function waitNoActiveJobs() {
      await waitFor(
        async () => {
          const [rows] = await pool.query(
            "SELECT COUNT(*) AS n FROM ai_image_jobs WHERE status IN ('queued','running')"
          );
          return Number(rows[0].n) === 0;
        },
        { timeoutMs: 60000, intervalMs: 500, label: '等待上一个任务结束' }
      );
    }

    /**
     * 提交一个生成任务并等它跑完(终态)。
     * ip 用来模拟"另一个来源 IP 的访客"(trust proxy = 1, 读 X-Forwarded-For)。
     */
    async function submitJob({ role = 'admin', promptText = prompt, size, ip } = {}) {
      await waitNoActiveJobs();

      const created = await call('/jobs', {
        method: 'POST',
        role,
        ip,
        body: {
          client_token: token(),
          prompt: promptText,
          ...(size ? { image_size: size } : {}),
        },
      });

      if (created.status !== 202) return { create: created, final: null };

      const final = await waitFor(
        async () => {
          const r = await call(`/jobs/${created.data.id}`, { role, ip });
          const s = r.data && r.data.status;
          return s && !['queued', 'running'].includes(s) ? r.data : null;
        },
        { timeoutMs: 60000, intervalMs: 800, label: '任务到达终态' }
      );

      return { create: created, final };
    }

    // ============ 1. 权限 ============
    console.log('\n【1】权限与配置');
    const noAuth = await call('/config', { token: '' });
    checkEqual('未登录访客可读 /config -> 200', noAuth.status, 200);
    checkEqual('未登录访客 role=guest', noAuth.data.role, 'guest');
    check('未登录访客 can_create=true (App 端访客也能创作)', noAuth.data.can_create === true);
    checkEqual('未登录访客 daily_limit=3 (与非管理员同档, 按 IP 计)', noAuth.data.daily_limit, 3);

    const cfg = await call('/config');
    checkEqual('管理员 /config 200', cfg.status, 200);
    check('config.can_create=true', cfg.data.can_create === true);
    checkEqual('config.role=admin', cfg.data.role, 'admin');
    check('config.enabled=true (已配 key)', cfg.data.enabled === true);
    checkEqual('image_size 方图', cfg.data.image_size, '1024x1024');
    checkEqual('管理员 daily_limit=0 (不限次数)', cfg.data.daily_limit, 0);
    check('管理员 daily_unlimited=true', cfg.data.daily_unlimited === true);
    check('管理员 upload_unlimited=true', cfg.data.upload_unlimited === true);
    checkEqual('quota.actor_limit', cfg.data.quota.actor_limit, 10);
    checkEqual('quota.total_limit', cfg.data.quota.total_limit, 200);
    check('local_namespace 为 64 位十六进制(不泄露明文身份)', /^[0-9a-f]{64}$/.test(cfg.data.local_namespace));

    const viewerCfg = await call('/config', { role: 'viewer' });
    checkEqual('访客可读 /config', viewerCfg.status, 200);
    check('访客 can_create=true (已开放生成)', viewerCfg.data.can_create === true);
    checkEqual('访客 role=viewer', viewerCfg.data.role, 'viewer');
    checkEqual('访客 daily_limit=3', viewerCfg.data.daily_limit, 3);
    check('访客 daily_unlimited=false', viewerCfg.data.daily_unlimited === false);
    checkEqual('访客 upload_limit=2', viewerCfg.data.upload_limit, 2);
    checkEqual('访客命名空间与管理员不同', viewerCfg.data.local_namespace === cfg.data.local_namespace, false);

    // ============ 2. 参数校验 ============
    console.log('\n【2】参数校验');
    const badToken = await call('/jobs', { method: 'POST', body: { client_token: 'short', prompt: '你好' } });
    checkEqual('非法 client_token -> 400', badToken.status, 400);

    const emptyPrompt = await call('/jobs', { method: 'POST', body: { client_token: token(), prompt: '   ' } });
    checkEqual('空提示词 -> 400', emptyPrompt.status, 400);

    const longPrompt = await call('/jobs', { method: 'POST', body: { client_token: token(), prompt: '啊'.repeat(1001) } });
    checkEqual('超长提示词 -> 400', longPrompt.status, 400);

    const missingJob = await call('/jobs/00000000-0000-0000-0000-000000000000');
    checkEqual('查询不存在的任务 -> 404', missingJob.status, 404);

    const missingImage = await call('/jobs/00000000-0000-0000-0000-000000000000/image');
    checkEqual('取不存在任务的图片 -> 404', missingImage.status, 404);

    // ============ 3. 生成任务 + worker ============
    console.log('\n【3】生成任务与 worker');
    const prompt = '【角色动作】测试提示词';
    const t1 = token();
    const created = await call('/jobs', { method: 'POST', body: { client_token: t1, prompt } });
    checkEqual('创建任务 202', created.status, 202);
    checkEqual('初始状态 queued', created.data.status, 'queued');
    checkEqual('任务模型', created.data.model, 'Kwai-Kolors/Kolors');

    const again = await call('/jobs', { method: 'POST', body: { client_token: t1, prompt } });
    checkEqual('同编号同内容幂等 (200, 不重复计费)', again.status, 200);
    checkEqual('幂等返回同一任务', again.data.id, created.data.id);

    const conflict = await call('/jobs', { method: 'POST', body: { client_token: t1, prompt: '换了内容' } });
    checkEqual('同编号换内容 -> 409', conflict.status, 409);

    const dupActive = await call('/jobs', { method: 'POST', body: { client_token: token(), prompt } });
    checkEqual('已有排队/运行任务时再提交 -> 409', dupActive.status, 409);

    const done = await waitFor(
      async () => {
        const r = await call(`/jobs/${created.data.id}`);
        return r.data && r.data.status === 'succeeded' ? r.data : null;
      },
      { timeoutMs: 40000, intervalMs: 700, label: '任务变为 succeeded' }
    );
    check('worker 完成生成', done.status === 'succeeded');
    check('成功后记录过期时间', Boolean(done.expires_at), JSON.stringify(done));

    const rowAfter = await pool.query('SELECT file_name, file_bytes FROM ai_image_jobs WHERE id = ?', [created.data.id]);
    const storedName = rowAfter[0][0].file_name;
    check('临时文件已落盘', fs.existsSync(path.join(STORAGE_DIR, 'temporary', storedName)));

    const image = await call(`/jobs/${created.data.id}/image`);
    checkEqual('取生成图 200', image.status, 200);
    checkEqual('返回 webp', image.type, 'image/webp');
    check('图片非空', image.blob.length > 0);
    check('落盘的确实是 webp (RIFF/WEBP 魔数)', image.blob.toString('ascii', 0, 4) === 'RIFF' && image.blob.toString('ascii', 8, 12) === 'WEBP');

    const providerCall = fetchCalls.find((c) => c.url.includes('siliconflow'));
    check('确实调用了供应商接口', Boolean(providerCall));
    const providerBody = JSON.parse(providerCall.options.body);
    checkEqual('发送默认 image_size', providerBody.image_size, '1024x1024');
    checkEqual('提示词原样发送(不截断)', providerBody.prompt, prompt);
    check('不发送 denoising_strength(无图生图能力)', !('denoising_strength' in providerBody));
    check(
      '请求关闭平台水印 (X-Enable-Watermark: 0)',
      providerCall.options.headers['X-Enable-Watermark'] === '0'
    );
    check('发送 negative_prompt', typeof providerBody.negative_prompt === 'string' && providerBody.negative_prompt.length > 0);
    checkEqual('Kolors 发送 guidance_scale', providerBody.guidance_scale, 7.5);

    // ============ 3b. 竖图尺寸确实生效 ============
    console.log('\n【3b】尺寸参数');
    const squareJob = await call('/jobs', { method: 'POST', body: { client_token: token(), prompt } });
    const squareDone = await waitFor(
      async () => {
        const r = await call(`/jobs/${squareJob.data.id}`);
        return r.data && r.data.status === 'succeeded' ? r.data : null;
      },
      { timeoutMs: 40000, intervalMs: 700, label: '方图任务完成' }
    );
    const squareBlob = (await call(`/jobs/${squareJob.data.id}/image`)).blob;
    const squareMeta = await sharp(squareBlob).metadata();

    const portraitJob = await call('/jobs', {
      method: 'POST',
      body: { client_token: token(), prompt, image_size: '720x1280' },
    });
    const portraitDone = await waitFor(
      async () => {
        const r = await call(`/jobs/${portraitJob.data.id}`);
        return r.data && r.data.status === 'succeeded' ? r.data : null;
      },
      { timeoutMs: 40000, intervalMs: 700, label: '竖图任务完成' }
    );
    const portraitBlob = (await call(`/jobs/${portraitJob.data.id}/image`)).blob;
    const portraitMeta = await sharp(portraitBlob).metadata();

    checkEqual('方图任务成功', squareDone.status, 'succeeded');
    checkEqual('竖图任务成功', portraitDone.status, 'succeeded');
    check(
      '方图输出为正方形',
      squareMeta.width === squareMeta.height,
      `${squareMeta.width}x${squareMeta.height}`
    );
    check(
      '竖图输出为纵向(9:16 比例)',
      portraitMeta.height > portraitMeta.width,
      `${portraitMeta.width}x${portraitMeta.height}`
    );
    const portraitProvider = fetchCalls.filter((c) => c.url.includes('siliconflow')).pop();
    checkEqual(
      '竖图尺寸透传给供应商',
      JSON.parse(portraitProvider.options.body).image_size,
      '720x1280'
    );

    const badSize = await call('/jobs', {
      method: 'POST',
      body: { client_token: token(), prompt, image_size: '1280x720' },
    });
    checkEqual('不支持的尺寸 -> 400', badSize.status, 400);
    check(
      '尺寸错误信息可读',
      /不支持的图片尺寸/.test(badSize.error),
      `实际: ${JSON.stringify(badSize.error)}`
    );

    // ============ 4. 上传图库 / 删除释放 ============
    console.log('\n【4】上传图库与配额');
    const uploadPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=',
      'base64'
    );

    const upToken = token();
    const form = new FormData();
    form.append('client_token', upToken);
    form.append('file', new Blob([uploadPng], { type: 'image/png' }), 'x.png');
    const uploaded = await call('/gallery', { method: 'POST', body: form, raw: true });
    checkEqual('上传成功 201', uploaded.status, 201);
    check('上传返回 id', Boolean(uploaded.data.id));

    const dupUpload = await call('/gallery', { method: 'POST', body: (() => {
      const f = new FormData();
      f.append('client_token', upToken);
      f.append('file', new Blob([uploadPng], { type: 'image/png' }), 'x.png');
      return f;
    })(), raw: true });
    checkEqual('同编号同图片重复上传幂等', dupUpload.status, 200);
    check('返回 duplicated=true', dupUpload.data.duplicated === true);

    const list = await call('/gallery');
    checkEqual('图库列表 200', list.status, 200);
    checkEqual('图库有 1 张', list.data.items.length, 1);
    check('列表标记 can_delete', list.data.items[0].can_delete === true);

    const thumb = await call(`/gallery/${uploaded.data.id}/image?thumb=1`);
    checkEqual('缩略图 200', thumb.status, 200);
    const full = await call(`/gallery/${uploaded.data.id}/image`);
    checkEqual('原图 200', full.status, 200);

    const quota = (await call('/config')).data.quota;
    checkEqual('配额计数 total=1', quota.total, 1);
    checkEqual('配额计数 actor=1', quota.actor, 1);

    const del = await call(`/gallery/${uploaded.data.id}`, { method: 'DELETE' });
    checkEqual('删除图片 200', del.status, 200);
    checkEqual('删除后图库为空', (await call('/gallery')).data.items.length, 0);
    checkEqual('删除后释放配额', (await call('/config')).data.quota.total, 0);
    checkEqual('删除后取原图 404', (await call(`/gallery/${uploaded.data.id}/image`)).status, 404);

    // ============ 5. 上传拒绝分支 ============
    console.log('\n【5】上传校验');
    const notImage = await call('/gallery', {
      method: 'POST',
      raw: true,
      body: (() => {
        const f = new FormData();
        f.append('client_token', token());
        f.append('file', new Blob([Buffer.from('<html>hi</html>')], { type: 'text/html' }), 'e.html');
        return f;
      })(),
    });
    checkEqual('非图片文件 -> 400', notImage.status, 400);

    const badUpToken = await call('/gallery', {
      method: 'POST',
      raw: true,
      body: (() => {
        const f = new FormData();
        f.append('client_token', 'no');
        f.append('file', new Blob([uploadPng], { type: 'image/png' }), 'x.png');
        return f;
      })(),
    });
    checkEqual('上传 client_token 非法 -> 400', badUpToken.status, 400);

    // ============ 6. 供应商异常分支 ============
    console.log('\n【6】供应商异常处理');
    mockMode = 'badHost';
    const badHostJob = await call('/jobs', { method: 'POST', body: { client_token: token(), prompt } });
    const badHostDone = await waitFor(
      async () => {
        const r = await call(`/jobs/${badHostJob.data.id}`);
        return r.data && r.data.status !== 'queued' && r.data.status !== 'running' ? r.data : null;
      },
      { timeoutMs: 30000, intervalMs: 700, label: '不可信域名任务结束' }
    );
    checkEqual('不在可信列表的图片域名 -> failed', badHostDone.status, 'failed');
    check(
      '失败原因可定位(提示白名单)',
      /AI_IMAGE_DOWNLOAD_HOSTS/.test(badHostDone.error),
      `实际: ${JSON.stringify(badHostDone.error)}`
    );

    mockMode = 'error500';
    const errJob = await call('/jobs', { method: 'POST', body: { client_token: token(), prompt } });
    const errDone = await waitFor(
      async () => {
        const r = await call(`/jobs/${errJob.data.id}`);
        return r.data && r.data.status !== 'queued' && r.data.status !== 'running' ? r.data : null;
      },
      { timeoutMs: 30000, intervalMs: 700, label: 'HTTP 500 任务结束' }
    );
    checkEqual('供应商 500 -> failed', errDone.status, 'failed');
    check(
      '失败原因可定位(带 HTTP 状态)',
      /HTTP 500/.test(errDone.error),
      `实际: ${JSON.stringify(errDone.error)}`
    );

    mockMode = 'empty';
    const emptyJob = await call('/jobs', { method: 'POST', body: { client_token: token(), prompt } });
    const emptyDone = await waitFor(
      async () => {
        const r = await call(`/jobs/${emptyJob.data.id}`);
        return r.data && r.data.status !== 'queued' && r.data.status !== 'running' ? r.data : null;
      },
      { timeoutMs: 30000, intervalMs: 700, label: '空结果任务结束' }
    );
    checkEqual('供应商返回空图片 -> failed', emptyDone.status, 'failed');

    // 关键: 恢复 mock 状态, 否则后面所有生成都会拿到"没有图片"的响应
    mockMode = 'b64';

    // ============ 7. 身份隔离 ============
    console.log('\n【7】身份隔离');
    const viewerGallery = await call('/gallery', { token: viewerToken });
    checkEqual('访客可读图库', viewerGallery.status, 200);
    // 其他身份的临时图不可见 (viewer 的 actorKey 与 admin 不同 -> 404)
    checkEqual('访客取管理员的任务 -> 404', (await call(`/jobs/${created.data.id}`, { token: viewerToken })).status, 404);

    // ============ 8. 维护任务 ============
    console.log('\n【8】过期与清理');
    // 把第一张临时图改成已过期, 触发 maintenance
    await pool.query(
      "UPDATE ai_image_jobs SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE) WHERE id = ?",
      [created.data.id]
    );
    await waitFor(
      async () => {
        const [rows] = await pool.query('SELECT status FROM ai_image_jobs WHERE id = ?', [created.data.id]);
        return rows[0].status === 'expired' ? rows[0] : null;
      },
      { timeoutMs: 90000, intervalMs: 2000, label: '维护任务标记过期' }
    );
    check('过期任务被标记 expired', true);
    check('过期后文件被清理', !fs.existsSync(path.join(STORAGE_DIR, 'temporary', storedName)));
    checkEqual('过期后取图 404', (await call(`/jobs/${created.data.id}/image`)).status, 404);

    // ============ 9. 每日额度: 管理员不限 / 非管理员受限 ============
    console.log('\n【9】按角色的每日额度');

    // 管理员已经跑了 3 个成功任务, 上限为 0 表示不限, 仍应能继续提交
    const adminUsed = (await call('/config')).data.daily_used;
    check('管理员已用次数 >= 3', adminUsed >= 3, `实际 ${adminUsed}`);
    check('管理员 daily_limit 仍为 0', (await call('/config')).data.daily_limit === 0);

    // 非管理员上限 3: 用完 3 次后第 4 次必须被拒
    // (模块限制同身份同时只能有一个任务, 所以逐次提交并等完成)
    for (let i = 1; i <= 3; i += 1) {
      const r = await submitJob({ role: 'viewer' });
      checkEqual(`访客第 ${i} 次生成被接受`, r.create.status, 202);
      check(
        `访客第 ${i} 次生成成功`,
        r.final?.status === 'succeeded',
        `状态=${r.final?.status} 错误=${JSON.stringify(r.final?.error)}`
      );
    }

    const viewerCfg2 = await call('/config', { role: 'viewer' });
    checkEqual('访客已用 3 次', viewerCfg2.data.daily_used, 3);

    const viewer4th = await call('/jobs', { method: 'POST', role: 'viewer', body: { client_token: token(), prompt } });
    checkEqual('访客第 4 次被拒 -> 429', viewer4th.status, 429);
    check(
      '访客额度提示写明每天次数',
      /非管理员每天 3 次/.test(viewer4th.error),
      `实际: ${JSON.stringify(viewer4th.error)}`
    );

    // 管理员不受影响, 继续可用(证明额度是按角色分档, 不是全站一起限)
    const adminAgain = await submitJob();
    checkEqual('访客额度用完后管理员仍可生成', adminAgain.create.status, 202);

    // ============ 10. 全站兜底额度 ============
    console.log('\n【10】全站每日上限');

    // 关键: 必须用一个"个人额度还没用完"的身份来测,
    // 否则先被个人额度拦住, 根本走不到全站判断(会误判成全站校验失效)。
    // 管理员个人额度不限, 所以能确定下面拦下来的是"全站"这一层。
    const [cumulative] = await pool.query(
      'SELECT COUNT(*) AS total FROM ai_image_jobs WHERE business_day = ?',
      [businessDate()]
    );
    const need = 100 - Number(cumulative[0].total);
    check('当前全站任务数不足上限, 准备种子数据', need > 0, `当前 ${cumulative[0].total}`);

    for (let i = 0; i < need; i += 1) {
      await pool.query(
        `INSERT INTO ai_image_jobs
           (id, actor_key, client_token, request_hash, prompt, model, image_size, status, business_day)
         VALUES (?, ?, ?, ?, 'seed-global', 'Kwai-Kolors/Kolors', '1024x1024', 'failed', ?)`,
        [
          `s${String(i).padStart(3, '0')}-${Date.now()}`.slice(0, 36),
          'seed_actor_key',
          `seedglobal_${i}_${'y'.repeat(16)}`,
          'f'.repeat(64),
          businessDate(),
        ]
      );
    }

    const globalBlocked = await call('/jobs', { method: 'POST', body: { client_token: token(), prompt } });
    checkEqual('全站额度用满 -> 429', globalBlocked.status, 429);
    check(
      '提示的是全站额度(管理员个人不限, 说明是全站层拦下的)',
      /全站今日生成额度已用完/.test(globalBlocked.error),
      `实际: ${JSON.stringify(globalBlocked.error)}`
    );

    await pool.query("DELETE FROM ai_image_jobs WHERE prompt = 'seed-global'");

    // 清理后管理员应恢复可生成(证明上面拦下来的确实是全站额度)
    const afterCleanup = await submitJob();
    checkEqual('清理种子后管理员恢复可生成', afterCleanup.create.status, 202);

    // ============ 11. 非管理员上传日限 ============
    console.log('\n【11】非管理员上传日限');
    const smallPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=',
      'base64'
    );
    const viewerForm = () => {
      const f = new FormData();
      f.append('client_token', token());
      f.append('file', new Blob([smallPng], { type: 'image/png' }), 'v.png');
      return f;
    };

    const vUp1 = await call('/gallery', { method: 'POST', role: 'viewer', body: viewerForm(), raw: true });
    checkEqual('访客上传第 1 张成功', vUp1.status, 201);
    const vUp2 = await call('/gallery', { method: 'POST', role: 'viewer', body: viewerForm(), raw: true });
    checkEqual('访客上传第 2 张成功', vUp2.status, 201);
    const vUp3 = await call('/gallery', { method: 'POST', role: 'viewer', body: viewerForm(), raw: true });
    checkEqual('访客上传第 3 张被拒 -> 429', vUp3.status, 429);
    check(
      '上传额度提示写明张数',
      /每天 2 张/.test(vUp3.error),
      `实际: ${JSON.stringify(vUp3.error)}`
    );

    const vCfg = await call('/config', { role: 'viewer' });
    checkEqual('访客 upload_used=2', vCfg.data.upload_used, 2);

    // 管理员不受该日限
    const aUp = await call('/gallery', {
      method: 'POST',
      raw: true,
      body: (() => {
        const f = new FormData();
        f.append('client_token', token());
        f.append('file', new Blob([smallPng], { type: 'image/png' }), 'a.png');
        return f;
      })(),
    });
    checkEqual('管理员上传不受非管理员日限约束', aUp.status, 201);

    // 收尾: 删掉本次上传的图, 释放图库配额
    for (const up of [vUp1, vUp2, aUp]) {
      if (up?.data?.id) await call(`/gallery/${up.data.id}`, { method: 'DELETE', role: 'admin' });
    }

    // ============ 12. 未登录访客: 按 IP 计额度 ============
    console.log('\n【12】未登录访客(按 IP 计额度)');
    const guestCfg = await call('/config', { token: '' });
    check(
      '未登录访客可读配置且能创作',
      guestCfg.status === 200 && guestCfg.data.can_create === true && guestCfg.data.role === 'guest'
    );
    checkEqual(
      '同 IP 的未登录访客与访客口令身份共用一份额度',
      guestCfg.data.daily_used,
      (await call('/config', { role: 'viewer' })).data.daily_used
    );
    checkEqual('因此同 IP 的额度已经被访客口令身份用满', guestCfg.data.daily_used, 3);

    const guestBlocked = await call('/jobs', {
      method: 'POST',
      token: '',
      body: { client_token: token(), prompt },
    });
    checkEqual('同一 IP 上未登录访客额度用完 -> 429', guestBlocked.status, 429);
    check(
      '额度提示写明每天次数',
      /非管理员每天 3 次/.test(guestBlocked.error),
      `实际: ${JSON.stringify(guestBlocked.error)}`
    );

    // 换一个来源 IP(另一台设备/另一个网络): 未登录访客应当能直接生成
    const OTHER_IP = '203.0.113.77';
    const otherCfg = await call('/config', { token: '', ip: OTHER_IP });
    checkEqual('新 IP 的额度从 0 开始(按 IP 限额生效)', otherCfg.data.daily_used, 0);
    checkEqual('新 IP 的图库 IP 计数也是 0', otherCfg.data.quota.ip, 0);
    checkEqual(
      '本机图库分区不随 IP 变化(换网络不会"丢图")',
      otherCfg.data.local_namespace,
      guestCfg.data.local_namespace
    );

    const guestJob = await submitJob({ role: 'guest', ip: OTHER_IP });
    checkEqual('未登录访客(新 IP)提交生成 -> 202', guestJob.create.status, 202);
    check(
      '未登录访客(新 IP)生成成功',
      guestJob.final?.status === 'succeeded',
      `状态=${guestJob.final?.status} 错误=${JSON.stringify(guestJob.final?.error)}`
    );

    const otherCfg2 = await call('/config', { token: '', ip: OTHER_IP });
    checkEqual('新 IP 的已用次数变成 1', otherCfg2.data.daily_used, 1);
    checkEqual(
      '旧 IP 的额度不受新 IP 影响',
      (await call('/config', { token: '' })).data.daily_used,
      3
    );

    // IP 只以 HMAC 形式入库, 不落明文
    const [guestRows] = await pool.query(
      'SELECT actor_key FROM ai_image_jobs WHERE actor_key = ? LIMIT 5',
      [hmacOf(`actor:ip:${OTHER_IP}`)]
    );
    checkEqual('生成任务按 HMAC("actor:ip:<IP>") 归属身份', guestRows.length >= 1, true);
    check(
      '入库的身份键不包含明文 IP',
      guestRows.every((row) => !String(row.actor_key).includes(OTHER_IP)),
      JSON.stringify(guestRows)
    );
  } finally {
    try {
      await fetch('http://127.0.0.1:' + API_PORT + '/api/health').catch(() => {});
    } catch {
      /* ignore */
    }
    try {
      app?.locals?.closeAiWorkshop?.();
    } catch {
      /* ignore */
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    try {
      const { pool } = await import('../src/db.js');
      await pool.end();
    } catch {
      /* ignore */
    }
    await stopMysqld(mysqldChild);
  }

  console.log(`\n[ai-e2e] 通过 ${passed} 项, 失败 ${failures.length} 项`);
  if (failures.length) {
    console.log('[ai-e2e] 失败明细:');
    failures.forEach((f) => console.log('   - ' + f));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('[ai-e2e] 运行失败:', e);
  process.exitCode = 1;
});
