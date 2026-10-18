/**
 * 地图组件（基础库的网页实现）用到的原生接口
 */

import { describe, expect, it } from 'vitest';
import { createMapApis, MapOperations } from '../../packages/core/src/runtime/host/api/map';
import { createMiscApis } from '../../packages/core/src/runtime/host/api/misc';
import { ApiRegistry, ApiResult } from '../../packages/core/src/runtime/host/api/registry';

describe('地图组件的定位', () => {
  // 基础库的地图网页实现在开发者工具里要当前位置时调 private_geolocation，把结果当作腾讯位置服务定位接口返回的 JSON 文本解析
  function setup() {
    const api = new ApiRegistry();
    api.register(createMiscApis('wx1'));
    api.register(createMapApis({ registry: api, operations: new MapOperations(() => undefined) }));
    const locate = async () => {
      const text = await api.invoke('private_geolocation', { from: 'moveToMapLocation' }, { api: 'private_geolocation', from: 'webview', webviewId: 1 });
      return JSON.parse(text as unknown as string).result?.location;
    };
    return { api, locate };
  }

  it('地图要当前位置时，拿到和 wx.getLocation 相同的坐标', async () => {
    const { api, locate } = setup();
    const location = await api.invoke('getLocation', { type: 'gcj02' }, { api: 'getLocation', from: 'service', webviewId: 1 }) as ApiResult;
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

describe('宿主替基础库操作 map 组件', () => {
  // 3.10.1 起，带经纬度的 moveToLocation 不再经 operateMap 发给 map 组件，改调原生的 moveToMapLocation
  function setup() {
    const sent: Array<{ webviewId: number; event: string; data: any }> = [];
    const operations = new MapOperations((webviewId, event, data) => sent.push({ webviewId, event, data }));
    const api = new ApiRegistry();
    api.register(createMiscApis('wx1'));
    api.register(createMapApis({ registry: api, operations }));
    return { api, operations, sent };
  }

  it('带经纬度的 moveToLocation 转给页面里的 map 组件，map 组件移动完才返回结果', async () => {
    const { api, operations, sent } = setup();
    let result: unknown;
    const moving = (api.invoke('moveToMapLocation', { mapId: 1, latitude: 23.1365, longitude: 113.3245 },
      { api: 'moveToMapLocation', from: 'service', webviewId: 3 }) as Promise<ApiResult>).then(res => (result = res));

    // 和基础库自己发的 operateMap 一样只发给当前页，消息包一层 { data, options }
    expect(sent).toEqual([{
      webviewId: 3,
      event: 'operateMap',
      data: {
        data: expect.objectContaining({ mapId: 1, method: 'moveToMapLocation', latitude: 23.1365, longitude: 113.3245 }),
        options: expect.any(Object)
      }
    }]);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(result).toBeUndefined();

    const { callbackId } = sent[0].data.data;
    const reply = { errMsg: 'moveToMapLocation:ok', mapId: 1, callbackId, method: 'moveToMapLocation' };
    expect(operations.receive({ data: reply, options: { timestamp: Date.now() } })).toBe(true);
    await moving;
    expect(result).toEqual({ errMsg: 'moveToMapLocation:ok' });
  });

  it('map 组件回复的是基础库自己发的操作时，宿主不收下，照常交给逻辑层', () => {
    const { operations } = setup();
    const reply = { errMsg: 'getMapScale:ok', mapId: 1, callbackId: 'callback3_1_0', method: 'getMapScale', scale: 14 };
    expect(operations.receive({ data: reply, options: { timestamp: Date.now() } })).toBe(false);
  });
});
