/**
 * 「本机数据变了」的广播
 *
 * 对话里加了门课、改了餐标，首页/周历/复习页不该等用户手动刷新才更新。
 * 用一个 window 事件打通，避免把 store 和 React 绑在一起。
 */

const EVENT = 'xiaoshan:data-changed';

export function emitDataChanged(): void {
  window.dispatchEvent(new Event(EVENT));
}

export function onDataChanged(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
