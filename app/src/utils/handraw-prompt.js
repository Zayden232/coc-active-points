// 手绘风格提示词库的查询 / 文案逻辑（纯函数，不依赖 uni-app，方便 node 直接跑测试）
//
// 数据在 handraw-styles.js（由 .tool/generate-handraw-styles.mjs 生成）。
// 用法：工坊里挑一个风格 →
//   「填入提示词」= stylePhrase()，拼进本机生图用的提示词；
//   「复制」= buildStylePrompt()，粘到别的 AI 里让它按这个画风出提示词/出图。

import {
  HANDRAW_GROUPS,
  HANDRAW_STYLES,
  HANDRAW_TOTAL,
  HANDRAW_SOURCE,
} from './handraw-styles.js';

export { HANDRAW_GROUPS, HANDRAW_STYLES, HANDRAW_TOTAL, HANDRAW_SOURCE };

// 主题留空时写进文案的占位提示
export const HANDRAW_THEME_PLACEHOLDER = '（把这里换成你想画的主题）';
// 上游 201–216 没有核心特征，用这一句兜底
export const HANDRAW_TRAITS_FALLBACK = '沿用该作者标志性的线条、造型与配色气质';

export function groupById(id) {
  return HANDRAW_GROUPS.find((item) => item.id === id) || null;
}

// 分类标题: "A · 国际社论漫画 / 幽默手绘"
export function groupTitle(id) {
  const group = groupById(id);
  if (!group) return id || '';
  return `${group.id} · ${group.name}`;
}

// 每个分类的条目数（与数据里的 count 一致）
export function countByGroup() {
  const counts = {};
  for (const style of HANDRAW_STYLES) {
    counts[style.group] = (counts[style.group] || 0) + 1;
  }
  return counts;
}

function normalize(text) {
  return String(text == null ? '' : text).trim().toLowerCase();
}

function matches(style, keyword) {
  if (!keyword) return true;
  const haystack = [
    style.number,
    style.group,
    groupTitle(style.group),
    style.reference,
    style.name,
    style.traits,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(keyword);
}

/**
 * 过滤风格。
 * @param {{group?: string, keyword?: string, limit?: number}} options
 *   group 空字符串 = 全部分类；limit 省略 = 不截断
 */
export function filterStyles(options = {}) {
  const group = normalize(options.group).toUpperCase();
  const keyword = normalize(options.keyword);
  const list = HANDRAW_STYLES.filter((style) => {
    if (group && style.group !== group) return false;
    return matches(style, keyword);
  });
  const limit = Number(options.limit);
  return Number.isFinite(limit) && limit > 0 ? list.slice(0, limit) : list;
}

export function findStyle(number) {
  const target = String(number == null ? '' : number).trim();
  return (
    HANDRAW_STYLES.find((style) => style.number === target) ||
    HANDRAW_STYLES.find((style) => Number(style.number) === Number(target)) ||
    null
  );
}

function traitsOf(style) {
  return String(style && style.traits ? style.traits : '').trim();
}

/**
 * 填进 App 提示词框的一句话：主体描述 + 风格短语。
 * 例: 手绘风格「Playful Deadpan Doodle」（参考 Gemma Correll；松散黑线、怪萌人物、少量点色…）
 */
export function stylePhrase(style) {
  if (!style) return '';
  const traits = traitsOf(style);
  const detail = [style.reference ? `参考 ${style.reference}` : '', traits]
    .filter(Boolean)
    .join('；');
  return detail
    ? `手绘风格「${style.name}」（${detail}）`
    : `手绘风格「${style.name}」`;
}

function themeLine(theme) {
  const text = String(theme == null ? '' : theme).trim();
  return text || HANDRAW_THEME_PLACEHOLDER;
}

/**
 * 复制给其它 AI 的完整文案：画风 + 主题 + 一句使用说明。
 * 上游 Skill 的用法是「编号 + 主题」→ 中英文提示词，这里把编号/作者/特征一次给全。
 */
export function buildStylePrompt(style, theme) {
  if (!style) return '';
  const traits = traitsOf(style) || HANDRAW_TRAITS_FALLBACK;
  const lines = [
    `【手绘风格 ${style.number} · ${style.name}】`,
    `参考作者：${style.reference}`,
    `核心视觉特征：${traits}`,
    `主题：${themeLine(theme)}`,
    '',
    '请用这种手绘风格画出上面的主题，保持线条质感、造型语言与整体配色一致；',
    '画面干净、构图清晰、不出现文字。也可以先帮我写成一段中英文生图提示词。',
    `English style hint: hand-drawn illustration in "${style.name}" style, inspired by ${style.reference}.`,
  ];
  return lines.join('\n');
}

// 复制后展示给用户的一行摘要（列表里用）
export function styleSummary(style) {
  if (!style) return '';
  return `${style.number} ${style.name}｜${style.reference}`;
}
