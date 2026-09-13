import express from 'express';
import { config } from './config.js';
import { createCors } from './lib/cors.js';
import { optionalAuth, requireAdmin, blockIfMustChangePassword } from './lib/auth.js';
import { ok, fail } from './lib/respond.js';
import { pool } from './db.js';
import { createAiWorkshop } from './modules/ai-workshop.js';
import { router as authRouter } from './routes/auth.routes.js';
import { router as adminUsersRouter } from './routes/admin-users.routes.js';
import { router as membersRouter } from './routes/members.routes.js';
import { router as rulesRouter } from './routes/rules.routes.js';
import { router as recordsRouter } from './routes/records.routes.js';
import { router as rankingRouter } from './routes/ranking.routes.js';
import { router as settleRouter } from './routes/settle.routes.js';
import { router as wheelRouter } from './routes/wheel.routes.js';
import { router as dataRouter } from './routes/data.routes.js';
import { router as metaRouter } from './routes/meta.routes.js';
import { router as cocRouter } from './routes/coc.routes.js';

/**
 * 组装 Express 应用。
 *
 * 鉴权分层(2026-09-10 账号体系改造):
 *   0. 跨域(CORS_ORIGINS, 默认关闭): 只把打包后的 H5 放到别的域名/机器上时才需要;
 *   1. /api/health 与 /api/auth/* 公开(登录、看自己身份);
 *   2. 其余 /api 先 optionalAuth: 无 Token = 匿名访客(可读公开只读接口),
 *      带 Token 则解析出真实账号(校验存在/启用/token_version);
 *   3. 临时密码(must_change_password)账号只能访问账号相关接口;
 *   4. 非 GET/HEAD 一律要求管理员(super_admin / admin),
 *      两个例外挂在规则之前: /api/ai-workshop/*(额度分角色, 见 modules/ai-workshop.js)
 *      与 /api/wheel/*(每日奖励, 每人每天一次, 只发排行榜外观);
 *   5. 账号管理 /api/admin/* 只允许超级管理员; 物理删除、数据恢复同样限超管。
 *
 * AI 创作工坊是可选的: 未配置 AI_IDENTITY_SECRET 时启动会打印告警并跳过挂载。
 */
export async function createApp() {
  const app = express();
  app.set('trust proxy', 1); // 仅 Nginx 一层反代, 用于读取真实 IP 做登录限流

  // 跨域必须排在最前面: 预检(OPTIONS)要在鉴权规则之前结束, 否则会被拦成 401/403。
  // 未配置 CORS_ORIGINS 时是空中间件, 行为与改造前完全一致。
  app.use(createCors(config.corsOrigins));

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => ok(res, { status: 'ok', time: new Date().toISOString() }));
  app.use('/api/auth', authRouter);

  // 公开只读 + 可选身份: 访客首次进入无需登录即可浏览
  app.use('/api', optionalAuth);

  // 临时密码账号: 除账号相关接口外一律 403(服务端强制, 不靠前端弹窗)
  app.use('/api', blockIfMustChangePassword);

  // AI 创作工坊 (生图) 必须排在"非 GET 需管理员"之前:
  // 它允许非管理员生成/上传(额度与管理员不同, 见 modules/ai-workshop.js),
  // 若放在那条全局规则之后, 访客的 POST 会被提前拦成 403。
  let workshop = null;
  try {
    workshop = await createAiWorkshop({ pool });
    app.use('/api/ai-workshop', workshop.router);
  } catch (e) {
    console.warn('[ai-workshop] 未启用:', e.message);
  }

  // 部落转盘(每日奖励)也必须排在"非 GET 需管理员"之前:
  // 它只有 GET /status、GET /cosmetics 和 POST /spin 三个动作, 且都是公开能力——
  // 每个成员每天只能领一次(服务端 wheel_spins 唯一键去重), 奖励只是排行榜外观,
  // 不涉及积分与奖金, 所以访客/普通 viewer 也能替成员领当日奖励。
  app.use('/api/wheel', wheelRouter);

  // 访客/匿名只读: 所有非 GET 请求要求管理员
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    return requireAdmin(req, res, next);
  });

  app.use('/api/admin', adminUsersRouter); // 账号管理 + 安全审计(仅超管)
  app.use('/api/members', membersRouter);
  app.use('/api/rules', rulesRouter);
  app.use('/api/records', recordsRouter);
  app.use('/api/ranking', rankingRouter);
  app.use('/api/settle', settleRouter);
  app.use('/api', dataRouter); // /api/export /api/backup /api/restore
  app.use('/api', metaRouter); // /api/settings /api/budget /api/options /api/dashboard
  app.use('/api/coc', cocRouter); // 部落冲突官方 API 同步(仅管理员, GET/POST 都在路由内校验)

  app.use((req, res) => fail(res, 404, 'Not Found'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // body-parser 的解析失败/超限等自带状态码, 不要一律 500
    const status = Number(err && (err.status || err.statusCode)) || 0;
    if (err && err.type === 'entity.parse.failed') {
      return fail(res, 400, 'JSON 格式错误');
    }
    if (err && err.type === 'entity.too.large') {
      return fail(res, 413, '请求体过大');
    }
    if (status >= 400 && status < 500) {
      return fail(res, status, err.message || '请求不合法');
    }
    console.error(err);
    fail(res, 500, '服务器内部错误');
  });

  app.locals.closeAiWorkshop = () => workshop && workshop.close();
  return app;
}
