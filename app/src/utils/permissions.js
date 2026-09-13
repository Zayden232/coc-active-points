// 权限相关的前端辅助: 界面隐藏只是体验优化, 真正的拦截在服务端
import { canWrite, getRole, isSuperAdmin, isLoggedIn, getUser, clearAuth, goLogin, ROLE } from './api';

export { canWrite, getRole, isSuperAdmin, isLoggedIn, getUser };

export const ROLE_TEXT = {
  [ROLE.SUPER]: '超级管理员',
  [ROLE.ADMIN]: '管理员',
  [ROLE.VIEWER]: '访客模式 · 只读',
  [ROLE.GUEST]: '未登录 · 只读浏览',
};

export function roleText() {
  return ROLE_TEXT[getRole()] || ROLE_TEXT[ROLE.GUEST];
}

/** 账号显示名(登录后): 显示名优先, 否则用户名 */
export function accountLabel() {
  const u = getUser();
  if (!u) return '';
  return u.display_name || u.username || '';
}

/**
 * 管理员专属页面的入口守卫:
 *   未登录 -> 提示并跳登录页; 访客 -> 提示只读并返回; 管理员 -> true
 */
export function ensureAdminPage() {
  if (canWrite()) return true;

  if (!isLoggedIn()) {
    goLogin('请先登录管理员账号');
    return false;
  }

  uni.showToast({ title: '访客模式为只读', icon: 'none' });
  setTimeout(() => {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (pages && pages.length > 1) uni.navigateBack();
    else uni.switchTab({ url: '/pages/index/index' });
  }, 800);
  return false;
}

/** 超级管理员专属(账号管理页) */
export function ensureSuperAdminPage() {
  if (isSuperAdmin()) return true;
  if (!isLoggedIn()) {
    goLogin('请先登录超级管理员账号');
    return false;
  }
  uni.showToast({ title: '仅超级管理员可访问', icon: 'none' });
  setTimeout(() => {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (pages && pages.length > 1) uni.navigateBack();
    else uni.switchTab({ url: '/pages/index/index' });
  }, 800);
  return false;
}

export function logout() {
  clearAuth();
  uni.reLaunch({ url: '/pages/index/index' });
}
