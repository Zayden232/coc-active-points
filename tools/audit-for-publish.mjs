// ============================================================
// 发布前审计: 只扫"git 真正会提交的文件", 看有没有密钥/口令会跟着上去
// 用法: node tools/audit-for-publish.mjs
//
// 为什么按 git 口径: 工作区里有 .env / .tool/ 这类含真口令的文件, 但它们被 .gitignore
// 挡住就不会泄漏。所以这里先用 git 求出"会提交的文件集合", 再逐个扫。
// 只报"位置 + 类型 + 行号", 不打印密钥原文。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve('.');
// 没有 git 仓库时退化成目录遍历, 这些目录跳过
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'unpackage',
  '.e2e-logs',
  '.e2e-mysql',
  '.e2e-mysql-ai',
  '.dev-mysql',
  '.dev-ai-storage',
  '.mysql-e2e',
  '.mysql-test-data',
  '.npm-cache',
  '.dsh',
]);
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.ttf', '.woff', '.woff2', '.zip', '.gz', '.tgz', '.exe', '.dll', '.so', '.pma']);

// SSH 口令不写死在这个脚本里(否则脚本本身就是一处泄漏): 从 askpass.cmd 现读
let sshPassword = '';
try {
  const raw = fs.readFileSync(path.join(ROOT, '.tool/askpass.cmd'), 'utf8');
  sshPassword = (raw.replace(/^\s*@?echo\s*/i, '').trim().split(/\s+/)[0] || '').trim();
} catch (e) {
  /* 没有这个文件就跳过该项 */
}

const PATTERNS = [
  ...(sshPassword.length >= 4 ? [['SSH/服务器密码', new RegExp(sshPassword, 'g'), 'literal']] : []),
  // 通用规则, 不写死具体地址(否则这个工具自己就成了泄漏点)
  ['IP 地址', /\b\d{1,3}(?:\.\d{1,3}){3}\b/g, 'ip'],
  ['硅基流动 API key', /sk-[A-Za-z0-9]{20,}/g, 'literal'],
  ['私钥文件块', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, 'literal'],
  ['服务器绝对路径', /\/var\/www\/[A-Za-z0-9_./-]+/g, 'literal'],
  ['生产环境变量文件', /(^|\/)(\.env(\.[\w-]+)?)\s*$/gm, 'envfile'],
  // 这几类要看"值是不是字面量": 很多脚本是 $(grep ... .env) 现读服务器上的值, 不算泄漏
  ['数据库密码(硬编码)', /\bDB_PASSWORD\s*=\s*([^\s;'"]+)/g, 'assign'],
  ['JWT 密钥(硬编码)', /\bJWT_SECRET\s*=\s*([^\s;'"]+)/g, 'assign'],
  ['AI 身份密钥(硬编码)', /\bAI_IDENTITY_SECRET\s*=\s*([^\s;'"]+)/g, 'assign'],
  ['访客口令(硬编码)', /\bVIEWER_PASSWORD\s*=\s*([^\s;'"]+)/g, 'assign'],
  ['管理员口令(硬编码)', /\bADMIN_PASSWORD\s*=\s*([^\s;'"]+)/g, 'assign'],
  ['数据库密码(其他写法)', /\bDBP?\s*=\s*['"]([^'"]{4,})['"]/g, 'assign'],
];

/** 127.0.0.1 / 0.0.0.0 这类本机地址不算泄漏; 示例网段(192.0.2.x / 203.0.113.x)也算占位 */
function isSensitiveIp(ip) {
  if (/^(127|0)\./.test(ip)) return false;
  if (/^192\.0\.2\./.test(ip)) return false;
  if (/^203\.0\.113\./.test(ip)) return false;
  if (/^(10|172|192\.168)\./.test(ip) === false && /^(1|2|3|4|5|6|7|8|9)\d?\./.test(ip)) return true;
  return false;
}

/** 值是不是"真的把密钥写在文件里了"(而不是从别处读 / 只是说明文字) */
function isLiteralSecret(value) {
  const v = String(value || '');
  if (!v) return false;
  if (v.includes('$(') || v.includes('${') || v.startsWith('$')) return false; // 现读/引用变量
  if (/[\u4e00-\u9fa5]/.test(v)) return false; // 含中文 = 说明文字, 不是密钥
  if (/^(change_?me|your|example|placeholder|xxx+|<.*>|\.\.\.)$/i.test(v)) return false; // 占位符
  if (/(openssl|rand|hex)/i.test(v)) return false; // "用 openssl rand -hex 32 生成"
  if (v.length < 8) return false;
  return true;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** 仓库里"已经提交 + 即将提交"的全部文件(不含被 .gitignore 挡住的) */
function gitFiles() {
  if (!fs.existsSync(path.join(ROOT, '.git'))) return null;

  const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

  // 未跟踪(非忽略) + 已改动的
  const pending = execSync('git status --porcelain -uall', { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .map((p) => (p.includes(' -> ') ? p.split(' -> ')[1] : p))
    .map((p) => p.replace(/^"|"$/g, ''))
    .filter((p) => p && !p.endsWith('/'));

  return [...new Set([...tracked, ...pending])].map((p) => path.resolve(ROOT, p));
}

const useGit = !!gitFiles();
const files = useGit ? gitFiles() : walk(ROOT);
console.log(
  `=== 扫描范围: ${useGit ? 'git 会提交的文件' : '工作区全部文件(没有 git 仓库)'} — ${files.length} 个 ===`
);

const hits = [];
for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (SKIP_EXT.has(path.extname(file).toLowerCase())) continue;

  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    continue;
  }

  for (const [label, re, mode] of PATTERNS) {
    re.lastIndex = 0;
    let m;
    let count = 0;
    const lines = [];
    while ((m = re.exec(text))) {
      if (mode === 'assign' && !isLiteralSecret(m[1])) continue;
      if (mode === 'ip' && !isSensitiveIp(m[0])) continue;
      if (mode === 'envfile') continue; // 单独在下面统计
      count += 1;
      if (lines.length < 4) lines.push(text.slice(0, m.index).split('\n').length);
    }
    if (count) hits.push({ rel, label, count, lines });
  }
}

console.log('\n=== 1. 会跟着提交上去的敏感内容(只看位置, 不打印值) ===');
if (!hits.length) {
  console.log('  ✓ 没有命中: 这把要提交的文件里没有密钥/口令/私钥');
} else {
  const byFile = new Map();
  for (const h of hits) {
    if (!byFile.has(h.rel)) byFile.set(h.rel, []);
    byFile.get(h.rel).push(`${h.label}×${h.count} (行 ${h.lines.join(',')})`);
  }
  for (const [rel, list] of [...byFile.entries()].sort()) {
    console.log(`  ${rel}`);
    for (const item of list) console.log(`      - ${item}`);
  }
  console.log('  ⚠️ 上面每一处都要确认: 是真密钥 -> 必须改; 是说明文字/占位符 -> 可忽略');
}

console.log('\n=== 2. 仓库根的 .gitignore ===');
const gi = path.join(ROOT, '.gitignore');
if (!fs.existsSync(gi)) {
  console.log('  ✗ 没有 .gitignore —— 必须先写一个, 否则 node_modules / .env / 数据目录全会进去');
} else {
  const text = fs.readFileSync(gi, 'utf8');
  console.log(`  有, ${text.split('\n').filter(Boolean).length} 条规则`);
  for (const must of ['.env', 'node_modules', '.e2e-logs', '.dev-mysql', '.e2e-mysql', 'dist', 'unpackage']) {
    const ok = text.includes(must);
    console.log(`    ${ok ? '✓' : '✗'} ${must}`);
  }
}

console.log('\n=== 3. 顶层体积盘点(GitHub 单文件 >100MB 会被拒, 仓库建议 <1GB) ===');
const entries = fs.readdirSync(ROOT, { withFileTypes: true });
const rows = [];
for (const entry of entries) {
  const p = path.join(ROOT, entry.name);
  if (entry.isDirectory()) {
    if (SKIP_DIRS.has(entry.name)) {
      rows.push([entry.name + '/', '(被 .gitignore 排除)', true]);
      continue;
    }
    let size = 0;
    let count = 0;
    const stack = [p];
    while (stack.length) {
      const cur = stack.pop();
      for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
        const cp = path.join(cur, e.name);
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name)) continue;
          stack.push(cp);
        } else {
          size += fs.statSync(cp).size;
          count += 1;
        }
      }
    }
    rows.push([entry.name + '/', `${(size / 1048576).toFixed(1)} MB / ${count} 文件`, false]);
  } else {
    rows.push([entry.name, `${(fs.statSync(p).size / 1024).toFixed(1)} KB`, false]);
  }
}
for (const [name, info, skipped] of rows.sort()) {
  console.log(`  ${skipped ? '·' : ' '} ${name.padEnd(28)} ${info}`);
}

console.log('\n=== 4. 会被提交的"本地环境"文件(逐个确认) ===');
for (const rel of ['server/.env', 'server/.env.dev-db', 'server/.env.example', 'app/.env', 'app/.env.example', '.tool/askpass.cmd', '.tool/askpass.log', '.tool/ai-key.txt']) {
  const p = path.join(ROOT, rel);
  console.log(`  ${fs.existsSync(p) ? '存在 ✗ 需处理' : '不存在 ✓'}  ${rel}`);
}

console.log(`\n扫描文件数: ${files.length}`);
