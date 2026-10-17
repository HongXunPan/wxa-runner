/**
 * e2e：业务代码拿到的值属于业务代码自己的全局环境
 *
 * 宿主、逻辑层、渲染层是不同的 iframe，各有一套 Object / Array；新版基础库的业务代码还在逻辑层里的子上下文里。
 * 宿主交给逻辑层的值如果属于别的 iframe，业务代码里的 instanceof 不成立，基础库的 setData 也会把这样的数组
 * 当成普通对象（比如 chooseImage 返回的 tempFilePaths 用于 wx:if="{{paths.length}}" 时，图片不显示）。
 * 用 WXA_BASELIB=<版本> pnpm test 在各个版本上验证。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { e2eReady, expectText, Runner, startRunner } from './runner';

describe.skipIf(!e2eReady)('业务代码拿到的值属于业务代码自己的全局环境', () => {
  let runner: Runner;

  beforeAll(async () => {
    runner = await startRunner({
      'app.json': { pages: ['pages/index/index'] },
      'pages/index/index.json': {},
      'pages/index/index.wxml': `
        <view id="api">{{api}}</view>
        <view id="tap" bindtap="tap" data-list="{{[1, 2]}}">tap</view>
        <view id="event">{{event}}</view>
        <view id="select" bindtap="select" data-list="{{['a', 'b']}}">select</view>
        <view id="items" wx:if="{{items.length}}">{{items.length}} 项</view>`,
      'pages/index/index.js': `Page({
        data: { api: '', event: '', items: [] },
        onLoad() {
          wx.setStorageSync('list', [1, 2]);
          // 用宿主当场返回的同步结果；getSystemInfoSync 等是主上下文的基础库自己拼出来的，不经过宿主
          const sync = wx.getStorageInfoSync();
          wx.getStorage({ key: 'list', success: res => {
            this.setData({ api: JSON.stringify({ sync: sync instanceof Object, async: res instanceof Object, array: res.data instanceof Array }) });
          } });
        },
        tap(e) {
          this.setData({ event: JSON.stringify({ event: e instanceof Object, dataset: e.currentTarget.dataset.list instanceof Array }) });
        },
        select(e) {
          // 原样把宿主交来的数组交给 setData
          this.setData({ items: e.currentTarget.dataset.list });
        }
      });`
    });
  });

  afterAll(() => runner?.close());

  it('原生 API 的同步、异步结果和事件对象，在业务代码里 instanceof 成立', async () => {
    const frame = await runner.open('/');
    await expectText(frame, '#api', JSON.stringify({ sync: true, async: true, array: true }));
    await frame.click('#tap');
    await expectText(frame, '#event', JSON.stringify({ event: true, dataset: true }));
  });

  it('事件里的数组直接交给 setData，渲染层按数组渲染', async () => {
    const frame = await runner.open('/');
    await frame.click('#select');
    await expectText(frame, '#items', '2 项');
  });
});
