/**
 * fixture：项目有 setup 时，撤销 setup 声明的 mock、拦截后再次打开页面不会恢复
 */

import http from 'http';
import { AddressInfo } from 'net';
import { expect, test } from '@open-wxa/wxa-runner-playwright';

// 按 worker 生效的选项只能写在文件顶层
test.use({ wxaServerOptions: { setup: 'tests/playwright/setup/declared.setup.js' } });

let upstream: http.Server;
let upstreamUrl = '';

test.beforeAll(async () => {
  upstream = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', () => resolve()));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});

test.afterAll(() => {
  upstream?.close();
});

test('撤销 setup 声明的 mock 后再次打开页面，mock 不会恢复', async ({ miniProgram }) => {
  await miniProgram.open();
  await expect(miniProgram.current.locator('#code')).toHaveText('from-setup');

  await miniProgram.unmock('login');
  await miniProgram.open();
  await expect(miniProgram.current.locator('#code')).toHaveText(/^wxa_mock_code_/);
});

test('撤销全部 mock 后再次打开页面，setup 的 mock 也不会恢复', async ({ miniProgram }) => {
  await miniProgram.open();
  await miniProgram.unmock();

  await miniProgram.open();
  await expect(miniProgram.current.locator('#code')).toHaveText(/^wxa_mock_code_/);
});

test('撤销 setup 声明的拦截后再次打开页面，请求照常发往网络', async ({ miniProgram }) => {
  await miniProgram.open();
  expect(await miniProgram.callPageMethod('send', `${upstreamUrl}/api/feedback`, {})).toEqual({ ok: 'from-setup' });

  await miniProgram.unroute('POST **/api/feedback');
  await miniProgram.open();
  expect(await miniProgram.callPageMethod('send', `${upstreamUrl}/api/feedback`, {})).toEqual({ ok: true });
});
