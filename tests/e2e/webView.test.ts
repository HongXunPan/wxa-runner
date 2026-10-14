/**
 * 端到端：web-view 组件
 *
 * web-view 铺满整个页面显示 src 指向的网页；网页跟着所在页面走，页面关闭时一起消失。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { e2eReady, expectText, Runner, startRunner } from './runner';

const WEB_WXML = `
<web-view src="{{src}}" bindload="onWebLoad"></web-view>
<view id="loaded">{{loaded}}</view>
`;

const WEB_JS = `
Page({
  data: { src: '', loaded: '' },
  onLoad(query) {
    this.next = decodeURIComponent(query.next || '');
    this.setData({ src: decodeURIComponent(query.src || '') });
  },
  onWebLoad(e) {
    this.setData({ loaded: e.detail.src });
    // 第一个网页加载完后改 src，模拟页面切换网页
    if (this.next) {
      const next = this.next;
      this.next = '';
      this.setData({ src: next });
    }
  }
});
`;

describe.skipIf(!e2eReady)('web-view', () => {
  let runner: Runner;
  let hello = '';
  let bye = '';

  const webPage = (url: string) => `/?path=pages/web/web&src=${encodeURIComponent(url)}`;
  const embedded = () => runner.page.frameLocator('iframe[data-current]').frameLocator('iframe');

  beforeAll(async () => {
    runner = await startRunner({
      'app.json': { pages: ['pages/index/index', 'pages/web/web'] },
      'pages/index/index.json': {},
      'pages/index/index.wxml': '<view>首页</view>',
      'pages/index/index.js': 'Page({});',
      'pages/web/web.json': {},
      'pages/web/web.wxml': WEB_WXML,
      'pages/web/web.js': WEB_JS,
      'h5/hello.html': '<!doctype html><meta charset="utf-8"><h1 id="title">Hello H5</h1>',
      'h5/bye.html': '<!doctype html><meta charset="utf-8"><h1 id="title">Bye H5</h1>'
    });
    hello = runner.base + '/h5/hello.html';
    bye = runner.base + '/h5/bye.html';
  });

  afterAll(() => runner?.close());

  it('web-view 铺满页面显示 src 指向的网页，加载完成后页面收到 load', async () => {
    const frame = await runner.open(webPage(hello));
    await expect(embedded().locator('#title').textContent()).resolves.toBe('Hello H5');
    await expectText(frame, '#loaded', hello);

    const layout = await frame.evaluate(() => {
      const rect = document.querySelector('iframe')!.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, windowWidth: innerWidth, windowHeight: innerHeight };
    });
    expect(layout).toMatchObject({ left: 0, top: 0, width: layout.windowWidth, height: layout.windowHeight });
  });

  it('页面改了 src 后 web-view 打开新地址', async () => {
    const frame = await runner.open(`${webPage(hello)}&next=${encodeURIComponent(bye)}`);
    await expectText(frame, '#loaded', bye);
    await expect(embedded().locator('#title').textContent()).resolves.toBe('Bye H5');
  });

  it('返回上一页后网页随页面一起关闭', async () => {
    await runner.open('/?path=pages/index/index');
    await runner.page.evaluate(url => window.__wxa_test_api__.navigateTo(url), `/pages/web/web?src=${encodeURIComponent(hello)}`);
    await expect(embedded().locator('#title').textContent()).resolves.toBe('Hello H5');

    await runner.page.evaluate(() => window.__wxa_test_api__.navigateBack());
    expect(runner.page.frames().some(frame => frame.url() === hello)).toBe(false);
  });
});
