import 'dotenv/config';

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export const config = {
  port: num(process.env.PORT, 3000),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'coc_app',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'coc_points',
    connectionLimit: num(process.env.DB_POOL, 5),
    // 让 DATE/DATETIME 直接以 'YYYY-MM-DD' 字符串返回, 避免时区偏移
    dateStrings: true,
  },
  jwtSecret: process.env.JWT_SECRET || '',
  tokenExpires: process.env.TOKEN_EXPIRES || '7d',
  // Clash of Clans 官方 API(只读同步): token 与服务器出网 IP 绑定, 只在服务端使用, 绝不下发前端
  cocToken: process.env.COC_API_TOKEN || '',
  // 允许 E2E 指向本地桩服务; 生产保持默认
  cocApiBase: process.env.COC_API_BASE || 'https://api.clashofclans.com/v1',
  // 管理员改为 users 表账号(username + scrypt 密码), 不再有共享 ADMIN_PASSWORD
  // 访客(只读)密码: 留空则关闭访客登录; 与管理员密码相同会被忽略
  viewerPassword: process.env.VIEWER_PASSWORD || '',
  // 跨域白名单(逗号分隔, '*' = 任意来源): 留空 = 关闭。
  // 只有把打包后的 H5 放到别的域名/机器上直接请求本后端时才需要;
  // 线上(nginx 反代)与本地(vite 代理)都是同源, 保持留空即可。
  corsOrigins: process.env.CORS_ORIGINS || '',
  // AI 创作工坊: 密钥与存储目录由 modules/ai-workshop.js 直接读 process.env,
  // 这里只在启动时给出告警(未配置 = 跳过挂载生图功能, 不影响其它接口)
  ai: {
    enabled: Boolean(process.env.AI_IDENTITY_SECRET && process.env.AI_IDENTITY_SECRET.length >= 32),
    storageDir: process.env.AI_STORAGE_DIR || './data/ai',
  },
};
