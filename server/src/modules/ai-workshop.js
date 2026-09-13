// AI 创作工坊 (生图) 后端模块
//
// 设计要点 (与 deploy/DEPLOY.md 的部署前提一致):
//   - 只服务本项目自己的 MySQL 库 coc_points, 不碰 Typecho;
//   - 图片文件写在 AI_STORAGE_DIR 下(必须在 Nginx 静态目录之外), 数据库只存元数据;
//   - 生成是异步任务: POST /jobs 入队 -> 后台 worker 调供应商 -> 前端轮询 -> 取临时图;
//   - 临时图片 30 分钟过期; 主动上传的图片进图库(全局 200 / 单 IP 10 / 单身份 10);
//   - 所有配额变更走 ai_workshop_guard 单行锁 + 事务, 并发下不会突破上限。
//
// 权限: 本模块挂在 /api 之后, 因此:
//   - 所有接口都要登录 (authRequired);
//   - 非 GET 请求已被全局 requireAdmin 拦成管理员专属。
//   模块内再用 requireCreator 兜一层(防御性, 不依赖挂载顺序)。
//
// 明确不做 (避免误导):
//   - 不做图生图 / 参考图身份保持 / 高清修复原图 -> 不发送 denoising_strength;
//   - 不提供"下载任意 URL"的代理, 只信任 AI_IMAGE_DOWNLOAD_HOSTS 里的域名;
//   - 上游调用失败不自动重试 (避免不确定状态重复计费)。
//
// 尺寸与参数依据 (https://docs.siliconflow.cn/docs/api/images-generations-post):
//   - Kwai-Kolors/Kolors 的 image_size 推荐值: 1024x1024(1:1) / 960x1280(3:4) /
//     768x1024(3:4) / 720x1440(1:2) / 720x1280(9:16) -> 竖图是可用的;
//   - 平台自 2026-09-30 起默认给生成图加"AI 生成"水印,
//     需要显式传 Header X-Enable-Watermark: 0 才会输出无水印图;
//   - negative_prompt / guidance_scale 都是该接口的正式字段(guidance_scale 仅 Kolors)。

import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID, createHash, createHmac } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';

import { query, getOne, transaction } from '../db.js';
import { ok, fail } from '../lib/respond.js';
import { businessDate } from '../lib/wheel.js';

const MAX_GALLERY = 200; // 服务器图库上限
const MAX_PER_IP = 10; // 单 IP 上限
const MAX_PER_ACTOR = 10; // 单身份上限

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 上传/落盘后上限
const MAX_SOURCE_BYTES = 16 * 1024 * 1024; // 供应商返回的原始图片上限
const MAX_PROVIDER_BYTES = 24 * 1024 * 1024; // 供应商响应体上限

const TEMP_TTL_MINUTES = 30; // 临时图片有效期
const ORPHAN_GRACE_MS = 60 * 60 * 1000; // 孤儿文件清理宽限期

const ACTIVE_STATES = ['pending', 'ready', 'deleting'];
const ACTIVE_JOB_STATES = ['queued', 'running', 'succeeded'];

const GENERATE_TIMEOUT_MS = 180_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

const WORKER_INTERVAL_MS = 1500;
const MAINTENANCE_INTERVAL_MS = 60_000;

const PROVIDER_URL = 'https://api.siliconflow.cn/v1/images/generations';

// Kwai-Kolors/Kolors 官方推荐尺寸。竖图可用, 但换模型(如 Qwen-Image 系列)时
// 推荐值完全不同, 所以这里做白名单校验, 避免把不支持的尺寸发给供应商。
const ALLOWED_IMAGE_SIZES = new Set([
  '1024x1024',
  '960x1280',
  '768x1024',
  '720x1440',
  '720x1280',
]);

// 平台从 2026-09-30 起默认加水印; 本工坊明确"不添加文字/水印", 故默认请求无水印。
const SEND_WATERMARK_DISABLE = process.env.AI_ENABLE_WATERMARK !== '1';

// negative_prompt 是 Kolors 接口的正式字段(默认开启);
// 留一个开关, 便于日后换模型时关掉。
const SEND_NEGATIVE_PROMPT = process.env.AI_SEND_NEGATIVE_PROMPT !== '0';

const DEFAULT_NEGATIVE_PROMPT = [
  '模糊',
  '低清晰度',
  '人物比例失衡',
  '多余肢体',
  '手指畸形',
  '重复人物',
  '文字',
  '水印',
  'logo',
  '聊天界面',
  '对话框',
  '塑料皮肤',
  '蜡像质感',
  '过度磨皮',
  '油腻高光',
  '强镜面反光',
].join('，');

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

/** 允许 0 的整数解析: 0 在这些配额里表示"不限制" */
function nonNegativeInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function validateClientToken(value) {
  const token = String(value || '');
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(token)) {
    throw httpError(400, 'client_token 格式错误');
  }
  return token;
}

function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function normalizeIp(value) {
  const ip = String(value || '').trim().toLowerCase();
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

async function unlinkIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

// 先写临时名再 rename, 避免读者看到半截文件
async function writeAtomic(filePath, buffer) {
  const temporary = `${filePath}.${randomUUID()}.part`;
  try {
    await fs.writeFile(temporary, buffer, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, filePath);
  } finally {
    await unlinkIfExists(temporary).catch(() => {});
  }
}

function assertRasterMagic(buffer) {
  const png =
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  const jpeg =
    buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

  const webp =
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP';

  if (!png && !jpeg && !webp) {
    throw httpError(400, '只接受 PNG、JPEG、WebP 静态图片');
  }
}

// 读取并限制响应体大小, 不把上游内容无上限读进内存
async function readLimitedResponse(response, maxBytes) {
  if (!response.body) throw new Error('响应没有内容');

  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body.cancel();
    throw new Error('响应图片过大');
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('响应内容超过大小限制');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
}

/**
 * 校验并规范化供应商返回的原始图片。
 * 放在模块作用域, 便于单独测试(见 scripts/test-ai-provider-live.mjs)。
 */
export async function normalizeImage(buffer, sharp) {
  assertRasterMagic(buffer);

  const options = { limitInputPixels: 16_000_000, failOn: 'error' };
  const metadata = await sharp(buffer, options).metadata();

  if (!['png', 'jpeg', 'webp'].includes(metadata.format)) {
    throw httpError(400, '图片格式不支持');
  }
  if ((metadata.pages || 1) > 1) {
    throw httpError(400, '暂不支持动态图片');
  }

  const output = await sharp(buffer, options)
    .rotate()
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 90 })
    .toBuffer();

  if (output.length > MAX_UPLOAD_BYTES) {
    throw httpError(400, '处理后的图片仍超过 8 MB');
  }
  return output;
}

/**
 * 调用供应商生成图片, 并把结果取回来规范化成 webp。
 *
 * 这是整条链路上最容易随供应商变化而失效的一段, 所以整体放在模块作用域、
 * 只依赖显式传入的配置 —— 可以用真实账号直接测试(scripts/test-ai-provider-live.mjs),
 * 不需要数据库。
 *
 * @param {object} job 至少含 { prompt, model, image_size }
 * @param {object} cfg 显式配置: apiKey / imageSize / downloadHosts / sharp / logger
 */
export async function generateWithProvider(job, cfg) {
  const { apiKey, imageSize, downloadHosts, sharp, logger = console } = cfg;

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // 不加这个 Header 时平台会往生成图上打"AI 生成"水印
  if (SEND_WATERMARK_DISABLE) headers['X-Enable-Watermark'] = '0';

  const payload = {
    model: job.model,
    prompt: job.prompt,
    image_size: job.image_size || imageSize,
    num_inference_steps: 20,
  };

  if (String(job.model).startsWith('Kwai-Kolors/')) payload.guidance_scale = 7.5;
  if (SEND_NEGATIVE_PROMPT) payload.negative_prompt = DEFAULT_NEGATIVE_PROMPT;

  const response = await fetch(PROVIDER_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
  });

  const body = await readLimitedResponse(response, MAX_PROVIDER_BYTES);

  if (!response.ok) {
    // 不把供应商原始响应直接透给前端, 避免泄露内部信息
    logger.error('[ai-workshop] provider HTTP', response.status, body.toString('utf8').slice(0, 500));
    throw new Error(`生图服务返回 HTTP ${response.status}`);
  }

  let data;
  try {
    data = JSON.parse(body.toString('utf8'));
  } catch {
    throw new Error('生图服务返回格式异常');
  }

  const first = data.images?.[0] || data.data?.[0];
  if (!first) throw new Error('生图结果中没有图片');

  if (first.b64_json) {
    const raw = Buffer.from(first.b64_json, 'base64');
    if (raw.length > MAX_SOURCE_BYTES) throw new Error('生成图片过大');
    return normalizeImage(raw, sharp);
  }

  if (!first.url) throw new Error('无法识别生成图片地址');

  const imageUrl = new URL(first.url);

  if (
    imageUrl.protocol !== 'https:' ||
    imageUrl.username ||
    imageUrl.password ||
    (imageUrl.port && imageUrl.port !== '443') ||
    !downloadHosts.has(imageUrl.hostname.toLowerCase())
  ) {
    logger.error('[ai-workshop] blocked image host:', imageUrl.hostname);
    throw new Error('生成图片域名未加入服务器可信列表');
  }

  const imageResponse = await fetch(imageUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!imageResponse.ok) throw new Error('生成图片下载失败');

  const imageBuffer = await readLimitedResponse(imageResponse, MAX_SOURCE_BYTES);
  return normalizeImage(imageBuffer, sharp);
}

/**
 * 创建 AI 工坊模块。
 *
 * @param {object} options
 * @param {import('mysql2/promise').Pool} options.pool mysql2/promise 连接池
 * @param {Function} options.shaper sharp 模块(可注入, 便于测试)
 * @returns {Promise<{router: import('express').Router, close: () => void}>}
 */
export async function createAiWorkshop({ pool, shaper, logger = console } = {}) {
  if (!pool) throw new Error('createAiWorkshop 需要 mysql2/promise 连接池');

  const sharp = shaper || (await import('sharp')).default;

  const apiKey = process.env.SILICONFLOW_API_KEY || '';
  const model = process.env.AI_IMAGE_MODEL || 'Kwai-Kolors/Kolors';

  const configuredSize = process.env.AI_IMAGE_SIZE || '1024x1024';
  if (!ALLOWED_IMAGE_SIZES.has(configuredSize)) {
    throw new Error(
      `AI_IMAGE_SIZE=${configuredSize} 不在当前模型的推荐值内 (${[...ALLOWED_IMAGE_SIZES].join(' / ')}), ` +
        '换模型时请先核对官方文档'
    );
  }
  const imageSize = configuredSize;

  const identitySecret = process.env.AI_IDENTITY_SECRET || '';
  if (identitySecret.length < 32) {
    throw new Error(
      'AI_IDENTITY_SECRET 至少需要 32 个字符 (openssl rand -hex 32), 用于对 IP 与身份做 HMAC'
    );
  }

  const root = path.resolve(process.env.AI_STORAGE_DIR || './data/ai');
  const galleryDir = path.join(root, 'gallery');
  const temporaryDir = path.join(root, 'temporary');

  await fs.mkdir(galleryDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(temporaryDir, { recursive: true, mode: 0o700 });

  // ---- 每日生成额度 (按角色分档) ----
  // AI_DAILY_LIMIT        管理员每身份每日生成上限; 0 = 不限制
  // AI_VIEWER_DAILY_LIMIT 非管理员(访客口令 / 未登录访客)每 IP 每日生成上限
  // AI_GLOBAL_DAILY_LIMIT 全站每日生成上限(所有角色合计), 兜底防刷
  const adminDailyLimit = nonNegativeInteger(process.env.AI_DAILY_LIMIT, 0);
  const viewerDailyLimit = positiveInteger(process.env.AI_VIEWER_DAILY_LIMIT, 10);
  const globalDailyLimit = positiveInteger(process.env.AI_GLOBAL_DAILY_LIMIT, 2000);

  // 上传是另一套额度, 与生成无关
  // AI_VIEWER_UPLOAD_DAILY_LIMIT 非管理员每 IP 每日上传张数; 0 = 不限制
  const viewerUploadDailyLimit = nonNegativeInteger(process.env.AI_VIEWER_UPLOAD_DAILY_LIMIT, 10);

  const temporaryLimit = positiveInteger(process.env.AI_TEMP_MAX_IMAGES, 20);

  /** 该身份当日可用的生成额度上限; 0 表示不限制 */
  function dailyLimitFor(isAdmin) {
    return isAdmin ? adminDailyLimit : viewerDailyLimit;
  }

  const downloadHosts = new Set(
    String(process.env.AI_IMAGE_DOWNLOAD_HOSTS || '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );

  const hmac = (value) => createHmac('sha256', identitySecret).update(value).digest('hex');

  // 配额相关的读改写都串行在这一个锁行上, 避免并发把 200/10 张冲破
  async function locked(fn) {
    return transaction(async (con) => {
      await con.execute('SELECT id FROM ai_workshop_guard WHERE id = 1 FOR UPDATE');
      return fn(con);
    });
  }

  const router = Router();

  // 身份解析: 登录角色 + IP -> HMAC 键。不保存明文 IP / 身份。
  router.use((req, res, next) => {
    const rawRole = req.auth?.role;
    if (req.auth?.invalidToken) {
      return next(httpError(401, '登录已失效, 请重新登录'));
    }

    const isAdminRole = ['super_admin', 'admin'].includes(rawRole);
    const isViewer = rawRole === 'viewer';
    const isGuest = !rawRole || rawRole === 'guest';
    if (!isAdminRole && !isViewer && !isGuest) {
      return next(httpError(401, '请先登录'));
    }

    // 共享管理员登录是一个管理身份, 不伪称能区分管理员个人;
    // 非管理员(访客口令 / 未登录访客)一律按 IP 派生身份:
    //   "每天 N 次"的生成额度因此天然就是"每 IP 每天 N 次",
    //   不需要再引入一份按 IP 的计数(ip_key 仍单独用于图库的 IP 上限)。
    // 与 ipKey 一样, IP 只以 HMAC 形式参与比对与入库, 不落明文。
    const ip = normalizeIp(req.ip);
    if (!ip) return next(httpError(400, '无法识别请求来源'));

    const actorSource = isAdminRole ? 'shared-admin' : `ip:${ip}`;

    req.aiIdentity = {
      actorKey: hmac(`actor:${actorSource}`),
      ipKey: hmac(`ip:${ip}`),
      // 只用于客户端的"本机图库分区", 必须跨网络稳定:
      // 手机上切一次 WiFi / 换一次蜂窝网络 IP 就变, 若跟着 IP 走, 用户会
      // 觉得"之前存的图不见了"。额度仍按上面的 actorKey(非管理员=按 IP)算。
      namespaceKey: hmac(`actor:${isAdminRole ? 'shared-admin' : 'shared-viewer'}`),
      // 未登录访客也能创作(移动端 App 就是拿不到账号的成员在用):
      // 额度按上面的 actorKey 计算, 另有 AI_GLOBAL_DAILY_LIMIT 全站兜底,
      // 以及图库的 MAX_PER_IP / MAX_PER_ACTOR 双重上限。
      canCreate: true,
      isAdmin: isAdminRole,
      role: rawRole || 'guest',
    };
    next();
  });

  function requireCreator(req, res, next) {
    if (!req.aiIdentity.canCreate) {
      return next(httpError(403, '当前角色不能生成图片'));
    }
    next();
  }

  function publicJob(row) {
    return {
      id: row.id,
      status: row.status,
      model: row.model,
      error: row.error_message || '',
      created_at: row.created_at,
      expires_at: row.expires_at,
    };
  }

  /**
   * 解析请求里的 image_size。
   * 只接受白名单内的值(见 ALLOWED_IMAGE_SIZES); 不传则用服务器默认值。
   */
  function resolveImageSize(value) {
    if (value === undefined || value === null || value === '') return imageSize;

    const size = String(value);
    if (!ALLOWED_IMAGE_SIZES.has(size)) {
      throw httpError(400, `不支持的图片尺寸: ${size}`);
    }
    return size;
  }

  function galleryQuota(con, actorKey, ipKey) {
    // 用 con.execute 而不是 con.query: db.js 的 textProtocol 兼容层只保证 execute,
    // pool.getConnection() 原样返回的连接上没有 query 方法。
    return con
      .execute(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(actor_key = ?), 0) AS actor_count,
           COALESCE(SUM(ip_key = ?), 0) AS ip_count
         FROM ai_gallery_images
         WHERE status IN (${ACTIVE_STATES.map(() => '?').join(',')})`,
        [actorKey, ipKey, ...ACTIVE_STATES]
      )
      .then(([rows]) => ({
        total: Number(rows[0].total),
        actor: Number(rows[0].actor_count),
        ip: Number(rows[0].ip_count),
        total_limit: MAX_GALLERY,
        actor_limit: MAX_PER_ACTOR,
        ip_limit: MAX_PER_IP,
      }));
  }

  // ---- 配置 / 配额 ----
  router.get(
    '/config',
    asyncRoute(async (req, res) => {
      const identity = req.aiIdentity;

      const used = await getOne(
        'SELECT COUNT(*) AS used FROM ai_image_jobs WHERE actor_key = ? AND business_day = ?',
        [identity.actorKey, businessDate()]
      );

      const quota = await locked((con) => galleryQuota(con, identity.actorKey, identity.ipKey));

      const limit = dailyLimitFor(identity.isAdmin);

      // 非管理员的上传额度看"今天已经上传了几张"
      const uploadedToday = await getOne(
        `SELECT COUNT(*) AS used FROM ai_gallery_images
         WHERE actor_key = ? AND DATE(created_at) = ?`,
        [identity.actorKey, businessDate()]
      );

      ok(res, {
        can_create: identity.canCreate,
        role: identity.role,
        // 客户端只拿它给"本机图库"分区(以及暂存任务编号), 所以给固定键:
        // 换网络/换 IP 不会让用户以为图片丢了。额度看下面的 daily_used/daily_limit。
        local_namespace: identity.namespaceKey,
        model,
        image_size: imageSize,
        enabled: Boolean(apiKey),
        daily_used: Number(used?.used || 0),
        // 0 表示不限制(管理员); 前端据此显示"无限"
        daily_limit: limit,
        daily_unlimited: limit === 0,
        upload_used: Number(uploadedToday?.used || 0),
        upload_limit: identity.isAdmin ? 0 : viewerUploadDailyLimit,
        upload_unlimited: identity.isAdmin || viewerUploadDailyLimit === 0,
        quota,
      });
    })
  );

  // ---- 提交生成任务 (幂等: 同 client_token 同内容返回原任务) ----
  router.post(
    '/jobs',
    requireCreator,
    asyncRoute(async (req, res) => {
      if (!apiKey) throw httpError(503, '管理员尚未配置生图服务');

      const token = validateClientToken(req.body?.client_token);
      const prompt = String(req.body?.prompt || '').trim();

      if (!prompt || prompt.length > 1000) {
        throw httpError(400, '提示词长度应为 1～1000 个字符');
      }

      const actorKey = req.aiIdentity.actorKey;
      const isAdmin = req.aiIdentity.isAdmin;
      const size = resolveImageSize(req.body?.image_size);
      const requestHash = sha256(JSON.stringify({ prompt, model, image_size: size }));

      const job = await locked(async (con) => {
        const [existing] = await con.execute(
          'SELECT * FROM ai_image_jobs WHERE actor_key = ? AND client_token = ?',
          [actorKey, token]
        );

        if (existing.length) {
          if (existing[0].request_hash !== requestHash) {
            throw httpError(409, '同一请求编号不能提交不同内容');
          }
          // 幂等重放: 明确告知调用方"复用了已有任务", 不要重复计费
          return { row: existing[0], reused: true };
        }

        const day = businessDate();

        const [counts] = await con.execute(
          `SELECT COUNT(*) AS total, COALESCE(SUM(actor_key = ?), 0) AS mine
           FROM ai_image_jobs WHERE business_day = ?`,
          [actorKey, day]
        );

        // 每身份额度按角色分档: 管理员默认不限制(0), 非管理员默认 10
        const actorLimit = dailyLimitFor(isAdmin);
        if (actorLimit > 0 && Number(counts[0].mine) >= actorLimit) {
          throw httpError(
            429,
            isAdmin ? '今日生成次数已用完' : `今日生成次数已用完（非管理员每天 ${actorLimit} 次）`
          );
        }

        // 全站兜底额度对所有角色都生效
        if (Number(counts[0].total) >= globalDailyLimit) {
          throw httpError(429, '全站今日生成额度已用完');
        }

        const [active] = await con.execute(
          `SELECT COUNT(*) AS count FROM ai_image_jobs
           WHERE actor_key = ? AND status IN ('queued','running')`,
          [actorKey]
        );
        if (Number(active[0].count) > 0) throw httpError(409, '已有生成任务, 请等待完成');

        const [temporary] = await con.execute(
          `SELECT COUNT(*) AS count FROM ai_image_jobs
           WHERE status IN ('queued','running','succeeded')`
        );
        if (Number(temporary[0].count) >= temporaryLimit) {
          throw httpError(429, '临时图片空间已满, 请稍后再试');
        }

        const id = randomUUID();
        await con.execute(
          `INSERT INTO ai_image_jobs
             (id, actor_key, client_token, request_hash, prompt, model, image_size, status, business_day)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
          [id, actorKey, token, requestHash, prompt, model, size, day]
        );

        const [rows] = await con.execute('SELECT * FROM ai_image_jobs WHERE id = ?', [id]);
        return { row: rows[0], reused: false };
      });

      // 201/202 风格: 新任务 202(已受理), 幂等重放 200
      res.status(job.reused ? 200 : 202);
      ok(res, publicJob(job.row));
    })
  );

  // ---- 查询任务 ----
  router.get(
    '/jobs/:id',
    asyncRoute(async (req, res) => {
      const job = await getOne('SELECT * FROM ai_image_jobs WHERE id = ? AND actor_key = ?', [
        req.params.id,
        req.aiIdentity.actorKey,
      ]);
      if (!job) throw httpError(404, '任务不存在');
      ok(res, publicJob(job));
    })
  );

  // ---- 取临时生成图 (未上传前只在这里可取, 且需登录) ----
  router.get(
    '/jobs/:id/image',
    asyncRoute(async (req, res) => {
      const job = await getOne(
        `SELECT * FROM ai_image_jobs
         WHERE id = ? AND actor_key = ? AND status = 'succeeded'`,
        [req.params.id, req.aiIdentity.actorKey]
      );

      if (!job || !job.file_name) {
        throw httpError(404, '图片尚未生成或临时结果已过期');
      }

      if (job.expires_at && new Date(String(job.expires_at).replace(' ', 'T')).getTime() <= Date.now()) {
        throw httpError(404, '临时结果已过期, 请重新生成');
      }

      const buffer = await fs
        .readFile(path.join(temporaryDir, job.file_name))
        .catch(() => null);

      if (!buffer) throw httpError(404, '临时图片已清理, 请重新生成');

      res.set('Cache-Control', 'private, no-store');
      res.type('image/webp').send(buffer);
    })
  );

  // ---- 服务器图库列表 ----
  router.get(
    '/gallery',
    asyncRoute(async (req, res) => {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const pageSize = 12;
      const offset = (page - 1) * pageSize;

      const rows = await query(
        `SELECT id, actor_key, created_at, file_bytes
         FROM ai_gallery_images
         WHERE status = 'ready'
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
        [pageSize + 1, offset]
      );

      ok(res, {
        items: rows.slice(0, pageSize).map((row) => ({
          id: row.id,
          created_at: row.created_at,
          bytes: row.file_bytes,
          mine: row.actor_key === req.aiIdentity.actorKey,
          can_delete: req.aiIdentity.isAdmin || row.actor_key === req.aiIdentity.actorKey,
        })),
        has_more: rows.length > pageSize,
      });
    })
  );

  router.get(
    '/gallery/:id/image',
    asyncRoute(async (req, res) => {
      const row = await getOne(
        "SELECT file_name FROM ai_gallery_images WHERE id = ? AND status = 'ready'",
        [req.params.id]
      );
      if (!row) throw httpError(404, '图片不存在');

      let buffer = await fs.readFile(path.join(galleryDir, row.file_name)).catch(() => null);
      if (!buffer) throw httpError(404, '图片文件不存在');

      if (req.query.thumb === '1') {
        buffer = await sharp(buffer)
          .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 75 })
          .toBuffer();
      }

      res.set('Cache-Control', 'private, no-store');
      res.type('image/webp').send(buffer);
    })
  );

  // 限制内存上传解析并发, 避免大量请求同时占用内存
  let activeUploads = 0;

  function uploadSlot(req, res, next) {
    if (activeUploads >= 2) return next(httpError(429, '上传繁忙, 请稍后重试'));
    activeUploads += 1;

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeUploads -= 1;
    };

    res.once('finish', release);
    res.once('close', release);
    next();
  }

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 1,
      fields: 2,
      parts: 3,
      fieldSize: 1024,
    },
  });

  async function deleteGalleryFile(image) {
    await unlinkIfExists(path.join(galleryDir, image.file_name));
    await locked((con) =>
      con.execute("UPDATE ai_gallery_images SET status = 'deleted' WHERE id = ? AND status = 'deleting'", [
        image.id,
      ])
    );
  }

  // ---- 主动上传到服务器图库 ----
  router.post(
    '/gallery',
    requireCreator,
    uploadSlot,
    upload.single('file'),
    asyncRoute(async (req, res) => {
      if (!req.file) throw httpError(400, '请选择图片');

      const token = validateClientToken(req.body?.client_token);
      const buffer = await normalizeImage(req.file.buffer, sharp);
      const contentHash = sha256(buffer);
      const identity = req.aiIdentity;

      const reservation = await locked(async (con) => {
        const [existing] = await con.execute(
          'SELECT * FROM ai_gallery_images WHERE actor_key = ? AND client_token = ?',
          [identity.actorKey, token]
        );

        if (existing.length) {
          const image = existing[0];
          if (image.content_hash !== contentHash) {
            throw httpError(409, '上传编号已用于其他图片');
          }
          if (image.status === 'ready') return { existing: true, image };
          if (image.status === 'deleted') {
            throw httpError(410, '原上传已删除, 请明确发起新的上传');
          }
          throw httpError(409, '该上传正在处理, 请稍后重试');
        }

        const quota = await galleryQuota(con, identity.actorKey, identity.ipKey);
        if (quota.total >= MAX_GALLERY) throw httpError(409, '服务器图库已达到 200 张上限');
        if (quota.ip >= MAX_PER_IP) throw httpError(409, `当前 IP 已达到 ${MAX_PER_IP} 张上限`);
        if (quota.actor >= MAX_PER_ACTOR) {
          throw httpError(409, `当前身份已达到 ${MAX_PER_ACTOR} 张上限`);
        }

        // 上传额度和删除退役: "当前身份 10 张"说的是同时存在多少张,
        // 不加每日上限的话可以删一张传一张无限循环, 所以给非管理员加一层日限。
        if (!identity.isAdmin && viewerUploadDailyLimit > 0) {
          const [uploaded] = await con.execute(
            'SELECT COUNT(*) AS used FROM ai_gallery_images WHERE actor_key = ? AND DATE(created_at) = ?',
            [identity.actorKey, businessDate()]
          );
          if (Number(uploaded[0].used) >= viewerUploadDailyLimit) {
            throw httpError(429, `今日上传张数已用完（非管理员每天 ${viewerUploadDailyLimit} 张）`);
          }
        }

        const id = randomUUID();
        const fileName = `${id}.webp`;

        await con.execute(
          `INSERT INTO ai_gallery_images
             (id, actor_key, ip_key, client_token, content_hash, status, file_name, file_bytes)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
          [id, identity.actorKey, identity.ipKey, token, contentHash, fileName, buffer.length]
        );

        return { existing: false, image: { id, file_name: fileName } };
      });

      if (reservation.existing) {
        return ok(res, { id: reservation.image.id, duplicated: true });
      }

      const image = reservation.image;

      try {
        await writeAtomic(path.join(galleryDir, image.file_name), buffer);

        await locked(async (con) => {
          const [result] = await con.execute(
            "UPDATE ai_gallery_images SET status = 'ready' WHERE id = ? AND status = 'pending'",
            [image.id]
          );
          if (result.affectedRows !== 1) throw new Error('上传预留状态已失效');
        });
      } catch (error) {
        await locked((con) =>
          con.execute(
            "UPDATE ai_gallery_images SET status = 'deleting' WHERE id = ? AND status <> 'deleted'",
            [image.id]
          )
        ).catch(() => {});
        await deleteGalleryFile(image).catch(() => {});
        throw error;
      }

      res.status(201);
      ok(res, { id: image.id, duplicated: false });
    })
  );

  // ---- 删除图库图片 (管理员可删任意, 其他身份只能删自己的) ----
  router.delete(
    '/gallery/:id',
    asyncRoute(async (req, res) => {
      const image = await locked(async (con) => {
        const [rows] = await con.execute('SELECT * FROM ai_gallery_images WHERE id = ?', [
          req.params.id,
        ]);
        if (!rows.length) throw httpError(404, '图片不存在');

        const row = rows[0];
        if (!req.aiIdentity.isAdmin && row.actor_key !== req.aiIdentity.actorKey) {
          throw httpError(403, '不能删除其他人的图片');
        }
        if (row.status === 'deleted') return row;
        if (row.status === 'pending') throw httpError(409, '图片正在上传, 请稍后重试');

        await con.execute("UPDATE ai_gallery_images SET status = 'deleting' WHERE id = ?", [row.id]);
        return { ...row, status: 'deleting' };
      });

      if (image.status !== 'deleted') await deleteGalleryFile(image);

      ok(res, { deleted: true });
    })
  );

  // ---- 硅基流动适配层 ----
  // 实现见模块作用域的 generateWithProvider(): 那里只依赖显式传入的配置,
  // 因此可以用真实账号独立测试, 不必连数据库。这里只是把本模块的配置绑上去。
  function callProvider(job) {
    return generateWithProvider(job, {
      apiKey,
      imageSize,
      downloadHosts,
      sharp,
      logger,
    });
  }

  // ---- 后台 worker: 单实例服务串行处理队列 ----
  let workerRunning = false;
  let maintenanceRunning = false;
  let closed = false;

  /**
   * 生成失败时写进数据库的说明。
   *
   * 前端展示的是 job.error, 所以不能只写一句"生成失败"——那样部署时排查不了。
   * 这里保留可执行的定位信息; 供应商原始响应体只进服务器日志, 不下发前端。
   */
  function failureMessage(error) {
    const reason = String((error && error.message) || '').trim();

    if (/域名未加入服务器可信列表/.test(reason)) {
      return '生成图片的域名不在 AI_IMAGE_DOWNLOAD_HOSTS 白名单里, 请把响应中的图片域名加入后重启服务。';
    }
    if (/生图服务返回 HTTP/.test(reason)) {
      return `${reason}, 请检查 API Key、模型名与账户额度。可能已产生服务商费用, 请勿连续重试。`;
    }
    if (/格式异常|没有图片|无法识别生成图片地址/.test(reason)) {
      return `${reason}, 供应商接口契约可能已变化, 请核对当前文档。请勿连续重试。`;
    }
    if (reason) {
      return `${reason}; 可能已产生服务商费用, 请勿连续重试。`;
    }
    return '生成未完成或结果获取失败; 可能已产生服务商费用, 请勿连续重试。';
  }

  async function workOnce() {
    if (closed || workerRunning) return;
    workerRunning = true;
    let job = null;

    try {
      job = await locked(async (con) => {
        const [rows] = await con.execute(
          "SELECT * FROM ai_image_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1"
        );
        if (!rows.length) return null;

        await con.execute("UPDATE ai_image_jobs SET status = 'running' WHERE id = ? AND status = 'queued'", [
          rows[0].id,
        ]);
        return rows[0];
      });

      if (!job) return;

      const buffer = await callProvider(job);
      const fileName = `${job.id}.webp`;

      await writeAtomic(path.join(temporaryDir, fileName), buffer);

      await locked((con) =>
        con.execute(
          `UPDATE ai_image_jobs
           SET status = 'succeeded', file_name = ?, file_bytes = ?,
               expires_at = DATE_ADD(NOW(3), INTERVAL ${TEMP_TTL_MINUTES} MINUTE),
               error_message = NULL
           WHERE id = ? AND status = 'running'`,
          [fileName, buffer.length, job.id]
        )
      );
    } catch (error) {
      logger.error('[ai-workshop] generation failed:', error.message);

      if (job) {
        // 不自动重试上游调用, 避免不确定状态重复计费
        await pool
          .query(
            `UPDATE ai_image_jobs
             SET status = 'failed', error_message = ?
             WHERE id = ? AND status = 'running'`,
            [failureMessage(error).slice(0, 500), job.id]
          )
          .catch(() => {});
      }
    } finally {
      workerRunning = false;
    }
  }

  async function sweepOrphans(directory, referenced) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (!entry.isFile() || referenced.has(entry.name)) continue;

      const filePath = path.join(directory, entry.name);
      const stat = await fs.stat(filePath).catch(() => null);

      // 留出足够窗口, 不碰正在写入的文件
      if (stat && Date.now() - stat.mtimeMs > ORPHAN_GRACE_MS) {
        await unlinkIfExists(filePath);
      }
    }
  }

  async function maintenance() {
    if (closed || maintenanceRunning) return;
    maintenanceRunning = true;

    try {
      // 1) 过期临时图: 删文件 + 置 expired
      const expired = await query(
        "SELECT id, file_name FROM ai_image_jobs WHERE status = 'succeeded' AND expires_at <= NOW(3)"
      );

      for (const job of expired) {
        if (job.file_name) await unlinkIfExists(path.join(temporaryDir, job.file_name));
        await pool.query("UPDATE ai_image_jobs SET status = 'expired' WHERE id = ? AND status = 'succeeded'", [
          job.id,
        ]);
      }

      // 2) 崩溃残留的 pending 预留 -> deleting (15 分钟宽限)
      await locked((con) =>
        con.execute(
          `UPDATE ai_gallery_images SET status = 'deleting'
           WHERE status = 'pending' AND updated_at < DATE_SUB(NOW(3), INTERVAL 15 MINUTE)`
        )
      );

      // 3) 完成 deleting 的文件删除 + 置 deleted
      const deleting = await query(
        "SELECT id, file_name FROM ai_gallery_images WHERE status = 'deleting'"
      );
      for (const image of deleting) {
        await deleteGalleryFile(image).catch((e) =>
          logger.error('[ai-workshop] delete failed:', e.message)
        );
      }

      // 4) 清理没有数据库引用的孤儿文件
      const galleryFiles = await query(
        `SELECT file_name FROM ai_gallery_images
         WHERE status IN (${ACTIVE_STATES.map(() => '?').join(',')})`,
        ACTIVE_STATES
      );
      const temporaryFiles = await query(
        "SELECT file_name FROM ai_image_jobs WHERE status = 'succeeded'"
      );

      await sweepOrphans(galleryDir, new Set(galleryFiles.map((row) => row.file_name)));
      await sweepOrphans(temporaryDir, new Set(temporaryFiles.map((row) => row.file_name)));
    } catch (error) {
      logger.error('[ai-workshop] maintenance:', error.message);
    } finally {
      maintenanceRunning = false;
    }
  }

  // 面向单实例 systemd 服务: 重启时不自动重发进行中的供应商请求
  await pool.query(
    `UPDATE ai_image_jobs
     SET status = 'unknown',
         error_message = '服务重启导致结果未确认, 请核对后再决定是否重新生成。'
     WHERE status = 'running'`
  );

  await maintenance();

  const workerTimer = setInterval(workOnce, WORKER_INTERVAL_MS);
  const maintenanceTimer = setInterval(maintenance, MAINTENANCE_INTERVAL_MS);
  workerTimer.unref?.();
  maintenanceTimer.unref?.();

  // 本模块的错误统一转成项目响应格式 { ok:false, error }。
  // 注意: 必须挂在"本 router 自己"的最后一层 —— 若把它挂到 app 级别的 /api 之后,
  // 全局 404 会先吃掉错误, 这里就成了永远不执行的中间件。
  // 传递 4 个参数是 Express 识别错误中间件的方式, next 不能省。
  // eslint-disable-next-line no-unused-vars
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    if (error instanceof multer.MulterError) {
      return fail(res, 400, error.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 8 MB' : '上传内容不符合要求');
    }

    const status = error.status || 500;
    if (status >= 500) logger.error('[ai-workshop]', error.message);

    fail(res, status, status >= 500 ? '图片服务暂时不可用, 请稍后重试' : error.message);
  });

  logger.log(`[ai-workshop] 就绪: model=${model} size=${imageSize} enabled=${Boolean(apiKey)} storage=${root}`);

  return {
    router,
    close() {
      closed = true;
      clearInterval(workerTimer);
      clearInterval(maintenanceTimer);
    },
  };
}
