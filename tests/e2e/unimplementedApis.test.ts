/**
 * 端到端：业务代码调用了运行时没有实现的 wx API，测试能从 errors() 发现
 *
 * 未实现的 API 为了不打断业务代码仍返回成功，但业务往往依赖真实结果（如 chooseInvoiceTitle 的抬头），
 * 光返回 ok 会让测试「假通过」。基础库自己也会调用一些没有实现的原生接口，这些不是业务的问题，不能记。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { e2eReady, expectText, installedBaseLibs, Runner, startRunner, VERIFIED_BASELIBS } from './runner';

// addPhoneContact 在浏览器里做不到，运行时不会实现
const PAGE_JS = `
Page({
  data: { contact: '', invoice: '' },
  onLoad() {
    wx.addPhoneContact({ firstName: '张三' });
    wx.addPhoneContact({ firstName: '李四', complete: res => this.setData({ contact: res.errMsg }) });
  },
  onChooseInvoice() {
    wx.chooseInvoiceTitle({ success: res => this.setData({ invoice: res.title }) });
  }
});
`;

describe.skipIf(!e2eReady)('未实现的 wx API', () => {
  let runner: Runner;

  beforeAll(async () => {
    runner = await startRunner({
      'app.json': { pages: ['pages/index/index'] },
      'pages/index/index.json': {},
      'pages/index/index.wxml': '<view id="contact">{{contact}}</view><button id="invoice" bindtap="onChooseInvoice">选发票抬头</button><view id="invoice-title">{{invoice}}</view>',
      'pages/index/index.js': PAGE_JS
    });
  });

  afterAll(async () => {
    await runner?.close();
  });

  it('页面调用了未实现的 API 时，测试从 errors() 读到 API 名称，调用多次只记一次', async () => {
    const frame = await runner.open('/');
    await expectText(frame, '#contact', 'addPhoneContact:ok');

    const errors = await runner.page.evaluate(() => window.__wxa_test_api__.errors());
    expect(errors).toEqual([
      expect.objectContaining({ kind: 'service', webviewId: 0, api: 'addPhoneContact', message: expect.stringContaining('wx.addPhoneContact') })
    ]);
  });

  it('测试 mock 过的未实现 API 不记入 errors()', async () => {
    const frame = await runner.open('/');
    await runner.page.evaluate(() => window.__wxa_test_api__.mock('chooseInvoiceTitle', { type: 0, title: '测试公司' }));

    await frame.click('#invoice');

    await expectText(frame, '#invoice-title', '测试公司');
    const errors = await runner.page.evaluate(() => window.__wxa_test_api__.errors());
    expect(errors.map(error => error.api)).toEqual(['addPhoneContact']);
  });
});

describe.skipIf(!e2eReady)('基础库内部调用的原生接口', () => {
  for (const version of VERIFIED_BASELIBS) {
    describe.skipIf(!installedBaseLibs.has(version))(`基础库 ${version}`, () => {
      let runner: Runner;

      beforeAll(async () => {
        runner = await startRunner({
          'app.json': {
            pages: ['pages/index/index', 'pages/privacy/privacy'],
            permission: { 'scope.userLocation': { desc: '展示附近的门店' } },
            requiredPrivateInfos: ['getLocation']
          },
          'pages/index/index.json': {},
          // 原生组件和第一次调用 wx API 时，基础库会调用一些运行时没有实现的内部接口
          'pages/index/index.wxml': '<video src="/missing.mp4"></video><map latitude="0" longitude="0"></map><canvas type="2d"></canvas><view id="step">{{step}}</view>',
          'pages/index/index.js': "Page({ data: { step: '' }, onLoad() { wx.getClipboardData({}); this.setData({ step: '已调用' }); } });",
          'pages/privacy/privacy.json': {},
          'pages/privacy/privacy.wxml': '<view>{{done}}</view>',
          'pages/privacy/privacy.js': `Page({
            data: { done: 0, results: {} },
            onLoad() {
              const record = name => res => this.setData({ done: this.data.done + 1, ['results.' + name]: res.errMsg });
              wx.authorize({ scope: 'scope.userLocation', complete: record('authorize') });
              wx.getLocation({ type: 'gcj02', complete: record('getLocation') });
              wx.getClipboardData({ complete: record('getClipboardData') });
            }
          });`
        }, { baseLibVersion: version });
      });

      afterAll(async () => {
        await runner?.close();
      });

      it('页面只用已实现的 API 和原生组件时，errors() 为空', async () => {
        const frame = await runner.open('/');
        await expectText(frame, '#step', '已调用');

        expect(await runner.page.evaluate(() => window.__wxa_test_api__.errors())).toEqual([]);
      });

      it('业务调用要做隐私检查的接口（授权、定位、剪贴板）都能收到回调', async () => {
        const { page } = runner;
        await runner.open('/?path=pages/privacy/privacy');
        await page.waitForFunction(() => window.__wxa_test_api__.pageData()?.done === 3, undefined, { timeout: 5000 }).catch(() => undefined);

        expect(await page.evaluate(() => window.__wxa_test_api__.pageData())).toEqual({
          done: 3,
          results: { authorize: 'authorize:ok', getLocation: 'getLocation:ok', getClipboardData: 'getClipboardData:ok' }
        });
      });
    });
  }
});
