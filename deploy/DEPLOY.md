# 部署手册 · 部落活跃积分管理

> 目标服务器：阿里云 ECS（Ubuntu 24.04，2核2G，已跑 Typecho 博客）
> 原则：**绝不触碰 Typecho 博客**（数据库、Nginx 配置、目录全部分离）

## 0. 架构总览

```
浏览器/手机  →  https://app.jiacheng.cyou  (Nginx)
                     ├── /            → H5 静态文件  /var/www/coc-points/h5
                     └── /api/*       → Node 后端 127.0.0.1:3000 (systemd 守护)
                                              └── MySQL: coc_points 库 (与 Typecho 库隔离)
```

前端用 hash 路由，纯静态托管即可，无需服务端路由配置。

### 0.1 环境变量清单（`/opt/coc-points/server/.env`）

| 变量 | 必填 | 说明 |
|---|---|---|
| `PORT` | 否 | 后端端口，默认 `3000`（仅监听 127.0.0.1，由 nginx 反代） |
| `DB_HOST` / `DB_PORT` | 否 | 默认 `127.0.0.1` / `3306` |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | 是 | 独立账号，仅授权 `coc_points.*` |
| `DB_POOL` | 否 | 连接池大小，默认 5 |
| `JWT_SECRET` | 是 | `openssl rand -hex 32` |
| `TOKEN_EXPIRES` | 否 | 登录有效期，默认 `7d` |
| `ADMIN_PASSWORD` | ❌ **已废弃** | 账号体系上线后**不再用于登录**（管理员账号在数据库 `users` 表）。留着无害，可以删除；初始化超级管理员时曾用它作为初始密码 |
| `COC_API_TOKEN` | 否 | **部落冲突官方 API key**（[developer.clashofclans.com](https://developer.clashofclans.com) 创建，需把服务器出网 IP 加进允许列表，否则 403 `accessDenied`）。留空 = 关闭成员同步。**只在服务端使用**：不下发前端、不写日志 |
| `COC_API_BASE` | 否 | 默认 `https://api.clashofclans.com/v1`；仅 E2E/本地桩服务时覆盖 |
| `VIEWER_PASSWORD` | 否 | 可选的访客口令入口（`POST /api/auth/viewer-login`）；**留空即关闭**。注意：匿名访客本来就默认可只读浏览公开数据 |
| `CORS_ORIGINS` | 否 | 跨域白名单，逗号分隔（`*` = 任意来源）；**留空 = 关闭**。线上是同源部署（nginx 反代 `/api`），**保持留空**；只有当打包后的 H5 被放到别的域名/机器上直接请求本后端时才需要开，且前端构建时必须同时指定 `VITE_API_BASE` |
| `WHEEL_FORCE` / `WHEEL_FORCE_REWARD` | ❌ | **仅 E2E 测试钩子**（强制中奖 / 指定奖励），生产**不得**设置 |
| `SILICONFLOW_API_KEY` | 否 | 硅基流动生图密钥；**留空 = 不启用 AI 创作工坊**，其余功能不受影响 |
| `AI_IDENTITY_SECRET` | 否 | 生图配额的 IP/身份 HMAC 密钥，≥32 字符（`openssl rand -hex 32`）；与 Key 一起配置才启用生图 |
| `AI_IMAGE_MODEL` | 否 | 默认 `Kwai-Kolors/Kolors` |
| `AI_IMAGE_SIZE` | 否 | 服务器默认尺寸，默认 `1024x1024`；**只接受 Kolors 推荐值**（见 `.env.example`），填错会启动失败 |
| `AI_IMAGE_DOWNLOAD_HOSTS` | 是（用生图时） | 生成结果的可信图片域名，逗号分隔，**不要填 `*`**；填错时任务会失败并在错误信息里提示 |
| `AI_STORAGE_DIR` | 否 | 图片存储目录，默认 `./data/ai`；**必须位于 Nginx 静态根目录之外** |
| `AI_ENABLE_WATERMARK` | 否 | 默认 `0`＝请求无水印（平台自 2026-09-30 起默认打「AI 生成」水印）；设 `1` 保留水印 |
| `AI_SEND_NEGATIVE_PROMPT` | 否 | 默认 `1`＝发送 `negative_prompt`（Kolors 正式字段）；换模型若不支持则设 `0` |
| `AI_DAILY_LIMIT` | 否 | **管理员**每身份每日生成上限；`0` = 不限（默认 `0`） |
| `AI_VIEWER_DAILY_LIMIT` | 否 | **非管理员**每身份每日生成上限（默认 `10`） |
| `AI_GLOBAL_DAILY_LIMIT` | 否 | 全站每日生成上限，所有角色合计（默认 `2000`） |
| `AI_VIEWER_UPLOAD_DAILY_LIMIT` | 否 | 非管理员每日上传张数（默认 `10`）；管理员不受限；`0` = 不限 |
| `AI_TEMP_MAX_IMAGES` | 否 | 未上传的临时生成图上限（默认 20，30 分钟过期） |

修改任何变量后执行：`systemctl restart coc-points`。

### 0.2 增量迁移清单（生产升级只跑这里）

```bash
cd /opt/coc-points/server
mysql -uroot -p coc_points < migrations/001_member_status_semantics.sql   # 成员三态注释
mysql -uroot -p coc_points < migrations/002_record_idempotency.sql        # 录入幂等令牌
mysql -uroot -p coc_points < migrations/003_wheel.sql                     # 转盘抽奖 + 限时外观
mysql -uroot -p coc_points < migrations/004_ai_workshop.sql               # AI 创作工坊(生图)
mysql -uroot -p coc_points < migrations/005_member_red_archive.sql        # 红牌计时 + 成员归档 + 状态审计/批次幂等
mysql -uroot -p coc_points < migrations/006_accounts.sql                 # 账号体系(users) + 安全审计 + 审计操作人字段
mysql -uroot -p coc_points < migrations/007_rule_quick_values.sql        # 积分规则快捷数量 quick_values
mysql -uroot -p coc_points < migrations/008_member_townhall_prosperity.sql  # 成员大本营等级 town_hall + 繁荣度 prosperity
mysql -uroot -p coc_points < migrations/009_prosperity_widen.sql           # 繁荣度列放宽 SMALLINT → INT UNSIGNED(不设上限)
```

- 脚本都是**幂等**的（已存在/已放宽则跳过），可安全重复执行。
- **不要在生产库重跑 `schema.sql`**（那是新装环境的完整脚本）。
- 每次结构变更前先备份：`bash /opt/coc-points/backup.sh`（全库 dump，新表自动包含）。
- ⚠️ `backup.sh` 只 dump **数据库**；AI 工坊的图片文件在磁盘上（`AI_STORAGE_DIR`），
  需要单独备份，见下方「批次 5」。

### 0.3 常用运维命令

```bash
systemctl status coc-points            # 后端状态
systemctl restart coc-points           # 重启（改 .env / 更新代码后）
journalctl -u coc-points -n 50         # 后端日志
bash /opt/coc-points/backup.sh         # 手动备份一次
ls -lt /var/backups/coc-points/        # 备份产物（保留 30 天）
curl -s http://127.0.0.1:3000/api/health      # 本机健康检查
curl -s https://app.jiacheng.cyou/api/health  # 公网健康检查
```

---

## 1. 前置：DNS 解析

在域名管理后台给 `app.jiacheng.cyou` 加一条 **A 记录**，指向服务器公网 IP。
（子域名一般随主域名备案覆盖，无需单独备案。）

---

## 2. 服务器安装 Node（只需一次）

```bash
sudo apt update
sudo apt install -y nodejs npm
node -v   # 需要 v18.17+；启用 AI 工坊(sharp) 建议 v20 或更高
```

> ⚠️ **启用 AI 创作工坊时 Node 必须 ≥18.17（建议 20 LTS）**：
> 生图模块依赖 `sharp`，它用到了较新的 N-API。
> Ubuntu 24.04 的 apt 源默认装 Node 18，对本项目其它功能足够；
> 若 `npm install` 报 sharp 相关错误，请改用 NodeSource 的 Node 20。

---

## 3. 建库 + 独立账号

```bash
# 3.1 建库建表（执行工作区里的 schema.sql）
mysql -uroot -p < schema.sql

# 3.2 建独立账号（只授权 coc_points 库，绝不碰 Typecho 库）
mysql -uroot -p
```

在 mysql 里执行（把 `你的强密码` 替换掉）：

```sql
CREATE USER 'coc_app'@'localhost' IDENTIFIED BY '你的强密码';
GRANT ALL PRIVILEGES ON coc_points.* TO 'coc_app'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

> `schema.sql` **只用于全新安装**。已有环境升级请执行 `migrations/` 下的增量脚本（见 0.2）。
> 若后端要连 `127.0.0.1`，建议同时建 `'coc_app'@'127.0.0.1'` 并授予同样权限。

---

## 4. 上传后端 + 配置

```bash
sudo mkdir -p /opt/coc-points
# 把本机工作区的 server/ 目录整个传到服务器（用 scp 或 WinSCP）
# scp -r server root@服务器IP:/opt/coc-points/server

cd /opt/coc-points/server
sudo cp .env.example .env
sudo nano .env        # 填 DB_PASSWORD / JWT_SECRET /(可选) VIEWER_PASSWORD
sudo npm install --production

# 首次装完必须初始化超级管理员(交互式输入用户名与密码, 不写日志):
sudo -u www-data npm run user:init-super-admin
```

`.env` 关键项：

```
DB_PASSWORD=第3步的强密码
JWT_SECRET=用 `openssl rand -hex 32` 生成
VIEWER_PASSWORD=可选的访客口令（留空即关闭；匿名访客默认可只读浏览）
# 管理员账号不再用环境变量: 存在 users 表, 用 npm run user:init-super-admin 初始化
```

---

## 5. 用 systemd 启动后端

```bash
sudo cp /opt/coc-points/server/../deploy/coc-points.service /etc/systemd/system/   # 或直接从工作区 deploy/ 传
sudo systemctl daemon-reload
sudo systemctl enable --now coc-points
sudo systemctl status coc-points    # 应显示 active (running)
curl http://127.0.0.1:3000/api/health   # 应返回 {"ok":true,...}
```

> 后端首次启动会自动写入默认配置与默认积分规则（占位分值，可在设置页改）。
> 账号体系：**匿名访客可直接浏览公开只读数据**；管理员用 `用户名 + 密码`（`users` 表）登录后可读写；
> 用 `VIEWER_PASSWORD` 走 `POST /api/auth/viewer-login` 则是「访客 · 只读」（所有写接口返回 403）。
> 首个超级管理员用 `npm run user:init-super-admin` 在服务器本地创建。

---

## 6. 前端构建 + 上传

在你**本机**（已装 Node）的工作区：

```bash
cd app
npm install
npm run build:h5        # 产物在 dist/build/h5
```

把 `dist/build/h5` 整个目录传到服务器：

```bash
sudo mkdir -p /var/www/coc-points/h5
# scp -r app/dist/build/h5/* root@服务器IP:/var/www/coc-points/h5/
```

---

## 7. Nginx + HTTPS

```bash
# 7.1 站点配置（从工作区 deploy/ 传，或直接新建）
sudo nano /etc/nginx/conf.d/coc-points.conf
# 内容见 coc-points.nginx.conf

sudo nginx -t && sudo systemctl reload nginx
```

```bash
# 7.2 申请 HTTPS 证书（自动改写配置并加 443 跳转）
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d app.jiacheng.cyou
```

完成后浏览器访问 `https://app.jiacheng.cyou` 即可。

---

## 8. 冒烟测试

```bash
BASE=https://app.jiacheng.cyou

# 8.1 健康检查
curl -s $BASE/api/health

# 8.2 匿名访客: 公开只读可看, 管理/写接口拒绝
curl -s -o /dev/null -w '匿名读成员: %{http_code}\n' $BASE/api/members          # 200
curl -s -o /dev/null -w '匿名读设置: %{http_code}\n' $BASE/api/settings         # 401
curl -s $BASE/api/auth/me                                                        # role=guest

# 8.3 管理员登录(用户名 + 密码)拿 token
AT=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"你的密码"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["token"])')
curl -s $BASE/api/auth/me -H "Authorization: Bearer $AT"                          # can_write=true

# 8.4 访客口令登录(配置了 VIEWER_PASSWORD 时) -> role=viewer 且不能写
VT=$(curl -s -X POST $BASE/api/auth/viewer-login -H 'Content-Type: application/json' \
  -d '{"password":"你的VIEWER_PASSWORD"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["token"])')
curl -s -o /dev/null -w '访客写接口: %{http_code}\n' -X POST $BASE/api/members \
  -H "Authorization: Bearer $VT" -H 'Content-Type: application/json' -d '{"nickname":"x"}'   # 期望 403

# 8.5 录入预览(不写库)
curl -s -X POST $BASE/api/records/preview -H "Authorization: Bearer $AT" \
  -H 'Content-Type: application/json' -d '{"rule_id":1,"quantity":100,"member_ids":[1]}'

### 8.6 分项榜与转盘
curl -s $BASE/api/ranking/boards -H "Authorization: Bearer $AT"
curl -s "$BASE/api/wheel/status?member_id=1" -H "Authorization: Bearer $AT"

# 8.6 AI 创作工坊 (未配置时 config.enabled=false, 且接口不挂载时返回 404)
curl -s $BASE/api/ai-workshop/config -H "Authorization: Bearer $AT"
curl -s -o /dev/null -w '访客调生图配置: %{http_code}\n' $BASE/api/ai-workshop/config -H "Authorization: Bearer $VT"   # 期望 200
curl -s -o /dev/null -w '无 token: %{http_code}\n' $BASE/api/ai-workshop/config                                        # 期望 401
```

之后用手机浏览器打开 `https://app.jiacheng.cyou`：管理密码为**读写**，访客密码为**只读**。

---

## 9. 每日备份

```bash
# 9.1 建密码文件（mysqldump 用）
sudo tee /root/.coc-points.cnf > /dev/null <<'EOF'
[client]
user=coc_app
password=你的强密码
host=127.0.0.1
EOF
sudo chmod 600 /root/.coc-points.cnf

# 9.2 传 backup.sh 并加定时任务
sudo cp deploy/backup.sh /opt/coc-points/backup.sh
sudo chmod +x /opt/coc-points/backup.sh
sudo crontab -e
# 加一行：  0 3 * * * /opt/coc-points/backup.sh
```

备份存 `/var/backups/coc-points/`，保留 30 天。也可在 App「设置」里随时点「备份JSON」下载全量数据。

---

## 10. 常见问题

- **后端起不来**：`journalctl -u coc-points -n 50` 看日志；多半是 `.env` 密码/库名不对。
- **页面 502**：Node 没启动或端口不对，`systemctl status coc-points`。
- **HTTPS 打不开**：确认安全组已放行 80/443。
- **改了积分规则不生效**：规则在「设置」页保存即时生效，历史流水不变（只影响之后的排行计算口径）。
- **访客点按钮提示无权限**：正常行为——匿名/访客是只读角色，写接口返回 401（匿名）或 403（访客口令）；需要写入请点「管理员登录」用账号登录。
- **管理员登录报「账号或密码错误，或账号不可用」**：账号不存在/密码错/被停用都会返回同一文案（防枚举）；超管可在「管理员管理」里重置密码，或服务器上执行 `npm run user:reset-password -- <用户名>`。
- **登录后提示「首次登录需先修改密码」**：新账号或刚被重置密码的账号必须先改密（服务端强制），改完用新密码重新登录。
- **访客口令登录不进去**：检查服务器 `.env` 是否配置了 `VIEWER_PASSWORD`（为空即关闭该入口），改后需 `systemctl restart coc-points`。注意匿名访客本来就无需登录即可只读浏览。
- **转盘抽中但界面没看到头像框**：外观有 24 小时有效期，到期自动消失；确认 `member_cosmetics` 表中该成员记录的 `expires_at` 是否已过期。
- **想临时强制转盘中奖做演示**：**不要**在 `.env` 里加 `WHEEL_FORCE`（那是 E2E 钩子）——生产演示请多抽几次不同成员。
- **批量导入提示超过 50 人**：50 人是游戏上限，系统只做提醒不硬拦；请先处理离开成员或不导入多余的人。
- **排行榜里看不到某个成员**：默认只统计「在部落」成员（排除"离开"），切换榜单右上角「含离开」即可查看。
- **撤销录入报 409**：该批次所属周已结算；先到「周期结算」撤销结算，再撤销录入。

---

## 附：本机实测部署记录 (2026-09-09, app.jiacheng.cyou → <SERVER_IP>)

> 实际服务器为**宝塔面板环境**: nginx 是 `/www/server/nginx/sbin/nginx`,
> 站点 vhost 在 `/www/server/panel/vhost/nginx/*.conf`, **不是**系统 nginx 的 `/etc/nginx`。
> 改 vhost 后需平滑重载: `kill -HUP $(cat /www/server/nginx/logs/nginx.pid)` (或宝塔面板操作)。

- 后端目录 `/opt/coc-points/server`, systemd 单元 `coc-points` (User=www-data), 已 enable。
- `.env` 由部署脚本生成于服务器 `/opt/coc-points/server/.env` (root:www-data 640),
  内含随机 `DB_PASSWORD / JWT_SECRET / ADMIN_PASSWORD / VIEWER_PASSWORD`
  —— **改密码直接编辑这里后 `systemctl restart coc-points`**（清空 `VIEWER_PASSWORD` 即关闭访客入口）。
- 已应用的增量迁移: `001`(三态注释) → `002`(录入幂等) → `003`(转盘+限时外观); 升级新库结构前先 `bash /opt/coc-points/backup.sh`。
- MySQL: 独立库 `coc_points` + 账号 `coc_app`(仅授权 `coc_points.*`), 与 `typecho_db` 完全隔离。
- 前端静态 `/var/www/coc-points/h5`; vhost 见 `/www/server/panel/vhost/nginx/coc-points.conf` (80→301, 443 SSL)。
- HTTPS: `certbot` webroot 模式签发, 证书 `/etc/letsencrypt/live/app.jiacheng.cyou/` (certbot 已装自动续期任务)。
- 每日备份: `/opt/coc-points/backup.sh`(mysqldump --no-tablespaces) + crontab `0 3 * * *`, 产物 `/var/backups/coc-points/` 保留 30 天。
- **重新部署/更新后端**:
  ```bash
  # 本机打包 server(排除 node_modules/.env) → scp → 远端 /opt/coc-points/server, 然后:
  cd /opt/coc-points/server && npm install --omit=dev && chown -R root:www-data /opt/coc-points && chmod -R g+rX /opt/coc-points
  systemctl restart coc-points
  ```
- **更新前端**: 本机 `cd app && npm run build:h5` → 产物 `dist/build/h5` 覆盖 `/var/www/coc-points/h5/` (保持 www-data 属主) 即可, 无需重载 nginx。

---

## 附：批次 2 变更 (访客只读 + 成员三态)

### 1. 访客（只读）账号

- `.env` 新增 `VIEWER_PASSWORD`（留空 = 关闭访客登录；与 `ADMIN_PASSWORD` 相同会被忽略）。
- 登录接口按密码判定角色，token 内 `role` 为 `admin` / `viewer`（角色只信服务端签发）。
- **所有非 GET 的 `/api/*` 请求要求管理员**（`requireAdmin`），访客调用返回 403；
  `/api/export`、`/api/backup`、`/api/settings`、`/api/budget` 虽是 GET 也仅管理员可用。
- 访客拉取成员列表时不下发内部备注 `note`。
- `GET /api/auth/me` 返回 `{ role, can_write, viewer_enabled }`，前端据此切换只读界面。
- 修改访客密码：编辑 `/opt/coc-points/server/.env` 的 `VIEWER_PASSWORD` 后 `systemctl restart coc-points`。

### 2. 成员状态语义（数值不变）

| 数值 | 含义 |
|---|---|
| 0 | 部落战绿牌 |
| 1 | 部落战红牌（原「请假」） |
| 2 | 离开 |

- 录入候选、仪表盘「部落成员」、结算快照均排除「离开」（红牌正常录入与计分）。
- 已有数据无需迁移；仅列注释变化，执行增量脚本：
  ```bash
  mysql -uroot -p coc_points < /opt/coc-points/server/migrations/001_member_status_semantics.sql
  ```
- 今后结构变更一律放 `server/migrations/NNN_*.sql` 增量执行，**不要在生产库重跑 `schema.sql`**（已建表用 `IF NOT EXISTS`，但仍以增量脚本为准）。

### 3. 回滚方式

- 代码回滚：重新上传上一版 `server/` 与 H5 产物后 `systemctl restart coc-points`。
- 访客权限回滚：清空 `.env` 中 `VIEWER_PASSWORD` 并重启（访客登录立即关闭，管理员不受影响）。
- 迁移 001 只改注释，回滚无数据影响。

---

## 附：批次 3 变更 (录入重构 + 排行榜改版)

### 1. 新增/扩展接口

| 接口 | 说明 |
|---|---|
| `POST /api/records/preview` | 录入预览（**不写库**）：返回逐人 `before / after / delta / capped` 与合计 `total_delta`，`delta` 是**按周上限截断后的真实新增**，不是「数量×分值」 |
| `POST /api/records` | 新增可选 `client_token`：同一批共用一个令牌，配合唯一键实现**幂等**；返回新增 `duplicated` 计数（重复提交只统计不重复记账） |
| `POST /api/records/batches/:token/revoke` | 按批次撤销（管理员）；**已结算周禁止撤销**（返回 409，需先撤销结算） |
| `GET /api/records?client_token=...` | 按批次查询流水（配合「查看本批」） |
| `GET /api/ranking/boards` | 分项榜来源：每个**启用中的积分规则 = 一个分项榜**（榜名即规则名，无需额外配置） |
| `GET /api/ranking?rule_id=&include_left=` | `rule_id` 取分项榜；`include_left=1` 才包含「离开」成员（默认仅统计在部落成员） |

### 2. 迁移 002（录入幂等）

```bash
mysql -uroot -p coc_points < /opt/coc-points/server/migrations/002_record_idempotency.sql
```

- 新增 `score_records.client_token VARCHAR(64) NULL` + 唯一键 `uk_records_client (client_token, rule_id, member_id, week_start)`；
- 历史数据 `client_token` 全为 NULL，**不受唯一约束影响**，无需回填；
- 脚本可重复执行（存在则跳过）。

### 3. 关键设计：撤销为什么不需要"重算封顶"

积分不落库：`lib/calc.js` 每次查询都按「(成员 × 规则 × 周) 聚合 → 截断周上限 → 跨周累加」实时计算。
因此撤销删除记录后，周榜/月榜/赛季榜与预览值**自动回到正确口径**，不需要任何增量重算或补偿逻辑。
唯一的保护是：**已生成结算快照（weekly_results）的周不允许普通撤销**，避免改动已发放奖励的依据。

### 4. 前端变化

- 录入页：规则快捷值随规则变化、成员搜索/三态筛选/全选当前/反选、**切换规则保留并记忆选择**、实时显示"本次实际新增"与截断提醒、保存后结果卡支持「查看本批 / 撤销本批」；提交带 `client_token` 防双击与弱网重试。
- 排行榜：去掉赛季入口（赛季结算与预算仍保留）；新增**综合榜 + 规则分项榜**；前三名金/银/铜**头像框**与称号（综合榜：部落之光 / 荣耀先锋 / 精锐战将；分项榜第一名如捐兵→援军之星、部落战→三星战神、联赛→联赛王牌、竞赛→竞赛达人、突袭→突袭先锋）；可切换「在部落 / 含离开」。
- 首页"本周前三"同步头像框与称号。装饰仅为展示，**不影响名次与奖金**。

### 5. 回滚方式

- 代码回滚：重新上传上一版 `server/` 与 H5 产物后 `systemctl restart coc-points`。
- 迁移 002 回滚（如需）：
  ```sql
  ALTER TABLE score_records DROP INDEX uk_records_client, DROP COLUMN client_token;
  ```
  回滚后旧版代码仍可正常运行（旧版 SQL 不含该列）。

---

## 附：批次 4 变更 (批量导入 + 幸运转盘)

### 1. 成员批量导入

| 接口 | 说明 |
|---|---|
| `POST /api/members/batch/preview` | 解析 + 与库内比对（**不写库**）：返回 `add / restore / exists / conflict` 分类、错误行、导入后在部落人数 |
| `POST /api/members/batch` | 执行导入：新增 + 恢复离开成员；返回 `added / restored / skipped_exists / conflict / invalid / failed` |

- 粘贴格式：每行 `昵称` 或 `昵称,标签,备注`（逗号/中文逗号/制表符均可，支持 Excel 直接粘贴）；也接受 `members` 数组。
- 去重顺序：**标签优先**（规范化大写、自动补 `#`）→ 再按昵称；离开成员判定为**恢复**（改回在部落，不新建身份）。
- 同名但标签不同：默认跳过并在预览中标为"待确认"，前端可勾选"同名视为新成员"。
- 50 人为**软提醒**（`warning` 字段，不硬拦），避免历史超标时无法维护。
- 前端入口：成员页 → 「⇪ 批量导入」→ `pages/member-import/member-import`。

### 2. 幸运转盘（双模式）

| 接口 | 说明 |
|---|---|
| `GET /api/wheel/status?member_id=` | 该成员今日是否已抽、当前生效外观、奖励池、中奖率（管理员代抽前查看） |
| `POST /api/wheel/spin` | **管理员代抽**：服务端按 45% 判定 → 中奖则按权重选奖励 → 写 `wheel_spins` + `member_cosmetics`（同一事务）；同一成员**每天一次**，重复请求返回当天原结果 |
| `GET /api/wheel/cosmetics` | 当前所有未过期外观（成员列表 / 排行榜展示用，任何登录角色可读） |

- **每日首次打开提醒**：首页 `onShow` 且为管理员时弹一次可关闭提示（本地按日期记一次），首页另有常驻「🎡 部落转盘」入口。
- 娱乐模式「随机抽人」：选范围（在部落 / 绿牌 / 红牌）→ 随机高亮一名成员，**纯前端、不写库、不发奖**，访客也能用。
- 奖励池（权重）：烈焰头像框 20 / 星光头像框 18 / 翡翠头像框 18 / 金色昵称 16 / 紫色昵称 14 / 今日幸运星称号 14（合计 100）。
- 有效期 24 小时；同一成员当天不会重复领到"仍在生效的同款外观"；到期后前端不再展示（服务端按 `expires_at > NOW()` 过滤）。
- 测试钩子：`WHEEL_FORCE=win|lose`、`WHEEL_FORCE_REWARD=<key>` **仅用于 E2E**，生产 `.env` 不得设置（部署脚本会检查）。

### 3. 迁移 003

```bash
mysql -uroot -p coc_points < /opt/coc-points/server/migrations/003_wheel.sql
```

- 新建 `wheel_spins`（唯一键 `member_id + draw_date` 保证每天一次、幂等）与 `member_cosmetics`（唯一键 `member_id + kind`，含 `expires_at`）；
- 两表均以 `ON DELETE CASCADE` 关联 `members`，删除成员时自动清理；
- 备份脚本覆盖全库，两个新表天然包含在每日备份中。

### 4. 回滚方式

- 代码回滚：重新上传上一版 `server/` 与 H5 产物后 `systemctl restart coc-points`。
- 迁移 003 回滚（如需）：
  ```sql
  DROP TABLE IF EXISTS member_cosmetics;
  DROP TABLE IF EXISTS wheel_spins;
  ```
  回滚后旧版代码不使用这两张表，可正常运行。

---

## 附：录入页适配 (外部优化版, 2026-09-10)

`app/src/pages/entry/entry.vue` 换成了外部优化版（请求竞态防护、预览指纹校验、待确认批次重试、底部吸底操作栏），并按本项目后端做了适配。

### 1. 后端契约变化（已上线，无表结构变更）

| 接口 | 变化 |
|---|---|
| `POST /api/records` | 新增返回 **`total_delta`**：服务端在事务内按「提交前后封顶后的周积分差值」计算，**不采用客户端预览值**；整批写入改为**单事务**（任一步失败整批回滚） |
| `POST /api/records` | 同一 `client_token` 若换了内容（出现新的 规则×成员 组合）→ **409**，避免"撤销本批"误删其它记录 |
| `POST /api/records` / `/preview` | 新增校验：**成员已离开（status=2）不写入**，同批其它成员正常录入并在 `errors` 中返回原因 |
| `POST /api/records/preview` | 同上：离开成员计入 `errors`，不再计入 `members` |

> 权限校验（非 GET 一律要求管理员）沿用既有 `requireAdmin`；撤销仍保护已结算周（409）。
> 积分不落库，撤销后各周期口径自动正确，无需重算 —— 前端提示里的"重新计算相关积分"由实时聚合天然满足。

### 2. 前端适配点

1. 增加**兜底状态卡**：请求被取消或状态异常时不再白屏（原版条件链存在该空隙）。
2. **兼容旧记忆键**：优先读 `coc_last_success_members_<ruleId>`，为空时回退旧版页面的 `coc_last_members_<ruleId>`，避免升级后"上次选择"丢失。
3. 文件头补充**后端契约注释**，便于后续维护对照。

### 3. 待真机确认

- 底部吸底操作栏（`position: sticky`）与 uni-app 原生 tabBar 的间距、iPhone 安全区（`env(safe-area-inset-bottom)`）；
- 成员多选预览、快速切换数量、弱网重复保存（应提示"重试原批次"）、撤销已结算批次（应 409）。

### 4. 回滚

- 前端：重新上传上一版 `dist/build/h5`（本地 `.e2e-logs/h5-batch4.tgz` 即适配前的产物）覆盖 `/var/www/coc-points/h5/`。
- 后端：重新上传上一版 `server/`（`.e2e-logs/server-batch4.tgz`）后 `systemctl restart coc-points`。
- 本次无迁移，数据库无需回滚；备份见 `/var/backups/coc-points/`。

---

## 附：录入页紧凑布局（第二轮修订, 2026-09-10）

第一版（44KB 优化版）在手机上仍需来回滚动，于是做了**增量补丁**（不改后端、不整页重写）：

### 1. 结构变化

```
改前: 周期大标题 → 规则大卡片(6 张) → 成员大卡片(常驻) → 数量卡片 → 备注卡片 → 吸底操作栏
改后: 待确认批次提示(有异常时) → 紧凑录入面板 → 成员编辑区(按需展开) → 上次保存结果
```

**紧凑录入面板**（一张卡片内完成高频操作）：规则两行三列按钮 → 当前规则分值/上限 → 每人数量 + 快捷值 → 成员摘要（"已选 N 人 / 修改成员 ›" + 前 3 个名字）→ 紧凑预览（预计实际新增 / 加备注可折叠）→ 确认录入按钮。

- 删除了「周期大标题」「③ 数量卡片」「备注卡片」「吸底操作栏」（避免手机键盘与 tabBar 遮挡）。
- 成员列表改为 **`v-show="membersPanelOpen"` 按需展开**，成员项直接渲染 `displayMembers`（不再"先显示 12 人再展开"），并加了「完成选择」按钮回到面板。
- **切换积分项会清空数量**（避免"捐兵 500"被带进"星数"类规则）。

### 2. 兼容与遗留

- 预览、幂等重试（`pendingSubmission` + 原 token）、撤销本批、服务端 `total_delta` 等逻辑全部保留。
- 上一轮的三处适配（兜底状态卡、旧记忆键兼容、后端契约注释）继续有效。
- `visibleMembers / membersExpanded / memberPageSize` 及 `.rule-item / .quantity-box / .submit-bar` 等旧样式按补丁要求**暂时保留**（未再被引用，确认无误后可清理）。

### 3. 待真机确认（补丁作者也点名）

- 数字键盘弹出时输入框是否被遮挡（已加 `:adjust-position="true"` 与 `:cursor-spacing="24"`）；
- 「完成选择」后的滚动定位（`uni.pageScrollTo`）在你手机浏览器/微信内的表现；
- 320～430px 宽度下规则按钮换行（已加 `@media (max-width: 350px)` 两列降级）；
- 面板底部按钮与原生 tabBar 的间距与 iPhone 安全区。

### 4. 回滚补充

- 本轮到"紧凑布局"的回滚产物：`.e2e-logs/h5-entry-adapt.tgz`（第一版 44KB 优化版）。
- 再往前一版（批次 4 原始录入页）：`.e2e-logs/h5-batch4.tgz`。

---

## 附：批次 5 变更 (AI 创作工坊 · 生图)

### 1. 功能与权限

- 首页新增常驻入口「🎨 部落创作工坊」→ 非 tabBar 页面 `pages/workshop/workshop`。
- 三个标签页：**创作** / **本机图库** / **部落图库**。
- 两种创作模式：**通用创作**（自由提示词 + 部落模板）与**东方幻境 · 仙侠人像**
  （结构化五段提示词模板，不需要额外的文本模型，输出格式固定）。
- 权限：**管理员与非管理员都可以生成**，额度不同（管理员默认不限次数，非管理员默认每天 10 次）。
  访客可随时浏览/下载部落图库。
  > ⚠️ 挂载顺序有讲究：工坊路由必须排在全局「非 GET 需管理员」规则**之前**
  > （见 `src/app.js`）。否则非管理员的 POST 会被提前拦成 403，个人额度形同虚设。
  > 注销/改密等敏感写操作不受影响，仍受全局规则约束。
- 本机图库存在浏览器 IndexedDB，**只属于当前浏览器**；主动「上传部落」后才进服务器图库。
- 配额：服务器图库 200 张 / 单 IP 10 张 / 单身份 10 张；未上传的临时生成图 30 分钟过期。
  - ⚠️ 「单身份 10 张」只约束**同时存在**多少张。删除会立刻释放名额，
    所以只靠这一条可以"删一张传一张"无限循环 —— 因此给非管理员另加了**每日上传张数**
    （`AI_VIEWER_UPLOAD_DAILY_LIMIT`，默认 10），管理员不受该日限。

### 2. 接口

| 接口 | 说明 |
|---|---|
| `GET /api/ai-workshop/config` | 配置 + 配额 + 每日已用（访客可读，用于只读界面） |
| `POST /api/ai-workshop/jobs` | 入队生成；`client_token` 幂等（同编号同内容返回已有任务 200，同编号换内容 409）；可带 `image_size` |
| `GET /api/ai-workshop/jobs/:id` | 查任务状态（queued / running / succeeded / failed / expired / unknown） |
| `GET /api/ai-workshop/jobs/:id/image` | 取临时生成图（上传前唯一来源，需登录且仅限本人身份） |
| `GET /api/ai-workshop/gallery` | 图库列表（分页 12 张） |
| `GET /api/ai-workshop/gallery/:id/image` | 图库图片；`?thumb=1` 取缩略图 |
| `POST /api/ai-workshop/gallery` | 主动上传（multipart，≤8MB，`client_token` 幂等） |
| `DELETE /api/ai-workshop/gallery/:id` | 删除并释放配额（管理员可删任意，其他身份只能删自己的） |

### 3. 迁移 004 + 依赖

```bash
mysql -uroot -p coc_points < /opt/coc-points/server/migrations/004_ai_workshop.sql
cd /opt/coc-points/server
npm install --omit=dev multer@2.3.0 sharp@0.35.4 \
  --registry=https://registry.npmmirror.com --no-audit --no-fund
```

- 新增 `ai_workshop_guard`（单行锁，串行化配额检查）/ `ai_image_jobs`（生成任务）/ `ai_gallery_images`（服务器图库）。
- ⚠️ **必须带 `--registry=https://registry.npmmirror.com`**：该 ECS 访问
  `registry.npmjs.org` 超时（连接挂起、`HTTP 000`），直连官方源会卡死在拉 manifest 阶段；
  `registry.npmmirror.com` 实测 0.16s 响应。
- ⚠️ **`sharp@0.35.x` 要求 Node ≥20.9.0**（官方 engines）。服务器原本是 apt 装的 Node 18.19.1，
  在该版本下虽然能装上，但引擎检查会报警且不保证可用——已改为 Node 20.19.0（见 0.2 / 本批次 9）。
  若坚持留在 Node 18，需降到 `sharp@0.34.5`（engines: `^18.17.0 || ^20.3.0 || >=21.0.0`）。

### 4. 环境变量与存储目录

```bash
sudo mkdir -p /opt/coc-points/ai-storage
# 后端以 www-data 身份运行(systemd User=www-data), 目录必须让它可写
sudo chown -R www-data:www-data /opt/coc-points/ai-storage
sudo chmod 750 /opt/coc-points/ai-storage
```

> ⚠️ 归属必须是 **www-data**。若按 `root:www-data` 建目录，启动日志会出现
> `[ai-workshop] 未启用: EACCES: permission denied, mkdir '.../gallery'`
> ——此时生图接口**不会挂载**（请求返回 404），但其它功能正常。

在 `/opt/coc-points/server/.env` 里至少填：

```ini
SILICONFLOW_API_KEY=sk-xxx
AI_IDENTITY_SECRET=<openssl rand -hex 32>
AI_STORAGE_DIR=/opt/coc-points/ai-storage
AI_IMAGE_DOWNLOAD_HOSTS=s3.siliconflow.cn
```

- **`AI_STORAGE_DIR` 必须在 Nginx 静态根目录（`/var/www/coc-points/h5`）之外**：图片只能经鉴权接口读取。
- `AI_IMAGE_DOWNLOAD_HOSTS` **实测值就是 `s3.siliconflow.cn`**（2026-09-10 用真实账号验证，
  生成结果返回 `https://s3.siliconflow.cn/temporary/...`）。不要填 `*`；换模型/换供应商时
  再看日志里的 `[ai-workshop] blocked image host: <域名>` 或任务错误信息（错误会直接点名这个变量名）。
- 只填 `SILICONFLOW_API_KEY` 而不填 `AI_IDENTITY_SECRET` 时，生图接口**不会挂载**（启动日志有告警），
  其余接口正常——这是刻意的降级行为。
- 未配置生图时，首页入口仍会显示，但页面会提示"生图服务尚未配置"。

### 5. Nginx

`client_max_body_size 9m;` 已加在 `location /api/`（上传 8MB 图片需要），并加了
`location ^~ /ai-storage/ { deny all; return 404; }` 作为图片目录的兜底保护。

### 6. 备份（重要）

`backup.sh` 只 dump 数据库，**不含图片文件**。需要把图片目录一起备份，例如在
`backup.sh` 末尾追加：

```bash
tar -czf /var/backups/coc-points/ai-images-$(date +%F).tgz -C /opt/coc-points/ai-storage .
find /var/backups/coc-points -name 'ai-images-*.tgz' -mtime +30 -delete
```

注意：图片丢失不会导致数据库报错，只会让图库里的条目取图 404（有维护任务会清理孤儿文件）。

### 7. 上线前必测（本机已自动化，服务器需真机复测）

```bash
cd /opt/coc-points/server && npm run test:ai   # 本机自动化: 76 项断言, 含真实 MySQL + sharp
```

生产账号还需要人工确认（自动化用 mock 供应商，无法替代）：

1. 当前账号能调用 `AI_IMAGE_MODEL`，且 `AI_IMAGE_SIZE` 是该模型的推荐值；
2. 响应里的图片域名是否与 `AI_IMAGE_DOWNLOAD_HOSTS` 一致（否则任务会 failed，错误信息会点名该变量）；
3. 生成图是否确实无水印（平台默认打「AI 生成」水印，本模块发送 `X-Enable-Watermark: 0`）；
4. 手机浏览器：轮询恢复任务、IndexedDB 保存、下载、微信内置浏览器长按保存降级提示。

> 自动化覆盖：权限（无 token 401 / 访客 403）、参数校验、幂等、worker 出图、
> 竖图尺寸真的产出竖图、图片魔数与 webp 规范化、图库上传/删除/配额释放、
> 非图片拒绝、不可信域名与上游 5xx 的失败信息、身份隔离、过期清理、每日额度上限。

### 8. 回滚方式

- 代码回滚：重新上传上一版 `server/` 与 H5 产物后 `systemctl restart coc-points`。
- 迁移 004 回滚（如需）：
  ```sql
  DROP TABLE IF EXISTS ai_gallery_images;
  DROP TABLE IF EXISTS ai_image_jobs;
  DROP TABLE IF EXISTS ai_workshop_guard;
  ```
  回滚后旧版代码不使用这三张表，可正常运行；磁盘上的图片目录可自行保留或删除。
- 只想**临时关闭**生图：清空 `.env` 里的 `AI_IDENTITY_SECRET` 并重启（接口不挂载，页面提示未配置），
  数据库与图片都不受影响。
- Node 20 回滚：把 `/etc/systemd/system/coc-points.service` 的 `ExecStart` 改回 `/usr/bin/node`
  后 `systemctl daemon-reload && systemctl restart coc-points`（apt 的 Node 18 未被删除）。
  注意回滚 Node 后 `sharp@0.35.4` 会重新出现引擎告警，需同时把 sharp 降到 `0.34.5`。

### 9. 本机实测部署记录 (2026-09-10, app.jiacheng.cyou → <SERVER_IP>)

按上述步骤在同一天实际部署并跑通，踩到的坑已写进各小节，这里汇总时间线：

| 步骤 | 结果 |
|---|---|
| 备份 | `/var/backups/coc-points/server-before-ai-*.tgz`、`db-before-ai-*.sql.gz`，`.env.bak.*` |
| 上传后端 | `app.js` / `server.js` / `config.js` / `src/modules/ai-workshop.js` / `package.json` / 迁移 + 脚本（md5 双向核对一致） |
| npm 依赖 | 直连官方源超时 → 改 `registry.npmmirror.com`，装 multer 2.3.0 + sharp 0.35.4 |
| Node 升级 | apt 仅 18.19.1 且 NodeSource/nodejs.org 均不可达 → 从 npmmirror 取 v20.19.0（SHA256 校验通过），装到 `/opt/node-v20.19.0-linux-x64`，systemd `ExecStart` 指向绝对路径 |
| 迁移 004 | 三张表创建成功（`ai_workshop_guard` / `ai_image_jobs` / `ai_gallery_images`） |
| 存储目录 | 首次 `root:www-data` 导致 `EACCES` → 改 `www-data:www-data 750` 后模块就绪 |
| nginx | 备份 vhost → 插入 `client_max_body_size 9m;` 与 `location ^~ /ai-storage/` → `nginx -t` 通过 → `kill -HUP` 平滑重载 |
| 公网联调 | 登录 → 提交任务 → 轮询 3 次 → `succeeded` → 取图 `image/webp` 1024x1024（118KB）→ 上传图库 → 缩略图 → 删除释放 |
| 权限校验 | 匿名 `/api/ai-workshop/config` → 401；`/ai-storage/` 直连 → 404 |

联调产生的任务记录与临时图片已清理（图库留一条 `deleted` 墓碑，这是配额幂等的正常设计）。

> **仍建议人工核对**：生成图是否真的没有「AI 生成」水印（代码发送了 `X-Enable-Watermark: 0`，
> 但水印是平台侧行为，需肉眼看图确认）；以及手机浏览器上的轮询恢复与 IndexedDB 保存。

### 10. ⚠️ 每次重部署必踩的两个坑（已实测两次）

**坑 1：`chown -R` 会把图片目录的写权限收走**

标准部署流程里有 `chown -R root:www-data /opt/coc-points && chmod -R g+rX /opt/coc-points`，
它会连同 `ai-storage` 一起改成 `root:www-data`（且 `g+rX` 不给写权限）。
后端以 `www-data` 运行，于是：**生成任务能提交、但 worker 写文件时报 EACCES，任务变 failed**。

现象：任务状态 `failed`，错误信息形如
`EACCES: permission denied, open '/opt/coc-points/ai-storage/temporary/xxx.webp.part'`。

所以**每次 `chown -R` 之后必须补一条**：

```bash
chown -R www-data:www-data /opt/coc-points/ai-storage
chmod 750 /opt/coc-points/ai-storage
chmod 700 /opt/coc-points/ai-storage/gallery /opt/coc-points/ai-storage/temporary
```

验证：`sudo -u www-data sh -c 'echo x > /opt/coc-points/ai-storage/temporary/.probe && rm -f /opt/coc-points/ai-storage/temporary/.probe'`

**坑 2：工坊路由必须排在全局「非 GET 需管理员」之前**

`src/app.js` 里有一条全局规则：`/api` 下所有非 GET 请求都要求管理员（供访客只读模式使用）。
AI 工坊允许非管理员生成，因此它的 `app.use` **必须写在那条规则之前**，
否则非管理员的 `POST /jobs` 会在进入模块前就被拦成 403（个人额度完全失效，表现为"访客点生成没反应/提示无权限"）。

线上已验证：访客提交 → 排队 → 生成成功 → 取图 `image/webp 1024x1024`，配额计数变成 `1/10`。

---

### 11. 密钥轮换提醒

生图密钥通过聊天/终端传递过，建议在硅基流动控制台**重置 API Key**，然后更新服务器：

```bash
sudo sed -i 's|^SILICONFLOW_API_KEY=.*|SILICONFLOW_API_KEY=新的key|' /opt/coc-points/server/.env
sudo systemctl restart coc-points
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/ai-workshop/config   # 期望 401
```

---

### 12. 额度调整记录 (2026-09-10 第二轮)

按需求改为**按角色分档**：

| 角色 | 每日生成 | 每日上传 | 说明 |
|---|---|---|---|
| 管理员 | 不限（`AI_DAILY_LIMIT=0`） | 不限 | 仅受全站兜底约束 |
| 非管理员(访客) | 10 次（`AI_VIEWER_DAILY_LIMIT=10`） | 10 张（`AI_VIEWER_UPLOAD_DAILY_LIMIT=10`） | 各自独立计数 |
| 全站合计 | 2000 次（`AI_GLOBAL_DAILY_LIMIT=2000`） | — | 对所有角色生效的防刷底线 |

临时图上限保持 20 张不变。

> 为什么给非管理员单独加"每日上传张数"：「单身份 10 张」只限制**同时存在**多少张，
> 删一张就能再传一张，可以无限循环；加一层日限才能真挡住。

改动涉及代码（不只是配置）：`src/app.js`（挂载顺序）、`src/modules/ai-workshop.js`（额度分档 + 上传日限）。
本机自动化 101 项断言全过（含"访客 3 次后第 4 次 429""管理员不受影响""全站兜底对管理员也生效"）。

---

## 附：设置页优化（外部优化版, 2026-09-10）

### 1. 结构变化（纯前端）

单页长表单 → **身份卡 + 三面板**：

| 面板 | 内容 |
|---|---|
| 奖励预算 | 三项金额（周 / 四周月 / 赛季）+ 固定周期说明 + 草稿估算（整数"分"，12 周赛季）+ 保存二次确认 + 服务器预算与已发放 |
| 积分规则 | 搜索、＋新增（独立编辑面板，**先编辑后创建**）、规则卡片（受控启停按钮 + 编辑） |
| 数据管理 | 导出周排行 / 周流水 CSV、下载 JSON 备份；危险区「恢复备份」（勾选 + 输入确认词 + 最终确认） |

接口未变：`GET/PUT /api/settings`、`GET /api/budget`、`GET/POST/PUT /api/rules`、`GET /api/export`、`GET /api/backup`、`POST /api/restore`。
**无表结构变更、无迁移，后端代码未改**（只重传 H5）。

### 2. 前端适配点（相对设计稿）

| 设计稿写法 | 本项目落地 |
|---|---|
| 规则字段最多四位小数 | 改为**最多两位小数 + 整数最多 8 位**，与 `score_rules.score_per_unit / weekly_cap` 的 `DECIMAL(10,2)` 一致，避免 MySQL 静默四舍五入 |
| 固定周一 + `cycleConflict` 暂停保存 | 保留；生产 `week_start_day='1'`（已核对），非 `'1'` 时禁用保存并提示，不改动历史周期 |
| `PUT /api/settings` | 只提交 `week_start_day` + 三项金额（后端白名单 `EDITABLE_KEYS`，其它字段 400） |
| `POST /api/rules` | 与后端一致：`name/unit/score_per_unit/weekly_cap/enabled`，同名 409 |
| 规则启停 | 提交布尔值，后端存 0/1；**服务端成功后才改本地状态** |
| 恢复备份 | 提交整份备份 JSON（`/api/backup` 产物含 `tables`），成功后清本地登录并 `reLaunch` 登录页 |

### 3. 已修复的原实现问题

`canWrite` 默认 `true` 会短暂闪现管理员界面；`!!r.enabled` 把字符串 `"0"` 当启用；启停失败但界面已变化；
「新增」一点击就写库（现网因此残留一条 `新积分项`）；空分值被转成 0；金额浮点估算误差；
保存设置后全量 `load()` 覆盖其它未保存草稿；恢复备份无防重复提交与危险确认。

### 4. 后端遗留事项（本次未做，前端无法替代）

1. **规则历史保护**：计分用 `score_rules` 的**现值**实时计算，改分值会改变未结算周的历史得分。要锁死需要规则版本表 / 生效周 / 已结算周冻结。
2. **`POST /rules` 幂等**：页面能防双击，但"服务端已创建、响应丢失"后重试仍可能重复；可加 `client_token` 或失败后先查再建。
3. **恢复的事务与令牌失效**：`POST /restore` 只清当前浏览器登录，不吊销其它已签发 token，也不阻止恢复期间其它管理员写入。
4. **备份体积**：页面按 JSON 对象接收并限制 50 万字符；当前生产备份约几十 KB，够用。

### 5. 上线步骤（本次实际执行）

```bash
# 本机
cd app && npm run build:h5
tar -czf .e2e-logs/h5-settings.tgz -C app/dist/build/h5 .
scp .e2e-logs/h5-settings.tgz .tool/deploy-settings-h5.sh .tool/smoke-settings.sh root@<SERVER_IP>:/tmp/
# 服务器
bash /tmp/deploy-settings-h5.sh /tmp/h5-settings.tgz   # 备份现网 → 覆盖 → 校验新/旧标记与可访问性
bash /tmp/smoke-settings.sh                            # 生产冒烟(可逆): 原值回写 / 冒烟规则建后即删
```

本次生产冒烟结果：设置四项**原值回写一致**、规则 `id=6` 原值回写一致、新建→编辑→停用/启用→删除**无残留**、
访客 `PUT /api/settings` 与 `GET /api/settings` 均 **403**、流水/转盘/外观/成员数不变（2 / 6 / 2 / 6）。

### 6. 待真机确认

- 三面板切换与「未保存 / 编辑中」小圆点；金额保存二次确认里的赛季合计金额是否正确。
- 规则编辑面板：键盘弹出是否遮挡输入框、搜索框输入法体验。
- 「恢复备份」的勾选框 + 确认词输入在手机上的可操作性。
- 面板底部与原生 tabBar 的间距 / 安全区（`env(safe-area-inset-bottom)`）。

### 7. 回滚

- 前端：解包覆盖 `/var/www/coc-points/h5/`（上一版 = `.e2e-logs/h5-entry-compact.tgz`，即紧凑布局录入页 + 旧设置页）。
- 服务器侧备份：`/var/backups/coc-points/h5-before-settings-<时间戳>.tgz`。
- 旧设置页源码：`.e2e-logs/settings-page-before.vue`（419 行原版）。
- 无后端改动、无迁移，回滚**不需要**重启 `coc-points`。

---

## 附：批量导入页优化（重新设计版, 2026-09-10）

### 1. 结构变化（纯前端）

单页 textarea + 纯文本预览 → **三步流程**：

| 步骤 | 内容 |
|---|---|
| ① 粘贴名单 | 可折叠格式说明（昵称 / 昵称,#标签 / 昵称,#标签,备注 / Excel 粘贴）+ 字符数与行数统计 + 同名选项 |
| ② 预览解析 | 五类统计卡片（新增 / 恢复 / 已存在 / 同名冲突 / 错误·重复）+ `导入后部落人数 X / 50` + 成员卡片列表（新成员默认 10 人，可展开全部）+ 错误行 |
| ③ 确认导入 | 摘要（新增 / 恢复 / 导入后人数）+ 操作按钮 |

接口未变：`POST /api/members/batch/preview`、`POST /api/members/batch`。**无表结构变更、无迁移，后端代码未改**（只重传 H5）。

### 2. 前端适配点（相对设计稿）

| 设计稿写法 | 本项目落地 |
|---|---|
| `#{{ member.tag }}` | 服务端 `normalizeTag()` 已补 `#` 并大写 → 改为 `tagText(member)` 只做兜底，避免出现 `##ABC123` |
| `member.remark` | 后端字段名是 **`note`** → 改为 `member.note` |
| `第{{ getErrorLine(index) }}行：{{ error }}` + `preview.error_lines` | 后端错误文案本身即 `第 N 行: 原因`，且不返回 `error_lines` → **原样展示 `error`**，删除 `getErrorLine`（否则会渲染成"第1行：第 5 行: …"） |
| 超出 50 人**阻止导入** | 改为**软提醒 + 二次确认**：仍可导入（与后端 `warning` 口径一致；历史数据可能已超 50，硬拦会让页面不可用） |
| `uni.navigateBack()` | 增加兜底：无上一页时用 `navTo('/pages/members/members')`（tabBar 页必须 `switchTab`） |
| 导入结果提示 | 补上「跳过 N」（`skipped_exists + conflict + invalid`） |

### 3. 上线步骤（本次实际执行）

```bash
# 本机
cd app && npm run build:h5
tar -czf .e2e-logs/h5-member-import.tgz -C app/dist/build/h5 .
scp .e2e-logs/h5-member-import.tgz .tool/deploy-member-import-h5.sh .tool/smoke-member-import.sh root@<SERVER_IP>:/tmp/
# 服务器
bash /tmp/deploy-member-import-h5.sh /tmp/h5-member-import.tgz   # 备份现网 → 覆盖 → 校验新/旧标记与可访问性
bash /tmp/smoke-member-import.sh                                 # 生产冒烟(可逆): 预览只读 → 真导入 → 重复提交 → 清理 → 清单比对
```

本次生产冒烟结果：预览**未写库**（成员数不变）、字段契约 `tag=#SMOKEIMP1 / note=冒烟备注 / errors[0]=第 3 行: 粘贴内容内重复`、
真导入 `added=2`、**重复提交 `added=0 / skipped_exists=2`**、新成员进入录入候选、
访客两个接口均 **403**、清理后成员清单与冒烟前**完全一致**（6 人，id/昵称/状态/标签），流水/转盘/外观仍为 2 / 6 / 2。

### 4. 待真机确认

- 三步指示器在窄屏（320–430px）是否换行错位；成员卡片网格在窄屏是否单列。
- 格式说明折叠、`展开全部 N 人`、键盘弹出时 textarea/输入统计的可见性。
- 从成员页进入 → 导入成功自动返回后，成员列表是否已刷新（依赖成员页 `onShow`）。
- 预览列表很长（50 人）时的滚动性能。

### 5. 回滚

- 前端：解包覆盖 `/var/www/coc-points/h5/`（上一版 = `.e2e-logs/h5-settings.tgz`）。
- 服务器侧备份：`/var/backups/coc-points/h5-before-member-import-<时间戳>.tgz`。
- 旧导入页源码：`.e2e-logs/member-import-page-before.vue`（254 行原版）。
- 无后端改动、无迁移，回滚**不需要**重启 `coc-points`。

### 6. 复用的工具脚本

`npm` 构建产物组装与静态自检（本机）：

```bash
# 从设计稿文本精确抽取 <template>/<script>/<style> 组装成 .vue(避免手抄差异)
node .tool/assemble-sfc.mjs --spec .tool/spec-member-import.json
node .tool/sfc-check.mjs app/src/pages/member-import/member-import.vue      # 解析 + 模板/脚本/样式编译
node .tool/vue-ctx-check.mjs app/src/pages/member-import/member-import.vue  # 模板引用标识符是否都有定义
node .tool/md-check.mjs README.md deploy/DEPLOY.md                          # markdown 围栏配平
```

---

## 附：成员管理页优化（重新设计版, 2026-09-10）

### 1. 结构变化（前端 3 个文件 + 后端 + 迁移 005）

| 文件 | 说明 |
|---|---|
| `app/src/components/MemberWarStatus.vue` **新增** | 统一状态组件：CSS 绘制绿/红旗帜 + 离开灰点；红牌显示「已挂红牌 N 天」/「红牌时间待补录」；超过 15 天有橙红提醒条；新增 `iconOnly` 属性（编辑页状态按钮只显示旗帜） |
| `app/src/pages/members/members.vue` | 重写：概览指标（在部落/绿牌/红牌）+ 长期红牌横幅 + 搜索 + 6 个筛选（在部落/绿牌/红牌/超过15天/离开/全部）+ **批量管理模式**（全选当前/反选/批量设绿/设红/设离开/批量追加备注/批量归档）+ 未确认批次重试卡 + 卡片列表（旗帜 + 天数 + 备注） |
| `app/src/pages/member-edit/member-edit.vue` | 重写：资料表单 + 旗帜式状态选择 + 红牌计时说明 + **红牌开始日期补录面板** + 「移除并归档此成员」（不再是物理删除） |
| `server/src/lib/member-status.js` **新增** | 统一业务规则：`nextRedSince` / `redDaysOf` / `blocksTribeLimit` / `appendNote` / `TRIBE_LIMIT=50` / `businessDate` |
| `server/src/routes/members.routes.js` | 列表返回 `red_since/red_days/deleted_at` 且默认排除归档；新增 `POST /batch-action`、`PUT /:id/red-since`；`DELETE /:id` 改为归档（`?purge=1` 才物理删除）；新增/编辑/导入恢复统一走红牌计时规则 |
| `server/migrations/005_member_red_archive.sql` **新增** | `members.red_since`、`members.deleted_at` + `member_status_logs`（审计）+ `member_batch_tokens`（批量幂等） |

### 2. 业务规则（已实现）

- **红牌计时**：绿→红记 `red_since`=业务日期；红→红**不重置**；红→绿/离开结束计时；再挂红牌重新计时；**天数由服务端算**，当天=0，历史未知=`null`（显示"待补录"，绝不编造 0 天）。
- **超期**：`red_days > 15` 才算超期（第 16 天开始提醒）。
- **补录**：`PUT /api/members/:id/red-since`，仅"当前红牌"可补，禁止未来日期，写审计日志；普通保存**不会**碰 `red_since`。
- **批量操作**：`update`（改状态 / 追加备注）、`archive`；**整批成功或整批失败**（事务）；ID 去重、单批 ≤200；同 `client_token` 同内容返回原结果（`duplicated:true`），不同内容 **409**；追加备注按原备注 `| ` 拼接，先校验 255 字再整批写入。
- **归档 = 软删除**：`deleted_at` 置位 + `status=2` + 结束红牌计时；**不删除积分/结算/发奖记录**；默认列表、录入候选、排行榜都不再出现，`?include_archived=1` 可查，重新激活（批量转绿/红）会清空 `deleted_at`。
- **50 人上限**：把成员转回绿牌/红牌时，若在部落人数**将超过** 50 则整批/单人拒绝（409）；恰好 49→50 允许；已在 50 人以上的历史部落不会被"锁死"（只有"确实增加且越界"才拒绝，与批量导入的软提醒口径一致）。

### 3. 前端适配点（相对设计稿）

| 设计稿写法 | 本项目落地 |
|---|---|
| 状态组件 `compact` 下红牌仍显示"已挂红牌 0 天" | 按设计稿「小调整」新增 **`iconOnly`**，编辑页状态选择按钮只显示旗帜 |
| 编辑页无补录入口 | 增加**红牌开始日期补录面板**（当前红牌且时间未知时出现），调用 `PUT /:id/red-since` |
| 成员页未含批量导入入口 | 保留「⇪ 批量导入」按钮（`navTo('/pages/member-import/member-import')`），避免功能入口丢失 |
| 设计稿未定义删除语义 | `DELETE /api/members/:id` 改为**归档**；物理删除仅保留 `?purge=1`（管理员，用于清理误建成员） |

### 4. 上线步骤（本次实际执行）

```bash
# 本机
cd app && npm run build:h5
tar -czf .e2e-logs/h5-member-mgmt.tgz -C app/dist/build/h5 .
tar -czf .e2e-logs/server-member-mgmt.tgz -C server --exclude=node_modules --exclude=.env .
scp .e2e-logs/server-member-mgmt.tgz .e2e-logs/h5-member-mgmt.tgz \
    .tool/deploy-member-mgmt.sh .tool/smoke-member-mgmt.sh root@<SERVER_IP>:/tmp/
# 服务器(备份库+后端+H5 → 覆盖后端 → 迁移 005 → 重启 → 覆盖 H5 → 校验)
bash /tmp/deploy-member-mgmt.sh /tmp/server-member-mgmt.tgz /tmp/h5-member-mgmt.tgz
bash /tmp/smoke-member-mgmt.sh
```

本次生产冒烟结果（全部可逆、零残留）：新建红牌 `red_days=0` → 补录 16 天前 `red_days=16` → 改名后仍 16 → 转绿结束计时 → 再转红重新计时 →
批量追加备注连点/重试**只追加一次**、同批次号换内容 **409** → 归档后默认列表与录入候选都不再出现、`include_archived=1` 可见（`deleted_at` 有值） →
重新激活清空 `deleted_at` → 访客批量/删除接口 **403** 且看不到内部备注 → 真删清理后成员表、审计表、批次表、流水/转盘/外观计数与冒烟前**完全一致**。

### 5. 待真机确认

- 旗帜图标（CSS 绘制）在小屏上的清晰度与对齐；超期提醒条颜色。
- 批量管理模式：全选当前/反选、隐藏已选提示、批量按钮在窄屏是否换行。
- 红牌计时文案（"已挂红牌 N 天" / "待补录"）与补录日期选择器。
- 「移除并归档此成员」的二次确认文案是否足够明确（归档 ≠ 删除历史）。

### 6. 回滚

```bash
# 前端
tar -xzf /var/backups/coc-points/h5-before-member-mgmt-<时间戳>.tgz -C /var/www/coc-points/h5
# 后端
tar -xzf /var/backups/coc-points/server-before-member-mgmt-<时间戳>.tgz -C /opt/coc-points/server && systemctl restart coc-points
# 数据库(仅在必要时; 会丢掉这段时间的新数据, 用备份 + 当日业务数据判断)
gunzip < /var/backups/coc-points/db-before-member-mgmt-<时间戳>.sql.gz | mysql -uroot -p coc_points
```

- 迁移 005 的**结构**回滚（旧代码不需要这两列/两张表，保留也无害）：
  ```sql
  ALTER TABLE members DROP COLUMN red_since, DROP COLUMN deleted_at;
  DROP TABLE IF EXISTS member_status_logs;
  DROP TABLE IF EXISTS member_batch_tokens;
  ```
- 本机产物：`.e2e-logs/h5-member-mgmt.tgz`、`.e2e-logs/server-member-mgmt.tgz`；旧页面源码 `.e2e-logs/members-page-before.vue`、`.e2e-logs/member-edit-page-before.vue`。
- ⚠️ 回滚到旧前端后，「删除」按钮会重新变成**物理删除**（旧代码的 DELETE 语义）——即使新后端把 DELETE 解释为归档也无妨，但请注意旧前端不会显示归档成员。

---

## 附：账号体系（users + 三级角色 + 即时吊销, 2026-09-10）

### 1. 结构变化

| 位置 | 说明 |
|---|---|
| `server/migrations/006_accounts.sql` **新增** | `users`（scrypt 密码哈希、`role`、`enabled`、`token_version`、`must_change_password`、生成列 `super_only` + 唯一索引保证**只能有一个超管**）；`security_audit_logs`；`member_status_logs` 增加 `actor_user_id / actor_username / actor_role` |
| `server/src/lib/auth.js` **重写** | scrypt 哈希/校验、JWT `{sub, role, ver, typ}`、`optionalAuth / requireAuth / requireAdmin / requireSuperAdmin`、`blockIfMustChangePassword`、IP+用户名双维度限流、`bumpTokenVersion` |
| `server/src/lib/audit.js` **新增** | `actorOf(req)` + 安全审计写入（绝不写密码/Token） |
| `server/src/routes/auth.routes.js` | `POST /login`（用户名+密码）、`POST /viewer-login`（可选访客口令）、`GET /me`（匿名返回 `role=guest`）、`POST /change-password`、`POST /logout-all` |
| `server/src/routes/admin-users.routes.js` **新增** | `GET/POST /users`、`PATCH /users/:id`(显示名)、`PATCH /users/:id/status`、`POST /users/:id/reset-password`、`POST /users/:id/revoke-tokens`、`GET /security-audit-logs`（全部仅超管） |
| `server/scripts/admin-cli.mjs` **新增** | 服务器本地初始化/重置：`npm run user:init-super-admin`、`user:reset-password -- <用户名>`、`user:list`（另有 `init-env` / `reset-env` 供部署脚本非交互使用） |
| `server/src/app.js` | **公开只读层**：`/api` 先 `optionalAuth`（无 Token = 匿名 guest）→ 改密门禁 → 非 GET 一律 `requireAdmin`；`/api/admin` 挂 `requireSuperAdmin` |
| 前端 | `utils/api.js`（token+账号存储、401/403 处理、`patch`）、`utils/permissions.js`（`ensureAdminPage` 未登录跳登录页、`ensureSuperAdminPage`）、`pages/login`（美化版：用户名+密码+暂不登录浏览）、`pages/settings`（新设计：身份卡 + **账号与安全**）、`pages/change-password`、`pages/admin-users` |

### 2. 行为变化（重要）

1. **访客不再需要密码**：`/api` 下的业务读接口匿名可访问（成员 `note` 仍剥离）；`/api/settings`、`/api/budget`、`/api/export`、`/api/backup` 匿名 **401**、访客口令 **403**。
2. **管理员改为用户名 + 密码**，账号在 `users` 表；`.env` 的 `ADMIN_PASSWORD` **不再用于登录**（可以删掉，代码已不读取）。
3. **旧 Token 全部失效**：不再接受只带 `role` 的旧 JWT（升级时建议同时轮换 `JWT_SECRET`）。
4. **不可逆操作限超管**：`POST /api/restore`、`DELETE /api/members/:id?purge=1`、`/api/admin/*`；普通管理员调用返回 403。
5. **网页备份只含业务表**：`settings / members / score_rules / score_records / weekly_results / reward_logs`（响应里带 `scope: business`、`accounts_included: false`）；账号与安全审计**不在**其中，完整灾备用服务器 `mysqldump`。
6. **临时密码账号**：超管创建/重置后得到一次性临时密码，登录后必须先改密（业务接口返回 403 `MUST_CHANGE_PASSWORD`）；改密成功即吊销旧 Token 并要求重新登录。
7. **停用 = 立即失效**：停用时 `token_version+1`，重新启用后旧 Token 也不会复活。
8. **操作人审计**：成员状态变更记录真实账号（`actor_username/actor_role`）；旧记录保持 `actor='admin'`，不冒充新账号。

### 3. 上线步骤（本次实际执行）

```bash
# 本机
cd app && npm run build:h5
tar -czf .e2e-logs/h5-accounts.tgz -C app/dist/build/h5 .
tar -czf .e2e-logs/server-accounts.tgz -C server --exclude=node_modules --exclude=.env .
scp .e2e-logs/server-accounts.tgz .e2e-logs/h5-accounts.tgz \
    .tool/deploy-accounts.sh .tool/smoke-accounts.sh root@<SERVER_IP>:/tmp/
# 服务器: 备份(库+后端+H5) → 覆盖后端 → 迁移 005/006 → 初始化超管 → 重启 → 覆盖 H5 → 校验
bash /tmp/deploy-accounts.sh /tmp/server-accounts.tgz /tmp/h5-accounts.tgz
bash /tmp/smoke-accounts.sh
```

初始化超级管理员：用户名为 `admin`，密码沿用升级前的 `ADMIN_PASSWORD`，并置 `must_change_password=1`（**首次登录会强制改密**，这样旧口令自然作废，不需要另外分发新密码）。

### 4. 生产冒烟结果（可逆，零残留）

匿名 `GET /api/members|/dashboard|/ranking/boards` → **200**；`/api/settings|/backup` → **401**；匿名 `POST /api/members`、`DELETE`、`POST /api/restore` → **401**；坏 JSON → **400**（不再 500）。
超管登录 `must_change_password=true` → 未改密访问业务/账号接口 **403**（`/auth/me` 仍 200）→ 改密后旧 Token **401**、新密码可登录。
临时密码管理员：未改密 **403** → 改密 → 旧 Token **401** → 新密码 **200**；`/api/admin/users` 普通管理员 **403**；`/api/restore` **403**；`?purge=1` **403**。
停用 → 旧 Token **401** 且无法登录 → 启用后旧 Token 仍 **401** → 强制退出后 **401**；停用超管 **403**；只有一个超管 ✓。
旧式「只发 password」登录 **400**；审计动作齐全（login / create_admin / change_password / disable_admin / enable_admin / revoke_tokens / init_super_admin）且都带操作人。
清理后：账号 1 个、成员 6、流水 2、转盘 6、外观 2、批次令牌 0 —— 与冒烟前一致。

### 5. 日常运维

```bash
cd /opt/coc-points/server
npm run user:list                       # 查看账号/状态/最近登录
npm run user:init-super-admin           # 首次初始化(已存在会拒绝)
npm run user:reset-password -- admin    # 忘记超管密码时重置(服务器本地, 交互式输入)
```
- 新增管理员、停用、重置密码、强制退出都在**设置 → 账号与安全 → 管理员管理**里做（仅超管可见）。
- 账号**不做物理删除**（审计要长期指向原账号），只停用。
- 单超管约束由 DB 生成列唯一索引兜底，接口也不允许客户端提交 `role`。

### 6. 密码泄露处置（已执行一次）

管理员口令一旦外泄，按这个顺序做（全部可在服务器本地完成，不需要改代码）：

```bash
cd /opt/coc-points/server
# 1) 换新口令: CLI 会用 scrypt 重写哈希, 同时 token_version+1 => 所有已签发 Token 立即失效
RESET_USERNAME=admin RESET_PASSWORD='新的强口令' node scripts/admin-cli.mjs reset-env
# 2) 强制首次登录改密(让对方自己设一个只有他知道的口令)
mysql -uroot -p coc_points -e "UPDATE users SET must_change_password = 1 WHERE username = 'admin';"
# 3) 清掉 .env 里残留的旧口令(如果有)
sed -i '/^#\? *ADMIN_PASSWORD=/d' .env
# 4) 验证: 旧口令 401, 新口令能登录且 must_change_password=true
```

本次实际处置：旧口令登录已 **401**、新口令登录返回 `must_change_password=true`、`token_version` 由 2 升到 3（旧会话全部失效）、`.env` 中 `ADMIN_PASSWORD` 相关行已清零。

后续（2026-09-11 复核）：用户已自行在站内完成改密，生产现状为 `must_change_password=0`、`token_version=4` —— 处置闭环，**临时口令已作废**（后续如需登录态冒烟，只能用用户自己的新口令）。

### 7. 回滚

```bash
# 前端
tar -xzf /var/backups/coc-points/h5-before-accounts-final-<时间戳>.tgz -C /var/www/coc-points/h5
# 后端
tar -xzf /var/backups/coc-points/server-before-accounts-<时间戳>.tgz -C /opt/coc-points/server && systemctl restart coc-points
```
- 结构回滚（旧代码不读这些表/字段，保留也无害）：
  ```sql
  ALTER TABLE member_status_logs DROP COLUMN actor_user_id, DROP COLUMN actor_username, DROP COLUMN actor_role;
  DROP TABLE IF EXISTS security_audit_logs;
  DROP TABLE IF EXISTS users;
  ```
- ⚠️ 回滚到旧后端后，认证会退回共享 `ADMIN_PASSWORD`（`.env` 里还留着原值，可直接用）。
- 本机产物：`.e2e-logs/h5-accounts.tgz`、`.e2e-logs/server-accounts.tgz`；旧页面源码 `.e2e-logs/login-page-before.vue`、`.e2e-logs/settings-page-before-accounts.vue`。

### 8. 补充：删除账号 + 临时密码可复制（2026-09-11）

> 起因：用户反馈"超管管理账号只有停用没有删除"、"生成的临时密码不能复制"。

#### 8.1 后端

| 项 | 内容 |
|---|---|
| 新接口 | `DELETE /api/admin/users/:id`（`requireAuth + requireSuperAdmin`） |
| 拦截规则 | 超级管理员账号 → 403「超级管理员账号不允许删除」（与"不能停用/降级超管"同一口径，避免把自己锁在外面）；自己 → 400（防御性，正常流程触达不到）；不存在 → 404；匿名 401；普通管理员 403 |
| 事务内步骤 | 先写审计 `delete_user`（`details` 带 `用户名 + 角色 + 启用状态` 快照）→ 清掉 `users.created_by` 里指向该账号的悬空引用 → `DELETE FROM users` |
| 为什么敢物理删除 | `security_audit_logs` / `member_status_logs` 存的是**用户名快照**（`actor_username`），且**没有指向 `users` 的外键**（见迁移 006），所以删号不会破坏历史追溯；被删账号已签发的 Token 因查不到用户，下一次请求即 401 |
| CLI 兜底 | `npm run user:delete -- <用户名> --yes`（网页进不去时用；同样拒绝删超管，且删除前写审计） |

#### 8.2 前端（`app/src/pages/admin-users/admin-users.vue`）

- 账号列表每条新增「**删除**」操作（超管行不显示）；点击后弹出 `editable` 弹窗，**要求手工输入该账号用户名**才可确认（输入不一致直接取消，避免误删）。
- 临时密码卡片重做：新增「**复制临时密码**」按钮（`uni.setClipboardData`，H5 与 App 都可用）、密码文本加 `user-select` 支持长按选中；生成后自动 `uni.pageScrollTo` 回到顶部并提示"请复制后转交本人"（原来卡片在长列表上方，重置密码后容易看不到）。
- 安全审计动作字典新增 `delete_user` → 「删除账号」。

#### 8.3 验证

- 端到端断言 345 → **363**（新增「账号删除」用例 17 条 + 限流用例前置 1 条：权限边界 401/403/404、超管保护、列表消失、已删账号无法登录、旧 Token 失效、审计含真实操作人与用户名快照、被删账号的历史日志仍保留）。
- 顺带修掉一条**偶发失败**的限流用例：限流计数是 `(IP + 用户名)` 维度且成功登录会清零，前面用例的登录失败会污染它 → 改为在用例开头先成功登录一次清零计数（`第5次错误仍 401` 恢复正常）。
- 前端：`sfc-check` / `vue-ctx-check` / `page-null-render`（14 页全过）/ H5 构建。

#### 8.4 上线与回滚（本次实际执行 2026-09-11 19:19）

```bash
# 本机
cd server && node scripts/e2e-run.mjs                 # 363 PASS / 0 FAIL
cd app && npm run build:h5
tar -czf .e2e-logs/server-admin-delete.tgz -C server --exclude=node_modules --exclude=.env .
tar -czf .e2e-logs/h5-admin-delete.tgz -C app/dist/build/h5 .
scp .e2e-logs/server-admin-delete.tgz .e2e-logs/h5-admin-delete.tgz .tool/deploy-admin-delete.sh root@<SERVER_IP>:/tmp/

# 服务器: bash /tmp/deploy-admin-delete.sh
#   备份(库+后端+H5) → 覆盖后端 → restart → 覆盖 H5 → 冒烟 → 上线前后状态比对
```

本次冒烟结果（零残留：账号 3 个、成员 51/46/46、流水 2、转盘 6、`delete_user` 审计 0 —— 前后完全一致）：

| 检查 | 结果 |
|---|---|
| 匿名 `GET/POST/DELETE /api/admin/*` | 401 / 401 / 401 |
| 访客口令登录后 `GET`、`DELETE /api/admin/users/1` | 403 / 403 |
| 线上 `DELETE` 路由与 CLI | `admin-users.routes.js` 命中 1 处、`admin-cli.mjs` 命中 3 处 |
| H5 入口 chunk | `index-CkqRH0PR.js` → **`index-CFaEELm6.js`** |
| 管理员页 chunk | `pages-admin-users…BQAIkym-.js` → **`…CxxqwGdh.js`**，且含「复制临时密码」「删除账号」 |
| 公开只读 `/api/members` | 200 |
| 导入页 | 仍是「名单粘贴」三步流程；官方同步入口由 `cocModeEnabled=false` 隐藏（字符串仍在包内属正常，运行时不会渲染也不会发请求） |

```bash
# 回滚
tar -xzf /var/backups/coc-points/server-before-admin-delete-<时间戳>.tgz -C /opt/coc-points/server && systemctl restart coc-points
tar -xzf /var/backups/coc-points/h5-before-admin-delete-<时间戳>.tgz -C /var/www/coc-points/h5
```

无表结构变更（没有迁移），旧代码也能读这些数据；唯一"不可逆"的是被删掉的账号本身。

---

## 附：首页美化（重新设计版, 2026-09-10）

### 1. 结构变化（纯前端）

| 区块 | 内容 |
|---|---|
| 品牌头部 | `CLAN ACTIVITY POINTS` + 「部落活跃中心」+ 一句话说明 + 徽章装饰 |
| 公开浏览提示 | 未登录/访客时显示「只读浏览 + 管理员登录 ›」（登录后自动隐藏） |
| 本周概览 | 本周录入 / 活跃成员 / 部落成员 三个指标 + 周起始日 + **今日录入** + 手动刷新（刷新中显示"更新中…"） |
| 请求状态 | 失败时显示提示条与「重试」，**保留上次成功数据**不闪空 |
| 结算提醒 | 上周未结算且是管理员时显示，点击直达结算页 |
| 常用功能 | 录入积分（访客显示"积分流水"）/ 排行榜 / 成员管理 / 周期结算（访客"结算历史"） |
| 趣味功能 | 部落转盘、AI 创作工坊 |
| 本周前三 | 金/银/铜名次 + 首字头像 + 称号（部落之光 / 荣耀先锋 / 精锐战将）+ 游戏标签 + 总积分；空态有文案 |
| 加载骨架 | 首次加载显示骨架列表，避免空白 |

接口未变（`GET /api/dashboard`），**无后端改动、无迁移**；名次顺序直接采用服务端返回，前端不重排。

### 2. 上线步骤（本次实际执行）

```bash
cd app && npm run build:h5
tar -czf .e2e-logs/h5-home-beautify.tgz -C app/dist/build/h5 .
scp .e2e-logs/h5-home-beautify.tgz .tool/deploy-h5-home.sh root@<SERVER_IP>:/tmp/
# 服务器: 备份现网 -> 覆盖 -> 校验
cp /tmp/h5-home-beautify.tgz /tmp/h5-home.tgz && bash /tmp/deploy-h5-home.sh
```

校验结果：首页 chunk 含「部落活跃中心 / CLAN ACTIVITY POINTS / 本周荣誉席位 / 常用功能 / 管理员登录 / 本周录入 / 活跃成员」；
`pages-*` chunk 共 14 个（其它页面完好）；`/` 200、匿名 `/api/dashboard` 200（本周录入 2 / 活跃 1 / 成员 6 / 前三 泥头车出击·测试1·测试2）、匿名 `/api/settings` 401。

### 3. 待真机确认

- 品牌头部与徽章在窄屏（320–430px）的换行与留白。
- 三项指标 + 「今日录入」在长数字（千分位）下的排版。
- 本周前三荣誉卡在 1–3 人时的空位；访客态「只读浏览」提示条的按钮点击区域。
- 首次加载骨架到真实数据的切换是否有跳动。

### 4. 回滚

```bash
tar -xzf /var/backups/coc-points/h5-before-home-beautify-<时间戳>.tgz -C /var/www/coc-points/h5
```

本机产物：`.e2e-logs/h5-home-beautify.tgz`；旧首页源码 `.e2e-logs/index-page-before-beautify.vue`。

---

## 附：录入页优化（选人弹层 + 快捷数量后端化, 2026-09-10）

### 1. 结构变化

| 位置 | 说明 |
|---|---|
| `app/src/pages/entry/entry.vue` | 主面板新增 `QUICK SCORE ENTRY` 标题与**三步引导**；「积分项目」小标题；快捷按钮说明；**成员编辑区整体替换为底部选人弹层**（`member-picker-layer / -sheet / -header / -controls / -scroll / -footer`） |
| 交互变化 | 弹层内**即时点选**（点一下即生效，「完成选择」只收起面板）；两列成员卡片；搜索 + 绿/红牌筛选（每类带人数）；**全选当前 / 反选当前 / 只看已选**；底部固定"已选 N / 共 M"+"清空全部选择"+"完成选择 · N 人"；"用上次成功录入的成员"移入弹层并改为**替换前确认** |
| 预览时机 | 弹层打开期间**不发预览请求**（`schedulePreview` 增加 `membersPanelOpen` 保护），选完人后统一算一次 |
| 分页 | 移除 `membersExpanded / memberPageSize / visibleMembers`（50 人直接渲染，不做分页） |
| `server/migrations/007_rule_quick_values.sql` **新增** | `score_rules.quick_values VARCHAR(64)`（逗号分隔，最多 4 个正数，**与 `quantity` 同单位**）+ 给存量规则补默认值 |
| `server/src/lib/rules.js` **新增** | `parseQuickValues / stringifyQuickValues / withQuickValues(List)`：对外统一返回**数组** |
| `rules.routes.js` / `meta.routes.js` | `/api/rules`（列表/新建/更新）与 `/api/options` 的规则都带 `quick_values` 数组；PUT 仍为部分更新 |
| 设置页 | 规则编辑器新增「录入页快捷数量（可选）」输入（逗号分隔） |

### 2. 关于"计分单位"的说明（设计稿第一节）

设计稿提出：`数量 × score_per_unit` 直接相乘时，**输入 100 到底代表 100 个"每100兵力"还是 100 兵力**必须与后端契约一致，不能靠界面文字猜。本次据此**取消了按规则名推断大数量快捷键**。

现网真实数据（`score_records`）显示用户的实际习惯是**填原始数量**：捐兵 `quantity=1000`（真实兵力）、部落战三星 `quantity=2`（次数）。因此迁移 007 按此习惯补齐了 `quick_values`（捐兵 100/500/1000、竞赛 1000/2000/5000）。

> ⚠️ 遗留：捐兵这类"每 100 兵力"的规则，分值应等于 `数量 ÷ 100 × 单价`，而当前实现是 `数量 × 单价`——**目前靠"每人每周上限"兜住结果**（20 分/周）。若要严格换算，需要给规则增加"单位分母"字段并同步改 `calc.js`，这属于口径变更，本次未做。

### 3. 上线步骤（本次实际执行）

```bash
cd app && npm run build:h5
tar -czf .e2e-logs/h5-entry-picker.tgz -C app/dist/build/h5 .
tar -czf .e2e-logs/server-entry-picker.tgz -C server --exclude=node_modules --exclude=.env .
scp .e2e-logs/{h5-entry-picker,server-entry-picker}.tgz .tool/deploy-entry-picker.sh root@<SERVER_IP>:/tmp/
# 服务器: 备份 → 后端 → 迁移 007 → 重启 → H5 → 校验
bash /tmp/deploy-entry-picker.sh
```

校验结果：迁移后各规则 `quick_values` = 捐兵 `100,500,1000` / 部落战三星 `1,2,3` / 联赛胜利星 `1,2,5` / 突袭 `1,2,3` / 竞赛 `1000,2000,5000`；
线上 `/api/options` 匿名返回的规则里 `quick_values` 均为**数组**；首页 200、匿名 `/api/settings` 401；`pages-*` chunk 14 个（其它页面完好）。

### 4. 待真机确认

- 弹层高度与**原生 tabBar** 的关系（H5 下推荐正常；App/小程序需真机核对层级，原生 tabBar 不一定被 `z-index` 覆盖）。
- 弹层内键盘弹出时搜索框是否被遮挡、滚动列表是否跟手。
- 两列卡片在 320–430px 的换行与点击区域；「只看已选」+「全选当前」组合后的范围是否符合直觉。
- 关闭弹层后预览是否及时刷新（设计上选人期间不请求，关闭时统一算）。

### 5. 回滚

```bash
tar -xzf /var/backups/coc-points/h5-before-entry-picker-<时间戳>.tgz -C /var/www/coc-points/h5
tar -xzf /var/backups/coc-points/server-before-entry-picker-<时间戳>.tgz -C /opt/coc-points/server && systemctl restart coc-points
# 结构回滚(旧代码不读该列, 保留也无害): ALTER TABLE score_rules DROP COLUMN quick_values;
```

本机产物：`.e2e-logs/h5-entry-picker.tgz`、`.e2e-logs/server-entry-picker.tgz`；旧页面源码 `.e2e-logs/entry-page-before-picker.vue`。

---

## 附：排行榜页美化（2026-09-10）

### 1. 结构变化（纯前端）

| 区块 | 内容 |
|---|---|
| 头部 | `TRIBE LEADERBOARD` + 「部落荣誉榜」+ 一句话说明 + 🏆 徽章；底部显示**当前榜单名**（综合榜 / 分项榜）与周期说明 |
| 筛选卡 | 周榜 / 四周月；综合榜 + 每个启用规则的分项榜（横向滑动）；「统计周期 · 左右滑动切换」+ 周期列表；「在部落 / 含离开」开关（带 ⇄ 图标与说明） |
| 列表头 | 排名 / 部落成员 / 贡献积分 三列 |
| 列表行 | 名次（两位补零，前三金/银/铜高亮）、头像（前三 `frame-N` + 转盘头像框）、昵称（转盘彩色）、称号与限时称号、离开标记、游戏标签、积分与箭头；点击直达该成员流水明细 |
| 状态 | 首次加载骨架（刷新时保留旧列表）、空态「荣耀席位，虚位以待」、脚注「每一份热爱，都是部落的力量」 |

**只替换了 `<template>` 与 `<style scoped>`，`<script>` 与改动前逐字节一致**（已用脚本比对确认），因此接口、分项榜、周期列表、含离开逻辑、点击进明细的行为都没有变化。**无后端改动、无迁移。**

### 2. 上线步骤（本次实际执行）

```bash
cd app && npm run build:h5
tar -czf .e2e-logs/h5-ranking.tgz -C app/dist/build/h5 .
scp .e2e-logs/h5-ranking.tgz .tool/deploy-h5-ranking.sh root@<SERVER_IP>:/tmp/
bash /tmp/deploy-h5-ranking.sh   # 备份现网 -> 覆盖 -> 校验
```

校验结果：排行榜 chunk 含「TRIBE LEADERBOARD / 部落荣誉榜 / 统计周期 / 荣耀排行 / 贡献积分 / 荣耀席位 / 每一份热爱」；
`pages-*` chunk 仍 14 个；首页 200、匿名 `/api/ranking` 与 `/api/ranking/boards` 200；
线上本周榜（含离开）返回 6 人、`cycle_start=2026-09-07`、第一名 `泥头车出击 · 26 分`。

### 3. 待真机确认

- 头部氛围区与徽章在 320–430px 的换行/留白；两个光晕装饰是否溢出。
- 分项榜横向滑动的手感与当前项高亮；周期列表滑动。
- 前三金银铜行底色与头像框叠加后的对比度；姓名过长时的截断。
- 骨架屏切到真实列表时是否跳动；空态在切换周期时的显示。

### 4. 回滚

```bash
tar -xzf /var/backups/coc-points/h5-before-ranking-<时间戳>.tgz -C /var/www/coc-points/h5
```

本机产物：`.e2e-logs/h5-ranking.tgz`；旧页面源码 `.e2e-logs/ranking-page-before.vue`。

---

## 附：部落转盘页美化（2026-09-10）

### 1. 结构变化（纯前端，单文件替换）

| 区块 | 内容 |
|---|---|
| 头部 | `TRIBE LUCKY CLUB` + 「部落幸运屋」+ 一句话说明 + 🎡 |
| 代抽成员 | 「为谁送上好运」卡片（管理员代抽徽章、成员选择、切换提示）；非管理员显示只读说明（"好运，由管理员派送"） |
| 抽奖舞台 | 「今日好运，即将揭晓」+ 金色外圈、**环形灯珠**、**固定指针**、中心徽章（沿用原 `conic-gradient` 八扇区，奖励带图标）；舞台下方展示中奖概率 / 每人每天 / 有效期、状态说明与主按钮 |
| 结果 | 结果卡区分「本次抽奖结果」与「今日已抽取 · 历史结果」 |
| 当前闪耀 | 「正在闪耀」外观列表（来自 `status.cosmetics`） |
| 奖励池 | 「好运奖励池」（来自 `status.pool`，未改后端内容） |
| 幸运点名台 | 「今天，谁是幸运成员」：范围筛选（在部落 / 绿牌 / 红牌）、滚动揭晓、抽中高亮；纯前端不写库 |
| 修复的交互 | 抽奖/点名进行中禁止切换成员与模式；加载与转动期间按钮禁用并显示原因；`already` 直接展示历史结果；网络失败后重查今日资格；切成员立即清空旧资格；转动时不刷新成员名单；离开页面清理定时器 |

**只替换了 `wheel.vue`**：奖励 key、奖励池顺序、45% 概率、`/api/wheel/*` 接口与数据库**都没有改动**（脚本里 `SECTORS` 与后端 `REWARD_POOL` 一致）。**无后端改动、无迁移。**

### 2. 上线步骤（本次实际执行）

```bash
cd app && npm run build:h5
tar -czf .e2e-logs/h5-wheel.tgz -C app/dist/build/h5 .
scp .e2e-logs/h5-wheel.tgz .tool/deploy-h5-wheel.sh root@<SERVER_IP>:/tmp/
bash /tmp/deploy-h5-wheel.sh   # 备份现网 -> 覆盖 -> 校验
```

校验结果：转盘 chunk 含「TRIBE LUCKY CLUB / 部落幸运屋 / 为谁送上好运 / 今日好运 / 好运奖励池 / 今天，谁是幸运成员 / 谢谢参与 / 烈焰框」；
`wheel-*.css`（16K）含八扇区 `conic-gradient`；`pages-*` chunk 仍 14 个；
首页 200、匿名 `/api/members` 与 `/api/wheel/cosmetics` 200、~~**匿名 `POST /api/wheel/spin` 401**（代抽仍限管理员）~~ ——
**2026-09-13 起已改为访客可用**（`/api` 的非 GET 管理员规则不再拦转盘，见 §12.8）；
`/api/wheel/status` 返回 6 项奖励池（`frame_flame / frame_star / frame_jade / color_gold / color_purple / title_lucky`）与 `probability=0.45`。

### 3. 待真机确认

- `conic-gradient` 与 `transform: rotate()` 动画在不同端（H5 / 小程序 / App）的表现；灯珠与小扇区在 320–430px 的清晰度。
- 转动 3.3s 的时长与指针停位是否对齐（扇区中心 = 指针位置）。
- 键盘/原生 tabBar 与页面底部的关系；点名台滚动揭晓的节奏。
- 抽奖中切换成员被拦下的提示是否够明显。

### 4. 回滚

```bash
tar -xzf /var/backups/coc-points/h5-before-wheel-<时间戳>.tgz -C /var/www/coc-points/h5
```

本机产物：`.e2e-logs/h5-wheel.tgz`；旧页面源码 `.e2e-logs/wheel-page-before.vue`。

---

## 附：部落创作工坊页美化（2026-09-10）

### 1. 结构变化（纯前端，单文件替换）

| 区块 | 内容 |
|---|---|
| 工作台头部 | 渐变标题区：「部落创作工坊 · 把脑海里的想象变成作品」+ 三分区切换（创作 / 本机图库 / 部落图库） |
| 只读分支 | 无生成权限时显示「当前账号暂时不能生成图片，可以在部落图库预览和下载作品」+「浏览部落图库」 |
| 创作模式 | 双卡片入口：**通用创作**（自由提示词 / 模板）与**东方幻境**（参数分组 + 剧情导入） |
| 东方幻境 | 表单分组；**旧剧情（括号格式）导入默认折叠**（`showBracketImport`），需要时再展开，减少页面长度 |
| 生成区 | 提示词、参数（尺寸显示改用 `config.image_size`）、额度、任务状态分层；**不显示虚假进度** |
| 结果与图库 | 作品**双列卡片** + 独立操作区（下载本机 / 上传部落 / 删除）+ 深色大图预览；本机图库与部落图库分页加载 |
| 额度文案 | 上传额度显示为「今日已上传 X / Y 张」（管理员显示不限次数并注明存储名额限制） |

**契约零改动**：没有改任务恢复、幂等编号、接口路径（`/config`、`/jobs`、`/jobs/:id`、`/jobs/:id/image`、`/gallery`、`/gallery/:id`）、额度、存储命名空间与字段长度；script 只新增了 `showBracketImport: false`（已用脚本比对：845 → 847 行，新增内容就是那一行加一条注释）。**无后端改动、无迁移。**

### 2. 上线步骤（本次实际执行）

```bash
cd app && npm run build:h5
tar -czf .e2e-logs/h5-workshop.tgz -C app/dist/build/h5 .
scp .e2e-logs/h5-workshop.tgz .tool/deploy-h5-workshop.sh root@<SERVER_IP>:/tmp/
bash /tmp/deploy-h5-workshop.sh   # 备份现网 -> 覆盖 -> 校验
```

校验结果：工坊 chunk 含「部落创作工坊 / 通用创作 / 东方幻境 / 本机图库 / 部落图库 / 今日已上传 / 把脑海里的想象变成作品 / 浏览部落图库」；
`pages-*` chunk 仍 14 个；首页 200；AI 工坊已挂载（`journalctl` 显示 `ai-workshop] 就绪: model=Kwai-Kolors/Kolors ... enabled=true`）。

匿名接口边界（与页面只读分支一致）：`GET /api/ai-workshop/config` **200**（返回 `can_create:false, role:guest`）、`GET /api/ai-workshop/gallery` **200**（可看图库）、`POST /api/ai-workshop/jobs` **403**、`POST /api/ai-workshop/gallery` **403**（匿名人不能生成/上传）。

> ⚠️ **2026-09-13 13:19 起这条边界已放开**：`config.can_create` 对匿名访客变成 `true`，
> `POST /jobs` 不再 403，额度按**每 IP 每天 10 张**（`AI_VIEWER_DAILY_LIMIT`）计 —— 见 §12.8。

### 3. 待真机确认

- 东方幻境"生成提示词"后再改参数会标记未应用，折叠导入区展开/收起后的滚动位置。
- 刷新页面后的任务恢复、本机保存失败重试、深色大图预览与下载在手机端的表现。
- 双列作品卡片在 320–430px 的排版；部落图库分页加载的触发点。
- 无生成权限账号（匿名/访客）看到的只读提示与「浏览部落图库」跳转。

### 4. 回滚

```bash
tar -xzf /var/backups/coc-points/h5-before-workshop-<时间戳>.tgz -C /var/www/coc-points/h5
```

本机产物：`.e2e-logs/h5-workshop.tgz`；旧页面源码 `.e2e-logs/workshop-page-before.vue`。

---

## 附：批量导入页渲染报错修复（2026-09-10）

### 1. 现象与根因

打开「成员 → 批量导入」时浏览器控制台报：

```text
TypeError: Cannot read properties of null (reading 'in_tribe_after')
    at pages-member-import-member-import.*.js (两处)
```

**不是接口返回了 null**，而是模板里把"预览结果""确认导入"两个区块写成了：

```vue
<view v-show="step === 2 && preview" class="card">
  ... {{ preview.counts.add }} ... {{ preview.in_tribe_after }} ...
</view>
```

`v-show` **不会阻止渲染**（只是切 `display`），所以首次渲染 `preview` 还是 `null` 时，区块内的插值表达式照样求值 →
在 `null` 上读属性直接抛错。两处 `in_tribe_after`（第二步 / 第三步）正好对应堆栈里的两个偏移。

### 2. 修复

两处改为 `v-if`（数据不存在就整块不渲染），并保留第一步的 `v-show="step === 1"`（不引用 `preview`，且能保留已粘贴的名单与输入焦点）。

### 3. 怎么验证的（可复现）

新增 `.tool/page-null-render.mjs`：用 SFC 编译器编译模板，从 `<script>` 里提取初始化为 `null` 的 data 字段，
在"数据未就绪"的状态下**真正调用一次渲染函数**：

```bash
# 修复前：✗ Cannot read properties of null (reading 'counts')
# 修复后：✓ ok
node .tool/page-null-render.mjs app/src/pages/member-import/member-import.vue

# 全站扫一遍(14 个页面全部 ✓)
node .tool/page-null-render.mjs app/src/pages/*/*.vue
```

> 打包构建、静态检查、后端 E2E 都发现不了这类问题——它们不执行"空状态"的渲染。**以后改模板请跑一次这个脚本。**

### 4. 上线步骤（本次实际执行）

```bash
cd app && npm run build:h5
tar -czf .e2e-logs/h5-import-fix.tgz -C app/dist/build/h5 .
scp .e2e-logs/h5-import-fix.tgz .tool/deploy-import-fix.sh root@<SERVER_IP>:/tmp/
bash /tmp/deploy-import-fix.sh
```

校验：导入页 chunk 更新为 `pages-member-import-member-import.O2kF2NzS.js`、页面标记齐全、`pages-*` 仍 14 个；
首页 200、匿名 `POST /api/members/batch/preview` 401（导入接口仍限管理员）。
**部署后请在手机上强刷一次**（chunk 名变了，旧 HTML 缓存可能仍指向旧文件）。

### 5. 回滚

```bash
tar -xzf /var/backups/coc-points/h5-before-import-fix-<时间戳>.tgz -C /var/www/coc-points/h5
```

本机产物：`.e2e-logs/h5-import-fix.tgz`。

---

## 附：官方 API 成员同步（只读预览 + 勾选应用；新增自动、状态人工, 2026-09-11）

### 1. 能力边界（用真实 key 实测确认）

| 数据 | 来源 | 说明 |
|---|---|---|
| 部落信息（名称/等级/人数/战绩） | `GET /v1/clans/{tag}` | ✅ |
| **成员名单**（谁在部落、角色、大本、奖杯、捐兵） | `GET /v1/clans/{tag}/members` | ✅ 据此判定"在部落 / 已离开" |
| **绿牌 / 红牌** | `GET /v1/players/{tag}` 的 **`warPreference`**（`in`=参战 / `out`=休战） | ✅ 但**成员名单接口不含该字段** → 每人一次请求 |
| 当前部落战参战名单 + 每人出手/星数 | `GET /v1/clans/{tag}/currentwar` | ✅ 供将来自动记分 |
| 离开时间、内部备注、战意变更历史 | — | ❌ 只能靠两次快照对比/本地维护 |

其他限制：key **与 IP 绑定**（换服务器 IP 需重建 key）、每账号最多 10 把 key、官方响应带 `cache-control: max-age=600`（10 分钟缓存，本项目再加一层进程内缓存 + ~8 req/s 节流）。

### 2. 接口与命令

| 入口 | 说明 |
|---|---|
| `GET /api/coc/status` | 是否配了 token / 部落标签 / 本地在部落人数 / 两个上限（管理员） |
| `POST /api/coc/preview` | 差异报告：新增 / 状态变化 / 标签待补 / 离开建议 / 当前部落战；`{no_cache:true}` 强制刷新；**不写库** |
| `POST /api/coc/lookup` | **按玩家标签查**：`{text:'#AAA111 #BBB222'}` 或 `{tags:[…]}`，单次 ≤30；返回昵称/大本/战意/是否在本部落 + 本地匹配与建议动作；**不写库** |
| `POST /api/coc/apply` | 只应用显式 `actions`（`add`/`tag`/`status`/`rejoin`/`leave`），幂等 + 审计（`reason='游戏内同步: …'`、`batch_id`）；**`{auto_add:true}` 时服务端自己重拉官方名单，只自动新增新面孔** |
| `node scripts/coc-sync.mjs whoami` | 服务器本地检查 token 是否可用 |
| `node scripts/coc-sync.mjs preview [#标签]` | 服务器本地打印差异报告（只读） |
| `node scripts/coc-sync.mjs war [#标签]` | 当前部落战参战与出手/星数 |
| `node scripts/coc-sync.mjs apply --yes [#标签]` | 按报告写库（危险，需显式 `--yes`） |

配置：部落标签存 `settings.coc_clan_tag`（`PUT /api/settings`，管理员；**不需要迁移**）；token 存 `.env` 的 `COC_API_TOKEN`。

### 3. 安全

- token 只放服务器 `.env`（`root:www-data 640`），**不下发前端、不写日志**；上传时用一次性文件 + `shred` 删除。
- key 与 IP 绑定，其它 IP 使用会被官方 403 `accessDenied`。
- ⚠️ **建议轮换**：本次 key 通过聊天传递过，虽然 IP 绑定使外部无法直接使用，方便时可在开发者门户删除并重建，然后替换 `.env` 一行 + `systemctl restart coc-points`。

### 4. 本次真实实测（只读）

```text
node scripts/coc-sync.mjs preview '#2G9JCRQ9Y'
  部落「king sadra」(#2G9JCRQ9Y) 等级 1 · 官方成员 1 人
    king sadra  #G00VY28PV  战意=in  本地=—  匹配=新成员
  建议动作: 新增 king sadra #G00VY28PV; 本地 5 名测试成员 -> 记为离开
```

> ⚠️ **重要结论（2026-09-11 用户确认）：本项目是国服（腾讯版）玩家，官方 API 不适用。**
> 2022 年 2 月起 COC 中外分服，国服是腾讯独立运营的**独立服务器/独立数据**，`api.clashofclans.com` 只覆盖**全球服**，国服没有公开的官方 API。
> 实测 `#2G9JCRQ9Y` 在全球服上属于一个**别人新建的部落**「king sadra」（等级 1、1 名成员 `king sadra #G00VY28PV`、未参战）——**不是本项目要管理的部落**。因此：
> - 生产 `settings.coc_clan_tag` **保持为空**（不写入该标签，避免把无关部落当成本部落）；
> - 线上只保留了第一步的只读接口（无定时任务、无部落标签时 `preview` 直接 400，处于**惰性状态**，不影响任何业务功能）；
> - 第二步的前端「游戏标签导入」**代码已完成但未部署**（见第 7 节）。
>
> 国服玩家请走**名单粘贴**路径（批量导入页第一种方式，与官方 API 无关）。第三方逆向/抓包方案不建议接入（非官方、不稳定、可能违反游戏条款）。

### 5. 部署与回滚

```bash
tar -czf .e2e-logs/server-coc.tgz -C server --exclude=node_modules --exclude=.env .
scp .e2e-logs/server-coc.tgz .tool/deploy-coc.sh root@<SERVER_IP>:/tmp/
bash /tmp/deploy-coc.sh     # 备份 -> 覆盖 -> 重启 -> 校验 -> 真实只读预览
# 回滚
tar -xzf /var/backups/coc-points/server-before-coc-<时间戳>.tgz -C /opt/coc-points/server && systemctl restart coc-points
```

无表结构变更（`coc_clan_tag` 复用 `settings` 键值表），因此**不需要迁移**；关闭功能只需清空 `COC_API_TOKEN` 并重启。

### 6. 未做（第三步及以后）

1. **定时同步**：systemd timer，每天 1–2 次 + 变更提醒。
2. **自动记分**：捐兵增量 → "捐兵"记录；`currentwar` 三星次数 → "部落战三星"；突袭贡献 → "突袭"。**需要先定"数量单位"口径**（见「录入页优化」附录第 2 节记录的遗留问题）。
3. **设置页也放一个部落标签输入**（当前只在批量导入页里；`settings.coc_clan_tag` 已是设置白名单键，加输入框即可）。
4. **战意变更历史**：官方不给历史，只能靠"每次预览快照 diff"累积（可在定时同步里落表）。

### 7. 第二步：标签导入前端（批量导入页）— **代码已就绪，因国服结论未部署**

> 状态（2026-09-11）：后端 + 前端 + E2E + H5 构建全部完成并本地验证通过，**但未上线**。
> 原因：本项目是**国服（腾讯版）**部落，官方 API 不覆盖国服数据（见第 4 节结论），部署后只会看到"查不到/别的部落"的界面。
> 代码完整保留在工作区，随时可部署（第 7.4 节步骤可直接使用，只需去掉"写入部落标签"那一步）。

**产品口径（用户确认）**：只让"新增成员"自动，状态变更（绿↔红、离开、回到部落）必须人工确认。

#### 7.1 前端结构（`app/src/pages/member-import/member-import.vue`，单文件）

- 顶部新增**导入方式切换**（`mode`）：`名单粘贴`（原三步流程**原样保留**）/ `游戏标签导入`（新增）。
  ⚠️ 整个新增入口由 `data.cocModeEnabled` 控制，**当前为 `false`（国服默认关闭，页面等同旧版）**；将来要启用只改这一个布尔值后重新构建 H5。
- 「游戏标签导入」内两个子页签（`cocTab`）：
  - **部落同步**：部落标签输入 + 保存（`PUT /api/settings {coc_clan_tag}`）→「读取游戏数据」（`POST /api/coc/preview {no_cache:true}`，每次强制拿最新战意）→ 差异按 4 组勾选（新增 / 补改标签 / 状态变化 / 离开建议）→ 两个按钮：
    - **导入新增成员** → `POST /api/coc/apply {actions:[], auto_add:true}`
    - **应用勾选项** → `POST /api/coc/apply {actions:[…非新增动作…], auto_add: <勾选里是否含新增>}`
  - **按标签导入**：粘贴 `#标签`（≤30）→ `POST /api/coc/lookup` → 逐条勾选 → 「导入勾选成员」→ `POST /api/coc/apply {actions}`
- 勾选默认值：**只有 `add` 默认勾选**；`tag`（补标签）/`status`/`rejoin`/`leave` 一律默认不勾选。
- 应用结果面板展示 `applied / skipped / failed` 明细 + 批次号 + 超 50 人软提醒。
- 换页签/重新读取都会重置勾选；应用成功后自动重新读取一次差异。

#### 7.2 后端变化

- `server/src/lib/coc-api.js`：新增 `slimPlayer()`、`parsePlayerTags()`（文本 → 标签数组，带"无法识别"清单与去重/截断）。
- `server/src/routes/coc.routes.js`：
  - 新增 `POST /api/coc/lookup`（只读，`requireAdmin`，上限 `MAX_LOOKUP_TAGS=30`；不配置部落标签也能查，只是没有"是否在本部落"）。
  - `POST /api/coc/apply` 支持 `auto_add`：内部 `clearCocCache()` + `buildDiff()`，**只取 `add` 动作**，与显式 `actions` 按 `类型+标识` 去重合并；无新增时返回 400「官方名单里没有需要新增的成员」。
  - 应用了新增且同步后在部落人数 > 50 时，响应带 `warning`（与批量导入同为软提醒）。
  - 本地成员匹配统一走 `localIndex()`（标签优先、昵称兜底）。

#### 7.3 标签解析规则（易踩）

| 输入 | 结果 |
|---|---|
| `#2G9JCRQ9Y` | ✅ 识别（写 `#` 的按宽松规则 `[0-9A-Z]{3,12}`） |
| `2g9jcrq9y`（无 `#`） | ✅ 识别（回退官方字符集 `0289PYLQGRJCUV` 校验） |
| `ABC123`（无 `#`，含非官方字符） | ❌ 列为「无法识别」——官方标签不含 A/B/C/D… |
| 中文备注、`hello world` | ❌ 中文直接忽略；字母片段列为「无法识别」 |

#### 7.4 上线步骤（代码就绪；**本次未执行**，如果以后要用国际服部落再照此执行）

```bash
# 本机
cd server && node scripts/e2e-run.mjs            # 345 PASS / 0 FAIL
cd app && npm run build:h5
tar -czf .e2e-logs/server-coc2.tgz -C server --exclude=node_modules --exclude=.env .
tar -czf .e2e-logs/h5-coc-import.tgz -C app/dist/build/h5 .
scp .e2e-logs/server-coc2.tgz .e2e-logs/h5-coc-import.tgz .tool/deploy-coc-ui.sh root@<SERVER_IP>:/tmp/

# 服务器
bash /tmp/deploy-coc-ui.sh
#   备份(库+后端+H5) → 覆盖后端 → systemctl restart coc-points → 覆盖 H5
#   → (仅全球服) node scripts/coc-sync.mjs set-tag '#你的部落标签'
#   → 冒烟(匿名/访客 401·403、管理员接口可用)

# 国服场景: 不要执行 set-tag; 若只想关掉已有能力, 清空 .env 里的 COC_API_TOKEN 并重启
```

#### 7.5 冒烟关注点（服务器侧，零残留）

```bash
# 权限: 匿名/访客不能碰
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://app.jiacheng.cyou/api/coc/lookup -d '{"text":"#2G9JCRQ9Y"}'   # 401
curl -s -o /dev/null -w '%{http_code}\n' https://app.jiacheng.cyou/api/coc/status                                        # 401
# 真实数据(管理员 token): 先 lookup 再 preview, 都是只读
node scripts/coc-sync.mjs preview '#2G9JCRQ9Y'
```

#### 7.6 回滚

```bash
# 前端
tar -xzf /var/backups/coc-points/h5-before-coc-ui-<时间戳>.tgz -C /var/www/coc-points/h5
# 后端
tar -xzf /var/backups/coc-points/server-before-coc-ui-<时间戳>.tgz -C /opt/coc-points/server && systemctl restart coc-points
# 关掉同步: 清空 COC_API_TOKEN 或清空 settings.coc_clan_tag, 重启
```

#### 7.7 生产现状核对（未部署，2026-09-11 只读实测）

脚本 `.tool/prod-state.sh`（只读，跑完即删），结论：**新功能没有上线，线上数据零变化**。

```text
systemd            : active
COC_API_TOKEN      : 1 行(563 字符)  ← 第一步留下的 key, 目前无用(国服), 可清空
coc_clan_tag       : ''             ← 保持为空, 不写入 #2G9JCRQ9Y
成员 总数/未归档/在部落 : 6 / 5 / 5      ← 与第一步前后一致(当时的数据)
积分流水 / 转盘抽奖  : 2 / 6
同步审计(游戏内同步%) : 0              ← 同步从未写库
admin 门禁          : must_change_password=0 token_version=4  ← 用户已自行改密, 旧临时口令作废
线上导入页 chunk     : pages-member-import-member-import.O2kF2NzS.js  ← 上一次部署的旧构建
匿名 /api/coc/*     : 401 / 401 / 401 ; 公开只读 /api/members、/api/dashboard: 200
```

> ⚠️ 判断"线上是不是新版"要**比 chunk 文件名/hash**，不要 grep 页面文案：H5 打包后页面字符串可能被压缩/转义，用 PowerShell 的 `Get-Content` 直接匹配中文会假阴性（本次就踩过这个坑，已改用 `node` 或服务器端 `curl | grep`）。

> 🚨 **改文档/代码文件一律不要用 PowerShell 读写中文**（2026-09-12 实际事故）：
> `Get-Content file -Raw | Set-Content file`（或 `-replace` 后再写回）会把 UTF-8 按系统 ANSI 代码页（GBK）解码，
> **中文永久损坏**（约 2000 个字符变成 `?`，还有换行被吃掉），且工作区没有版本控制、没有近期快照，只能从
> DSH 会话记录（`~/.dsh/sessions/**/session.v3.jsonl.zstd`，内含每一次 `write`/`edit` 的原文）逐条重放才救回来。
> 正确做法：用编辑器/`edit` 工具改；批量文本处理一律用 `node -e "fs.readFileSync(...)"`（显式 utf8）；
> 万不得已要在 PowerShell 里读写，必须显式 `[System.IO.File]::ReadAllText($p,[Text.Encoding]::UTF8)` + `WriteAllText`。

关闭第一步残留能力（可选，一条命令 + 重启）：

```bash
sed -i 's|^COC_API_TOKEN=.*|COC_API_TOKEN=|' /opt/coc-points/server/.env && systemctl restart coc-points
```

---

## 附：录入页「粘贴星数名单」+ 修 `/api/options` 丢 tag（2026-09-12）— **已部署**

> 状态：**2026-09-12 22:51 已上线**（后端 + H5 都动了）。无数据库迁移，无 `.env` 改动，用户会话未失效。
> 本次部署脚本：`.tool/deploy-star-paste.sh`；产物：`.e2e-logs/{server,h5}-star-paste.tgz`。

### 1. 场景与方案

豆包/识图（OCR）给出的结果是**按胜利之星分组**的名单：

```text
# 按胜利之星分组整理
15星：帅隆隆、經过、泥头车出鸡、晚归、渴望、湾张、李烁尘
14星：小羊、王运好、白白白白白、如影随形/瑞
...
0星：Lazy、asver
```

录入面板只能给所有人填**同一个数量**，所以以前要按星数分十几次提交。现在在录入页把整段文本贴进
「📋 粘贴星数名单」抽屉，按星数分组、**每组一个数量**、**一次成批**提交。

关键点：后端 `/api/records` **早就支持** `entries:[{rule_id, quantity, member_ids, note}]`
（`server/src/routes/records.routes.js` 的 `normalizeEntries()`），所以这是**纯前端新增**，
现有预览/幂等/撤销链路完全复用。

### 2. 改动清单（1 个后端文件 + 2 个前端文件）

| 文件 | 说明 |
|---|---|
| `app/src/utils/star-paste.js` | **新增**：解析 + 匹配纯函数（无 uni/浏览器依赖，可在 Node 里单测） |
| `app/src/pages/entry/entry.vue` | 「粘贴星数名单」抽屉 + 分组模式 + 提交体 `entries` 分支 + 指认/新建/忽略 + 「本周已录过」提醒 |
| `server/src/routes/meta.routes.js` | 修 bug：`GET /api/options` 的成员查询补上 `tag`（选人弹层展示「游戏标签」与按标签搜索全靠它） |

页面里的新增接口函数（都可在 `app/src/utils/star-paste.js` 里单独验证）：

```js
parseStarGroups(text)             // 文本 -> { groups:[{star,names}], ignoredLines }
matchNames(names, members)        // 名字 -> exact / tag / fuzzy / ambiguous / none
buildStarPlan(text, members)      // 上图 + 重复成员只记一次 + 0 星标 zero
summarizePlan(plan)               // 面板统计(可录入人数 / 待处理 / 重复 / 0 星)
planEntries(plan, ruleId, note)   // -> [{rule_id, quantity, member_ids, note}]（不含 0 星/忽略/未匹配）
```

### 3. 解析与匹配规则（易踩，务必按此判断"是不是 bug"）

| 输入 | 结果 |
|---|---|
| `15星：帅隆隆、经过` | ✅ 精确匹配（顿号/逗号/分号/竖线/换行分隔都行） |
| `１５颗: 帅隆隆 经过` | ✅ 全角数字 + 空格分隔都识别 |
| `# 按胜利之星分组整理` | ✅ markdown 标题行忽略 |
| `（结核）` | ✅ 去掉包裹符号后精确命中 `结核` |
| `經过`（繁体） | ✅ 唯一"差一个字"候选 -> 近似命中 `经过`，标「近似，请核对」 |
| `泥头车出鸡`（识图错字） | ✅ 近似命中 `泥头车出击` |
| `T0` | ✅ 近似命中 `T O`（去空白后差 1 个字符） |
| `李累` 且名单里同时有 `李雷`/`李蕾` | ⚠️ **不猜**：标「多个候选」，必须人工指认 |
| `asver`（名单里没有） | ⚠️ 标「名单里没有这个人」-> 指认 / 新建成员 / 忽略 |
| `0星：Lazy、asver` | ⏭️ 0 星组**不录入**（后端要求数量 > 0），面板标注跳过人数 |
| 同一人在两组出现 | 🔁 只按先出现的组记一次，另一行标「重复」 |
| `如影随形/瑞` | ✅ `/` 不是分隔符，昵称不会被切开 |

近似匹配的护栏：只在**整份名单里唯一**且长度 ≥ 2 时才自动采用；多做一步人工确认比默默记错人便宜。

### 4. 提交与恢复路径

- 提交体：`{client_token, entries:[{rule_id, quantity, member_ids, note}]}`，**所有组共用同一个 client_token**
  → 一个事务、一个批次 → 结果卡「撤销本批」**一次性回滚所有组**；同 token 重复提交幂等；
  同 token 多出本批次没录过的成员 -> 409（否则撤销会误删）。
- 提交成功后自动退出分组模式并清空名单（防止同一份名单再点一次）。
- **录错了**：点「撤销本批」→ 重新粘贴/修正 → 再提交。（直接重复导入会与原记录**叠加**，
  同一个人同一积分项同一周本就是累加、按周上限封顶；预览会提示「N 人本周已录过这一项」。）

### 5. 本地验证结果（全部在提交前跑过）

```bash
# 1) 解析器 45 条断言: 线上真实 46 人名单 + 用户那份识图原文 + 边界(全角/空格/重复/多候选/忽略)
node .tool/star-paste-check.mjs                  # 45 PASS / 0 FAIL

# 2) 录入页页面级流程 90 条: 真渲染(完整响应式) + 请求桩
#    覆盖 解析->分组->提交体形状->保存后复位->指认/新建/忽略->面板渲染->普通录入路径不受影响
node .tool/entry-paste-flow.mjs                  # 90 PASS / 0 FAIL

# 3) 真实 MySQL 端到端: 新增「粘贴星数名单」用例 20 条 + options 带 tag 3 条
cd server && npm run test:e2e                    # 386 PASS / 0 FAIL

# 4) 页面渲染自检 + 编译自检
node .tool/page-null-render.mjs <14 个页面>       # 全部 ok
node .tool/sfc-check.mjs app/src/pages/entry/entry.vue
node .tool/vue-ctx-check.mjs app/src/pages/entry/entry.vue

# 5) H5 构建 + 产物文案核对(在 pages-entry-entry.<hash>.js 里)
cd app && npm run build:h5
```

实测解析结果（用户那份原文 vs 线上真实名单）：30 个名字 →
**26 精确 + 3 近似（`經过`/`泥头车出鸡`/`T0`）+ 1 个 0 星跳过 = 28 人 / 10 组 / 一次提交**。

### 6. 上线步骤（**2026-09-12 22:51 已实际执行**）

```bash
# 本机
cd server && npm run test:e2e                    # 386 PASS / 0 FAIL
cd app && npm run build:h5
tar -czf .e2e-logs/server-star-paste.tgz -C server --exclude=node_modules --exclude=.env .
tar -czf .e2e-logs/h5-star-paste.tgz -C app/dist/build/h5 .
# 产物 SHA256: server 492D90D2…AA8A / h5 EC4A4CDB…A3FA
scp .e2e-logs/{server,h5}-star-paste.tgz .tool/deploy-star-paste.sh root@<SERVER_IP>:/tmp/

# 服务器
bash /tmp/deploy-star-paste.sh
#   备份(库+后端+H5) → 覆盖后端 → 校验 tag 修复与上一版 DELETE 账号路由未回退
#   → systemctl restart coc-points → 覆盖 H5 → 冒烟 → 前后状态对比 → 清理 /tmp
```

实测输出（关键行）：

```text
备份: db-before-star-paste-2026-09-12-225124.sql.gz / server-…tgz / h5-…tgz
systemd: active ; listening on http://127.0.0.1:3000 ; 日志无报错
覆盖后端: options 带 tag 1 处 ✓ / DELETE 账号路由 1 处 ✓(未回退) / CLI delete 3 处 ✓
入口 js      : assets/index-CFaEELm6.js → assets/index-YrrG-r8G.js
录入页 chunk : pages-entry-entry.CU5S47e9.js → pages-entry-entry.BC_Cjgnl.js
              (含「粘贴星数名单」/「分组数量录入」/「本周已录过这一项」)
/api/options : "tag" 字段 46 / 在部落成员 46  （修复前 0）; 已知标签「最忧郁之人」命中 1
权限        : 匿名 POST /api/records 401、DELETE /api/members/1 401、POST /api/admin/users 401
             访客 GET /api/admin/users 403、POST /api/records 403
前后状态    : 一致 → 账号 4 个(admin/xiangyu/wangui/user)、成员 51/46/46、流水 28、转盘 10、
             审计 delete_user 1、settings.coc_clan_tag=''
```

> ⚠️ **教训复用**：判断"线上是不是新版"要**比 chunk 文件名/hash**，不要 grep 中文文案
> （H5 压缩产物可能转义，PowerShell `Get-Content` 匹配中文会假阴性）。本次两处修复都用了
> "改动前先量一次、改动后再量一次"的同口径对比：`/api/options` 的 `"tag"` 字段数 **0 → 46**。

### 7. 冒烟关注点（零残留）

```bash
# 入口 chunk 名必须变化(不要用中文 grep 判断新旧, H5 产物可能转义)
curl -sS https://app.jiacheng.cyou/ | grep -oE 'assets/index-[A-Za-z0-9_~.-]+\.js'
# 新页面 chunk 里应有: 粘贴星数名单 / 分组数量录入 / 应用分组 / 本周已录过这一项
curl -sS https://app.jiacheng.cyou/assets/pages-entry-entry.<新hash>.js | grep -c '粘贴星数名单'
# 权限没被碰: 匿名写接口仍 401, 只读接口仍 200
```

无迁移、无 `.env` 改动 → 上线前后业务数据（账号 / 成员 / 流水 / 结算 / 转盘）应完全一致（本次实测一致）。

### 8. 回滚

```bash
tar -xzf /var/backups/coc-points/h5-before-star-paste-<时间戳>.tgz -C /var/www/coc-points/h5
```

### 9. 待真机确认

- 手机端底部抽屉里的 `<textarea>` 粘贴长名单时，软键盘是否遮挡（已复用选人弹层的抽屉样式）。
- 长名单（30 人以上）时抽屉内滚动是否顺畅，`指认` 弹层预填搜索词能否直接看到近似候选。
- iOS Safari 上「粘贴」后点「解析名单」是否即时出结果（避免输入法未失焦就点按钮）。

### 10. 修订：弹层层级修复 + 「快速切换」（2026-09-12 23:13 已部署，纯前端）

**用户实测报的两个 bug（同一个根因）**：

1. 选人弹层里点「清空全部选择」，`uni.showModal` 确认框**被弹层盖住** —— 要先把弹层关掉才看得到；
2. 粘贴面板里点「指认/换人」打开的选人弹层，**被粘贴面板压住**。

**根因**：`.member-picker-layer` 原来写的是 `z-index: 1000`，而 uni-app H5 的
`uni.showModal` / `uni.showToast` 固定 `z-index: 999`（`assets/uni.*.css` 里的 `.uni-modal` / `.uni-toast`）；
两个弹层又共用同一个类，DOM 里后出现的粘贴面板自然压在选人弹层上。

**修法（层级约定，别再随手改）**：

```
页面内容  <  .paste-layer 850  <  .member-picker-layer 900  <  uni.showModal/showToast 999
```

- 弹层拆成两个类：粘贴面板用 `.paste-layer`（850），选人弹层（含「指认」模式）用 `.member-picker-layer`（900）；
- 桌面端居中的媒体查询两处都保留；
- **这条约定已被断言锁住**：`.tool/entry-paste-flow.mjs` 里校验两个类的 `z-index` 数值、大小关系（都 < 999）、
  以及模板里两个类是否用对，改动错了会直接测试失败。

**新增「快速切换」**（用户要求：既然做了名称近似匹配，就要能快速换）：

- 与自动匹配**同一尺度**（归一化后差 ≤1 个字）的其它成员，会以可点小标签列在那一行下面，点一下直接换人
  （实测名单里 `天下` ↔ `天谴`）；冲突（同一人已被别的星数组占用）拒绝并提示；
- 刻意**不**放宽尺度：2 字中文昵称之间差 2 个字就"人人相似"（「經过」会列出「残影/兜子/堕落」），全是噪音；
  差得远的情况仍用「指认」——弹层搜索框已预填识图名字，而且现在它在粘贴面板之上，能正常操作。

**部署记录（本次实际执行）**：

```bash
tar -czf .e2e-logs/h5-star-paste2.tgz -C app/dist/build/h5 .        # 222 KB, SHA256 BB762C83…E355
scp .e2e-logs/h5-star-paste2.tgz .tool/deploy-entry-layers.sh root@<SERVER_IP>:/tmp/
bash /tmp/deploy-entry-layers.sh
#   只备份 H5 → 覆盖 → 冒烟(不动后端 / 不重启 / 无迁移)
```

```text
入口 js      : assets/index-YrrG-r8G.js → assets/index-BBBFrbkE.js
录入页 chunk : pages-entry-entry.BC_Cjgnl.js → pages-entry-entry.7vTXiILf.js (含「快速切换」)
录入页样式   : entry-GscwT8px.css → entry-CA53zBjc.css
层级         : .member-picker-layer  z-index:1000 → 900 ✓ ; .paste-layer 新增 850 ✓
上一版修复   : /api/options "tag" 字段仍 46 ✓
权限/数据    : 匿名写 401、访客写 403；账号 4 / 成员 51·46·46 / 流水 28 / 转盘 10 前后一致
```

回滚：`tar -xzf /var/backups/coc-points/h5-before-layers-2026-09-12-231343.tgz -C /var/www/coc-points/h5`
（本次未动后端，因此不需要 `systemctl restart`）。

### 11. 待真机确认（本轮新增）

- 弹层里「清空全部选择」的确认框现在应能直接在弹层之上看到（这是本次修的主 bug，请真机再确认一次）。
- 从粘贴面板点「指认/换人」时，选人弹层应盖在粘贴面板之上；关闭后回到粘贴面板且状态保留。
- 「快速切换」小标签在手机窄屏上会换行，确认不会把行高撑得太高（最多 3 个候选）。

### 12. 修订：弹层底边让出 tabBar（2026-09-12 23:31 已部署，纯前端）

**用户实测报的 bug**：把弹层层级降到 `900` 之后，「选择录入成员」和「粘贴星数名单」抽屉**最底部的确认按钮被底部导航栏盖住**。

**根因**：这是第 10 节那次修复的副作用，同时也暴露了 uni-app H5 的层级是"三点一线"：

```
uni-tabbar           z-index: 998   (assets/index-*.css 里的 uni-tabbar)
uni-modal / toast    z-index: 999   (assets/uni.*.css 里的 uni-modal / uni-toast)
```

弹层原来 `1000`：压住了 tabBar，但把确认框（`uni.showModal`，999）也压住了 → 第 10 节改成 `900`；
改成 `900` 后又落到 tabBar（998）下面 → 底部按钮被导航栏盖住。**998 与 999 之间没有整数**，所以不能靠 z-index 同时满足"盖住 tabBar + 低于确认框"。

**修法：不跟 tabBar 抢层级，而是整体停在它之上**

```css
.member-picker-layer, .paste-layer {
  bottom: var(--window-bottom, 0px);   /* uni 写在 <html> 上 = tabBar 高度 + 底部安全区 */
}
.member-picker-sheet { max-height: min(900px, 100%); }  /* 抽屉不超过可视高度, 顶部不会被切 */
.picker-footer { padding: 14rpx 24rpx 24rpx; }          /* 安全区已让过一次, 不再重复 env(...) */
```

- z-index 仍是 `900`(选人弹层) / `850`(粘贴面板) → 确认框/提示仍在弹层之上 ✓
- 抽屉底边正好贴在导航栏上沿 → 「完成选择 · N 人」/「应用分组 · N 人」完整可见 ✓
- 代价（已知、可接受）：tabBar 那一小条不被抽屉遮住，理论上仍可点到（点别的 tab 会离开本页，回来时状态保留）。

**断言同步补齐**（`.tool/entry-paste-flow.mjs`，页面级 106 → **110** 条）：
两个弹层的 `z-index` 数值与大小关系、都必须 `bottom: var(--window-bottom`、抽屉 `max-height: min(900px, 100%)`、
页脚不得再出现 `padding...safe-area-inset-bottom`、模板里类名用对。

**部署记录（本次实际执行）**：

```bash
tar -czf .e2e-logs/h5-entry-bottom.tgz -C app/dist/build/h5 .   # 222 KB, SHA256 8A6EAF59…6D39
scp .e2e-logs/h5-entry-bottom.tgz .tool/deploy-entry-bottom.sh root@<SERVER_IP>:/tmp/
bash /tmp/deploy-entry-bottom.sh        # 只备份 H5 → 覆盖 → 冒烟(不动后端/不重启/无迁移)
```

```text
入口 js      : index-BBBFrbkE.js → index-DH9Ou2TL.js
录入页 chunk : pages-entry-entry.7vTXiILf.js → pages-entry-entry.DjJAmrfB.js
录入页样式   : entry-CA53zBjc.css → entry-IkYIThzf.css
修复前       : .member-picker-layer{...z-index:900;bottom:0}          ← 底部被 tabBar(998) 盖住
修复后       : .member-picker-layer{...z-index:900;bottom:var(--window-bottom, 0px)} ✓
               .paste-layer{...z-index:850;bottom:var(--window-bottom, 0px)} ✓
               .member-picker-sheet{...max-height:min(900px,100%)} ✓
上一版修复   : /api/options "tag" 字段仍 46 ✓ ; 权限 401/403 正常 ; 数据前后一致
```

回滚：`tar -xzf /var/backups/coc-points/h5-before-bottom-2026-09-12-233104.tgz -C /var/www/coc-points/h5`（不需要重启）。

### 13. 待真机确认（本轮新增）

- 手机上看「选择录入成员」「粘贴星数名单」两个抽屉：底部按钮（完成选择 / 应用分组）应完整露在底部导航栏**上方**。
- 有底部安全区（全面屏）的机型上，按钮与导航栏之间不应出现一大段空白（页脚已去掉重复的安全区内边距）。
- 抽屉内的「清空全部选择」确认框仍应显示在抽屉之上。

---

## 附：识图批量导入（大本营/繁荣度）+ 牌子变化快速修改 + 繁荣度排行（2026-09-13）— **已部署**

> 状态：**2026-09-13 09:29 已上线**（后端 + 迁移 008 + H5）。部署过程踩了一个顺序错误，见第 6 节。
> 产物：`.e2e-logs/{server,h5}-ocr.tgz`；脚本：`.tool/deploy-ocr-import.sh`。

### 1. 需求与设计

识图（豆包）能给出更细的数据：`名称,大本营,牌子,繁荣度`（如 `清风霁月,14,绿,63`）。

- **牌子 = 现有 `members.status`**（绿=0 / 红=1）→ 不需要新列；
- **新增两列（迁移 008）**：`members.town_hall TINYINT UNSIGNED NULL`（大本营等级，正整数、**不设上限**）、
  `members.prosperity INT UNSIGNED NULL`（繁荣度，非负整数、**不设上限**；008 建表时是 `SMALLINT`，已由 009 放宽）；
  都可空，历史成员不受影响；
- **`tag` 字段保留**（官方 API 同步 / 按标签匹配的能力不丢，已有标签数据不会变脏），
  只是界面上「游戏标签」的展示位统一换成「大本营 X · 繁荣 Y」。

### 2. 后端改动

| 文件 | 改动 |
|---|---|
| `server/migrations/008_member_townhall_prosperity.sql` | **新增**：加两列（information_schema 判断，可重复执行） |
| `server/schema.sql` | 新装环境的两列 |
| `server/src/routes/members.routes.js` | `parseImportLine()` 解析识图格式；分类新增 `status_change` / `profile_change`；`/batch` 按 `apply` 开关应用改动；列表按繁荣度排序；create/update 接受两列 |
| `server/src/routes/meta.routes.js` | `/api/options` 返回 `town_hall` / `prosperity` |
| `server/src/lib/calc.js` | 排行榜行带上两列（排行榜与首页前三的次行用） |

**解析判定**：第 2 列是**正整数**（大本营等级，不设上限）**且** 第 3 列是 绿/红（含 `绿牌/红牌/正常/请假/0/1`）→ 识图格式；
否则回退旧格式（第 2 列当标签）。大本营填 0、繁荣度非数字都报「第 N 行: …」。
（初版按 1-16 校验，游戏开到 17 本后已删掉上限，见第 9 节。）

**分类口径**：

| 情况 | 归类 | 说明 |
|---|---|---|
| 库里没有这个名字 | `add` | 按识图数据建人（红牌自动记 red_since=当天） |
| 库里有但已归档（离开） | `restore` | 恢复并按数据更新 |
| 重名 + 牌子不同 | `status_change` | 带 `from_status → to_status` 与旧的大本营/繁荣度 |
| 重名 + 只有大本营/繁荣度不同 | `profile_change` | 文案如 `大本营 14 → 16 · 繁荣度 63 → 70` |
| 重名 + 完全一致 | `exists` | 幂等（重复导入不重复改） |
| 重名 + 只贴了昵称（无资料） | `conflict` | 维持旧口径「同名待确认」 |

**应用开关**：`POST /api/members/batch` 支持 `apply: { status_change, profile_change }`（不传 = 都应用）；
牌子变更由服务端记 `red_since`（转红=当天、转绿=清空）并写 `member_status_logs`（reason `批量导入改牌子`）；
响应带 `status_changed` / `profile_changed`。

### 3. 前端改动

- `member-import.vue`：格式说明加识图格式；预览新增「牌子变化 / 资料变化」两组卡片（含 `绿 → 红 x 人 · 红 → 绿 y 人`）；
  确认页两组**独立勾选（默认勾选）**；提交体带 `apply`；结果提示加「改牌子 / 改资料」条数
- `members.vue`：次行「大本营 14 · 繁荣 63」+ 按繁荣度降序（缺值最后）+ 纯数字关键词按大本营/繁荣度精确匹配
- `member-edit.vue`：游戏标签输入框 → 大本营等级 + 繁荣度（带范围校验）
- `entry.vue` / `ranking.vue` / `index.vue`：同样的次行资料展示

### 4. 验证

```bash
cd server && npm run test:e2e        # 413 PASS / 0 FAIL (386 → 413)
node .tool/import-page-flow.mjs      # 21 PASS / 0 FAIL (新增)
node .tool/entry-paste-flow.mjs      # 110 PASS / 0 FAIL (回归)
node .tool/star-paste-check.mjs      # 59 PASS / 0 FAIL (回归)
cd app && npm run build:h5
```

覆盖点：识图格式解析（红牌建人带 red_since）/ 繁荣度降序与缺值最后 / 重复导入幂等 /
牌子变化与资料变化分类 / 未勾选牌子则一人不改 / 勾选后转红转绿与 red_since / 审计留痕 /
越界 400 / `PUT /api/members/:id` 可改两列。

### 5. 上线步骤（本次实际执行）

```bash
tar -czf .e2e-logs/server-ocr.tgz -C server --exclude=node_modules --exclude=.env .
tar -czf .e2e-logs/h5-ocr.tgz -C app/dist/build/h5 .
# SHA256: server AF0404BF…D4CD / h5 B88B07F8…BDFD
scp .e2e-logs/{server,h5}-ocr.tgz .tool/deploy-ocr-import.sh root@<SERVER_IP>:/tmp/
bash /tmp/deploy-ocr-import.sh
```

```text
备份: db-before-ocr-2026-09-13-092915.sql.gz / server-…tgz / h5-…tgz
入口 js      : index-DH9Ou2TL.js → index-DtNw_dMX.js
导入页 chunk : …import.CAb9vouq.js → …import.sz9rvkXb.js (牌子变化/资料变化/默认勾选 都在)
成员页 chunk : pages-members-members.DoFi_pgk.js (含「繁荣」)
编辑页 chunk : pages-member-edit-member-edit.BCWnk9R5.js (大本营等级 / 繁荣度)
迁移 008     : town_hall / prosperity 已加, 重复执行幂等; 文件已放进服务器 migrations/
接口         : /api/health /api/members /api/options /api/ranking /api/dashboard 全 200
字段         : members 与 ranking 的 town_hall/prosperity 各 46 个; options 的 town_hall 46 个
权限         : 匿名 batch/preview/PUT 全 401; 访客全 403
业务数据     : 账号 4 / 成员 51 / 在部落 46 / 流水 28 / 转盘 11 / 结算 0 / 发奖 0 (前后一致)
未导入前     : town_hall/prosperity 已填人数 0/0, 「批量导入改牌子」审计 0 条
```

### 6. ⚠️ 本次踩的坑（顺序错误 + 修复）

`deploy-ocr-import.sh` 原第 2 步先跑迁移、第 3 步才解包后端 —— 但**迁移文件在压缩包里**，
`/opt/coc-points/server/migrations/008_…sql` 当时不存在 → 迁移没执行；而第 3 步已把**新代码**装上并重启，
新代码要 SELECT `town_hall`/`prosperity` → `/api/members`、`/api/options` 返回 **500**
（09:29:17 重启 → 09:29 修复，约 1 分钟内）。

**修复**（`.tool/fix-ocr-migration.sh`，已执行）：从 `/tmp/server-ocr.tgz` 单独取出迁移文件 → 执行 →
把迁移文件放进 `/opt/coc-points/server/migrations/`（与已有 001-007 一致）→ 复验接口全部 200。
加列的 DDL 不需要重启服务，接口立即恢复。

**教训**：加列迁移必须**先落到目标目录再执行**；凡「先迁移后换代码」的部署脚本，
都要先确认迁移文件已在服务器上（从包里抽出来，或单独放一个包）。脚本已按此修正。

### 7. 回滚

```bash
tar -xzf /var/backups/coc-points/server-before-ocr-2026-09-13-092915.tgz -C /opt/coc-points/server && systemctl restart coc-points
tar -xzf /var/backups/coc-points/h5-before-ocr-2026-09-13-092915.tgz -C /var/www/coc-points/h5
# 库: db-before-ocr-2026-09-13-092915.sql.gz; 新列可空且旧代码不 SELECT 它们, 不必删列
```

### 9. 修订：删掉大本营等级上限（2026-09-13 09:51 已部署）

初版把大本营限定在 `1-16`（当时游戏最高 16 本），游戏开到 17 本后这个上限就是错的 —— 按用户要求**直接删掉**。

- 后端 `parseTownHall()`：`n >= 1` 的整数即合法（`TH_MAX` 常量删除）；三处错误文案统一为「大本营等级需是不小于 1 的整数」
- 前端成员编辑页：输入框 `maxlength` 2 → 3，提示改为「例如 17（识图导入会自动填）」，校验只拦 `< 1`
- 列注释同步：`ALTER TABLE members MODIFY COLUMN town_hall … COMMENT '大本营等级(不小于1的整数, 不设上限)…'`（只改注释，类型仍是 `tinyint unsigned`，物理上限 255）
- `schema.sql` 与 `migrations/008_*.sql` 的注释一并更新
- E2E 断言相应调整：大本营 20 正常识别、`PUT` 99 允许写入、大本营 0 -> 400 → **415 PASS / 0 FAIL**

```text
备份: db/server/h5-before-nocap-2026-09-13-095139.*
入口 js      : index-DtNw_dMX.js → index-Cq0iUOr6.js
编辑页 chunk : pages-member-edit…BCWnk9R5.js → …Cy37qSpS.js (含「例如 17」, 旧「1 - 16」为 0)
后端         : 「不小于 1 的整数」4 处, TH_MAX 残留 0 处
接口/权限    : health|members|options 200, 匿名 PUT 401
业务数据     : 账号 4 / 成员 54 / 在部落 49 / 流水 28 / 转盘 11 (前后一致)
```

回滚：`tar -xzf /var/backups/coc-points/{server,h5}-before-nocap-2026-09-13-095139.tgz -C <对应目录>`（后端需 `systemctl restart coc-points`）。

### 10. 修订：删掉繁荣度上限（2026-09-13 09:58 已部署）

和大本营一样，繁荣度也被我写死过上限 —— 而且有**两处**：

| 位置 | 原值 | 现改 |
|---|---|---|
| 后端 `parseProsperity()` | `0 <= n <= 1000000` | 只校验 `n >= 0`（非负整数） |
| 数据库列 `members.prosperity` | `SMALLINT UNSIGNED`（上限 65535） | `INT UNSIGNED`（约 42.9 亿） |
| 错误文案 | 「繁荣度需是 0-1000000 的整数」 | 「繁荣度需是不小于 0 的整数」 |
| 前端编辑页 | `maxlength="7"` | `maxlength="10"`，提示补「都不设上限」 |

- 新迁移 `server/migrations/009_prosperity_widen.sql`：`SMALLINT` → `INT UNSIGNED`（information_schema 判断，幂等；
  顺带把 `town_hall` 的注释也统一成"不设上限"）。`schema.sql` 与 `migrations/008` 的列定义同步更新。
- E2E 断言相应调整：繁荣度 200000 正常识别、`PUT` 12345678 允许写入、`-5`/`-1` -> 报错 → **419 PASS / 0 FAIL**。
- 部署脚本 `.tool/deploy-prosperity-nocap.sh`（**这次先用 `tar -xzf … ./migrations/009_*.sql` 把迁移文件取出来再执行**，
  避免重演第 6 节那个顺序错误）；另外脚本里一行嵌套 `$( … | grep -c … )` 被 bash 判为引号不闭合而中断，
  已改成"再跑一次迁移、看列类型是否不变"的等价幂等校验。

```text
备份: db/server/h5-before-prnocap-2026-09-13-095829.*
迁移 009 : prosperity SMALLINT UNSIGNED → INT UNSIGNED (重复执行显示"已是更宽的类型, 跳过")
入口 js  : index-Cq0iUOr6.js → index-Co4sVSeG.js
编辑页   : …Cy37qSpS.js → …CMRlimrh.js (含「不设上限」)
后端     : 「繁荣度需是不小于 0 的整数」5 处, PROSPERITY_MAX 残留 0 处
接口/权限: health|members|options 200, 匿名 PUT 401
线上数据 : 账号 4 / 成员 56 / 已填大本营·繁荣度 49·49 / 繁荣度 35~148
```

回滚：`tar -xzf /var/backups/coc-points/{server,h5}-before-prnocap-2026-09-13-095829.tgz -C <对应目录>`（后端需重启）。
**列类型无需回退**：`INT UNSIGNED` 兼容旧代码，`SMALLINT` 能存的值它都能存。

### 11. 待真机确认

- 导入页：识图格式粘贴后，「牌子变化 / 资料变化」卡片与两个勾选框在手机上是否易读好点。
- 成员列表按繁荣度排序后，超期红牌提醒（橙色条）是否仍能被注意到（当前：繁荣度相同时超期优先）。
- 成员编辑页填大本营/繁荣度时，数字键盘与提示是否清楚（两者现在都不设上限）。

---

## 12. 本地开发环境与跨域部署（2026-09-13）

### 12.1 为什么本地"看不到服务器数据"——先把链路说清楚

```
本地 npm run dev:h5 (5173)  ──/api──▶  vite dev server 代理 ──▶  127.0.0.1:3000(本机后端)
                                                                      └──▶ 本机 MySQL(本地库)

线上 https://app.jiacheng.cyou ──/api──▶ nginx 反代 ──▶ 127.0.0.1:3000(服务器后端)
                                                              └──▶ 服务器 MySQL: coc_points
```

两个 `3000` 是**两台不同的机器**。服务器 `.env` 里的 `DB_HOST=127.0.0.1` 指的是服务器自己，
外部连不进来也不应该连。所以"本地打不开数据"不是接口写错，是本地那条链子根本没接上：

1. `app/src/utils/api.js` 的 `BASE` 是相对路径 `/api` → 请求发给**托管页面的那一方**；
2. `app/vite.config.js` 的代理目标是 `127.0.0.1:3000` → 本机后端，没起就是连接被拒；
3. 本机 `server/.env` 若不存在，后端会回落到 `127.0.0.1:3306` 的 `coc_app`（本机 MySQL 服务，与项目无关）。

### 12.2 本地开发三件套

```bash
cd server
npm run dev:db      # 1) 独立 MySQL 实例: 端口 33306, datadir .dev-mysql, 前台常驻
npm run dev         # 2) 后端       http://127.0.0.1:3000
cd ../app && npm run dev:h5   # 3) 前端  http://127.0.0.1:5173
```

- `scripts/dev-db.mjs`：首次自动 `mysqld --initialize-insecure` → 建库 → 建 `coc_app` → 导快照；
  `--reset` 重建库并重导，`--check` 干完活就退出。
- ⚠️ **本机必须设 `DB_TEXT_PROTOCOL=1`**（`server/.env`）：这台机器的 mysql2 二进制结果集协议有问题，
  `execute()` 带结果集（SELECT）会**静默挂起**。后端会卡在启动时的 `ensureSeeded()`，
  症状极具迷惑性——**进程活着、日志一行不输出、3000 端口一直不监听**，
  看着就像"本地项目连不上服务器数据"。打开该开关（`src/db.js` 会把 `pool.execute` 换成 `pool.query`）
  后立刻正常启动。E2E 编排器一直在传这个变量，只是从没进过开发用 `.env`。**生产不要设。**
- 不用本机 3306 那个 MySQL 服务，是为了不和机器上其它项目的数据混淆（那个实例的口令本项目也不知道）。
- ⚠️ **停止实例的坑（已修）**：Windows 上 `child.kill()` 有时只让 libuv 认为进程没了，
  `mysqld` 实际还在跑 → 数据目录被锁 → 下次 `rmSync` 失败 → 留下 `.e2e-mysql-<pid>-<ts>` 垃圾目录。
  现在统一走 `scripts/kill-tree.mjs` 的 `killTree()`（Windows 用 `taskkill /PID <pid> /T /F`）并
  轮询等端口释放。**同一个 bug 让 E2E 每跑一次就漏一个 mysqld**，本机一度堆了 38 个垃圾数据目录（已清）。

### 12.3 把生产数据拉到本地（只读，不碰线上）

```bash
cd server
npm run db:pull          # 远端只读 mysqldump → scp 下载 → 覆盖导入本地库
npm run db:pull -- --ai  # 顺带同步 AI 工坊图库文件到 .dev-ai-storage
```

- 快照落在 `.e2e-logs/dev-seed/coc-points-dev-seed.sql`（`.gitignore` 内）。
- **快照含 `users` 表的密码哈希**：本地可以用你的真实账号密码登录，但这份文件不要外传。
- `mysqldump` 不带 `--databases` 时产物里没有 `USE`，导入前必须自己 `USE coc_points`
  （`dev-db.mjs` 早期版本漏了这步，报 `No database selected`，已修）。

### 12.4 跨域部署（把打包产物放到任意域名/机器）

打包产物是**纯静态文件，没有代理层**：产物里 `BASE='/api'` 是相对路径，谁托管它请求就打给谁。
所以脱离 nginx 时必须二选一：

| 方案 | 做法 | 是否需要后端改配置 |
|---|---|---|
| **跨域直连** | 构建时 `VITE_API_BASE=https://后端域名`，后端 `CORS_ORIGINS=前端域名` | 需要 |
| **同源代理** | 用一个带 `/api` 代理的静态服务器托管产物（如另配一份 nginx） | 不需要 |

前端：

```bash
cd app
VITE_API_BASE=https://app.jiacheng.cyou npm run build:h5        # bash
$env:VITE_API_BASE='https://app.jiacheng.cyou'; npm run build:h5  # PowerShell
# 或写进 app/.env:  VITE_API_BASE=https://app.jiacheng.cyou
```

- 只写域名即可，`vite.config.js` 会自动补 `/api`（末尾斜杠也会去掉）；
- 接口地址**只有一个来源**：`src/utils/api-base.js` 导出的 `API_BASE`（`api.js` 与 `workshop-api.js` 都 import 它），
  由 `vite.config.js` 读 `app/.env` + 同名环境变量后以 `define` 注入为 `__API_BASE__`
  （**不依赖 uni-app 的 envDir** —— 它指向 `src`，把 `.env` 放项目根容易被无视）；
- 本地开发想直读线上数据，也可以用 `VITE_API_TARGET=https://app.jiacheng.cyou`（只影响 dev 代理，
  **写操作会真的落生产库**）。

后端（`server/.env`）：

```conf
CORS_ORIGINS=https://h5.example.com,http://localhost:8080   # 白名单
CORS_ORIGINS=*                                              # 任意来源
# 留空 = 关闭(默认; 线上同源部署不需要)
```

`server/src/lib/cors.js` 的两个关键点：

1. 中间件挂在 **`express.json` 和所有鉴权之前**：`OPTIONS` 必须在这里就 204 结束，
   否则会落到 app.js 里"非 GET 需管理员"那条规则上被拦成 401/403，浏览器直接判定跨域失败；
2. 只回显白名单来源 + `Vary: Origin`，**不返回 `Access-Control-Allow-Credentials`**
   （本项目用 `Authorization` 头，不用 Cookie；`*` 与 Credentials 也不能共存）。

### 12.5 本次验证（全部实测）

```text
E2E                : 429 PASS / 0 FAIL (原 419 + 新增 10 条 CORS 断言)
  ├ 白名单来源 GET 回显 Allow-Origin + Vary: Origin，无 Allow-Credentials
  ├ 未授权来源不下发 Allow-Origin(服务端照常 200, 浏览器自行拦)
  ├ OPTIONS /api/members -> 204(预检未被鉴权拦截) + Allow-Methods 含 POST + Allow-Headers 含 Authorization
  ├ 未授权来源 OPTIONS -> 403 且无跨域头
  └ 跨域来源匿名 POST /api/members -> 仍 401(跨域不放宽鉴权)
构建注入          : 默认 → 产物含 "/api"；VITE_API_BASE=https://app.jiacheng.cyou → 含 "https://app.jiacheng.cyou/api"；
                    用 app/.env 写 https://dev-check.example.com/ → 含 "https://dev-check.example.com/api"(补 /api + 去斜杠)；
                    三种情况 __API_BASE__ 字面量残留均为 0 (见 .tool/check-api-base.mjs)
本地库            : 导入生产快照后 members=56 行 / users=4 个账号 / 繁荣度最高 小羊(148, 大本营 18)
本地全链路        : 后端直连 3000 → 46 人在册、按繁荣度降序(小羊 148 居首)；
                    http://127.0.0.1:5173/api/members 经 vite 代理 → 200 同样 46 人；
                    /api/dashboard 返回真实周榜(本周 28 人录入 / 前三 经过·渴望·李烁尘)
前端回归          : sfc-check 0 失败 / vue-ctx-check 0 失败 / 14 个页面空数据渲染全过 /
                    star-paste 59 / entry-paste 110 / import-page 21 —— 全绿
进程泄漏          : 清理 38 个 .e2e-mysql-* 垃圾目录 + 2 个游离 mysqld；修复后 E2E 结束不再残留
```

> 本次**只改后端跨域能力与前端 API 基址注入，默认行为不变**：
> `CORS_ORIGINS` 留空 = 与改造前完全一致（连 `OPTIONS` 也照旧走后面的鉴权规则），
> 不配该变量的部署不需要重新构建前端。
> 线上若要启用跨域，需在 `/opt/coc-points/server/.env` 加 `CORS_ORIGINS=...` 后
> `systemctl restart coc-points`（不需要改 nginx）。

### 12.6 打包 App 发给别人（2026-09-13，不需要 CORS）

**关键认知：CORS 是浏览器的机制，不是网络的机制。**同一个后端，换个客户端规则完全不同：

| 交付形态 | 能拿到数据吗 | 需要 CORS 吗 |
|---|---|---|
| 原生 App（安卓/iOS） | ✅ 能 | ❌ **不需要**（原生网络栈没有"页面来源"） |
| 微信小程序 | 能，但要配小程序后台 request 合法域名白名单 | ❌ 不需要 |
| H5 网页发给别人 | ❌ 现在的状态拿不到 | ✅ **必须**（见 12.4） |
| 部署到同源（当前线上） | ✅ 能 | ❌ 不需要 |

实测证据（直接打线上，未启用 CORS 的情况下）：

```text
原生客户端式请求(不带 Origin 头)  -> 200 ok=true 46 人   ACAO: null
浏览器跨域式请求(带 Origin 头)    -> 200 ok=true 46 人   ACAO: null  ← 服务端照常返回, 但浏览器会拦
```

结论：**发 App 这条路，后端一行都不用改**。H5 那条路才需要 12.4 的 `CORS_ORIGINS`。

#### App 打包配置（已做）

- `app/vite.config.js` **平台感知**：`UNI_PLATFORM !== 'h5'` 时默认用
  `https://app.jiacheng.cyou/api`（`DEFAULT_NON_H5_API_BASE`），可用 `VITE_API_BASE` 覆盖。
  相对路径 `/api` 在 App 里没有页面来源可拼，打出来一定拿不到数据，所以不能沿用 H5 的默认值。
- **护栏**：非 H5 平台若最终算出相对地址，构建**直接失败**（实测 `VITE_API_BASE=/api npm run build:app` → exit 1），
  避免产出一个"装上就没数据"的哑巴包。
- 每次构建打印 `[api-base] platform=app base=https://app.jiacheng.cyou/api  (非 H5 默认值)`。
- `app/src/manifest.json`：`app-plus.distribute.android.permissions` 显式声明
  `INTERNET` + `ACCESS_NETWORK_STATE`（原为空数组），并确认进了产物 manifest。
- 首页「部落创作工坊」入口用 `<!-- #ifdef H5 -->` 包起来：工坊依赖 `fetch`/`Blob`/`FormData`/`canvas`，
  在 App 里只会看到"仅支持浏览器打开"，所以非 H5 直接不展示。

#### 实测（构建产物比对）

```text
npm run build:app → dist/build/app (41 文件)
  __API_BASE__ 字面量残留 0 | 含 "https://app.jiacheng.cyou/api" 的文件 1 个(app-service.js)
  含工坊入口文案 0 处 | 产物 manifest 里 INTERNET 权限已带上
npm run build:h5  → dist/build/h5 (47 文件)
  __API_BASE__ 字面量残留 0 | 含绝对地址 0 个(仍是同源 /api) | 含工坊入口 1 处
```

#### 出安装包 + 真机验证

```text
1) HBuilderX → 文件 → 导入 → 从本地目录导入 → 选 app/dist/build/app
2) 发行 → 原生App-云打包 → Android: 可用 DCloud 公共测试证书; iOS: 需 Apple 开发者证书
3) 装到手机上看三件事: 能否登录 / 首页有没有数据(接口地址是否生效) / 底部 tabBar 与安全区
4) 改版本号: app/src/manifest.json 的 versionName / versionCode
```

⚠️ **本项目尚未做过真机验证**（本机只有编译 + 产物比对）。已知待确认项：
应用图标未配置（HBuilderX 会用默认 uni 图标）、Android 包名/证书未定、
以及 App 端 tabBar 在刘海屏上的安全区表现。

> App 与 H5 分发的一个关键差别：App **直连线上 API**，后端改数据或改逻辑，
> 已发出去的 App 不需要重新打包（除非改了前端代码）；H5 则每次都要重新构建 + 传静态文件。

### 12.7 归档成员可见性修复（2026-09-13，**纯前端 · 未部署**）

**决定：只改本地源码保证 App 可用，网站暂不更新。**因此线上 H5 仍是旧行为（归档成员看不到），
只有重新打包的 App 带这个修复。这里记录清楚，避免以后有人以为线上已修。

问题与根因（两层，缺一不可）：

```text
成员页 load():
  1) GET /api/members            → 后端默认 "WHERE deleted_at IS NULL", 归档成员根本没返回
  2) .filter(m => !m.deleted_at) → 就算返回了, 前端又丢一次
结果: 归档成员从来没进过 members 数组 → 「离开」筛选永远为空, 只能靠批量导入页恢复
```

改动：

| 文件 | 改动 |
|---|---|
| `app/src/pages/members/members.vue` | 请求改 `/members?include_archived=1`；`normalizeMember` 加 `archived`；「离开」筛选 → 「归档」；卡片加「已归档」+ 归档日期；顶部指标加「已归档」+ 可点提示条；`selectedArchivedCount` / `selectedAllArchived`；批量确认文案提示恢复；全已归档时拦住重复归档 |
| `app/src/pages/member-edit/member-edit.vue` | 同样带 `include_archived=1`（原先见到 `deleted_at` 直接报「成员不存在或已被归档」→ 归档成员变可点后就是死链接）；加归档提示卡与恢复指引；已归档时隐藏「移除并归档此成员」 |

**关键：恢复不需要改后端。**`server/src/routes/members.routes.js` 第 612 行
`if (changes.status !== 2) sets.push('deleted_at = NULL')`，即"对归档成员设为绿牌/红牌 = 取消归档"，
线上早已部署。已只读核对确认：

```text
生产 GET /api/members              -> 46 人 (归档 0)
生产 GET /api/members?include_archived=1 -> 56 人 (归档 10)
线上后端源码含 deleted_at = NULL    -> 第 612 行(批量) / 第 413 行(批量导入恢复)
归档但 status != 2 的异常行          -> 0
```

也就是说这 10 名成员此前在 App 里是**完全不可见**的，现在能在成员页「归档」里看到。

验证：

```text
members-archive-flow.mjs       38 PASS / 0 FAIL
member-edit-archive-flow.mjs   18 PASS / 0 FAIL
其余前端回归                    star-paste 59 / entry-paste 110 / import-page 21 / 14 页渲染 / sfc / vue-ctx 全过
App 产物(dist/build/app)        含 include_archived=1(1 处) 与「该成员已归档」(1 处);
                                旧的「成员不存在或已被归档」残留 0 处; 接口基址仍是 https://app.jiacheng.cyou/api
```

> 测出来的一个测试自身 bug：请求桩里 `/members/batch-action` 也以 `/members` 开头，
> 先判 `startsWith('/members')` 会把批量动作的响应错写成成员列表 → 页面判成"响应格式异常"→
> `pending` 不清空 → 后续断言莫名失败。已把 `/members/batch-action` 的分支提到前面。

#### 12.7.2 永久删除（物理删除）接入 App（2026-09-13，纯前端）

需求：归档成员要能**彻底删掉**（此前 App 里只有"恢复"，没有真删除）。

**关键结论：不需要部署后端。** `DELETE /api/members/:id?purge=1` 线上早就有，只读核对过：

```text
线上 /opt/coc-points/server/src/routes/members.routes.js
  791: // 删除: 默认=归档(软删除, 保留历史积分/结算/发奖); ?purge=1 才是物理删除
  799:   const purge = String((req.query && req.query.purge) || '') === '1';
  801:   if (purge && !isSuperAdmin(req)) return fail(res, 403, '仅超级管理员可执行物理删除');
  805:   if (purge) { const r = await run('DELETE FROM members WHERE id = ?', [id]); ... }
```

⚠️ **代价**：`schema.sql` 里 5 张表对 `members(id)` 都是 `ON DELETE CASCADE` ——
`score_records`(142) / `weekly_results`(161) / `reward_logs`(179) / `wheel_spins`(205) /
`member_cosmetics`(222)。所以 `DELETE FROM members` 会**连带抹掉该成员的全部历史**，
而且这条分支**不写审计日志**（软删除那条才写 `member_status_logs`）。

App 侧因此做了三道保险：

| 保险 | 做法 |
|---|---|
| 权限 | 入口只在 `isSuperAdmin()` 为真时渲染；`purgeOne()` / `purge()` 内部再拦一次（后端还有独立 403） |
| 说清代价 | 点删除后先 `GET /api/records?member_id=X&limit=1` 拿到 `total`，把**真实条数**写进确认框：「同时会删掉 TA 的全部历史：17 条积分流水，以及结算快照、发奖记录、转盘记录、成员外观」；查不到条数时退化为模糊说法，**不阻断** |
| 两次确认 | 第一次说明删什么；第二次「真的要永久删除「X」吗？此操作不可撤销，也不能靠备份以外的任何方式找回。」**任一取消都不发请求** |

入口两处：

- 成员页 → 归档筛选 → 每个归档成员卡片右侧的红色「永久删除」；
- 成员编辑页（已归档状态）→ 红色「永久删除」区，并提示"只想让人离开名单的话，把状态改回绿牌即可恢复，不必删除"。

前端还会拦住"未归档就物理删除"（必须先归档）。⚠️ **这是前端策略，不是后端限制** ——
E2E 实测：对**未归档**的在册成员直接 `?purge=1`，后端**照样真删**（`purged: true`）。
后端只在"软删除"那条分支看 `deleted_at`；`purge` 分支不做任何状态判断。
所以这条前端保险是有价值的：它挡住了"误删还在部落的成员"。另外对不存在的成员，
后端是 **404 先于 403**（先查存在性再查超管）。

验证（真实 MySQL E2E 新增 14 条）：

```text
建成员 -> 录分(库里 1 条) -> 归档后流水仍在(归档与永久删除的分界)
-> 普通管理员 purge 403 / 匿名 401
-> 超管 purge 200 purged=true -> members 行数 0 且 score_records 行数 0(级联确实生效)
-> member_status_logs 审计不受级联影响仍保留 -> 重复 purge 404
-> 另建一人不归档直接 purge: 后端允许, 成员行 0(钉住真实行为)
-> 对不存在的成员, 404 先于权限判断
```

前端页面级：`members-archive-flow` 84 条（含"两次确认任一取消都不发请求""非超管调用不发请求"
"未归档成员删不掉"）、`member-edit-archive-flow` 30 条。

> 待办（需要部署才能做）：`purge` 分支目前**不留审计**。若要在删除前写一条
> `security_audit_logs`（记录操作人 + 被删成员昵称 + 流水条数），需要改后端并部署。

#### 12.7.3 永久删除留痕：改后端并已部署（2026-09-13 12:38）

上面那条待办已落地。改动只在一个函数里（`DELETE /api/members/:id` 的 purge 分支）：

```js
// 统计代价 -> 删除 -> 写安全审计, 三步在同一个事务里
const removed = await transaction(async (con) => {
  const countOf = ...;                       // score_records / weekly_results / reward_logs
  const cost = { ... };                      //   / wheel_spins / member_cosmetics
  const [del] = await con.execute('DELETE FROM members WHERE id = ?', [id]);
  if (!del.affectedRows) return null;
  await writeSecurityAudit({ actor: actorOf(req), action: 'purge_member',
    details: `永久删除成员「${cur.nickname}」(#${id}, 原状态 ${cur.status}); 连带删除 流水…/结算…/发奖…/转盘…/外观…`,
    ip: req.ip || '', con });
  return cost;
});
if (!removed) return fail(res, 404, '成员不存在');
return ok(res, { deleted: id, purged: true, removed });
```

为什么不写成"先写审计再删"：放进**同一事务**才能保证"要么删掉并留痕、要么整件事回滚"，
不会出现"删了但没记录"或"记了却没删成"。删成功后的响应里回传 `removed`，
App 用它把"实际连带删掉了什么"如实显示给用户。

**无数据库结构变更**（`security_audit_logs` 早已存在），所以只替换后端代码 + 重启。

部署记录（`.tool/deploy-purge-audit.sh`）：

```text
上线前 : systemd active; 成员 56 / 在部落 46 / 归档 10; 流水 28; 安全审计 62; purge_member 0
备份   : /var/backups/coc-points/coc_points-2026-09-13.sql.gz (12:38, 全库)
         /var/backups/coc-points/server-before-purgeaudit-2026-09-13-123818.tgz (133K)
覆盖   : purge_member 1 处 / writeSecurityAudit 2 处 / transaction 包裹 1 处; node --check OK
重启   : systemd active, listening on 127.0.0.1:3000, 日志无报错
冒烟   : health|members|members?include_archived|options 全 200; 匿名 DELETE ?purge=1 -> 401
上线后 : 成员 56 / 在部落 46 / 归档 10 / 流水 28 / 安全审计 62 —— 与上线前一致
```

**线上实测**（`.tool/verify-purge-audit-live.sh`：只造一个一次性临时成员，不碰任何真实成员；
token 用服务端自己的 `JWT_SECRET` + 现有超管信息现签，**不新建账号、不改任何密码**）：

```text
新建「部署验证-临时-123926」id=66 -> 录 1 条流水 -> 归档 -> 超管 purge
purge 响应: {"deleted":66,"purged":true,"removed":{"score_records":1,"weekly_results":0,
             "reward_logs":0,"wheel_spins":0,"member_cosmetics":0}}
库内核对  : 临时成员 0 行, 其流水 0 行
审计落库  : admin | purge_member | 永久删除成员「部署验证-临时-123926」(#66, 原状态 2);
            连带删除 流水1/结算0/发奖0/转盘0/外观0
收尾核对  : members 56→56, score_records 28→28, audit 62→63(只多这一条), 临时成员 0
线上 H5   : 入口 chunk 仍是 index-Co4sVSeG.js —— 本次**没有**动网站前端
```

回滚：`tar -xzf /var/backups/coc-points/server-before-purgeaudit-2026-09-13-123818.tgz -C /opt/coc-points/server && systemctl restart coc-points`
（无结构变更，不需要动数据库）。


#### 12.7.1 一轮反馈后的修订（同日，仍未部署）

| 反馈 | 处理 |
|---|---|
| 归档要能恢复 | 归档视图选中已归档成员后出现「恢复为绿牌（N 人）」→ `operation:'update', changes:{status:0}`，**只提交选中的归档成员**（同批在册的人不会被顺手改状态）；未选中时给出操作指引 |
| 「全部」标签没用 | 删除。**删之前先核对生产库："设为离开但未归档"的人 0 条**（这类人只会在「全部」里出现，删掉就会消失）；同时把「归档」口径放宽为 `archived \|\| status === 2` 兜住这个边界 |
| 新增/批量导入/批量管理全没了 | **不是代码被改坏**：三个按钮在 `v-if="canWrite"` 内，是管理员专属；未登录/会话失效时会静默消失（H5 与 App 都是这个逻辑）。现在访客态改为显示「只读模式 + 管理员登录」入口，不再让人误以为功能丢了 |
| 归档的恢复入口找不到 | 上一版只做了"批量恢复"，必须先进批量管理再勾选才出现，等于没有入口。现补 **卡片上的「恢复」按钮**（归档成员卡片右侧，点一下恢复这一个），归档视图的提示文案也写明两条路径 |

> **注意区分两种"删除"**（用户可能问的是后者）：
> - **恢复（取消归档）** = `operation:'update', changes:{status:0}` → 服务端清空 `deleted_at`，成员回到在部落。**已实现**，无损。
> - **永久删除（物理删除）** = `DELETE /api/members/:id?purge=1`，**仅超级管理员**，`DELETE FROM members`，
>   而 schema 里 `score_records / weekly_results / reward_logs / wheel_spins / member_cosmetics`
>   对 `members(id)` 都是 **`ON DELETE CASCADE`** → 会连带删掉该成员的**全部历史**（积分流水、结算快照、
>   发奖记录、转盘记录、外观），且**不可逆、不写审计**。App 里**有意没有暴露**这个入口，要用需先确认。

> **排查记录**：这条反馈的现场是"5173 页面能开、`/api/*` 全 500"。原因是停本地服务时
> **HBuilderX 启动的 dev server 不在我的 job 列表里**，我把后端(3000)与开发库(33306)停了，
> 前端却还活着 → 所有页面读不到数据。这与 `child.kill()` 漏杀 mysqld 是同一类问题：**杀掉外壳，子进程还在**。
> 处置：重启后端 + 开发库（`npm run dev:db` / `npm run dev`），**不要**去停 HBuilderX 的 dev server（那是用户在用的）。
> 线上网站全程未动（入口 chunk 仍是 `index-Co4sVSeG.js`，`/api/members` 200 / 46 人）。

```text
验证: members-archive-flow 62 PASS | member-edit-archive-flow 18 PASS
      star-paste 59 | entry-paste 110 | import-page 21 | 14 页渲染 | sfc | vue-ctx  全过
      check-app-bundle.mjs(新)      10 项产物断言全过(含 3 项"旧代码必须为 0 处")
      dev-server-page-check.mjs(新) 运行中的 dev server 能编译改动页面, 且已在提供新代码
```

### 12.8 访客可用「转盘每日奖励 + AI 绘画」，创作工坊进 App（2026-09-13 13:19 已部署后端）

**需求**：App 端要能原生用 AI 绘画；访客（未登录）也要能用「转盘每日奖励」和「AI 绘画」；
只改 App 端、不再维护网站。

**结论：这两件事 App 端改不动，必须动后端两个开关**（已确认后按"最小改动"执行）：

| 现象 | 根因 | 改动 |
|---|---|---|
| 访客抽不了每日奖励 | `routes/wheel.routes.js` 本身没有鉴权，但 `app.js` 的全局规则「`/api` 下非 GET/HEAD 一律 `requireAdmin`」把它拦成 403 | `app.use('/api/wheel', wheelRouter)` 挪到该规则**之前**（2 行） |
| 访客画不了图 | `modules/ai-workshop.js:425` `canCreate: !isGuest` 写死匿名访客不能生成 | `canCreate: true` |
| "按 IP 限制"只做了一半 | `ipKey` 只用于图库上传（`ip_key` + `MAX_PER_IP`）；生成额度按 `actorKey`，而所有非管理员共用 `hmac('actor:shared-viewer')` → "每天 10 次"其实是全站一个池子 | 非管理员身份键改为 `hmac('actor:ip:'+ip)`，每日额度判断自动变成"每 IP 每天 N 次"（**无需迁移**） |
| `local_namespace` 不能跟着 IP | 客户端拿它给"本机图库"分区；手机上换网络就换 IP，会显得"图丢了" | 单独由 `namespaceKey = hmac('actor:shared-viewer'\|'shared-admin')` 提供（跨网络稳定） |

**兼容性**：非管理员的 `local_namespace` 新旧值都是 `hmac('actor:shared-viewer')`（管理员都是 `shared-admin`），
所以线上现存 H5 用户的本地图库分区键**没有变化**，不会因为这次后端上线而"丢图"。

**本次实际执行**（`.tool/deploy-guest-ai.sh`）：

```bash
# 本机: 只打包两个改动文件
cd server && tar -czf ../.e2e-logs/server-guest-ai.tgz src/app.js src/modules/ai-workshop.js
scp .e2e-logs/server-guest-ai.tgz .tool/deploy-guest-ai.sh root@<SERVER_IP>:/tmp/
ssh root@<SERVER_IP> 'bash /tmp/deploy-guest-ai.sh'   # 备份后端 -> 覆盖(不 strip) -> 语法自检 -> 重启 -> 冒烟
```

- 备份：`/var/backups/coc-points/server-before-guestai-2026-09-13-131944.tgz`（145K，无结构变更故不导库）
- 覆盖前后特征对比：`wheel` 挂载行 **76 → 70**、管理员规则行 **67 → 75**（前置生效）；
  `canCreate: !isGuest` **1 → 0**；`canCreate: true` **0 → 1**；`namespaceKey` **0 → 2**

**上线验证（全部匿名只读，不写业务数据）**：

```text
GET  /api/health                                  -> 200
GET  /api/members                                 -> 200
匿名 GET  /api/ai-workshop/config                 -> 200 {"can_create":true,"role":"guest","daily_limit":10,...}
匿名 POST /api/ai-workshop/jobs (非法 client_token) -> 400  (此前 403「当前角色不能生成图片」)
匿名 POST /api/wheel/spin (member_id=999999)      -> 404  (此前 403；不存在成员, 未写任何数据)
匿名 POST /api/members                            -> 401  (其它写操作没被顺手放开)
GET  /api/wheel/status?member_id=15               -> 200
上线前后业务数据一致: 成员 46 / 流水 51 / 审计 77 / 转盘 4 / AI 任务 10
```

> 线上 `AI_VIEWER_DAILY_LIMIT=10`、`AI_VIEWER_UPLOAD_DAILY_LIMIT=10`、`AI_GLOBAL_DAILY_LIMIT=2000`
> → 访客/非管理员实际是 **每 IP 每天 10 张生成 + 10 张上传**，另有全站 2000 张兜底。

**App 侧（`npm run build:app`，打的是生产接口，所以后端必须先上线）**：
首页创作工坊入口拆掉 `#ifdef H5`；`utils/workshop-api.js` 改成 uni.request / `uni.downloadFile` /
`uni.uploadFile` / 相册保存；`utils/workshop-db.js` 在 App 用 `uni.saveFile` + JSON 索引；
新增 `utils/workshop-payload.js` 收口图片载荷；`manifest.json` 补相册权限。详见 README 变更记录。

**回滚**：

```bash
tar -xzf /var/backups/coc-points/server-before-guestai-2026-09-13-131944.tgz -C /opt/coc-points/server
systemctl restart coc-points        # 无结构变更, 不需要动数据库
```

**⚠️ 真机未验证**：`uni.downloadFile` / `uni.saveFile` / `uni.uploadFile` / `uni.saveImageToPhotosAlbum` /
`plus.nativeObj.Bitmap` 转 jpg 只能在真机上验；本地只能保证"编译通过 + 产物断言 + 服务端接口正确"。
真机首次跑通后重点看：生成完成后图片能否显示、本机图库重启后是否还在、上传部落图库是否成功、
「保存到相册」在安卓/iOS 的表现。

本地已加两道护栏（都不需要浏览器/真机）：

```text
node .tool/wheel-guest-flow.mjs     # 21 PASS  转盘页: 只读门禁删干净 + 访客真能抽 + 该拦的仍拦住
node .tool/workshop-app-flow.mjs    # 61 PASS  工坊 App 适配层: 按 App 条件编译剥源码 + 内存文件系统跑通全流程
node .tool/check-app-bundle.mjs     # 21 项     App 产物里该在的在、该没的没
node .tool/check-block-usage.mjs    # 静态规则   <block> 必须带指令(裸 <block> 会被编译成 <template> 吞内容)
node .tool/browser-page-check.mjs   # 28 PASS   headless Chrome 真渲染巡检 6 个页面(需要 5173 dev server 在跑)
```

### 12.9 事故：「每日奖励转盘不见了」——裸 `<block>` 被编译成 `<template>`（2026-09-13，纯前端）

**现象**：转盘页只剩头部 + 页脚，**整块每日奖励（成员卡 / 转盘 / 奖励池）不渲染**。

**根因**：12.8 的前端改动里，为了缩进好看，在 `<block v-if="mode === 'daily'">` 里又套了一层
**不带指令的裸 `<block>`**：

```html
<block v-if="mode === 'daily'">
  <block>              <!-- ← 这一层是元凶 -->
    ...成员卡 + 转盘...
  </block>
</block>
```

本项目其它页面的 `<block>` 都带 `v-if/v-else/v-else-if`，编译器产出 **Fragment**；而这层裸 `<block>`
让**外层**被编译成真实的 `<template>` 元素 —— `<template>` 的子节点是**惰性内容**，浏览器不渲染。

**证据（headless Chrome `--dump-dom`）**：

```text
坏: <template> 1 个, uni-view 28 个, member-card/draw-card/wheel-face 全为 0   → 页面空白
好: <template> 0 个, uni-view 176 个, 8 个扇区与两张卡片都在                    → 正常
线上旧构建: <template> 0 个, 只读卡片可见（所以线上当时看着是"对的"，更难发现）
```

**为什么测试没拦住**：`page-null-render` / `sfc-check` / `vue-ctx` / 内存桩流程测试都在 Node 里跑，
`<block>` 在 Node 里只是普通元素、子节点照常渲染；**只有真浏览器会暴露**。

**修复**：删掉那层裸 `<block>`（`app/src/pages/wheel/wheel.vue`），并还原被改乱的缩进。

**新增护栏（都在本地，不需要真机）**：

```bash
node .tool/check-block-usage.mjs    # 静态: <block> 必须带 v-if/v-else/v-else-if/v-for, 裸 <block> 直接 FAIL
node .tool/browser-page-check.mjs   # 浏览器: 6 个页面断言 DOM 无 <template> + uni-view 数达标 + 关键文案可见
```

`browser-page-check.mjs` 依赖 HBuilderX 的 dev server（默认 `http://127.0.0.1:5173`，它带 `/api` 代理），
换 URL 也可以：`node .tool/browser-page-check.mjs http://127.0.0.1:5173`。
另外 `.tool/serve-dist.mjs <dir> <port>` 可以给 `uni build` 产物起个静态服务器，便于对构建产物截图核对。

**未改动线上**：按你的要求网页不动（线上仍是 09-13 之前的构建，非管理员在那里看不到转盘）。

### 12.10 东方幻境：自己写提示词也能生成 + 默认服装（2026-09-13，纯前端 / 未部署）

**问题**：东方幻境下不点「将设定整理成提示词」、直接在「最终提示词」里写内容时，「开始生成」恒为灰。

**根因**：`orientalNeedsApply` 只看 `orientalConfigRevision !== orientalAppliedRevision`，
而切到东方幻境时 `orientalAppliedRevision = -1` 且提示词被清空 —— 状态里没有任何字段表示
"用户已经自己写了提示词"。

**修复**（`app/src/pages/workshop/workshop.vue`）：

| 位置 | 改动 |
|---|---|
| `data` | 新增 `promptSource: ''`（`''` / `'generated'` / `'manual'`） |
| 最终提示词 `textarea` | 挂 `@input="onPromptEdited"`（uni 的 textarea 确实会派发 `input`，见 `uni-h5` 里 `trigger("input", ...)`） |
| `orientalNeedsApply` | 追加 `&& this.promptSource !== 'manual'` |
| `applyOrientalPrompt` | 整理后 `promptSource = 'generated'`（此后改设定仍需重新整理，原护栏不变） |
| `switchCreationMode` | 连同提示词一起清空 `promptSource` |
| 提示文案 | 「设定尚未应用：可点上方的「整理提示词」，也可以直接在下面自己写提示词。」 |

**默认服装**：`app/src/utils/oriental-prompt.js` 新增 `DEFAULT_ORIENTAL_OUTFIT` 并作为
`createOrientalForm().outfit` 的默认值。两处格式处理是必须的：去掉首尾 `【】`（`cleanField` 会抹掉，
留着会让输入框与实际提示词不一致）、去掉末尾句号（否则与皮肤段拼出「。，」）。实测 82 字。

**验证**：

```bash
node .tool/workshop-oriental-flow.mjs   # 32 PASS / 0 FAIL
# 对照实验: 临时移除 promptSource 判断 -> 27 PASS / 5 FAIL（正是"开始生成"那几条）
node .tool/check-app-bundle.mjs         # 25 项（新增默认服装/promptSource/onPromptEdited 进包）
node .tool/browser-page-check.mjs       # 28 PASS（需要 5173 dev server）
```

**部署状态**：纯前端，**未部署**（网页不维护）；App 重新打包即可带上。

### 12.11 部落转盘「随机抽人」新增自选成员（按本周分数分组）（2026-09-13，纯前端 / 未部署）

**需求**：每周奖励只有 1 份，但经常多人同分 —— 要能从"排名靠前、分数相同的那几个人"里抽一个。
所以自选面板**按本周排行榜分数分组**，同分的一组，点分数那一行可整组选中。

**实现要点**（`app/src/pages/wheel/wheel.vue`）：

```text
data       pickMode: 'scope' | 'custom'     参与名单来源
           pickedIds: []                     自选成员的 id 数组
           scoreRows / scoreLoading / scoreError / scoresLoaded
computed   scopedMembers  分组口径(原 funMembers 的逻辑)
           pickGroups     周榜按 total 降序分组, 同分合并, 带 from/to 名次区间
           pickedMembers  pickGroups 展平后按 pickedIds 过滤(顺序跟着分数走)
           funMembers     pickMode === 'custom' ? pickedMembers : scopedMembers
           pickTotal / funCaption / funEmptyTip
methods    switchPickMode(切到自选时首次拉分数) / loadScores(可手动刷新, 并丢弃陈旧勾选)
           togglePick(id) / toggleGroup(group) / pickAll / clearPicks / isPicked / isGroupPicked
模板       头部「按分组 / 自选成员」开关; 自选面板(已选 N/M + 刷新/全选/清空 + 分数分组 + 成员卡片)
```

**关键点**：`runFun()` **没有改动** —— 抽取逻辑只认 `funMembers`，两种来源在那里合流；
拿不到周榜时 `pickGroups` 退化成"未分组"一份名单（用 `/members`），照样能选人抽人，并如实提示失败原因；
`onShow` 时若停在自选标签会刷新分数（结算前还在录分，用旧分数会选错人）。

**验证**：

```bash
node .tool/wheel-fun-pick-flow.mjs   # 77 PASS / 0 FAIL  逻辑(含"只从勾选名单里抽"的确定性验证)
node .tool/wheel-fun-ui-check.mjs    # 18 PASS / 0 FAIL  真浏览器+真点击(CDP): 切标签/整组选中/清空/无横向溢出
node .tool/check-app-bundle.mjs      # 31 项             产物断言
node .tool/browser-page-check.mjs    # 28 PASS           页面级渲染巡检
```

`wheel-fun-pick-flow.mjs` 里最关键的一条：只勾并列第一那组里的两个人时，把 `Math.random` 固定成
`0` / `0.999999`，抽中的**正好是这两个人**（而不是榜上排最前的小羊）—— 证明抽取被限制在勾选名单内。

**新增通用工具** `.tool/cdp-run.mjs`：headless Chrome + CDP 驱动，支持按顺序执行
`{click}/{clickText}/{js}/{shot}/{wait}` 步骤、读计算后的布局、输出 JSON 结果。
`--steps=<json>` + `--out=<json>` 就能写成可断言的 UI 测试（`wheel-fun-ui-check.mjs` 就是这么用的）。
注意里面的一个坑：**headless 的 `--window-size` 不等于页面 CSS 视口**（实测 `--window-size=430` 时
`innerWidth` 是 512），必须用 `Emulation.setDeviceMetricsOverride` 覆盖，否则"布局按 512 排、截图只有 430 宽"，
看起来像右侧被切掉。

`workshop-app-flow.mjs` 特别覆盖了 `uni.saveFile` 的**移动**语义（临时文件会消失、载荷路径必须回写成
持久路径、重试不能对已不存在的临时路径再搬一次）—— 这是本次最容易写错、又最难在真机上定位的一处。

---

## 附：产物版本对照（回滚用）

本机 `.e2e-logs/` 保留了每次部署的打包产物（均为 tar.gz，解包到对应目录即可回滚）。

| 产物 | 对应版本 | 回滚方式 |
|---|---|---|
| `h5-prnocap.tgz` | **当前线上前端**：繁荣度去掉上限（编辑页提示「不设上限」） | 解包覆盖 `/var/www/coc-points/h5/` |
| `server-guest-ai.tgz` | **当前线上后端**：访客可用转盘每日奖励 + AI 绘画（只含 `src/app.js` 与 `src/modules/ai-workshop.js`，无迁移） | 解包到 `/opt/coc-points/server`（**不加 `--strip-components`**）后 `systemctl restart coc-points`；完整回滚见 §12.8 的备份 |
| `server-prnocap.tgz` | **当前线上后端**：繁荣度只要求非负整数（无上限）+ 迁移 009 | 解包覆盖 `/opt/coc-points/server` 后 `systemctl restart coc-points` |
| `h5-nocap.tgz` | 上一版前端：大本营等级去掉 1-16 上限（编辑页提示「例如 17」） | 解包覆盖 `/var/www/coc-points/h5/` |
| `server-nocap.tgz` | 上一版后端：大本营只要求不小于 1 的整数（无上限） | 解包覆盖 `/opt/coc-points/server` 后 `systemctl restart coc-points` |
| `h5-ocr.tgz` | 上一版前端：识图导入页（牌子变化/资料变化勾选）+ 成员列表繁荣度排行 | 解包覆盖 `/var/www/coc-points/h5/` |
| `server-ocr.tgz` | 上一版后端：识图格式解析 + 牌子/资料变化应用 + 繁荣度排序（迁移 008） | 解包覆盖 `/opt/coc-points/server` 后 `systemctl restart coc-points` |
| `h5-entry-bottom.tgz` | 上一版前端：弹层底边让出 tabBar（确认按钮不再被导航栏盖住） | 解包覆盖 `/var/www/coc-points/h5/` |
| `h5-star-paste2.tgz` | 上一版前端：弹层层级修复（1000→900/850）+ 「快速切换」候选 | 解包覆盖 `/var/www/coc-points/h5/` |
| `h5-star-paste.tgz` | 上一版前端：录入页「粘贴星数名单」首次上线（层级仍是 1000） | 解包覆盖 `/var/www/coc-points/h5/` |
| `server-star-paste.tgz` | **当前线上后端**：`/api/options` 补 `tag`（无迁移） | 解包覆盖 `/opt/coc-points/server` 后 `systemctl restart coc-points` |
| `h5-batch5.tgz` | 上一版前端：首页创作工坊入口 + 东方幻境（含尺寸选择） | 解包覆盖 `/var/www/coc-points/h5/` |
| `server-batch5.tgz` | **批次 5 后端**：AI 工坊（生图任务/图库/配额） | 解包覆盖 `/opt/coc-points/server` 后 `systemctl restart coc-points`（需先 `npm install` 装 multer/sharp） |
| `h5-admin-delete.tgz` | **当前线上前端**：管理员管理页新增「删除账号」+ 临时密码「复制」（含此前全部改动；导入页官方同步入口由 `cocModeEnabled=false` 隐藏） | 解包覆盖 `/var/www/coc-points/h5/` |
| `server-admin-delete.tgz` | **当前线上后端**：`DELETE /api/admin/users/:id` + CLI `user:delete`（无迁移） | 解包覆盖 `/opt/coc-points/server` 后 `systemctl restart coc-points` |
| `h5-import-fix.tgz` | 上一版前端：批量导入页渲染修复（含工坊/转盘/排行等此前全部改动） | 解包覆盖 `/var/www/coc-points/h5/` |
| `server-coc.tgz` | 上一版后端：官方 API 成员同步（`/api/coc/*` + CLI + 桩服务）；后续部署已在其上叠加 `/api/coc/lookup` 与 `auto_add` | 解包覆盖 `/opt/coc-points/server` 后 `systemctl restart coc-points` |
| `h5-workshop.tgz` | 上一版前端：部落创作工坊页美化（含上述报错） | 同上 |
| `h5-wheel.tgz` | 上一版前端：部落转盘页美化（幸运屋 / 灯珠转盘 / 幸运点名台） | 同上 |
| `h5-ranking.tgz` | 上一版前端：排行榜页美化（荣誉榜头部 / 筛选卡 / 金银铜列表） | 同上 |
| `h5-entry-picker.tgz` | 上一版前端：录入页优化（三步引导 + 选人弹层 + 快捷数量后端化） | 同上 |
| `server-entry-picker.tgz` | **当前线上后端**：`quick_values` 快捷数量（迁移 007）+ `/api/rules`、`/api/options` 返回数组 | 解包覆盖 `/opt/coc-points/server` 后 `systemctl restart coc-points` |
| `h5-home-beautify.tgz` | 上一版前端：首页美化版（品牌头部 / 本周概览 / 常用功能 / 本周前三） | 同上 |
| `h5-accounts.tgz` | 上一版前端：账号体系（美化登录页 / 设置页账号与安全 / 改密 / 管理员管理） | 同上 |
| `server-accounts.tgz` | **当前线上后端**：users 账号体系 + 公开只读层 + /api/admin/* + 审计操作人（迁移 006） | 解包覆盖 `/opt/coc-points/server` 后 `systemctl restart coc-points` |
| `h5-member-mgmt.tgz` | 上一版前端：成员管理页重写（红牌计时 + 批量操作 + 归档） | 解包覆盖 `/var/www/coc-points/h5/` |
| `server-member-mgmt.tgz` | 上一版后端：`red_since`/`deleted_at` + `/batch-action` + 归档语义（迁移 005） | 同上 |
| `h5-member-import.tgz` | 上一版前端：批量导入页三步流程 | 解包覆盖 `/var/www/coc-points/h5/` |
| `h5-settings.tgz` | 再上一版：设置页优化（身份卡 + 三面板） | 同上 |
| `h5-entry-compact.tgz` | 再上一版：紧凑布局录入页（第二轮）+ 旧设置页 + 旧导入页 | 同上 |
| `h5-entry-adapt.tgz` | 录入页第一轮（外部优化版 44KB） | 同上 |
| `h5-batch4.tgz` | 批次 4 前端（分项榜 / 转盘 / 批量导入，录入页为改造前版本） | 同上 |
| `h5-batch3.tgz` / `h5-batch2.tgz` / `h5-batch1.tgz` | 前几批次的前端快照 | 同上 |
| `server-entry-adapt.tgz` | **当前线上后端**：含 `total_delta` / 离开成员校验 / 批次号复用 409 / 单事务写入 | 解包覆盖 `/opt/coc-points/server` 后 `systemctl restart coc-points` |
| `server-batch4.tgz` | 批次 4 后端（转盘 + 批量导入） | 同上 |
| `server-batch3.tgz` / `server-batch2.tgz` | 批次 3 / 批次 2 后端 | 同上 |

注意事项：

- 回滚 H5 **不需要**重载 nginx（纯静态覆盖）；回滚后端**必须** `systemctl restart coc-points`。
- 后端包**不含** `node_modules/` 与 `.env`，覆盖不会影响依赖与密码配置。
- 数据库回滚不是"覆盖备份"那么简单：结构变更用 `migrations/` 正向脚本记录，回滚 SQL 见各批次附录的「回滚方式」；数据层请用 `/var/backups/coc-points/` 的 dump 并结合当日业务数据判断，避免丢掉已产生的积分。
- 覆盖前建议先备份当前线上产物：`tar -czf /tmp/h5-before-rollback.tgz -C /var/www/coc-points/h5 .`
