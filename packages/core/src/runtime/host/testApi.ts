/**
 * window.__wxa_test_api__：给 E2E 测试（Playwright 等）使用的钩子
 */

import type { ApiHandler, ApiResult } from './api/registry';
import type { FrameError, Host } from './Host';

export interface PageSnapshot {
  webviewId: number;
  path: string;
  query: Record<string, string>;
  /** 渲染层 iframe 的 name，可用于 page.frame({ name }) */
  frameName: string;
}

export interface WxaTestApi {
  ready: Promise<void>;
  currentPage(): PageSnapshot | null;
  pageStack(): PageSnapshot[];
  waitForPage(path: string, timeout?: number): Promise<PageSnapshot>;
  mock(api: string, impl: ApiHandler | ApiResult): void;
  unmock(api?: string): void;
  navigateTo(url: string): Promise<ApiResult>;
  navigateBack(delta?: number): Promise<ApiResult>;
  redirectTo(url: string): Promise<ApiResult>;
  reLaunch(url: string): Promise<ApiResult>;
  switchTab(url: string): Promise<ApiResult>;
  getStorage(key: string): unknown;
  clearStorage(): void;
  errors(): FrameError[];
}

export function installTestApi(host: Host, ready: Promise<void>): WxaTestApi {
  const snapshot = (page: ReturnType<Host['currentPage']>): PageSnapshot | null =>
    page ? { webviewId: page.id, path: page.path, query: { ...page.query }, frameName: page.frame.name } : null;

  const api: WxaTestApi = {
    ready,
    currentPage: () => snapshot(host.currentPage()),
    pageStack: () => host.pageStack().map(page => snapshot(page)!),
    waitForPage(path, timeout = 10000) {
      const target = path.replace(/^\//, '');
      return new Promise((resolve, reject) => {
        const current = host.currentPage();
        if (current?.path === target) return resolve(snapshot(current)!);
        const timer = setTimeout(() => reject(new Error(`等待页面 ${target} 超时`)), timeout);
        host.onRoute(page => {
          if (page.path === target) {
            clearTimeout(timer);
            resolve(snapshot(page)!);
          }
        });
      });
    },
    mock: (name, impl) => host.api.mock(name, impl),
    unmock: name => host.api.unmock(name),
    navigateTo: url => host.enqueueRoute(() => host.navigateTo(url)),
    navigateBack: (delta = 1) => host.enqueueRoute(() => host.navigateBack(delta)),
    redirectTo: url => host.enqueueRoute(() => host.redirectTo(url)),
    reLaunch: url => host.enqueueRoute(() => host.reLaunch(url)),
    switchTab: url => host.enqueueRoute(() => host.switchTab(url)),
    getStorage(key) {
      const item = host.storage.get('s0', key);
      if (!item) return undefined;
      // 基础库存储的是序列化后的字符串，按 dataType 还原
      if (typeof item.data === 'string' && item.dataType && item.dataType !== 'String') {
        try {
          return JSON.parse(item.data);
        } catch {
          return item.data;
        }
      }
      return item.data;
    },
    clearStorage: () => host.storage.clear('s0'),
    errors: () => [...host.errors]
  };

  (window as any).__wxa_test_api__ = api;
  return api;
}
