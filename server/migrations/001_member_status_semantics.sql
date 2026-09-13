-- ============================================================
-- 迁移 001: 成员状态语义调整
-- 数值保持不变, 只更新列注释 (不改任何数据, 可重复执行):
--   0 正常  -> 0 部落战绿牌
--   1 请假  -> 1 部落战红牌
--   2 离开  -> 2 离开 (语义不变)
-- 执行: mysql -uroot -p coc_points < migrations/001_member_status_semantics.sql
-- ============================================================
ALTER TABLE members
  MODIFY COLUMN status TINYINT NOT NULL DEFAULT 0 COMMENT '0部落战绿牌 1部落战红牌 2离开';
