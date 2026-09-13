-- ============================================================
-- 迁移 003: 幸运转盘
--   wheel_spins      每日抽奖记录(同一成员每天一条, 唯一键保证幂等)
--   member_cosmetics 成员限时外观(头像框/彩色昵称/称号, 带过期时间)
-- 可重复执行(IF NOT EXISTS)。
-- 执行: mysql -uroot -p coc_points < migrations/003_wheel.sql
-- ============================================================
USE coc_points;

CREATE TABLE IF NOT EXISTS wheel_spins (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  draw_date    DATE NOT NULL COMMENT '业务日期(服务器本地时区)',
  member_id    BIGINT UNSIGNED NOT NULL,
  reward_key   VARCHAR(32) NOT NULL DEFAULT '' COMMENT '空=谢谢参与',
  reward_label VARCHAR(64) NOT NULL DEFAULT '',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_wheel_member_date (member_id, draw_date),
  KEY idx_wheel_date (draw_date),
  CONSTRAINT fk_wheel_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='转盘每日抽奖记录';

CREATE TABLE IF NOT EXISTS member_cosmetics (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  member_id  BIGINT UNSIGNED NOT NULL,
  kind       ENUM('frame','nickname_color','title') NOT NULL,
  value      VARCHAR(32) NOT NULL,
  label      VARCHAR(64) NOT NULL DEFAULT '',
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cosmetic_member_kind (member_id, kind),
  KEY idx_cosmetic_expire (expires_at),
  CONSTRAINT fk_cosmetic_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='成员限时外观';

SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('wheel_spins','member_cosmetics');
