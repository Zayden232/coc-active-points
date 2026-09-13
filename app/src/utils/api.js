import { API_BASE } from './api-base';

const BASE = API_BASE;
const TOKEN_KEY = 'coc_token';
const USER_KEY = 'coc_user';
const ROLE_KEY = 'coc_role'; // 兼容旧数据(仅角色)

export const ROLE = {
  SUPER: 'super_admin',
  ADMIN: 'admin',
  VIEWER: 'viewer',
  GUEST: 'guest',
};

export function getToken() {
  return uni.getStorageSync(TOKEN_KEY) || '';
}
export function setToken(t) {
  uni.setStorageSync(TOKEN_KEY, t);
}
export function clearToken() {
  uni.removeStorageSync(TOKEN_KEY);
}

/** 当前登录账号信息(未登录返回 null) */
export function getUser() {
  const u = uni.getStorageSync(USER_KEY);
  return u && typeof u === 'object' ? u : null;
}
export function setUser(user) {
  if (user && typeof user === 'object') uni.setStorageSync(USER_KEY, user);
  else uni.removeStorageSync(USER_KEY);
}
export function clearUser() {
  uni.removeStorageSync(USER_KEY);
}

/** 角色: super_admin / admin / viewer / guest(未登录) */
export function getRole() {
  const u = getUser();
  if (u && u.role) return u.role;
  return uni.getStorageSync(ROLE_KEY) || ROLE.GUEST;
}
/** 兼容旧调用: 仅用于访客口令登录后记录角色 */
export function setRole(role) {
  uni.setStorageSync(ROLE_KEY, role === ROLE.ADMIN || role === ROLE.SUPER ? ROLE.ADMIN : ROLE.VIEWER);
}
export function clearRole() {
  uni.removeStorageSync(ROLE_KEY);
}

export function isLoggedIn() {
  if (!getToken()) return false;
  return getRole() !== ROLE.GUEST;
}
export function canWrite() {
  const r = getRole();
  return r === ROLE.ADMIN || r === ROLE.SUPER;
}
export function isSuperAdmin() {
  return getRole() === ROLE.SUPER;
}
export function clearAuth() {
  clearToken();
  clearUser();
  clearRole();
}
/** 一次写入登录结果 */
export function setAuth(token, user) {
  setToken(token);
  if (user) {
    setUser(user);
    setRole(user.role);
  }
}

let redirecting = false;
/** 需要登录时统一跳登录页(带一次性标记, 避免连点重复跳转) */
export function goLogin(message = '请先登录管理员账号') {
  if (message) uni.showToast({ title: message, icon: 'none', duration: 2000 });
  if (redirecting) return;
  redirecting = true;
  setTimeout(() => {
    redirecting = false;
    uni.navigateTo({
      url: '/pages/login/login',
      fail: () => uni.switchTab({ url: '/pages/index/index' }),
    });
  }, message ? 700 : 0);
}

function request(method, url, data) {
  return new Promise((resolve, reject) => {
    uni.request({
      url: BASE + url,
      method,
      data,
      timeout: 15000,
      header: {
        'Content-Type': 'application/json',
        ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.ok) {
          resolve(res.data.data);
          return;
        }
        if (res.statusCode === 401) {
          const hadToken = !!getToken();
          clearAuth();
          if (hadToken) {
            // 会话过期/被吊销: 回登录页
            goLogin('登录已失效，请重新登录');
          } else {
            // 匿名访客尝试写操作: 只提示, 不打断浏览
            reject(new Error('该操作需要管理员登录'));
          }
          return;
        }
        if (res.statusCode === 403) {
          const code = res.data && res.data.code;
          if (code === 'MUST_CHANGE_PASSWORD') {
            uni.showToast({ title: '请先修改初始密码', icon: 'none' });
            setTimeout(() => uni.navigateTo({ url: '/pages/change-password/change-password' }), 600);
            reject(new Error('请先修改初始密码'));
            return;
          }
          // 访客只读: 不强制退出, 只提示无权限
          reject(new Error((res.data && res.data.error) || '只读访客无权执行该操作'));
          return;
        }
        reject(new Error((res.data && res.data.error) || `请求失败(${res.statusCode})`));
      },
      fail: (err) => reject(new Error('网络错误: ' + (err.errMsg || ''))),
    });
  });
}

export const get = (url, data) => request('GET', url, data);
export const post = (url, data) => request('POST', url, data);
export const put = (url, data) => request('PUT', url, data);
export const patch = (url, data) => request('PATCH', url, data);
export const del = (url, data) => request('DELETE', url, data);

// 仅 H5: 带鉴权下载文件 (导出 CSV / 备份 JSON)
export function downloadFile(url, filename = '') {
  return new Promise((resolve, reject) => {
    // #ifdef H5
    if (!getToken()) {
      reject(new Error('请先登录管理员账号'));
      return;
    }
    fetch(BASE + url, {
      headers: { Authorization: 'Bearer ' + getToken() },
    })
      .then((res) => {
        if (!res.ok) throw new Error('导出失败');
        return res.blob();
      })
      .then((blob) => {
        const a = document.createElement('a');
        const objectUrl = URL.createObjectURL(blob);
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
        resolve();
      })
      .catch(reject);
    // #endif
    // #ifndef H5
    reject(new Error('当前平台暂不支持直接下载, 请在电脑浏览器打开'));
    // #endif
  });
}

export function toastError(e) {
  uni.showToast({ title: e && e.message ? e.message : '操作失败', icon: 'none', duration: 2500 });
}
