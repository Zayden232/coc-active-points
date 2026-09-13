// 把上游 handraw-style 的 261 张单图压成 App 用的缩略图（webp, 320px）。
//
//   git clone --depth 1 https://github.com/yang0/handraw-style <dir>
//   node tools/build-handraw-thumbs.mjs <dir>
//
// 输出: app/src/static/style-thumbs/001.webp … 261.webp （约 4 MB）
//
// 为什么不在仓库里放这些图: 它们是上游仓库里的第三方插画（含在世作者的风格参考图），
// 跟纯文字的风格表性质不同 —— 所以缩略图目录默认被 .gitignore 排除，本地跑一次这个脚本就有。
// 页面在图片缺失时会自动隐藏缩略图，不影响挑选与复制。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { HANDRAW_STYLES, HANDRAW_TOTAL } from '../app/src/utils/handraw-styles.js';

const upstreamDir = process.argv[2];
if (!upstreamDir) {
  console.error('用法: node tools/build-handraw-thumbs.mjs <handraw-style 仓库目录>');
  process.exit(1);
}

// sharp 是后端依赖；装了就在本地解析，没有就直接指到 server/node_modules
let sharp;
try {
  sharp = (await import('sharp')).default;
} catch (e) {
  const p = pathToFileURL(path.resolve('server/node_modules/sharp/dist/index.mjs')).href;
  sharp = (await import(p)).default;
}

const SIZE = 320;
const QUALITY = 80;
const outDir = path.resolve('app/src/static/style-thumbs');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// 001–200 / 217–261: 上游有单图，直接用。
// 201–216: 上游的"单图"其实是从 E 类总览图 (images/G_201-216.png) 上按 328×300 切的，
// 而那张总览图的表头压在网格上方，切出来每条都会带上一行的画面(第 1 条还带着表头)。
// 所以这 16 条改成自己按内容重切：去掉表头后每行约 275px，四条都能取到完整的标签 + 画面。
const SHEET = 'images/G_201-216.png';
const SHEET_TOP = 99;
const SHEET_CELL_W = 328;
const SHEET_CELL_H = 275;

const cropOf = (number) => {
  const i = Number(number) - 201;
  if (i < 0 || i > 15) return null;
  const row = Math.floor(i / 4);
  const col = i % 4;
  return {
    left: Math.round(col * SHEET_CELL_W) + 1,
    top: Math.round(SHEET_TOP + row * SHEET_CELL_H) + 1,
    width: SHEET_CELL_W - 2,
    height: Math.round(SHEET_CELL_H) - 2,
  };
};

let total = 0;
const missing = [];

for (const style of HANDRAW_STYLES) {
  const crop = cropOf(style.number);
  let pipe;

  if (crop) {
    const sheet = path.resolve(upstreamDir, SHEET);
    if (!fs.existsSync(sheet)) {
      missing.push(style.number);
      continue;
    }
    pipe = sharp(sheet).extract(crop);
  } else {
    const bucket = Number(style.number) <= 200 ? '001-200' : '201-400';
    const src = path.resolve(upstreamDir, 'images/individual', bucket, `${style.number}.png`);
    if (!fs.existsSync(src)) {
      missing.push(style.number);
      continue;
    }
    pipe = sharp(src);
  }

  const buf = await pipe.resize(SIZE, SIZE, { fit: 'inside' }).webp({ quality: QUALITY }).toBuffer();
  fs.writeFileSync(path.join(outDir, `${style.number}.webp`), buf);
  total += buf.length;
}

const written = fs.readdirSync(outDir).filter((f) => f.endsWith('.webp'));
console.log(`写入 ${outDir}`);
console.log(`缩略图 ${written.length} / ${HANDRAW_TOTAL} 张，合计 ${(total / 1024 / 1024).toFixed(1)} MB`);
if (missing.length) {
  console.error(`上游缺图编号: ${missing.join(', ')}`);
  process.exit(1);
}
