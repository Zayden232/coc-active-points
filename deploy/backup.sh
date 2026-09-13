#!/usr/bin/env bash
# 每日备份 coc_points 库 (与 Typecho 库完全分离)
# 放入 crontab: 0 3 * * * /opt/coc-points/backup.sh
set -euo pipefail

DB="coc_points"
BACKUP_DIR="/var/backups/coc-points"
DATE="$(date +%F)"
RETENTION_DAYS=30
CNF="/root/.coc-points.cnf"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$CNF" ]; then
  echo "缺少 $CNF (chmod 600, 内容见部署手册)" >&2
  exit 1
fi

mysqldump --defaults-extra-file="$CNF" --no-tablespaces "$DB" > "$BACKUP_DIR/${DB}-${DATE}.sql"
gzip -f "$BACKUP_DIR/${DB}-${DATE}.sql"
find "$BACKUP_DIR" -name "${DB}-*.sql.gz" -mtime +"$RETENTION_DAYS" -delete

echo "backup ok: $BACKUP_DIR/${DB}-${DATE}.sql.gz"
