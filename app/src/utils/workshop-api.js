// AI 创作工坊: 前端接口封装 (H5 + 原生 App)
//
// 对外接口两端完全一致, 页面不做平台判断:
//   apiGet / apiPost / apiDelete  -> JSON
//   apiBlob                       -> 图片载荷(用法见 workshop-payload.js)
//   uploadImage                   -> 上传到部落图库
//   downloadBlob                  -> 保存到本机(H5 走下载 / App 存相册)
//
// 平台差异全部收在这个文件里:
//   JSON  : 统一 uni.request(两端同一套行为, 不再用 fetch)
//   取图  : H5 用 fetch 拿 Blob; 其它平台用 uni.downloadFile 拿沙箱文件路径
//   上传  : H5 用 FormData; 其它平台用 uni.uploadFile
//   保存  : H5 用 <a download>; App 存相册(必要时先把 webp 转 jpg)
//
// token 复用项目既有的 api.js(键名 coc_token), 不在这里另存一份;
// 服务端统一返回 { ok, data } / { ok:false, error }, 这里负责拆包。

import { getToken, clearAuth } from '@/utils/api';
import { API_BASE } from '@/utils/api-base';

const BASE = API_BASE + '/ai-workshop';

/** 生成一个幂等请求编号(16~80 位, 只含 [A-Za-z0-9_-]) */
export function newRequestId() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return [
    'r',
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 10),
    Math.random().toString(36).slice(2, 10),
  ].join('_');
}

function authHeader() {
  const token = getToken();
  return token ? { Authorization: 'Bearer ' + token } : {};
}

/**
 * 401 的两种含义要分开:
 *   带过 token -> 会话失效/被吊销, 提示并跳登录页;
 *   没带 token -> 就是个没登录的访客, 静默(工坊对访客是开放的, 不该弹窗)。
 */
function handleAuthError(status) {
  if (status !== 401) return;

  const hadToken = !!getToken();
  clearAuth();
  if (hadToken) {
    uni.showToast({ title: '登录已失效，请重新登录', icon: 'none' });
    setTimeout(() => uni.navigateTo({ url: '/pages/login/login' }), 600);
  }
}

const STATUS_TEXT = {
  400: '请求不合法',
  401: '登录已失效，请重新登录',
  403: '当前角色不能执行该操作',
  404: '内容不存在，或临时图片已过期',
  409: '服务端状态冲突，请刷新后重试',
  410: '原内容已被删除',
  413: '图片太大了',
  429: '今日次数已用完，明天再来',
  503: '服务暂时不可用，请稍后重试',
};

function httpError(status, message) {
  const error = new Error(message || STATUS_TEXT[status] || `请求失败 (HTTP ${status || 0})`);
  error.status = Number(status) || 0;
  return error;
}

// ---------- JSON ----------

function requestJson(method, pathname, data) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: BASE + pathname,
      method,
      data,
      timeout: 20000,
      header: { 'Content-Type': 'application/json', ...authHeader() },
      success: (res) => {
        handleAuthError(res.statusCode);

        const body = res.data;
        if (res.statusCode >= 200 && res.statusCode < 300 && body && body.ok === true) {
          resolve(body.data);
          return;
        }
        reject(httpError(res.statusCode, body && body.error));
      },
      fail: () => reject(new Error('网络错误, 请检查连接后重试')),
    });
  });
}

export function apiGet(pathname) {
  return requestJson('GET', pathname);
}

export function apiPost(pathname, body) {
  return requestJson('POST', pathname, body || {});
}

export function apiDelete(pathname) {
  return requestJson('DELETE', pathname);
}

// ---------- 取图片 ----------

/**
 * 取一张图片(生成结果 / 部落图库图片)。
 * @returns {Promise<Blob|{path:string,size:number,persistent:boolean}>}
 */
export async function apiBlob(pathname) {
  // #ifdef H5
  const response = await fetch(BASE + pathname, { headers: authHeader(), cache: 'no-store' });
  if (!response.ok) {
    handleAuthError(response.status);
    const body = await response.json().catch(() => null);
    throw httpError(response.status, body && body.error);
  }
  return response.blob();
  // #endif
  // #ifndef H5
  // uni.downloadFile 会把响应写进沙箱临时文件, 正好是 <image src> 能直接用的路径,
  // 也是 uni.saveFile / uni.uploadFile 需要的入参 —— 不需要自己在 JS 里搬二进制。
  return new Promise((resolve, reject) => {
    uni.downloadFile({
      url: BASE + pathname,
      header: authHeader(),
      timeout: 60000,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          resolve({
            path: res.tempFilePath,
            size: Number(res.dataLength) || 0,
            persistent: false,
          });
          return;
        }
        handleAuthError(res.statusCode);
        reject(httpError(res.statusCode));
      },
      fail: () => reject(new Error('图片下载失败, 请检查网络后重试')),
    });
  });
  // #endif
}

// ---------- 上传到部落图库 ----------

/** 主动上传到服务器图库(带幂等编号) */
export async function uploadImage(payload, clientToken) {
  if (!payload) throw new Error('图片不存在');

  // #ifdef H5
  const form = new FormData();
  form.append('client_token', clientToken);
  form.append('file', payload, 'workshop.webp');

  const response = await fetch(BASE + '/gallery', {
    method: 'POST',
    headers: authHeader(),
    body: form,
  });

  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.ok !== true) {
    handleAuthError(response.status);
    throw httpError(response.status, body && body.error);
  }
  return body.data;
  // #endif
  // #ifndef H5
  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: BASE + '/gallery',
      filePath: payload.path,
      name: 'file',
      formData: { client_token: clientToken },
      header: authHeader(),
      timeout: 120000,
      success: (res) => {
        handleAuthError(res.statusCode);

        let body = null;
        try {
          body = JSON.parse(res.data);
        } catch (e) {
          body = null;
        }

        if (res.statusCode >= 200 && res.statusCode < 300 && body && body.ok === true) {
          resolve(body.data);
          return;
        }
        reject(httpError(res.statusCode, body && body.error));
      },
      fail: () => reject(new Error('上传失败, 请检查网络后重试')),
    });
  });
  // #endif
}

// ---------- 保存到本机 ----------

/**
 * 保存一张图片到本机。
 * @returns {Promise<string>} 适合直接 toast 的提示文案
 */
export function downloadBlob(payload, name) {
  // #ifdef H5
  return new Promise((resolve) => {
    const url = URL.createObjectURL(payload);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // 给浏览器留足开始读取的时间, 再回收
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    resolve('已尝试开始下载；未生效时请打开大图长按保存');
  });
  // #endif
  // #ifndef H5
  return savePayloadToAlbum(payload);
  // #endif
}

// #ifndef H5
function albumErrorText(err) {
  const message = String((err && err.errMsg) || '');
  if (/auth|deny|permission|privacy/i.test(message)) {
    return '没有相册权限，请在系统设置里允许后重试';
  }
  return '保存到相册失败，请重试';
}

/** 把沙箱里的文件存进系统相册 */
function saveImageToAlbum(filePath) {
  return new Promise((resolve, reject) => {
    uni.saveImageToPhotosAlbum({
      filePath,
      success: () => resolve('已保存到相册'),
      fail: (err) => reject(new Error(albumErrorText(err))),
    });
  });
}

/**
 * 服务端存的是 webp, iOS 相册不认识它, 能在 App 里转成 jpg 就转一张。
 * 任何一步不确定都退回原路径(Android 相册本身支持 webp), 并且带超时兜底:
 * 绝不允许"转换卡住"导致整个保存流程不动。
 */
function toJpegPath(sourcePath, timeoutMs = 3000) {
  const fallback = new Promise((resolve) => setTimeout(() => resolve(sourcePath), timeoutMs));

  const convert = new Promise((resolve) => {
    if (/\.(jpe?g|png)$/i.test(sourcePath)) {
      resolve(sourcePath);
      return;
    }
    if (typeof plus === 'undefined' || !plus.nativeObj || !plus.nativeObj.Bitmap) {
      resolve(sourcePath);
      return;
    }

    // 固定文件名 + overwrite: 每张图都新建一个文件的话, _doc 里会越攒越多
    const target = '_doc/coc-workshop-save.jpg';
    let bitmap = null;
    const done = (value) => {
      try {
        if (bitmap) bitmap.clear();
      } catch (e) {
        /* ignore */
      }
      resolve(value);
    };

    try {
      bitmap = new plus.nativeObj.Bitmap('coc_workshop_save');
      bitmap.load(
        sourcePath,
        () => {
          try {
            bitmap.save(
              target,
              { overwrite: true, format: 'jpg', quality: 92 },
              () => done(target),
              () => done(sourcePath)
            );
          } catch (e) {
            done(sourcePath);
          }
        },
        () => done(sourcePath)
      );
    } catch (e) {
      done(sourcePath);
    }
  });

  return Promise.race([convert, fallback]);
}

async function savePayloadToAlbum(payload) {
  if (!payload || !payload.path) throw new Error('图片不存在');

  const target = await toJpegPath(payload.path);
  return saveImageToAlbum(target);
}
// #endif
