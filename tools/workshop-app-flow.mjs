// ============================================================
// AI 创作工坊 · App 端(非 H5)适配层流程验证
// 用法: node tools/workshop-app-flow.mjs
//
// 为什么需要这个测试: 工坊原来只有 H5 能用(fetch / Blob / IndexedDB / createObjectURL),
// 现在 App 端改成 uni.downloadFile / uni.saveFile / uni.uploadFile / 相册保存,
// 而这些 API **只能真机跑**。这里退一步做能做的:
//   1) 把源码里的条件编译按"App 构建"的方式剥一遍(与 uni build -p app 同一套规则);
//   2) 用一份内存文件系统 + 记录型的 uni 桩, 按真实语义模拟这几个 API
//      (uni.saveFile 是"移动"而不是"复制" —— 这条最容易写错, 单独断言);
//   3) 断言页面依赖的每个动作: 取图 → 存本机 → 列表 → 读取 → 上传 → 删除 → 存相册。
//
// 真机仍然要验(沙箱路径、相册权限、webp→jpg 转换), 但"逻辑写错"这类问题这里能兜住。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let pass = 0;
const fails = [];
const check = (cond, msg) => {
  if (cond) pass += 1;
  else {
    fails.push(msg);
    console.log('  ✗ ' + msg);
  }
};
const checkEq = (name, actual, expected) => {
  check(
    actual === expected,
    `${name} (期望 ${JSON.stringify(expected)}, 实际 ${JSON.stringify(actual)})`
  );
};
const section = (name) => console.log('\n== ' + name + ' ==');

const APP_BASE = 'https://app.jiacheng.cyou/api';

// ---------------- 内存文件系统 + uni 桩 ----------------
const disk = new Map(); // path -> { size }
let tempSeq = 0;

const stub = {
  requests: [],
  downloads: [],
  uploads: [],
  savedFiles: [],
  removedFiles: [],
  albums: [],
  toasts: [],
  navigations: [],
  navigationsDelayed: [],
  storage: new Map(),
  // 下一次 uni.request 的返回(状态码 + 响应体)
  reply: { statusCode: 200, data: { ok: true, data: {} } },
  token: 'token-abc',
};

globalThis.__flow = stub;

globalThis.uni = {
  getStorageSync: (key) => (stub.storage.has(key) ? stub.storage.get(key) : ''),
  setStorageSync: (key, value) => stub.storage.set(key, value),
  removeStorageSync: (key) => stub.storage.delete(key),

  showToast: (o) => stub.toasts.push((o && o.title) || ''),
  hideKeyboard() {},
  navigateTo: (o) => stub.navigations.push((o && o.url) || ''),

  request: (o) => {
    stub.requests.push({
      url: o.url,
      method: o.method || 'GET',
      data: o.data,
      header: { ...(o.header || {}) },
    });
    setTimeout(() => {
      if (o.success) o.success({ statusCode: stub.reply.statusCode, data: stub.reply.data });
    }, 0);
  },

  downloadFile: (o) => {
    const filePath = `_doc/uniapp_temp/temp_${(tempSeq += 1)}.bin`;
    stub.downloads.push({ url: o.url, header: { ...(o.header || {}) }, filePath });
    if (o.success) o.success({ statusCode: 200, tempFilePath: filePath, dataLength: 2048 });
  },

  saveFile: (o) => {
    // 真实语义: 把临时文件**移动**到持久目录 —— 源文件之后就不存在了
    if (!disk.has(o.tempFilePath)) {
      if (o.fail) o.fail({ errMsg: 'saveFile:fail file not exists' });
      return;
    }
    const size = disk.get(o.tempFilePath).size;
    const saved = `_doc/uniapp_save/${path.basename(o.tempFilePath)}`;
    disk.delete(o.tempFilePath);
    disk.set(saved, { size });
    stub.savedFiles.push(saved);
    if (o.success) o.success({ savedFilePath: saved });
  },

  removeSavedFile: (o) => {
    stub.removedFiles.push(o.filePath);
    disk.delete(o.filePath);
    if (o.complete) o.complete({});
  },

  uploadFile: (o) => {
    stub.uploads.push({
      url: o.url,
      filePath: o.filePath,
      name: o.name,
      formData: { ...(o.formData || {}) },
      header: { ...(o.header || {}) },
      fileExists: disk.has(o.filePath),
    });
    setTimeout(() => {
      if (o.success) {
        o.success({ statusCode: 201, data: JSON.stringify({ ok: true, data: { id: 'g-1' } }) });
      }
    }, 0);
  },

  saveImageToPhotosAlbum: (o) => {
    stub.albums.push({ filePath: o.filePath, exists: disk.has(o.filePath) });
    if (disk.has(o.filePath)) {
      if (o.success) o.success({});
    } else if (o.fail) {
      o.fail({ errMsg: 'saveImageToPhotosAlbum:fail file not found' });
    }
  },
};

// ---------------- 条件编译: 按 App 构建剥一遍 ----------------
// 只处理这个仓库里实际用到的两种标记(H5 / 非 H5), 且这几个文件没有嵌套。
function preprocessApp(source) {
  const out = [];
  let mode = null; // null | 'h5'(丢弃) | 'non-h5'(保留)
  for (const line of source.split('\n')) {
    const t = line.trim();
    if (t === '// #ifdef H5') {
      mode = 'h5';
      continue;
    }
    if (t === '// #ifndef H5') {
      mode = 'non-h5';
      continue;
    }
    if (t === '// #endif') {
      mode = null;
      continue;
    }
    if (mode === 'h5') continue;
    out.push(line);
  }
  return out.join('\n');
}

const utilDir = path.resolve('app/src/utils');
const tmpDir = path.resolve('app/.dsh-workshop-app-flow');
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

// 只有 App 分支的源码里出现这些 H5 专属 API 才算"没剥干净"
// (只看调用形式, 注释里提到这些名字是正常的)
for (const name of ['workshop-api.js', 'workshop-db.js', 'workshop-payload.js']) {
  const stripped = preprocessApp(fs.readFileSync(path.join(utilDir, name), 'utf8'));
  fs.writeFileSync(path.join(tmpDir, name.replace(/\.js$/, '.mjs')), stripped, 'utf8');
}

let mods = null;

try {
  const apiSrc = fs.readFileSync(path.join(tmpDir, 'workshop-api.mjs'), 'utf8');
  check(!apiSrc.includes('createObjectURL('), 'App 版 workshop-api 里没有 objectURL 调用');
  check(!apiSrc.includes('fetch('), 'App 版 workshop-api 里没有 fetch');
  check(!apiSrc.includes('new FormData('), 'App 版 workshop-api 里没有 FormData');

  const dbSrc = fs.readFileSync(path.join(tmpDir, 'workshop-db.mjs'), 'utf8');
  check(!dbSrc.includes('indexedDB'), 'App 版 workshop-db 里没有 IndexedDB');
  check(dbSrc.includes('uni.saveFile'), 'App 版 workshop-db 改用 uni.saveFile');

  const payloadSrc = fs.readFileSync(path.join(tmpDir, 'workshop-payload.mjs'), 'utf8');
  check(!payloadSrc.includes('createObjectURL('), 'App 版 workshop-payload 里没有 objectURL 调用');

  // 把 @/utils/* 的导入换成桩
  fs.writeFileSync(
    path.join(tmpDir, 'api-stub.mjs'),
    `export function getToken() { return globalThis.__flow.token; }
export function clearAuth() { globalThis.__flow.cleared = true; }
`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(tmpDir, 'api-base-stub.mjs'),
    `export const API_BASE = ${JSON.stringify(APP_BASE)};\n`,
    'utf8'
  );

  const rewritten = fs
    .readFileSync(path.join(tmpDir, 'workshop-api.mjs'), 'utf8')
    .replace(/'@\/utils\/api'/g, "'./api-stub.mjs'")
    .replace(/'@\/utils\/api-base'/g, "'./api-base-stub.mjs'");
  fs.writeFileSync(path.join(tmpDir, 'workshop-api.mjs'), rewritten, 'utf8');

  mods = {
    api: await import(pathToFileURL(path.join(tmpDir, 'workshop-api.mjs')).href),
    db: await import(pathToFileURL(path.join(tmpDir, 'workshop-db.mjs')).href),
    payload: await import(pathToFileURL(path.join(tmpDir, 'workshop-payload.mjs')).href),
  };

  const { apiGet, apiPost, apiBlob, uploadImage, downloadBlob, newRequestId } = mods.api;
  const {
    saveLocalImage,
    listLocalImages,
    getLocalFile,
    updateLocalMeta,
    deleteLocalImage,
    makeThumbnail,
  } = mods.db;
  const { imageUrl, releaseImageUrl } = mods.payload;

  section('1. JSON 请求: 绝对基址 + 鉴权头 + 拆包');
  {
    stub.reply = { statusCode: 200, data: { ok: true, data: { can_create: true, role: 'guest' } } };
    stub.requests.length = 0;
    const cfg = await apiGet('/config');
    const req = stub.requests[0];
    checkEq('基址 = 生产 API + 模块前缀', req.url, APP_BASE + '/ai-workshop/config');
    checkEq('方法', req.method, 'GET');
    checkEq('带上了 Bearer token', req.header.Authorization, 'Bearer token-abc');
    checkEq('拆出 data', cfg.can_create, true);

    stub.requests.length = 0;
    await apiPost('/jobs', { client_token: 'c'.repeat(16), prompt: '测试' });
    checkEq('POST 方法', stub.requests[0].method, 'POST');
    checkEq('POST body 原样传出', stub.requests[0].data.prompt, '测试');
  }

  section('2. 错误分支: 401 / 429 / 业务错误文案');
  {
    stub.reply = { statusCode: 429, data: { ok: false, error: '今日生成次数已用完（非管理员每天 3 次）' } };
    let err = null;
    await apiPost('/jobs', {}).catch((e) => {
      err = e;
    });
    checkEq('429 带 status', err && err.status, 429);
    check(
      !!err && err.message.includes('每天 3 次'),
      `服务端错误文案原样透出 (实际 ${err && err.message})`
    );

    stub.reply = { statusCode: 401, data: { ok: false, error: '登录已失效, 请重新登录' } };
    stub.cleared = false;
    stub.token = '';
    err = null;
    await apiGet('/config').catch((e) => {
      err = e;
    });
    checkEq('401 也带 status', err && err.status, 401);
    check(stub.cleared === true, '401 会清掉本地登录态');
    check(stub.navigations.length === 0, '本来就没登录的访客 401 不弹登录页/不跳转');
    stub.token = 'token-abc';

    stub.reply = { statusCode: 200, data: { ok: false, error: '服务端返回格式异常' } };
    err = null;
    await apiGet('/config').catch((e) => {
      err = e;
    });
    check(!!err, 'ok:false 也会 reject');
  }

  section('3. 取图: uni.downloadFile 拿到沙箱路径');
  {
    stub.downloads.length = 0;
    const payload = await apiBlob('/jobs/j-1/image');
    checkEq('请求地址', stub.downloads[0].url, APP_BASE + '/ai-workshop/jobs/j-1/image');
    checkEq('带鉴权头', stub.downloads[0].header.Authorization, 'Bearer token-abc');
    checkEq('载荷是文件路径(不是 Blob)', typeof payload, 'object');
    checkEq('载荷 path = 临时文件路径', payload.path, stub.downloads[0].filePath);
    checkEq('载荷 size 来自 dataLength', payload.size, 2048);
    checkEq('载荷尚未持久化', payload.persistent, false);
    checkEq('imageUrl 直接返回路径', await imageUrl(payload), payload.path);
    releaseImageUrl(payload.path); // App 端应为 no-op, 不抛错即可
    check(true, 'releaseImageUrl 在 App 端不抛错');
  }

  section('4. 存本机: uni.saveFile 是"移动", 路径必须回写');
  {
    const payload = await apiBlob('/jobs/j-2/image');
    const tempPath = payload.path;
    disk.set(tempPath, { size: payload.size });

    const meta = {
      id: 'ns_j-2',
      namespace: 'ns',
      jobId: 'j-2',
      prompt: '一只抱着金币的小龙',
      createdAt: 1000,
      uploadToken: newRequestId(),
      serverId: null,
    };

    stub.savedFiles.length = 0;
    await saveLocalImage(meta, payload);

    checkEq('调用了 uni.saveFile', stub.savedFiles.length, 1);
    check(!disk.has(tempPath), '临时文件已被移走(uni.saveFile 的真实语义)');
    check(payload.path !== tempPath, '载荷路径被改写成持久路径');
    check(disk.has(payload.path), '持久路径上的文件存在');
    checkEq('载荷标记为已持久化', payload.persistent, true);
    checkEq('imageUrl 用的是持久路径', await imageUrl(payload), payload.path);

    // 幂等: 重试保存不应该对已经不存在的临时路径再调一次 saveFile
    stub.savedFiles.length = 0;
    await saveLocalImage(meta, payload);
    checkEq('已持久化的载荷不会重复搬文件', stub.savedFiles.length, 0);

    const list = await listLocalImages('ns');
    checkEq('列表里有这张图', list.length, 1);
    checkEq('列表项带 prompt', list[0].prompt, '一只抱着金币的小龙');
    checkEq('列表项带路径', list[0].path, payload.path);
    checkEq('别的命名空间看不到它', (await listLocalImages('other')).length, 0);

    const file = await getLocalFile('ns_j-2');
    checkEq('getLocalFile 返回同一路径', file.blob.path, payload.path);
    checkEq('getLocalFile 有缩略图字段(App 端复用原图)', file.thumbnail.path, payload.path);
    checkEq('makeThumbnail 在 App 端原样返回', await makeThumbnail(payload), payload);

    await updateLocalMeta('ns_j-2', { serverId: 'g-1' });
    const after = await listLocalImages('ns');
    checkEq('updateLocalMeta 写回 serverId', after[0].serverId, 'g-1');
    checkEq('updateLocalMeta 不丢路径', after[0].path, payload.path);
  }

  section('5. 上传: uni.uploadFile 用的是已持久化的文件');
  {
    const file = await getLocalFile('ns_j-2');
    stub.uploads.length = 0;
    const res = await uploadImage(file.blob, 'tok_upload_12345678');

    const up = stub.uploads[0];
    checkEq('上传地址', up.url, APP_BASE + '/ai-workshop/gallery');
    checkEq('字段名必须是 file(服务端 multer.single("file"))', up.name, 'file');
    checkEq('幂等编号走 formData', up.formData.client_token, 'tok_upload_12345678');
    checkEq('带鉴权头', up.header.Authorization, 'Bearer token-abc');
    checkEq('上传的是持久化文件(存在)', up.fileExists, true);
    checkEq('返回体拆包', res.id, 'g-1');
  }

  section('6. 保存到相册');
  {
    const file = await getLocalFile('ns_j-2');
    stub.albums.length = 0;
    const message = await downloadBlob(file.blob, '部落创作_x.webp');
    checkEq('调用 saveImageToPhotosAlbum', stub.albums.length, 1);
    checkEq('存的是本机文件', stub.albums[0].filePath, file.blob.path);
    checkEq('提示文案', message, '已保存到相册');

    // 有 plus 时: webp 先转 jpg, 且带 format/quality
    const conversions = [];
    globalThis.plus = {
      nativeObj: {
        Bitmap: class {
          constructor(name) {
            this.name = name;
          }
          load(src, ok) {
            conversions.push({ step: 'load', src });
            ok();
          }
          save(target, options, ok) {
            conversions.push({ step: 'save', target, options });
            disk.set(target, { size: 4096 });
            ok();
          }
          clear() {
            conversions.push({ step: 'clear' });
          }
        },
      },
    };

    stub.albums.length = 0;
    const message2 = await downloadBlob({ path: '_doc/uniapp_save/x.bin', persistent: true }, 'x.webp');
    const saveStep = conversions.find((c) => c.step === 'save');
    check(!!saveStep, 'webp 走了一次 jpg 转换');
    check(!!saveStep && saveStep.options.format === 'jpg', '转换格式是 jpg');
    check(!!saveStep && saveStep.target === '_doc/coc-workshop-save.jpg', '写到固定文件(不越攒越多)');
    checkEq('相册存的是转换后的 jpg', stub.albums[0].filePath, '_doc/coc-workshop-save.jpg');
    checkEq('提示文案', message2, '已保存到相册');
    delete globalThis.plus;

    // 权限被拒时给出可操作的提示
    stub.albums.length = 0;
    globalThis.uni.saveImageToPhotosAlbum = (o) => {
      if (o.fail) o.fail({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' });
    };
    let albumErr = null;
    await downloadBlob(file.blob, 'x.webp').catch((e) => {
      albumErr = e;
    });
    check(
      !!albumErr && albumErr.message.includes('相册权限'),
      `权限被拒时提示去设置里开权限 (实际 ${albumErr && albumErr.message})`
    );
  }

  section('7. 删除本机图片');
  {
    const before = await listLocalImages('ns');
    const filePath = before[0].path;
    stub.removedFiles.length = 0;
    await deleteLocalImage('ns_j-2');

    checkEq('调用了 uni.removeSavedFile', stub.removedFiles.length, 1);
    checkEq('删的是这条记录的路径', stub.removedFiles[0], filePath);
    checkEq('索引里也删掉了', (await listLocalImages('ns')).length, 0);
    checkEq('文件已从磁盘移除', disk.has(filePath), false);
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\n结果: ${pass} PASS / ${fails.length} FAIL`);
if (fails.length) {
  console.log('失败明细:');
  fails.forEach((f) => console.log('   - ' + f));
  process.exit(1);
}
