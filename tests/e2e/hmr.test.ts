/**
 * 端到端：修改文件后热更新，不刷新整页、不丢页面状态
 *
 * 「没有整页刷新」用宿主 window 上的标记判断：整页刷新后标记就没了。
 * 需要本机安装微信开发者工具，以及 Chrome（或通过 WXA_CHROME 指定浏览器路径）。
 */

import fs from 'fs';
import path from 'path';
import { Browser, chromium, Frame, Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DevServer } from '../../packages/core/src/server/DevServer';
import { createProject, hasToolchain, REPO_ROOT } from '../helpers';

const RUNTIME_DIR = path.join(REPO_ROOT, 'packages/core/dist/runtime');
const CHROME = process.env.WXA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ready = hasToolchain() && fs.existsSync(path.join(RUNTIME_DIR, 'host.js')) && fs.existsSync(CHROME);

const INDEX_JS = `
Page({
  data: { count: 0, loads: 0 },
  onLoad() {
    const app = getApp();
    app.globalData.loads += 1;
    this.setData({ loads: app.globalData.loads });
  },
  add() {
    this.setData({ count: this.data.count + 1 });
  }
});
`;

const INDEX_WXML = `
<view id="count">{{count}}</view>
<view id="loads">{{loads}}</view>
<view id="label">{{label}}</view>
<button id="add" bindtap="add">add</button>
<badge id="badge" />
`;

const BADGE_JS = `
Component({
  data: { n: 0 },
  methods: {
    inc() { this.setData({ n: this.data.n + 1 }); }
  }
});
`;

// uni-app 等框架的页面：用 Component 构造，状态不在 Page 实例上
const VUE_PAGE_JS = `
Component({
  data: { tag: 'old', n: 0 },
  methods: {
    inc() { this.setData({ n: this.data.n + 1 }); }
  }
});
`;

function miniProgram() {
  return createProject({
    'project.config.json': { appid: 'wxtest0000000000', compileType: 'miniprogram' },
    'app.json': {
      pages: ['pages/index/index', 'pages/detail/detail', 'pages/vue/vue'],
      usingComponents: { badge: '/components/badge/badge' }
    },
    'app.js': 'App({ globalData: { loads: 0 } });',
    'app.wxss': '',
    'pages/index/index.json': {},
    'pages/index/index.js': INDEX_JS,
    'pages/index/index.wxml': INDEX_WXML,
    'pages/index/index.wxss': '',
    'pages/detail/detail.json': {},
    'pages/detail/detail.js': "Page({ data: { tag: 'old' } });",
    'pages/detail/detail.wxml': '<view id="tag">{{tag}}</view>',
    'pages/detail/detail.wxss': '',
    'pages/vue/vue.json': {},
    'pages/vue/vue.js': VUE_PAGE_JS,
    'pages/vue/vue.wxml': '<view id="tag">{{tag}}</view><view id="n">{{n}}</view><button id="inc" bindtap="inc">inc</button>',
    'pages/vue/vue.wxss': '',
    'components/badge/badge.json': { component: true },
    'components/badge/badge.js': BADGE_JS,
    'components/badge/badge.wxml': '<view class="badge-n">n={{n}}</view><button class="badge-inc" bindtap="inc">inc</button>',
    'components/badge/badge.wxss': '',
    'wxa.setup.js': 'export default {};'
  });
}

describe.skipIf(!ready)('热更新', () => {
  let server: DevServer | undefined;
  let browser: Browser;
  let page: Page;
  let projectPath = '';
  let serverLogs: string[] = [];

  const edit = (file: string, update: (content: string) => string) => {
    const target = path.join(projectPath, file);
    fs.writeFileSync(target, update(fs.readFileSync(target, 'utf8')));
  };
  const current = async (): Promise<Frame> => {
    const { frameName } = (await page.evaluate(() => window.__wxa_test_api__.currentPage()))!;
    return page.frame({ name: frameName })!;
  };
  const textOf = async (selector: string) => (await (await current()).textContent(selector))?.trim();
  const waitForText = async (selector: string, text: string) => {
    const frame = await current();
    await frame.waitForFunction(
      ([s, t]) => document.querySelector(s)?.textContent?.trim() === t,
      [selector, text] as const,
      { timeout: 10000 }
    );
  };
  /** 整页刷新会清掉这个标记 */
  const markHost = () => page.evaluate(() => ((window as any).__hmrMarker = true));
  const hostReloaded = async () => !(await page.evaluate(() => (window as any).__hmrMarker));
  const tap = async (selector: string) => (await current()).click(selector);
  const waitForPage = (pagePath: string) => page.evaluate(p => window.__wxa_test_api__.waitForPage(p), pagePath);
  const stack = () => page.evaluate(() => window.__wxa_test_api__.pageStack().map(({ path, query }) => ({ path, query })));
  const waitForReload = async () => {
    await page.waitForFunction(() => !(window as any).__hmrMarker, undefined, { timeout: 10000 });
    await page.waitForFunction(() => window.__wxa_test_api__);
    await page.evaluate(() => window.__wxa_test_api__.ready);
  };
  /** 开发者在控制台看到的热更新完成提示；要在修改文件之前开始等 */
  const hotUpdated = () => page.waitForEvent('console', { predicate: msg => msg.text().includes('[wxa-runner] 热更新完成'), timeout: 10000 });

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROME });
  });

  beforeEach(async () => {
    projectPath = miniProgram();
    server = new DevServer({
      projectPath,
      port: 0,
      runtimeDir: RUNTIME_DIR,
      logger: { log: message => serverLogs.push(String(message)), warn: () => undefined, error: () => undefined }
    });
    serverLogs = [];
    page = await browser.newPage();
    await page.goto(await server.start());
    await page.waitForFunction(() => window.__wxa_test_api__);
    await page.evaluate(() => window.__wxa_test_api__.ready);
    await markHost();
  });

  afterEach(async () => {
    await page?.close();
    await server?.close();
    server = undefined;
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('开发者修改页面 WXML 后，新内容直接出现，页面不刷新、已有状态保留', async () => {
    await tap('#add');
    await tap('#add');
    await waitForText('#count', '2');

    edit('pages/index/index.wxml', wxml => wxml.replace('<view id="count">{{count}}</view>', '<view id="count">{{count}}</view><view id="hot">已更新 {{count}}</view>'));

    await waitForText('#hot', '已更新 2');
    expect(await textOf('#count')).toBe('2');
    expect(await textOf('#loads')).toBe('1');
    expect(await hostReloaded()).toBe(false);
  });

  it('开发者修改组件 WXML 后，组件内部状态保留', async () => {
    // 组件内的 class 会被基础库加上组件前缀，用组件节点的 id 定位
    await tap('#badge wx-button');
    await tap('#badge wx-button');
    await waitForText('#badge wx-view', 'n=2');

    edit('components/badge/badge.wxml', wxml => wxml.replace('n={{n}}', '徽标 {{n}}'));

    await waitForText('#badge wx-view', '徽标 2');
    expect(await hostReloaded()).toBe(false);
  });

  it('开发者修改页面 JS 后，下一次交互执行新逻辑，data 不重置、onLoad 不重跑，新增的 data 字段生效', async () => {
    await tap('#add');
    await tap('#add');
    await waitForText('#count', '2');

    edit('pages/index/index.js', js => js
      .replace('this.data.count + 1', 'this.data.count + 10')
      .replace("data: { count: 0, loads: 0 }", "data: { count: 0, loads: 0, label: '新字段' }"));

    await waitForText('#label', '新字段');
    expect(await textOf('#count')).toBe('2');
    await tap('#add');
    await waitForText('#count', '12');
    expect(await textOf('#loads')).toBe('1');
    expect(await hostReloaded()).toBe(false);
  });

  it('页面栈里不在前台的页面也换上新逻辑', async () => {
    await tap('#add');
    await waitForText('#count', '1');
    await page.evaluate(() => window.__wxa_test_api__.navigateTo('/pages/detail/detail'));
    await waitForPage('pages/detail/detail');

    const updated = hotUpdated();
    edit('pages/index/index.js', js => js.replace('this.data.count + 1', 'this.data.count + 10'));
    await updated;
    await page.evaluate(() => window.__wxa_test_api__.navigateBack());
    await waitForPage('pages/index/index');

    expect(await textOf('#count')).toBe('1');
    await tap('#add');
    await waitForText('#count', '11');
    expect(await hostReloaded()).toBe(false);
  });

  it('修改页面 JS 后新打开的页面使用新代码', async () => {
    const updated = hotUpdated();
    edit('pages/detail/detail.js', js => js.replace("tag: 'old'", "tag: 'new'"));
    await updated;

    await page.evaluate(() => window.__wxa_test_api__.navigateTo('/pages/detail/detail'));
    await waitForPage('pages/detail/detail');
    await waitForText('#tag', 'new');
    expect(await hostReloaded()).toBe(false);
  });

  it('修改 app.js 这类无法热更新的文件时整页刷新，整个页面栈连同参数都恢复', async () => {
    await page.evaluate(() => window.__wxa_test_api__.navigateTo('/pages/detail/detail?id=7'));
    await waitForPage('pages/detail/detail');
    await page.evaluate(() => window.__wxa_test_api__.navigateTo('/pages/vue/vue'));
    await waitForPage('pages/vue/vue');

    edit('app.js', js => js.replace('loads: 0', 'loads: 100'));

    await waitForReload();
    expect(await stack()).toEqual([
      { path: 'pages/index/index', query: {} },
      { path: 'pages/detail/detail', query: { id: '7' } },
      { path: 'pages/vue/vue', query: {} }
    ]);
    // 恢复出来的是真实的页面栈：可以一路返回
    await page.evaluate(() => window.__wxa_test_api__.navigateBack());
    await waitForPage('pages/detail/detail');
  });

  it('恢复页面栈途中又触发整页刷新，最终仍恢复完整的页面栈', async () => {
    await page.evaluate(() => window.__wxa_test_api__.navigateTo('/pages/detail/detail?id=7'));
    await waitForPage('pages/detail/detail');
    await page.evaluate(() => window.__wxa_test_api__.navigateTo('/pages/vue/vue'));
    await waitForPage('pages/vue/vue');

    // 让恢复卡在第三页：第一次请求它的渲染层时一直不响应（unroute 会放行挂起的请求，所以不能用）；
    // 第二次刷新后的请求正常放行
    let stalled!: () => void;
    const reachedThirdPage = new Promise<void>(resolve => (stalled = resolve));
    let held = false;
    await page.route('**/__wxa__/webview/pages/vue/vue.html*', route => {
      if (held) return route.continue();
      held = true;
      stalled();
    });
    edit('app.js', js => js.replace('loads: 0', 'loads: 100'));
    await reachedThirdPage;
    expect((await stack()).map(p => p.path)).toEqual(['pages/index/index', 'pages/detail/detail']);

    await markHost();
    edit('app.js', js => js.replace('loads: 100', 'loads: 200'));

    await waitForReload();
    expect((await stack()).map(p => p.path)).toEqual(['pages/index/index', 'pages/detail/detail', 'pages/vue/vue']);
  });

  it('自动刷新后 setup 出错没能启动，修好后的刷新仍恢复整个页面栈', async () => {
    await page.evaluate(() => window.__wxa_test_api__.navigateTo('/pages/detail/detail?id=7'));
    await waitForPage('pages/detail/detail');

    edit('wxa.setup.js', () => "export default { run() { throw new Error('setup 坏了'); } };");
    await page.waitForFunction(() => !(window as any).__hmrMarker, undefined, { timeout: 10000 });
    await page.waitForSelector('.wxa-error');

    await markHost();
    edit('wxa.setup.js', () => 'export default {};');
    await waitForReload();
    expect(await stack()).toEqual([
      { path: 'pages/index/index', query: {} },
      { path: 'pages/detail/detail', query: { id: '7' } }
    ]);
  });

  it('自动刷新后 setup 出错，开发者修好后手动刷新只恢复当前页面', async () => {
    await page.evaluate(() => window.__wxa_test_api__.navigateTo('/pages/detail/detail?id=7'));
    await waitForPage('pages/detail/detail');

    edit('wxa.setup.js', () => "export default { run() { throw new Error('setup 坏了'); } };");
    await page.waitForFunction(() => !(window as any).__hmrMarker, undefined, { timeout: 10000 });
    await page.waitForSelector('.wxa-error');

    // 不经过开发服务器：模拟开发者先手动刷新，再改好 setup
    await server!.close();
    fs.writeFileSync(path.join(projectPath, 'wxa.setup.js'), 'export default {};');
    server = new DevServer({ projectPath, port: Number(new URL(page.url()).port), watch: false, runtimeDir: RUNTIME_DIR, logger: { log: () => undefined, warn: () => undefined, error: () => undefined } });
    await server.start();
    await page.reload();
    await page.waitForFunction(() => window.__wxa_test_api__);
    await page.evaluate(() => window.__wxa_test_api__.ready);
    expect(await stack()).toEqual([{ path: 'pages/detail/detail', query: { id: '7' } }]);
  });

  it('开发者手动刷新时只恢复当前页面', async () => {
    await page.evaluate(() => window.__wxa_test_api__.navigateTo('/pages/detail/detail?id=7'));
    await waitForPage('pages/detail/detail');

    await page.reload();
    await page.waitForFunction(() => window.__wxa_test_api__);
    await page.evaluate(() => window.__wxa_test_api__.ready);
    expect(await stack()).toEqual([{ path: 'pages/detail/detail', query: { id: '7' } }]);
  });

  it('构建工具重写了大量内容没变的文件时，只按内容真正变化的文件热更新', async () => {
    const updated = hotUpdated();
    // uni-app 的监听构建每次保存都会重写全部 js 和 wxss
    for (const file of ['app.js', 'app.wxss', 'pages/detail/detail.js', 'components/badge/badge.js']) edit(file, content => content);
    edit('pages/index/index.wxml', wxml => wxml.replace('<view id="loads">', '<view id="hot">新节点</view><view id="loads">'));
    await updated;

    await waitForText('#hot', '新节点');
    expect(serverLogs.filter(line => line.includes('已更新'))).toEqual([expect.stringMatching(/^\[wxa-runner\] pages\/index\/index\.wxml 已更新/)]);
    expect(await hostReloaded()).toBe(false);
  });

  it('用 Component 构造的页面（如 uni-app）修改 JS 后重新挂载这一页：页面栈、globalData 保留，不整页刷新', async () => {
    await page.evaluate(() => window.__wxa_test_api__.navigateTo('/pages/vue/vue'));
    await waitForPage('pages/vue/vue');
    await tap('#inc');
    await waitForText('#n', '1');

    const updated = hotUpdated();
    edit('pages/vue/vue.js', js => js.replace("tag: 'old'", "tag: 'new'"));
    await updated;

    // 页面自己的状态随重新挂载回到初始值，与 Vite 下修改 Vue 组件 <script> 的语义一致
    await waitForText('#tag', 'new');
    expect(await textOf('#n')).toBe('0');
    expect((await page.evaluate(() => window.__wxa_test_api__.pageStack())).map(p => p.path)).toEqual(['pages/index/index', 'pages/vue/vue']);
    await page.evaluate(() => window.__wxa_test_api__.navigateBack());
    await waitForPage('pages/index/index');
    expect(await textOf('#loads')).toBe('1');
    expect(await hostReloaded()).toBe(false);
  });

  it('修改组件 JS 后只重新挂载这个组件，所在页面的状态保留', async () => {
    await tap('#add');
    await tap('#add');
    await waitForText('#count', '2');
    await tap('#badge wx-button');
    await waitForText('#badge wx-view', 'n=1');

    const updated = hotUpdated();
    edit('components/badge/badge.js', js => js.replace('this.data.n + 1', 'this.data.n + 10'));
    await updated;

    await waitForText('#badge wx-view', 'n=0');
    await tap('#badge wx-button');
    await waitForText('#badge wx-view', 'n=10');
    expect(await textOf('#count')).toBe('2');
    expect(await hostReloaded()).toBe(false);
  });

  it('新代码执行出错、无法热更新时退回整页刷新', async () => {
    edit('pages/detail/detail.js', () => "throw new Error('页面模块出错');");
    await page.waitForFunction(() => !(window as any).__hmrMarker, undefined, { timeout: 10000 });
  });
});
