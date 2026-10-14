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
import { createProject, hasDevtools, REPO_ROOT } from '../helpers';

const RUNTIME_DIR = path.join(REPO_ROOT, 'packages/core/dist/runtime');
const CHROME = process.env.WXA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ready = hasDevtools() && fs.existsSync(path.join(RUNTIME_DIR, 'host.js')) && fs.existsSync(CHROME);

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

function miniProgram() {
  return createProject({
    'project.config.json': { appid: 'wxtest0000000000', compileType: 'miniprogram' },
    'app.json': { pages: ['pages/index/index', 'pages/detail/detail'], usingComponents: { badge: '/components/badge/badge' } },
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
    'components/badge/badge.json': { component: true },
    'components/badge/badge.js': BADGE_JS,
    'components/badge/badge.wxml': '<view class="badge-n">n={{n}}</view><button class="badge-inc" bindtap="inc">inc</button>',
    'components/badge/badge.wxss': ''
  });
}

describe.skipIf(!ready)('热更新', () => {
  let server: DevServer | undefined;
  let browser: Browser;
  let page: Page;
  let projectPath = '';

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
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined }
    });
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
    await tap('.badge-inc');
    await tap('.badge-inc');
    await waitForText('.badge-n', 'n=2');

    edit('components/badge/badge.wxml', wxml => wxml.replace('n={{n}}', '徽标 {{n}}'));

    await waitForText('.badge-n', '徽标 2');
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

  it('修改 app.js 这类无法热更新的文件时整页刷新，并停留在当前页面', async () => {
    await page.evaluate(() => window.__wxa_test_api__.navigateTo('/pages/detail/detail'));
    await waitForPage('pages/detail/detail');

    edit('app.js', js => js.replace('loads: 0', 'loads: 100'));

    await page.waitForFunction(() => !(window as any).__hmrMarker, undefined, { timeout: 10000 });
    await page.waitForFunction(() => window.__wxa_test_api__);
    await page.evaluate(() => window.__wxa_test_api__.ready);
    expect((await page.evaluate(() => window.__wxa_test_api__.currentPage()))!.path).toBe('pages/detail/detail');
  });

  it('页面改用 Component 构造时无法热替换，退回整页刷新且新代码生效', async () => {
    edit('pages/detail/detail.js', () => "Component({ data: { tag: 'component' } });");

    await page.waitForFunction(() => !(window as any).__hmrMarker, undefined, { timeout: 10000 });
    await page.waitForFunction(() => window.__wxa_test_api__);
    await page.evaluate(() => window.__wxa_test_api__.ready);
    await page.evaluate(() => window.__wxa_test_api__.navigateTo('/pages/detail/detail'));
    await waitForPage('pages/detail/detail');
    await waitForText('#tag', 'component');
  });
});
