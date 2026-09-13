/**
 * 跨域(CORS)支持 —— 默认关闭, 只有配置了 CORS_ORIGINS 才下发跨域头。
 *
 * 为什么需要: 打包后的 H5 是**纯静态文件**, 里面写死了 API 基址。把它放到
 * 别的域名/机器(或本地用静态服务器打开)时, 页面与后端就跨域了, 浏览器会先发
 * OPTIONS 预检。默认(同源: 线上 nginx 反代 / 本地 vite 代理)完全用不到本模块,
 * 因此保持默认不启用, 不改变现有线上行为。
 *
 * 配置(CORS_ORIGINS, 逗号分隔, 末尾斜杠会被忽略):
 *   CORS_ORIGINS=*                                  任何来源(本项目不用 Cookie, 故安全)
 *   CORS_ORIGINS=https://a.example.com,http://localhost:5173
 *   (留空/不配 = 关闭)
 *
 * 注意两点:
 *   1. 本项目鉴权用 Authorization 头, 不用 Cookie, 因此不返回
 *      Access-Control-Allow-Credentials(它也无法和 * 同时使用);
 *   2. 预检必须在这里提前结束: 否则 OPTIONS 会落到 app.js 里"非 GET 需管理员"
 *      那条规则上, 被拦成 401/403, 浏览器直接判定跨域失败。
 */

/** 把 CORS_ORIGINS 解析成白名单 */
function parseOrigins(raw) {
  const list = String(raw || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return { list, allowAny: list.includes('*'), set: new Set(list) };
}

export function createCors(originsRaw) {
  const { list, allowAny, set } = parseOrigins(originsRaw);

  // 未配置 = 完全不介入(保持同源部署下的原有行为, 连 OPTIONS 也照旧走后面的规则)
  if (list.length === 0) {
    return function corsDisabled(req, res, next) {
      next();
    };
  }

  const allowed = (origin) => Boolean(origin) && (allowAny || set.has(origin));

  return function cors(req, res, next) {
    const origin = req.headers.origin;
    const hit = allowed(origin);

    if (hit) {
      res.setHeader('Access-Control-Allow-Origin', allowAny ? '*' : origin);
      // 白名单是逐个回显的, 必须声明按 Origin 变化, 免得被缓存串味
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
      res.setHeader('Access-Control-Max-Age', '86400');
    }

    if (req.method === 'OPTIONS') {
      // 预检: 命中白名单 204, 未命中 403(不给跨域头, 浏览器会自己拦)
      res.statusCode = hit ? 204 : 403;
      res.setHeader('Content-Length', '0');
      res.end();
      return;
    }

    next();
  };
}
