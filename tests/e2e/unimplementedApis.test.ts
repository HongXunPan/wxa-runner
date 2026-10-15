/**
 * 端到端：业务代码调用了运行时没有实现的 wx API，测试能从 errors() 发现
 *
 * 未实现的 API 为了不打断业务代码仍返回成功，但业务往往依赖真实结果（如 chooseInvoiceTitle 的抬头），
 * 光返回 ok 会让测试「假通过」。基础库自己也会调用一些没有实现的原生接口，这些不是业务的问题，不能记。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listBaseLibs } from '../../packages/extractor/src/baselib';
import { e2eReady, expectText, Runner, startRunner } from './runner';

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

// README 列出的已验证版本。基础库内部调用哪些原生接口因版本而异，本机有哪个就测哪个（CI 上只有内置的 3.7.0）
const VERIFIED_BASELIBS = ['2.32.3', '3.3.4', '3.5.8', '3.7.0'];
const installed = e2eReady ? new Set(listBaseLibs().map(lib => lib.version)) : new Set<string>();

describe.skipIf(!e2eReady)('基础库内部调用的原生接口', () => {
  for (const version of VERIFIED_BASELIBS) {
    it.skipIf(!installed.has(version))(`基础库 ${version}：页面只用已实现的 API 和原生组件时，errors() 为空`, async () => {
      const runner = await startRunner({
        'app.json': { pages: ['pages/index/index'] },
        'pages/index/index.json': {},
        // 原生组件和第一次调用 wx API 时，基础库会调用一些运行时没有实现的内部接口
        'pages/index/index.wxml': '<video src="/missing.mp4"></video><map latitude="0" longitude="0"></map><canvas type="2d"></canvas><view id="step">{{step}}</view>',
        // 不等回调：2.32.3 的隐私检查要 getAppContact 返回真实数据，否则剪贴板这类接口不会回调
        'pages/index/index.js': "Page({ data: { step: '' }, onLoad() { wx.getClipboardData({}); this.setData({ step: '已调用' }); } });"
      }, { baseLibVersion: version });
      try {
        const frame = await runner.open('/');
        await expectText(frame, '#step', '已调用');

        expect(await runner.page.evaluate(() => window.__wxa_test_api__.errors())).toEqual([]);
      } finally {
        await runner.close();
      }
    });
  }
});
