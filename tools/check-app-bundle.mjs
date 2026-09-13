// 校验打包产物里"该在的在、该没的没"(避免又出现"改完没进包"或"旧代码残留")
// 用法: node tools/check-app-bundle.mjs [dist目录, 默认 app/dist/build/app]
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || 'app/dist/build/app';

function walk(d) {
  const out = [];
  for (const e of fs.readdirSync(d)) {
    const p = path.join(d, e);
    if (fs.statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const files = walk(dir);
let all = '';
for (const f of files) all += fs.readFileSync(f, 'utf8');

// [说明, 关键字, 期望出现的次数(0 = 必须不存在, -1 = 至少一次)]
const checks = [
  ['接口基址写成绝对地址', 'https://app.jiacheng.cyou/api', -1],
  ['归档成员请求参数', 'include_archived=1', -1],
  ['恢复按钮', '恢复为绿牌', -1],
  ['恢复确认标题', '恢复已归档成员', -1],
  ['永久删除入口', '永久删除此成员', -1],
  ['物理删除请求参数', 'purge=1', -1],
  ['只读模式的登录入口', '只读模式', -1],
  ['成员编辑页归档提示', '该成员已归档', -1],
  ['「全部」筛选已删除', "label: '全部'", 0],
  ['「全部」筛选已删除(压缩后)', 'label:"全部"', 0],
  ['旧的"已被归档"报错已删除', '成员不存在或已被归档', 0],
  ['接口基址残留占位符', '__API_BASE__', 0],
  // 创作工坊进 App(2026-09): 入口不再被 #ifdef H5 藏起来
  ['创作工坊入口在包里', '部落创作工坊', -1],
  ['"仅支持浏览器(H5)"提示已删除', '仅支持浏览器', 0],
  ['H5 专用的 objectURL 已剥离', 'URL.createObjectURL', 0],
  ['H5 专用的 IndexedDB 已剥离', 'indexedDB', 0],
  ['工坊取图走 uni.downloadFile', 'downloadFile', -1],
  ['工坊上传走 uni.uploadFile', 'uploadFile', -1],
  ['工坊本机图库走 uni.saveFile', 'saveFile', -1],
  ['工坊保存相册走 uni.saveImageToPhotosAlbum', 'saveImageToPhotosAlbum', -1],
  // 转盘对访客开放(2026-09): 只读卡片整块删除
  ['转盘只读卡片已删除', '好运，由管理员派送', 0],
  // 东方幻境: 直接自己写提示词也能生成 + 默认服装(2026-09-13)
  ['东方幻境默认服装已进包', '材质改为透肉白色半透明轻纱', -1],
  ['提示词来源标记已进包', 'promptSource', -1],
  ['手动编辑提示词的处理函数已进包', 'onPromptEdited', -1],
  ['旧的"请先整理提示词"文案已更新', '设定尚未应用，请先整理提示词', 0],
  // 随机抽人·自选成员(按本周分数分组) 2026-09-13
  ['随机抽人·自选成员入口已进包', '自选成员', -1],
  ['随机抽人·按分组入口已进包', '按分组', -1],
  ['随机抽人·整组选中已进包', '整组选中', -1],
  ['随机抽人·分数分组说明已进包', '同分的人在一组', -1],
  ['随机抽人·周榜接口已进包', '/ranking?type=week', -1],
  ['随机抽人·分组逻辑已进包', 'toggleGroup', -1],
  ['随机抽人·已选人数文案已进包', '已选 ', -1],
  ['随机抽人·空名单提示已进包', '还没选人', -1],
  ['旧的"该范围暂无成员"文案已更新', '该范围暂无成员', 0],
];

let fail = 0;
console.log(`扫描 ${dir}: ${files.length} 个文件`);
for (const [label, needle, expect] of checks) {
  const n = all.split(needle).length - 1;
  const ok = expect === 0 ? n === 0 : n > 0;
  if (!ok) fail += 1;
  console.log(`${ok ? '✓' : '✗'} ${label.padEnd(26)} ${n} 处`);
}

console.log(fail ? `\n结果: ${fail} 项异常` : '\n结果: 全部正常');
process.exit(fail ? 1 : 0);
