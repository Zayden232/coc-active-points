-- ============================================================
-- 迁移 005: 红牌计时 (red_since) + 归档 (deleted_at) + 状态审计/批次幂等
--   1) members.red_since  本次红牌开始的业务日期(DATE), 绿牌/离开为 NULL
--   2) members.deleted_at 归档时间(DATETIME), 非物理删除; 归档成员不再出现在默认列表
--   3) member_status_logs 状态/红牌时间变更审计日志
--   4) member_batch_tokens 批量操作幂等记录(同 token 同内容返回原结果, 不同内容 409)
-- 可重复执行(IF NOT EXISTS / information_schema 判断)。
-- 旧数据处理: 已有绿牌/离开成员 red_since 保持 NULL; 已有红牌成员同样保持 NULL
--            (页面显示"红牌时间待补录", 由管理员用 PUT /members/:id/red-since 补录),
--            绝不把历史红牌成员统一设成今天。
-- 执行: mysql -uroot -p coc_points < migrations/005_member_red_archive.sql
-- ============================================================
USE coc_points;

-- 1) members.red_since (MySQL 的 ADD COLUMN 不支持 IF NOT EXISTS, 用预处理语句判断)
SET @sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND COLUMN_NAME = 'red_since'
  ),
  'SELECT ''members.red_since 已存在, 跳过'' AS skipped',
  'ALTER TABLE members ADD COLUMN red_since DATE NULL COMMENT ''本次红牌开始业务日期'' AFTER status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) members.deleted_at
SET @sql := IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND COLUMN_NAME = 'deleted_at'
  ),
  'SELECT ''members.deleted_at 已存在, 跳过'' AS skipped',
  'ALTER TABLE members ADD COLUMN deleted_at DATETIME NULL COMMENT ''归档时间, 非物理删除'' AFTER note, ADD KEY idx_members_deleted (deleted_at)'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3) 状态变更审计日志
CREATE TABLE IF NOT EXISTS member_status_logs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  member_id     BIGINT UNSIGNED NOT NULL,
  old_status    TINYINT NULL,
  new_status    TINYINT NULL,
  old_red_since DATE NULL,
  new_red_since DATE NULL,
  reason        VARCHAR(255) NOT NULL DEFAULT '',
  batch_id      VARCHAR(64) NOT NULL DEFAULT '',
  actor         VARCHAR(32) NOT NULL DEFAULT 'admin',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_msl_member (member_id, id),
  KEY idx_msl_batch (batch_id),
  KEY idx_msl_created (created_at)
) ENGINE=InnoDB COMMENT='成员状态/红牌时间变更审计日志';

-- 4) 批量操作幂等记录
CREATE TABLE IF NOT EXISTS member_batch_tokens (
  client_token VARCHAR(64) NOT NULL,
  payload_hash CHAR(64) NOT NULL COMMENT '规范化请求体的 sha256',
  operation    VARCHAR(16) NOT NULL DEFAULT '',
  affected     INT NOT NULL DEFAULT 0,
  response     JSON NULL COMMENT '首次执行的响应, 同 token 同内容时原样返回',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_token),
  KEY idx_mbt_created (created_at)
) ENGINE=InnoDB COMMENT='成员批量操作幂等记录';

-- 校验
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('member_status_logs','member_batch_tokens');

SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND COLUMN_NAME IN ('red_since','deleted_at');
