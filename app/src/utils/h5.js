// H5 专属: 浏览器 / 宿主 WebView 顶部标题栏的文字。
//
// 问题现象: 顶部出现两行相同文字 —— 白色栏来自浏览器/WebView(读取 document.title),
// 蓝色栏来自 uni-app 页面导航栏。两者同源(都取自 navigationBarTitleText) 造成重复。
//
// 处理: 浏览器栏固定为应用名, 页面名只由蓝色导航栏承担。
// 注意: uni-app 在页面切换后会再写一次 document.title, 因此除了延迟覆盖,
// 还监听 <title> 变化持续校正(写入前先比较, 不会造成循环)。

const APP_TITLE = '部落活跃积分';

let forcedTitle = APP_TITLE;
let observerInstalled = false;

function enforceTitle() {
  try {
    if (document.title !== forcedTitle) document.title = forcedTitle;
  } catch (e) {
    /* ignore */
  }
}

function installObserver() {
  if (observerInstalled) return;
  observerInstalled = true;
  try {
    const el = document.querySelector('title');
    if (el && typeof MutationObserver !== 'undefined') {
      new MutationObserver(enforceTitle).observe(el, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
  } catch (e) {
    /* ignore */
  }
}

export function setBrowserTitle(title = APP_TITLE) {
  // #ifdef H5
  forcedTitle = title || APP_TITLE;
  installObserver();
  // uni-app 的标题写入时机不固定, 多打两个时间点更稳
  setTimeout(enforceTitle, 0);
  setTimeout(enforceTitle, 80);
  // #endif
}
