-- ============================================================
-- 迁移 007: 积分规则快捷数量 (score_rules.quick_values)
--   录入页的快捷按钮改为**后端显式配置**(不再按规则名猜 +100/+500/+1000)。
--   值必须与 /api/records 接受的 quantity 单位一致(无隐式换算)。
--   存储为逗号分隔字符串, 最多 4 个正数; 留空则前端回退 [1,2,5]。
-- 可重复执行(information_schema 判断)。
-- 旧数据: 按各规则现有 unit 与生产实际输入习惯补齐(捐兵/竞赛 = 原始数量单位)。
-- 执行: mysql -uroot -p coc_points < migrations/007_rule_quick_values.sql
-- ============================================================
USE coc_points;

SET @sql := IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'score_rules' AND COLUMN_NAME = 'quick_values'),
  'SELECT ''score_rules.quick_values 已存在, 跳过'' AS skipped',
  'ALTER TABLE score_rules ADD COLUMN quick_values VARCHAR(64) NOT NULL DEFAULT '''' COMMENT ''录入页快捷数量(逗号分隔, 最多4个, 与 quantity 同单位)'' AFTER weekly_cap'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 仅给"还没配置过"的规则补默认值(不覆盖管理员已改过的值)
UPDATE score_rules SET quick_values = '100,500,1000' WHERE quick_values = '' AND name LIKE '%捐兵%';
UPDATE score_rules SET quick_values = '1000,2000,5000' WHERE quick_values = '' AND (name LIKE '%竞赛%' OR unit LIKE '%点数%');
UPDATE score_rules SET quick_values = '1,2,3' WHERE quick_values = '' AND (name LIKE '%部落战%' OR name LIKE '%突袭%' OR name LIKE '%都城%');
UPDATE score_rules SET quick_values = '1,2,5' WHERE quick_values = '' AND (name LIKE '%联赛%' OR name LIKE '%星%');

SELECT id, name, unit, score_per_unit, weekly_cap, enabled, quick_values FROM score_rules ORDER BY sort_order, id;
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'score_rules' AND COLUMN_NAME = 'quick_values';
