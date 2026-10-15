/**
 * miniProgram fixture：在 Node 里驱动浏览器中的 window.__wxa_test_api__
 *
 * mock、route 的声明保存在 Node 侧，页面每次加载时由 __wxa_before_launch__ 取回并重新声明：
 * 打开页面前声明的在 App.onLaunch 里就生效，整页重新加载后也还在。
 * 函数形式的 mock、route 留在 Node 里执行，浏览器经 page.exposeFunction 的通道调用。
 */

import type { FrameLocator, Page } from '@playwright/test';
import type { ApiContext, ApiResult, MockResponse, WxaTestApi } from '@open-wxa/wxa-runner-core';
import type {} from '@open-wxa/wxa-runner-core/test-api';
import { MiniProgramRequest, withBody } from './request';

type Remote<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never };

/** 原样转发给浏览器的测试 API，说明复用 WxaTestApi 的注释 */
type ForwardedApi = Remote<Pick<WxaTestApi,
  | 'currentPage' | 'pageStack' | 'waitForPage' | 'pageData' | 'callPageMethod'
  | 'navigateTo' | 'navigateBack' | 'redirectTo' | 'reLaunch' | 'switchTab'
  | 'getStorage' | 'clearStorage' | 'errors' | 'clearRequests'>>;

/** 在 Node 里执行的 mock：args 是小程序调用时传的参数（不含回调），返回调用结果 */
export type MockHandler = (args: any, context: ApiContext) => ApiResult | void | Promise<ApiResult | void>;

/** 在 Node 里执行的拦截：按请求返回响应，不返回时为 200 空响应。request.routedBy 是这条规则 */
export type RouteHandler = (request: MiniProgramRequest) => MockResponse | void | Promise<MockResponse | void>;

export interface MiniProgram extends ForwardedApi {
  /** 当前页的渲染层，始终指向页面栈顶：跳转后不用重新获取 */
  readonly current: FrameLocator;
  /**
   * 打开小程序，等它启动完成。同一个用例里再次调用会整页重新加载，之前声明的 mock、route 仍然生效
   * @param url 启动页和参数，如 pages/detail/detail?id=1，开头的 / 可有可无；默认是首页
   * @throws 编译失败、setup 或启动前声明的 mock、route 出错时，错误信息同模拟器上显示的
   */
  open(url?: string): Promise<void>;
  /**
   * 覆盖原生 API，同名的 setup mock 也被覆盖。打开页面前调用的，在 App.onLaunch 里就生效
   * @param api 与 wx 上的名字相同，如 login、getLocation
   * @param impl 对象作为调用结果。函数在 Node 里执行：能用用例里的变量、检查调用参数，
   *   但结果是异步返回的，参数和返回值要能序列化；函数抛错时这次调用失败，用例结束后也失败
   * @throws 以 Sync 结尾的同步 API 传了函数时；api 是 request 等 mock 不会生效的 API 时（请求用 route 拦截），
   *   打开页面前调用的在 open 时报错
   */
  mock(api: string, impl: ApiResult | MockHandler): Promise<void>;
  /** 撤销 mock，恢复内置实现；不传 api 时撤销全部，包括 setup 声明的 */
  unmock(api?: string): Promise<void>;
  /**
   * 拦截 wx.request：命中的请求不发往网络，直接返回给定的响应，后添加的规则优先。打开页面前调用的，在 App.onLaunch 里就生效
   * @param pattern '[请求方法 ]地址'，如 'POST https://api.example.com/login'；* 匹配一段路径，** 匹配任意内容（可以不写域名）
   * @param handler 响应 { status?, header?, body?, delay? }。或者在 Node 里执行、按请求返回响应的函数，
   *   函数抛错时请求失败，用例结束后也失败
   * @throws 规则写法不对时，打开页面前调用的在 open 时报错
   */
  route(pattern: string, handler: MockResponse | RouteHandler): Promise<void>;
  /** 删除按这个写法添加的拦截规则；不传时删除全部，包括 setup 声明的 */
  unroute(pattern?: string): Promise<void>;
  /**
   * 小程序发出的 wx.request，按发出顺序，被拦截的和经代理转发的都有。每次打开页面从头记录
   * @param pattern 只返回匹配的请求，写法同 route
   */
  requests(pattern?: string): Promise<MiniProgramRequest[]>;
  /**
   * 等到小程序发出匹配的请求，返回最近的一个。已经发出的也算：只关心某个操作之后的请求时，操作前先 clearRequests()
   * @param pattern 写法同 route
   * @param options.timeout 毫秒，默认 10000
   * @throws 超时，错误信息里列出已发出的请求
   */
  waitForRequest(pattern: string, options?: { timeout?: number }): Promise<MiniProgramRequest>;
}

export interface MiniProgramSession {
  miniProgram: MiniProgram;
  /** 处理函数出过错时抛出：浏览器里只变成一次失败的调用，断言写在处理函数里时用例会误以为通过 */
  throwHandlerError(): void;
}

/** 浏览器调用 Node 的通道名 */
const BRIDGE = '__wxa_playwright__';
const DEFAULT_REQUEST_TIMEOUT = 10000;

interface Declarations {
  mocks: Array<{ api: string; inNode: boolean; result?: ApiResult }>;
  routes: Array<{ id: number; pattern: string; inNode: boolean; response?: MockResponse }>;
}

/** 在页面脚本之前执行（序列化后注入浏览器，只能引用自己的参数） */
function installInPage(bridge: string) {
  if (window !== window.top) return;
  const callNode = (...args: unknown[]) => (window as any)[bridge](...args);
  const declare = (api: WxaTestApi, { mocks, routes }: Declarations) => {
    for (const mock of mocks) {
      api.mock(mock.api, mock.inNode ? (args: unknown, context: unknown) => callNode('mock', mock.api, [args, context]) : mock.result!);
    }
    for (const route of routes) {
      api.route(route.pattern, route.inNode ? (request: unknown) => callNode('route', route.id, [request]) : route.response!);
    }
  };
  (window as any).__wxa_playwright_declare__ = declare;
  window.__wxa_before_launch__ = async api => declare(api, await callNode('declarations'));
}

/** 等小程序启动完成；启动失败时返回模拟器上显示的错误 */
function waitForLaunch(): Promise<string | null> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (error: string | null) => {
      settled = true;
      resolve(error);
    };
    window.__wxa_test_api__?.ready.then(() => finish(null));
    const poll = () => {
      if (settled) return;
      const shown = document.querySelector('.wxa-error');
      if (shown) finish(shown.textContent || '');
      else setTimeout(poll, 50);
    };
    poll();
  });
}

export async function createMiniProgram(page: Page, baseURL: string): Promise<MiniProgramSession> {
  const mocks = new Map<string, ApiResult | MockHandler>();
  let routes: Array<{ id: number; pattern: string; handler: MockResponse | RouteHandler }> = [];
  let routeSeq = 0;
  const handlerErrors: Array<{ source: string; error: unknown }> = [];

  const mockEntry = (api: string, impl: ApiResult | MockHandler) =>
    typeof impl === 'function' ? { api, inNode: true } : { api, inNode: false, result: impl };
  const routeEntry = ({ id, pattern, handler }: (typeof routes)[number]) =>
    typeof handler === 'function' ? { id, pattern, inNode: true } : { id, pattern, inNode: false, response: handler };

  const runInNode = async (source: string, run: () => unknown) => {
    try {
      return await run();
    } catch (error) {
      handlerErrors.push({ source, error });
      throw error;
    }
  };

  await page.exposeFunction(BRIDGE, (kind: string, key: string | number, args: any[]) => {
    if (kind === 'declarations') {
      const declarations: Declarations = { mocks: [...mocks].map(([api, impl]) => mockEntry(api, impl)), routes: routes.map(routeEntry) };
      return declarations;
    }
    if (kind === 'mock') {
      const impl = mocks.get(key as string);
      return runInNode(`mock('${key}')`, () => {
        if (typeof impl !== 'function') throw new Error(`mock('${key}') 已撤销或已改为对象`);
        return impl(args[0], args[1]);
      });
    }
    const route = routes.find(r => r.id === key);
    return runInNode(`route('${route?.pattern}')`, () => {
      if (typeof route?.handler !== 'function') throw new Error('拦截规则已删除');
      return route.handler(withBody({ ...args[0], routedBy: route.pattern }));
    });
  });
  await page.addInitScript(installInPage, BRIDGE);

  /** 已经打开的页面立即生效；还没打开时只保存，打开时由 __wxa_before_launch__ 取回 */
  const declareInPage = (declarations: Declarations) => page.evaluate(d => {
    const api = window.__wxa_test_api__;
    const declare = (window as any).__wxa_playwright_declare__;
    if (api && declare) declare(api, d);
  }, declarations);

  const forward = <K extends keyof ForwardedApi>(name: K) =>
    ((...args: unknown[]) => page.evaluate(([n, a]) => {
      const api = window.__wxa_test_api__;
      if (!api) throw new Error('小程序还没有打开，先调用 miniProgram.open()');
      return (api[n] as (...args: unknown[]) => unknown)(...a);
    }, [name, args] as const)) as unknown as ForwardedApi[K];

  const requests = async (pattern?: string) => {
    const recorded = await page.evaluate(p => {
      const api = window.__wxa_test_api__;
      if (!api) throw new Error('小程序还没有打开，先调用 miniProgram.open()');
      return api.requests(p);
    }, pattern);
    return recorded.map(withBody);
  };

  const miniProgram: MiniProgram = {
    current: page.frameLocator('iframe[data-current]'),

    async open(url = '') {
      const [path, query] = url.replace(/^\/+/, '').split('?');
      const search = [path && `path=${encodeURIComponent(path)}`, query].filter(Boolean).join('&');
      await page.goto(`${baseURL}/${search ? `?${search}` : ''}`);
      // 编译失败时测试 API 不会安装，只显示错误
      await page.waitForFunction(() => window.__wxa_test_api__ || document.querySelector('.wxa-error'));
      const error = await page.evaluate(waitForLaunch);
      if (error !== null) throw new Error(`小程序启动失败：\n${error}`);
    },

    async mock(api, impl) {
      if (typeof impl === 'function' && /Sync$/.test(api)) {
        throw new Error(`wx.${api} 是同步 API，只能 mock 成固定的结果对象：Node 里的函数只能异步返回结果`);
      }
      await declareInPage({ mocks: [mockEntry(api, impl)], routes: [] });
      mocks.set(api, impl);
    },

    async unmock(api) {
      if (api === undefined) mocks.clear();
      else mocks.delete(api);
      await page.evaluate(name => window.__wxa_test_api__?.unmock(name), api);
    },

    async route(pattern, handler) {
      const route = { id: ++routeSeq, pattern, handler };
      await declareInPage({ mocks: [], routes: [routeEntry(route)] });
      routes.push(route);
    },

    async unroute(pattern) {
      routes = pattern === undefined ? [] : routes.filter(route => route.pattern !== pattern);
      await page.evaluate(p => window.__wxa_test_api__?.unroute(p), pattern);
    },

    requests,

    async waitForRequest(pattern, { timeout = DEFAULT_REQUEST_TIMEOUT } = {}) {
      const deadline = Date.now() + timeout;
      for (;;) {
        const matched = await requests(pattern);
        if (matched.length) return matched[matched.length - 1];
        if (Date.now() >= deadline) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const sent = (await requests()).map(request => `  ${request.method} ${request.url}`);
      throw new Error(`等待请求 ${pattern} 超时（${timeout}ms）。已发出的请求：\n${sent.join('\n') || '  （无）'}`);
    },

    currentPage: forward('currentPage'),
    pageStack: forward('pageStack'),
    waitForPage: forward('waitForPage'),
    pageData: forward('pageData'),
    callPageMethod: forward('callPageMethod'),
    navigateTo: forward('navigateTo'),
    navigateBack: forward('navigateBack'),
    redirectTo: forward('redirectTo'),
    reLaunch: forward('reLaunch'),
    switchTab: forward('switchTab'),
    getStorage: forward('getStorage'),
    clearStorage: forward('clearStorage'),
    errors: forward('errors'),
    clearRequests: forward('clearRequests')
  };

  return {
    miniProgram,
    throwHandlerError() {
      if (!handlerErrors.length) return;
      const { source, error } = handlerErrors[0];
      const wrapped = new Error(`${source} 的处理函数出错：${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) wrapped.stack = `${wrapped.message}\n${error.stack.split('\n').slice(1).join('\n')}`;
      throw wrapped;
    }
  };
}
