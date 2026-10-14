/**
 * wxa-runner 触发的整页刷新（改了无法热更新的文件、热更新失败）保留页面栈：
 * 刷新前记下每一页的路径和参数，启动后依次重新打开
 *
 * 开发者手动刷新不经过这里，只按地址栏恢复当前页——手动刷新通常就是想从头来过
 */

import type { Host, LaunchTarget } from './Host';

const STORAGE_KEY = 'wxa-runner:reload-page-stack';

export function reloadKeepingPageStack(host: Host | undefined) {
  const stack = host?.pageStack().map(page => ({ path: page.path, query: page.query })) ?? [];
  // 还没启动完（没有页面）时不覆盖：保留上一次记下的，等真正启动时再用
  if (stack.length) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stack));
    } catch {
      // 存不了就只恢复当前页
    }
  }
  location.reload();
}

/** 取出并清掉刷新前记下的页面栈；遇到已经不存在的页面，从它开始往后都不恢复 */
export function takeSavedPageStack(pages: string[]): LaunchTarget[] {
  let saved: unknown;
  try {
    saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!Array.isArray(saved)) return [];

  const stack: LaunchTarget[] = [];
  for (const entry of saved) {
    if (!entry || !pages.includes(entry.path)) break;
    stack.push({ path: entry.path, query: { ...entry.query } });
  }
  return stack;
}

/** 在已启动的第一页之上依次 navigateTo 其余页面；某一页打不开就停下 */
export async function reopenPages(host: Host, pages: LaunchTarget[]) {
  for (const { path, query } of pages) {
    const search = new URLSearchParams(query).toString();
    const result = await host.enqueueRoute(() => host.navigateTo(search ? `${path}?${search}` : path));
    if (!String(result.errMsg).endsWith(':ok')) {
      console.warn(`[wxa-runner] 恢复页面栈时打不开 ${path}：${result.errMsg}`);
      return;
    }
  }
}
