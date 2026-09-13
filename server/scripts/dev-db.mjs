// ============================================================
// 本地开发数据库: 独立 MySQL 实例(与生产同结构、可选导入生产数据快照)
//
// 为什么不用本机已有的 MySQL 服务(3306)?
//   那个实例的 root 口令未知、且可能混用其它项目的数据; 这里沿用 E2E 的做法,
//   用**独立 datadir + 独立端口**跑一个只属于本项目的实例, 随时可删可重建。
//
// 用法(在 server/ 目录下):
//   npm run dev:db          启动(前台常驻, Ctrl+C 停止实例) + 首次自动建库/导数据
//   npm run dev:db:reset    丢弃本地库, 重新导入 .e2e-logs/dev-seed/*.sql
//   npm run dev:db:check    只检查/补齐(不占用前台), 适合脚本调用
//
// 环境变量:
//   DEV_MYSQL_PORT(默认 33306)  DEV_DATADIR(默认 <工作区>/.dev-mysql)
//   DEV_DB_PASSWORD(默认 cocDevPass2026)  DEV_SEED(默认 .e2e-logs/dev-seed/coc-points-dev-seed.sql)
//   E2E_MYSQLD 显式指定 mysqld 绝对路径
// ============================================================
import { spawn } from 'node:child_process';
import { createConnection } from 'mysql2/promise';
import { readFileSync, existsSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import path from 'node:path';
import { killTree, waitPortFree } from './kill-tree.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const WORKSPACE = path.resolve(SERVER_DIR, '..');

const PORT = Number(process.env.DEV_MYSQL_PORT || 33306);
const DB_NAME = 'coc_points';
const DB_USER = 'coc_app';
const DB_PASSWORD = process.env.DEV_DB_PASSWORD || 'cocDevPass2026';
const DATADIR = path.resolve(process.env.DEV_DATADIR || path.join(WORKSPACE, '.dev-mysql'));
const SEED = path.resolve(
  process.env.DEV_SEED || path.join(WORKSPACE, '.e2e-logs', 'dev-seed', 'coc-points-dev-seed.sql')
);
const LOG_DIR = path.join(WORKSPACE, '.e2e-logs');

const MYSQLD_CANDIDATES = [
  process.env.E2E_MYSQLD,
  'D:\\ruanjiandaquan\\MySql\\mysql-8.0.23-winx64\\bin\\mysqld.exe',
  '/usr/sbin/mysqld',
  '/usr/local/mysql/bin/mysqld',
  'mysqld',
].filter(Boolean);

const args = process.argv.slice(2);
// --reset 与 --check 是正交的两个开关: reset=重建并重新导入快照, check=干完活就退出
const RESET = args.includes('--reset');
const CHECK = args.includes('--check');
let spawnedChild = null; // 供致命错误时回收, 避免留下孤儿 mysqld

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findMysqld() {
  return MYSQLD_CANDIDATES.find((c) => (c.includes('/') || c.includes('\\')) && existsSync(c)) || 'mysqld';
}

function logFile(name) {
  mkdirSync(LOG_DIR, { recursive: true });
  return path.join(LOG_DIR, name);
}

function portOpen(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(timeoutMs);
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });
}

function spawnLogged(cmd, spawnArgs, logPath) {
  const fd = openSync(logPath, 'a');
  const child = spawn(cmd, spawnArgs, {
    stdio: ['ignore', fd, fd],
    windowsHide: true,
    shell: false,
  });
  return child;
}

async function rootConn(port, multipleStatements = false) {
  return createConnection({
    host: '127.0.0.1',
    port,
    user: 'root',
    password: '',
    multipleStatements,
    connectTimeout: 5000,
  });
}

async function waitMysqlReady(port, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const c = await rootConn(port);
      await c.query('SELECT 1');
      await c.end();
      return true;
    } catch (e) {
      lastErr = e.message;
      await sleep(600);
    }
  }
  throw new Error(`等待 mysqld(端口 ${port}) 就绪超时: ${lastErr}`);
}

/** 初始化数据目录(只在第一次需要) */
function initDatadir(mysqld) {
  console.log(`[dev-db] 首次初始化数据目录: ${DATADIR}`);
  mkdirSync(DATADIR, { recursive: true });
  const initLog = logFile('dev-mysqld-init.log');
  return new Promise((resolve, reject) => {
    const c = spawnLogged(mysqld, ['--no-defaults', '--initialize-insecure', `--datadir=${DATADIR}`], initLog);
    c.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`mysqld --initialize-insecure 失败(exit=${code}), 见 ${initLog}`))
    );
  });
}

/** Windows/8.0.23 怪癖: 初始化自带的 undo 文件会让首次启动报 already exists */
function dropUndoFiles() {
  for (const f of ['undo_001', 'undo_002', 'undo_1_trunc.log', 'undo_2_trunc.log']) {
    try {
      rmSync(path.join(DATADIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
}

/** 库里有没有被导过数据(表不存在/为空都算空) */
async function isDataEmpty(root) {
  try {
    const [rows] = await root.query(`SELECT COUNT(*) AS c FROM \`${DB_NAME}\`.members`);
    return Number(rows[0].c) === 0;
  } catch {
    return true; // 表还不存在
  }
}

/** 建库 + 应用账号 + (首次/重置时)导入数据快照 */
async function provision({ reset }) {
  const root = await rootConn(PORT, true);
  try {
    const [dbs] = await root.query('SHOW DATABASES LIKE ?', [DB_NAME]);
    let exists = dbs.length > 0;

    if (reset && exists) {
      console.log(`[dev-db] --reset: 删除本地库 ${DB_NAME}`);
      await root.query(`DROP DATABASE \`${DB_NAME}\``);
      exists = false;
    }

    // 库不存在 → 先按 schema.sql 建库建表(schema.sql 自带 CREATE DATABASE / USE)
    if (!exists) {
      console.log(`[dev-db] 创建库 ${DB_NAME}(执行 schema.sql)`);
      const schema = readFileSync(path.join(SERVER_DIR, 'schema.sql'), 'utf8');
      await root.query(schema);
    }

    // 需要导数据的三种情况: 强制重置 / 刚建库 / 库里有表但没数据
    const needImport = reset || !exists || (await isDataEmpty(root));
    if (needImport) {
      if (existsSync(SEED)) {
        console.log(`[dev-db] 导入生产数据快照: ${SEED}`);
        // mysqldump 不带 --databases 时产物里没有 USE, 必须自己选库
        await root.query(`USE \`${DB_NAME}\``);
        await root.query(readFileSync(SEED, 'utf8'));
        console.log('[dev-db] 快照导入完成');
      } else {
        console.warn(`[dev-db] 找不到快照 ${SEED}, 库内为空(可跑 npm run db:pull 拉取)`);
      }
    }

    for (const host of ['localhost', '127.0.0.1', '%']) {
      await root.query(`CREATE USER IF NOT EXISTS '${DB_USER}'@'${host}' IDENTIFIED BY '${DB_PASSWORD}'`);
      await root.query(`ALTER USER '${DB_USER}'@'${host}' IDENTIFIED BY '${DB_PASSWORD}'`);
      await root.query(`GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'${host}'`);
    }
    await root.query('FLUSH PRIVILEGES');
  } finally {
    await root.end();
  }

  // 汇总, 让"到底有没有连上生产数据"一眼可见
  const c = await createConnection({
    host: '127.0.0.1',
    port: PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });
  try {
    const q = async (sql) => {
      const [rows] = await c.query(sql);
      return rows[0];
    };
    const m = await q('SELECT COUNT(*) AS c FROM members');
    const u = await q('SELECT COUNT(*) AS c FROM users');
    const latest = await q(
      'SELECT nickname, town_hall, prosperity FROM members WHERE prosperity IS NOT NULL ORDER BY prosperity DESC LIMIT 1'
    );
    console.log(
      `[dev-db] 就绪: members=${m.c} 行, users=${u.c} 个账号` +
        (latest && latest.nickname
          ? `, 繁荣度最高: ${latest.nickname}(${latest.prosperity}, 大本营 ${latest.town_hall})`
          : '')
    );
  } finally {
    await c.end();
  }
}

/** 把本地开发库的连接信息写进 server/.env.dev, 供 .env 引用说明 */
function writeEnvHint() {
  const p = path.join(SERVER_DIR, '.env.dev-db');
  writeFileSync(
    p,
    [
      '# 本地开发库连接信息(由 npm run dev:db 生成, 供参考; 真正的配置在 server/.env)',
      `DEV_MYSQL_PORT=${PORT}`,
      `DB_HOST=127.0.0.1`,
      `DB_PORT=${PORT}`,
      `DB_USER=${DB_USER}`,
      `DB_PASSWORD=${DB_PASSWORD}`,
      `DB_NAME=${DB_NAME}`,
      '',
    ].join('\n'),
    'utf8'
  );
  return p;
}

async function main() {
  let stopping = false;
  const mysqld = findMysqld();
  const already = await portOpen(PORT);

  console.log(`[dev-db] mysqld   : ${mysqld}`);
  console.log(`[dev-db] datadir  : ${DATADIR}`);
  console.log(`[dev-db] 端口     : ${PORT}   (后端 server/.env 里 DB_PORT 必须是这个值)`);

  let child = null;
  if (already) {
    console.log(`[dev-db] 端口 ${PORT} 已有实例在跑, 不再启动第二个`);
  } else {
    if (!existsSync(path.join(DATADIR, 'auto.cnf'))) {
      await initDatadir(mysqld);
    }
    dropUndoFiles();
    console.log(`[dev-db] 启动 mysqld ...`);
    child = spawnLogged(
      mysqld,
      [
        '--no-defaults',
        `--datadir=${DATADIR}`,
        `--port=${PORT}`,
        '--bind-address=127.0.0.1',
        '--skip-log-bin',
        `--log-error=${logFile('dev-mysqld.err')}`,
      ],
      logFile('dev-mysqld.out.log')
    );
    child.on('error', (e) => console.error('[dev-db] mysqld spawn 失败:', e.message));
    child.on('exit', (code) => {
      if (!stopping) console.error(`[dev-db] mysqld 退出 code=${code}, 见 ${logFile('dev-mysqld.err')}`);
    });
    spawnedChild = child;
  }

  await waitMysqlReady(PORT);
  await provision({ reset: RESET });
  const hint = writeEnvHint();
  console.log(`[dev-db] 连接信息已写到 ${hint}`);

  if (CHECK) {
    if (child) {
      stopping = true; // 主动停止, 不要报成"意外退出"
      killTree(child);
      const freed = await waitPortFree(PORT);
      console.log(
        freed
          ? '[dev-db] --check 完成(实例已停止)'
          : '[dev-db] --check 完成(警告: mysqld 仍在监听, 请手动结束)'
      );
    } else {
      console.log('[dev-db] --check 完成(实例是别的进程启动的, 未停止)');
    }
    return;
  }

  console.log('');
  console.log('[dev-db] 实例已就绪, 保持前台运行中。另开一个终端:');
  console.log('   1) 起后端:  cd server && npm run dev        (http://127.0.0.1:3000)');
  console.log('   2) 起前端:  cd app    && npm run dev:h5     (http://127.0.0.1:5173, /api 已代理到 3000)');
  if (!child) {
    console.log(`[dev-db] 注意: 这个实例不是本进程启动的, Ctrl+C 只会退出本脚本, 不会停掉它`);
  }
  console.log('[dev-db] Ctrl+C 停止');
  console.log('');

  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log('\n[dev-db] 正在停止 mysqld ...');
    if (child) {
      killTree(child);
      setTimeout(() => process.exit(0), 1500);
    } else {
      process.exit(0);
    }
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  // 必须挂一个真实的活动句柄, 否则 Node 事件循环一空就会自己退出
  setInterval(() => {}, 1 << 30);

  // 前台常驻
  await new Promise(() => {});
}

main().catch((e) => {
  console.error('[dev-db] 失败:', e.message);
  // 别把 mysqld 留成孤儿进程: 自己启动的就自己收掉
  killTree(spawnedChild);
  process.exit(1);
});
