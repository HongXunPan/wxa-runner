/**
 * 地图组件（基础库的网页实现）用到的原生接口
 */

import { describe, expect, it } from 'vitest';
import { createMapApis } from '../../packages/core/src/runtime/host/api/map';
import { createMiscApis } from '../../packages/core/src/runtime/host/api/misc';
import { ApiRegistry } from '../../packages/core/src/runtime/host/api/registry';

describe('地图组件的定位', () => {
  // 基础库的地图网页实现在开发者工具里要当前位置时调 private_geolocation，把结果当作腾讯位置服务定位接口返回的 JSON 文本解析
  function setup() {
    const api = new ApiRegistry();
    api.register(createMiscApis('wx1'));
    api.register(createMapApis(api));
    const locate = async () => {
      const text = await api.invoke('private_geolocation', { from: 'moveToMapLocation' }, { api: 'private_geolocation', from: 'webview', webviewId: 1 });
      return JSON.parse(text as unknown as string).result?.location;
    };
    return { api, locate };
  }

  it('地图要当前位置时，拿到和 wx.getLocation 相同的坐标', async () => {
    const { api, locate } = setup();
    const location = await api.invoke('getLocation', { type: 'gcj02' }, { api: 'getLocation', from: 'service', webviewId: 1 });
    expect(await locate()).toEqual({ lat: location.latitude, lng: location.longitude });
  });

  it('测试 mock 了 wx.getLocation 时，地图的当前位置跟着变', async () => {
    const { api, locate } = setup();
    api.mock('getLocation', { latitude: 31.2304, longitude: 121.4737 });
    expect(await locate()).toEqual({ lat: 31.2304, lng: 121.4737 });
  });

  it('wx.getLocation 失败时（如测试模拟用户拒绝授权），地图拿不到当前位置', async () => {
    const { api, locate } = setup();
    api.mock('getLocation', () => {
      throw new Error('auth deny');
    });
    expect(await locate()).toBeUndefined();
  });
});
