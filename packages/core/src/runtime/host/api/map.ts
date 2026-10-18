/**
 * map 组件用到的原生接口
 *
 * 平台是 devtools 时，基础库用腾讯地图网页 SDK 实现 map 组件，MapContext 的方法大多经 operateMap 消息发给它。
 * 有两处要原生接口配合：
 * - 要用户的当前位置时（moveToLocation、show-location），map 组件在渲染层调 private_geolocation，把结果当作
 *   腾讯位置服务定位接口返回的 JSON 文本解析，没有位置就按定位失败处理，带着经纬度的 moveToLocation 也会因此失败
 * - 3.10.1 起，带经纬度的 moveToLocation 不再经 operateMap 发给 map 组件，改调原生的 moveToMapLocation
 */

import type { ApiHandler, ApiRegistry, ApiResult } from './registry';

export interface MapApiOptions {
  /** 当前位置取这里 getLocation 的结果：和真机一样，地图上的当前位置就是 getLocation 的位置，mock 了也跟着变 */
  registry: ApiRegistry;
  operations: MapOperations;
}

export function createMapApis({ registry, operations }: MapApiOptions): Record<string, ApiHandler> {
  return {
    private_geolocation: async (_args, context) => {
      const location = await registry.invoke('getLocation', { type: 'gcj02' }, { ...context, api: 'getLocation' }) as ApiResult;
      if (location.errMsg !== 'getLocation:ok') return JSON.stringify({ message: location.errMsg });
      return JSON.stringify({ result: { location: { lat: location.latitude, lng: location.longitude } } });
    },
    // 开发者工具上没有原生地图，照基础库的格式转给当前页的 map 组件
    moveToMapLocation: (args, { webviewId }) => operations.send(webviewId, { ...args, method: 'moveToMapLocation' })
  };
}

/**
 * 宿主替基础库发给 map 组件的操作：按 callbackId 收下 map 组件发回的 operateMapCallback。
 * 消息格式同基础库，包一层 { data, options }
 */
export class MapOperations {
  private readonly pending = new Map<string, (result: ApiResult) => void>();
  private seq = 0;

  /** @param publish 发给渲染层，渲染层的 WeixinJSBridge.subscribe 收到 */
  constructor(private readonly publish: (webviewId: number, event: string, data: unknown) => void) {}

  /** map 组件做完才返回；页面上没有这个 map 时一直不返回，同基础库自己发的操作 */
  send(webviewId: number, operation: Record<string, unknown>): Promise<ApiResult> {
    const callbackId = `wxa_${++this.seq}`;
    return new Promise(resolve => {
      this.pending.set(callbackId, resolve);
      this.publish(webviewId, 'operateMap', { data: { ...operation, callbackId }, options: { timestamp: Date.now() } });
    });
  }

  /** map 组件发回的 operateMapCallback：是宿主发的操作时收下并返回 true，不再交给逻辑层 */
  receive(message: any): boolean {
    const reply = message?.data;
    const resolve = this.pending.get(reply?.callbackId);
    if (!resolve) return false;
    this.pending.delete(reply.callbackId);
    resolve({ errMsg: reply.errMsg });
    return true;
  }
}
