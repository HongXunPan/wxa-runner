/**
 * 端到端：测试 API 读取页面 data、调用页面方法、记录和拦截请求，以及小程序启动前声明 mock
 *
 * 需要本机安装微信开发者工具，以及 Chrome（或通过 WXA_CHROME 指定浏览器路径）。
 */

import http from 'http';
import { AddressInfo } from 'net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { e2eReady, expectText, Runner, startRunner } from './runner';

const PAGES = {
  'app.json': { pages: ['pages/index/index', 'pages/detail/detail'] },
  'pages/index/index.json': {},
  'pages/index/index.wxml': '<view id="count">{{count}}</view><view id="user">{{user.name}}:{{user.tags}}</view>',
  'pages/index/index.js': `
    Page({
      data: { count: 0, user: { name: 'Tom', tags: [] } },
      add(step) {
        this.setData({ count: this.data.count + step });
        return this.data.count;
      },
      setUser(user) {
        this.setData({ user });
      },
      send(url, data) {
        return new Promise(resolve => wx.request({
          url, method: 'POST', data,
          success: res => resolve({ status: res.statusCode, data: res.data }),
          fail: err => resolve({ error: err.errMsg })
        }));
      }
    });
  `,
  'pages/detail/detail.json': {},
  'pages/detail/detail.wxml': '<view id="id">{{id}}</view>',
  'pages/detail/detail.js': 'Page({ data: { id: "" }, onLoad(query) { this.setData({ id: query.id }); } });'
};

// 启动时先登录，再拉取配置：都发生在测试能 evaluate 之前
const LAUNCH_APP = {
  'app.json': { pages: ['pages/index/index'] },
  'app.js': `
    App({
      onLaunch() {
        this.launched = new Promise(resolve => wx.login({
          success: ({ code }) => wx.request({
            url: 'https://api.example.com/api/config',
            success: res => resolve({ code, theme: res.data.theme }),
            fail: () => resolve({ code, theme: '配置拉取失败' })
          })
        }));
      }
    });
  `,
  'wxa.setup.js': `export default { mock: { login: { code: 'from-setup' } } };`,
  'pages/index/index.json': {},
  'pages/index/index.wxml': '<view id="code">{{code}}</view><view id="theme">{{theme}}</view>',
  'pages/index/index.js': 'Page({ data: { code: "", theme: "" }, onLoad() { getApp().launched.then(res => this.setData(res)); } });'
};

/** 回显请求的上游服务：经开发服务器代理转发的请求到这里 */
let upstream: http.Server;
let upstreamUrl = '';

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ path: req.url, body }));
    });
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', () => resolve()));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});

afterAll(() => {
  upstream?.close();
});

describe.skipIf(!e2eReady)('测试 API：读取页面与请求', () => {
  let runner: Runner;

  beforeAll(async () => {
    runner = await startRunner(PAGES);
  });

  afterAll(async () => {
    await runner?.close();
  });

  const send = (url: string, data: object) =>
    runner.page.evaluate(([u, d]) => window.__wxa_test_api__.callPageMethod('send', u, d), [url, data] as const) as Promise<any>;

  it('测试读到当前页的 data，跳转后读到新页面的；传路径时读页面栈里的那一页', async () => {
    const { page } = runner;
    await runner.open('/?path=pages/index/index');
    expect(await page.evaluate(() => window.__wxa_test_api__.pageData())).toEqual({ count: 0, user: { name: 'Tom', tags: [] } });

    await page.evaluate(() => window.__wxa_test_api__.navigateTo('/pages/detail/detail?id=7'));
    await page.waitForFunction(() => window.__wxa_test_api__.pageData()?.id === '7');
    expect(await page.evaluate(() => window.__wxa_test_api__.pageData())).toEqual({ id: '7' });
    expect(await page.evaluate(() => window.__wxa_test_api__.pageData('pages/index/index'))).toEqual({ count: 0, user: { name: 'Tom', tags: [] } });
    expect(await page.evaluate(() => window.__wxa_test_api__.pageData('/pages/missing/missing'))).toBeNull();
  });

  it('测试调用当前页的方法，页面按参数更新并拿到返回值；方法不存在时报错说明', async () => {
    const { page } = runner;
    const frame = await runner.open('/?path=pages/index/index');

    expect(await page.evaluate(() => window.__wxa_test_api__.callPageMethod('add', 2))).toBe(2);
    await expectText(frame, '#count', '2');

    await page.evaluate(() => window.__wxa_test_api__.callPageMethod('setUser', { name: 'Ann', tags: ['a', 'b'] }));
    await expectText(frame, '#user', 'Ann:a,b');

    await expect(page.evaluate(() => window.__wxa_test_api__.callPageMethod('remove'))).rejects.toThrow(/remove/);
  });

  it('小程序发出的请求都被记录，不论被拦截还是经代理转发；可以按规则筛选和清空', async () => {
    const { page } = runner;
    await runner.open('/?path=pages/index/index');
    await page.evaluate(() => window.__wxa_test_api__.route('POST **/api/order', { body: { ok: true } }));

    expect(await send('https://api.example.com/api/order', { sku: 'A1' })).toEqual({ status: 200, data: { ok: true } });
    expect(await send(upstreamUrl + '/echo', { sku: 'B2' })).toMatchObject({ status: 200, data: { body: '{"sku":"B2"}' } });

    expect(await page.evaluate(() => window.__wxa_test_api__.requests())).toEqual([
      {
        method: 'POST',
        url: 'https://api.example.com/api/order',
        header: expect.objectContaining({ 'content-type': 'application/json' }),
        data: '{"sku":"A1"}',
        routedBy: 'POST **/api/order'
      },
      { method: 'POST', url: upstreamUrl + '/echo', header: expect.any(Object), data: '{"sku":"B2"}', routedBy: null }
    ]);
    expect(await page.evaluate(() => window.__wxa_test_api__.requests('**/echo'))).toEqual([
      expect.objectContaining({ url: upstreamUrl + '/echo' })
    ]);

    await page.evaluate(() => window.__wxa_test_api__.clearRequests());
    expect(await page.evaluate(() => window.__wxa_test_api__.requests())).toEqual([]);
  });

  it('测试在运行中拦截请求：后加的规则优先，取消拦截后请求照常发出', async () => {
    const { page } = runner;
    await runner.open('/?path=pages/index/index');
    const url = upstreamUrl + '/api/user';

    await page.evaluate(() => window.__wxa_test_api__.route('**/api/user', { body: { name: 'A' } }));
    expect((await send(url, {})).data).toEqual({ name: 'A' });

    await page.evaluate(() => window.__wxa_test_api__.route('**/api/user', req => ({ body: { name: 'B', sent: req.data } })));
    expect((await send(url, { id: 1 })).data).toEqual({ name: 'B', sent: '{"id":1}' });

    await page.evaluate(() => window.__wxa_test_api__.unroute('**/api/user'));
    expect((await send(url, {})).data).toEqual({ path: '/api/user', body: '{}' });

    await expect(page.evaluate(() => window.__wxa_test_api__.route('FETCH https://a.com/x', {}))).rejects.toThrow(/请求方法/);
  });

  it('测试用 mock 覆盖 wx.request 时得到提示，改用 route 拦截', async () => {
    await runner.open('/?path=pages/index/index');
    await expect(runner.page.evaluate(() => window.__wxa_test_api__.mock('request', {}))).rejects.toThrow(/route/);
  });
});

describe.skipIf(!e2eReady)('测试 API：小程序启动前声明 mock 和拦截', () => {
  let runner: Runner | undefined;

  afterEach(async () => {
    await runner?.close();
    runner = undefined;
  });

  it('测试工具在页面加载前声明的 mock 和拦截，App.onLaunch 里就生效，并覆盖 setup 的同名 mock', async () => {
    runner = await startRunner(LAUNCH_APP);
    await runner.page.addInitScript(() => {
      (window as any).__wxa_before_launch__ = async (api: typeof window.__wxa_test_api__) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        api.mock('login', { code: 'from-test' });
        api.route('**/api/config', { body: { theme: 'dark' } });
      };
    });

    const frame = await runner.open('/');
    await expectText(frame, '#code', 'from-test');
    await expectText(frame, '#theme', 'dark');
  });

  it('启动前的声明出错时，模拟器显示错误，小程序不启动', async () => {
    runner = await startRunner(LAUNCH_APP);
    const { page } = runner;
    await page.addInitScript(() => {
      (window as any).__wxa_before_launch__ = () => {
        throw new Error('测试数据准备失败');
      };
    });

    await page.goto(runner.base + '/');
    await page.waitForSelector('.wxa-error');
    expect(await page.textContent('.wxa-error')).toMatch(/测试数据准备失败/);
    expect(await page.evaluate(() => window.__wxa_test_api__.currentPage())).toBeNull();
  });
});
