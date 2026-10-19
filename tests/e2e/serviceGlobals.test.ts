/**
 * e2e：逻辑层没有真机上不存在的浏览器全局对象
 *
 * 真机的逻辑层没有 DOM。业务代码里的 window、document 等被模块包装屏蔽（同开发者工具），但第三方库常经
 * Function('return this')() 拿到全局对象，按上面有没有 MutationObserver 判断是否在浏览器里。
 * 如 core-js 2 的微任务 polyfill：看到它就去用 document，app.js 执行出错，App 注册不上。
 */

import { afterAll, beforeAll, describe, it } from 'vitest';
import { e2eReady, expectText, Runner, startRunner } from './runner';

describe.skipIf(!e2eReady)('逻辑层没有真机上不存在的浏览器全局对象', () => {
  let runner: Runner;

  beforeAll(async () => {
    runner = await startRunner({
      'app.json': { pages: ['pages/index/index'] },
      'app.js': `
        const root = Function('return this')();
        // 同 core-js 2 的微任务 polyfill：有 MutationObserver 就当作浏览器，用 document 建文本节点
        const env = root.MutationObserver || root.WebKitMutationObserver ? (document.createTextNode(''), '浏览器') : '非浏览器';
        App({ globalData: { env } });`,
      'pages/index/index.json': {},
      'pages/index/index.wxml': '<view id="env">{{env}}</view>',
      'pages/index/index.js': `Page({
        data: { env: '' },
        onLoad() {
          this.setData({ env: getApp().globalData.env });
        }
      });`
    });
  });

  afterAll(() => runner?.close());

  it('按 MutationObserver 判断环境的库在逻辑层里走非浏览器分支，小程序照常启动', async () => {
    const frame = await runner.open('/');
    await expectText(frame, '#env', '非浏览器');
  });
});
