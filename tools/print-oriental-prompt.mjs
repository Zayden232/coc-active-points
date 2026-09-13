// 打印东方幻境默认值生成出来的提示词(给人眼核对)
import { createOrientalForm, buildOrientalPrompt } from '../app/src/utils/oriental-prompt.js';

const form = createOrientalForm();
const built = buildOrientalPrompt(form);

console.log('默认服装与配饰字段值（' + Array.from(form.outfit).length + ' 字）:');
console.log(form.outfit);
console.log('\n实际发给模型的整段提示词:\n');
console.log(built.prompt);
console.log('\n总长度:', built.prompt.length, '(后端上限 1000)');
