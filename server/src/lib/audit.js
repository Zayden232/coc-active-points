// 审计写入: 安全审计(账号相关) + 业务审计的操作人快照
import { run } from '../db.js';

/** 从 req.auth 取操作人快照(旧数据/游客为 null, 绝不冒充新账号) */
export function actorOf(req) {
  const a = (req && req.auth) || {};
  if (!a.user) return { id: null, username: '', role: a.role || '' };
  return {
    id: a.user.id,
    username: a.user.username || '',
    role: a.user.role || a.role || '',
  };
}

/** 安全审计日志(创建/停用/重置密码/改密/强制退出等)。不要写明文密码或 Token。 */
export async function writeSecurityAudit({ actor, action, targetUserId = null, details = '', ip = '', con = null }) {
  const actorId = actor && actor.id ? actor.id : null;
  const actorName = (actor && actor.username) || 'system';
  const sql =
    'INSERT INTO security_audit_logs (actor_user_id, actor_username, action, target_user_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)';
  const params = [
    actorId,
    String(actorName).slice(0, 64),
    String(action || '').slice(0, 64),
    targetUserId === null || targetUserId === undefined ? null : Number(targetUserId),
    String(details || '').slice(0, 255),
    String(ip || '').slice(0, 64),
  ];
  if (con && con.execute) return con.execute(sql, params);
  return run(sql, params);
}
