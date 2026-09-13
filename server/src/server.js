import { config } from './config.js';
import { pool, getOne } from './db.js';
import { ensureSeeded } from './lib/settings.js';
import { createApp } from './app.js';

async function main() {
  if (!config.jwtSecret || config.jwtSecret === '改成随机长字符串') {
    console.warn('[warn] JWT_SECRET 未设置为强随机值, 请在生产环境修改 .env');
  }
  if (config.viewerPassword) {
    console.log('[info] 访客口令入口已开启(POST /api/auth/viewer-login); 匿名访客默认可读公开数据');
  }
  if (!config.ai.enabled) {
    console.warn(
      '[warn] AI_IDENTITY_SECRET 未配置(需 >=32 字符: openssl rand -hex 32), AI 创作工坊生图接口不会挂载'
    );
  }
  await ensureSeeded();

  // 账号体系: 管理员账号存在数据库 users 表(不再有共享 ADMIN_PASSWORD)
  try {
    const su = await getOne("SELECT COUNT(*) AS c FROM users WHERE role = 'super_admin'");
    if (!su || Number(su.c) === 0) {
      console.warn(
        '[warn] 还没有超级管理员账号, 请执行: npm run user:init-super-admin (服务器本地交互式创建)'
      );
    }
  } catch (e) {
    console.warn('[warn] 无法检查 users 表(请确认已执行 migrations/006_accounts.sql):', e.message);
  }

  const app = await createApp();
  const server = app.listen(config.port, '127.0.0.1', () => {
    console.log(`[coc-points] listening on http://127.0.0.1:${config.port}`);
  });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
      try {
        // 先停掉 AI 工坊的定时器, 再释放连接池
        app.locals.closeAiWorkshop?.();
        server.close();
        await pool.end();
      } catch (_) {
        /* ignore */
      }
      process.exit(0);
    });
  }
}

main().catch((e) => {
  console.error('启动失败:', e);
  process.exit(1);
});
