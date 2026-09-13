// 从 yang0/handraw-style 的上游 styles.json 生成 App 内嵌的静态风格库。
//
// 上游仓库是第三方资源，不 vendor 进本仓库；先 clone 到本地，再把目录作为参数传进来：
//   git clone --depth 1 https://github.com/yang0/handraw-style <dir>
//   node tools/generate-handraw-styles.mjs <dir>
//
// 输出: app/src/utils/handraw-styles.js （纯数据；查询/文案逻辑在同目录 handraw-prompt.js）
// 校验: node tools/handraw-library-flow.mjs （261 条 / 7 类 / 编号连续 / 文案拼装）
//
// 上游更新后重新生成即可；若上游条目数或分类区间变了，这里会直接报错退出，不会静默产出错数据。

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

// 分类体系（与上游 README 的 A–G 一致，并与 styles.json 的 group 前缀逐一核对）
const GROUPS = [
  { id: 'A', name: '国际社论漫画 / 幽默手绘', from: 1, to: 35 },
  { id: 'B', name: '国际绘本 / 叙事型手绘', from: 36, to: 54 },
  { id: 'C', name: '现代平面 / 艺术化人物体系', from: 55, to: 82 },
  { id: 'D', name: '日本作者 / 当代插画体系', from: 83, to: 123 },
  { id: 'E', name: '中国作者 / 当代插画体系', from: 124, to: 154 },
  { id: 'F', name: '通用网感 / 媒介 / 地域手绘', from: 155, to: 200 },
  { id: 'G', name: '附件新增 / 当代插画补充', from: 201, to: 261 },
];

const sourceDir = process.argv[2];
if (!sourceDir) {
  console.error('用法: node tools/generate-handraw-styles.mjs <handraw-style 仓库目录>');
  process.exit(1);
}

const upstream = JSON.parse(
  readFileSync(resolve(sourceDir, 'handdraw-style-prompter/references/styles.json'), 'utf8')
);

if (!Array.isArray(upstream) || upstream.length !== 261) {
  console.error(`上游条目数异常: ${Array.isArray(upstream) ? upstream.length : 'not-array'}`);
  process.exit(1);
}

const groupOf = (number) => {
  const n = Number(number);
  const hit = GROUPS.find((g) => n >= g.from && n <= g.to);
  if (!hit) throw new Error(`编号 ${number} 不在任何分类区间内`);
  return hit.id;
};

const quote = (text) => `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const rows = upstream.map((item) => {
  const number = String(item.number);
  const group = groupOf(number);
  const upstreamGroup = String(item.group || '').trim();
  if (!upstreamGroup.startsWith(group)) {
    throw new Error(`编号 ${number} 分类不一致: 期望 ${group}, 上游 ${upstreamGroup}`);
  }
  const reference = String(item.reference || '').trim();
  const name = String(item.generation_name || '').trim();
  const traits = String(item.traits || '').trim();
  if (!reference || !name) throw new Error(`编号 ${number} 缺少作者或风格名`);
  return { number, group, reference, name, traits };
});

// 校验: 编号连续、无重复、分类计数与区间一致
const seen = new Set();
for (const row of rows) {
  if (seen.has(row.number)) throw new Error(`编号重复: ${row.number}`);
  seen.add(row.number);
}
for (let i = 1; i <= 261; i += 1) {
  const number = String(i).padStart(3, '0');
  if (!seen.has(number)) throw new Error(`编号缺失: ${number}`);
}

const counted = GROUPS.map((g) => {
  const items = rows.filter((r) => r.group === g.id);
  const expected = g.to - g.from + 1;
  if (items.length !== expected) {
    throw new Error(`分类 ${g.id} 数量不符: ${items.length} != ${expected}`);
  }
  return { ...g, count: items.length };
});

const lines = [];
lines.push('// 手绘风格提示词库（静态数据，请勿手改）');
lines.push('//');
lines.push('// 数据来源: https://github.com/yang0/handraw-style （作者 yang0）');
lines.push('//   上游文件: handdraw-style-prompter/references/styles.json');
lines.push('//   生成脚本: tools/generate-handraw-styles.mjs');
lines.push('//');
lines.push(`// 共 ${rows.length} 条风格，按编号区间分 ${GROUPS.length} 类（A–G）。`);
lines.push('// 每条 = 编号 + 参考作者 + 生图名称 + 核心视觉特征；');
lines.push('// 编号 201–216 上游没有核心特征，提示词只用名称与参考作者（见 handraw-prompt.js）。');
lines.push('//');
lines.push('// 用途: 部落创作工坊「风格提示词库」，挑一个画风复制到其它 AI 生成提示词或图片。');
lines.push('');
lines.push('export const HANDRAW_SOURCE = {');
lines.push(`  repo: ${quote('https://github.com/yang0/handraw-style')},`);
lines.push(`  file: ${quote('handdraw-style-prompter/references/styles.json')},`);
lines.push(`  author: ${quote('yang0')},`);
lines.push('};');
lines.push('');
lines.push('// id + 名称 + 编号区间；count 由生成脚本核对');
lines.push('export const HANDRAW_GROUPS = [');
for (const g of counted) {
  lines.push('  {');
  lines.push(`    id: ${quote(g.id)},`);
  lines.push(`    name: ${quote(g.name)},`);
  lines.push(`    from: ${quote(String(g.from).padStart(3, '0'))},`);
  lines.push(`    to: ${quote(String(g.to).padStart(3, '0'))},`);
  lines.push(`    count: ${g.count},`);
  lines.push('  },');
}
lines.push('];');
lines.push('');
lines.push('export const HANDRAW_STYLES = [');
for (const row of rows) {
  lines.push(
    `  { number: ${quote(row.number)}, group: ${quote(row.group)}, ` +
      `reference: ${quote(row.reference)}, name: ${quote(row.name)}, traits: ${quote(row.traits)} },`
  );
}
lines.push('];');
lines.push('');
lines.push('export const HANDRAW_TOTAL = HANDRAW_STYLES.length;');
lines.push('');

const outPath = resolve(repoRoot, 'app/src/utils/handraw-styles.js');
writeFileSync(outPath, lines.join('\n'), 'utf8');

const withTraits = rows.filter((r) => r.traits).length;
console.log(`写入 ${outPath}`);
console.log(`条目 ${rows.length}（含核心特征 ${withTraits}，无特征 ${rows.length - withTraits}）`);
console.log(
  counted.map((g) => `${g.id.padEnd(2)}${g.from}–${g.to} ${g.count} 条 ${g.name}`).join('\n')
);
