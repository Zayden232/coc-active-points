import { Router } from 'express';
import { config } from '../config.js';
import {
  ROLE,
  ADMIN_ROLES,
  viewerEnabled,
  signUserToken,
  signViewerToken,
  verifyPassword,
  hashPassword,
  constantTimeEqual,
  publicUser,
  isLocked,
  noteFail,
  noteSuccess,
  bumpTokenVersion,
  optionalAuth,
} from '../lib/auth.js';
import { getOne, run } from '../db.js';
import { ok, fail } from '../lib/respond.js';
import { actorOf, writeSecurityAudit } from '../lib/audit.js';

export const router = Router();

// 账号登录: 用户名 + 密码
// 用户名不存在 / 密码错误 / 账号停用 统一文案, 避免枚举账号
router.post('/login', async (req, res) => {
  const ip = req.ip || 'unknown';
  const body = req.body || {};
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const lockKeys = [`ip:${ip}`, username ? `user:${username}` : `ip:${ip}`];

  if (isLocked(lockKeys)) return fail(res, 429, '尝试次数过多, 请 5 分钟后再试');
  if (!username || !password) return fail(res, 400, '请输入用户名和密码');

  try {
    const user = await getOne('SELECT * FROM users WHERE username = ?', [username]);
    const passwordOk = user ? verifyPassword(password, user.password_hash) : false;

    if (!user || !passwordOk || Number(user.enabled) !== 1) {
      noteFail(lockKeys);
      return fail(res, 401, '账号或密码错误，或账号不可用');
    }
    if (!ADMIN_ROLES.includes(user.role)) {
      noteFail(lockKeys);
      return fail(res, 401, '账号或密码错误，或账号不可用');
    }

    noteSuccess(lockKeys);
    await run('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

    const token = signUserToken(user);
    const fresh = await getOne('SELECT * FROM users WHERE id = ?', [user.id]);
    await writeSecurityAudit({
      actor: { id: user.id, username: user.username },
      action: 'login',
      targetUserId: user.id,
      details: `登录成功(${user.role})`,
      ip,
    });

    ok(res, { token, role: user.role, user: publicUser(fresh) });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 访客登录(可选入口): 沿用 VIEWER_PASSWORD, 只读
router.post('/viewer-login', (req, res) => {
  const ip = req.ip || 'unknown';
  const lockKey = `viewer:${ip}`;
  if (isLocked([lockKey])) return fail(res, 429, '尝试次数过多, 请 5 分钟后再试');
  if (!viewerEnabled()) return fail(res, 403, '访客入口未开放');

  const password = String((req.body || {}).password || '');
  if (!password) return fail(res, 400, '请输入访客口令');
  if (!constantTimeEqual(password, config.viewerPassword)) {
    noteFail([lockKey]);
    return fail(res, 401, '访客口令不正确');
  }
  noteSuccess([lockKey]);
  ok(res, { token: signViewerToken(), role: ROLE.VIEWER, user: null });
});

// 当前身份: 未登录返回 guest(前端据此显示"登录"入口)
router.get('/me', optionalAuth, (req, res) => {
  const a = req.auth || {};
  ok(res, {
    role: a.role || ROLE.GUEST,
    can_write: ADMIN_ROLES.includes(a.role),
    is_super_admin: a.role === ROLE.SUPER,
    is_guest: !a.user && a.role !== ROLE.VIEWER,
    viewer_enabled: viewerEnabled(),
    user: a.user || null,
    invalid_token: !!a.invalidToken,
  });
});

// 修改自己的密码(校验旧密码): 成功后 token_version+1, 旧 Token 全部失效
router.post('/change-password', optionalAuth, async (req, res) => {
  const a = req.auth || {};
  if (!a.user) return fail(res, 401, '请先登录');
  const body = req.body || {};
  const oldPassword = String(body.old_password || '');
  const newPassword = String(body.new_password || '');

  if (!oldPassword || !newPassword) return fail(res, 400, '请输入原密码和新密码');
  if (newPassword.length < 8) return fail(res, 400, '新密码至少 8 位');
  if (newPassword.length > 72) return fail(res, 400, '新密码过长');
  if (oldPassword === newPassword) return fail(res, 400, '新密码不能与原密码相同');

  try {
    const row = await getOne('SELECT * FROM users WHERE id = ?', [a.user.id]);
    if (!row) return fail(res, 401, '账号不存在');
    if (!verifyPassword(oldPassword, row.password_hash)) {
      await writeSecurityAudit({
        actor: { id: row.id, username: row.username },
        action: 'change_password_failed',
        targetUserId: row.id,
        details: '原密码校验失败',
        ip: req.ip || '',
      });
      return fail(res, 400, '原密码不正确');
    }

    await run(
      'UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = NOW(), token_version = token_version + 1 WHERE id = ?',
      [hashPassword(newPassword), row.id]
    );
    await writeSecurityAudit({
      actor: { id: row.id, username: row.username },
      action: 'change_password',
      targetUserId: row.id,
      details: '修改自己的密码',
      ip: req.ip || '',
    });

    // 旧 Token 已失效, 前端需重新登录
    ok(res, { changed: true, re_login: true });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 退出自己的所有设备(Token 版本 +1)
router.post('/logout-all', optionalAuth, async (req, res) => {
  const a = req.auth || {};
  if (!a.user) return fail(res, 401, '请先登录');
  try {
    await bumpTokenVersion(a.user.id);
    await writeSecurityAudit({
      actor: actorOf(req),
      action: 'logout_all',
      targetUserId: a.user.id,
      details: '强制退出自己的所有设备',
      ip: req.ip || '',
    });
    ok(res, { revoked: true });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 兼容: 旧代码/脚本可能调用 /logout, 语义等同退出所有设备
router.post('/logout', optionalAuth, async (req, res) => {
  const a = req.auth || {};
  if (!a.user) return ok(res, { revoked: false, note: '未登录, 仅清除本地凭证' });
  await bumpTokenVersion(a.user.id);
  ok(res, { revoked: true });
});
