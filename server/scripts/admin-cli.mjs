#!/usr/bin/env node
// 超级管理员初始化 / 密码重置 (仅在服务器本地执行, 不提供网页初始化接口)
//
//   node scripts/admin-cli.mjs init                 # 创建唯一的超级管理员(已存在则拒绝)
//   node scripts/admin-cli.mjs reset <username>     # 忘记密码时重置(需服务器权限)
//   node scripts/admin-cli.mjs delete <username>    # 删除普通管理员账号(需 --yes)
//   node scripts/admin-cli.mjs list                 # 列出账号
//
// 要求: 密码不作为命令行参数传入, 交互式输入且不回显; 不写入日志。
import readline from 'node:readline';
import { pool, getOne, query, run } from '../src/db.js';
import { hashPassword, generateTempPassword } from '../src/lib/auth.js';
import { writeSecurityAudit } from '../src/lib/audit.js';

const USERNAME_RE = /^[a-z0-9_]{3,32}$/;

function ask(question, { silent = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    if (silent) {
      // 简单的不回显: 借用 readline 的 _writeToOutput
      const orig = rl._writeToOutput ? rl._writeToOutput.bind(rl) : null;
      rl._writeToOutput = function (str) {
        if (str.includes(question)) return orig ? orig(str) : undefined;
        return undefined;
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (silent) process.stdout.write('\n');
      resolve(String(answer || '').trim());
    });
  });
}

async function readPassword(label) {
  const pwd = await ask(`${label}: `, { silent: true });
  if (!pwd) throw new Error('密码不能为空');
  if (pwd.length < 8) throw new Error('密码至少 8 位');
  return pwd;
}

async function init() {
  const existing = await getOne("SELECT id, username FROM users WHERE role = 'super_admin' LIMIT 1");
  if (existing) {
    console.error(`已存在超级管理员(${existing.username}), 拒绝重复创建。忘记密码请用: node scripts/admin-cli.mjs reset ${existing.username}`);
    process.exit(1);
  }
  const username = (await ask('超级管理员用户名(小写字母/数字/下划线, 3-32 位): ')).toLowerCase();
  if (!USERNAME_RE.test(username)) throw new Error('用户名格式不合法');
  const displayName = (await ask('显示名称(可留空): ')) || username;
  const password = await readPassword('设置密码(至少 8 位)');
  const again = await readPassword('再输入一次确认');
  if (password !== again) throw new Error('两次输入的密码不一致');

  const r = await run(
    'INSERT INTO users (username, display_name, password_hash, role, enabled, token_version, must_change_password, password_changed_at) VALUES (?, ?, ?, ?, 1, 1, 0, NOW())',
    [username, displayName.slice(0, 32), hashPassword(password), 'super_admin']
  );
  await writeSecurityAudit({
    actor: null,
    action: 'init_super_admin',
    targetUserId: r.insertId,
    details: `初始化超级管理员 ${username}`,
    ip: 'local-cli',
  });
  console.log(`\n✓ 超级管理员已创建: ${username} (id=${r.insertId})`);
  console.log('  请妥善保管密码; 网页端不再使用 ADMIN_PASSWORD 登录。');
}

async function reset(username) {
  if (!username) throw new Error('用法: node scripts/admin-cli.mjs reset <username>');
  const user = await getOne('SELECT * FROM users WHERE username = ?', [String(username).toLowerCase()]);
  if (!user) throw new Error(`账号不存在: ${username}`);
  const choice = (await ask('直接输入新密码(y) 还是生成临时密码(n)? [y/n]: ')).toLowerCase();
  let password;
  let mustChange = 0;
  if (choice === 'n') {
    password = generateTempPassword();
    mustChange = 1;
  } else {
    password = await readPassword('设置新密码(至少 8 位)');
    const again = await readPassword('再输入一次确认');
    if (password !== again) throw new Error('两次输入的密码不一致');
  }

  await run(
    'UPDATE users SET password_hash = ?, must_change_password = ?, password_changed_at = NOW(), token_version = token_version + 1 WHERE id = ?',
    [hashPassword(password), mustChange, user.id]
  );
  await writeSecurityAudit({
    actor: null,
    action: 'cli_reset_password',
    targetUserId: user.id,
    details: `命令行重置 ${user.username} 的密码`,
    ip: 'local-cli',
  });

  console.log(`\n✓ 已重置 ${user.username} 的密码, 该账号所有旧 Token 已失效。`);
  if (mustChange) console.log(`  一次性临时密码: ${password}\n  (该账号下次登录必须先改密)`);
}

// 非交互式初始化(部署/自动化用): 从环境变量读取, 不落日志
async function initFromEnv() {
  const username = String(process.env.SUPER_USERNAME || '').trim().toLowerCase();
  const displayName = String(process.env.SUPER_DISPLAY_NAME || '').trim() || username;
  const password = String(process.env.SUPER_PASSWORD || '');
  if (!USERNAME_RE.test(username)) throw new Error('SUPER_USERNAME 格式不合法');
  if (password.length < 8) throw new Error('SUPER_PASSWORD 至少 8 位');
  const existing = await getOne("SELECT id, username FROM users WHERE role = 'super_admin' LIMIT 1");
  if (existing) throw new Error(`已存在超级管理员(${existing.username}), 拒绝重复创建`);

  const mustChange = String(process.env.SUPER_MUST_CHANGE || '1') === '1' ? 1 : 0;
  const r = await run(
    'INSERT INTO users (username, display_name, password_hash, role, enabled, token_version, must_change_password, password_changed_at) VALUES (?, ?, ?, ?, 1, 1, ?, NOW())',
    [username, displayName.slice(0, 32), hashPassword(password), 'super_admin', mustChange]
  );
  await writeSecurityAudit({
    actor: null,
    action: 'init_super_admin',
    targetUserId: r.insertId,
    details: `初始化超级管理员 ${username}(非交互)`,
    ip: 'local-cli',
  });
  console.log(`✓ 超级管理员已创建: ${username} (id=${r.insertId}), must_change_password=${mustChange}`);
}

// 非交互式重置(忘记密码时用)
async function resetFromEnv() {
  const username = String(process.env.RESET_USERNAME || '').trim().toLowerCase();
  const password = String(process.env.RESET_PASSWORD || '');
  if (!username) throw new Error('缺少 RESET_USERNAME');
  if (password.length < 8) throw new Error('RESET_PASSWORD 至少 8 位');
  const user = await getOne('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) throw new Error(`账号不存在: ${username}`);
  await run(
    'UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = NOW(), token_version = token_version + 1 WHERE id = ?',
    [hashPassword(password), user.id]
  );
  await writeSecurityAudit({
    actor: null,
    action: 'cli_reset_password',
    targetUserId: user.id,
    details: `命令行重置 ${user.username} 的密码(非交互)`,
    ip: 'local-cli',
  });
  console.log(`✓ 已重置 ${user.username} 的密码, 旧 Token 全部失效`);
}

/**
 * 删除账号(服务器本地兜底手段: 例如网页端进不去时清理旧账号)
 *   - 超级管理员不允许删除(避免把自己锁在外面), 只允许删除普通管理员
 *   - 需要显式 --yes; 删除前写审计(保留用户名快照)
 */
async function remove(username, yes) {
  if (!username) throw new Error('用法: node scripts/admin-cli.mjs delete <username> --yes');
  const user = await getOne('SELECT * FROM users WHERE username = ?', [String(username).toLowerCase()]);
  if (!user) throw new Error(`账号不存在: ${username}`);
  if (user.role === 'super_admin') throw new Error('超级管理员账号不允许删除(可改用 reset 重置密码)');
  if (!yes) {
    throw new Error(`确认要删除 ${user.username} 吗? 加 --yes 再执行(此操作不可恢复)`);
  }
  await writeSecurityAudit({
    actor: null,
    action: 'delete_user',
    targetUserId: user.id,
    details: `命令行删除账号 ${user.username}（角色 ${user.role}）`,
    ip: 'local-cli',
  });
  await run('UPDATE users SET created_by = NULL WHERE created_by = ?', [user.id]);
  await run('DELETE FROM users WHERE id = ?', [user.id]);
  console.log(`✓ 已删除账号 ${user.username} (原 id=${user.id}); 历史审计日志保留用户名快照`);
}

async function list() {  const rows = await query(
    'SELECT id, username, display_name, role, enabled, token_version, must_change_password, last_login_at FROM users ORDER BY id'
  );
  if (!rows.length) return console.log('(还没有任何账号, 先执行: node scripts/admin-cli.mjs init)');
  for (const u of rows) {
    console.log(
      `#${u.id}  ${u.username.padEnd(16)} ${String(u.display_name || '').padEnd(12)} ${u.role.padEnd(12)} ` +
        `${Number(u.enabled) ? '启用' : '停用'}  ver=${u.token_version}  ` +
        `${Number(u.must_change_password) ? '需改密' : '正常'}  最近登录=${u.last_login_at || '-'}`
    );
  }
}

const [cmd, arg] = process.argv.slice(2);
const yes = process.argv.includes('--yes');
try {
  if (cmd === 'init') await init();
  else if (cmd === 'init-env') await initFromEnv();
  else if (cmd === 'reset') await reset(arg);
  else if (cmd === 'reset-env') await resetFromEnv(arg);
  else if (cmd === 'delete') await remove(arg, yes);
  else if (cmd === 'list') await list();
  else {
    console.log(
      [
        '用法:',
        '  node scripts/admin-cli.mjs init                 # 交互式创建超级管理员',
        '  node scripts/admin-cli.mjs reset <username>     # 交互式重置密码',
        '  node scripts/admin-cli.mjs delete <username> --yes   # 删除普通管理员账号',
        '  node scripts/admin-cli.mjs list                 # 列出账号',
        '',
        '非交互(仅用于部署脚本/自动化, 从环境变量读取, 不写入日志):',
        '  SUPER_USERNAME / SUPER_DISPLAY_NAME / SUPER_PASSWORD node scripts/admin-cli.mjs init-env',
        '  RESET_USERNAME / RESET_PASSWORD node scripts/admin-cli.mjs reset-env',
      ].join('\n')
    );
    process.exit(2);
  }
} catch (e) {
  console.error('✗ ' + e.message);
  process.exit(1);
} finally {
  await pool.end();
}
