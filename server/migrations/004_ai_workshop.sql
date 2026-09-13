-- ============================================================
-- 迁移 004: AI 创作工坊(生图)
--   ai_workshop_guard  单行锁表, 用于串行化配额检查(避免并发突破 200/10 张上限)
--   ai_image_jobs      生成任务(异步队列, 临时图片有有效期)
--   ai_gallery_images  主动上传到服务器的图库(有配额)
-- 可重复执行(IF NOT EXISTS / INSERT IGNORE)。
-- 执行: mysql -uroot -p coc_points < migrations/004_ai_workshop.sql
-- 说明: 图片文件本体存在服务器磁盘(AI_STORAGE_DIR), 数据库只记录元数据;
--       备份脚本走 mysqldump, 因此图片文件需另行备份(见 deploy/DEPLOY.md)。
-- ============================================================
USE coc_points;

-- 1) 配额串行锁: 所有涉及名额的写操作先 SELECT ... FOR UPDATE 这一行
CREATE TABLE IF NOT EXISTS ai_workshop_guard (
  id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB COMMENT='AI 工坊配额串行锁(仅一行)';

INSERT IGNORE INTO ai_workshop_guard (id) VALUES (1);

-- 2) 生成任务
CREATE TABLE IF NOT EXISTS ai_image_jobs (
  id            CHAR(36) NOT NULL COMMENT '任务 UUID',
  actor_key     CHAR(64) NOT NULL COMMENT '身份键(HMAC, 不存明文身份)',
  client_token  VARCHAR(80) NOT NULL COMMENT '客户端幂等编号',
  request_hash  CHAR(64) NOT NULL COMMENT '请求内容哈希(同编号换内容 -> 409)',
  prompt        TEXT NOT NULL,
  model         VARCHAR(120) NOT NULL,
  image_size    VARCHAR(16) NOT NULL DEFAULT '1024x1024' COMMENT '实际提交给供应商的尺寸',
  status        VARCHAR(20) NOT NULL COMMENT 'queued/running/succeeded/failed/expired/unknown',
  error_message VARCHAR(500) NULL,
  file_name     VARCHAR(100) NULL COMMENT '临时图片文件名(位于 AI_STORAGE_DIR/temporary)',
  file_bytes    INT UNSIGNED NULL,
  business_day  CHAR(10) NOT NULL COMMENT '业务日(服务器本地时区), 用于每日额度',
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  expires_at    DATETIME(3) NULL COMMENT '临时图片过期时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_job_request (actor_key, client_token),
  KEY idx_ai_job_status (status, created_at),
  KEY idx_ai_job_day (business_day, actor_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI 生图任务';

-- 3) 服务器图库
CREATE TABLE IF NOT EXISTS ai_gallery_images (
  id            CHAR(36) NOT NULL,
  actor_key     CHAR(64) NOT NULL,
  ip_key        CHAR(64) NOT NULL COMMENT '来源 IP 键(HMAC)',
  client_token  VARCHAR(80) NOT NULL,
  content_hash  CHAR(64) NOT NULL COMMENT '图片内容哈希(幂等 + 完整性)',
  status        VARCHAR(20) NOT NULL COMMENT 'pending/ready/deleting/deleted',
  file_name     VARCHAR(100) NOT NULL COMMENT '图片文件名(位于 AI_STORAGE_DIR/gallery)',
  file_bytes    INT UNSIGNED NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_gallery_request (actor_key, client_token),
  KEY idx_ai_gallery_status (status, created_at),
  KEY idx_ai_gallery_actor (actor_key, status),
  KEY idx_ai_gallery_ip (ip_key, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI 工坊服务器图库';

-- 4) 结构确认
SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('ai_workshop_guard','ai_image_jobs','ai_gallery_images');
