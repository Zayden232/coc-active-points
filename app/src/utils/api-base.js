// API 基址 —— 构建期可配, 所有接口模块的唯一来源
//
// 默认 '/api' = 与页面同源:
//   - 本地开发: vite dev server 把 /api 代理到后端(见 app/vite.config.js)
//   - 线上部署: nginx 把 /api 反代到后端(见 deploy/DEPLOY.md)
//
// 把打包产物放到**别的域名/机器**上时, 页面与后端跨域了, 必须给出后端绝对地址:
//   PowerShell:  $env:VITE_API_BASE='https://app.jiacheng.cyou'; npm run build:h5
//   bash:        VITE_API_BASE=https://app.jiacheng.cyou npm run build:h5
//   或写进 app/.env:  VITE_API_BASE=https://app.jiacheng.cyou
//   (只写域名即可, 会自动补 /api; 写成 https://xxx/api 也一样)
//
// 后端那边必须同时放开跨域, 否则浏览器会拦掉请求:
//   CORS_ORIGINS=https://你的前端域名   (或 '*' = 任意来源)
//
// 实现说明: 该值由 vite.config.js 读入并以 define 注入为全局常量 __API_BASE__,
// 不依赖 uni-app 的 envDir(它指向 src, 放 .env 容易踩坑)。
/* global __API_BASE__ */
export const API_BASE =
  typeof __API_BASE__ === 'string' && __API_BASE__ ? __API_BASE__ : '/api';

export default API_BASE;
