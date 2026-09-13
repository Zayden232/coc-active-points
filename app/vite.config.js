import { defineConfig, loadEnv } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.dirname(fileURLToPath(import.meta.url));

// 非 H5(原生 App / 小程序)没有"同源"这个概念, 相对路径 '/api' 拼不出地址,
// 打出来的包一定拿不到数据。所以这些平台默认就用生产后端, 可用 VITE_API_BASE 覆盖。
const DEFAULT_NON_H5_API_BASE = 'https://app.jiacheng.cyou';

// 只写域名时自动补 /api, 末尾斜杠统一去掉
function normalizeApiBase(raw) {
  const v = String(raw || '').trim().replace(/\/+$/, '');
  if (!v) return '';
  if (v === '/api' || /\/api$/.test(v)) return v;
  return v + '/api';
}

export default defineConfig(({ mode }) => {
  // 显式从 app/ 目录读 VITE_*(uni-app 的 envDir 指向 src, 放 .env 容易踩坑)
  const env = loadEnv(mode, appDir, 'VITE_');
  const platform = process.env.UNI_PLATFORM || 'h5';
  const isH5 = platform === 'h5';

  const explicit = process.env.VITE_API_BASE || env.VITE_API_BASE;
  const apiBase = explicit ? normalizeApiBase(explicit) : isH5 ? '/api' : normalizeApiBase(DEFAULT_NON_H5_API_BASE);

  // 兜底护栏: 非 H5 平台绝不允许出现相对基址(否则是个"装上就没数据"的哑巴 App)
  if (!isH5 && apiBase.startsWith('/')) {
    throw new Error(
      `[api-base] 平台 ${platform} 不能用相对接口地址 "${apiBase}": 原生 App/小程序没有页面来源可拼。\n` +
        `           请设置 VITE_API_BASE=https://你的后端域名 后重新打包(见 app/.env.example)。`
    );
  }
  console.log(
    `[api-base] platform=${platform}  base=${apiBase}` +
      (explicit ? '  (来自 VITE_API_BASE)' : isH5 ? '  (同源, 由 vite/nginx 代理)' : '  (非 H5 默认值)')
  );

  // 本地开发时 /api 的转发目标(仅在 API 基址保持同源 '/api' 时才用到):
  //   默认 → 本机后端 http://127.0.0.1:3000(它连的是本地开发库 npm run dev:db)
  //   想直接读线上数据(只读调试用, 写操作会真的落到生产库!):
  //     PowerShell:  $env:VITE_API_TARGET='https://app.jiacheng.cyou'; npm run dev:h5
  const apiTarget =
    process.env.VITE_API_TARGET || env.VITE_API_TARGET || 'http://127.0.0.1:3000';

  return {
    plugins: [uni()],
    // 注入给前端: src/utils/api-base.js 读这个常量
    define: { __API_BASE__: JSON.stringify(apiBase) },
    server: {
      port: 5173,
      proxy: {
        // 本地开发时把 /api 反代到后端, 生产环境由 Nginx 处理
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
