/**
 * map 组件用到的原生接口
 *
 * 平台是 devtools 时，基础库用腾讯地图网页 SDK 实现 map 组件。它要用户的当前位置时（moveToLocation、show-location）
 * 在渲染层调 private_geolocation，把结果当作腾讯位置服务定位接口返回的 JSON 文本解析，没有位置就按定位失败处理，
 * 带着经纬度的 moveToLocation 也会因此失败。
 */

import type { ApiHandler, ApiRegistry, ApiResult } from './registry';

/** @param registry 当前位置取 registry 里 getLocation 的结果：和真机一样，地图上的当前位置就是 getLocation 的位置，mock 了也跟着变 */
export function createMapApis(registry: ApiRegistry): Record<string, ApiHandler> {
  return {
    private_geolocation: async (_args, context) => {
      const location = await registry.invoke('getLocation', { type: 'gcj02' }, { ...context, api: 'getLocation' }) as ApiResult;
      if (location.errMsg !== 'getLocation:ok') return JSON.stringify({ message: location.errMsg });
      return JSON.stringify({ result: { location: { lat: location.latitude, lng: location.longitude } } });
    }
  };
}
