// 给 261 条手绘风格各拼一条"备好的完整提示词"（规则拼装，不调用任何模型）。
//
//   node tools/generate-handraw-prompts.mjs
//
// 输出: app/src/utils/handraw-prompts.js
//
// 结构（用户选定的 B 方案：统一占位 + 该风格的完整描述 + 构图/光/无文字）：
//   [这里写主体]，<生图名称> 手绘插画风格（参考 <作者>）：<核心视觉特征>。
//   主体居中，构图简洁，背景留白干净，柔和自然光，画质清晰、线条干净、色彩克制，画面中不出现任何文字。
//
// 语言与长度: 中文为主, 保留英文风格名(不少模型要靠它激活画风), 参考作者放在括号里弱化;
//             整段一般 170–320 字, 远低于 App 的 1000 字上限, 也贴近生图模型 200–400 字的舒适区。
import fs from 'node:fs';
import path from 'node:path';

import { HANDRAW_STYLES, HANDRAW_TOTAL } from '../app/src/utils/handraw-styles.js';

// 主题占位: 用户拿到提示词后第一件事就是把开头这句换成自己想画的主体
const SUBJECT_SLOT = '[这里写主体]';
// 必须与 app/src/utils/handraw-prompt.js 里的 HANDRAW_TRAITS_FALLBACK 一致
// (handraw-library-flow.mjs 会断言 201 号里确实带着这句)
const TRAITS_FALLBACK = '沿用该作者标志性的线条、造型与配色气质';

const SCENE = '主体居中，构图简洁，背景留白干净，柔和自然光，画质清晰、线条干净、色彩克制，画面中不出现任何文字。';
const MAX_LENGTH = 500;

const stripTail = (text) => String(text || '').trim().replace(/[。.；;,，、]+$/, '');

function buildPrompt(style) {
  const traits = stripTail(style.traits) || TRAITS_FALLBACK;
  const name = String(style.name || '').trim();
  const reference = String(style.reference || '').trim();
  const stylePart = reference
    ? `${name} 手绘插画风格（参考 ${reference}）`
    : `${name} 手绘插画风格`;
  return `${SUBJECT_SLOT}，${stylePart}：${traits}。${SCENE}`;
}

const rows = HANDRAW_STYLES.map((style) => ({ number: style.number, text: buildPrompt(style) }));

// 校验: 条数、占位符、长度、重复
if (rows.length !== HANDRAW_TOTAL) {
  console.error(`条数不符: ${rows.length} != ${HANDRAW_TOTAL}`);
  process.exit(1);
}
const tooLong = rows.filter((r) => r.text.length > MAX_LENGTH);
if (tooLong.length) {
  console.error(`有 ${tooLong.length} 条超过 ${MAX_LENGTH} 字: ${tooLong.map((r) => r.number).join(', ')}`);
  process.exit(1);
}
const noSlot = rows.filter((r) => !r.text.startsWith(SUBJECT_SLOT));
if (noSlot.length) {
  console.error(`有 ${noSlot.length} 条没有占位符: ${noSlot.map((r) => r.number).join(', ')}`);
  process.exit(1);
}
const unique = new Set(rows.map((r) => r.text));
if (unique.size !== rows.length) {
  console.error(`提示词有重复: 唯一 ${unique.size} / 共 ${rows.length}`);
  process.exit(1);
}

const quote = (text) => `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const lines = [];
lines.push('// 261 条风格的"备好提示词"（规则拼装生成，请勿手改）');
lines.push('//');
lines.push('// 生成脚本: tools/generate-handraw-prompts.mjs（不调用任何模型，纯模板拼装）');
lines.push('// 结构: 占位主体 + 风格名/参考作者 + 该风格的核心视觉特征 + 统一的构图/光线/无文字要求');
lines.push('// 用法: 弹层里「填入提示词」填的就是这里的整段；「复制画风」仍然复制 skill 原生文案');
lines.push(`// 长度: 一般 170–320 字，上限 ${MAX_LENGTH} 字（App 描述框上限 1000 字）`);
lines.push('');
lines.push(`export const HANDRAW_PROMPT_SLOT = ${quote(SUBJECT_SLOT)};`);
lines.push('');
lines.push('export const HANDRAW_PROMPTS = {');
for (const row of rows) {
  lines.push(`  ${quote(row.number)}: ${quote(row.text)},`);
}
lines.push('};');
lines.push('');
lines.push('export const HANDRAW_PROMPT_COUNT = Object.keys(HANDRAW_PROMPTS).length;');
lines.push('');

const outPath = path.resolve('app/src/utils/handraw-prompts.js');
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');

const lens = rows.map((r) => r.text.length);
const avg = Math.round(lens.reduce((a, b) => a + b, 0) / lens.length);
console.log(`写入 ${outPath}`);
console.log(`提示词 ${rows.length} 条，长度 ${Math.min(...lens)}–${Math.max(...lens)} 字（平均 ${avg}）`);
console.log(`前 5 条示例:`);
for (const row of rows.slice(0, 5)) console.log(`  ${row.number} ${row.text}`);
