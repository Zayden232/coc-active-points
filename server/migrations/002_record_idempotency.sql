-- ============================================================
-- 迁移 002: 录入幂等令牌
-- 目的: 同一批录入共用一个 client_token, 客户端双击/弱网重试不会重复记账;
--       支持按批次撤销 (POST /api/records/batches/:token/revoke)。
-- 说明: 可重复执行(存在则跳过), 不影响历史数据(NULL 不参与唯一约束)。
-- 执行: mysql -uroot -p coc_points < migrations/002_record_idempotency.sql
-- ============================================================

-- 1) 新增列 client_token
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'score_records' AND COLUMN_NAME = 'client_token'
);
SET @sql := IF(@has_col = 0,
  'ALTER TABLE score_records ADD COLUMN client_token VARCHAR(64) NULL COMMENT ''录入批次幂等令牌'' AFTER note',
  'SELECT ''client_token 已存在, 跳过'' AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) 唯一索引: 同一批次 + 同一成员 + 同一规则 + 同一周 只允许一条
SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'score_records' AND INDEX_NAME = 'uk_records_client'
);
SET @sql := IF(@has_idx = 0,
  'ALTER TABLE score_records ADD UNIQUE KEY uk_records_client (client_token, rule_id, member_id, week_start)',
  'SELECT ''uk_records_client 已存在, 跳过'' AS msg');
PREPARE stmt2 FROM @sql;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

-- 3) 结构确认
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'score_records' AND COLUMN_NAME = 'client_token';
