import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findRegionDataFile } from '../../packages/extractor/src/devtools';
import { DevServer } from '../../packages/core/src/server/DevServer';
import { EXAMPLES, hasDevtools, REPO_ROOT } from '../helpers';

const RUNTIME_DIR = path.join(REPO_ROOT, 'packages/core/dist/runtime');
const ready = hasDevtools() && fs.existsSync(path.join(RUNTIME_DIR, 'host.js'));

describe.skipIf(!ready)('DevServer', () => {
  let server: DevServer;
  let base = '';
  const get = (url: string) => fetch(base + url);

  beforeAll(async () => {
    server = new DevServer({
      projectPath: path.join(EXAMPLES, 'showcase'),
      port: 0,
      watch: false,
      runtimeDir: RUNTIME_DIR,
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined }
    });
    base = await server.start();
  });

  afterAll(() => server.close());

  it('宿主页面加载浏览器端运行时', async () => {
    const html = await (await get('/')).text();
    expect(html).toContain('<script src="/__wxa__/runtime/host.js"></script>');
    expect((await get('/__wxa__/runtime/host.js')).status).toBe(200);
  });

  it('app-info 返回页面、基础库版本和 __wxConfig', async () => {
    const info = await (await get('/__wxa__/app-info.json')).json();
    expect(info.pages).toEqual(['pages/index/index', 'pages/detail/detail', 'pages/mine/mine']);
    expect(info.baseLibVersion).toBe(server.baseLib.version);
    expect(info.wxConfig.tabBar.list.map((item: any) => item.pagePath)).toEqual(['pages/index/index.html', 'pages/mine/mine.html']);
  });

  it('逻辑层按顺序加载桥、基础库、业务模块和 bootstrap，并注入启动页面', async () => {
    const html = await (await get('/__wxa__/appservice.html?path=pages/detail/detail&query=id%3D9')).text();
    const order = ['frame.js', '/__baselib__/WAService.js', '/__wxa__/module/app.js', '/__wxa__/service-bootstrap.js'];
    const positions = order.map(marker => html.indexOf(marker));
    expect(positions.every(p => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).toContain('"appLaunchInfo":{"scene":1001,"path":"pages/detail/detail","query":{"id":"9"}}');
  });

  it('渲染层页面带上该页的 window 配置和 webviewId', async () => {
    const html = await (await get('/__wxa__/webview/pages/detail/detail.html?id=3')).text();
    expect(html).toContain('data-webview-id="3"');
    expect(html).toContain('"window":{');
    expect(html).toContain('"navigationBarTitleText":"详情"');
  });

  it('不存在的页面和模块返回 404', async () => {
    expect((await get('/__wxa__/webview/pages/nope/nope.html')).status).toBe(404);
    expect((await get('/__wxa__/module/nope.js')).status).toBe(404);
  });

  it('单个模块以 define 包装返回', async () => {
    const res = await get('/__wxa__/module/utils/store.js');
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toMatch(/^define\("utils\/store\.js", function\(require, module, exports/);
  });

  it('临时文件保存后返回可直接访问的地址，按文件类型返回 Content-Type', async () => {
    const saved = await fetch(base + '/__wxa__/tmp?type=jpg', { method: 'POST', body: Buffer.from('jpeg-bytes') });
    const { url } = await saved.json();
    expect(url).toMatch(new RegExp(`^${base}/__wxa__/tmp/[\\w-]+\\.jpg$`));

    const file = await fetch(url);
    expect(file.headers.get('content-type')).toContain('image/jpeg');
    expect(await file.text()).toBe('jpeg-bytes');
    expect((await get('/__wxa__/tmp/missing.jpg')).status).toBe(404);
  });

  it.skipIf(!findRegionDataFile('districts'))('地区选择器用的行政区划数据取自本机开发者工具', async () => {
    const districts = await get('/__wxa__/region/districts');
    expect(districts.headers.get('content-type')).toContain('text/plain');
    expect(await districts.text()).toContain('海珠区');
    expect(await (await get('/__wxa__/region/streets')).text()).toContain('赤岗街道');
    expect((await get('/__wxa__/region/other')).status).toBe(404);
  });

  it('基础库与小程序静态资源都能访问，渲染层路径下的相对资源也能解析', async () => {
    expect((await get('/__baselib__/WAWebview.js')).status).toBe(200);
    expect((await get('/app.wxss')).status).toBe(200);
    expect((await get('/__wxa__/webview/app.wxss')).status).toBe(200);
  });
});
