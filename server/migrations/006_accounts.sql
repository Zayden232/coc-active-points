-- ============================================================
-- 迁移 006: 账号体系 (users) + 安全审计 + 业务审计操作人字段
--   1) users 表: super_admin / admin 账号, scrypt 密码哈希, token_version 支持即时吊销
--      - username 唯一; 用生成列 + 唯一索引保证"最多一个超级管理员"
--      - 不保留旧 ADMIN_PASSWORD 登录后门(初始化走服务器本地 CLI)
--   2) security_audit_logs: 创建/停用/启停/重置密码/改密/强制退出/高危操作
--   3) member_status_logs 增加 actor_user_id / actor_username / actor_role 快照
--      (旧记录保持 actor='admin', 不冒充新账号)
-- 可重复执行(IF NOT EXISTS / information_schema 判断)。
-- 执行: mysql -uroot -p coc_points < migrations/006_accounts.sql
-- ============================================================
USE coc_points;

CREATE TABLE IF NOT EXISTS users (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username             VARCHAR(32) NOT NULL COMMENT '登录名(小写唯一)',
  display_name         VARCHAR(32) NOT NULL DEFAULT '' COMMENT '显示名称',
  password_hash        VARCHAR(255) NOT NULL COMMENT 'scrypt 哈希, 不存明文',
  role                 ENUM('super_admin','admin') NOT NULL DEFAULT 'admin',
  enabled              TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  token_version        INT NOT NULL DEFAULT 1 COMMENT '登录凭证版本, 递增即吊销旧Token',
  must_change_password TINYINT NOT NULL DEFAULT 0 COMMENT '首次登录/重置后必须改密',
  created_by           BIGINT UNSIGNED NULL COMMENT '创建人 user id',
  last_login_at        DATETIME NULL,
  password_changed_at  DATETIME NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- 生成列: 超级管理员行=1, 其余=NULL; 配合唯一索引 => super_admin 最多一个
  super_only           TINYINT GENERATED ALWAYS AS (IF(role = 'super_admin', 1, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_username (username),
  UNIQUE KEY uk_users_single_super (super_only)
) ENGINE=InnoDB COMMENT='管理员账号';

CREATE TABLE IF NOT EXISTS security_audit_logs (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id  BIGINT UNSIGNED NULL COMMENT '操作人 user id(system 为空)',
  actor_username VARCHAR(64) NOT NULL DEFAULT '' COMMENT '操作人用户名快照',
  action         VARCHAR(64) NOT NULL DEFAULT '' COMMENT '动作标识',
  target_user_id BIGINT UNSIGNED NULL COMMENT '被操作账号',
  details        VARCHAR(255) NOT NULL DEFAULT '' COMMENT '说明(不含密码/Token)',
  ip             VARCHAR(64) NOT NULL DEFAULT '',
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sal_actor (actor_user_id, id),
  KEY idx_sal_target (target_user_id, id),
  KEY idx_sal_action (action, id)
) ENGINE=InnoDB COMMENT='安全审计日志';

-- 业务审计(成员状态)增加操作人快照
SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'member_status_logs' AND COLUMN_NAME = 'actor_user_id'),
  'SELECT ''member_status_logs.actor_user_id 已存在, 跳过'' AS skipped',
  'ALTER TABLE member_status_logs
     ADD COLUMN actor_user_id BIGINT UNSIGNED NULL COMMENT ''操作人 user id'' AFTER batch_id,
     ADD COLUMN actor_username VARCHAR(64) NOT NULL DEFAULT '''' COMMENT ''操作人用户名快照'' AFTER actor_user_id,
     ADD COLUMN actor_role VARCHAR(16) NOT NULL DEFAULT '''' COMMENT ''操作时角色快照'' AFTER actor_username'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 校验
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('users','security_audit_logs');

SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'member_status_logs'
  AND COLUMN_NAME IN ('actor_user_id','actor_username','actor_role');

SELECT COUNT(*) AS super_admin_count FROM users WHERE role = 'super_admin';
