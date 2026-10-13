/**
 * 端到端：在真实浏览器里用官方基础库运行 examples/showcase
 *
 * 需要本机安装微信开发者工具，以及 Chrome（或通过 WXA_CHROME 指定浏览器路径）。
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { Browser, chromium, Frame, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DevServer } from '../../packages/core/src/server/DevServer';
import { EXAMPLES, hasDevtools, REPO_ROOT } from '../helpers';

const RUNTIME_DIR = path.join(REPO_ROOT, 'packages/core/dist/runtime');
const CHROME = process.env.WXA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ready = hasDevtools() && fs.existsSync(path.join(RUNTIME_DIR, 'host.js')) && fs.existsSync(CHROME);

describe.skipIf(!ready)('showcase 示例', () => {
  let server: DevServer;
  let browser: Browser;
  let page: Page;
  let base = '';

  const currentFrame = async (): Promise<Frame> => {
    const { frameName } = await page.evaluate(() => (window as any).__wxa_test_api__.currentPage());
    return page.frame({ name: frameName })!;
  };
  const waitForPage = (pagePath: string) =>
    page.evaluate(p => (window as any).__wxa_test_api__.waitForPage(p), pagePath);
  const open = async (url = '/') => {
    await page.goto(base + url);
    await page.waitForFunction(() => (window as any).__wxa_test_api__);
    await page.evaluate(() => (window as any).__wxa_test_api__.ready);
    return currentFrame();
  };

  beforeAll(async () => {
    server = new DevServer({
      projectPath: path.join(EXAMPLES, 'showcase'),
      port: 0,
      watch: false,
      runtimeDir: RUNTIME_DIR,
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined }
    });
    base = await server.start();
    browser = await chromium.launch({ executablePath: CHROME });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it('首页由官方基础库渲染：数据绑定、wxs、列表与条件渲染、rpx', async () => {
    const frame = await open();
    expect(await frame.textContent('#greeting')).toBe('Hello from the official base library');
    expect(await frame.textContent('#price')).toBe('价格：¥123.45');
    expect(await frame.locator('.item').count()).toBe(3);
    expect(await frame.textContent('#many')).toBe('共 3 项');
    // 24rpx 在 375 宽的设备上是 12px
    expect(await frame.evaluate(() => getComputedStyle(document.querySelector('.card')!).padding)).toBe('12px');
    expect(await page.textContent('.wxa-navbar-title')).toBe('首页');
  });

  it('自定义组件：点击组件内按钮一次，组件和父页面各更新一次', async () => {
    const frame = await open();
    await frame.click('wx-counter wx-button');
    await frame.waitForFunction(() => document.querySelector('#parent-count')!.textContent === '父页面收到：2');
    expect(await frame.textContent('wx-counter .counter--label')).toBe('组件计数: 2');
  });

  it('showToast 与 showModal 由宿主渲染，modal 的结果回传给页面', async () => {
    const frame = await open();
    await frame.click('#btn-toast');
    await expect(page.textContent('.wxa-toast-title')).resolves.toBe('你好');

    await frame.click('#btn-modal');
    await page.click('.wxa-modal-cancel');
    await frame.waitForFunction(() => document.querySelector('#modal-result')!.textContent === 'cancel');
  });

  it('wx.request 经代理发出，mock 后返回指定数据', async () => {
    const frame = await open();
    await page.evaluate(() => (window as any).__wxa_test_api__.mock('createRequestTask', (_args: unknown, ctx: any) => {
      // mock 的是原生层，结果仍要按协议通过事件回传
      setTimeout(() => (window as any).__wxaHost.emitToService('onRequestTaskStateChange', {
        requestTaskId: 'm1', state: 'success', data: '{"ok":true}', statusCode: 201, header: {}
      }));
      return { requestTaskId: 'm1', errMsg: `${ctx.api}:ok` };
    }));
    await frame.click('#btn-request');
    await frame.waitForFunction(() => document.querySelector('#request-result')!.textContent === 'status 201');
    await page.evaluate(() => (window as any).__wxa_test_api__.unmock('createRequestTask'));
  });

  it('navigateTo 带参数打开新页面，navigateBack 回到原页面且状态保留', async () => {
    let frame = await open();
    await frame.click('wx-counter wx-button');
    await frame.click('#btn-detail');
    const detail = await waitForPage('pages/detail/detail');
    expect(detail.query).toEqual({ id: '42' });

    frame = await currentFrame();
    expect(await frame.textContent('#detail-id')).toBe('id = 42');
    expect(await page.isVisible('.wxa-navbar-back')).toBe(true);
    expect(await page.isVisible('.wxa-tabbar')).toBe(false);
    expect(page.url()).toContain('path=pages%2Fdetail%2Fdetail&id=42');

    await frame.click('#btn-back');
    await waitForPage('pages/index/index');
    frame = await currentFrame();
    expect(await frame.textContent('#parent-count')).toBe('父页面收到：2');
    expect(await page.evaluate(() => (window as any).__wxa_test_api__.pageStack().length)).toBe(1);
  });

  it('tabBar 切换页面，切回时页面实例保留', async () => {
    let frame = await open();
    await frame.click('wx-counter wx-button');
    await page.click('.wxa-tabbar-item[data-page-path="pages/mine/mine"]');
    await waitForPage('pages/mine/mine');
    frame = await currentFrame();
    expect(await frame.textContent('#mine-visits')).toMatch(/首页访问次数：\d+/);

    await page.click('.wxa-tabbar-item[data-page-path="pages/index/index"]');
    await waitForPage('pages/index/index');
    frame = await currentFrame();
    expect(await frame.textContent('#parent-count')).toBe('父页面收到：2');
  });

  it('通过 ?path= 直接打开指定页面，Storage 可以从测试中读取', async () => {
    const frame = await open('/?path=pages/detail/detail&id=7');
    expect(await frame.textContent('#detail-id')).toBe('id = 7');
    expect(await page.evaluate(() => typeof (window as any).__wxa_test_api__.getStorage('showcase:visits'))).toBe('number');
  });

  it('默认字号固定为 16px，不受浏览器字号设置影响', async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wxa-chrome-'));
    fs.mkdirSync(path.join(profile, 'Default'));
    fs.writeFileSync(path.join(profile, 'Default/Preferences'), JSON.stringify({ webkit: { webprefs: { default_font_size: 20 } } }));
    const context = await chromium.launchPersistentContext(profile, { executablePath: CHROME });
    try {
      const tab = await context.newPage();
      await tab.goto(base + '/');
      await tab.waitForFunction(() => (window as any).__wxa_test_api__);
      await tab.evaluate(() => (window as any).__wxa_test_api__.ready);
      const { frameName } = await tab.evaluate(() => (window as any).__wxa_test_api__.currentPage());
      const frame = tab.frame({ name: frameName })!;
      expect(await frame.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('16px');
    } finally {
      await context.close();
    }
  });

  it('整个过程中逻辑层和渲染层没有未捕获的错误', async () => {
    expect(await page.evaluate(() => (window as any).__wxa_test_api__.errors())).toEqual([]);
  });
});
