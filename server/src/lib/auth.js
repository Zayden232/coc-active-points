// 认证与授权核心: 账号体系(super_admin / admin / viewer) + 可即时吊销的 JWT
//
// 设计要点(见 deploy/DEPLOY.md 账号体系附录):
//   - 密码用 Node 内置 scrypt 加盐哈希, 不存明文, 不用 SHA-256。
//   - JWT 载荷: { sub: 用户ID, role, ver: token_version, typ: 'user' }。旧版只有 role 的
//     Token 一律不认, 避免"缺少用户ID自动当访客/管理员"的漏洞。
//   - 每个受保护请求都查一次 users: 账号存在 / 已启用 / token_version 匹配,
//     这样改密、重置、停用、强制退出都能立即生效(下一次请求即被拒)。
//   - 访客: 公开只读接口无需登录(匿名可读); 仍保留 VIEWER_PASSWORD 的访客登录入口。
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { getOne, run } from '../db.js';

export const ROLE = {
  SUPER: 'super_admin',
  ADMIN: 'admin',
  VIEWER: 'viewer',
  GUEST: 'guest',
};

export const ADMIN_ROLES = [ROLE.SUPER, ROLE.ADMIN];

// 访客口令生效条件: 已配置且与任何东西都不冲突时启用(留空=关闭访客登录)
export function viewerEnabled() {
  return !!config.viewerPassword;
}

// ---------------- 密码哈希 (scrypt) ----------------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const pwd = String(password == null ? '' : password);
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pwd, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(password == null ? '' : password), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function constantTimeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// 临时密码: 12 位无易混淆字符, 由超级管理员通过可信渠道转交, 首次登录必须改密
export function generateTempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

// ---------------- Token ----------------
export function signUserToken(user) {
  return jwt.sign(
    { sub: String(user.id), role: user.role, ver: Number(user.token_version) || 1, typ: 'user' },
    config.jwtSecret,
    { expiresIn: config.tokenExpires }
  );
}

export function signViewerToken() {
  return jwt.sign({ role: ROLE.VIEWER, typ: 'viewer' }, config.jwtSecret, { expiresIn: config.tokenExpires });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

function bearerToken(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    enabled: Number(row.enabled) === 1,
    must_change_password: Number(row.must_change_password) === 1,
    last_login_at: row.last_login_at || null,
    password_changed_at: row.password_changed_at || null,
  };
}

/**
 * 解析请求身份:
 *   无 Token            -> { role: 'guest' }
 *   Token 无效/被吊销   -> { role: 'guest', invalidToken: true }  (受保护接口会据此 401)
 *   访客 Token          -> { role: 'viewer' }
 *   账号 Token          -> { role, user }
 */
export async function resolveAuth(req) {
  const token = bearerToken(req);
  if (!token) return { role: ROLE.GUEST };

  const payload = verifyToken(token);
  if (!payload) return { role: ROLE.GUEST, invalidToken: true };

  if (payload.typ === 'viewer') {
    if (!viewerEnabled()) return { role: ROLE.GUEST, invalidToken: true };
    return { role: ROLE.VIEWER, viewer: true };
  }

  // 旧版 Token(只有 role, 没有 sub/typ) 一律不认
  if (payload.typ !== 'user' || !payload.sub) return { role: ROLE.GUEST, invalidToken: true };

  const row = await getOne(
    'SELECT id, username, display_name, role, enabled, token_version, must_change_password, last_login_at, password_changed_at FROM users WHERE id = ?',
    [payload.sub]
  );
  if (!row) return { role: ROLE.GUEST, invalidToken: true };
  if (Number(row.enabled) !== 1) return { role: ROLE.GUEST, invalidToken: true, disabled: true };
  if (Number(payload.ver) !== Number(row.token_version)) {
    return { role: ROLE.GUEST, invalidToken: true, revoked: true };
  }
  if (!ADMIN_ROLES.includes(row.role)) return { role: ROLE.GUEST, invalidToken: true };

  return { role: row.role, user: publicUser(row) };
}

// 公开只读 + 可选身份: 永远 next(), 但把身份挂在 req.auth
export async function optionalAuth(req, res, next) {
  try {
    req.auth = await resolveAuth(req);
  } catch (e) {
    req.auth = { role: ROLE.GUEST, error: e.message };
  }
  next();
}

function unauthorized(res, auth) {
  const error = auth && auth.disabled
    ? '账号已停用，请联系超级管理员'
    : auth && auth.revoked
      ? '登录已失效，请重新登录'
      : '未登录或登录已过期';
  return res.status(401).json({ ok: false, error, code: 'UNAUTHORIZED' });
}

/** 必须已登录(管理员或访客都算登录) */
export function requireAuth(req, res, next) {
  const a = req.auth || {};
  if (a.invalidToken) return unauthorized(res, a);
  if (a.role === ROLE.GUEST || !a.role) return unauthorized(res, a);
  next();
}

/** 管理员(含超级管理员) */
export function requireAdmin(req, res, next) {
  const a = req.auth || {};
  // 匿名(没登录) -> 401 提示登录; 已登录的只读访客 -> 403
  if (a.invalidToken || !a.role || a.role === ROLE.GUEST) return unauthorized(res, a);
  if (!ADMIN_ROLES.includes(a.role)) {
    return res.status(403).json({ ok: false, error: '只读访客无权执行该操作', code: 'FORBIDDEN' });
  }
  next();
}

/** 只允许超级管理员(物理删除 / 账号管理 / 数据恢复等不可逆操作) */
export function requireSuperAdmin(req, res, next) {
  const a = req.auth || {};
  if (a.invalidToken || !a.role || a.role === ROLE.GUEST) return unauthorized(res, a);
  if (a.role !== ROLE.SUPER) {
    return res.status(403).json({ ok: false, error: '仅超级管理员可执行该操作', code: 'FORBIDDEN' });
  }
  next();
}

export function isAdmin(req) {
  return ADMIN_ROLES.includes(req.auth && req.auth.role);
}

export function isSuperAdmin(req) {
  return (req.auth && req.auth.role) === ROLE.SUPER;
}

/**
 * 临时密码门禁: 必须改密的账号只能访问"自己的账号"相关接口,
 * 其余业务接口一律 403(不靠前端弹窗限制)。
 */
export function blockIfMustChangePassword(req, res, next) {
  const user = req.auth && req.auth.user;
  if (user && user.must_change_password) {
    return res.status(403).json({
      ok: false,
      error: '首次登录需先修改密码',
      code: 'MUST_CHANGE_PASSWORD',
    });
  }
  next();
}

// ---------------- 登录限流 (IP + 账号双维度, 内存级) ----------------
const failures = new Map();
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;

export function isLocked(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const k of list) {
    const a = failures.get(k);
    if (!a || !a.until) continue;
    if (Date.now() > a.until) {
      failures.delete(k);
      continue;
    }
    return true;
  }
  return false;
}

export function noteFail(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const k of list) {
    const a = failures.get(k) || { count: 0, until: 0 };
    a.count += 1;
    if (a.count >= MAX_FAILS) {
      a.until = Date.now() + LOCK_MS;
      a.count = 0;
    }
    failures.set(k, a);
  }
}

export function noteSuccess(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  for (const k of list) failures.delete(k);
}

/** 改密/重置/停用/强制退出都递增 token_version, 让旧 Token 立刻失效 */
export async function bumpTokenVersion(userId) {
  await run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [userId]);
}
