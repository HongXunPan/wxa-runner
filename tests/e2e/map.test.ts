/**
 * 端到端：map 组件的事件和 MapContext
 *
 * 平台是 devtools 时，基础库用腾讯地图 GL 网页 SDK 实现 map 组件，SDK 和瓦片从腾讯的服务器加载。
 * 这里把 SDK 的地址换成 fixtures/tmap.js 的替身，其余发往腾讯服务器的请求都拒绝，CI 不依赖外网；
 * 只断言业务代码收到的事件和回调，不断言画面。
 *
 * WXA_MAP_SDK=online 时不拦截，用真实的 SDK 跑同样的用例（需要联网），确认替身和真实 SDK 的行为一致。
 */

import fs from 'fs';
import path from 'path';
import type { Frame } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { e2eReady, Runner, startRunner } from './runner';

const FAKE_SDK = fs.readFileSync(path.join(__dirname, 'fixtures/tmap.js'), 'utf8');
const ONLINE = process.env.WXA_MAP_SDK === 'online';

// 地图中心和标记点在广州；getLocation 默认返回北京的坐标，show-location 的定位点不在视野里
const CENTER = { latitude: 23.1291, longitude: 113.2644 };

const MAP_WXML = `
<map id="map" latitude="${CENTER.latitude}" longitude="${CENTER.longitude}" scale="14" show-location markers="{{markers}}"
  style="width: 100%; height: 320px;"
  bindmarkertap="onMarkerTap" bindcallouttap="onCalloutTap" bindtap="onTap" bindregionchange="onRegionChange"></map>
`;

const MAP_JS = `
Page({
  data: {
    markers: [{
      id: 1, latitude: ${CENTER.latitude}, longitude: ${CENTER.longitude}, width: 30, height: 30,
      callout: { content: '广州塔', display: 'ALWAYS', padding: 6 }
    }]
  },
  onLoad() { this.events = []; },
  onMarkerTap(e) { this.events.push(['markertap', e.detail]); },
  onCalloutTap(e) { this.events.push(['callouttap', e.detail]); },
  onTap(e) { this.events.push(['tap', e.detail]); },
  onRegionChange(e) { this.events.push(['regionchange', e.detail]); },
  takeEvents() {
    const events = this.events;
    this.events = [];
    return events;
  },
  // 调 MapContext 的方法，返回 success 或 fail 收到的结果
  callMap(method, args) {
    return new Promise(resolve => wx.createMapContext('map')[method]({ ...args, success: resolve, fail: resolve }));
  }
});
`;

type MapEvent = [string, any];

describe.skipIf(!e2eReady)('map 组件', () => {
  let runner: Runner;

  beforeAll(async () => {
    runner = await startRunner({
      'app.json': { pages: ['pages/map/map'], permission: { 'scope.userLocation': { desc: '展示附近的门店' } } },
      'pages/map/map.json': {},
      'pages/map/map.wxml': MAP_WXML,
      'pages/map/map.js': MAP_JS
    });
    if (!ONLINE) {
      // 后注册的优先：SDK 换成替身，其余发往腾讯服务器的请求（瓦片、样式、鉴权）都拒绝
      await runner.page.route(/^https?:\/\/([^/]+\.)?qq\.com\//, route => route.abort());
      await runner.page.route(/^https:\/\/map\.qq\.com\/api\/gljs/, route => route.fulfill({ contentType: 'text/javascript', body: FAKE_SDK }));
    }
  });

  afterAll(async () => {
    await runner?.close();
  });

  /** 打开地图页，等地图初始化完：气泡在标记点加到地图上时创建 */
  async function openMap(): Promise<Frame> {
    const frame = await runner.open('/?path=pages/map/map');
    await frame.getByText('广州塔').waitFor();
    return frame;
  }

  const takeEvents = () => runner.page.evaluate(() => window.__wxa_test_api__.callPageMethod('takeEvents')) as Promise<MapEvent[]>;

  /** 收集业务收到的事件，直到满足断言；超时时按最后收集到的事件报错 */
  async function collectEvents(assert: (events: MapEvent[]) => void): Promise<MapEvent[]> {
    const events: MapEvent[] = [];
    await vi.waitFor(async () => {
      events.push(...await takeEvents());
      assert(events);
    }, { timeout: 5000, interval: 100 });
    return events;
  }

  const callMap = (method: string, args?: object) =>
    runner.page.evaluate(([m, a]) => window.__wxa_test_api__.callPageMethod('callMap', m, a), [method, args] as const) as Promise<any>;

  /** 等地图中心到达指定位置（真实 SDK 移动地图有动画） */
  async function expectCenter(expected: { latitude: number; longitude: number }) {
    await vi.waitFor(async () => {
      const center = await callMap('getCenterLocation');
      expect(center.latitude).toBeCloseTo(expected.latitude, 4);
      expect(center.longitude).toBeCloseTo(expected.longitude, 4);
    }, { timeout: 5000, interval: 100 });
  }

  async function mapBox(frame: Frame) {
    return (await frame.locator('wx-map').boundingBox())!;
  }

  it('用户点击地图上的标记点，业务收到 markertap，markerId 是这个标记点', async () => {
    const frame = await openMap();
    const box = await mapBox(frame);
    // 标记点 30×30，锚点在底边中点：图标画在地图中心的正上方
    await runner.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 - 15);
    await collectEvents(events => expect(events).toContainEqual(['markertap', { markerId: 1 }]));
  });

  it('用户点击标记点的气泡，业务收到 callouttap', async () => {
    const frame = await openMap();
    await frame.getByText('广州塔').click();
    await collectEvents(events => expect(events).toContainEqual(['callouttap', { markerId: 1 }]));
  });

  it('用户点击地图的空白处，业务收到 tap，带着点击处的经纬度', async () => {
    const frame = await openMap();
    const box = await mapBox(frame);
    await runner.page.mouse.click(box.x + 40, box.y + box.height - 40);

    const events = await collectEvents(got => expect(got.map(([name]) => name)).toContain('tap'));
    const [, tap] = events.find(([name]) => name === 'tap')!;
    // 点的是左下角：在中心的西南方
    expect(tap.latitude).toBeLessThan(CENTER.latitude);
    expect(tap.longitude).toBeLessThan(CENTER.longitude);
  });

  it('用户拖动地图，业务依次收到 regionchange 的 begin 和 end，end 带着拖动后的视野', async () => {
    const frame = await openMap();
    const box = await mapBox(frame);
    const { mouse } = runner.page;
    await mouse.move(box.x + 60, box.y + 60);
    await mouse.down();
    await mouse.move(box.x + 140, box.y + 120, { steps: 10 });
    await mouse.up();

    const events = await collectEvents(got => expect(got).toContainEqual(['regionchange', expect.objectContaining({ type: 'end' })]));
    const changes = events.filter(([name]) => name === 'regionchange').map(([, detail]) => detail);
    expect(changes).toEqual([
      { type: 'begin', causedBy: 'gesture' },
      expect.objectContaining({ type: 'end', causedBy: 'drag', scale: 14, region: { northeast: expect.any(Object), southwest: expect.any(Object) } })
    ]);
    // 往右下拖，看到的是原来左上方的地方：中心往西北移
    expect(changes[1].centerLocation.latitude).toBeGreaterThan(CENTER.latitude);
    expect(changes[1].centerLocation.longitude).toBeLessThan(CENTER.longitude);
  });

  it('业务调 moveToLocation 把地图移到指定的位置，getCenterLocation 读到的就是这个位置', async () => {
    await openMap();
    const target = { latitude: 23.1365, longitude: 113.3245 };
    expect(await callMap('moveToLocation', target)).toEqual({ errMsg: 'moveToMapLocation:ok' });
    await expectCenter(target);
  });

  it('业务调 moveToLocation 不带位置时，地图移到用户的当前位置（wx.getLocation 的位置，测试可以 mock）', async () => {
    await openMap();
    const here = { latitude: 31.2304, longitude: 121.4737 };
    await runner.page.evaluate(location => window.__wxa_test_api__.mock('getLocation', location), here);
    expect(await callMap('moveToLocation')).toEqual({ errMsg: 'moveToMapLocation:ok' });
    await expectCenter(here);
  });
});
