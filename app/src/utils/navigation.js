// 统一导航封装
// 背景: uni-app 规定 tabBar 页面只能用 switchTab, 用 navigateTo 会静默失败
// (首页四个入口曾因此点不动)。这里集中判断, 避免各页面各写一套。
// 注意: 本列表必须与 pages.json 的 tabBar.list 保持一致。

export const TAB_PAGES = [
  '/pages/index/index',
  '/pages/entry/entry',
  '/pages/ranking/ranking',
  '/pages/members/members',
  '/pages/settings/settings',
];

export function normalizeUrl(url) {
  if (!url) return '';
  const s = String(url);
  return s.startsWith('/') ? s : '/' + s;
}

// 去掉查询参数, 只保留路径
export function pathOf(url) {
  return normalizeUrl(url).split('?')[0];
}

export function isTabPage(url) {
  return TAB_PAGES.includes(pathOf(url));
}

/**
 * 统一跳转: tabBar 页面走 switchTab, 其余走 navigateTo。
 * 失败时记录日志并提示用户(不再静默失败)。
 */
export function navTo(url, options = {}) {
  const { silent = false } = options;
  const target = normalizeUrl(url);
  if (!target) return;

  if (isTabPage(target)) {
    if (target.indexOf('?') >= 0) {
      // tabBar 页面不接受 URL 查询参数, 需要传参请用页面间共享状态
      console.warn('[nav] tabBar 页面不支持 URL 参数, 已忽略:', target);
    }
    uni.switchTab({
      url: pathOf(target),
      fail: (err) => {
        console.error('[nav] switchTab 失败:', target, err);
        if (!silent) uni.showToast({ title: '页面切换失败', icon: 'none' });
      },
    });
    return;
  }

  uni.navigateTo({
    url: target,
    fail: (err) => {
      console.error('[nav] navigateTo 失败:', target, err);
      if (!silent) uni.showToast({ title: '页面打开失败', icon: 'none' });
    },
  });
}

/** 返回上一页(无上一页时回首页) */
export function navBack() {
  const pages = getCurrentPages ? getCurrentPages() : [];
  if (pages && pages.length > 1) {
    uni.navigateBack();
  } else {
    navTo('/pages/index/index', { silent: true });
  }
}
