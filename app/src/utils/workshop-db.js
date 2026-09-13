// AI 创作工坊: 本机图库
//
// 同一套接口, 两个平台两套存储:
//   H5  : IndexedDB —— 图片是二进制 Blob, localStorage 只放得下字符串且只有几 MB,
//         所以分两个对象仓库: meta(列表元数据) / files(原图 + 缩略图),
//         列图库时只读 meta, 不会把所有原图一起读进内存。
//   App : 沙箱文件 + 一份 JSON 索引 —— 没有 IndexedDB, 但 uni.saveFile 能把
//         uni.downloadFile 给的临时文件搬进持久目录并返回 savedFilePath;
//         索引(路径 + 提示词等小字段)用 uni 的本地存储存一份就够。
//
// 数据只属于"当前设备/当前浏览器": 清理站点数据 / 卸载重装 / 换设备都会丢失,
// 所以页面上必须提示用户下载重要图片。

const DB_NAME = 'coc-points-workshop';
const DB_VERSION = 1;

// App 端索引的存储键(与 H5 的 IndexedDB 互不影响)
const INDEX_KEY = 'coc_workshop_index_v1';

// ---------- 通用 ----------

/**
 * 生成 320px 以内的缩略图(webp), 失败时回退用原图。
 * App 端不做二次编码(没有 canvas), 列表直接用原图路径显示。
 */
export async function makeThumbnail(payload) {
  // #ifdef H5
  const url = URL.createObjectURL(payload);

  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('图片解码失败'));
      image.src = url;
    });

    const scale = Math.min(320 / image.naturalWidth, 320 / image.naturalHeight, 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('缩略图生成失败'))),
        'image/webp',
        0.75
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
  // #endif
  // #ifndef H5
  return payload;
  // #endif
}

// ---------- H5: IndexedDB ----------

let dbPromise = null;

// #ifdef H5
function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains('meta')) {
        const meta = db.createObjectStore('meta', { keyPath: 'id' });
        meta.createIndex('namespace', 'namespace', { unique: false });
      }
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // 另一个标签页升级了库版本 -> 主动让位, 避免阻塞对方
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error('无法打开本机图库'));
    };
  });

  return dbPromise;
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('本机图库事务中断'));
    transaction.onerror = () => reject(transaction.error || new Error('本机图库写入失败'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('本机图库读取失败'));
  });
}
// #endif

// ---------- App: 沙箱文件 + JSON 索引 ----------

// #ifndef H5
function readIndex() {
  try {
    const rows = uni.getStorageSync(INDEX_KEY);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}

function writeIndex(rows) {
  uni.setStorageSync(INDEX_KEY, rows);
}

/** uni.saveFile 会把临时文件移动到持久目录, 返回新路径 */
function persistFile(tempFilePath) {
  return new Promise((resolve, reject) => {
    uni.saveFile({
      tempFilePath,
      success: (res) => {
        if (res && res.savedFilePath) resolve(res.savedFilePath);
        else reject(new Error('保存到本机失败'));
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '保存到本机失败')),
    });
  });
}

/** 删除本机保存的文件; 已经不存在也算成功(complete 一定会回调) */
function dropFile(filePath) {
  return new Promise((resolve) => {
    if (!filePath) {
      resolve();
      return;
    }
    uni.removeSavedFile({ filePath, complete: () => resolve() });
  });
}
// #endif

// ---------- 对外接口 ----------

/**
 * 保存一张图片到本机图库。
 * @param {object} meta 至少含 { id, namespace, createdAt, prompt }
 * @param {object} payload 图片载荷(见 workshop-payload.js)
 */
export async function saveLocalImage(meta, payload) {
  // #ifdef H5
  const thumbnail = await makeThumbnail(payload).catch(() => payload);
  const db = await openDatabase();

  const transaction = db.transaction(['meta', 'files'], 'readwrite');
  const done = transactionDone(transaction);

  transaction.objectStore('meta').put({ ...meta, bytes: payload.size });
  transaction.objectStore('files').put({ id: meta.id, blob: payload, thumbnail });

  await done;
  return;
  // #endif
  // #ifndef H5
  if (!payload || !payload.path) throw new Error('图片不存在');

  // 已经搬进持久目录的直接复用(例如"重试保存"): uni.saveFile 会移动文件,
  // 对已经不存在的临时路径再调一次必然失败。
  if (!payload.persistent) {
    const savedPath = await persistFile(payload.path);

    // 回写载荷: 页面随后用同一个载荷显示图片, 拿到的必须是持久路径
    payload.path = savedPath;
    payload.persistent = true;
  }

  const rows = readIndex().filter((row) => row.id !== meta.id);
  rows.push({
    ...meta,
    bytes: Number(payload.size) || Number(meta.bytes) || 0,
    path: payload.path,
  });
  writeIndex(rows);
  // #endif
}

/** 列出某个身份命名空间下的全部元数据(按时间倒序), 不含图片本体 */
export async function listLocalImages(namespace) {
  // #ifdef H5
  const db = await openDatabase();
  const transaction = db.transaction('meta', 'readonly');

  const result = await requestResult(
    transaction.objectStore('meta').index('namespace').getAll(namespace)
  );

  return result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  // #endif
  // #ifndef H5
  return readIndex()
    .filter((row) => row.namespace === namespace)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  // #endif
}

/** 取单张图片: H5 -> { id, blob, thumbnail }; App -> { id, blob, thumbnail }(都是文件路径载荷) */
export async function getLocalFile(id) {
  // #ifdef H5
  const db = await openDatabase();
  const transaction = db.transaction('files', 'readonly');
  return requestResult(transaction.objectStore('files').get(id));
  // #endif
  // #ifndef H5
  const row = readIndex().find((item) => item.id === id);
  if (!row || !row.path) return null;

  const payload = { path: row.path, size: Number(row.bytes) || 0, persistent: true };
  return { id: row.id, blob: payload, thumbnail: payload };
  // #endif
}

/** 只更新元数据(例如记录"已上传"的 serverId) */
export async function updateLocalMeta(id, patch) {
  // #ifdef H5
  const db = await openDatabase();
  const transaction = db.transaction('meta', 'readwrite');
  const done = transactionDone(transaction);

  const store = transaction.objectStore('meta');
  // 用原生回调继续同一事务, 避免事务跨异步等待后失活
  const request = store.get(id);
  request.onsuccess = () => {
    if (request.result) store.put({ ...request.result, ...patch });
  };

  await done;
  return;
  // #endif
  // #ifndef H5
  let changed = false;
  const rows = readIndex().map((row) => {
    if (row.id !== id) return row;
    changed = true;
    return { ...row, ...patch };
  });
  if (changed) writeIndex(rows);
  // #endif
}

export async function deleteLocalImage(id) {
  // #ifdef H5
  const db = await openDatabase();
  const transaction = db.transaction(['meta', 'files'], 'readwrite');
  const done = transactionDone(transaction);

  transaction.objectStore('meta').delete(id);
  transaction.objectStore('files').delete(id);

  await done;
  return;
  // #endif
  // #ifndef H5
  const rows = readIndex();
  const target = rows.find((row) => row.id === id);

  if (target) await dropFile(target.path);
  writeIndex(rows.filter((row) => row.id !== id));
  // #endif
}
