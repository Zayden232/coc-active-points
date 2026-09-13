// ============================================================
// 极简 CDP 驱动: 用真 Chrome 打开页面 → 真点击 → 读布局/执行 JS → 截图
// 用法:
//   node tools/cdp-run.mjs --url=http://127.0.0.1:5173/#/pages/wheel/wheel \
//        --click=".pick-tab:nth-child(2)" --js="document.body.scrollWidth" --shot=out.png
//
// 为什么需要它:
//   --dump-dom / --screenshot 只能"看一张静态图", 无法点击、也无法读计算后的布局。
//   自选成员面板这类交互(切标签、点分数整组选中)与"横向溢出"这类布局问题,
//   只有能点击 + 能读 getBoundingClientRect 时才测得准。
//
// 参数(都可重复):
//   --url=<url>          必填
//   --width/--height     视口(默认 430x900)
//   --wait=<ms>          打开后等待(默认 2000)
//   --click=<选择器>      点击元素中心(可重复, 按顺序执行)
//   --clickText=<文本>    点击包含该文本的可点元素(可重复)
//   --js=<表达式>         求值并打印(可重复; 多行/含引号请用 --jsFile)
//   --jsFile=<路径>       从文件读表达式(推荐, 避免命令行转义问题)
//   --jsAfterClick        --js 在点击之后执行(默认也是之后)
//   --shot=<路径>         最后截图
//   --keep               结束后不关浏览器(调试用)
//
// steps JSON 支持的步骤: {"click":选择器} {"clickText":文本,"pick":"first|last"}
//   {"insertText":{"selector":选择器,"text":文本}}  {"js":表达式} {"wait":毫秒} {"shot":路径}
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const all = (name) => args.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));

const url = opt('url');
if (!url) {
  console.error('缺少 --url');
  process.exit(2);
}
const width = Number(opt('width', '430'));
const height = Number(opt('height', '900'));
const waitMs = Number(opt('wait', '2000'));
const shot = opt('shot');
const keep = args.includes('--keep');

const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean).find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error('找不到 Chrome/Edge');
  process.exit(2);
}

const port = 9300 + (process.pid % 400);
const profile = path.join(process.env.TEMP || '.', `dsh-cdp-${process.pid}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    'about:blank',
  ],
  { stdio: 'ignore', detached: false }
);

async function browserWs() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch (e) {
      /* 还没起来 */
    }
    await sleep(200);
  }
  throw new Error('Chrome 调试端口没起来');
}

const ws = new WebSocket(await browserWs());
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = (e) => reject(new Error('ws 连接失败'));
});

let seq = 0;
const pending = new Map();
const events = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  } else if (msg.method) {
    events.push(msg);
  }
};

function send(method, params = {}, sessionId) {
  const id = ++seq;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
// 必须显式覆盖设备尺寸: headless 的 --window-size 不等于页面 CSS 视口
// (实测 --window-size=430 时 window.innerWidth 是 512), 不覆盖的话
// 截图会是"布局按 512 排、图片只有 430 宽", 看起来像右侧被切掉。
await send(
  'Emulation.setDeviceMetricsOverride',
  { width, height, deviceScaleFactor: 1, mobile: true },
  sessionId
);
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
// 让页面能真读写剪贴板(否则 navigator.clipboard.readText 会以 "权限被拒" 失败,
// 「复制」类功能就只能靠页面自己的提示来判断成败了)。
try {
  await send(
    'Browser.grantPermissions',
    {
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
      origin: new URL(url).origin,
    }
  );
} catch (e) {
  console.log('[cdp] 剪贴板权限授予失败(不影响其他步骤): ' + e.message);
}
await send('Page.navigate', { url }, sessionId);
await sleep(waitMs);

async function evaluate(expression) {
  const res = await send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId
  );
  if (res.exceptionDetails) {
    return { error: res.exceptionDetails.text || 'evaluate 抛错' };
  }
  return { value: res.result.value };
}

async function clickAt(x, y) {
  const base = { x, y, button: 'left', clickCount: 1 };
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base }, sessionId);
}

// 把点击/求值整理成有序步骤: --steps=<json文件> 优先, 否则按简单参数拼
// steps JSON: [{"clickText":"随机抽人"},{"js":"..."},{"wait":500},{"shot":"a.png"}]
const stepsFile = opt('steps');
let steps = [];
if (stepsFile) {
  steps = JSON.parse(fs.readFileSync(path.resolve(stepsFile), 'utf8'));
} else {
  for (const sel of all('click')) steps.push({ click: sel });
  for (const text of all('clickText')) steps.push({ clickText: text });
  for (const f of all('jsFile')) steps.push({ js: fs.readFileSync(path.resolve(f), 'utf8') });
  for (const e of all('js')) steps.push({ js: e });
}

const results = [];
const shots = [];

async function clickSelector(sel) {
  const box = await evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      // 横向 scroll-view 里的元素可能滚在视口外(坐标会超过视口宽度, 点不到):
      // 先就地滚进来再取中心点。
      if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
  );
  if (!box.value) return null;
  await clickAt(box.value.x, box.value.y);
  return { x: Math.round(box.value.x), y: Math.round(box.value.y) };
}

async function clickText(text, pick = 'last') {
  const box = await evaluate(
    `(() => {
      const wanted = ${JSON.stringify(text)};
      const nodes = [...document.querySelectorAll('uni-view,uni-text,uni-button,button')]
        .filter((n) => n.textContent.trim() === wanted);
      // 默认取最内层(最后)那个, 避免点到包住它的大容器; pick:'first' 取第一个
      const el = ${JSON.stringify(pick)} === 'first' ? nodes[0] : nodes[nodes.length - 1];
      if (!el) return null;
      if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
  );
  if (!box.value) return null;
  await clickAt(box.value.x, box.value.y);
  return { x: Math.round(box.value.x), y: Math.round(box.value.y) };
}

for (const step of steps) {
  if (step.wait) {
    await sleep(Number(step.wait));
    continue;
  }

  if (step.click) {
    const at = await clickSelector(step.click);
    const item = { kind: 'click', target: step.click, at, ok: !!at };
    results.push(item);
    console.log(`[cdp] click ${step.click} ${at ? `@ ${at.x},${at.y}` : '(元素不存在)'}`);
    await sleep(Number(step.after || 700));
    continue;
  }

  if (step.clickText) {
    const at = await clickText(step.clickText, step.pick || 'last');
    const item = { kind: 'clickText', target: step.clickText, pick: step.pick || 'last', at, ok: !!at };
    results.push(item);
    console.log(`[cdp] clickText「${step.clickText}」${at ? `@ ${at.x},${at.y}` : '(没找到)'}`);
    await sleep(Number(step.after || 700));
    continue;
  }

  if (step.insertText) {
    // 真键盘输入: 先点一下元素拿到焦点, 再用 CDP 插入文本(会触发真实的 input 事件)。
    // 光改 value 再 dispatchEvent 测不出"v-model + @input 打架导致打不进字"这类问题。
    const target = step.insertText.selector;
    const text = String(step.insertText.text == null ? '' : step.insertText.text);
    const at = await clickSelector(target);
    await sleep(120);
    await send('Input.insertText', { text }, sessionId);
    results.push({ kind: 'insertText', target, text, at, ok: !!at });
    console.log(`[cdp] insertText「${text}」→ ${target}${at ? '' : '(元素不存在)'}`);
    await sleep(Number(step.after || 600));
    continue;
  }

  if (step.js) {
    const res = await evaluate(step.js);
    const item = { kind: 'js', ok: !res.error, value: res.value, error: res.error || null };
    results.push(item);
    console.log(`[cdp] js => ${item.ok ? JSON.stringify(item.value) : 'ERR ' + item.error}`);
    continue;
  }

  if (step.shot) {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const target = path.resolve(step.shot);
    fs.writeFileSync(target, Buffer.from(data, 'base64'));
    shots.push(target);
    console.log(`[cdp] 截图: ${target} (${fs.statSync(target).size} 字节)`);
  }
}

if (shot) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const target = path.resolve(shot);
  fs.writeFileSync(target, Buffer.from(data, 'base64'));
  shots.push(target);
  console.log(`[cdp] 截图: ${target} (${fs.statSync(target).size} 字节)`);
}

const outFile = opt('out');
if (outFile) {
  fs.writeFileSync(
    path.resolve(outFile),
    JSON.stringify({ url, width, height, results, shots }, null, 2),
    'utf8'
  );
  console.log(`[cdp] 结果写入: ${path.resolve(outFile)}`);
}

if (!keep) {
  await send('Browser.close').catch(() => {});
  ws.close();
  child.kill();
  // Chrome 的 Crashpad 小文件偶尔还锁着, 删不掉不影响结果, 别让它把整个脚本搞崩
  await sleep(300);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch (e) {
    /* ignore */
  }
}
