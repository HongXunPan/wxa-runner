/**
 * 伴生 SDK 子包能力的占位实现
 */

import { describe, expect, it, vi } from 'vitest';
import { installApiStubs, UNSUPPORTED_AD_APIS } from '../../packages/core/src/runtime/sdkStubs';

const install = () => {
  const warnings: string[] = [];
  // 基础库把这些接口定义成惰性 getter，缺子包时返回 undefined
  const wx: Record<string, any> = {};
  for (const name of UNSUPPORTED_AD_APIS) {
    Object.defineProperty(wx, name, { get: () => () => undefined, configurable: true });
  }
  const replaced = installApiStubs(wx, { warn: message => warnings.push(message) });
  return { wx, warnings, replaced };
};

describe('广告接口占位', () => {
  it('替换掉基础库返回 undefined 的那几个接口', () => {
    const { wx, replaced } = install();
    expect(replaced).toEqual([...UNSUPPORTED_AD_APIS]);
    for (const name of UNSUPPORTED_AD_APIS) expect(wx[name]()).toBeTruthy();
  });

  it('用到了才提示，并且只提示一次', () => {
    const { wx, warnings } = install();
    expect(warnings).toEqual([]);

    wx.createRewardedVideoAd({ adUnitId: 'adunit-x' });
    wx.createInterstitialAd({ adUnitId: 'adunit-y' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('广告');
  });

  it('激励视频接口齐全，load / show 失败并先回调 onError', async () => {
    const { wx } = install();
    const ad = wx.createRewardedVideoAd({ adUnitId: 'adunit-x' });
    for (const method of ['load', 'show', 'destroy', 'onLoad', 'offLoad', 'onError', 'offError', 'onClose', 'offClose']) {
      expect(typeof ad[method]).toBe('function');
    }

    const onError = vi.fn();
    ad.onError(onError);
    await expect(ad.load()).rejects.toMatchObject({ errCode: 1000 });
    await expect(ad.show()).rejects.toMatchObject({ errMsg: expect.stringContaining('不支持') });
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[0][0]).toMatchObject({ errCode: 1000, errMsg: expect.any(String) });
  });

  it('offError 之后不再回调，destroy 清掉监听', async () => {
    const { wx } = install();
    const ad = wx.createRewardedVideoAd({});
    const onError = vi.fn();

    ad.onError(onError);
    ad.offError(onError);
    await expect(ad.load()).rejects.toBeTruthy();
    expect(onError).not.toHaveBeenCalled();

    ad.onError(onError);
    ad.destroy();
    await expect(ad.load()).rejects.toBeTruthy();
    expect(onError).not.toHaveBeenCalled();
  });

  it('只有原生模板广告有 hide / isShow', () => {
    const { wx } = install();
    expect(wx.createCustomAd({}).isShow()).toBe(false);
    expect(wx.createRewardedVideoAd({}).isShow()).toBeUndefined();
  });

  it('没人 catch 的 load 不会变成 unhandledrejection', async () => {
    const { wx } = install();
    const onUnhandled = vi.fn();
    process.on('unhandledRejection', onUnhandled);

    wx.createRewardedVideoAd({}).load();
    await new Promise(resolve => setTimeout(resolve, 10));

    process.off('unhandledRejection', onUnhandled);
    expect(onUnhandled).not.toHaveBeenCalled();
  });

  // 每次 require 业务模块前都会调一遍，不能反复换对象、反复提示
  it('幂等：装过就跳过，基础库改回去之后能重新装上', () => {
    const { wx, warnings } = install();
    const stub = wx.createRewardedVideoAd;

    expect(installApiStubs(wx, { warn: m => warnings.push(m) })).toEqual([]);
    expect(wx.createRewardedVideoAd).toBe(stub);

    wx.createRewardedVideoAd({});
    wx.createRewardedVideoAd({});
    expect(warnings).toHaveLength(1);

    // 基础库在交出 wx 之后还会改写它
    wx.createRewardedVideoAd = () => undefined;
    expect(installApiStubs(wx, { warn: () => undefined })).toEqual(['createRewardedVideoAd']);
    expect(wx.createRewardedVideoAd({})).toBeTruthy();
  });

  it('属性不可配置时跳过，不抛错', () => {
    const wx: Record<string, any> = {};
    Object.defineProperty(wx, 'createRewardedVideoAd', { value: () => undefined, configurable: false });

    const replaced = installApiStubs(wx, { warn: () => undefined });
    expect(replaced).not.toContain('createRewardedVideoAd');
    expect(replaced).toContain('createInterstitialAd');
  });
});
