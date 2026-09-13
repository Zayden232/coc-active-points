// 管理员账号管理 + 安全审计: 仅超级管理员可调用
// 规则(见 deploy/DEPLOY.md 账号体系附录):
//   - 只允许存在一个 super_admin(DB 生成列唯一索引 + 这里再校验)
//   - 不能停用/降级/删除超级管理员, 也不能把别人提升为超级管理员
//   - 普通管理员账号可以物理删除(DELETE /users/:id): 审计日志是按"用户名快照"留痕的,
//     删除账号不会破坏历史追溯(审计表没有指向 users 的外键), 但账号本身不可恢复
//   - 重置密码返回一次性临时密码, 并要求下次登录必须改密
import { Router } from 'express';
import {
  ROLE,
  requireAuth,
  requireSuperAdmin,
  hashPassword,
  generateTempPassword,
  bumpTokenVersion,
  publicUser,
} from '../lib/auth.js';
import { query, getOne, run, transaction } from '../db.js';
import { ok, fail } from '../lib/respond.js';
import { actorOf, writeSecurityAudit } from '../lib/audit.js';

export const router = Router();

router.use(requireAuth, requireSuperAdmin);

const USERNAME_RE = /^[a-z0-9_]{3,32}$/;

function parseId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// 列表
router.get('/users', async (req, res) => {
  try {
    const rows = await query(
      'SELECT id, username, display_name, role, enabled, token_version, must_change_password, created_by, last_login_at, password_changed_at, created_at FROM users ORDER BY role ASC, id ASC'
    );
    ok(res, rows.map(publicUser));
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 新增管理员(固定 role='admin', 不接受客户端提交的 role/token_version)
router.post('/users', async (req, res) => {
  const b = req.body || {};
  const username = String(b.username || '').trim().toLowerCase();
  const displayName = String(b.display_name || '').trim().slice(0, 32);
  const tempPassword = String(b.password || '').trim() || generateTempPassword();

  if (!USERNAME_RE.test(username)) {
    return fail(res, 400, '用户名需为 3-32 位小写字母/数字/下划线');
  }
  if (tempPassword.length < 8) return fail(res, 400, '密码至少 8 位');

  try {
    const actor = actorOf(req);
    const created = await transaction(async (con) => {
      const [r] = await con.execute(
        'INSERT INTO users (username, display_name, password_hash, role, enabled, token_version, must_change_password, created_by, password_changed_at) VALUES (?, ?, ?, ?, 1, 1, 1, ?, NOW())',
        [username, displayName || username, hashPassword(tempPassword), ROLE.ADMIN, actor.id]
      );
      await writeSecurityAudit({
        actor,
        action: 'create_admin',
        targetUserId: r.insertId,
        details: `创建管理员 ${username}`,
        ip: req.ip || '',
        con,
      });
      return r.insertId;
    });
    const row = await getOne('SELECT * FROM users WHERE id = ?', [created]);
    ok(res, { user: publicUser(row), temp_password: tempPassword, must_change_password: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 409, '该用户名已存在');
    fail(res, 500, e.message);
  }
});

// 修改显示名称(用户名创建后不可改)
router.patch('/users/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 400, '无效ID');
  const displayName = String((req.body || {}).display_name || '').trim().slice(0, 32);
  if (!displayName) return fail(res, 400, '显示名称不能为空');
  try {
    const row = await getOne('SELECT * FROM users WHERE id = ?', [id]);
    if (!row) return fail(res, 404, '账号不存在');
    await run('UPDATE users SET display_name = ? WHERE id = ?', [displayName, id]);
    await writeSecurityAudit({
      actor: actorOf(req),
      action: 'update_display_name',
      targetUserId: id,
      details: `显示名称 ${row.display_name || '-'} -> ${displayName}`,
      ip: req.ip || '',
    });
    ok(res, publicUser(await getOne('SELECT * FROM users WHERE id = ?', [id])));
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 启用 / 停用(停用同时递增 token_version, 重新启用后旧 Token 也不会复活)
router.patch('/users/:id/status', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 400, '无效ID');
  const enabled = (req.body || {}).enabled ? 1 : 0;
  try {
    const row = await getOne('SELECT * FROM users WHERE id = ?', [id]);
    if (!row) return fail(res, 404, '账号不存在');
    if (row.role === ROLE.SUPER) return fail(res, 403, '超级管理员不允许被停用');
    if (Number(row.id) === Number(actorOf(req).id)) return fail(res, 400, '不能停用自己的账号');

    await transaction(async (con) => {
      await con.execute('UPDATE users SET enabled = ?, token_version = token_version + 1 WHERE id = ?', [enabled, id]);
      await writeSecurityAudit({
        actor: actorOf(req),
        action: enabled ? 'enable_admin' : 'disable_admin',
        targetUserId: id,
        details: `${enabled ? '启用' : '停用'}账号 ${row.username}`,
        ip: req.ip || '',
        con,
      });
    });
    ok(res, publicUser(await getOne('SELECT * FROM users WHERE id = ?', [id])));
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 删除账号(物理删除, 仅超管):
//   - 超级管理员账号不允许删除(与"不能停用/降级超管"同一口径, 避免把自己锁在外面)
//   - 不能删除自己
//   - 删除前先写审计(details 里带用户名/角色/状态快照), 安全审计表没有指向 users 的外键,
//     所以历史日志(含 actor_username 快照)完整保留; 该账号已签发的 Token 因查不到用户自动失效
//   - users.created_by 里指向被删账号的悬空引用一并清空(纯展示字段)
router.delete('/users/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 400, '无效ID');
  try {
    const row = await getOne('SELECT * FROM users WHERE id = ?', [id]);
    if (!row) return fail(res, 404, '账号不存在');
    const actor = actorOf(req);
    if (row.role === ROLE.SUPER) return fail(res, 403, '超级管理员账号不允许删除');
    if (Number(row.id) === Number(actor.id)) return fail(res, 400, '不能删除自己的账号');

    await transaction(async (con) => {
      await writeSecurityAudit({
        actor,
        action: 'delete_user',
        targetUserId: id,
        details: `删除账号 ${row.username}（角色 ${row.role}，状态 ${Number(row.enabled) ? '启用' : '停用'}）`,
        ip: req.ip || '',
        con,
      });
      await con.execute('UPDATE users SET created_by = NULL WHERE created_by = ?', [id]);
      await con.execute('DELETE FROM users WHERE id = ?', [id]);
    });
    ok(res, { deleted: true, id, username: row.username });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 重置密码: 返回一次性临时密码 + 强制下次登录改密 + 旧 Token 全部失效
router.post('/users/:id/reset-password', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 400, '无效ID');
  const tempPassword = generateTempPassword();
  try {
    const row = await getOne('SELECT * FROM users WHERE id = ?', [id]);
    if (!row) return fail(res, 404, '账号不存在');

    await transaction(async (con) => {
      await con.execute(
        'UPDATE users SET password_hash = ?, must_change_password = 1, password_changed_at = NOW(), token_version = token_version + 1 WHERE id = ?',
        [hashPassword(tempPassword), id]
      );
      await writeSecurityAudit({
        actor: actorOf(req),
        action: 'reset_password',
        targetUserId: id,
        details: `重置账号 ${row.username} 的密码`,
        ip: req.ip || '',
        con,
      });
    });
    ok(res, { user: publicUser(await getOne('SELECT * FROM users WHERE id = ?', [id])), temp_password: tempPassword });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 强制退出该账号所有设备
router.post('/users/:id/revoke-tokens', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 400, '无效ID');
  try {
    const row = await getOne('SELECT * FROM users WHERE id = ?', [id]);
    if (!row) return fail(res, 404, '账号不存在');
    await transaction(async (con) => {
      await con.execute('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [id]);
      await writeSecurityAudit({
        actor: actorOf(req),
        action: 'revoke_tokens',
        targetUserId: id,
        details: `强制退出账号 ${row.username} 的所有设备`,
        ip: req.ip || '',
        con,
      });
    });
    ok(res, { revoked: true, user: publicUser(await getOne('SELECT * FROM users WHERE id = ?', [id])) });
  } catch (e) {
    fail(res, 500, e.message);
  }
});

// 安全审计日志(默认最近 100 条)
router.get('/security-audit-logs', async (req, res) => {
  const limit = Math.min(Math.max(Number((req.query || {}).limit) || 100, 1), 500);
  try {
    ok(
      res,
      await query(
        'SELECT * FROM security_audit_logs ORDER BY id DESC LIMIT ' + String(limit)
      )
    );
  } catch (e) {
    fail(res, 500, e.message);
  }
});
