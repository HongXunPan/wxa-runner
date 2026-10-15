/**
 * fixture：拦截 wx.request，断言小程序发出的请求
 */

import http from 'http';
import { AddressInfo } from 'net';
import { expect, test } from '@open-wxa/wxa-runner-playwright';

/** 经开发服务器代理转发的请求到这里，记下收到的请求体 */
let upstream: http.Server;
let upstreamUrl = '';
const received: string[] = [];

test.beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      received.push(body);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', () => resolve()));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});

test.afterAll(() => {
  upstream?.close();
});

test('开发者断言被拦截的请求的请求体', async ({ miniProgram }) => {
  await miniProgram.route('POST **/api/orders', { status: 201, body: { id: 'o-1' } });
  await miniProgram.open();

  await miniProgram.current.locator('#add').click();
  await miniProgram.current.locator('#order-btn').click();
  await expect(miniProgram.current.locator('#order')).toHaveText('下单成功：o-1');

  const request = await miniProgram.waitForRequest('POST **/api/orders');
  expect(request.body).toEqual({ sku: 'A1', count: 1 });
  expect(request.routedBy).toBe('POST **/api/orders');
});

test('开发者断言经代理转发的请求的请求体', async ({ miniProgram }) => {
  await miniProgram.open();

  expect(await miniProgram.callPageMethod('send', `${upstreamUrl}/api/feedback`, { text: '好用' })).toEqual({ ok: true });

  const request = await miniProgram.waitForRequest('POST **/api/feedback');
  expect(request.body).toEqual({ text: '好用' });
  expect(request.routedBy).toBeNull();
  expect(received).toContain('{"text":"好用"}');
});

test('开发者用 Node 里的函数按请求体返回响应', async ({ miniProgram }) => {
  await miniProgram.route('POST **/api/orders', request => ({ status: 201, body: { id: `o-${request.body.count}` } }));
  await miniProgram.open();

  await miniProgram.callPageMethod('add', 3);
  await miniProgram.current.locator('#order-btn').click();
  await expect(miniProgram.current.locator('#order')).toHaveText('下单成功：o-3');
});

test('取消拦截后，请求照常发往网络', async ({ miniProgram }) => {
  await miniProgram.open();
  await miniProgram.route('**/api/feedback', { body: { ok: 'mocked' } });
  expect(await miniProgram.callPageMethod('send', `${upstreamUrl}/api/feedback`, {})).toEqual({ ok: 'mocked' });

  await miniProgram.unroute('**/api/feedback');
  expect(await miniProgram.callPageMethod('send', `${upstreamUrl}/api/feedback`, {})).toEqual({ ok: true });
});

test('请求发出后马上取消拦截，已发出的请求仍由原来的函数处理', async ({ miniProgram }) => {
  await miniProgram.open();
  await miniProgram.route('POST **/api/orders', () => ({ status: 201, body: { id: 'o-node' } }));

  // wx.request 同步发出：callPageMethod 的那次 evaluate 里请求就已经匹配了这条规则
  const sent = miniProgram.callPageMethod('send', 'https://api.example.com/api/orders', {});
  await miniProgram.unroute('POST **/api/orders');

  expect(await sent).toEqual({ id: 'o-node' });
});

test('只关心某个操作之后的请求时，先清空已记录的请求', async ({ miniProgram }) => {
  await miniProgram.route('POST **/api/orders', { status: 201, body: { id: 'o-1' } });
  await miniProgram.open();
  await miniProgram.current.locator('#order-btn').click();
  await expect(miniProgram.current.locator('#order')).toHaveText('下单成功：o-1');

  await miniProgram.clearRequests();
  await miniProgram.current.locator('#add').click();
  await miniProgram.current.locator('#order-btn').click();

  expect((await miniProgram.waitForRequest('POST **/api/orders')).body).toEqual({ sku: 'A1', count: 1 });
  expect(await miniProgram.requests()).toHaveLength(1);
});

test('等待的请求一直没有发出时，超时报错并列出已发出的请求', async ({ miniProgram }) => {
  await miniProgram.route('POST **/api/orders', { status: 201, body: { id: 'o-1' } });
  await miniProgram.open();
  await miniProgram.current.locator('#order-btn').click();
  await expect(miniProgram.current.locator('#order')).toHaveText('下单成功：o-1');

  await expect(miniProgram.waitForRequest('GET **/api/orders', { timeout: 300 }))
    .rejects.toThrow(/GET \*\*\/api\/orders[\s\S]*POST https:\/\/api\.example\.com\/api\/orders/);
});
