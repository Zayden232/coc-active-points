// ============================================================
// coc-points 真实 MySQL 端到端测试 · 编排器
// 用法: node scripts/e2e-run.mjs            (或 npm run test:e2e)
// 行为: 确保本地 MySQL 实例(独立 datadir+端口)就绪 → 重建 coc_points
//       库(执行 schema.sql, 建 coc_app 账号) → 启动真实后端进程 →
//       运行 HTTP 全流程断言 → 清理进程, 汇总 PASS/FAIL, 非零退出。
// 环境变量(可选): E2E_MYSQLD mysqld 路径; E2E_DATADIR 数据目录;
//       E2E_MYSQL_PORT(默认33307); E2E_API_PORT(默认3199)
// ============================================================
import { spawn } from 'node:child_process';
import { createConnection } from 'mysql2/promise';
import { readFileSync, existsSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import { killTree, waitPortFree } from './kill-tree.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const WORKSPACE = path.resolve(SERVER_DIR, '..');

const MYSQL_PORT = Number(process.env.E2E_MYSQL_PORT || 33307);
const API_PORT = Number(process.env.E2E_API_PORT || 3199);
const DB_NAME = 'coc_points';
const DB_PASSWORD = 'e2eCocPass2026';
// 账号体系: 测试账号在 schema 建好后直接种子化(密码用 scrypt 哈希), 不再有共享 ADMIN_PASSWORD
const SUPER_USERNAME = 'e2e-super';
const SUPER_PASSWORD = 'E2E-Super#2026';
const ADMIN_USERNAME = 'e2e-admin';
const ADMIN_PASSWORD = 'E2E-Admin#2026';
const TEMP_USERNAME = 'e2e-temp';
const TEMP_PASSWORD = 'E2E-Temp#2026';
const VIEWER_PASSWORD = 'E2E-Viewer#2026';
const JWT_SECRET = crypto.randomBytes(32).toString('hex');

const MYSQLD_CANDIDATES = [
  process.env.E2E_MYSQLD,
  'D:\\ruanjiandaquan\\MySql\\mysql-8.0.23-winx64\\bin\\mysqld.exe',
  '/usr/sbin/mysqld',
  '/usr/local/mysql/bin/mysqld',
  'mysqld',
].filter(Boolean);

function findMysqld() {
  return MYSQLD_CANDIDATES.find((c) => c && (c.includes('/') || c.includes('\\')) && existsSync(c)) || 'mysqld';
}

function datadirOf() {
  return path.resolve(process.env.E2E_DATADIR || path.join(WORKSPACE, '.e2e-mysql'));
}

function logFile(name) {
  const dir = path.join(datadirOf(), '..', '.e2e-logs');
  mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitTcp(port, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const c = await createConnection({ host: '127.0.0.1', port, user: 'root', password: '', connectTimeout: 1500 });
      await c.end();
      return true;
    } catch {
      await sleep(500);
    }
  }
  return false;
}

async function waitHttp(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(400);
  }
  return false;
}

function spawnLogged(cmd, args, env, logPath) {
  const fd = openSync(logPath, 'a');
  const child = spawn(cmd, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', fd, fd],
    windowsHide: true,
    shell: false,
  });
  child.on('close', () => {
    try {
      // fd auto-closes on process exit; nothing more needed
    } catch {
      /* ignore */
    }
  });
  return child;
}

async function main() {
  const mysqld = findMysqld();
  let datadir = datadirOf();
  const logPre = logFile('e2e');

  console.log(`[e2e] mysqld    : ${mysqld}`);
  console.log(`[e2e] datadir   : ${datadir} (每次全新重建)`);
  console.log(`[e2e] mysql port: ${MYSQL_PORT}   api port: ${API_PORT}`);

  // 每次重建干净数据目录, 保证可重复 (被残留进程锁定时换后缀目录)
  let datadirFinal = datadir;
  try {
    rmSync(datadir, { recursive: true, force: true });
  } catch {
    datadirFinal = `${datadir}-${process.pid}-${Date.now() % 100000}`;
  }
  datadir = datadirFinal;
  mkdirSync(datadir, { recursive: true });
  console.log('[e2e] 初始化 MySQL 数据目录 ...');
  const initLog = logFile('mysqld-init.log');
  const r = await new Promise((resolve) => {
    const c = spawnLogged(mysqld, ['--no-defaults', '--initialize-insecure', `--datadir=${datadir}`], {}, initLog);
    c.on('exit', (code) => resolve(code));
  });
  if (r !== 0) throw new Error(`mysqld --initialize-insecure 失败(exit=${r}), 日志: ${initLog}`);
  console.log('[e2e] MySQL 初始化完成');

  // Windows/8.0.23 怪癖: 初始化生成的 undo 文件会让首次启动报
  // "Can't create UNDO tablespace ... already exists", 删掉让其重建
  for (const f of ['undo_001', 'undo_002', 'undo_1_trunc.log', 'undo_2_trunc.log']) {
    try {
      rmSync(path.join(datadir, f), { force: true });
    } catch {
      /* ignore */
    }
  }

  // 1) 启动 mysqld
  console.log(`[e2e] 启动 mysqld (127.0.0.1:${MYSQL_PORT}) ...`);
  const mysqldChild = spawnLogged(
    mysqld,
    [
      '--no-defaults',
      `--datadir=${datadir}`,
      `--port=${MYSQL_PORT}`,
      '--bind-address=127.0.0.1',
      '--skip-log-bin',
      '--log-error=' + logFile('mysqld.err'),
    ],
    {},
    logFile('mysqld.out.log')
  );
  const up = await waitTcp(MYSQL_PORT);
  if (!up) {
    killTree(mysqldChild);
    throw new Error(`mysqld 未在 ${MYSQL_PORT} 就绪, 详见 ${logFile('mysqld.err')}`);
  }
  console.log('[e2e] mysqld 就绪');

  // 2) 建库 + 账号 (root 空密码, initialize-insecure)
  let root;
  try {
    root = await createConnection({
      host: '127.0.0.1',
      port: MYSQL_PORT,
      user: 'root',
      password: '',
      multipleStatements: true,
      connectTimeout: 5000,
    });
  } catch (e) {
    throw new Error(`无法以 root 连接测试库: ${e.message}`);
  }
  try {
    await root.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
    const schema = readFileSync(path.join(SERVER_DIR, 'schema.sql'), 'utf8');
    await root.query(schema); // 含 CREATE DATABASE / USE / CREATE TABLE
    for (const host of ['localhost', '127.0.0.1', '%']) {
      await root.query(
        `CREATE USER IF NOT EXISTS 'coc_app'@'${host}' IDENTIFIED BY '${DB_PASSWORD}'`
      );
      await root.query(`GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO 'coc_app'@'${host}'`);
    }
    await root.query('FLUSH PRIVILEGES');
  } finally {
    await root.end();
  }
  console.log(`[e2e] 数据库 ${DB_NAME} 与 coc_app 账号已就绪`);

  // 2.5) 种子账号: 超级管理员 / 普通管理员 / 临时密码账号
  {
    const { hashPassword } = await import('../src/lib/auth.js');
    const root = await createConnection({ host: '127.0.0.1', port: MYSQL_PORT, user: 'root', password: '' });
    try {
      await root.query(`USE \`${DB_NAME}\``);
      const rows = [
        [SUPER_USERNAME, 'E2E 超管', SUPER_PASSWORD, 'super_admin', 0],
        [ADMIN_USERNAME, 'E2E 管理员', ADMIN_PASSWORD, 'admin', 0],
        [TEMP_USERNAME, 'E2E 临时', TEMP_PASSWORD, 'admin', 1],
      ];
      for (const [u, dn, pw, role, must] of rows) {
        await root.query(
          'INSERT INTO users (username, display_name, password_hash, role, enabled, token_version, must_change_password, password_changed_at) VALUES (?, ?, ?, ?, 1, 1, ?, NOW())',
          [u, dn, hashPassword(pw), role, must]
        );
      }
    } finally {
      await root.end();
    }
    console.log(`[e2e] 账号已种子化: ${[SUPER_USERNAME, ADMIN_USERNAME, TEMP_USERNAME].join(', ')}`);
  }

  // 2.6) 官方 API 桩服务(本地沙箱连不通 api.clashofclans.com, 用桩覆盖真实 HTTP 调用路径)
  const { startCocStub } = await import('./coc-stub.mjs');
  const cocStub = await startCocStub();
  console.log(`[e2e] CoC API 桩服务: ${cocStub.base}`);

  // 3) 启动真实后端
  console.log(`[e2e] 启动后端 (127.0.0.1:${API_PORT}) ...`);
  const apiLogPath = logFile('api.log');
  const serverChild = spawnLogged(
    process.execPath,
    ['src/server.js'],
    {
      PORT: String(API_PORT),
      DB_HOST: '127.0.0.1',
      DB_PORT: String(MYSQL_PORT),
      DB_USER: 'coc_app',
      DB_PASSWORD,
      DB_NAME,
      DB_POOL: '3',
      JWT_SECRET,
      VIEWER_PASSWORD,
      // 跨域: 线上默认留空(nginx 同源反代), 这里给个白名单以便断言"放行/拒绝/预检"三条路径
      CORS_ORIGINS: 'https://h5.example.com,http://localhost:8080',
      // 官方 CoC API: 测试没有真 token, 指向本地桩服务(仅为覆盖真实 HTTP 调用路径)
      COC_API_TOKEN: 'e2e-coc-token',
      COC_API_BASE: cocStub.base,
      // 转盘测试: 强制走"中奖"分支并指定奖励(生产不设置)
      WHEEL_FORCE: 'win',
      WHEEL_FORCE_REWARD: 'frame_flame',
      NODE_ENV: 'test',
      // 受限环境(沙箱/代理)对 mysql2 二进制结果集协议有干扰: SELECT 类
      // execute() 会挂起; 文本协议可绕过(行为等价)。生产默认仍为 execute。
      DB_TEXT_PROTOCOL: '1',
    },
    apiLogPath
  );
  serverChild.on('error', (e) => console.error('[e2e] 后端进程 spawn 错误:', e.message));
  let cleanupStarted = false;
  serverChild.on('exit', (code, sig) => {
    if (!cleanupStarted) console.error(`[e2e] 后端进程提前退出 code=${code} sig=${sig}`);
  });
  const baseUrl = `http://127.0.0.1:${API_PORT}`;
  const apiUp = await waitHttp(`${baseUrl}/api/health`);
  if (!apiUp) {
    let tail = '(空)';
    try {
      tail = readFileSync(apiLogPath, 'utf8').split('\n').slice(-15).join('\n');
    } catch {
      /* ignore */
    }
    killTree(serverChild);
    killTree(mysqldChild);
    await waitPortFree(MYSQL_PORT);
    throw new Error(`后端未就绪, api.log 末尾:\n${tail}`);
  }
  console.log('[e2e] 后端就绪');

  // 4) 运行场景断言
  const { runCases } = await import('./e2e-cases.mjs');
  const dbCfg = { host: '127.0.0.1', port: MYSQL_PORT, user: 'coc_app', password: DB_PASSWORD, database: DB_NAME };
  let summary;
  try {
    summary = await runCases({
      baseUrl,
      viewerPassword: VIEWER_PASSWORD,
      jwtSecret: JWT_SECRET,
      accounts: {
        super: { username: SUPER_USERNAME, password: SUPER_PASSWORD },
        admin: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
        temp: { username: TEMP_USERNAME, password: TEMP_PASSWORD },
      },
      db: dbCfg,
      cocStub,
      logPre,
    });
  } finally {
    // 无论断言成败都回收进程
    cleanupStarted = true;
    killTree(serverChild);
  }

  // 5) 清理
  console.log('\n[e2e] 清理进程 ...');
  cleanupStarted = true;
  killTree(serverChild);
  // mysqld 必须真正结束并等端口释放, 否则数据目录还是被锁着,
  // 下一次运行 rmSync 会失败并留下 .e2e-mysql-<pid> 垃圾目录
  killTree(mysqldChild);
  await cocStub.close().catch(() => {});
  const freed = await waitPortFree(MYSQL_PORT);
  if (!freed) console.warn(`[e2e] 警告: ${MYSQL_PORT} 仍在监听, 可能有残留 mysqld`);
  await sleep(300);
  if (datadir !== path.resolve(process.env.E2E_DATADIR || path.join(WORKSPACE, '.e2e-mysql'))) {
    console.log(`[e2e] 注意: 本次用了备用数据目录 ${datadir}(标准目录被占用), 已自动清理`);
    try {
      rmSync(datadir, { recursive: true, force: true });
    } catch {
      /* 下次运行再清 */
    }
  }

  console.log(`\n================ E2E 结果 ================`);
  console.log(`PASS: ${summary.passed}   FAIL: ${summary.failed}`);
  for (const f of summary.failures) console.log('  FAIL >', f);
  if (summary.failed > 0) {
    console.error(`\n${summary.failed} 项失败`);
    process.exit(1);
  }
  console.log('\n全部通过 ✓');
  process.exit(0);
}

main().catch((e) => {
  console.error('[e2e] 致命错误:', e);
  process.exit(2);
});
