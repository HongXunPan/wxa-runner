/**
 * 端到端：页面调用了运行时没有实现的原生 API，测试能从 errors() 发现
 *
 * 未实现的 API 为了不打断业务代码仍返回成功，但业务往往依赖真实结果（如 chooseImage 的 tempFilePaths），
 * 光返回 ok 会让测试「假通过」。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { e2eReady, expectText, Runner, startRunner } from './runner';

// addPhoneContact 在浏览器里做不到，运行时不会实现
const PAGE_JS = `
Page({
  data: { contact: '', clipboard: '' },
  onLoad() {
    wx.addPhoneContact({ firstName: '张三', complete: res => this.setData({ contact: res.errMsg }) });
  },
  onPaste() {
    wx.getClipboardData({ success: res => this.setData({ clipboard: res.data }) });
  }
});
`;

describe.skipIf(!e2eReady)('未实现的原生 API', () => {
  let runner: Runner;

  beforeAll(async () => {
    runner = await startRunner({
      'app.json': { pages: ['pages/index/index'] },
      'pages/index/index.json': {},
      'pages/index/index.wxml': '<view id="contact">{{contact}}</view><button id="paste" bindtap="onPaste">粘贴</button><view id="clipboard">{{clipboard}}</view>',
      'pages/index/index.js': PAGE_JS
    });
  });

  afterAll(async () => {
    await runner?.close();
  });

  it('页面调用了未实现的 API 时，测试从 errors() 读到 API 名称', async () => {
    const frame = await runner.open('/');
    await expectText(frame, '#contact', 'addPhoneContact:ok');

    const errors = await runner.page.evaluate(() => window.__wxa_test_api__.errors());
    expect(errors).toEqual([expect.objectContaining({ api: 'addPhoneContact', message: expect.stringContaining('wx.addPhoneContact') })]);
  });

  it('测试 mock 过的 API 不记入 errors()', async () => {
    const frame = await runner.open('/');
    await runner.page.evaluate(() => window.__wxa_test_api__.mock('getClipboardData', { data: '来自 mock' }));

    await frame.click('#paste');

    await expectText(frame, '#clipboard', '来自 mock');
    const errors = await runner.page.evaluate(() => window.__wxa_test_api__.errors());
    expect(errors.map(error => error.api)).toEqual(['addPhoneContact']);
  });
});
