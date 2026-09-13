// AI 创作工坊: 图片载荷(payload)的统一使用接口
//
// 为什么需要这一层: 同一张图片在两个平台是两种东西 ——
//   H5  : Blob(必须先 URL.createObjectURL 才能放进 <image src>)
//   App : 沙箱里的真实文件路径(uni.downloadFile / uni.saveFile 给出, 直接可用)
// 页面只通过这里使用它, 自身不出现 Blob / createObjectURL / 文件路径等平台细节。
//
// 注意: App 端 uni.saveFile 会把临时文件"移动"到持久目录,
// 移动后的新路径由 workshop-db.js 回写到同一个载荷对象上,
// 所以 imageUrl() 要在"保存到本机"之后再调用(工坊页正是这个顺序)。

/**
 * 把图片载荷变成可以直接放进 <image src> 的地址。
 * @param {Blob|{path:string}} payload
 * @returns {Promise<string>}
 */
export function imageUrl(payload) {
  if (!payload) return Promise.resolve('');

  // #ifdef H5
  return Promise.resolve(URL.createObjectURL(payload));
  // #endif
  // #ifndef H5
  return Promise.resolve(payload.path || '');
  // #endif
}

/**
 * 释放 imageUrl() 产生的地址。
 * H5 必须释放 objectURL(否则内存里一直留着这张图);
 * App 是文件路径, 由系统/本地图库自己管理, 这里什么都不用做。
 */
export function releaseImageUrl(url) {
  if (!url) return;

  // #ifdef H5
  if (String(url).indexOf('blob:') === 0) {
    try {
      URL.revokeObjectURL(url);
    } catch (e) {
      /* 已经释放过就忽略 */
    }
  }
  // #endif
  // #ifndef H5
  /* App: 文件路径无需释放 */
  // #endif
}
