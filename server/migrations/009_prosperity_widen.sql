-- ============================================================
-- 迁移 009: 去掉繁荣度的物理上限
--   背景: 迁移 008 把 prosperity 建成了 SMALLINT UNSIGNED(最大 65535),
--         代码里还额外卡了 0-1000000 —— 都是写死的上限, 游戏数据涨上去迟早不够用。
--         按用户要求全部删掉: 代码只校验"非负整数", 列类型放宽到 INT UNSIGNED。
--   说明: 只改列类型/注释, 不动数据; 可重复执行(已是 INT UNSIGNED 时跳过)。
--   执行: mysql -uroot -p coc_points < migrations/009_prosperity_widen.sql
-- ============================================================
USE coc_points;

SET @sql := IF(
  (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND COLUMN_NAME = 'prosperity') = 'smallint unsigned',
  'ALTER TABLE members MODIFY COLUMN prosperity INT UNSIGNED NULL COMMENT ''繁荣度(识图导入/手工填写, 非负整数不设上限), 成员列表默认按它降序''',
  'SELECT ''members.prosperity 已是更宽的类型, 跳过'' AS skipped'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 顺带把注释里的"上限"措辞统一
ALTER TABLE members MODIFY COLUMN town_hall TINYINT UNSIGNED NULL COMMENT '大本营等级(不小于1的整数, 不设上限), 识图导入/手工填写';

-- 结构确认
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND COLUMN_NAME IN ('town_hall', 'prosperity');
