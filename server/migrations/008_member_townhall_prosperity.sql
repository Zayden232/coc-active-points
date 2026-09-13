-- ============================================================
-- 迁移 008: 成员大本营等级 + 繁荣度
--   背景: 识图导入的数据是「名称、大本营、部落战牌子、繁荣度」,
--         部落战牌子 = 现有的 members.status(0 绿牌 / 1 红牌), 无需新列;
--         大本营与繁荣度是新的资料字段, 用于展示与按繁荣度排行。
--   说明: 两列都可为空(历史成员没有数据), 可重复执行。
--   执行: mysql -uroot -p coc_points < migrations/008_member_townhall_prosperity.sql
-- ============================================================
USE coc_points;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND COLUMN_NAME = 'town_hall'),
  'SELECT ''members.town_hall 已存在, 跳过'' AS skipped',
  'ALTER TABLE members ADD COLUMN town_hall TINYINT UNSIGNED NULL COMMENT ''大本营等级(不小于1的整数, 不设上限), 识图导入/手工填写'' AFTER tag'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND COLUMN_NAME = 'prosperity'),
  'SELECT ''members.prosperity 已存在, 跳过'' AS skipped',
  'ALTER TABLE members ADD COLUMN prosperity INT UNSIGNED NULL COMMENT ''繁荣度(识图导入/手工填写, 非负整数不设上限), 成员列表默认按它降序'' AFTER town_hall'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 结构确认
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND COLUMN_NAME IN ('town_hall', 'prosperity');
