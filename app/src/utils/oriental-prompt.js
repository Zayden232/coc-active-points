// 「东方幻境 · 仙侠人像」专属模式: 结构化提示词生成
//
// 定位: 创作工坊里的一个"专属模式", 与通用创作(自由提示词 + 部落模板)并列。
//
// 为什么用固定模板而不是再调一个聊天模型:
//   - 没有额外文本模型费用, 手机上点一下立刻出结果;
//   - 输出结构固定(五段), 不会突然出现开场白或漏掉外貌/皮肤要求;
//   - 不会因为模型回复过长而被截断。
//
// 本模块明确不做的事(不做成"看起来能用其实没有"的能力):
//   - 不支持参考图身份保持 / 图生图 / 高清修复原图 -> 因此不产出 denoising_strength;
//   - 不通过替换词语规避供应商内容安全策略;
//   - 不截断最终提示词(超过后端 1000 字符上限时直接报错, 让用户改短,
//     而不是悄悄切掉【角色细节】和皮肤要求);
//   - negative_prompt 只作为本地风格建议返回, 当前不发给供应商。

export const ORIENTAL_MODE = 'oriental_fantasy';
export const ORIENTAL_VERSION = 1;

/** 后端 prompt 上限(见 server/src/modules/ai-workshop.js) */
export const PROMPT_LIMIT = 1000;

/**
 * 可选画面尺寸。
 *
 * 取自硅基流动官方文档中 Kwai-Kolors/Kolors 的推荐值:
 * 竖图是真实可用的(9:16 / 3:4 / 1:2), 不是"只能生成方图"。
 * 换模型时这份列表必须同步核对, 否则后端会因白名单校验直接拒绝。
 */
export const IMAGE_SIZES = [
  { value: '1024x1024', label: '方图 1:1' },
  { value: '720x1280', label: '竖图 9:16' },
  { value: '768x1024', label: '竖图 3:4' },
];

/** 全身构图默认用竖图(9:16), 与"人物完整入镜"的画面要求一致 */
export const FULLBODY_SIZE = '720x1280';
export const PORTRAIT_SIZE = '1024x1024';

export const ORIENTAL_ACTIONS = [
  {
    name: '倚窗托颊',
    value: '倚坐窗前，右手轻托下颌，左手自然放在膝上，目光低垂，神情宁静，嘴角带着淡淡微笑',
  },
  {
    name: '持剑而立',
    value: '挺身站立，一手稳握长剑，另一手自然垂落，衣袖随风轻动，目光坚定，神情从容',
  },
  {
    name: '回眸微笑',
    value: '身体略微侧转，轻轻回眸望向镜头，肩颈姿态自然，嘴角微扬，神情温柔',
  },
  {
    name: '拈花静立',
    value: '自然站立，手持一枝花，指尖姿态放松，微微低头看向花瓣，神情专注而柔和',
  },
];

/**
 * 默认服装与配饰。
 *
 * 两点格式约定(改了会破坏拼出来的句子):
 *   1) 不要写【】: cleanField() 会把结构符号去掉, 写在这里只会让输入框与实际提示词不一致;
 *   2) 末尾不要加句号: 【角色细节】段是用"、"和"，"把 面部/服装/皮肤 拼起来的,
 *      末尾带句号就会拼出 "。，"。
 */
export const DEFAULT_ORIENTAL_OUTFIT =
  '让这位角色所有衣物(包含上半身/下半身和鞋子/肩包/丝袜等其他物品，如果有的话全部改）材质改为透肉白色半透明轻纱，隐隐约约能看到角色身体曲线，鞋子改为全透明反光的';

export function createOrientalForm() {
  return {
    character: 'woman', // woman | man
    composition: 'portrait', // portrait | fullbody
    action: ORIENTAL_ACTIONS[0].value,
    outfit: DEFAULT_ORIENTAL_OUTFIT,
    scene: '黄昏庭院的窗边，暖色柔光，远景轻微虚化',
    extra: '',
  };
}

const FIELD_LIMITS = {
  action: 160,
  outfit: 140,
  scene: 80,
  extra: 80,
};

/**
 * 清洗单个输入字段。
 * 这里是"格式整理", 不是内容审核: 去掉代码块、控制字符和结构标题符号,
 * 避免用户输入把五段结构搅乱。超长直接报错, 不静默截断。
 */
function cleanField(value, maxLength, label) {
  const text = String(value || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[【】]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (Array.from(text).length > maxLength) {
    throw new Error(`${label}不能超过 ${maxLength} 字`);
  }

  return text;
}

/** 按 Unicode 码点计数(中文/emoji 都算 1 个), 与输入框 maxlength 的直觉一致 */
export function charCount(text) {
  return Array.from(String(text || '')).length;
}

/**
 * 从旧剧情文本里提取括号描述。
 *
 * 只处理常见的非嵌套中英文括号; 不推断括号外哪些文字是动作、哪些是台词,
 * 避免把对话直接送进生图。
 */
export function extractBracketDescriptions(input) {
  const text = String(input || '');
  const matches = [...text.matchAll(/（([^（）]*)）|\(([^()]*)\)/g)];

  return matches
    .map((match) => (match[1] || match[2] || '').trim())
    .filter(Boolean)
    .join('；');
}

/**
 * 生成五段结构化提示词。
 * 抛错时 message 可直接展示给用户。
 */
export function buildOrientalPrompt(form) {
  if (!['woman', 'man'].includes(form.character)) throw new Error('请选择人物设定');
  if (!['portrait', 'fullbody'].includes(form.composition)) throw new Error('请选择构图');

  const action = cleanField(form.action, FIELD_LIMITS.action, '人物动作');
  const outfit = cleanField(form.outfit, FIELD_LIMITS.outfit, '服装配饰');
  const scene = cleanField(form.scene, FIELD_LIMITS.scene, '环境');
  const extra = cleanField(form.extra, FIELD_LIMITS.extra, '补充细节');

  if (!action) throw new Error('请填写人物动作');

  const character = form.character === 'man' ? '一位成年东方男性' : '一位成年东方女性';

  const face =
    form.character === 'man'
      ? '自然协调的东方面部轮廓，清晰而柔和的五官，深色眼眸，黑色长发'
      : '柔和的东方面部轮廓，自然小巧的鼻尖，圆润协调的脸型，深色眼眸，黑色长发';

  const camera =
    form.composition === 'fullbody'
      ? [
          '全身远景，平视角度',
          '从头顶到双脚完整入镜，头顶与脚下留白',
          '不截断四肢，不使用半身裁切',
          '主体居中，人物比例自然，背景适度虚化',
        ].join('，')
      : [
          '中景半身人像，平视角度',
          '头部与上半身完整入镜',
          '主体居中，手部动作清楚可见，背景柔化',
        ].join('，');

  const skin = [
    '肤色白皙自然，肌肤细腻柔滑',
    '保留轻微真实肌理',
    '细腻哑光伴随微弱柔和高光',
    '面部与手部光影过渡自然',
    '避免过度磨皮、油腻高光、塑料和蜡像质感',
  ].join('，');

  const sections = [
    `【角色动作】${character}，${action}。`,

    `【镜头】${camera}。`,

    '【画质】中式仙侠古风写实人像，细节清晰，电影感柔光，真实自然的材质表现，非油画风格，不添加文字、水印、边框、字幕或界面元素。',

    `【背景渲染】${scene || '简洁的中式庭院，柔和自然光，背景轻微虚化'}。`,

    [
      '【角色细节】',
      face,
      '，',
      outfit || '完整穿着中式交领长袍，玉饰点缀',
      '，',
      skin,
      extra ? `，${extra}` : '',
      '。',
    ].join(''),
  ];

  const prompt = sections.join('\n');

  // 与后端 1000 字符限制保持兼容: 超限报错, 而不是截掉尾部的角色细节与皮肤要求
  if (prompt.length > PROMPT_LIMIT) {
    throw new Error('提示词过长，请缩短动作、服装或补充细节');
  }

  return {
    mode: ORIENTAL_MODE,
    version: ORIENTAL_VERSION,
    prompt,

    // 仅作为本地风格建议保存; 未确认供应商支持前不发送
    negativePrompt: [
      '模糊',
      '低清晰度',
      '人物比例失衡',
      '多余肢体',
      '手指畸形',
      '重复人物',
      '文字',
      '水印',
      '聊天界面',
      '对话框',
      '塑料皮肤',
      '蜡像质感',
      '过度磨皮',
      '油腻高光',
      '强镜面反光',
    ].join('，'),

    composition: form.composition,
  };
}
