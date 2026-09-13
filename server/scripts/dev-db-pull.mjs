// ============================================================
// 一条命令把生产数据拉到本地开发库(本地开发用)
//
// 用法(在 server/ 目录下):
//   npm run db:pull            拉快照 → 覆盖导入本地开发库
//   npm run db:pull -- --dry   只拉快照, 不导入
//   npm run db:pull -- --ai    顺带把 AI 工坊图库文件也拉下来
//
// 说明:
//   - 生产只跑一条只读的 mysqldump(--single-transaction), 不写任何生产数据;
//   - 拉回来的快照含 users 表(密码哈希), 因此 ./e2e-logs/ 已在 .gitignore 内, 别外传;
//   - 走 ssh 密码登录, 复用 .tool/askpass.cmd(仅本机开发环境存在)。
// ============================================================
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const WORKSPACE = path.resolve(SERVER_DIR, '..');
const TOOL = path.join(WORKSPACE, '.tool');

// 生产机器地址不写进仓库: 放在 gitignore 掉的 server/.env 里, 例如
//   DEV_SSH_HOST=your-server-ip
//   DEV_SSH_USER=root
const HOST = process.env.DEV_SSH_HOST || '';
const USER = process.env.DEV_SSH_USER || 'root';
const REMOTE_SQL = '/tmp/coc-points-dev-seed.sql';
const SEED_DIR = path.join(WORKSPACE, '.e2e-logs', 'dev-seed');
const SEED = path.join(SEED_DIR, 'coc-points-dev-seed.sql');
const AI_DIR = path.join(WORKSPACE, '.dev-ai-storage');

const aiToo = process.argv.includes('--ai');
const dry = process.argv.includes('--dry');

const ASKPASS = path.join(TOOL, 'askpass.cmd');
if (!HOST) {
  console.error(
    '[db:pull] 缺少 DEV_SSH_HOST。请在 server/.env 里加上你的服务器地址(该文件不会进仓库), 例如:\n' +
      '  DEV_SSH_HOST=your-server-ip\n' +
      '  DEV_SSH_USER=root'
  );
  process.exit(1);
}
if (process.platform === 'win32' && !existsSync(ASKPASS)) {
  console.error(`[db:pull] 找不到 ${ASKPASS}, 无法非交互登录; 请改用 scp 手动拉取`);
  process.exit(1);
}

const SSH_OPTS = [
  '-o', 'StrictHostKeyChecking=no',
  '-o', `UserKnownHostsFile=${path.join(process.env.TEMP || '/tmp', 'dsh_known_hosts_blct')}`,
  '-o', 'PreferredAuthentications=password',
  '-o', 'PubkeyAuthentication=no',
  '-o', 'NumberOfPasswordPrompts=1',
  '-o', 'ConnectTimeout=15',
];

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (process.platform === 'win32') {
      env.SSH_ASKPASS = ASKPASS;
      env.DISPLAY = 'localhost:0';
    }
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}`))));
  });
}

const DUMP_CMD = [
  'set -e',
  '. /opt/coc-points/server/.env',
  `mysqldump --single-transaction --quick --skip-lock-tables --default-character-set=utf8mb4 \\`,
  `  --no-tablespaces --set-gtid-purged=OFF --column-statistics=0 \\`,
  `  -h "${'${DB_HOST:-127.0.0.1}'}" -P "${'${DB_PORT:-3306}'}" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" > ${REMOTE_SQL}`,
  `wc -c < ${REMOTE_SQL}`,
].join('\n');

async function main() {
  mkdirSync(SEED_DIR, { recursive: true });
  console.log(`[db:pull] 远端导出(只读): ${USER}@${HOST}:/opt/coc-points/server/.env → ${REMOTE_SQL}`);
  await run('ssh', [...SSH_OPTS, `${USER}@${HOST}`, DUMP_CMD]);

  console.log(`[db:pull] 下载到 ${SEED}`);
  await run('scp', [...SSH_OPTS, `${USER}@${HOST}:${REMOTE_SQL}`, SEED]);

  const bytes = statSync(SEED).size;
  console.log(`[db:pull] 快照 ${(bytes / 1024).toFixed(1)} KB`);

  if (aiToo) {
    mkdirSync(AI_DIR, { recursive: true });
    console.log(`[db:pull] 同步 AI 图库文件 → ${AI_DIR}`);
    await run('scp', [...SSH_OPTS, '-r', `${USER}@${HOST}:/opt/coc-points/ai-storage/.`, AI_DIR]);
  }

  if (dry) {
    console.log('[db:pull] --dry: 未导入。要导入请执行: npm run dev:db:reset');
    return;
  }

  console.log('[db:pull] 导入本地开发库(会先删除本地 coc_points) ...');
  await run(process.execPath, [path.join(SERVER_DIR, 'scripts', 'dev-db.mjs'), '--reset', '--check']);
  console.log('[db:pull] 完成');
}

main().catch((e) => {
  console.error('[db:pull] 失败:', e.message);
  process.exit(1);
});
