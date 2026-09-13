-- ============================================================
-- 部落活跃积分管理 数据库初始化脚本
-- 目标: MySQL 8.x (已验证 8.0.46 / Ubuntu 24.04)
-- 独立库名: coc_points —— 与 Typecho 博客库完全隔离, 绝不共用
-- 用法: mysql -uroot -p < schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS coc_points
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE coc_points;

-- ------------------------------------------------------------
-- 成员表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS members (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nickname   VARCHAR(64)  NOT NULL COMMENT '游戏昵称(CoC内全局唯一)',
  tag        VARCHAR(32)  NOT NULL DEFAULT '' COMMENT '玩家标签 #XXX, 可选',
  town_hall  TINYINT UNSIGNED NULL COMMENT '大本营等级(不小于1的整数, 不设上限), 识图导入/手工填写',
  prosperity INT UNSIGNED NULL COMMENT '繁荣度(识图导入/手工填写, 非负整数不设上限), 成员列表默认按它降序',
  join_date  DATE         NULL COMMENT '入部落时间',
  status     TINYINT      NOT NULL DEFAULT 0 COMMENT '0部落战绿牌 1部落战红牌 2离开',
  red_since  DATE         NULL COMMENT '本次红牌开始业务日期',
  note       VARCHAR(255) NOT NULL DEFAULT '' COMMENT '备注',
  deleted_at DATETIME     NULL COMMENT '归档时间, 非物理删除',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_members_nickname (nickname),
  KEY idx_members_deleted (deleted_at)
) ENGINE=InnoDB COMMENT='部落成员';

-- ------------------------------------------------------------
-- 成员状态审计日志 / 批量操作幂等 (迁移 005)
-- ------------------------------------------------------------
-- ------------------------------------------------------------
-- 账号体系 + 安全审计 (迁移 006)
-- ------------------------------------------------------------
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

CREATE TABLE IF NOT EXISTS member_status_logs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  member_id     BIGINT UNSIGNED NOT NULL,
  old_status    TINYINT NULL,
  new_status    TINYINT NULL,
  old_red_since DATE NULL,
  new_red_since DATE NULL,
  reason        VARCHAR(255) NOT NULL DEFAULT '',
  batch_id      VARCHAR(64) NOT NULL DEFAULT '',
  actor_user_id BIGINT UNSIGNED NULL COMMENT '操作人 user id',
  actor_username VARCHAR(64) NOT NULL DEFAULT '' COMMENT '操作人用户名快照',
  actor_role    VARCHAR(16) NOT NULL DEFAULT '' COMMENT '操作时角色快照',
  actor         VARCHAR(32) NOT NULL DEFAULT 'admin',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_msl_member (member_id, id),
  KEY idx_msl_batch (batch_id),
  KEY idx_msl_created (created_at)
) ENGINE=InnoDB COMMENT='成员状态/红牌时间变更审计日志';

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

-- ------------------------------------------------------------
-- 积分规则配置表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS score_rules (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name            VARCHAR(64) NOT NULL COMMENT '积分项名称, 如"捐兵分"',
  unit            VARCHAR(64) NOT NULL DEFAULT '' COMMENT '计量单位, 如"每100兵力"',
  score_per_unit  DECIMAL(10,2) NOT NULL DEFAULT 1.00 COMMENT '每单位基础分',
  weekly_cap      DECIMAL(10,2) NULL COMMENT '每周该成员该单项得分上限, NULL=不限',
  quick_values    VARCHAR(64) NOT NULL DEFAULT '' COMMENT '录入页快捷数量(逗号分隔, 最多4个, 与 quantity 同单位)',
  enabled         TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '是否启用',
  sort_order      INT          NOT NULL DEFAULT 0 COMMENT '显示排序',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rules_name (name)
) ENGINE=InnoDB COMMENT='积分规则配置';

-- ------------------------------------------------------------
-- 积分流水表 (每次录入一条)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS score_records (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  member_id  BIGINT UNSIGNED NOT NULL,
  rule_id    BIGINT UNSIGNED NOT NULL,
  quantity   DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '数量(兵力/次数等)',
  score      DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '= quantity * score_per_unit(记录时)',
  week_start DATE NOT NULL COMMENT '所属周周一(用于周期聚合)',
  note       VARCHAR(255) NOT NULL DEFAULT '',
  client_token VARCHAR(64) NULL COMMENT '录入批次幂等令牌(同一批共享)',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_records_client (client_token, rule_id, member_id, week_start),
  KEY idx_records_week (week_start),
  KEY idx_records_member_week (member_id, week_start),
  KEY idx_records_rule (rule_id),
  CONSTRAINT fk_records_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  CONSTRAINT fk_records_rule   FOREIGN KEY (rule_id)   REFERENCES score_rules(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='积分流水';

-- ------------------------------------------------------------
-- 周期结算快照表 (周/月/赛季的排名结果)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weekly_results (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cycle_type    ENUM('week','month','season') NOT NULL,
  cycle_start   DATE NOT NULL COMMENT '周期起始(周一)',
  member_id     BIGINT UNSIGNED NOT NULL,
  total_score   DECIMAL(12,2) NOT NULL DEFAULT 0,
  rank_no       INT NOT NULL DEFAULT 0 COMMENT '名次, 1=冠军',
  reward_amount DECIMAL(10,2) NULL COMMENT '冠军奖励金额(仅冠军非空)',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_result_cycle_member (cycle_type, cycle_start, member_id),
  KEY idx_result_cycle (cycle_type, cycle_start, rank_no),
  CONSTRAINT fk_results_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='周期结算快照';

-- ------------------------------------------------------------
-- 红包发放记录表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reward_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cycle_type  ENUM('week','month','season') NOT NULL,
  cycle_start DATE NOT NULL,
  member_id   BIGINT UNSIGNED NOT NULL,
  amount      DECIMAL(10,2) NOT NULL,
  paid        TINYINT(1) NOT NULL DEFAULT 0 COMMENT '0待发放 1已发放',
  note        VARCHAR(255) NOT NULL DEFAULT '',
  paid_at     DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_reward_cycle (cycle_type, cycle_start, member_id),
  CONSTRAINT fk_reward_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='红包发放记录';

-- ------------------------------------------------------------
-- 配置表 (key-value)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  skey       VARCHAR(64) NOT NULL,
  svalue     VARCHAR(255) NOT NULL DEFAULT '',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (skey)
) ENGINE=InnoDB COMMENT='配置';

-- ------------------------------------------------------------
-- 幸运转盘: 每日抽奖记录 (同一成员每天一条)
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 成员限时外观 (头像框 / 彩色昵称 / 限时称号, 到期自动失效)
-- ------------------------------------------------------------
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

-- ============================================================
-- 独立数据库账号 (与 root / Typecho 隔离, 只授权本库)
-- 把下面的强密码替换后手动执行一次:
--   CREATE USER 'coc_app'@'localhost' IDENTIFIED BY '<强密码>';
--   GRANT ALL PRIVILEGES ON coc_points.* TO 'coc_app'@'localhost';
--   FLUSH PRIVILEGES;
-- ============================================================
